import test, { after } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { syncBuiltinESMExports } from "node:module";
import http, * as httpNamed from "node:http";
import https, * as httpsNamed from "node:https";
import net, * as netNamed from "node:net";
import tls, * as tlsNamed from "node:tls";
import dgram, * as dgramNamed from "node:dgram";
import dns, * as dnsNamed from "node:dns";
import childProcess, * as childNamed from "node:child_process";
import fs, * as fsNamed from "node:fs";
import { pathToFileURL } from "node:url";

// All controls are no-forward stubs. No socket, listener, DNS lookup, process,
// real configuration, or secret is used, including in the positive controls.
function installGuard() {
  const records = [];
  const slots = new WeakMap();
  let restored = false;
  const namespaces = [
    [http, httpNamed], [https, httpsNamed], [net, netNamed], [tls, tlsNamed],
    [dgram, dgramNamed], [dns, dnsNamed], [childProcess, childNamed], [fs, fsNamed],
  ];
  const namedBefore = namespaces.flatMap(([object, namespace]) =>
    Object.keys(namespace).filter((key) => key !== "default" && typeof object[key] === "function")
      .map((key) => ({ object, namespace, key, value: namespace[key] })));

  function wrap(object, key, label, kind = "network") {
    if (typeof object[key] !== "function") return;
    const keys = slots.get(object) || new Set();
    if (keys.has(key)) {
      // Callback and Promise Resolvers share some inherited prototype slots.
      // Record aliases rather than installing nested wrappers on that slot.
      const existing = records.find((entry) => entry.object === object && entry.key === key);
      assert.ok(existing, `known shared guard slot ${label}`);
      existing.aliases.push(label);
      return;
    }
    keys.add(key);
    slots.set(object, keys);
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    const current = object[key];
    const inheritedWrapper = records.find((entry) => entry.stub === current);
    const original = inheritedWrapper ? inheritedWrapper.original : current;
    const record = { object, key, label, aliases: [label], kind, descriptor, original, calls: 0 };
    record.stub = function blockedEntry() {
      record.calls += 1;
      const error = new Error("SYNTHETIC_SIDE_EFFECT_BLOCKED");
      error.code = "SYNTHETIC_SIDE_EFFECT_BLOCKED";
      throw error;
    };
    Object.defineProperty(object, key, {
      value: record.stub,
      writable: descriptor?.writable ?? true,
      enumerable: descriptor?.enumerable ?? false,
      configurable: descriptor?.configurable ?? true,
    });
    records.push(record);
  }

  for (const key of ["request", "get", "createServer"]) {
    wrap(http, key, `http.${key}`);
    wrap(https, key, `https.${key}`);
  }
  for (const [object, key, label] of [
    [globalThis, "fetch", "fetch"],
    [net, "connect", "net.connect"], [net, "createConnection", "net.createConnection"],
    [net, "createServer", "net.createServer"], [net.Socket.prototype, "connect", "net.Socket.connect"],
    [net.Server.prototype, "listen", "net.Server.listen"],
    [http.Server.prototype, "listen", "http.Server.listen"],
    [https.Server.prototype, "listen", "https.Server.listen"],
    [tls, "connect", "tls.connect"], [tls, "createServer", "tls.createServer"],
    [dgram, "createSocket", "dgram.createSocket"],
    [dgram.Socket.prototype, "send", "dgram.Socket.send"],
    [dgram.Socket.prototype, "bind", "dgram.Socket.bind"],
    [dgram.Socket.prototype, "connect", "dgram.Socket.connect"],
  ]) wrap(object, key, label);

  for (const [object, prefix] of [[dns, "dns"], [dns.promises, "dns.promises"]]) {
    for (const key of Object.getOwnPropertyNames(object)) {
      if (/^(lookup|lookupService|resolve.*|reverse)$/.test(key)) wrap(object, key, `${prefix}.${key}`);
    }
    const Resolver = object.Resolver;
    if (typeof Resolver === "function") {
      const seen = new Set();
      for (let proto = Resolver.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
        for (const key of Object.getOwnPropertyNames(proto)) {
          if (!seen.has(key) && /^(resolve.*|reverse|cancel|setServers|setLocalAddress)$/.test(key)) {
            seen.add(key);
            wrap(proto, key, `${prefix}.Resolver.${key}`);
          }
        }
      }
      wrap(object, "Resolver", `${prefix}.Resolver.constructor`);
    }
  }
  for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    wrap(childProcess, key, `child_process.${key}`);
  }
  wrap(childProcess.ChildProcess.prototype, "spawn", "child_process.ChildProcess.spawn");
  syncBuiltinESMExports();

  const snapshot = () => Object.fromEntries(records.map((record) => [record.label, record.calls]));
  const assertUnchanged = (before, message) => assert.deepEqual(snapshot(), before, message);
  function positiveControls(selected = records) {
    for (const record of selected) {
      const before = record.calls;
      assert.throws(() => Reflect.apply(record.object[record.key], record.object, []),
        { code: "SYNTHETIC_SIDE_EFFECT_BLOCKED" }, record.label);
      assert.equal(record.calls, before + 1, record.label);
    }
    for (const item of namedBefore) {
      const record = records.find((entry) => entry.object === item.object && entry.key === item.key);
      if (record) assert.equal(item.namespace[item.key], record.stub, `ESM sync ${record.label}`);
    }
  }
  function installRuntimeFileGuard() {
    // Install after module loading so Node's ESM loader is not misreported as
    // application configuration access. Runtime calls are still blocked.
    const start = records.length;
    for (const key of ["readFile", "readFileSync", "open", "openSync", "createReadStream",
      "read", "readSync", "readdir", "readdirSync", "opendir", "opendirSync", "access",
      "accessSync", "stat", "statSync", "lstat", "lstatSync", "readlink", "readlinkSync",
      "realpath", "realpathSync", "existsSync", "watch", "watchFile"]) wrap(fs, key, `fs.${key}`, "file");
    for (const key of ["readFile", "open", "readdir", "opendir", "access", "stat", "lstat", "readlink", "realpath", "watch"]) {
      wrap(fs.promises, key, `fs.promises.${key}`, "file");
    }
    syncBuiltinESMExports();
    positiveControls(records.slice(start));
  }
  function restore() {
    assert.equal(restored, false, "guard restored once");
    for (const record of [...records].reverse()) {
      if (record.descriptor) Object.defineProperty(record.object, record.key, record.descriptor);
      else delete record.object[record.key];
    }
    syncBuiltinESMExports();
    for (const record of records) {
      assert.equal(record.object[record.key], record.original, `identity ${record.label}`);
      assert.deepEqual(Object.getOwnPropertyDescriptor(record.object, record.key), record.descriptor, `descriptor ${record.label}`);
    }
    for (const item of namedBefore) assert.equal(item.namespace[item.key], item.value, `ESM restore ${item.key}`);
    restored = true;
  }
  return { records, snapshot, assertUnchanged, positiveControls, installRuntimeFileGuard, restore };
}

const guard = installGuard();
let api;
let runCli;
let isCliEntry;
let loadTime;
try {
  api = await import("../src/check-config.mjs");
  ({ runCli, isCliEntry } = await import("../cli.mjs"));
  loadTime = Object.freeze(guard.snapshot());
  for (const [label, count] of Object.entries(loadTime)) assert.equal(count, 0, `load time ${label}`);
  guard.positiveControls(); // Deliberately do not reset cumulative counters.
  guard.installRuntimeFileGuard();
} catch (error) {
  guard.restore();
  throw error;
}
const baseline = guard.snapshot();
after(() => {
  try { guard.assertUnchanged(baseline, "entire application test window has zero guarded side effects"); }
  finally { guard.restore(); }
});

const SCHEMA = "hk-ai-08-offline-config-v1";
const boolKeys = ["schemaValid", "deviceRefMatches", "hostExplicit", "hostSyntaxValid", "hostMatchesApproval",
  "allowedHostMatchesTarget", "portExplicit", "portValid", "allowedPortsExplicit", "allowedPortsValid",
  "portMatchesApproval", "allowedPortMatchesTarget", "modelExplicit", "modelMatchesApproval", "allowReadDisabled"];
const countKeys = ["submittedTargetCount", "allowedHostCount", "allowedPortCount"];
const knownCodes = ["OK", "INVALID_INPUT", "INVALID_TARGET", "TARGET_MISMATCH", "INVALID_PORT", "PORT_MISMATCH",
  "MODEL_MISMATCH", "READ_NOT_DISABLED", "INTERNAL_ERROR"];

function fixture() {
  return { schemaVersion: SCHEMA, approvalRef: "SYNTHETIC-APPROVAL", approvedTarget: {
    deviceRef: "SYNTHETIC-DEVICE", host: "192.0.2.10", port: "443", model: "SYNTHETIC-MODEL",
  }, candidate: {
    deviceRef: "SYNTHETIC-DEVICE", host: "192.0.2.10", allowedHosts: "192.0.2.10", port: "443",
    allowedPorts: "443", expectedModel: "SYNTHETIC-MODEL", allowRead: false,
  } };
}
function allHosts(value, host) {
  value.approvedTarget.host = host;
  value.candidate.host = host;
  value.candidate.allowedHosts = host;
}
function allPorts(value, port) {
  value.approvedTarget.port = port;
  value.candidate.port = port;
  value.candidate.allowedPorts = port;
}
function assertResult(result, code) {
  assert.deepEqual(Object.keys(result).sort(), ["schemaVersion", "scope", "status", "code", "checks"].sort());
  assert.equal(result.schemaVersion, SCHEMA);
  assert.equal(result.scope, "offline-format-and-match-only");
  assert.equal(result.status, code === "OK" ? "PASS" : "FAIL");
  assert.equal(result.code, code);
  assert.ok(knownCodes.includes(result.code));
  assert.deepEqual(Object.keys(result.checks).sort(), [...boolKeys, ...countKeys].sort());
  for (const key of boolKeys) assert.equal(typeof result.checks[key], "boolean", key);
  for (const key of countKeys) assert.ok(Number.isSafeInteger(result.checks[key]) && result.checks[key] >= 0, key);
  if (code === "OK") {
    for (const key of boolKeys) assert.equal(result.checks[key], true, key);
    for (const key of countKeys) assert.equal(result.checks[key], 1, key);
  }
  assert.equal(Object.hasOwn(result, "approvalValid"), false);
  assert.equal(Object.hasOwn(result.checks, "sameConfigBound"), false);
  const serialized = JSON.stringify(result);
  for (const forbidden of ["192.0.2.10", "SYNTHETIC-APPROVAL", "SYNTHETIC-DEVICE", "SYNTHETIC-MODEL", "SECRET_SENTINEL", "stack", "/workspace/"]) {
    assert.equal(serialized.includes(forbidden), false, `response leaks ${forbidden}`);
  }
  assert.equal(/[a-f0-9]{64}/i.test(serialized), false, "no derived digest");
}
async function cliText(text, { chunks, checkJson } = {}) {
  const pieces = chunks || [Buffer.from(text)];
  const source = pieces.map((piece) => Buffer.isBuffer(piece) ? Buffer.from(piece) : piece);
  const before = source.map((piece) => Buffer.isBuffer(piece) ? Buffer.from(piece) : piece);
  const output = [];
  const writable = new Writable({ write(chunk, encoding, callback) { output.push(Buffer.from(chunk)); callback(); } });
  const counters = guard.snapshot();
  const exit = await runCli({ input: Readable.from(source), output: writable, ...(checkJson ? { checkJson } : {}) });
  guard.assertUnchanged(counters);
  assert.deepEqual(source, before, "CLI input chunks unchanged");
  const raw = Buffer.concat(output).toString("utf8");
  assert.equal(raw.endsWith("\n"), true);
  assert.equal(raw.trimEnd().split("\n").length, 1, "single JSON line");
  return { exit, result: JSON.parse(raw), raw };
}
function expectedExit(code) { return code === "OK" ? 0 : code === "INTERNAL_ERROR" ? 3 : 2; }
async function checkCase(input, code, { cli = true } = {}) {
  const before = structuredClone(input);
  const counters = guard.snapshot();
  const result = api.checkOfflineConfig(input);
  const afterSnapshot = structuredClone(input);
  assert.deepEqual(afterSnapshot, before, "full input unchanged");
  guard.assertUnchanged(counters);
  assertResult(result, code);
  const text = JSON.stringify(input);
  assertResult(api.checkOfflineConfigJson(text), code);
  guard.assertUnchanged(counters);
  if (cli) {
    const checked = await cliText(text);
    assertResult(checked.result, code);
    assert.equal(checked.exit, expectedExit(code));
  }
}
async function scenario(t, name, code, mutate) {
  await t.test(name, async () => {
    const value = fixture();
    mutate(value);
    await checkCase(value, code);
  });
}

test("OC01 strict output whitelist and valid IPv4", async () => { await checkCase(fixture(), "OK"); });
test("OC02 valid IPv6 syntax and text normalization", async (t) => {
  for (const host of ["2001:db8::10", " 2001:DB8::ABCD ", "::1", "::ffff:192.0.2.10"]) {
    await scenario(t, host, "OK", (value) => allHosts(value, host));
  }
});
test("OC03 valid ASCII DNS without resolving", async (t) => {
  for (const host of ["example.invalid", " EXAMPLE.INVALID ", "123.example", "a", `${"a".repeat(63)}.invalid`]) {
    await scenario(t, host, "OK", (value) => allHosts(value, host));
  }
  await scenario(t, "Unicode boundary whitespace trims around ASCII host", "OK", (value) => allHosts(value, "\u00a0k.example\ufeff"));
});
test("OC04 format-valid target mismatches", async (t) => {
  for (const [name, mutate] of [
    ["different candidate host", (v) => { v.candidate.host = "192.0.2.11"; }],
    ["different allowed host", (v) => { v.candidate.allowedHosts = "example.invalid"; }],
    ["different deviceRef", (v) => { v.candidate.deviceRef = "OTHER-SYNTHETIC"; }],
    ["equivalent IPv6 text is not silently canonicalized", (v) => { allHosts(v, "2001:db8::1"); v.candidate.host = "2001:db8:0:0:0:0:0:1"; }],
  ]) await scenario(t, name, "TARGET_MISMATCH", mutate);
});
test("OC05 forbidden host syntax in all three locations", async (t) => {
  const hosts = ["192.0.2.10/24", "*.invalid", "https://example.invalid", "user@example.invalid", "example.invalid/path",
    "example.invalid?x", "example.invalid#x", "[2001:db8::1]", "fe80::1%eth0", "example.invalid:443", "2001:::1",
    "-bad.invalid", "bad-.invalid", "a..invalid", "example.invalid.", "é.invalid", "\u212a.example", `${"x".repeat(64)}.invalid`,
    "127.1", "2130706433", "0x7f000001", "0177.0.0.1", "0x7f.0.0.1", "256.0.0.1", "192.00.2.1", "192.0.2.1.1"];
  for (const [location, set] of [
    ["approved", (v, h) => { v.approvedTarget.host = h; }],
    ["candidate", (v, h) => { v.candidate.host = h; }],
    ["allowed", (v, h) => { v.candidate.allowedHosts = h; }],
  ]) for (const host of hosts) await scenario(t, `${location}:${host}`, "INVALID_TARGET", (v) => set(v, host));
  await scenario(t, "all Unicode Kelvin host values do not fold into ASCII PASS", "INVALID_TARGET", (v) => allHosts(v, "\u212a.example"));
  await scenario(t, "ASCII approval and Kelvin candidate/list are still invalid syntax", "INVALID_TARGET", (v) => {
    allHosts(v, "k.example");
    v.candidate.host = "\u212a.example";
    v.candidate.allowedHosts = "\u212a.example";
  });
  await scenario(t, "Unicode allowlist item is not silently discarded", "INVALID_TARGET", (v) => {
    allHosts(v, "k.example");
    v.candidate.allowedHosts = "k.example,\u212a.example";
  });
});
test("OC06 explicit host/list cardinality and empty-item rule", async (t) => {
  await scenario(t, "missing allowedHosts", "INVALID_INPUT", (v) => { delete v.candidate.allowedHosts; });
  for (const host of ["", "   "]) await scenario(t, `empty host ${JSON.stringify(host)}`, "INVALID_TARGET", (v) => { v.candidate.host = host; });
  for (const list of ["", ", ,", "192.0.2.10,192.0.2.11", "192.0.2.10,192.0.2.10"]) {
    await scenario(t, `invalid list ${JSON.stringify(list)}`, "INVALID_TARGET", (v) => { v.candidate.allowedHosts = list; });
  }
  await scenario(t, "empty items filtered before host count", "OK", (v) => { v.candidate.allowedHosts = ", 192.0.2.10, ,"; });
  for (const location of ["approvedTarget", "candidate"]) await scenario(t, `empty ref ${location}`, "INVALID_TARGET", (v) => { v[location].deviceRef = ""; });
});
test("OC07 port types, literal grammar, range and preserved empty items", async (t) => {
  for (const [location, key] of [["approvedTarget", "port"], ["candidate", "port"], ["candidate", "allowedPorts"]]) {
    await scenario(t, `missing ${location}.${key}`, "INVALID_INPUT", (v) => { delete v[location][key]; });
    for (const bad of [443, null, false, {}, []]) await scenario(t, `wrong type ${location}.${key}:${JSON.stringify(bad)}`, "INVALID_INPUT", (v) => { v[location][key] = bad; });
    for (const bad of ["", "0", "65536", "-1", "+443", "443.0", "4e2", "0x1bb", "443x", "443\n"]) {
      if (key === "allowedPorts" && bad === "443\n") continue;
      await scenario(t, `bad grammar ${location}.${key}:${JSON.stringify(bad)}`, "INVALID_PORT", (v) => { v[location][key] = bad; });
    }
  }
  for (const location of ["approvedTarget", "candidate"]) for (const bad of [" 443", "443 "]) {
    await scenario(t, `untrimmed ${location}:${bad}`, "INVALID_PORT", (v) => { v[location].port = bad; });
  }
  for (const bad of ["443,", ",443", "443,,443", "443,443", "443,garbage", " , "]) {
    await scenario(t, `allowedPorts ${JSON.stringify(bad)}`, "INVALID_PORT", (v) => { v.candidate.allowedPorts = bad; });
  }
  await scenario(t, "trim allowedPorts item", "OK", (v) => { v.candidate.allowedPorts = " 443 "; });
  for (const port of ["1", "65535", "00443"]) await scenario(t, `valid ${port}`, "OK", (v) => allPorts(v, port));
});
test("OC08 port and exact model mismatches", async (t) => {
  for (const [name, mutate] of [
    ["candidate port", (v) => { v.candidate.port = "8443"; }],
    ["allowed port", (v) => { v.candidate.allowedPorts = "8443"; }],
    ["approved port", (v) => { v.approvedTarget.port = "8443"; }],
  ]) await scenario(t, name, "PORT_MISMATCH", mutate);
  for (const location of ["approvedTarget", "candidate"]) for (const model of ["", "   ", "synthetic-model", "SYNTHETIC-MODEL ", "OTHER-MODEL"]) {
    await scenario(t, `${location}:${JSON.stringify(model)}`, "MODEL_MISMATCH", (v) => { v[location][location === "candidate" ? "expectedModel" : "model"] = model; });
  }
});
test("OC09 strict allowRead and frozen error priority", async (t) => {
  await scenario(t, "boolean true", "READ_NOT_DISABLED", (v) => { v.candidate.allowRead = true; });
  await scenario(t, "string false", "INVALID_INPUT", (v) => { v.candidate.allowRead = "false"; });
  await scenario(t, "missing allowRead", "INVALID_INPUT", (v) => { delete v.candidate.allowRead; });
  await scenario(t, "shape before target", "INVALID_INPUT", (v) => { delete v.candidate.port; v.candidate.host = "*"; });
  await scenario(t, "target grammar before mismatch", "INVALID_TARGET", (v) => { v.candidate.host = "OTHER.invalid"; v.approvedTarget.host = "*"; });
  await scenario(t, "target mismatch before port grammar", "TARGET_MISMATCH", (v) => { v.candidate.host = "other.invalid"; v.candidate.port = "bad"; });
  await scenario(t, "port grammar before model", "INVALID_PORT", (v) => { v.candidate.port = "bad"; v.candidate.expectedModel = ""; });
  await scenario(t, "port mismatch before model", "PORT_MISMATCH", (v) => { v.candidate.port = "8443"; v.candidate.expectedModel = ""; });
  await scenario(t, "model before read", "MODEL_MISMATCH", (v) => { v.candidate.expectedModel = ""; v.candidate.allowRead = true; });
});
test("OC10 exact JSON data shape, duplicate decoded keys and inert reflection", async (t) => {
  for (const key of ["password", "token", "CA", "approvalValid", "sameConfigBound", "other"]) {
    for (const location of ["root", "approvedTarget", "candidate"]) await scenario(t, `${location} extra ${key}`, "INVALID_INPUT", (v) => {
      (location === "root" ? v : v[location])[key] = "SECRET_SENTINEL";
    });
  }
  for (const value of [null, false, "x", 1, [], new Date(), () => {}]) await t.test(`root ${typeof value}`, () => {
    assertResult(api.checkOfflineConfig(value), "INVALID_INPUT");
  });
  await scenario(t, "target array", "INVALID_INPUT", (v) => { v.approvedTarget = [v.approvedTarget]; });
  await scenario(t, "schema version", "INVALID_INPUT", (v) => { v.schemaVersion = "other"; });
  await scenario(t, "empty approvalRef", "INVALID_INPUT", (v) => { v.approvalRef = ""; });
  for (const [location, key] of [["root", "approvalRef"], ["candidate", "expectedModel"], ["approvedTarget", "deviceRef"]]) {
    await scenario(t, `reference/model length ${location}`, "INVALID_INPUT", (v) => { (location === "root" ? v : v[location])[key] = "x".repeat(129); });
  }
  await scenario(t, "host text length", "INVALID_INPUT", (v) => { v.candidate.host = "x".repeat(254); });
  for (const kind of ["hidden-extra", "hidden-known", "symbol", "getter-known", "getter-extra", "toJSON"]) {
    await t.test(kind, () => {
      const input = fixture();
      let getterCalls = 0;
      if (kind === "hidden-extra") Object.defineProperty(input.candidate, "secret", { value: undefined, configurable: true });
      if (kind === "hidden-known") Object.defineProperty(input.candidate, "host", { enumerable: false });
      if (kind === "symbol") input.candidate[Symbol("SECRET_SENTINEL")] = undefined;
      if (kind === "getter-known") Object.defineProperty(input.candidate, "host", { enumerable: true, configurable: true, get() { getterCalls++; return "192.0.2.10"; } });
      if (kind === "getter-extra") Object.defineProperty(input, "secret", { enumerable: true, get() { getterCalls++; return "SECRET_SENTINEL"; } });
      if (kind === "toJSON") Object.defineProperty(input, "toJSON", { enumerable: false, value() { getterCalls++; return {}; } });
      const beforeKeys = Reflect.ownKeys(input.candidate);
      const before = Object.getOwnPropertyDescriptors(input);
      const nestedBefore = Object.getOwnPropertyDescriptors(input.candidate);
      const counters = guard.snapshot();
      assertResult(api.checkOfflineConfig(input), "INVALID_INPUT");
      assert.deepEqual(Object.getOwnPropertyDescriptors(input), before);
      assert.deepEqual(Object.getOwnPropertyDescriptors(input.candidate), nestedBefore);
      assert.deepEqual(Reflect.ownKeys(input.candidate), beforeKeys);
      assert.equal(getterCalls, 0);
      guard.assertUnchanged(counters);
    });
  }
  const original = JSON.stringify(fixture());
  for (const text of [
    original.replace('"approvalRef":"SYNTHETIC-APPROVAL"', '"approvalRef":"SYNTHETIC-APPROVAL","approvalRef":"SECRET_SENTINEL"'),
    original.replace('"host":"192.0.2.10"', '"host":"192.0.2.10","ho\\u0073t":"SECRET_SENTINEL"'),
    original.replace('"allowRead":false', '"allowRead":false,"allowRead":false'),
  ]) await t.test("duplicate JSON key including decoded escapes", async () => {
    assertResult(api.checkOfflineConfigJson(text), "INVALID_INPUT");
    const checked = await cliText(text);
    assertResult(checked.result, "INVALID_INPUT");
    assert.equal(checked.exit, 2);
  });
});
test("OC11 malformed/oversize/UTF-8/chunk failures and fixed internal errors", async (t) => {
  for (const multibyte of [false, true]) await t.test(`exact UTF-8 byte boundary multibyte=${multibyte}`, async () => {
    const input = fixture();
    if (multibyte) input.approvalRef = "合成引用";
    const json = JSON.stringify(input);
    const padding = 16 * 1024 - Buffer.byteLength(json, "utf8");
    const text = " ".repeat(padding) + json;
    assert.equal(Buffer.byteLength(text, "utf8"), 16 * 1024);
    assertResult(api.checkOfflineConfigJson(text), "OK");
    const exact = await cliText(text);
    assertResult(exact.result, "OK");
    assert.equal(exact.exit, 0);
    const oversized = text + " ";
    assertResult(api.checkOfflineConfigJson(oversized), "INVALID_INPUT");
    const rejected = await cliText(oversized);
    assertResult(rejected.result, "INVALID_INPUT");
    assert.equal(rejected.exit, 2);
  });
  await t.test("library total size rejects independently legal field lengths", async () => {
    const input = fixture();
    input.candidate.allowedHosts = " ".repeat(9000) + input.candidate.host;
    input.candidate.allowedPorts = " ".repeat(9000) + input.candidate.port;
    assert.ok(Buffer.byteLength(input.candidate.allowedHosts) < 16 * 1024);
    assert.ok(Buffer.byteLength(input.candidate.allowedPorts) < 16 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(input)) > 16 * 1024);
    await checkCase(input, "INVALID_INPUT");
  });
  await t.test("oversize stream stops without requesting the next chunk", async () => {
    let pulls = 0;
    let returned = false;
    const input = {
      async *[Symbol.asyncIterator]() {
        try {
          pulls++;
          yield Buffer.alloc(16 * 1024 + 1, 0x20);
          pulls++;
          throw new Error("SECRET_SENTINEL second chunk must not be requested");
        } finally { returned = true; }
      },
    };
    const output = [];
    const writable = new Writable({ write(chunk, encoding, callback) { output.push(Buffer.from(chunk)); callback(); } });
    const exit = await runCli({ input, output: writable });
    assert.equal(exit, 2);
    assertResult(JSON.parse(Buffer.concat(output).toString("utf8")), "INVALID_INPUT");
    assert.equal(pulls, 1);
    assert.equal(returned, true);
  });
  await t.test("TTY input fails without waiting or asking for data", async () => {
    let reads = 0;
    const input = { isTTY: true, [Symbol.asyncIterator]() { reads++; throw new Error("SECRET_SENTINEL"); } };
    const output = [];
    const writable = new Writable({ write(chunk, encoding, callback) { output.push(Buffer.from(chunk)); callback(); } });
    assert.equal(await runCli({ input, output: writable }), 2);
    assertResult(JSON.parse(Buffer.concat(output).toString("utf8")), "INVALID_INPUT");
    assert.equal(reads, 0);
  });
  for (const text of ["", " ", "{", "undefined", "{} trailing", "\ufeff" + JSON.stringify(fixture()),
    JSON.stringify({ ...fixture(), approvalRef: "x".repeat(17000) }),
    JSON.stringify({ ...fixture(), approvalRef: "界".repeat(6000) }),
    "[".repeat(5000) + "]".repeat(5000)]) {
    await t.test(`invalid JSON/text length ${Buffer.byteLength(text)}`, async () => {
      assertResult(api.checkOfflineConfigJson(text), "INVALID_INPUT");
      const checked = await cliText(text);
      assertResult(checked.result, "INVALID_INPUT");
      assert.equal(checked.exit, 2);
    });
  }
  await t.test("invalid UTF-8 bytes", async () => {
    const checked = await cliText("", { chunks: [Buffer.from([0xc3, 0x28])] });
    assertResult(checked.result, "INVALID_INPUT");
    assert.equal(checked.exit, 2);
  });
  await t.test("multi-byte chunks preserved", async () => {
    const input = fixture();
    input.approvalRef = "合成引用";
    const bytes = Buffer.from(JSON.stringify(input));
    const checked = await cliText("", { chunks: [...bytes].map((byte) => Buffer.from([byte])) });
    assertResult(checked.result, "OK");
    assert.equal(checked.exit, 0);
  });
  await t.test("injected internal parser failure", async () => {
    const checked = await cliText(JSON.stringify(fixture()), { checkJson() { throw new Error("SECRET_SENTINEL /workspace/SECRET_SENTINEL"); } });
    assertResult(checked.result, "INTERNAL_ERROR");
    assert.equal(checked.exit, 3);
  });
  for (const kind of ["getter", "extra-key", "proxy"]) await t.test(`injected callback result ${kind} cannot leak`, async () => {
    let callbacks = 0;
    const result = {
      schemaVersion: SCHEMA, scope: "offline-format-and-match-only", status: "PASS", code: "OK",
      checks: Object.fromEntries([...boolKeys.map((key) => [key, true]), ...countKeys.map((key) => [key, 1])]),
    };
    let payload = result;
    if (kind === "getter") Object.defineProperty(result, "status", { enumerable: true, get() { callbacks++; return "SECRET_SENTINEL"; } });
    if (kind === "extra-key") result.secret = "SECRET_SENTINEL";
    if (kind === "proxy") payload = new Proxy(result, { ownKeys() { callbacks++; throw new Error("SECRET_SENTINEL"); } });
    const checked = await cliText(JSON.stringify(fixture()), { checkJson() { return payload; } });
    assertResult(checked.result, "INTERNAL_ERROR");
    assert.equal(checked.exit, 3);
    assert.equal(callbacks, 0);
  });
  await t.test("input stream failure sanitized", async () => {
    const input = new Readable({ read() { this.destroy(new Error("SECRET_SENTINEL")); } });
    const output = [];
    const writable = new Writable({ write(chunk, encoding, callback) { output.push(Buffer.from(chunk)); callback(); } });
    const exit = await runCli({ input, output: writable });
    const result = JSON.parse(Buffer.concat(output).toString("utf8"));
    assertResult(result, "INTERNAL_ERROR");
    assert.equal(exit, 3);
  });
  await t.test("throwing proxy is rejected before reflection", () => {
    let trapCalls = 0;
    const proxy = new Proxy({}, { ownKeys() { trapCalls++; throw new Error("SECRET_SENTINEL"); } });
    assertResult(api.checkOfflineConfig(proxy), "INVALID_INPUT");
    assert.equal(trapCalls, 0);
  });
  for (const trap of ["ownKeys", "getPrototypeOf"]) await t.test(`hostile thrown proxy from ${trap} is not inspected`, () => {
    let exceptionTouches = 0;
    const hostileError = new Proxy({}, {
      getPrototypeOf() { exceptionTouches++; throw new Error("SECRET_SENTINEL"); },
      get() { exceptionTouches++; throw new Error("SECRET_SENTINEL"); },
    });
    let inputTrapCalls = 0;
    const input = new Proxy({}, { [trap]() { inputTrapCalls++; throw hostileError; } });
    let escaped = false;
    let result;
    try { result = api.checkOfflineConfig(input); } catch { escaped = true; }
    assert.equal(escaped, false, "never let arbitrary thrown objects escape");
    assertResult(result, "INVALID_INPUT");
    assert.equal(inputTrapCalls, 0);
    assert.equal(exceptionTouches, 0, "do not inspect error prototypes/getters");
  });
  await t.test("Writable callback error is contained and listeners restored", async () => {
    const writable = new Writable({ write(chunk, encoding, callback) { callback(new Error("SECRET_SENTINEL /workspace/SECRET_SENTINEL")); } });
    const beforeListeners = writable.rawListeners("error");
    const input = Buffer.from(JSON.stringify(fixture()));
    const beforeInput = Buffer.from(input);
    const counters = guard.snapshot();
    const exit = await runCli({ input: Readable.from([input]), output: writable });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(exit, 3);
    assert.deepEqual(writable.rawListeners("error"), beforeListeners);
    assert.deepEqual(input, beforeInput);
    guard.assertUnchanged(counters);
  });
  await t.test("Writable delayed destruction settles error and close before returning", async () => {
    const events = [];
    let writes = 0;
    const writable = new Writable({
      write(chunk, encoding, callback) { writes++; callback(new Error("SECRET_SENTINEL")); },
      destroy(error, callback) { setTimeout(() => callback(error), 20); },
    });
    // Test-owned persistent observers prevent an unhandled late event even if
    // the implementation returns prematurely. They do not make it pass: both
    // terminal events must already be observed when runCli resolves.
    const errorObserver = () => events.push("error");
    const closeObserver = () => events.push("close");
    writable.on("error", errorObserver);
    writable.on("close", closeObserver);
    const beforeError = writable.rawListeners("error");
    const beforeClose = writable.rawListeners("close");
    const input = Buffer.from(JSON.stringify(fixture()));
    const beforeInput = Buffer.from(input);
    const counters = guard.snapshot();
    try {
      const exit = await runCli({ input: Readable.from([input]), output: writable });
      assert.equal(exit, 3);
      assert.deepEqual(events, ["error", "close"], "runCli must await actual terminal stream events");
      assert.deepEqual(writable.rawListeners("error"), beforeError);
      assert.deepEqual(writable.rawListeners("close"), beforeClose);
      assert.deepEqual(input, beforeInput);
      assert.equal(writes, 1);
      guard.assertUnchanged(counters);
    } finally {
      // Cleanup waits only after assertions; it cannot satisfy the return-time
      // oracle above and protects a failed run from its own late error event.
      if (!writable.closed) await new Promise((resolve) => writable.once("close", resolve));
      writable.off("error", errorObserver);
      writable.off("close", closeObserver);
    }
  });
  for (const location of ["root", "approvedTarget", "candidate"]) await t.test(`transparent Proxy ${location} cannot mutate via traps`, () => {
    const input = fixture();
    const target = location === "root" ? input : input[location];
    const before = structuredClone(target);
    const descriptors = Object.getOwnPropertyDescriptors(target);
    let traps = 0;
    const proxy = new Proxy(target, {
      getPrototypeOf(value) { traps++; value.trapMutation = true; return Object.getPrototypeOf(value); },
      ownKeys(value) { traps++; value.trapMutation = true; return Reflect.ownKeys(value); },
      getOwnPropertyDescriptor(value, key) { traps++; value.trapMutation = true; return Object.getOwnPropertyDescriptor(value, key); },
      get(value, key) { traps++; value.trapMutation = true; return value[key]; },
    });
    if (location !== "root") input[location] = proxy;
    const counters = guard.snapshot();
    assertResult(api.checkOfflineConfig(location === "root" ? proxy : input), "INVALID_INPUT");
    assert.equal(traps, 0);
    assert.deepEqual(structuredClone(target), before);
    assert.deepEqual(Object.getOwnPropertyDescriptors(target), descriptors);
    guard.assertUnchanged(counters);
  });
  for (const location of ["root", "approvedTarget", "candidate"]) await t.test(`revoked Proxy ${location} fails closed`, () => {
    const input = fixture();
    const target = location === "root" ? input : input[location];
    const before = structuredClone(target);
    const pair = Proxy.revocable(target, {});
    pair.revoke();
    if (location !== "root") input[location] = pair.proxy;
    assertResult(api.checkOfflineConfig(location === "root" ? pair.proxy : input), "INVALID_INPUT");
    assert.deepEqual(structuredClone(target), before);
  });
});
test("OC12 full immutable snapshots, fresh results and inert module imports", async (t) => {
  const value = fixture();
  for (const object of [value.approvedTarget, value.candidate, value]) Object.freeze(object);
  await checkCase(value, "OK");
  const nullProto = fixture();
  for (const key of ["approvedTarget", "candidate"]) Object.setPrototypeOf(nullProto[key], null);
  Object.setPrototypeOf(nullProto, null);
  const beforeDescriptors = Object.getOwnPropertyDescriptors(nullProto);
  assertResult(api.checkOfflineConfig(nullProto), "OK");
  assert.deepEqual(Object.getOwnPropertyDescriptors(nullProto), beforeDescriptors);
  const first = api.checkOfflineConfig(fixture());
  first.checks.hostSyntaxValid = false;
  assertResult(api.checkOfflineConfig(fixture()), "OK");
  const entry = "/synthetic/space folder/cli.mjs";
  const url = pathToFileURL(entry).href;
  for (const [name, meta, entryPath, expected] of [
    ["modern main true", { main: true, url }, "/synthetic/other.mjs", true],
    ["modern main false", { main: false, url }, entry, false],
    ["string main not coerced", { main: "true", url }, entry, false],
    ["numeric main not coerced", { main: 0, url }, entry, false],
    ["null main not coerced", { main: null, url }, entry, false],
    ["missing main matches encoded file URL", { url }, entry, true],
    ["undefined main matches encoded file URL", { main: undefined, url }, entry, true],
    ["missing main different path", { url }, "/synthetic/other.mjs", false],
    ["missing main without entry", { url }, undefined, false],
  ]) await t.test(`entry metadata synthetic: ${name}`, () => {
    const before = structuredClone(meta);
    const counters = guard.snapshot();
    assert.equal(isCliEntry(meta, entryPath), expected);
    const afterSnapshot = structuredClone(meta);
    assert.deepEqual(afterSnapshot, before);
    guard.assertUnchanged(counters);
  });
});
test("OC13 PASS asserts no approval authenticity or later config binding", async () => {
  await checkCase(fixture(), "OK");
  const checked = await cliText(JSON.stringify(fixture()));
  assert.equal(checked.raw.includes("approvalValid"), false);
  assert.equal(checked.raw.includes("sameConfigBound"), false);
  assert.equal(checked.raw.includes("E1"), false);
});
test("OC14 real entry-point controls, preserved load-time counters, ESM and exact restoration", (t) => {
  assert.ok(guard.records.length >= 79, "enumerated runtime guard inventory unexpectedly incomplete");
  assert.equal(new Set(guard.records.map((record) => record.label)).size, guard.records.length);
  const required = ["fetch", "http.request", "https.get", "net.Socket.connect", "net.Server.listen", "tls.connect",
    "dgram.Socket.send", "dgram.Socket.bind", "dgram.Socket.connect", "dns.promises.lookup", "dns.Resolver.resolve",
    "dns.promises.Resolver.resolve", "child_process.spawnSync", "child_process.fork", "child_process.ChildProcess.spawn", "fs.readFileSync", "fs.promises.readFile"];
  for (const name of required) assert.ok(guard.records.some((record) => record.aliases.includes(name)), name);
  for (const count of Object.values(loadTime)) assert.equal(count, 0, "load-time evidence retained");
  guard.assertUnchanged(baseline, "controls not mistaken for application traffic");
  t.diagnostic(`guardEntries=${guard.records.length} networkAndProcessEntries=${guard.records.filter((r) => r.kind === "network").length} runtimeFileEntries=${guard.records.filter((r) => r.kind === "file").length}`);
  t.diagnostic(`guardLoadTime=${JSON.stringify(loadTime)} businessSideEffectDelta=0`);
  t.diagnostic("scope: network/process guards cover loading and application; fs guards cover runtime only; process.env prohibition is source-reviewed, not a global env proxy");
});
