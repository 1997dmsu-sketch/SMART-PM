import { TextDecoder, types } from "node:util";

// Internal pure-memory loader. It never reads a path or invokes input methods.
const MAX_BYTES = 65536;
const MAX_DEPTH = 16;
const CODES = new Set([
  "INVALID_BYTES", "INPUT_TOO_LARGE", "INVALID_UTF8", "BOM_NOT_ALLOWED",
  "INVALID_JSON", "DUPLICATE_KEY", "INPUT_TOO_DEEP",
]);

function reject(code) { throw code; }

function copyBytes(value) {
  if (value === null || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype) reject("INVALID_BYTES");
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isSafeInteger(length) || length < 1) reject("INVALID_BYTES");
  // Bound all later reflection/copy work before enumerating the array shape.
  if (length > MAX_BYTES) reject("INPUT_TOO_LARGE");
  const names = Reflect.ownKeys(value);
  if (names.length !== length + 1 || names.some((key) => typeof key !== "string" ||
      (key !== "length" && !/^(?:0|[1-9][0-9]*)$/.test(key)))) reject("INVALID_BYTES");
  const copied = [];
  for (let index = 0; index < length; index += 1) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !property.enumerable || !Object.hasOwn(property, "value") ||
        !Number.isInteger(property.value) || property.value < 0 || property.value > 255) reject("INVALID_BYTES");
    copied.push(property.value);
  }
  return copied;
}

function wellFormedString(value) {
  // JSON escape decoding may produce a lone surrogate despite valid UTF-8.
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) reject("INVALID_JSON");
    } else if (code >= 0xdc00 && code <= 0xdfff) reject("INVALID_JSON");
  }
  return value;
}

function parseJson(text) {
  let cursor = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/.test(text[cursor] || "\0")) cursor += 1; };
  function string() {
    if (text[cursor] !== '"') reject("INVALID_JSON");
    const start = cursor++;
    while (cursor < text.length) {
      const character = text[cursor++];
      if (character === '"') {
        try { return wellFormedString(JSON.parse(text.slice(start, cursor))); }
        catch { reject("INVALID_JSON"); }
      }
      if (character.charCodeAt(0) < 32) reject("INVALID_JSON");
      if (character === "\\") cursor += 1;
    }
    reject("INVALID_JSON");
  }
  function value(depth) {
    if (depth > MAX_DEPTH) reject("INPUT_TOO_DEEP");
    whitespace();
    const first = text[cursor];
    if (first === '"') return string();
    if (first === "{") {
      cursor += 1;
      const object = Object.create(null);
      const keys = new Set();
      whitespace();
      if (text[cursor] === "}") { cursor += 1; return object; }
      for (;;) {
        whitespace();
        const key = string();
        if (keys.has(key)) reject("DUPLICATE_KEY");
        keys.add(key);
        whitespace();
        if (text[cursor++] !== ":") reject("INVALID_JSON");
        object[key] = value(depth + 1);
        whitespace();
        const separator = text[cursor++];
        if (separator === "}") return object;
        if (separator !== ",") reject("INVALID_JSON");
      }
    }
    if (first === "[") {
      cursor += 1;
      const array = [];
      whitespace();
      if (text[cursor] === "]") { cursor += 1; return array; }
      for (;;) {
        array.push(value(depth + 1));
        whitespace();
        const separator = text[cursor++];
        if (separator === "]") return array;
        if (separator !== ",") reject("INVALID_JSON");
      }
    }
    for (const [token, parsed] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(token, cursor)) { cursor += token.length; return parsed; }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(cursor));
    if (!number) reject("INVALID_JSON");
    cursor += number[0].length;
    const parsed = Number(number[0]);
    if (!Number.isFinite(parsed)) reject("INVALID_JSON");
    return parsed;
  }
  const parsed = value(0);
  whitespace();
  if (cursor !== text.length) reject("INVALID_JSON");
  return parsed;
}

export function decodeSyntheticConfigBytes(value) {
  try {
    const bytes = copyBytes(value);
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) reject("BOM_NOT_ALLOWED");
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(bytes)); }
    catch { reject("INVALID_UTF8"); }
    return { code: "OK", input: parseJson(text) };
  } catch (error) {
    return { code: typeof error === "string" && CODES.has(error) ? error : "INVALID_BYTES", input: null };
  }
}
