using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace SmartPmEvidence {
    public sealed class NativeResult {
        public string status;
        public string code;
        public string evidenceRef;
        public string compilerRef;
        public Dictionary<string, bool> checks;
        public Dictionary<string, long> counts;
        public bool newObjectStateUnverified;
        public bool retained = true;
        public bool closed;
    }
    public sealed class FixtureResult {
        public string caseId;
        public string classification;
        public string status;
        public string expectedCode;
        public string observedCode;
        public Dictionary<string, bool> facts;
        public NativeResult result;
    }
    internal sealed class NativeFault : Exception {
        internal readonly string Code;
        internal readonly bool Blocked;
        internal NativeFault(string code, bool blocked) { Code = code; Blocked = blocked; }
    }
    internal sealed class HeldObject {
        internal SafeFileHandle Handle;
        internal byte[] Identity;
        internal bool Directory;
        internal string Name;
    }

    // All filesystem access is rooted in held directory handles. No deletion,
    // recursive traversal, external path, credential or network API is exposed.
    public sealed class NativeSession {
        const uint READ_CONTROL = 0x00020000, SYNCHRONIZE = 0x00100000;
        const uint READ_ATTRIBUTES = 0x80, FULL_CONTROL = 2032127;
        const uint SHARE_RW = 3, SHARE_ALL = 7, DELETE_ACCESS = 0x10000;
        const uint DIRECTORY_OPTION = 1, SYNCHRONOUS_OPTION = 0x20;
        const uint NON_DIRECTORY_OPTION = 0x40, OPEN_REPARSE = 0x00200000;
        const uint FILE_CREATE = 2, FILE_OPEN = 1;
        const int STATUS_COLLISION = unchecked((int)0xC0000035);
        const int STATUS_SHARING = unchecked((int)0xC0000043);
        const int STATUS_NO_MORE_FILES = unchecked((int)0x80000006);
        const int SE_FILE_OBJECT = 1;
        const uint OWNER_SECURITY = 1, DACL_SECURITY = 4, PROTECTED_DACL = 0x80000000;
        static readonly string[] FileNames = { "synthetic-response.json", "summary.json" };
        static readonly string[] CheckNames = {
            "platformSupported", "identitySupported", "locationSupported", "ancestorHandlesHeld",
            "rootCreatedExclusive", "rootAclValid", "nativeIdentityValid", "rootEntriesValid",
            "filesCreatedExclusive", "fileAclsValid", "contentVerified", "flushVerified", "deleteSharingDenied"
        };
        static readonly string[] CountNames = { "directoriesCreated", "filesCreated", "bytesWritten", "bytesVerified", "flushes", "validationCalls" };

        [StructLayout(LayoutKind.Sequential)] struct UNICODE_STRING { internal ushort Length; internal ushort MaximumLength; internal IntPtr Buffer; }
        [StructLayout(LayoutKind.Sequential)] struct OBJECT_ATTRIBUTES {
            internal int Length; internal IntPtr RootDirectory; internal IntPtr ObjectName;
            internal uint Attributes; internal IntPtr SecurityDescriptor; internal IntPtr SecurityQualityOfService;
        }
        [StructLayout(LayoutKind.Sequential)] struct IO_STATUS_BLOCK { internal IntPtr Status; internal UIntPtr Information; }
        [DllImport("ntdll.dll")] static extern int NtCreateFile(out IntPtr handle, uint access, ref OBJECT_ATTRIBUTES attributes,
            out IO_STATUS_BLOCK io, IntPtr allocationSize, uint fileAttributes, uint share, uint disposition,
            uint options, IntPtr eaBuffer, uint eaLength);
        [DllImport("ntdll.dll")] static extern int NtQueryDirectoryFile(SafeFileHandle handle, IntPtr evt, IntPtr apc, IntPtr context,
            out IO_STATUS_BLOCK io, IntPtr buffer, uint length, int informationClass,
            [MarshalAs(UnmanagedType.U1)] bool single, IntPtr fileName, [MarshalAs(UnmanagedType.U1)] bool restart);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern SafeFileHandle CreateFileW(string name,
            uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int kind, byte[] buffer, uint size);
        [DllImport("kernel32.dll", SetLastError = true)] static extern uint GetFileType(SafeFileHandle handle);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool GetVolumeInformationByHandleW(SafeFileHandle handle,
            IntPtr volumeName, uint volumeNameSize, out uint serial, out uint maximumComponent, out uint flags, StringBuilder fileSystemName, uint fileSystemNameSize);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteFile(SafeFileHandle handle, byte[] data, uint size, out uint written, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadFile(SafeFileHandle handle, byte[] data, uint size, out uint read, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetFilePointerEx(SafeFileHandle handle, long distance, out long position, uint origin);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool FlushFileBuffers(SafeFileHandle handle);
        [DllImport("advapi32.dll", SetLastError = true)] static extern uint GetSecurityInfo(SafeFileHandle handle, int type, uint info,
            out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
        [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
        [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetSecurityDescriptorDacl(IntPtr descriptor,
            [MarshalAs(UnmanagedType.Bool)] out bool present, out IntPtr dacl, [MarshalAs(UnmanagedType.Bool)] out bool defaulted);
        [DllImport("advapi32.dll", SetLastError = true)] static extern uint SetSecurityInfo(SafeFileHandle handle, int type, uint info,
            IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
        [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateHardLinkW(string link, string existing, IntPtr security);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool DeviceIoControl(SafeFileHandle handle, uint code, byte[] input,
            uint inSize, IntPtr output, uint outSize, out uint returned, IntPtr overlapped);

        readonly List<HeldObject> ancestors = new List<HeldObject>();
        readonly List<HeldObject> fixtures = new List<HeldObject>();
        readonly Dictionary<string, HeldObject> files = new Dictionary<string, HeldObject>(StringComparer.Ordinal);
        readonly Dictionary<string, byte[]> expectedBytes = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        readonly Dictionary<string, bool> checks = new Dictionary<string, bool>(StringComparer.Ordinal);
        readonly Dictionary<string, long> counts = new Dictionary<string, long>(StringComparer.Ordinal);
        HeldObject root;
        string rootName;
        string rootPath;
        SecurityIdentifier user;
        readonly SecurityIdentifier system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
        string status = "BLOCKED", code = "NATIVE_CAPABILITY_UNAVAILABLE";
        bool closed, unverified;
        readonly string evidenceRef;

        NativeSession(string reference) { evidenceRef = reference; foreach (string name in CheckNames) checks.Add(name, false); foreach (string name in CountNames) counts.Add(name, 0); }
        static void Fail(string value) { throw new NativeFault(value, false); }
        static void Blocked(string value) { throw new NativeFault(value, true); }
        static bool Equal(byte[] a, byte[] b) {
            if (a == null || b == null || a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }
        public static NativeSession Create() { return Create("hk-win-sink-" + Guid.NewGuid().ToString("N")); }
        public static NativeSession Create(string reference) {
            if (!System.Text.RegularExpressions.Regex.IsMatch(reference ?? "", "\\Ahk-win-sink-[0-9a-f]{32}\\z")) throw new ArgumentException("REFERENCE_INVALID");
            NativeSession session = new NativeSession(reference);
            try { session.Initialize(); session.status = "PASS"; session.code = "OK"; }
            catch (NativeFault failure) { session.Record(failure.Code, failure.Blocked); }
            catch { session.Record("NATIVE_CAPABILITY_UNAVAILABLE", true); }
            return session;
        }
        void Record(string value, bool blocked) {
            status = blocked ? "BLOCKED" : "FAIL"; code = value;
            if (counts["directoriesCreated"] != 0 || counts["filesCreated"] != 0) unverified = true;
        }
        NativeResult Result() {
            return new NativeResult { status = status, code = code, evidenceRef = evidenceRef, compilerRef = null,
                checks = new Dictionary<string, bool>(checks), counts = new Dictionary<string, long>(counts),
                newObjectStateUnverified = unverified, retained = true, closed = closed };
        }
        public NativeResult Observe() { return Result(); }
        static void CheckComponent(string name) {
            if (String.IsNullOrEmpty(name) || name.Length > 180 || name == "." || name == ".." ||
                name.EndsWith(".", StringComparison.Ordinal) || name.EndsWith(" ", StringComparison.Ordinal)) Fail("NAME_INVALID");
            foreach (char c in name) if (c < 32 || "<>:\"/\\|?*".IndexOf(c) >= 0) Fail("NAME_INVALID");
        }
        static SafeFileHandle Relative(SafeFileHandle parent, string name, bool directory, uint disposition,
            uint access, uint share, byte[] descriptor, out int nativeStatus) {
            CheckComponent(name);
            IntPtr chars = IntPtr.Zero, unicodePointer = IntPtr.Zero, descriptorPointer = IntPtr.Zero;
            try {
                chars = Marshal.StringToHGlobalUni(name);
                UNICODE_STRING unicode = new UNICODE_STRING { Length = checked((ushort)(name.Length * 2)), MaximumLength = checked((ushort)(name.Length * 2 + 2)), Buffer = chars };
                unicodePointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(UNICODE_STRING)));
                Marshal.StructureToPtr(unicode, unicodePointer, false);
                if (descriptor != null) { descriptorPointer = Marshal.AllocHGlobal(descriptor.Length); Marshal.Copy(descriptor, 0, descriptorPointer, descriptor.Length); }
                OBJECT_ATTRIBUTES attributes = new OBJECT_ATTRIBUTES { Length = Marshal.SizeOf(typeof(OBJECT_ATTRIBUTES)),
                    RootDirectory = parent.DangerousGetHandle(), ObjectName = unicodePointer, Attributes = 0x40,
                    SecurityDescriptor = descriptorPointer, SecurityQualityOfService = IntPtr.Zero };
                IO_STATUS_BLOCK io; IntPtr rawHandle;
                nativeStatus = NtCreateFile(out rawHandle, access, ref attributes, out io, IntPtr.Zero, directory ? 0x10u : 0x80u,
                    share, disposition, (directory ? DIRECTORY_OPTION : NON_DIRECTORY_OPTION) | SYNCHRONOUS_OPTION | OPEN_REPARSE, IntPtr.Zero, 0);
                if (nativeStatus != 0) { if (rawHandle != IntPtr.Zero && rawHandle != new IntPtr(-1)) new SafeFileHandle(rawHandle, true).Dispose(); return null; }
                return new SafeFileHandle(rawHandle, true);
            } finally { if (descriptorPointer != IntPtr.Zero) Marshal.FreeHGlobal(descriptorPointer); if (unicodePointer != IntPtr.Zero) Marshal.FreeHGlobal(unicodePointer); if (chars != IntPtr.Zero) Marshal.FreeHGlobal(chars); }
        }
        SafeFileHandle OpenChild(SafeFileHandle parent, string name, bool directory, bool create, uint share, byte[] descriptor) {
            // A create syscall that fails or loses its result cannot be
            // represented by zero completed counts as proof of no object.
            if (create) unverified = true;
            int nativeStatus; SafeFileHandle handle = Relative(parent, name, directory, create ? FILE_CREATE : FILE_OPEN,
                create ? FULL_CONTROL : READ_CONTROL | READ_ATTRIBUTES | SYNCHRONIZE, share, descriptor, out nativeStatus);
            if (handle == null) { if (nativeStatus == STATUS_COLLISION) Fail("NAME_COLLISION"); Fail(create ? "CREATE_FAILED" : "ANCESTOR_OPEN_FAILED"); }
            return handle;
        }
        byte[] Identity(SafeFileHandle handle, bool directory) {
            checks["nativeIdentityValid"] = false;
            if (handle == null || handle.IsClosed || handle.IsInvalid || GetFileType(handle) != 1) Fail("OBJECT_TYPE_INVALID");
            byte[] tags = new byte[8];
            if (!GetFileInformationByHandleEx(handle, 9, tags, 8)) Blocked("FILE_ATTRIBUTE_CAPABILITY_UNAVAILABLE");
            uint attributes = BitConverter.ToUInt32(tags, 0);
            if ((attributes & 0x400) != 0 || BitConverter.ToUInt32(tags, 4) != 0) Fail("REPARSE_POINT");
            if (((attributes & 0x10) != 0) != directory) Fail("OBJECT_TYPE_INVALID");
            byte[] standard = new byte[24];
            if (!GetFileInformationByHandleEx(handle, 1, standard, 24)) Blocked("FILE_STANDARD_CAPABILITY_UNAVAILABLE");
            if (standard[20] != 0 || (standard[21] != 0) != directory) Fail("OBJECT_TYPE_INVALID");
            if (!directory && BitConverter.ToUInt32(standard, 16) != 1) Fail("FILE_LINK_COUNT_INVALID");
            byte[] identity = new byte[24];
            if (!GetFileInformationByHandleEx(handle, 18, identity, 24)) Blocked("FILE_ID_CAPABILITY_UNAVAILABLE");
            bool nonzero = false; for (int i = 8; i < identity.Length; i++) if (identity[i] != 0) nonzero = true;
            if (!nonzero) Blocked("FILE_ID_CAPABILITY_UNAVAILABLE");
            checks["nativeIdentityValid"] = true; return identity;
        }
        void CheckIdentity(HeldObject item, byte[] identity) {
            if (!Equal(Identity(item.Handle, item.Directory), identity)) { checks["nativeIdentityValid"] = false; Fail(item.Directory ? "ROOT_ID_MISMATCH" : "FILE_ID_MISMATCH"); }
        }
        byte[] Descriptor(bool directory, bool narrow) {
            RawAcl acl = new RawAcl(2, narrow ? 1 : 2);
            AceFlags flags = directory ? AceFlags.ContainerInherit | AceFlags.ObjectInherit : AceFlags.Inherited;
            acl.InsertAce(0, new CommonAce(flags, AceQualifier.AccessAllowed, (int)FULL_CONTROL, user, false, null));
            if (!narrow) acl.InsertAce(1, new CommonAce(flags, AceQualifier.AccessAllowed, (int)FULL_CONTROL, system, false, null));
            ControlFlags control = ControlFlags.SelfRelative | ControlFlags.DiscretionaryAclPresent;
            if (directory) control |= ControlFlags.DiscretionaryAclProtected;
            RawSecurityDescriptor raw = new RawSecurityDescriptor(control, user, null, null, acl);
            byte[] bytes = new byte[raw.BinaryLength]; raw.GetBinaryForm(bytes, 0); return bytes;
        }
        byte[] SecurityBytes(SafeFileHandle handle) {
            IntPtr owner, group, dacl, sacl, descriptor;
            uint error = GetSecurityInfo(handle, SE_FILE_OBJECT, OWNER_SECURITY | DACL_SECURITY, out owner, out group, out dacl, out sacl, out descriptor);
            if (error != 0 || descriptor == IntPtr.Zero) Fail("ACL_READ_FAILED");
            try { uint length = GetSecurityDescriptorLength(descriptor); if (length < 20 || length > 65536) Fail("ACL_READ_FAILED"); byte[] bytes = new byte[length]; Marshal.Copy(descriptor, bytes, 0, (int)length); return bytes; }
            finally { LocalFree(descriptor); }
        }
        void CheckAcl(HeldObject item) {
            checks[item.Directory ? "rootAclValid" : "fileAclsValid"] = false;
            byte[] bytes = SecurityBytes(item.Handle);
            RawSecurityDescriptor raw = new RawSecurityDescriptor(bytes, 0);
            bool directory = item.Directory;
            string failure = directory ? "ROOT_ACL_INVALID" : "FILE_ACL_INVALID";
            if (raw.Owner == null || !raw.Owner.Equals(user) || (raw.ControlFlags & ControlFlags.DiscretionaryAclPresent) == 0 ||
                ((raw.ControlFlags & ControlFlags.DiscretionaryAclProtected) != 0) != directory ||
                raw.DiscretionaryAcl == null || raw.DiscretionaryAcl.Count != 2) Fail(failure);
            HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (GenericAce generic in raw.DiscretionaryAcl) {
                CommonAce ace = generic as CommonAce;
                if (ace == null || ace.AceType != AceType.AccessAllowed || ace.IsCallback || ace.AccessMask != FULL_CONTROL ||
                    (int)ace.AceFlags != (directory ? 3 : 16) ||
                    (!ace.SecurityIdentifier.Equals(user) && !ace.SecurityIdentifier.Equals(system)) || !seen.Add(ace.SecurityIdentifier.Value)) Fail(failure);
            }
            FileSystemSecurity adapted = directory ? (FileSystemSecurity)new DirectorySecurity() : new FileSecurity();
            adapted.SetSecurityDescriptorBinaryForm(bytes, AccessControlSections.Access | AccessControlSections.Owner);
            if (!adapted.AreAccessRulesCanonical) Fail(failure);
            AuthorizationRuleCollection rules = adapted.GetAccessRules(true, true, typeof(SecurityIdentifier));
            if (rules.Count != 2) Fail(failure);
            HashSet<string> adaptedSids = new HashSet<string>(StringComparer.Ordinal);
            foreach (FileSystemAccessRule rule in rules) {
                if (rule.AccessControlType != AccessControlType.Allow || (int)rule.FileSystemRights != FULL_CONTROL || rule.IsInherited == directory ||
                    (int)rule.InheritanceFlags != (directory ? 3 : 0) || (int)rule.PropagationFlags != 0 || !seen.Contains(rule.IdentityReference.Value) || !adaptedSids.Add(rule.IdentityReference.Value)) Fail(failure);
            }
            if (!seen.SetEquals(adaptedSids)) Fail(failure);
            if (item.Directory) checks["rootAclValid"] = true;
        }
        void Initialize() {
            if (Environment.OSVersion.Platform != PlatformID.Win32NT) Blocked("PLATFORM_UNSUPPORTED");
            checks["platformSupported"] = true;
            using (WindowsIdentity identity = WindowsIdentity.GetCurrent()) {
                if (identity.User == null || new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator)) Blocked("ELEVATED_OR_IDENTITY_UNSUPPORTED");
                user = new SecurityIdentifier(identity.User.Value);
                string value = user.Value;
                if (!value.StartsWith("S-1-5-21-", StringComparison.Ordinal) && !value.StartsWith("S-1-12-1-", StringComparison.Ordinal)) Blocked("IDENTITY_UNSUPPORTED");
            }
            checks["identitySupported"] = true;
            string basePath = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.DoNotVerify);
            if (String.IsNullOrEmpty(basePath) || basePath.Length > 1800 || basePath.Length < 3 || basePath[1] != ':' || basePath[2] != '\\' || basePath.IndexOf('/') >= 0 || !Path.IsPathRooted(basePath)) Blocked("LOCATION_UNSUPPORTED");
            basePath = Path.GetFullPath(basePath).TrimEnd('\\');
            DriveInfo drive = new DriveInfo(Path.GetPathRoot(basePath));
            if (drive.DriveType != DriveType.Fixed || !drive.IsReady || drive.DriveFormat != "NTFS") Blocked("LOCATION_UNSUPPORTED");
            SafeFileHandle volume = CreateFileW(Path.GetPathRoot(basePath), READ_CONTROL | READ_ATTRIBUTES | SYNCHRONIZE, SHARE_RW, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
            if (volume.IsInvalid) { volume.Dispose(); Blocked("ANCESTOR_OPEN_FAILED"); }
            HeldObject first = new HeldObject { Handle = volume, Directory = true, Name = "volume" };
            ancestors.Add(first); first.Identity = Identity(volume, true); SecurityBytes(volume);
            StringBuilder fileSystemName = new StringBuilder(32); uint volumeSerial, maximumComponent, fileSystemFlags;
            if (!GetVolumeInformationByHandleW(volume, IntPtr.Zero, 0, out volumeSerial, out maximumComponent, out fileSystemFlags, fileSystemName, 32) ||
                fileSystemName.ToString() != "NTFS" || (fileSystemFlags & 8) == 0) Blocked("NTFS_HANDLE_CAPABILITY_UNAVAILABLE");
            checks["locationSupported"] = true;
            SafeFileHandle parent = volume;
            string suffix = basePath.Substring(3);
            foreach (string segment in suffix.Split(new char[] { '\\' }, StringSplitOptions.RemoveEmptyEntries)) {
                SafeFileHandle child = OpenChild(parent, segment, true, false, SHARE_RW, null);
                HeldObject held = new HeldObject { Handle = child, Directory = true, Name = segment };
                ancestors.Add(held); held.Identity = Identity(child, true); SecurityBytes(child);
                if (!EqualVolume(first.Identity, held.Identity)) Blocked("VOLUME_CHANGED");
                parent = child;
            }
            checks["ancestorHandlesHeld"] = true;
            rootName = evidenceRef;
            rootPath = basePath + "\\" + rootName;
            SafeFileHandle created = OpenChild(parent, rootName, true, true, SHARE_RW, Descriptor(true, false));
            counts["directoriesCreated"]++; unverified = true;
            root = new HeldObject { Handle = created, Directory = true, Name = rootName };
            checks["rootCreatedExclusive"] = true;
            root.Identity = Identity(created, true);
            if (!EqualVolume(first.Identity, root.Identity)) Fail("VOLUME_CHANGED");
            CheckAcl(root); checks["rootAclValid"] = true; checks["nativeIdentityValid"] = true;
            if (!DeleteOpenRejected(parent, rootName, true)) Fail("DELETE_SHARING_NOT_DENIED");
            checks["deleteSharingDenied"] = true;
            CheckEntries(); checks["rootEntriesValid"] = true; unverified = false;
        }
        static bool EqualVolume(byte[] left, byte[] right) { for (int i = 0; i < 8; i++) if (left[i] != right[i]) return false; return true; }
        bool DeleteOpenRejected(SafeFileHandle parent, string name, bool directory) {
            int nativeStatus; SafeFileHandle attempt = Relative(parent, name, directory, FILE_OPEN, DELETE_ACCESS | SYNCHRONIZE, SHARE_ALL, null, out nativeStatus);
            if (attempt != null) attempt.Dispose();
            return attempt == null && nativeStatus == STATUS_SHARING;
        }
        List<string> EntryNames() {
            List<string> names = new List<string>(); IntPtr buffer = Marshal.AllocHGlobal(65536);
            try {
                bool restart = true;
                for (int batch = 0; batch < 4; batch++) {
                    IO_STATUS_BLOCK io;
                    int status = NtQueryDirectoryFile(root.Handle, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, out io, buffer, 65536, 12, false, IntPtr.Zero, restart);
                    restart = false;
                    if (status == STATUS_NO_MORE_FILES) return names;
                    if (status != 0) Fail("DIRECTORY_ENUMERATION_FAILED");
                    ulong received = io.Information.ToUInt64(); if (received < 12 || received > 65536) Fail("DIRECTORY_ENUMERATION_FAILED");
                    int offset = 0;
                    for (;;) {
                        if (offset < 0 || offset + 12 > (int)received) Fail("DIRECTORY_ENUMERATION_FAILED");
                        int next = Marshal.ReadInt32(buffer, offset), bytes = Marshal.ReadInt32(buffer, offset + 8);
                        if (bytes < 0 || (bytes & 1) != 0 || offset + 12 + bytes > (int)received) Fail("DIRECTORY_ENUMERATION_FAILED");
                        string name = Marshal.PtrToStringUni(new IntPtr(buffer.ToInt64() + offset + 12), bytes / 2);
                        if (name != "." && name != "..") { names.Add(name); if (names.Count > 8) Fail("UNKNOWN_ENTRY"); }
                        if (next == 0) break;
                        if (next < 12 || offset + next <= offset) Fail("DIRECTORY_ENUMERATION_FAILED"); offset += next;
                    }
                }
                Fail("DIRECTORY_ENUMERATION_FAILED"); return names;
            } finally { Marshal.FreeHGlobal(buffer); }
        }
        void CheckEntries() {
            List<string> names = EntryNames();
            if (names.Count != files.Count) Fail("UNKNOWN_ENTRY");
            foreach (string name in names) if (!files.ContainsKey(name)) Fail("UNKNOWN_ENTRY");
        }
        void ValidateCore() {
            if (closed) Fail("NATIVE_CAPABILITY_CLOSED");
            if (root == null) Blocked("NATIVE_CAPABILITY_UNAVAILABLE");
            counts["validationCalls"]++;
            checks["ancestorHandlesHeld"] = false; checks["nativeIdentityValid"] = false;
            checks["rootAclValid"] = false; checks["rootEntriesValid"] = false; checks["fileAclsValid"] = false;
            foreach (HeldObject ancestor in ancestors) CheckIdentity(ancestor, ancestor.Identity);
            checks["ancestorHandlesHeld"] = true;
            CheckIdentity(root, root.Identity); CheckAcl(root);
            checks["rootAclValid"] = true; checks["nativeIdentityValid"] = true;
            CheckEntries(); checks["rootEntriesValid"] = true;
            foreach (HeldObject file in files.Values) { CheckIdentity(file, file.Identity); CheckAcl(file); }
            if (files.Count == 2) checks["fileAclsValid"] = true;
        }
        public NativeResult Validate() {
            if (status != "PASS") return Result();
            try { ValidateCore(); status = "PASS"; code = "OK"; }
            catch (NativeFault failure) { Record(failure.Code, failure.Blocked); }
            catch { Record("NATIVE_VALIDATION_FAILED", false); }
            return Result();
        }
        HeldObject CreateKnownFile(string name, bool claim, uint share) {
            if (name != FileNames[0] && name != FileNames[1] && name != "unexpected.fixture" && name != "other.fixture" && name != "hardlink.fixture") Fail("NAME_INVALID");
            SafeFileHandle handle = OpenChild(root.Handle, name, false, true, share, null);
            counts["filesCreated"]++; unverified = true;
            checks["rootEntriesValid"] = false; checks["fileAclsValid"] = false;
            HeldObject file = new HeldObject { Handle = handle, Directory = false, Name = name };
            if (claim) files.Add(name, file); else fixtures.Add(file);
            file.Identity = Identity(handle, false); CheckAcl(file);
            if (!EqualVolume(root.Identity, file.Identity)) Fail("VOLUME_CHANGED");
            return file;
        }
        void WriteAll(HeldObject file, byte[] bytes, bool partial) {
            int total = 0, limit = partial ? Math.Min(bytes.Length, 7) : bytes.Length;
            while (total < limit) {
                byte[] chunk = new byte[limit - total]; Buffer.BlockCopy(bytes, total, chunk, 0, chunk.Length); uint written;
                if (!WriteFile(file.Handle, chunk, (uint)chunk.Length, out written, IntPtr.Zero) || written == 0 || written > chunk.Length) Fail("WRITE_FAILED");
                total += (int)written; counts["bytesWritten"] += written;
            }
            if (partial) Fail("INJECTED_PARTIAL_WRITE");
        }
        byte[] ReadExact(HeldObject file, int length) {
            long position; if (!SetFilePointerEx(file.Handle, 0, out position, 0) || position != 0) Fail("READBACK_FAILED");
            byte[] content = new byte[length + 1]; int total = 0;
            while (total < content.Length) {
                byte[] chunk = new byte[content.Length - total]; uint read;
                if (!ReadFile(file.Handle, chunk, (uint)chunk.Length, out read, IntPtr.Zero) || read > chunk.Length) Fail("READBACK_FAILED");
                if (read == 0) break; Buffer.BlockCopy(chunk, 0, content, total, (int)read); total += (int)read;
            }
            if (total != length) Fail("CONTENT_MISMATCH");
            byte[] exact = new byte[length]; Buffer.BlockCopy(content, 0, exact, 0, length); return exact;
        }
        void WriteCore(string summaryJson, string injection) {
            ValidateCore();
            if (summaryJson == null || summaryJson.Length < 2 || summaryJson.Length > 65536) Fail("SUMMARY_INVALID");
            foreach (char c in summaryJson) if (c < 32 || c > 126) Fail("SUMMARY_INVALID");
            string envelope = "{\"recordType\":\"pre-final-output-summary\",\"notFinalAcceptance\":true,\"summary\":" + summaryJson + "}";
            byte[][] payloads = { Encoding.ASCII.GetBytes("{\"scope\":\"synthetic-windows-evidence-only\",\"synthetic\":true}\n"), Encoding.ASCII.GetBytes(envelope + "\n") };
            for (int i = 0; i < FileNames.Length; i++) {
                ValidateCore();
                HeldObject file = CreateKnownFile(FileNames[i], true, 0);
                CheckIdentity(file, file.Identity); CheckAcl(file);
                WriteAll(file, payloads[i], injection == "partial-write" && i == 0);
                CheckIdentity(file, file.Identity); CheckAcl(file);
                if (injection == "flush-failure" && i == 0) {
                    using (SafeFileHandle invalid = new SafeFileHandle(new IntPtr(-1), false)) { if (FlushFileBuffers(invalid)) Fail("INJECTION_FAILED"); }
                    Fail("INJECTED_FLUSH_FAILURE");
                }
                if (!FlushFileBuffers(file.Handle)) Fail("FLUSH_FAILED"); counts["flushes"]++;
                byte[] read = ReadExact(file, payloads[i].Length);
                byte[] expected = (byte[])payloads[i].Clone(); if (injection == "read-mismatch" && i == 0) expected[0] ^= 1;
                if (!Equal(read, expected)) Fail(injection == "read-mismatch" ? "INJECTED_READ_MISMATCH" : "CONTENT_MISMATCH");
                counts["bytesVerified"] += read.Length; expectedBytes.Add(FileNames[i], payloads[i]);
                CheckIdentity(file, file.Identity); CheckAcl(file);
                if (!DeleteOpenRejected(root.Handle, FileNames[i], false)) Fail("DELETE_SHARING_NOT_DENIED");
            }
            checks["filesCreatedExclusive"] = true; checks["fileAclsValid"] = true;
            checks["contentVerified"] = true; checks["flushVerified"] = true;
            ValidateCore(); unverified = false;
        }
        public NativeResult WriteSynthetic(string summaryJson) {
            if (status != "PASS") return Result();
            try { WriteCore(summaryJson, "none"); status = "PASS"; code = "OK"; }
            catch (NativeFault failure) { Record(failure.Code, failure.Blocked); }
            catch { Record("NATIVE_WRITE_FAILED", false); }
            return Result();
        }
        public NativeResult Close() {
            if (closed) return Result();
            try {
                // Observe the objects while ownership is still represented by
                // live handles. No post-close path lookup is called identity.
                if (status == "PASS") ValidateCore();
            } catch (NativeFault failure) { Record(failure.Code, failure.Blocked); }
            catch { Record("NATIVE_CLOSE_VALIDATION_FAILED", false); }
            foreach (HeldObject file in files.Values) if (file.Handle != null) file.Handle.Dispose();
            foreach (HeldObject fixture in fixtures) if (fixture.Handle != null) fixture.Handle.Dispose();
            if (root != null && root.Handle != null) root.Handle.Dispose();
            for (int i = ancestors.Count - 1; i >= 0; i--) ancestors[i].Handle.Dispose();
            closed = true; return Result();
        }
        void NarrowAcl(HeldObject item) {
            byte[] descriptor = Descriptor(item.Directory, true); IntPtr pointer = Marshal.AllocHGlobal(descriptor.Length);
            try {
                Marshal.Copy(descriptor, 0, pointer, descriptor.Length); bool present, defaulted; IntPtr dacl;
                if (!GetSecurityDescriptorDacl(pointer, out present, out dacl, out defaulted) || !present || dacl == IntPtr.Zero ||
                    SetSecurityInfo(item.Handle, SE_FILE_OBJECT, DACL_SECURITY | PROTECTED_DACL, IntPtr.Zero, IntPtr.Zero, dacl, IntPtr.Zero) != 0) Blocked("FIXTURE_UNAVAILABLE");
            } finally { Marshal.FreeHGlobal(pointer); }
        }
        HeldObject FixtureDirectory(string name) {
            if (name != "junction-target" && name != "junction.fixture") Fail("NAME_INVALID");
            SafeFileHandle handle = OpenChild(root.Handle, name, true, true, 0, null); counts["directoriesCreated"]++; unverified = true;
            checks["rootEntriesValid"] = false;
            HeldObject item = new HeldObject { Handle = handle, Directory = true, Name = name }; fixtures.Add(item); item.Identity = Identity(handle, true); return item;
        }
        void JunctionFixture() {
            FixtureDirectory("junction-target"); HeldObject junction = FixtureDirectory("junction.fixture");
            string print = rootPath + "\\junction-target", substitute = "\\??\\" + print;
            byte[] sub = Encoding.Unicode.GetBytes(substitute), printable = Encoding.Unicode.GetBytes(print);
            byte[] data = new byte[16 + sub.Length + 2 + printable.Length + 2];
            Buffer.BlockCopy(BitConverter.GetBytes(0xA0000003u), 0, data, 0, 4);
            Buffer.BlockCopy(BitConverter.GetBytes((ushort)(data.Length - 8)), 0, data, 4, 2);
            Buffer.BlockCopy(BitConverter.GetBytes((ushort)sub.Length), 0, data, 10, 2);
            Buffer.BlockCopy(BitConverter.GetBytes((ushort)(sub.Length + 2)), 0, data, 12, 2);
            Buffer.BlockCopy(BitConverter.GetBytes((ushort)printable.Length), 0, data, 14, 2);
            Buffer.BlockCopy(sub, 0, data, 16, sub.Length); Buffer.BlockCopy(printable, 0, data, 18 + sub.Length, printable.Length);
            uint returned; if (!DeviceIoControl(junction.Handle, 0x000900A4, data, (uint)data.Length, IntPtr.Zero, 0, out returned, IntPtr.Zero)) Blocked("FIXTURE_UNAVAILABLE");
            Identity(junction.Handle, true);
            Fail("INJECTION_FAILED");
        }
        public static FixtureResult TestFixture(string caseId) { return TestFixture(caseId, "hk-win-sink-" + Guid.NewGuid().ToString("N")); }
        public static FixtureResult TestFixture(string caseId, string reference) {
            string[] names = { "positive", "collision", "root-collision", "delete-access", "wrong-id", "root-acl-narrow", "file-acl-narrow", "unknown-entry", "reparse", "hardlink", "partial-write", "flush-failure", "read-mismatch" };
            FixtureResult answer = new FixtureResult { caseId = caseId, classification = "actual-native", status = "FAIL", expectedCode = "UNSUPPORTED_FIXTURE", observedCode = "UNSUPPORTED_FIXTURE",
                facts = new Dictionary<string, bool> { { "operationRejected", false }, { "originalContentUnchanged", false }, { "identityDifferenceObserved", false }, { "objectsRetained", true } }, result = null };
            if (Array.IndexOf(names, caseId) < 0) return answer;
            NativeSession session = Create(reference);
            Dictionary<string, string> expected = new Dictionary<string, string> {
                { "positive", "OK" }, { "collision", "NAME_COLLISION" }, { "root-collision", "NAME_COLLISION" }, { "delete-access", "DELETE_ACCESS_DENIED" }, { "wrong-id", "FILE_ID_MISMATCH" },
                { "root-acl-narrow", "ROOT_ACL_INVALID" }, { "file-acl-narrow", "FILE_ACL_INVALID" }, { "unknown-entry", "UNKNOWN_ENTRY" },
                { "reparse", "REPARSE_POINT" }, { "hardlink", "FILE_LINK_COUNT_INVALID" }, { "partial-write", "INJECTED_PARTIAL_WRITE" },
                { "flush-failure", "INJECTED_FLUSH_FAILURE" }, { "read-mismatch", "INJECTED_READ_MISMATCH" }
            };
            answer.expectedCode = expected[caseId];
            if (caseId == "partial-write" || caseId == "flush-failure" || caseId == "read-mismatch") answer.classification = "fault-injection";
            string observed = session.code;
            try {
                if (session.status != "PASS") { answer.status = session.status; answer.observedCode = session.code; return answer; }
                string summary = "{\"scope\":\"synthetic-native-fixture-only\",\"synthetic\":true}";
                if (caseId == "positive") { session.WriteCore(summary, "none"); observed = "OK"; }
                else if (caseId == "collision") {
                    session.WriteCore(summary, "none"); int nativeStatus;
                    SafeFileHandle attempt = Relative(session.root.Handle, FileNames[0], false, FILE_CREATE, FULL_CONTROL, 0, null, out nativeStatus);
                    if (attempt != null) attempt.Dispose();
                    if (attempt != null || nativeStatus != STATUS_COLLISION) Fail("INJECTION_FAILED");
                    foreach (string name in FileNames) if (!Equal(session.ReadExact(session.files[name], session.expectedBytes[name].Length), session.expectedBytes[name])) Fail("CONTENT_MISMATCH");
                    answer.facts["originalContentUnchanged"] = true; Fail("NAME_COLLISION");
                } else if (caseId == "root-collision") {
                    session.WriteCore(summary, "none");
                    NativeSession second = Create(reference);
                    NativeResult rejected;
                    try { rejected = second.Observe(); }
                    finally { second.Close(); }
                    if (rejected.status != "FAIL" || rejected.code != "NAME_COLLISION" || rejected.counts["directoriesCreated"] != 0 || rejected.counts["filesCreated"] != 0) Fail("INJECTION_FAILED");
                    session.ValidateCore();
                    foreach (string name in FileNames) if (!Equal(session.ReadExact(session.files[name], session.expectedBytes[name].Length), session.expectedBytes[name])) Fail("CONTENT_MISMATCH");
                    answer.facts["originalContentUnchanged"] = true; Fail("NAME_COLLISION");
                } else if (caseId == "delete-access") {
                    if (!session.DeleteOpenRejected(session.ancestors[session.ancestors.Count - 1].Handle, session.rootName, true)) Fail("INJECTION_FAILED");
                    Fail("DELETE_ACCESS_DENIED");
                } else if (caseId == "wrong-id") {
                    HeldObject a = session.CreateKnownFile(FileNames[0], true, 0), b = session.CreateKnownFile("other.fixture", false, 0);
                    answer.facts["identityDifferenceObserved"] = !Equal(a.Identity, b.Identity);
                    session.CheckIdentity(a, b.Identity); Fail("INJECTION_FAILED");
                } else if (caseId == "root-acl-narrow") { session.NarrowAcl(session.root); session.ValidateCore(); Fail("INJECTION_FAILED"); }
                else if (caseId == "file-acl-narrow") { HeldObject file = session.CreateKnownFile(FileNames[0], true, 0); session.NarrowAcl(file); session.ValidateCore(); Fail("INJECTION_FAILED"); }
                else if (caseId == "unknown-entry") { session.CreateKnownFile("unexpected.fixture", false, 0); session.ValidateCore(); Fail("INJECTION_FAILED"); }
                else if (caseId == "reparse") session.JunctionFixture();
                else if (caseId == "hardlink") {
                    HeldObject file = session.CreateKnownFile("hardlink.fixture", false, SHARE_ALL);
                    if (!CreateHardLinkW(session.rootPath + "\\other.fixture", session.rootPath + "\\hardlink.fixture", IntPtr.Zero)) Blocked("FIXTURE_UNAVAILABLE");
                    session.counts["filesCreated"]++;
                    session.checks["rootEntriesValid"] = false;
                    session.Identity(file.Handle, false); Fail("INJECTION_FAILED");
                } else session.WriteCore(summary, caseId);
            } catch (NativeFault failure) { observed = failure.Code; session.Record(failure.Code, failure.Blocked); if (failure.Blocked) answer.status = "BLOCKED"; }
            catch { observed = "FIXTURE_FAILED"; session.Record(observed, false); }
            finally { answer.result = session.Close(); }
            if (observed == "OK" && answer.result.code != "OK") observed = answer.result.code;
            if (answer.result.status == "BLOCKED") answer.status = "BLOCKED";
            answer.observedCode = observed;
            if (answer.status != "BLOCKED") answer.status = observed == answer.expectedCode ? "PASS" : "FAIL";
            answer.facts["operationRejected"] = caseId != "positive" && observed == answer.expectedCode;
            return answer;
        }
    }
}
