using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;

// Fixed local protocol, not an arbitrary file service. There is deliberately
// no deletion, ACL repair, file replacement or device/network operation here.
public static class SmartPmReadonlyEvidenceProtocolV1
{
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
    private const int MaximumFrameBytes = 24 * 1024 * 1024;

    public static int Run()
    {
        EvidenceStore store = new EvidenceStore();
        int expectedId = 1;
        try
        {
            using (BufferedStream input = new BufferedStream(Console.OpenStandardInput(), 65536))
            {
                Stream output = Console.OpenStandardOutput();
                while (expectedId <= 8)
                {
                    byte[] frame = ReadFrame(input);
                    if (frame == null) throw new EvidenceFault("NATIVE_EVIDENCE_INCOMPLETE");
                    Dictionary<string, object> command = FlatJson.Parse(Utf8.GetString(frame));
                    int id = Integer(command, "id");
                    if (id != expectedId) throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
                    string op = Text(command, "op");
                    if (op == "close")
                    {
                        Shape(command, new string[] { "id", "op" });
                        if (id == 1) store.Remember(new EvidenceFault("NATIVE_EVIDENCE_LIFECYCLE"));
                        string failure = store.Close();
                        Respond(output, id, failure);
                        return failure == null ? 0 : 1;
                    }
                    try
                    {
                        store.EnsureUsable();
                        if (op == "open")
                        {
                            Shape(command, new string[] { "id", "op", "baseDirectory", "reference" });
                            if (id != 1) throw new EvidenceFault("NATIVE_EVIDENCE_LIFECYCLE");
                            store.Open(Text(command, "baseDirectory"), Text(command, "reference"));
                        }
                        else if (op == "write")
                        {
                            Shape(command, new string[] { "id", "op", "role", "text" });
                            store.Write(Text(command, "role"), Text(command, "text"));
                        }
                        else if (op == "seal")
                        {
                            Shape(command, new string[] { "id", "op" });
                            store.Seal();
                        }
                        else if (op == "check")
                        {
                            Shape(command, new string[] { "id", "op" });
                            store.Check();
                        }
                        else throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
                        Respond(output, id, null);
                    }
                    catch (Exception error)
                    {
                        store.Remember(error);
                        Respond(output, id, store.Failure);
                    }
                    expectedId++;
                }
                throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
            }
        }
        catch (Exception error)
        {
            store.Remember(error);
            try { Respond(Console.OpenStandardOutput(), expectedId, store.Failure); }
            catch { /* A broken output pipe cannot become success. */ }
            return 1;
        }
        finally { store.Close(); }
    }

    private static byte[] ReadFrame(Stream input)
    {
        using (MemoryStream bytes = new MemoryStream())
        {
            while (true)
            {
                int value = input.ReadByte();
                if (value < 0)
                {
                    if (bytes.Length == 0) return null;
                    throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
                }
                if (value == 10) return bytes.ToArray();
                if (bytes.Length >= MaximumFrameBytes) throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
                bytes.WriteByte((byte)value);
            }
        }
    }

    private static void Respond(Stream output, int id, string error)
    {
        string text = "{\"id\":" + id.ToString(CultureInfo.InvariantCulture)
            + (error == null ? ",\"ok\":true}" : ",\"ok\":false,\"code\":\"" + error + "\"}") + "\n";
        byte[] bytes = Utf8.GetBytes(text);
        output.Write(bytes, 0, bytes.Length); output.Flush();
    }

    private static string Text(Dictionary<string, object> command, string key)
    {
        object value;
        if (!command.TryGetValue(key, out value) || !(value is string)) throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
        return (string)value;
    }
    private static int Integer(Dictionary<string, object> command, string key)
    {
        object value;
        if (!command.TryGetValue(key, out value) || !(value is int)) throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
        return (int)value;
    }
    private static void Shape(Dictionary<string, object> command, string[] names)
    {
        if (command.Count != names.Length) throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
        foreach (string name in names) if (!command.ContainsKey(name)) throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
    }

    private sealed class EvidenceFault : Exception
    {
        internal readonly string Code;
        internal EvidenceFault(string code) : base("Native evidence operation stopped.") { Code = code; }
    }

    // Only a flat record of strings and positive decimal integer IDs exists in
    // this protocol. Duplicate keys, arrays, nesting, nulls and booleans reject.
    private sealed class FlatJson
    {
        private readonly string text;
        private int position;
        private FlatJson(string value) { text = value; }
        internal static Dictionary<string, object> Parse(string text)
        {
            FlatJson parser = new FlatJson(text);
            Dictionary<string, object> fields = parser.Record();
            parser.Space();
            if (parser.position != text.Length) throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
            return fields;
        }
        private void Space() { while (position < text.Length && (text[position] == ' ' || text[position] == '\t' || text[position] == '\r')) position++; }
        private void Take(char expected)
        {
            Space(); if (position >= text.Length || text[position++] != expected) throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
        }
        private Dictionary<string, object> Record()
        {
            Dictionary<string, object> fields = new Dictionary<string, object>(StringComparer.Ordinal);
            Take('{'); Space();
            if (position < text.Length && text[position] == '}') { position++; return fields; }
            while (true)
            {
                string key = String(); Take(':'); Space(); object value;
                if (position < text.Length && text[position] == '"') value = String();
                else
                {
                    int start = position;
                    while (position < text.Length && text[position] >= '0' && text[position] <= '9') position++;
                    string number = text.Substring(start, position - start); int parsed;
                    if (number.Length == 0 || number.Length > 2 || number[0] == '0' || !Int32.TryParse(number, NumberStyles.None, CultureInfo.InvariantCulture, out parsed)) throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
                    value = parsed;
                }
                if (fields.ContainsKey(key)) throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
                fields.Add(key, value); Space();
                if (position >= text.Length) throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
                char next = text[position++]; if (next == '}') return fields;
                if (next != ',') throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
            }
        }
        private string String()
        {
            Take('"'); StringBuilder value = new StringBuilder();
            while (position < text.Length)
            {
                char current = text[position++];
                if (current == '"') { string result = value.ToString(); Utf8.GetByteCount(result); return result; }
                if (current < 0x20) throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
                if (current != '\\') { value.Append(current); continue; }
                if (position >= text.Length) throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
                char escaped = text[position++];
                if (escaped == '"' || escaped == '\\' || escaped == '/') value.Append(escaped);
                else if (escaped == 'b') value.Append('\b');
                else if (escaped == 'f') value.Append('\f');
                else if (escaped == 'n') value.Append('\n');
                else if (escaped == 'r') value.Append('\r');
                else if (escaped == 't') value.Append('\t');
                else if (escaped == 'u')
                {
                    if (position + 4 > text.Length) throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
                    int code = 0;
                    for (int index = 0; index < 4; index++)
                    {
                        char digit = text[position++]; int hex = digit >= '0' && digit <= '9' ? digit - '0' : digit >= 'a' && digit <= 'f' ? digit - 'a' + 10 : digit >= 'A' && digit <= 'F' ? digit - 'A' + 10 : -1;
                        if (hex < 0) throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
                        code = code * 16 + hex;
                    }
                    value.Append((char)code);
                }
                else throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
            }
            throw new EvidenceFault("NATIVE_EVIDENCE_PROTOCOL");
        }
    }

    private sealed class Held
    {
        internal string Path;
        internal IntPtr Handle;
        internal Native.FileInformation Identity;
        internal bool Directory;
        internal bool Private;
        internal byte[] Bytes;
        internal bool Written;
        internal string Role;
    }

    private sealed class EvidenceStore
    {
        private readonly List<Held> held = new List<Held>();
        private readonly Dictionary<string, Held> files = new Dictionary<string, Held>(StringComparer.Ordinal);
        private readonly string user = WindowsIdentity.GetCurrent().User.Value;
        private IntPtr descriptor = IntPtr.Zero;
        private Held directory;
        private string reference;
        private bool opened, sealedStore, closed;
        private int nextRole;
        internal string Failure { get; private set; }
        private static readonly string[] Roles = new string[] { "stdout", "stderr", "main-exit" };
        private static readonly string[] Names = new string[] { "stdout.jsonl", "stderr.txt", "main-exit.txt" };

        internal void Remember(Exception error)
        {
            if (Failure != null) return;
            EvidenceFault failure = error as EvidenceFault;
            Failure = failure == null ? "NATIVE_EVIDENCE_IO" : failure.Code;
        }
        internal void EnsureUsable()
        {
            if (Failure != null) throw new EvidenceFault(Failure);
            if (closed) throw new EvidenceFault("NATIVE_EVIDENCE_LIFECYCLE");
        }
        internal void Open(string suppliedBase, string suppliedReference)
        {
            EnsureUsable();
            if (opened || held.Count != 0 || directory != null) throw new EvidenceFault("NATIVE_EVIDENCE_LIFECYCLE");
            if (!Regex.IsMatch(suppliedReference, "\\A[A-Za-z0-9][A-Za-z0-9_-]{0,63}\\z", RegexOptions.CultureInvariant) || Reserved(suppliedReference)) throw new EvidenceFault("NATIVE_EVIDENCE_PATH");
            string basePath = ValidateBase(suppliedBase);
            reference = suppliedReference;
            string root = System.IO.Path.GetPathRoot(basePath);
            StringBuilder system = new StringBuilder(64);
            uint serial, maximumComponent, flags;
            if (Native.GetDriveType(root) != 3 || !Native.GetVolumeInformation(root, null, 0, out serial, out maximumComponent, out flags, system, system.Capacity)
                || !String.Equals(system.ToString(), "NTFS", StringComparison.OrdinalIgnoreCase)) throw new EvidenceFault("NATIVE_EVIDENCE_FILE_SYSTEM");
            HoldAncestor(root);
            string remainder = basePath.Substring(root.Length);
            string current = root;
            if (remainder.Length > 0) foreach (string part in remainder.Split('\\')) { current = System.IO.Path.Combine(current, part); HoldAncestor(current); }
            ValidateAll();
            string destination = System.IO.Path.Combine(basePath, reference);
            if (destination.Length + 24 > 259) throw new EvidenceFault("NATIVE_EVIDENCE_PATH");
            string sddl = "O:" + user + "D:P(A;;FA;;;" + user + ")(A;;FA;;;SY)";
            uint descriptorSize;
            if (!Native.ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out descriptor, out descriptorSize)) throw new EvidenceFault("NATIVE_EVIDENCE_ACL");
            // FILE_CREATE returns the new object and its handle together.
            // No CreateDirectory(path) -> reopen(path) identity gap exists.
            Held parent = held[held.Count - 1];
            directory = CreateRelative(parent, reference, destination, true, null);
            ValidateAll();
            for (int index = 0; index < Roles.Length; index++)
            {
                Held file = CreateFile(Names[index], Roles[index]); files.Add(Roles[index], file); ValidateAll();
            }
            opened = true; ValidateAll();
        }

        private string ValidateBase(string supplied)
        {
            if (String.IsNullOrEmpty(supplied) || supplied.Length > 230 || !String.Equals(supplied, supplied.Trim(), StringComparison.Ordinal)) throw new EvidenceFault("NATIVE_EVIDENCE_PATH");
            string path = supplied.Replace('/', '\\');
            if (path.Length < 3 || !Char.IsLetter(path[0]) || path[1] != ':' || path[2] != '\\' || path.StartsWith("\\\\", StringComparison.Ordinal)) throw new EvidenceFault("NATIVE_EVIDENCE_PATH");
            for (int index = 0; index < path.Length; index++) if (path[index] < 0x20 || path[index] == '"' || path[index] == '<' || path[index] == '>' || path[index] == '|' || path[index] == '?' || path[index] == '*' || path[index] == ':' && index != 1) throw new EvidenceFault("NATIVE_EVIDENCE_PATH");
            if (path.Length > 3) path = path.TrimEnd('\\');
            string full = System.IO.Path.GetFullPath(path);
            if (!String.Equals(full, path, StringComparison.OrdinalIgnoreCase)) throw new EvidenceFault("NATIVE_EVIDENCE_PATH");
            string tail = full.Substring(3);
            if (tail.Length > 0) foreach (string part in tail.Split('\\')) if (part.Length == 0 || part == "." || part == ".." || part.EndsWith(".", StringComparison.Ordinal) || part.EndsWith(" ", StringComparison.Ordinal) || Reserved(part)) throw new EvidenceFault("NATIVE_EVIDENCE_PATH");
            return full;
        }
        private static bool Reserved(string name)
        {
            string stem = name.Split('.')[0].ToUpperInvariant();
            return stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" || Regex.IsMatch(stem, "\\A(?:COM|LPT)[1-9]\\z", RegexOptions.CultureInvariant);
        }
        private void HoldAncestor(string path) { Hold(path, true, false, false); }
        private Held Hold(string path, bool isDirectory, bool isPrivate, bool writable)
        {
            uint access = Native.FileReadAttributes | (isPrivate ? Native.ReadControl : 0) | (writable ? Native.GenericRead | Native.GenericWrite : 0);
            // Ancestors permit ordinary concurrent writes but cannot be
            // renamed through a delete-sharing handle while this one lives.
            uint share = isPrivate ? Native.ShareRead : Native.ShareRead | Native.ShareWrite;
            IntPtr handle = Native.CreateFileExisting(path, access, share, IntPtr.Zero, 3, Native.OpenReparsePoint | (isDirectory ? Native.BackupSemantics : 0), IntPtr.Zero);
            if (handle == Native.Invalid) throw new EvidenceFault("NATIVE_EVIDENCE_IDENTITY");
            Held item = new Held { Path = path, Handle = handle, Directory = isDirectory, Private = isPrivate, Bytes = isDirectory ? null : new byte[0] };
            held.Add(item);
            if (!Native.GetFileInformationByHandle(handle, out item.Identity)) throw new EvidenceFault("NATIVE_EVIDENCE_IDENTITY");
            Validate(item); return item;
        }
        private Held CreateFile(string name, string role)
        {
            string path = System.IO.Path.Combine(directory.Path, name);
            return CreateRelative(directory, name, path, false, role);
        }
        private Held CreateRelative(Held parent, string name, string path, bool isDirectory, string role)
        {
            IntPtr text = IntPtr.Zero, unicode = IntPtr.Zero, handle = IntPtr.Zero;
            try
            {
                text = Marshal.StringToHGlobalUni(name);
                Native.UnicodeString value = new Native.UnicodeString { Length = (ushort)(name.Length * 2), MaximumLength = (ushort)(name.Length * 2 + 2), Buffer = text };
                unicode = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Native.UnicodeString))); Marshal.StructureToPtr(value, unicode, false);
                Native.ObjectAttributes attributes = new Native.ObjectAttributes {
                    Length = Marshal.SizeOf(typeof(Native.ObjectAttributes)), RootDirectory = parent.Handle, ObjectName = unicode,
                    Attributes = 0x40 | 0x1000, SecurityDescriptor = descriptor, SecurityQualityOfService = IntPtr.Zero
                };
                Native.IoStatusBlock io;
                uint access = Native.FileReadAttributes | Native.ReadControl | 0x100000U | (isDirectory ? 0x20U : Native.GenericRead | Native.GenericWrite);
                uint options = 0x20U | (isDirectory ? 0x1U : 0x40U | 0x200000U);
                int status = Native.NtCreateFile(out handle, access, ref attributes, out io, IntPtr.Zero, isDirectory ? 0x10U : 0x80U,
                    Native.ShareRead, 2, options, IntPtr.Zero, 0);
                if (status < 0)
                {
                    uint code = unchecked((uint)status);
                    throw new EvidenceFault(code == 0xc0000035U ? "NATIVE_EVIDENCE_EXISTS" : code == 0xc000050bU ? "NATIVE_EVIDENCE_REPARSE" : "NATIVE_EVIDENCE_IO");
                }
                if (handle == IntPtr.Zero || handle == Native.Invalid || io.Information.ToUInt64() != 2) throw new EvidenceFault("NATIVE_EVIDENCE_IDENTITY");
                Held item = new Held { Path = path, Handle = handle, Directory = isDirectory, Private = true, Bytes = isDirectory ? null : new byte[0], Role = role };
                held.Add(item); handle = IntPtr.Zero;
                if (!Native.GetFileInformationByHandle(item.Handle, out item.Identity)) throw new EvidenceFault("NATIVE_EVIDENCE_IDENTITY");
                Validate(item); return item;
            }
            finally
            {
                if (handle != IntPtr.Zero && handle != Native.Invalid) Native.CloseHandle(handle);
                if (unicode != IntPtr.Zero) Marshal.FreeHGlobal(unicode);
                if (text != IntPtr.Zero) Marshal.FreeHGlobal(text);
            }
        }
        private void Validate(Held item)
        {
            Native.FileInformation actual;
            if (item.Handle == IntPtr.Zero || !Native.GetFileInformationByHandle(item.Handle, out actual)) throw new EvidenceFault("NATIVE_EVIDENCE_IDENTITY");
            if ((actual.Attributes & 0x400) != 0) throw new EvidenceFault("NATIVE_EVIDENCE_REPARSE");
            if (((actual.Attributes & 0x10) != 0) != item.Directory || actual.VolumeSerialNumber != item.Identity.VolumeSerialNumber
                || actual.FileIndexHigh != item.Identity.FileIndexHigh || actual.FileIndexLow != item.Identity.FileIndexLow) throw new EvidenceFault("NATIVE_EVIDENCE_IDENTITY");
            if (!item.Directory && (actual.NumberOfLinks != 1 || (((ulong)actual.FileSizeHigh << 32) | actual.FileSizeLow) != (ulong)item.Bytes.Length)) throw new EvidenceFault("NATIVE_EVIDENCE_IDENTITY");
            if (item.Private) ValidateAcl(item.Handle);
            // Reopening only for attributes observes the directory entry; it
            // does not reopen data for writing or follow a reparse point.
            IntPtr observed = Native.CreateFileExisting(item.Path, Native.FileReadAttributes, Native.ShareRead | Native.ShareWrite | Native.ShareDelete, IntPtr.Zero, 3,
                Native.OpenReparsePoint | (item.Directory ? Native.BackupSemantics : 0), IntPtr.Zero);
            if (observed == Native.Invalid) throw new EvidenceFault("NATIVE_EVIDENCE_IDENTITY");
            try
            {
                Native.FileInformation byPath;
                if (!Native.GetFileInformationByHandle(observed, out byPath) || (byPath.Attributes & 0x400) != 0 || byPath.VolumeSerialNumber != actual.VolumeSerialNumber
                    || byPath.FileIndexHigh != actual.FileIndexHigh || byPath.FileIndexLow != actual.FileIndexLow) throw new EvidenceFault("NATIVE_EVIDENCE_IDENTITY");
            }
            finally { if (!Native.CloseHandle(observed)) throw new EvidenceFault("NATIVE_EVIDENCE_CLOSE"); }
        }
        private void ValidateAcl(IntPtr handle)
        {
            IntPtr owner, group, dacl, sacl, security;
            uint error = Native.GetSecurityInfo(handle, 1, 1 | 4, out owner, out group, out dacl, out sacl, out security);
            if (error != 0 || security == IntPtr.Zero) throw new EvidenceFault("NATIVE_EVIDENCE_ACL");
            try
            {
                uint length = Native.GetSecurityDescriptorLength(security);
                if (length == 0 || length > 65536) throw new EvidenceFault("NATIVE_EVIDENCE_ACL");
                byte[] bytes = new byte[(int)length]; Marshal.Copy(security, bytes, 0, bytes.Length);
                RawSecurityDescriptor parsed = new RawSecurityDescriptor(bytes, 0);
                if (parsed.Owner == null || parsed.Owner.Value != user || parsed.DiscretionaryAcl == null
                    || (parsed.ControlFlags & ControlFlags.DiscretionaryAclProtected) == 0 || (parsed.ControlFlags & ControlFlags.DiscretionaryAclPresent) == 0
                    || parsed.DiscretionaryAcl.Count != 2) throw new EvidenceFault("NATIVE_EVIDENCE_ACL");
                bool userSeen = false, systemSeen = false;
                foreach (GenericAce generic in parsed.DiscretionaryAcl)
                {
                    CommonAce ace = generic as CommonAce;
                    if (ace == null || ace.AceQualifier != AceQualifier.AccessAllowed || ace.AceFlags != AceFlags.None || ace.AccessMask != 0x1f01ff || ace.IsCallback) throw new EvidenceFault("NATIVE_EVIDENCE_ACL");
                    if (ace.SecurityIdentifier.Value == user) userSeen = true;
                    else if (ace.SecurityIdentifier.Value == "S-1-5-18") systemSeen = true;
                    else throw new EvidenceFault("NATIVE_EVIDENCE_ACL");
                }
                if (!userSeen || !systemSeen) throw new EvidenceFault("NATIVE_EVIDENCE_ACL");
            }
            finally { Native.LocalFree(security); }
        }
        private void ValidateAll()
        {
            foreach (Held item in held) Validate(item);
            if (directory == null) return;
            HashSet<string> expected = new HashSet<string>(StringComparer.Ordinal);
            foreach (Held item in held) if (!item.Directory && item.Private) expected.Add(System.IO.Path.GetFileName(item.Path));
            string[] entries = System.IO.Directory.GetFileSystemEntries(directory.Path);
            if (entries.Length != expected.Count) throw new EvidenceFault("NATIVE_EVIDENCE_IDENTITY");
            foreach (string entry in entries) if (!expected.Contains(System.IO.Path.GetFileName(entry))) throw new EvidenceFault("NATIVE_EVIDENCE_IDENTITY");
        }
        internal void Write(string role, string text)
        {
            EnsureUsable(); Held item;
            if (!opened || sealedStore || nextRole >= Roles.Length || role != Roles[nextRole] || !files.TryGetValue(role, out item) || item.Written) throw new EvidenceFault("NATIVE_EVIDENCE_LIFECYCLE");
            if (role == "main-exit" && text != "0\n" && text != "2\n" && text != "4\n" && text != "5\n") throw new EvidenceFault("NATIVE_EVIDENCE_CONTENT");
            byte[] bytes = Utf8.GetBytes(text);
            if (bytes.Length > 8 * 1024 * 1024) throw new EvidenceFault("NATIVE_EVIDENCE_CONTENT");
            ValidateAll(); WriteBytes(item, bytes); item.Written = true; nextRole++; ValidateAll();
        }
        internal void Check()
        {
            EnsureUsable();
            if (!opened || sealedStore) throw new EvidenceFault("NATIVE_EVIDENCE_LIFECYCLE");
            ValidateAll();
        }
        private void WriteBytes(Held item, byte[] bytes)
        {
            long position;
            if (!Native.SetFilePointerEx(item.Handle, 0, out position, 0) || position != 0) throw new EvidenceFault("NATIVE_EVIDENCE_IO");
            uint written;
            if (!Native.WriteFile(item.Handle, bytes, (uint)bytes.Length, out written, IntPtr.Zero) || written != bytes.Length) throw new EvidenceFault("NATIVE_EVIDENCE_IO");
            item.Bytes = bytes;
            if (!Native.FlushFileBuffers(item.Handle)) throw new EvidenceFault("NATIVE_EVIDENCE_IO");
            Validate(item); VerifyContent(item);
        }
        private string VerifyContent(Held item)
        {
            long position;
            if (!Native.SetFilePointerEx(item.Handle, 0, out position, 0) || position != 0) throw new EvidenceFault("NATIVE_EVIDENCE_IO");
            byte[] bytes = new byte[item.Bytes.Length]; int offset = 0;
            while (offset < bytes.Length)
            {
                byte[] chunk = new byte[Math.Min(65536, bytes.Length - offset)]; uint count;
                if (!Native.ReadFile(item.Handle, chunk, (uint)chunk.Length, out count, IntPtr.Zero) || count == 0) throw new EvidenceFault("NATIVE_EVIDENCE_CONTENT");
                Buffer.BlockCopy(chunk, 0, bytes, offset, (int)count); offset += (int)count;
            }
            byte[] extra = new byte[1]; uint more;
            if (!Native.ReadFile(item.Handle, extra, 1, out more, IntPtr.Zero) || more != 0) throw new EvidenceFault("NATIVE_EVIDENCE_CONTENT");
            using (SHA256 algorithm = SHA256.Create())
            {
                string actual = Hex(algorithm.ComputeHash(bytes));
                if (actual != Hex(algorithm.ComputeHash(item.Bytes))) throw new EvidenceFault("NATIVE_EVIDENCE_CONTENT");
                return actual;
            }
        }
        private static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
        internal void Seal()
        {
            EnsureUsable();
            if (!opened || sealedStore) throw new EvidenceFault("NATIVE_EVIDENCE_LIFECYCLE");
            ValidateAll();
            StringBuilder manifest = new StringBuilder("{\"schemaVersion\":1,\"reference\":\"" + reference + "\",\"kind\":\"candidate-only\",\"finalResultRequired\":true,\"files\":[");
            for (int index = 0; index < Roles.Length; index++)
            {
                Held item = files[Roles[index]];
                if (!item.Written) throw new EvidenceFault("NATIVE_EVIDENCE_LIFECYCLE");
                if (!Native.FlushFileBuffers(item.Handle)) throw new EvidenceFault("NATIVE_EVIDENCE_IO");
                string sha = VerifyContent(item);
                if (index > 0) manifest.Append(',');
                manifest.Append("{\"role\":\"").Append(Roles[index]).Append("\",\"file\":\"").Append(Names[index]).Append("\",\"bytes\":")
                    .Append(item.Bytes.Length.ToString(CultureInfo.InvariantCulture)).Append(",\"sha256\":\"").Append(sha).Append("\"}");
            }
            manifest.Append("]}\n");
            Held seal = CreateFile("candidate-seal.json", "candidate-seal");
            WriteBytes(seal, Utf8.GetBytes(manifest.ToString())); seal.Written = true;
            ValidateAll(); sealedStore = true;
        }
        internal string Close()
        {
            if (closed) return Failure;
            try
            {
                ValidateAll();
                foreach (Held item in held) if (!item.Directory)
                {
                    if (!Native.FlushFileBuffers(item.Handle)) throw new EvidenceFault("NATIVE_EVIDENCE_IO");
                    VerifyContent(item);
                }
            }
            catch (Exception error) { Remember(error); }
            finally
            {
                for (int index = held.Count - 1; index >= 0; index--)
                {
                    Held item = held[index];
                    if (item.Handle != IntPtr.Zero)
                    {
                        if (!Native.CloseHandle(item.Handle)) Remember(new EvidenceFault("NATIVE_EVIDENCE_CLOSE"));
                        item.Handle = IntPtr.Zero;
                    }
                }
                if (descriptor != IntPtr.Zero) { Native.LocalFree(descriptor); descriptor = IntPtr.Zero; }
                closed = true;
            }
            return Failure;
        }
    }

    private static class Native
    {
        internal static readonly IntPtr Invalid = new IntPtr(-1);
        internal const uint GenericRead = 0x80000000, GenericWrite = 0x40000000, FileReadAttributes = 0x80, ReadControl = 0x20000;
        internal const uint ShareRead = 1, ShareWrite = 2, ShareDelete = 4, BackupSemantics = 0x02000000, OpenReparsePoint = 0x00200000;
        [StructLayout(LayoutKind.Sequential)] internal struct UnicodeString { internal ushort Length, MaximumLength; internal IntPtr Buffer; }
        [StructLayout(LayoutKind.Sequential)] internal struct ObjectAttributes
        {
            internal int Length; internal IntPtr RootDirectory, ObjectName; internal uint Attributes; internal IntPtr SecurityDescriptor, SecurityQualityOfService;
        }
        [StructLayout(LayoutKind.Sequential)] internal struct IoStatusBlock { internal IntPtr Status; internal UIntPtr Information; }
        [StructLayout(LayoutKind.Sequential)] internal struct FileTime { internal uint Low; internal uint High; }
        [StructLayout(LayoutKind.Sequential)] internal struct FileInformation
        {
            internal uint Attributes; internal FileTime CreationTime; internal FileTime LastAccessTime; internal FileTime LastWriteTime;
            internal uint VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow;
        }
        [DllImport("ntdll.dll", ExactSpelling = true)] internal static extern int NtCreateFile(out IntPtr handle, uint desiredAccess, ref ObjectAttributes attributes, out IoStatusBlock ioStatus,
            IntPtr allocationSize, uint fileAttributes, uint shareAccess, uint disposition, uint options, IntPtr eaBuffer, uint eaLength);
        [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr CreateFileExisting(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetFileInformationByHandle(IntPtr handle, out FileInformation information);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool FlushFileBuffers(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetFilePointerEx(IntPtr handle, long distance, out long newPosition, uint method);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool WriteFile(IntPtr handle, byte[] buffer, uint length, out uint written, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool ReadFile(IntPtr handle, byte[] buffer, uint length, out uint read, IntPtr overlapped);
        [DllImport("kernel32.dll", EntryPoint = "GetDriveTypeW", CharSet = CharSet.Unicode)] internal static extern uint GetDriveType(string root);
        [DllImport("kernel32.dll", EntryPoint = "GetVolumeInformationW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetVolumeInformation(string root, StringBuilder volumeName, int volumeNameSize, out uint serial, out uint maximumComponentLength, out uint flags, StringBuilder fileSystem, int fileSystemSize);
        [DllImport("advapi32.dll", EntryPoint = "ConvertStringSecurityDescriptorToSecurityDescriptorW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text, uint revision, out IntPtr descriptor, out uint size);
        [DllImport("advapi32.dll", SetLastError = true)] internal static extern uint GetSecurityInfo(IntPtr handle, uint type, uint information, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
        [DllImport("advapi32.dll", SetLastError = true)] internal static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
        [DllImport("kernel32.dll")] internal static extern IntPtr LocalFree(IntPtr pointer);
    }
}
