using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

// Private pipe protocol only: stdout must never be copied to public logs.
// FlatJson, UTF-8, canonical base64, quoting and frame algorithms are copied
// from tools/hikvision-readonly-input/WindowsReadonlyInput.cs at source commit
// 1ebb86ea53872090a2bfcab89d1071538c221206 (blob
// ffb10323d00cf95938ff395ac10443837e1715d6). The old helper is unchanged.
// Synthetic mode uses only the supplied synthetic seed and the same native
// controls/events as interactive mode. Neither mode reads credential files,
// environment credentials, device data, or a network connection.
public static class SmartPmWindowsReadonlyInteractiveV1
{
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
    private const int MaximumFrameBytes = 128 * 1024;
    private const int MaximumSeedBytes = 49152;
    private static readonly string[] SeedKeys = new string[] {
        "origin", "username", "password", "certificateBase64", "expectedModel",
        "planTemplateNo", "expectedSpkiPin", "expectedSerialNumber",
        "expectedPlanFingerprint", "expectedCount", "targetEmployeeNo", "targetFDID",
        "developmentTls"
    };
    private static readonly string[] ViewKeys = new string[] {
        "protocolVersion", "mode", "operation", "expectedModel", "planTemplateNo",
        "expectedCount", "targetEmployeeNo", "targetFaceLibType", "targetFDID"
    };
    private static readonly string[] SyntheticActions = new string[] {
        "approve", "reject", "unchecked-approve", "check-uncheck", "review-cancel",
        "review-close", "review-none", "capture-cancel", "capture-close", "double-approve"
    };

    public static int Run()
    {
        if (Environment.OSVersion.Platform != PlatformID.Win32NT || Thread.CurrentThread.GetApartmentState() != ApartmentState.STA)
        {
            Console.Error.WriteLine("WINDOWS_INPUT_RUNTIME");
            return 1;
        }
        InputSession session = new InputSession();
        int expectedId = 1;
        try
        {
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (BufferedStream input = new BufferedStream(Console.OpenStandardInput(), 16384))
            {
                Stream output = Console.OpenStandardOutput();
                while (expectedId <= 3)
                {
                    byte[] frame = null;
                    Dictionary<string, object> command = null;
                    try
                    {
                        frame = ReadFrame(input);
                        if (frame == null) throw new InputFault("WINDOWS_INPUT_INCOMPLETE");
                        command = FlatJson.Parse(Utf8.GetString(frame));
                        int id = Integer(command, "id");
                        if (id != expectedId) throw new InputFault("WINDOWS_INPUT_PROTOCOL");
                        string op = Text(command, "op");
                        if (op == "close")
                        {
                            Shape(command, new string[] { "id", "op" }, "WINDOWS_INPUT_PROTOCOL");
                            if (id != 3 || !session.Reviewed) session.Remember(new InputFault("WINDOWS_INPUT_STATE"));
                            session.Close();
                            Respond(output, id, session.Failure, null);
                            return session.Failure == null ? 0 : 1;
                        }
                        try
                        {
                            session.EnsureUsable();
                            string response;
                            if (op == "capture")
                            {
                                if (id != 1) throw new InputFault("WINDOWS_INPUT_STATE");
                                response = session.Capture(command);
                            }
                            else if (op == "review")
                            {
                                Shape(command, new string[] { "id", "op", "captureId", "challenge", "reference", "viewBase64" }, "WINDOWS_INPUT_PROTOCOL");
                                if (id != 2) throw new InputFault("WINDOWS_INPUT_STATE");
                                response = session.Review(command);
                            }
                            else throw new InputFault("WINDOWS_INPUT_PROTOCOL");
                            Respond(output, id, null, response);
                        }
                        catch (Exception error)
                        {
                            session.Remember(error);
                            Respond(output, id, session.Failure, null);
                        }
                        expectedId++;
                    }
                    finally
                    {
                        Clear(frame);
                        if (command != null) command.Clear();
                    }
                }
                throw new InputFault("WINDOWS_INPUT_PROTOCOL");
            }
        }
        catch (Exception error)
        {
            session.Remember(error);
            try { Respond(Console.OpenStandardOutput(), expectedId, session.Failure, null); }
            catch { /* A broken private pipe cannot become success. */ }
            return 1;
        }
        finally { session.Close(); }
    }

    private static void Clear(byte[] bytes) { if (bytes != null) Array.Clear(bytes, 0, bytes.Length); }
    private static byte[] ReadFrame(Stream input)
    {
        using (MemoryStream bytes = new MemoryStream())
        {
            try
            {
                while (true)
                {
                    int value = input.ReadByte();
                    if (value < 0)
                    {
                        if (bytes.Length == 0) return null;
                        Utf8.GetCharCount(bytes.GetBuffer(), 0, (int)bytes.Length);
                        throw new InputFault("WINDOWS_INPUT_PROTOCOL");
                    }
                    if (value == 10) return bytes.ToArray();
                    if (bytes.Length >= MaximumFrameBytes) throw new InputFault("WINDOWS_INPUT_TOO_LARGE");
                    bytes.WriteByte((byte)value);
                }
            }
            finally { Array.Clear(bytes.GetBuffer(), 0, (int)bytes.Length); }
        }
    }
    private static void Respond(Stream output, int id, string error, string fields)
    {
        string response = "{\"id\":" + id.ToString(CultureInfo.InvariantCulture)
            + (error == null ? ",\"ok\":true" + (fields ?? "") + "}" : ",\"ok\":false,\"code\":" + Quote(error) + "}") + "\n";
        byte[] bytes = Utf8.GetBytes(response);
        try { output.Write(bytes, 0, bytes.Length); output.Flush(); }
        finally { Clear(bytes); }
    }
    private static string Quote(string value)
    {
        StringBuilder result = new StringBuilder("\"");
        foreach (char character in value)
        {
            if (character == '"' || character == '\\') result.Append('\\').Append(character);
            else if (character < 0x20 || character > 0x7e) result.Append("\\u").Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
            else result.Append(character);
        }
        return result.Append('"').ToString();
    }
    private static string Text(Dictionary<string, object> value, string key)
    {
        object item;
        if (!value.TryGetValue(key, out item) || !(item is string)) throw new InputFault("WINDOWS_INPUT_PROTOCOL");
        return (string)item;
    }
    private static int Integer(Dictionary<string, object> value, string key)
    {
        object item;
        if (!value.TryGetValue(key, out item) || !(item is int)) throw new InputFault("WINDOWS_INPUT_PROTOCOL");
        return (int)item;
    }
    private static void Shape(Dictionary<string, object> value, string[] keys, string error)
    {
        if (value.Count != keys.Length) throw new InputFault(error);
        foreach (string key in keys) if (!value.ContainsKey(key)) throw new InputFault(error);
    }
    private static byte[] Decode(string source, int maximum)
    {
        if (source.Length > ((maximum + 2) / 3) * 4 || !Regex.IsMatch(source, "\\A(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?\\z", RegexOptions.CultureInvariant)) throw new InputFault("WINDOWS_INPUT_PROTOCOL");
        byte[] bytes;
        try { bytes = Convert.FromBase64String(source); }
        catch { throw new InputFault("WINDOWS_INPUT_PROTOCOL"); }
        try
        {
            if (bytes.Length > maximum) throw new InputFault("WINDOWS_INPUT_TOO_LARGE");
            if (!String.Equals(Convert.ToBase64String(bytes), source, StringComparison.Ordinal)) throw new InputFault("WINDOWS_INPUT_PROTOCOL");
            Utf8.GetCharCount(bytes);
            return bytes;
        }
        catch { Clear(bytes); throw; }
    }
    private static bool Nonce(string value) { return Regex.IsMatch(value, "\\A[a-f0-9]{32}\\z", RegexOptions.CultureInvariant); }
    private static bool SafeText(string value, int maximum)
    {
        if (value.Length == 0 || value.Length > maximum) return false;
        foreach (char character in value) if (character < 0x20 || character == 0x7f) return false;
        return true;
    }
    private static void RunWindow(Form form)
    {
        // Show makes native child controls selectable; a hidden/unshown form
        // would cause Button.PerformClick to skip its real Click event.
        form.Show();
        using (ApplicationContext context = new ApplicationContext(form)) Application.Run(context);
    }
    private static Dictionary<string, object> View(byte[] bytes, InputSnapshot captured)
    {
        Dictionary<string, object> fields = FlatJson.Parse(Utf8.GetString(bytes));
        Shape(fields, ViewKeys, "WINDOWS_INPUT_REVIEW");
        int count = Integer(fields, "expectedCount");
        if (Integer(fields, "protocolVersion") != 1 || Text(fields, "mode") != "readonly"
            || Text(fields, "operation") != "list" || Text(fields, "targetFaceLibType") != "blackFD"
            || count < 1 || count > 1000 || !SafeText(Text(fields, "expectedModel"), 128)
            || !SafeText(Text(fields, "planTemplateNo"), 32) || !SafeText(Text(fields, "targetEmployeeNo"), 32)
            || !SafeText(Text(fields, "targetFDID"), 64)) throw new InputFault("WINDOWS_INPUT_REVIEW");
        if (!String.Equals(Text(fields, "expectedModel"), captured.Get("expectedModel"), StringComparison.Ordinal)
            || !String.Equals(Text(fields, "planTemplateNo"), captured.Get("planTemplateNo"), StringComparison.Ordinal)
            || count != captured.ExpectedCount
            || !String.Equals(Text(fields, "targetEmployeeNo"), captured.Get("targetEmployeeNo"), StringComparison.Ordinal)
            || !String.Equals(Text(fields, "targetFDID"), captured.Get("targetFDID"), StringComparison.Ordinal)) throw new InputFault("WINDOWS_INPUT_BINDING");
        return fields;
    }

    private sealed class InputFault : Exception
    {
        internal readonly string Code;
        internal InputFault(string code) : base("Windows private input stopped.") { Code = code; }
    }
    private sealed class InputSnapshot
    {
        private readonly Dictionary<string, string> values;
        internal readonly int ExpectedCount;
        internal readonly bool DevelopmentTls;
        internal InputSnapshot(Dictionary<string, string> fields, bool developmentTls)
        {
            values = fields;
            DevelopmentTls = developmentTls;
            int count;
            string raw = Get("expectedCount");
            if (!Regex.IsMatch(raw, "\\A[1-9][0-9]{0,3}\\z", RegexOptions.CultureInvariant)
                || !Int32.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out count) || count > 1000)
                throw new InputFault("WINDOWS_INPUT_EXPECTATIONS");
            ExpectedCount = count;
        }
        internal string Get(string key) { return values[key]; }
        internal byte[] InputBytes()
        {
            string json = "{\"operation\":\"list\",\"mode\":\"offline\",\"config\":{\"mode\":\"device\",\"origin\":" + Quote(Get("origin"))
                + ",\"username\":" + Quote(Get("username")) + ",\"password\":" + Quote(Get("password"))
                + ",\"certificateBase64\":" + Quote(Get("certificateBase64")) + ",\"developmentTls\":" + (DevelopmentTls ? "true" : "false")
                + ",\"planTemplateNo\":" + Quote(Get("planTemplateNo")) + "},\"options\":{\"expectedModel\":" + Quote(Get("expectedModel"))
                + ",\"planTemplateNo\":" + Quote(Get("planTemplateNo")) + ",\"maxRequests\":256,\"totalTimeoutMs\":120000,\"requestTimeoutMs\":5000}}";
            return BoundedBytes(json, 32768);
        }
        internal byte[] ExpectationBytes()
        {
            string json = "{\"expectedSpkiPin\":" + Quote(Get("expectedSpkiPin")) + ",\"expectedSerialNumber\":" + Quote(Get("expectedSerialNumber"))
                + ",\"expectedPlanFingerprint\":" + Quote(Get("expectedPlanFingerprint")) + ",\"expectedCount\":" + ExpectedCount.ToString(CultureInfo.InvariantCulture)
                + ",\"targetEmployeeNo\":" + Quote(Get("targetEmployeeNo")) + ",\"targetFDID\":" + Quote(Get("targetFDID")) + "}";
            return BoundedBytes(json, 8192);
        }
        private static byte[] BoundedBytes(string value, int maximum)
        {
            // Original control strings were strictly checked in Submit before
            // quoting; validate and bound the resulting serialized UTF-8 too.
            Utf8.GetByteCount(value);
            byte[] bytes = Utf8.GetBytes(value);
            if (bytes.Length <= maximum) return bytes;
            Clear(bytes);
            throw new InputFault("WINDOWS_INPUT_TOO_LARGE");
        }
        internal void ClearValues() { values.Clear(); }
    }
    private sealed class InputSession
    {
        private byte[] input, expectations;
        private InputSnapshot snapshot;
        private string captureId, syntheticAction, challenge, reference, viewBase64;
        private bool captured, closed, synthetic;
        internal bool Reviewed { get; private set; }
        internal string Failure { get; private set; }
        internal void Remember(Exception error)
        {
            if (Failure != null) return;
            InputFault known = error as InputFault;
            Failure = known != null ? known.Code : error is DecoderFallbackException || error is EncoderFallbackException
                ? "WINDOWS_INPUT_UTF8" : "WINDOWS_INPUT_FAILURE";
        }
        internal void EnsureUsable()
        {
            if (Failure != null) throw new InputFault(Failure);
            if (closed) throw new InputFault("WINDOWS_INPUT_STATE");
        }
        internal string Capture(Dictionary<string, object> command)
        {
            EnsureUsable();
            if (captured || snapshot != null || input != null || expectations != null) throw new InputFault("WINDOWS_INPUT_STATE");
            string mode = Text(command, "mode");
            if (mode == "interactive") Shape(command, new string[] { "id", "op", "captureId", "mode" }, "WINDOWS_INPUT_PROTOCOL");
            else if (mode == "synthetic-ui")
            {
                Shape(command, new string[] { "id", "op", "captureId", "mode", "seedBase64", "action" }, "WINDOWS_INPUT_PROTOCOL");
                synthetic = true;
                syntheticAction = Text(command, "action");
                if (Array.IndexOf(SyntheticActions, syntheticAction) < 0) throw new InputFault("WINDOWS_INPUT_PROTOCOL");
            }
            else throw new InputFault("WINDOWS_INPUT_PROTOCOL");
            captureId = Text(command, "captureId");
            if (!Nonce(captureId)) throw new InputFault("WINDOWS_INPUT_PROTOCOL");
            byte[] seed = null;
            Dictionary<string, object> seedFields = null;
            try
            {
                if (synthetic)
                {
                    seed = Decode(Text(command, "seedBase64"), MaximumSeedBytes);
                    seedFields = FlatJson.Parse(Utf8.GetString(seed));
                    Shape(seedFields, SeedKeys, "WINDOWS_INPUT_SEED");
                    foreach (string key in SeedKeys) Text(seedFields, key);
                    string tls = Text(seedFields, "developmentTls");
                    if (tls != "true" && tls != "false") throw new InputFault("WINDOWS_INPUT_SEED");
                }
                using (InputForm form = new InputForm(synthetic, syntheticAction, seedFields))
                {
                    try
                    {
                        RunWindow(form);
                        if (form.Fault != null) throw form.Fault;
                        snapshot = form.TakeSnapshot();
                        if (snapshot == null) throw new InputFault("WINDOWS_INPUT_CANCELLED");
                    }
                    finally { form.ClearSnapshot(); }
                }
                input = snapshot.InputBytes();
                expectations = snapshot.ExpectationBytes();
                captured = true;
                return ",\"captureId\":" + Quote(captureId) + ",\"inputBase64\":" + Quote(Convert.ToBase64String(input))
                    + ",\"expectationsBase64\":" + Quote(Convert.ToBase64String(expectations));
            }
            finally
            {
                Clear(seed);
                if (seedFields != null) seedFields.Clear();
            }
        }
        internal string Review(Dictionary<string, object> command)
        {
            EnsureUsable();
            if (!captured || Reviewed) throw new InputFault("WINDOWS_INPUT_STATE");
            if (!String.Equals(Text(command, "captureId"), captureId, StringComparison.Ordinal)) throw new InputFault("WINDOWS_INPUT_BINDING");
            challenge = Text(command, "challenge"); reference = Text(command, "reference"); viewBase64 = Text(command, "viewBase64");
            if (!Nonce(challenge) || !Regex.IsMatch(reference, "\\A[A-Za-z0-9][A-Za-z0-9_-]{0,63}\\z", RegexOptions.CultureInvariant)) throw new InputFault("WINDOWS_INPUT_BINDING");
            byte[] view = Decode(viewBase64, 8192);
            Dictionary<string, object> viewFields = null;
            try
            {
                viewFields = View(view, snapshot);
                string decision;
                using (ReviewForm form = new ReviewForm(viewFields, reference, synthetic, syntheticAction))
                {
                    RunWindow(form);
                    if (form.Fault != null) throw form.Fault;
                    decision = form.Decision;
                    if (form.ApprovalSubmissions > 1) throw new InputFault("WINDOWS_INPUT_UI");
                }
                Reviewed = true;
                return ",\"captureId\":" + Quote(captureId) + ",\"challenge\":" + Quote(challenge) + ",\"reference\":" + Quote(reference)
                    + ",\"viewBase64\":" + Quote(viewBase64) + ",\"decision\":" + Quote(decision);
            }
            finally
            {
                Clear(view);
                if (viewFields != null) viewFields.Clear();
            }
        }
        internal void Close()
        {
            if (closed) return;
            Clear(input); Clear(expectations); input = null; expectations = null;
            if (snapshot != null) snapshot.ClearValues();
            snapshot = null;
            captureId = null; syntheticAction = null; challenge = null; reference = null; viewBase64 = null;
            closed = true;
            // Mutable bytes and controls are cleared. Managed strings and
            // runtime, native control and pipe copies cannot be promised erased.
        }
    }

    private abstract class PrivateForm : Form
    {
        protected readonly System.Windows.Forms.Timer Deadline = new System.Windows.Forms.Timer();
        protected bool Finished;
        internal Exception Fault { get; private set; }
        protected PrivateForm(bool synthetic)
        {
            AutoScaleMode = AutoScaleMode.Font;
            Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 9F);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            if (synthetic) { Opacity = 0D; ShowInTaskbar = false; }
        }
        protected void Fail(Exception error)
        {
            if (Fault == null) Fault = error;
            Finished = true;
            Deadline.Stop();
            Close();
        }
        protected static TableLayoutPanel Grid()
        {
            TableLayoutPanel grid = new TableLayoutPanel();
            grid.Dock = DockStyle.Top; grid.AutoSize = true; grid.ColumnCount = 2;
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 180F));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            grid.Padding = new Padding(12);
            return grid;
        }
        protected static void Row(TableLayoutPanel grid, string labelText, Control control)
        {
            int row = grid.RowCount++;
            grid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            Label label = new Label(); label.Text = labelText; label.AutoSize = true;
            label.Margin = new Padding(3, 7, 6, 3);
            control.Dock = DockStyle.Fill; control.Margin = new Padding(3, 3, 3, 4);
            grid.Controls.Add(label, 0, row); grid.Controls.Add(control, 1, row);
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing) { Deadline.Stop(); Deadline.Dispose(); ClearControls(this); }
            base.Dispose(disposing);
        }
        private static void ClearControls(Control parent)
        {
            foreach (Control child in parent.Controls)
            {
                TextBox box = child as TextBox;
                if (box != null) box.Clear();
                CheckBox check = child as CheckBox;
                if (check != null) check.Checked = false;
                ClearControls(child);
            }
        }
    }
    private sealed class InputForm : PrivateForm
    {
        private readonly Dictionary<string, TextBox> fields = new Dictionary<string, TextBox>(StringComparer.Ordinal);
        private readonly Dictionary<string, string> syntheticOriginal;
        private readonly CheckBox developmentTls = new CheckBox();
        private readonly Button submit = new Button();
        private readonly Button cancel = new Button();
        private InputSnapshot result;
        private readonly string action;
        internal InputForm(bool synthetic, string syntheticAction, Dictionary<string, object> seed) : base(synthetic)
        {
            action = syntheticAction;
            if (seed != null) syntheticOriginal = new Dictionary<string, string>(StringComparer.Ordinal);
            Text = "Read-only device input";
            ClientSize = new Size(750, 680);
            Panel scroll = new Panel(); scroll.Dock = DockStyle.Fill; scroll.AutoScroll = true;
            TableLayoutPanel grid = Grid();
            string[] labels = new string[] { "HTTPS origin", "Username", "Password", "Certificate base64", "Expected model", "Plan template number", "Expected SPKI pin", "Expected serial number", "Expected plan fingerprint", "Expected count (1..1000)", "Target employee number", "Target FDID" };
            for (int index = 0; index < SeedKeys.Length - 1; index++)
            {
                string key = SeedKeys[index];
                TextBox box = new TextBox(); box.Name = key; box.MaxLength = MaximumFrameBytes;
                if (key == "password") box.UseSystemPasswordChar = true;
                if (key == "certificateBase64") { box.Multiline = true; box.Height = 72; box.ScrollBars = ScrollBars.Vertical; }
                fields.Add(key, box);
                Row(grid, labels[index], box);
                if (seed != null)
                {
                    string raw = SmartPmWindowsReadonlyInteractiveV1.Text(seed, key);
                    syntheticOriginal.Add(key, raw);
                    box.Text = raw;
                }
            }
            developmentTls.Name = "developmentTls"; developmentTls.Text = "Enable development TLS";
            developmentTls.AutoSize = true;
            if (seed != null)
            {
                string rawTls = SmartPmWindowsReadonlyInteractiveV1.Text(seed, "developmentTls");
                syntheticOriginal.Add("developmentTls", rawTls);
                developmentTls.Checked = rawTls == "true";
            }
            Row(grid, "TLS option", developmentTls);
            FlowLayoutPanel buttons = new FlowLayoutPanel(); buttons.AutoSize = true; buttons.Dock = DockStyle.Bottom;
            buttons.FlowDirection = FlowDirection.RightToLeft; buttons.Padding = new Padding(12);
            submit.Text = "Submit input"; submit.AutoSize = true;
            cancel.Text = "Cancel"; cancel.AutoSize = true;
            buttons.Controls.Add(cancel); buttons.Controls.Add(submit);
            scroll.Controls.Add(grid); Controls.Add(scroll); Controls.Add(buttons);
            submit.Click += delegate { Submit(); };
            cancel.Click += delegate { CancelCapture(); };
            Deadline.Interval = 240000;
            Deadline.Tick += delegate { CancelCapture(); };
            Shown += delegate
            {
                Deadline.Start();
                if (synthetic) BeginInvoke(new MethodInvoker(DriveSynthetic));
            };
        }
        private void Submit()
        {
            if (Finished) return;
            Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.Ordinal);
            try
            {
                foreach (KeyValuePair<string, TextBox> field in fields)
                {
                    // Do not trim or normalize: the submitted control text is
                    // the private input, including password spaces/Unicode.
                    Utf8.GetByteCount(field.Value.Text);
                    if (syntheticOriginal != null && !String.Equals(field.Value.Text, syntheticOriginal[field.Key], StringComparison.Ordinal))
                        throw new InputFault("WINDOWS_INPUT_SEED");
                    values.Add(field.Key, field.Value.Text);
                }
                if (syntheticOriginal != null && !String.Equals(developmentTls.Checked ? "true" : "false", syntheticOriginal["developmentTls"], StringComparison.Ordinal))
                    throw new InputFault("WINDOWS_INPUT_SEED");
                result = new InputSnapshot(values, developmentTls.Checked);
                Finished = true; Deadline.Stop(); Close();
            }
            catch (Exception error) { values.Clear(); Fail(error); }
        }
        private void CancelCapture()
        {
            if (Finished) return;
            Finished = true; Deadline.Stop(); Close();
        }
        private void DriveSynthetic()
        {
            try
            {
                if (action == "capture-cancel") cancel.PerformClick();
                else if (action == "capture-close") Close();
                else submit.PerformClick();
            }
            catch (Exception error) { Fail(error); }
        }
        internal InputSnapshot TakeSnapshot() { InputSnapshot value = result; result = null; return value; }
        internal void ClearSnapshot() { if (result != null) { result.ClearValues(); result = null; } }
        protected override bool ProcessCmdKey(ref Message message, Keys keyData)
        {
            if (keyData == Keys.Escape) { cancel.PerformClick(); return true; }
            return base.ProcessCmdKey(ref message, keyData);
        }
        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!Finished) { Finished = true; Deadline.Stop(); }
            base.OnFormClosing(e);
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing && syntheticOriginal != null) syntheticOriginal.Clear();
            base.Dispose(disposing);
        }
    }
    private sealed class ReviewForm : PrivateForm
    {
        private readonly CheckBox confirmation = new CheckBox();
        private readonly Button approve = new Button();
        private readonly Button reject = new Button();
        private readonly Button cancel = new Button();
        private readonly string action;
        internal string Decision { get; private set; }
        internal int ApprovalSubmissions { get; private set; }
        internal ReviewForm(Dictionary<string, object> view, string reference, bool synthetic, string syntheticAction) : base(synthetic)
        {
            action = syntheticAction;
            Decision = "cancel";
            Text = "Confirm read-only list";
            ClientSize = new Size(750, 540);
            TableLayoutPanel grid = Grid(); grid.Dock = DockStyle.Fill;
            foreach (string key in ViewKeys)
            {
                object item = view[key];
                TextBox field = new TextBox(); field.Name = key; field.ReadOnly = true;
                field.Text = item is int ? ((int)item).ToString(CultureInfo.InvariantCulture) : (string)item;
                Row(grid, key, field);
            }
            TextBox referenceBox = new TextBox(); referenceBox.Name = "reference"; referenceBox.ReadOnly = true; referenceBox.Text = reference;
            Row(grid, "reference", referenceBox);
            confirmation.Name = "confirmation"; confirmation.Checked = false;
            confirmation.Text = "I checked these details and approve this read-only list.";
            confirmation.AutoSize = true;
            Row(grid, "Explicit confirmation", confirmation);
            FlowLayoutPanel buttons = new FlowLayoutPanel(); buttons.AutoSize = true; buttons.Dock = DockStyle.Bottom;
            buttons.FlowDirection = FlowDirection.RightToLeft; buttons.Padding = new Padding(12);
            approve.Name = "approve"; approve.Text = "Approve"; approve.AutoSize = true; approve.Enabled = false;
            reject.Name = "reject"; reject.Text = "Reject"; reject.AutoSize = true;
            cancel.Name = "cancel"; cancel.Text = "Cancel"; cancel.AutoSize = true;
            buttons.Controls.Add(cancel); buttons.Controls.Add(reject); buttons.Controls.Add(approve);
            Controls.Add(grid); Controls.Add(buttons);
            // There is deliberately no default/AcceptButton. Enter never
            // becomes approval, even if the approve button has keyboard focus.
            AcceptButton = null;
            confirmation.CheckedChanged += delegate { approve.Enabled = !Finished && confirmation.Checked; };
            approve.Click += delegate
            {
                if (Finished || !confirmation.Checked || !approve.Enabled) return;
                Finish("approve");
            };
            reject.Click += delegate { Finish("reject"); };
            cancel.Click += delegate { Finish("cancel"); };
            Deadline.Interval = 25000;
            Deadline.Tick += delegate { Finish("none"); };
            Shown += delegate
            {
                Deadline.Start();
                if (synthetic) BeginInvoke(new MethodInvoker(DriveSynthetic));
            };
        }
        private void Finish(string decision)
        {
            if (Finished) return;
            Finished = true;
            Deadline.Stop();
            Decision = decision;
            if (decision == "approve") ApprovalSubmissions++;
            approve.Enabled = false; reject.Enabled = false; cancel.Enabled = false;
            Close();
        }
        private void DriveSynthetic()
        {
            try
            {
                if (action == "approve" || action == "double-approve")
                {
                    confirmation.Checked = true;
                    approve.PerformClick();
                    if (action == "double-approve") approve.PerformClick();
                }
                else if (action == "reject") reject.PerformClick();
                else if (action == "review-cancel") cancel.PerformClick();
                else if (action == "review-close") Close();
                else if (action == "unchecked-approve") { approve.PerformClick(); ExpireSynthetic(); }
                else if (action == "check-uncheck")
                {
                    confirmation.Checked = true;
                    confirmation.Checked = false;
                    approve.PerformClick();
                    ExpireSynthetic();
                }
                else if (action == "review-none") ExpireSynthetic();
                else throw new InputFault("WINDOWS_INPUT_STATE");
            }
            catch (Exception error) { Fail(error); }
        }
        private void ExpireSynthetic()
        {
            // A disabled PerformClick cannot approve. Drive the same native
            // timeout event promptly, rather than inventing an approval result.
            if (!Finished) { Deadline.Stop(); Deadline.Interval = 1; Deadline.Start(); }
        }
        protected override bool ProcessCmdKey(ref Message message, Keys keyData)
        {
            if ((keyData & Keys.KeyCode) == Keys.Enter) return true;
            if (keyData == Keys.Escape) { cancel.PerformClick(); return true; }
            return base.ProcessCmdKey(ref message, keyData);
        }
        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!Finished) { Finished = true; Decision = "cancel"; Deadline.Stop(); }
            base.OnFormClosing(e);
        }
    }

    // Strict flat JSON copied from the source helper above. Counts may be
    // 1..1000; command IDs are constrained separately by the lifecycle.
    private sealed class FlatJson
    {
        private readonly string text;
        private int position;
        private FlatJson(string value) { text = value; }
        internal static Dictionary<string, object> Parse(string text)
        {
            FlatJson parser = new FlatJson(text); Dictionary<string, object> fields = parser.Record(); parser.Space();
            if (parser.position != text.Length) throw new InputFault("WINDOWS_INPUT_PROTOCOL");
            return fields;
        }
        private void Space() { while (position < text.Length && (text[position] == ' ' || text[position] == '\t' || text[position] == '\r' || text[position] == '\n')) position++; }
        private void Take(char expected)
        {
            Space(); if (position >= text.Length || text[position++] != expected) throw new InputFault("WINDOWS_INPUT_PROTOCOL");
        }
        private Dictionary<string, object> Record()
        {
            Dictionary<string, object> fields = new Dictionary<string, object>(StringComparer.Ordinal);
            Take('{'); Space(); if (position < text.Length && text[position] == '}') { position++; return fields; }
            while (true)
            {
                string key = String(); Take(':'); Space(); object value;
                if (position < text.Length && text[position] == '"') value = String();
                else
                {
                    int start = position;
                    while (position < text.Length && text[position] >= '0' && text[position] <= '9') position++;
                    string number = text.Substring(start, position - start); int parsed;
                    if (number.Length == 0 || number.Length > 10 || number.Length > 1 && number[0] == '0'
                        || !Int32.TryParse(number, NumberStyles.None, CultureInfo.InvariantCulture, out parsed)) throw new InputFault("WINDOWS_INPUT_PROTOCOL");
                    value = parsed;
                }
                if (fields.ContainsKey(key)) throw new InputFault("WINDOWS_INPUT_PROTOCOL"); fields.Add(key, value); Space();
                if (position >= text.Length) throw new InputFault("WINDOWS_INPUT_PROTOCOL");
                char next = text[position++]; if (next == '}') return fields;
                if (next != ',') throw new InputFault("WINDOWS_INPUT_PROTOCOL");
            }
        }
        private string String()
        {
            Take('"'); StringBuilder value = new StringBuilder();
            while (position < text.Length)
            {
                char current = text[position++];
                if (current == '"') { string result = value.ToString(); Utf8.GetByteCount(result); return result; }
                if (current < 0x20) throw new InputFault("WINDOWS_INPUT_PROTOCOL");
                if (current != '\\') { value.Append(current); continue; }
                if (position >= text.Length) throw new InputFault("WINDOWS_INPUT_PROTOCOL");
                char escaped = text[position++];
                if (escaped == '"' || escaped == '\\' || escaped == '/') value.Append(escaped);
                else if (escaped == 'b') value.Append('\b');
                else if (escaped == 'f') value.Append('\f');
                else if (escaped == 'n') value.Append('\n');
                else if (escaped == 'r') value.Append('\r');
                else if (escaped == 't') value.Append('\t');
                else if (escaped == 'u')
                {
                    if (position + 4 > text.Length) throw new InputFault("WINDOWS_INPUT_PROTOCOL"); int code = 0;
                    for (int index = 0; index < 4; index++)
                    {
                        char digit = text[position++]; int hex = digit >= '0' && digit <= '9' ? digit - '0' : digit >= 'a' && digit <= 'f' ? digit - 'a' + 10 : digit >= 'A' && digit <= 'F' ? digit - 'A' + 10 : -1;
                        if (hex < 0) throw new InputFault("WINDOWS_INPUT_PROTOCOL"); code = code * 16 + hex;
                    }
                    value.Append((char)code);
                }
                else throw new InputFault("WINDOWS_INPUT_PROTOCOL");
            }
            throw new InputFault("WINDOWS_INPUT_PROTOCOL");
        }
    }
}
