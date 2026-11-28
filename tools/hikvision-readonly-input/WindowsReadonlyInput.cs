using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

// This process is a fixed private pipe adapter. Its stdout contains private
// IPC payloads, not public logs. The synthetic event is not human identity or
// a field accepted by the installed readonly CLI. No files or network are used.
public static class SmartPmWindowsReadonlyInputV1
{
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
    private const int MaximumFrameBytes = 128 * 1024;
    private static readonly string[] ExpectationKeys = new string[] {
        "expectedSpkiPin", "expectedSerialNumber", "expectedPlanFingerprint",
        "expectedCount", "targetEmployeeNo", "targetFDID"
    };
    private static readonly string[] ViewKeys = new string[] {
        "protocolVersion", "mode", "operation", "expectedModel", "planTemplateNo",
        "expectedCount", "targetEmployeeNo", "targetFaceLibType", "targetFDID"
    };

    public static int Run()
    {
        InputSession session = new InputSession();
        int expectedId = 1;
        try
        {
            using (BufferedStream input = new BufferedStream(Console.OpenStandardInput(), 16384))
            {
                Stream output = Console.OpenStandardOutput();
                while (expectedId <= 4)
                {
                    byte[] frame = null;
                    Dictionary<string, object> command;
                    try
                    {
                        frame = ReadFrame(input);
                        if (frame == null) throw new InputFault("WINDOWS_INPUT_INCOMPLETE");
                        command = FlatJson.Parse(Utf8.GetString(frame));
                    }
                    finally { Clear(frame); }
                    int id = Integer(command, "id");
                    if (id != expectedId) throw new InputFault("WINDOWS_INPUT_PROTOCOL");
                    string op = Text(command, "op");
                    if (op == "close")
                    {
                        Shape(command, new string[] { "id", "op" }, "WINDOWS_INPUT_PROTOCOL");
                        if (id == 1) session.Remember(new InputFault("WINDOWS_INPUT_STATE"));
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
                            Shape(command, new string[] { "id", "op", "captureId", "inputBase64", "expectationsBase64", "event" }, "WINDOWS_INPUT_PROTOCOL");
                            if (id != 1) throw new InputFault("WINDOWS_INPUT_STATE");
                            response = session.Capture(command);
                        }
                        else if (op == "review")
                        {
                            Shape(command, new string[] { "id", "op", "captureId", "challenge", "reference", "viewBase64" }, "WINDOWS_INPUT_PROTOCOL");
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
    private static void Expectations(byte[] bytes)
    {
        Dictionary<string, object> fields = FlatJson.Parse(Utf8.GetString(bytes));
        Shape(fields, ExpectationKeys, "WINDOWS_INPUT_EXPECTATIONS");
        int count = Integer(fields, "expectedCount");
        if (count < 1 || count > 1000) throw new InputFault("WINDOWS_INPUT_EXPECTATIONS");
        foreach (string key in ExpectationKeys) if (key != "expectedCount") Text(fields, key);
        // Pin, identity and target semantics remain the existing JS session's
        // responsibility. This parser ensures no duplicate/unknown/nested data.
    }
    private static void View(byte[] bytes)
    {
        Dictionary<string, object> fields = FlatJson.Parse(Utf8.GetString(bytes));
        Shape(fields, ViewKeys, "WINDOWS_INPUT_REVIEW");
        int count = Integer(fields, "expectedCount");
        if (Integer(fields, "protocolVersion") != 1 || Text(fields, "mode") != "readonly"
            || Text(fields, "operation") != "list" || Text(fields, "targetFaceLibType") != "blackFD"
            || count < 1 || count > 1000 || !SafeText(Text(fields, "expectedModel"), 128)
            || !SafeText(Text(fields, "planTemplateNo"), 32) || !SafeText(Text(fields, "targetEmployeeNo"), 32)
            || !SafeText(Text(fields, "targetFDID"), 32)) throw new InputFault("WINDOWS_INPUT_REVIEW");
    }

    private sealed class InputFault : Exception
    {
        internal readonly string Code;
        internal InputFault(string code) : base("Windows private input stopped.") { Code = code; }
    }
    private sealed class InputSession
    {
        private byte[] input, expectations;
        private string captureId, selectedEvent, challenge, reference, viewBase64;
        private bool captured, reviewed, closed;
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
            if (captured || input != null || expectations != null) throw new InputFault("WINDOWS_INPUT_STATE");
            captureId = Text(command, "captureId"); selectedEvent = Text(command, "event");
            if (!Nonce(captureId) || selectedEvent != "approve" && selectedEvent != "reject" && selectedEvent != "cancel" && selectedEvent != "none") throw new InputFault("WINDOWS_INPUT_PROTOCOL");
            input = Decode(Text(command, "inputBase64"), 32768);
            expectations = Decode(Text(command, "expectationsBase64"), 8192);
            Expectations(expectations); captured = true;
            return ",\"captureId\":" + Quote(captureId) + ",\"inputBase64\":" + Quote(Convert.ToBase64String(input))
                + ",\"expectationsBase64\":" + Quote(Convert.ToBase64String(expectations));
        }
        internal string Review(Dictionary<string, object> command)
        {
            EnsureUsable();
            if (!captured || reviewed) throw new InputFault("WINDOWS_INPUT_STATE");
            if (!String.Equals(Text(command, "captureId"), captureId, StringComparison.Ordinal)) throw new InputFault("WINDOWS_INPUT_BINDING");
            challenge = Text(command, "challenge"); reference = Text(command, "reference"); viewBase64 = Text(command, "viewBase64");
            if (!Nonce(challenge) || !Regex.IsMatch(reference, "\\A[A-Za-z0-9][A-Za-z0-9_-]{0,63}\\z", RegexOptions.CultureInvariant)) throw new InputFault("WINDOWS_INPUT_BINDING");
            byte[] view = Decode(viewBase64, 8192);
            try { View(view); }
            finally { Clear(view); }
            reviewed = true;
            return ",\"captureId\":" + Quote(captureId) + ",\"challenge\":" + Quote(challenge) + ",\"reference\":" + Quote(reference)
                + ",\"viewBase64\":" + Quote(viewBase64) + ",\"decision\":" + Quote(selectedEvent);
        }
        internal void Close()
        {
            if (closed) return;
            Clear(input); Clear(expectations); input = null; expectations = null;
            captureId = null; selectedEvent = null; challenge = null; reference = null; viewBase64 = null;
            closed = true;
            // Managed strings and runtime/pipe copies cannot be promised erased.
        }
    }

    // Strict flat JSON adapted from the existing native evidence protocol.
    // Counts may be 1..1000; IDs are constrained separately by the lifecycle.
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
