import { types } from "node:util";
import { decodeSyntheticConfigBytes } from "../../hikvision-offline-entry/src/bytes.mjs";

const SCOPE = "offline-evidence-path-redaction-only";
const MAX_TEXT_BYTES = 262144;
const MAX_ROOT_LENGTH = 1024;
const CODES = new Set([
  "INVALID_INPUT", "INVALID_ROOT", "INPUT_TOO_LARGE", "INVALID_JSON_LINES",
  "SENSITIVE_KEY", "RESIDUAL_PATH", "INTERNAL_ERROR",
]);
const SEPARATORS = "[\\\\/]+";
// A suffix such as TaskSuffix, Task.txt or Task-name is not a root boundary.
const BOUNDARY = "(?=$|[\\\\/\\x20\\t\\r\\n\\\"'`<>()\\[\\]{},;:=!?|]|\\.(?=$|[\\x20\\t\\r\\n]))";
const USER_PATH = /[a-z]:[\\/]+Users[\\/]+[^\\/\x00-\x20<>:"|?*]+/i;

function reject(code) { throw code; }

function readStrings(input, expected) {
  if (input === null || typeof input !== "object" || types.isProxy(input)) reject("INVALID_INPUT");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) reject("INVALID_INPUT");
  const keys = Reflect.ownKeys(input);
  if (keys.length !== expected.length) reject("INVALID_INPUT");
  const copy = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string" || !expected.includes(key)) reject("INVALID_INPUT");
    const property = Object.getOwnPropertyDescriptor(input, key);
    if (!property || !property.enumerable || !Object.hasOwn(property, "value") ||
        typeof property.value !== "string") reject("INVALID_INPUT");
    copy[key] = property.value;
  }
  return copy;
}

function wellFormed(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function escapePattern(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function validateRoot(value, profile) {
  if (value.length > MAX_ROOT_LENGTH || !wellFormed(value) || !/^[a-z]:[\\/]/i.test(value) ||
      /[\x00-\x1f\x7f<>:"|?*]/.test(value.slice(2))) reject("INVALID_ROOT");
  const parts = value.slice(2).split(/[\\/]+/);
  // The drive prefix consumes the first empty part; trailing separators are optional.
  parts.shift();
  if (parts[parts.length - 1] === "") parts.pop();
  if (parts.length === 0) reject("INVALID_ROOT");
  for (const part of parts) {
    if (part === "" || part === "." || part === ".." || /[. ]$/.test(part) ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)) reject("INVALID_ROOT");
  }
  if (profile && (parts.length !== 2 || parts[0].toLowerCase() !== "users")) reject("INVALID_ROOT");
  // A Users parent replacement would hide an unredacted account component.
  if (!profile && parts.length === 1 && parts[0].toLowerCase() === "users") reject("INVALID_ROOT");
  return escapePattern(value[0]) + ":" + SEPARATORS + parts.map(escapePattern).join(SEPARATORS) + BOUNDARY;
}

function makeRoots(worktreeRoot, profileRoot) {
  const worktree = validateRoot(worktreeRoot, false);
  const profile = validateRoot(profileRoot, true);
  return {
    worktree: new RegExp(worktree, "gi"),
    profile: new RegExp(profile, "gi"),
    known: new RegExp("(?:" + worktree + "|" + profile + ")", "i"),
  };
}

function emptyCounts() {
  return { records: 0, stringTokens: 0, changedTokens: 0, worktreeReplacements: 0, profileReplacements: 0 };
}

function failText(code) {
  return Object.freeze({ scope: SCOPE, status: "FAIL", code, text: null, counts: null });
}

function failCapture(code) {
  return Object.freeze({ scope: SCOPE, status: "FAIL", code, stdout: null, stderr: null, counts: null });
}

function sensitivePath(value, roots) {
  if (USER_PATH.test(value) || roots.known.test(value)) return true;
  // Detection only: unsupported encodings are never decoded into the output.
  // Two bounded inspection rounds catch recognizable Unicode/percent nesting;
  // this is intentionally not a general URL decoder or a general DLP engine.
  let probe = value;
  for (let round = 0; round < 2; round += 1) {
    const next = probe
      .replace(/\\u([0-9a-f]{4})/gi, (_token, digits) => String.fromCharCode(Number.parseInt(digits, 16)))
      .replace(/%([0-9a-f]{2})/gi, (_token, digits) => String.fromCharCode(Number.parseInt(digits, 16)));
    if (next === probe) break;
    if (USER_PATH.test(next) || roots.known.test(next)) return true;
    probe = next;
  }
  return false;
}

function replaceKnown(value, roots) {
  let worktreeReplacements = 0;
  let profileReplacements = 0;
  const text = value
    .replace(roots.worktree, () => { worktreeReplacements += 1; return "<TASK_WORKTREE>"; })
    .replace(roots.profile, () => { profileReplacements += 1; return "<USER_PROFILE>"; });
  return { text, worktreeReplacements, profileReplacements };
}

function addReplacements(counts, result) {
  counts.worktreeReplacements += result.worktreeReplacements;
  counts.profileReplacements += result.profileReplacements;
}

function redactJsonLine(line, roots, counts) {
  counts.records += 1;
  const pieces = [];
  let unchangedStart = 0;
  let cursor = 0;
  while (cursor < line.length) {
    if (line[cursor] !== '"') { cursor += 1; continue; }
    const start = cursor++;
    while (cursor < line.length) {
      const character = line[cursor++];
      if (character === "\\") { cursor += 1; continue; }
      if (character === '"') break;
    }
    const end = cursor;
    const decoded = JSON.parse(line.slice(start, end));
    counts.stringTokens += 1;
    let next = end;
    while (/[\x20\t\r\n]/.test(line[next] || "\0")) next += 1;
    const isKey = line[next] === ":";
    const replaced = replaceKnown(decoded, roots);
    if (isKey) {
      if (replaced.text !== decoded || sensitivePath(decoded, roots)) reject("SENSITIVE_KEY");
    } else {
      if (sensitivePath(replaced.text, roots)) reject("RESIDUAL_PATH");
      if (replaced.text !== decoded) {
        pieces.push(line.slice(unchangedStart, start), JSON.stringify(replaced.text));
        unchangedStart = end;
        counts.changedTokens += 1;
        addReplacements(counts, replaced);
      }
    }
  }
  pieces.push(line.slice(unchangedStart));
  return pieces.join("");
}

function redactLines(text, roots, counts) {
  const lines = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    let line = text.slice(start, end);
    let ending = newline === -1 ? "" : "\n";
    if (newline !== -1 && line.endsWith("\r")) {
      line = line.slice(0, -1);
      ending = "\r\n";
    }
    if (line.includes("\r")) reject("INVALID_JSON_LINES");
    const blank = /^[\x20\t]*$/.test(line);
    if (!blank) {
      // Validate the entire batch before any token transformation. The existing
      // loader tree is discarded; numeric source lexemes are never serialized.
      const bytes = Array.from(Buffer.from(line, "utf8"));
      if (decodeSyntheticConfigBytes(bytes).code !== "OK") reject("INVALID_JSON_LINES");
    }
    lines.push({ line, ending, blank });
    start = end + 1;
  }
  const pieces = [];
  for (const entry of lines) {
    pieces.push(entry.blank ? entry.line : redactJsonLine(entry.line, roots, counts), entry.ending);
  }
  return pieces.join("");
}

export function redactEvidenceText(input) {
  try {
    const values = readStrings(input, ["text", "format", "worktreeRoot", "profileRoot"]);
    if (values.format !== "json-lines" && values.format !== "text") reject("INVALID_INPUT");
    if (!wellFormed(values.text)) reject("INVALID_INPUT");
    if (Buffer.byteLength(values.text, "utf8") > MAX_TEXT_BYTES) reject("INPUT_TOO_LARGE");
    const roots = makeRoots(values.worktreeRoot, values.profileRoot);
    const counts = emptyCounts();
    let text;
    if (values.format === "json-lines") text = redactLines(values.text, roots, counts);
    else {
      const replaced = replaceKnown(values.text, roots);
      if (sensitivePath(replaced.text, roots)) reject("RESIDUAL_PATH");
      addReplacements(counts, replaced);
      text = replaced.text;
    }
    return Object.freeze({ scope: SCOPE, status: "PASS", code: "OK", text, counts: Object.freeze(counts) });
  } catch (error) {
    return failText(typeof error === "string" && CODES.has(error) ? error : "INTERNAL_ERROR");
  }
}

export function prepareRedactedCapture(input) {
  try {
    const values = readStrings(input, ["stdout", "stderr", "worktreeRoot", "profileRoot"]);
    if (!wellFormed(values.stdout) || !wellFormed(values.stderr)) reject("INVALID_INPUT");
    const stdout = redactEvidenceText({
      text: values.stdout, format: "json-lines", worktreeRoot: values.worktreeRoot, profileRoot: values.profileRoot,
    });
    if (stdout.status !== "PASS") return failCapture(stdout.code);
    const stderr = redactEvidenceText({
      text: values.stderr, format: "text", worktreeRoot: values.worktreeRoot, profileRoot: values.profileRoot,
    });
    if (stderr.status !== "PASS") return failCapture(stderr.code);
    return Object.freeze({
      scope: SCOPE, status: "PASS", code: "OK", stdout: stdout.text, stderr: stderr.text,
      counts: Object.freeze({ stdout: stdout.counts, stderr: stderr.counts }),
    });
  } catch (error) {
    return failCapture(typeof error === "string" && CODES.has(error) ? error : "INTERNAL_ERROR");
  }
}
