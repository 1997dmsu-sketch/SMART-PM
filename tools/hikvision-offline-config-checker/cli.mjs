import { Buffer } from "node:buffer";
import { isAbsolute, normalize } from "node:path";
import { finished } from "node:stream";
import { pathToFileURL } from "node:url";
import { TextDecoder, types } from "node:util";
import { checkOfflineConfig, checkOfflineConfigJson } from "./src/check-config.mjs";

const MAX_BYTES = 16 * 1024;

/** Pure entry metadata comparison; no filesystem lookup or configuration input. */
export function isCliEntry(meta, entryPath) {
  try {
    if (meta === null || typeof meta !== "object" || types.isProxy(meta)) return false;
    const main = Object.getOwnPropertyDescriptor(meta, "main");
    if (main) {
      if (!Object.hasOwn(main, "value")) return false;
      if (typeof main.value === "boolean") return main.value;
      if (main.value !== undefined) return false;
    }
    const url = Object.getOwnPropertyDescriptor(meta, "url");
    if (!url || !Object.hasOwn(url, "value") || typeof url.value !== "string" ||
        typeof entryPath !== "string" || !isAbsolute(entryPath)) return false;
    return pathToFileURL(normalize(entryPath)).href === new URL(url.value).href;
  } catch {
    return false;
  }
}

function internalFailure() {
  const result = checkOfflineConfig(null);
  result.code = "INTERNAL_ERROR";
  return result;
}

function ownData(record, keys) {
  if (record === null || typeof record !== "object" || types.isProxy(record)) throw new TypeError();
  if (Array.isArray(record)) throw new TypeError();
  const prototype = Object.getPrototypeOf(record);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
  const names = Reflect.ownKeys(record);
  if (names.length !== keys.length || names.some((key) => typeof key !== "string" || !keys.includes(key))) throw new TypeError();
  const descriptors = Object.getOwnPropertyDescriptors(record);
  const copy = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError();
    copy[key] = descriptor.value;
  }
  return copy;
}

function safeResult(result) {
  const template = internalFailure();
  const copy = ownData(result, Object.keys(template));
  if (copy.schemaVersion !== template.schemaVersion || copy.scope !== template.scope ||
      !["OK", "INVALID_INPUT", "INVALID_TARGET", "TARGET_MISMATCH", "INVALID_PORT", "PORT_MISMATCH",
        "MODEL_MISMATCH", "READ_NOT_DISABLED", "INTERNAL_ERROR"].includes(copy.code) ||
      copy.status !== (copy.code === "OK" ? "PASS" : "FAIL")) throw new TypeError();
  const checks = ownData(copy.checks, Object.keys(template.checks));
  for (const [key, value] of Object.entries(checks)) {
    if (typeof template.checks[key] === "boolean" ? typeof value !== "boolean" :
        !Number.isSafeInteger(value) || value < 0) throw new TypeError();
  }
  copy.checks = checks;
  return copy;
}

async function writeLine(output, result) {
  const line = `${JSON.stringify(result)}\n`;
  let cleanup;
  const writeFailed = Symbol("write-failed");
  try {
    await new Promise((resolve, reject) => {
      // Observe actual or already-recorded termination before attempting the
      // write. A failed callback alone is not termination: asynchronous
      // _destroy may still be pending; an already-closed stream emits no new
      // event at all. Node's passive observer handles both states.
      cleanup = finished(output, { readable: false }, () => reject(writeFailed));
      try {
        output.write(line, (error) => {
          if (!error) resolve();
        });
      } catch {
        // A synchronous interface exception is not a conforming asynchronous
        // Writable failure. Fail closed without claiming destruction finished.
        reject(writeFailed);
      }
    });
  } finally {
    if (cleanup) cleanup();
  }
}

/** Importing this module is inert. Tests supply both streams in this process. */
export async function runCli({ input, output, checkJson = checkOfflineConfigJson } = {}) {
  let result;
  try {
    if (input?.isTTY === true) {
      result = checkOfflineConfigJson("");
    }
    const chunks = [];
    let bytes = 0;
    if (!result) for await (const chunk of input) {
      const remaining = MAX_BYTES - bytes;
      let buffer;
      if (typeof chunk === "string") {
        // Code-unit length is a lower bound on UTF-8 bytes, so reject oversized
        // chunks before byte counting or allocating a duplicate buffer.
        if (chunk.length > remaining || Buffer.byteLength(chunk, "utf8") > remaining) {
          result = checkOfflineConfigJson("");
          break;
        }
        buffer = Buffer.from(chunk, "utf8");
      } else if (chunk instanceof Uint8Array) {
        if (chunk.byteLength > remaining) {
          result = checkOfflineConfigJson("");
          break;
        }
        buffer = Buffer.from(chunk);
      } else {
        throw new TypeError();
      }
      bytes += buffer.length;
      chunks.push(buffer);
    }
    if (!result) {
      let text;
      try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)); }
      catch { result = checkOfflineConfigJson(""); }
      if (!result) result = await checkJson(text);
    }
    // Serialize a closed data snapshot, never an arbitrary callback's getters,
    // toJSON implementation, exception, or extra fields.
    result = safeResult(result);
  } catch {
    result = internalFailure();
  }
  const code = result.code === "OK" ? 0 : result.code === "INTERNAL_ERROR" ? 3 : 2;
  try { await writeLine(output, result); } catch { return 3; }
  return code;
}

// Newer Node exposes main directly. Only older Node reads argv[1], solely as
// entry metadata; configuration still comes exclusively from the supplied JSON.
if (isCliEntry(import.meta, typeof import.meta.main === "boolean" ? undefined : process.argv[1])) {
  try { process.exitCode = await runCli({ input: process.stdin, output: process.stdout }); }
  catch { process.exitCode = 3; }
}
