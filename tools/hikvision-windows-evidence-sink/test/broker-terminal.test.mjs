import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, TextDecoder, types } from "node:util";
import * as vm from "node:vm";

// Run directly with Node 24 and --experimental-vm-modules. The warning on the
// real stderr is deliberately retained. Only the five named production sources
// are read. SourceTextModule receives their original UTF-8 text, unmodified.
// Every production spawn, filesystem operation, timer and child pipe is replaced
// at its imported dependency/global boundary, in a fresh realm for each case.
// This driver neither imports the real broker normally nor invokes native code.
const SCOPE = "synthetic-memory-broker-terminal-regression";
const IDS = ["deviceInfo", "acsCapabilities", "userInfoCapabilities", "fdlibCapabilities", "fdlibList", "fdlibCount"];
const CHECKS = [
  "platformSupported", "identitySupported", "locationSupported", "ancestorHandlesHeld",
  "rootCreatedExclusive", "rootAclValid", "nativeIdentityValid", "rootEntriesValid",
  "filesCreatedExclusive", "fileAclsValid", "contentVerified", "flushVerified", "deleteSharingDenied",
];
const FILE_CHECKS = new Set(["filesCreatedExclusive", "fileAclsValid", "contentVerified", "flushVerified"]);
const SOURCE_URLS = Object.freeze({
  broker: new URL("../src/native-broker.mjs", import.meta.url),
  bridge: new URL("../../hikvision-offline-config-binding/src/bridge.mjs", import.meta.url),
  checker: new URL("../../hikvision-offline-config-checker/src/check-config.mjs", import.meta.url),
  bytes: new URL("../../hikvision-offline-entry/src/bytes.mjs", import.meta.url),
  entry: new URL("../src/entry.mjs", import.meta.url),
});
const SOURCES = new Map();
for (const [name, url] of Object.entries(SOURCE_URLS)) {
  const bytes = await readFile(url);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!Buffer.from(source, "utf8").equals(bytes)) throw new Error("HARNESS_SOURCE_BYTES_CHANGED");
  SOURCES.set(url.href, { name, source, sha256: createHash("sha256").update(bytes).digest("hex") });
}
const SOURCE_AUDIT = [...SOURCES].map(([url, value]) => ({ name: value.name, path: fileURLToPath(url), sha256: value.sha256 }));
const plain = (value) => value === undefined ? null : JSON.parse(JSON.stringify(value));

async function settle(promise) {
  let done = false, value, failed;
  Promise.resolve(promise).then((result) => { done = true; value = result; }, () => { done = true; failed = true; });
  for (let index = 0; index < 2048 && !done; index += 1) await Promise.resolve();
  if (!done) throw new Error("HARNESS_PROMISE_NOT_SETTLED");
  if (failed) throw new Error("HARNESS_PROMISE_REJECTED");
  return value;
}
async function flush() { for (let index = 0; index < 32; index += 1) await Promise.resolve(); }

function summaryFixture() {
  return {
    schemaVersion: "hk-ai-08-offline-summary-v1", phase: "synthetic-offline-only", status: "PASS", code: "OK",
    counts: { logicalEndpoints: 6, transmissions: 6, authRetries: 0, unknownEndpoints: 0 },
    stages: IDS.map((id) => ({ id, state: "confirmed", code: "OK", httpStatus: 200, transmissions: 1 })),
    allowReadStayedFalse: true,
  };
}
function contextFixture() {
  return {
    versions: { tool: "558b9c864a4b820e397336200758b143556a4d87", checker: "31f20c9a372c447f142312f6e95e0400372f9ee8", adapter: "synthetic-binding-v1", endpoints: "hk-ai-08-six-get-v1" },
    output: { rootRef: "synthetic-root-terminal", policyRef: "synthetic-windows-handle-acl-v1" },
  };
}
function endpointsFixture() {
  return [
    { id: "deviceInfo", method: "GET", path: "/ISAPI/System/deviceInfo", expect: "xml" },
    { id: "acsCapabilities", method: "GET", path: "/ISAPI/AccessControl/capabilities", expect: "xml" },
    { id: "userInfoCapabilities", method: "GET", path: "/ISAPI/AccessControl/UserInfo/capabilities?format=json", expect: "json" },
    { id: "fdlibCapabilities", method: "GET", path: "/ISAPI/Intelligent/FDLib/capabilities?format=json", expect: "json" },
    { id: "fdlibList", method: "GET", path: "/ISAPI/Intelligent/FDLib?format=json", expect: "json" },
    { id: "fdlibCount", method: "GET", path: "/ISAPI/Intelligent/FDLib/Count?format=json", expect: "json" },
  ];
}
function inputFixture() {
  return {
    schemaVersion: "hk-ai-08-synthetic-binding-v1", dataClass: "synthetic-only", approvalRef: "synthetic-approval-terminal",
    approvedTarget: { deviceRef: "synthetic-device-terminal", host: "192.0.2.10", port: "443", model: "DS-K1T671BM" },
    candidate: { deviceRef: "synthetic-device-terminal", host: "192.0.2.10", allowedHosts: "192.0.2.10", port: "443", allowedPorts: "443", expectedModel: "DS-K1T671BM", allowRead: false },
    execution: {
      tls: { mode: "fingerprint-pinned", fingerprints: ["A".repeat(64)], caBytes: [83, 89, 78, 84, 72] },
      limits: { timeoutMs: 1000, requestDeadlineMs: 2000, sessionDeadlineMs: 10000, maxBytes: 262144 },
      output: { rootRef: "synthetic-root-terminal", policyRef: "synthetic-windows-handle-acl-v1" },
      versions: { tool: "558b9c864a4b820e397336200758b143556a4d87", checker: "31f20c9a372c447f142312f6e95e0400372f9ee8", adapter: "synthetic-binding-v1", endpoints: "hk-ai-08-six-get-v1" },
      credentials: { username: "SYNTHETIC_USER", password: "SYNTHETIC_PASSWORD" }, endpoints: endpointsFixture(),
    },
  };
}
function expectedFixture() {
  // An independent canonical expectation, rather than a production projection.
  return {
    target: { deviceRef: "synthetic-device-terminal", host: "192.0.2.10", port: 443, model: "DS-K1T671BM" },
    tls: { mode: "fingerprint-pinned", fingerprints: ["A".repeat(64)], caBytes: [83, 89, 78, 84, 72] },
    limits: { timeoutMs: 1000, requestDeadlineMs: 2000, sessionDeadlineMs: 10000, maxBytes: 262144 },
    output: { rootRef: "synthetic-root-terminal", policyRef: "synthetic-windows-handle-acl-v1" },
    versions: { tool: "558b9c864a4b820e397336200758b143556a4d87", checker: "31f20c9a372c447f142312f6e95e0400372f9ee8", adapter: "synthetic-binding-v1", endpoints: "hk-ai-08-six-get-v1" },
    credentials: { username: "SYNTHETIC_USER", password: "SYNTHETIC_PASSWORD" }, endpoints: endpointsFixture(), allowRead: false,
  };
}

class MemoryEmitter {
  listeners = new Map();
  on(name, callback) { const list = this.listeners.get(name) ?? []; list.push(callback); this.listeners.set(name, list); return this; }
  emit(name, ...args) { return (this.listeners.get(name) ?? []).map((callback) => callback(...args)); }
}

async function environment(check) {
  const files = new Map(), directories = new Set(), timers = new Map();
  const requests = [], spawns = [], fsCalls = [], closeJobs = [], raw = { stdout: [], stderr: [] };
  const child = new MemoryEmitter();
  child.stdout = new MemoryEmitter(); child.stderr = new MemoryEmitter(); child.stdin = new MemoryEmitter();
  let sequence = 0, timerSequence = 0, killCalls = 0, closed = false, validations = 0, filesWritten = false;
  let evidenceRef = null, compilerRef = null, onRequest = null;
  const parent = fileURLToPath(new URL("../../../../", SOURCE_URLS.broker));
  const workingDirectory = fileURLToPath(new URL("../../../", SOURCE_URLS.broker));
  const host = fileURLToPath(new URL("../native-host.ps1", SOURCE_URLS.broker));
  const enoent = () => Object.assign(new Error("SYNTHETIC_ENOENT"), { code: "ENOENT" });
  const io = {
    async lstat(path) {
      fsCalls.push({ op: "lstat", path });
      if (!directories.has(path)) throw enoent();
      return { isDirectory: () => true, isSymbolicLink: () => false };
    },
    async mkdir(path, options) {
      fsCalls.push({ op: "mkdir", path, options: plain(options) });
      if (path !== join(parent, compilerRef) || options.recursive !== false || options.mode !== 0o700 || directories.has(path)) throw new Error("HARNESS_MKDIR_DENIED");
      directories.add(path);
    },
    async writeFile(path, data, options) {
      fsCalls.push({ op: "writeFile", path, options: plain(options) });
      if (compilerRef === null) {
        // The production launch journal precedes spawn; register its entirely
        // synthetic refs in memory before validating any subsequent fake I/O.
        const journal = JSON.parse(Buffer.from(data).toString("utf8"));
        if (Object.keys(journal).sort().join(",") !== "compilerRef,evidenceRef,phase" ||
            !/^hk-win-compile-[0-9a-f]{32}$/.test(journal.compilerRef) ||
            !/^hk-win-sink-[0-9a-f]{32}$/.test(journal.evidenceRef) ||
            journal.phase !== "allocated-before-host-start" || path !== join(parent, `${journal.compilerRef}.launch.json`)) throw new Error("HARNESS_JOURNAL_DENIED");
        compilerRef = journal.compilerRef; evidenceRef = journal.evidenceRef;
      }
      const allowed = [join(parent, `${compilerRef}.launch.json`), ...["host.stdout.raw", "host.stderr.raw", "host.exitcode.txt", "host-pipes.metadata.json"].map((name) => join(parent, compilerRef, name))];
      if (!allowed.includes(path) || options.flag !== "wx" || files.has(path)) throw new Error("HARNESS_WRITE_DENIED");
      files.set(path, Buffer.from(data));
    },
  };
  function output(kind, data) {
    const bytes = Buffer.from(data); raw[kind].push(Buffer.from(bytes)); child[kind].emit("data", bytes);
  }
  function emitClose(code = 0, signal = null) {
    if (closed) return;
    closed = true;
    for (const job of child.emit("close", code, signal)) closeJobs.push(Promise.resolve(job));
  }
  function native(op) {
    if (op === "validate") validations += 1;
    if (op === "write") filesWritten = true;
    return {
      status: "PASS", code: "OK", evidenceRef, compilerRef,
      checks: Object.fromEntries(CHECKS.map((key) => [key, !FILE_CHECKS.has(key) || filesWritten])),
      counts: { directoriesCreated: 1, filesCreated: filesWritten ? 2 : 0, bytesWritten: filesWritten ? 128 : 0, bytesVerified: filesWritten ? 128 : 0, flushes: filesWritten ? 2 : 0, validationCalls: validations },
      newObjectStateUnverified: false, retained: true, closed: op === "close",
    };
  }
  const line = (request) => Buffer.from(`${JSON.stringify({ id: request.id, native: native(request.op) })}\n`);
  function normal(request) { output("stdout", line(request)); if (request.op === "close") emitClose(); }
  child.stdin.write = (text, callback) => {
    const request = JSON.parse(text);
    requests.push(plain(request));
    if (onRequest) onRequest(request); else normal(request);
    callback(null);
    return true;
  };
  child.kill = () => { killCalls += 1; return true; };
  function spawn(command, args, options) {
    evidenceRef = args[args.indexOf("-EvidenceRef") + 1]; compilerRef = args[args.indexOf("-CompilerRef") + 1];
    spawns.push({ command, args: plain(args), options: plain(options) });
    return child;
  }
  const context = vm.createContext({
    Buffer, URL, process: Object.freeze({ platform: "win32" }),
    setTimeout(callback, ms) { const id = ++timerSequence; timers.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const builtinExports = new Map([
    ["node:child_process", { spawn }],
    ["node:crypto", { randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` }],
    ["node:util", { TextDecoder, types }], ["node:url", { fileURLToPath }],
    ["node:fs/promises", io], ["node:path", { join }], ["node:buffer", { Buffer }], ["node:net", { isIP }],
  ]);
  const modules = new Map();
  for (const [identifier, exports] of builtinExports) {
    modules.set(identifier, new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context, identifier }));
  }
  for (const [identifier, { source }] of SOURCES) {
    modules.set(identifier, new vm.SourceTextModule(source, {
      context, identifier, initializeImportMeta(meta) { meta.url = identifier; },
      importModuleDynamically() { throw new Error("HARNESS_DYNAMIC_IMPORT_DENIED"); },
    }));
  }
  const entry = modules.get(SOURCE_URLS.entry.href);
  await entry.link((specifier, referencing) => {
    const identifier = specifier.startsWith("node:") ? specifier : new URL(specifier, referencing.identifier).href;
    if (!modules.has(identifier)) throw new Error("HARNESS_IMPORT_DENIED");
    return modules.get(identifier);
  });
  await entry.evaluate();
  const broker = modules.get(SOURCE_URLS.broker.href).namespace;
  const realm = (value) => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`, context);
  const api = {
    broker, entry: entry.namespace, requests, files,
    realm, summary: () => realm(summaryFixture()), output, emitClose, line, normal,
    set handler(value) { onRequest = value; },
    requestShape: () => requests.map(({ id, op }) => ({ id, op })),
    async created() {
      const result = await settle(broker.createNativeEvidenceBroker());
      check("init.status", "PASS", result.status); check("init.code", "OK", result.code);
      check("init.capability.present", true, result.capability !== null && typeof result.capability === "object");
      if (!result.capability) throw new Error("HARNESS_NO_CAPABILITY");
      return result.capability;
    },
    result(label, value, code = "NATIVE_PROTOCOL_INVALID", uncertain = true) {
      check(`${label}.status`, code === "OK" ? "PASS" : "FAIL", value?.status);
      check(`${label}.code`, code, value?.code);
      check(`${label}.uncertain`, uncertain, value?.newObjectStateUnverified);
      check(`${label}.retained`, true, value?.retained);
      check(`${label}.sameSyntheticEvidenceRef`, true, value?.evidenceRef === evidenceRef);
      check(`${label}.sameSyntheticCompilerRef`, true, value?.compilerRef === compilerRef);
    },
    async finish() {
      emitClose();
      await settle(Promise.all(closeJobs));
      const directory = join(parent, compilerRef), stdout = Buffer.concat(raw.stdout), stderr = Buffer.concat(raw.stderr);
      const capturedStdout = files.get(join(directory, "host.stdout.raw"));
      const capturedStderr = files.get(join(directory, "host.stderr.raw"));
      check("audit.spawn.count", 1, spawns.length);
      const expectedSpawn = {
        command: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", host, "-EvidenceRef", evidenceRef, "-CompilerRef", compilerRef],
        options: { cwd: workingDirectory, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      };
      check("audit.spawn.fixed", true, isDeepStrictEqual(expectedSpawn, spawns[0]));
      check("audit.fs.write.count", 5, fsCalls.filter((call) => call.op === "writeFile").length);
      check("audit.fs.mkdir.count", 1, fsCalls.filter((call) => call.op === "mkdir").length);
      check("audit.raw.stdout.prefixExact", true, capturedStdout?.equals(stdout.subarray(0, 262144)) ?? false);
      check("audit.raw.stderr.prefixExact", true, capturedStderr?.equals(stderr.subarray(0, 65536)) ?? false);
      const metadataBytes = files.get(join(directory, "host-pipes.metadata.json"));
      const metadata = metadataBytes ? JSON.parse(metadataBytes.toString("utf8")) : null;
      const expectedMetadata = {
        evidenceRef, compilerRef, stdoutBytesObserved: stdout.length, stdoutBytesCaptured: Math.min(stdout.length, 262144),
        stderrBytesObserved: stderr.length, stderrBytesCaptured: Math.min(stderr.length, 65536), stdoutTruncated: stdout.length > 262144,
        stderrTruncated: stderr.length > 65536, exitCode: 0, signal: null, streamsComplete: stdout.length <= 262144 && stderr.length <= 65536,
        source: "powershell-host-raw-pipes", deviceData: false,
      };
      check("audit.raw.metadataExact", true, isDeepStrictEqual(expectedMetadata, metadata));
      check("audit.raw.byteCounts", {
        stdoutObserved: stdout.length, stdoutCaptured: Math.min(stdout.length, 262144),
        stderrObserved: stderr.length, stderrCaptured: Math.min(stderr.length, 65536),
      }, metadata === null ? null : {
        stdoutObserved: metadata.stdoutBytesObserved, stdoutCaptured: metadata.stdoutBytesCaptured,
        stderrObserved: metadata.stderrBytesObserved, stderrCaptured: metadata.stderrBytesCaptured,
      });
      check("audit.timer.remaining", 0, timers.size);
      check("audit.fakeChild.closed", true, closed);
      const audit = { requests: api.requestShape(), stdinWrites: requests.length, fakeSpawnCalls: spawns.length, memoryFileCount: files.size, killCalls, stdoutBytes: stdout.length, stderrBytes: stderr.length, memoryTimersRemaining: timers.size, fakeChildClosed: closed, fakeCloseHandlersSettled: true };
      // Discard only this case's in-memory containers. No filesystem cleanup is
      // performed, and all observed quantities have already been recorded.
      timers.clear();
      return audit;
    },
  };
  return api;
}

const cases = [];
function test(id, run) { cases.push({ id, run }); }
const ops = (...names) => names.map((op, index) => ({ id: index + 1, op }));

test("BR-P01-single-replies", async (h, check) => {
  const cap = await h.created();
  h.result("validate", await settle(h.broker.validateNativeEvidence(cap)), "OK", false);
  const written = await settle(h.broker.writeNativeEvidence(cap, h.summary()));
  h.result("write", written, "OK", false); check("write.files", 2, written.counts.filesCreated);
  h.result("close", await settle(h.broker.closeNativeEvidence(cap)), "OK", false);
  check("close.closed", true, h.broker.observeNativeEvidence(cap).closed);
  check("rpc.exact", ops("init", "validate", "write", "close"), h.requestShape());
});
test("BR-P02-fragmented-valid-reply", async (h, check) => {
  const cap = await h.created();
  h.handler = (request) => {
    if (request.op !== "write") return h.normal(request);
    const bytes = h.line(request), middle = Math.floor(bytes.length / 2);
    h.output("stdout", bytes.subarray(0, middle)); h.output("stdout", bytes.subarray(middle));
  };
  h.result("write", await settle(h.broker.writeNativeEvidence(cap, h.summary())), "OK", false);
  h.result("close", await settle(h.broker.closeNativeEvidence(cap)), "OK", false);
  check("rpc.exact", ops("init", "write", "close"), h.requestShape());
});

for (const [id, suffix] of [
  ["BR-F01-pass-plus-malformed-line", Buffer.from("SYNTHETIC_INVALID_JSON\n")],
  ["BR-F02-pass-plus-extra-json", Buffer.from('{"id":999,"native":{}}\n')],
  ["BR-F03-pass-plus-unfinished-tail", Buffer.from("{")],
  ["BR-F05-pass-plus-unfinished-utf8", Buffer.from([0xc3])],
]) test(id, async (h, check) => {
  const cap = await h.created();
  h.handler = (request) => request.op === "write" ? h.output("stdout", Buffer.concat([h.line(request), suffix])) : h.normal(request);
  const result = await settle(h.broker.writeNativeEvidence(cap, h.summary()));
  h.result("write", result); check("write.known.files", 2, result.counts.filesCreated);
  h.result("observe", h.broker.observeNativeEvidence(cap));
  check("rpc.exact", ops("init", "write"), h.requestShape());
});

test("BR-F04-unfinished-reply-at-eof", async (h, check) => {
  const cap = await h.created();
  h.handler = (request) => {
    if (request.op !== "write") return h.normal(request);
    const bytes = h.line(request); h.output("stdout", bytes.subarray(0, bytes.length - 1)); h.emitClose();
  };
  h.result("write", await settle(h.broker.writeNativeEvidence(cap, h.summary())));
  h.result("observe", h.broker.observeNativeEvidence(cap));
  check("rpc.exact", ops("init", "write"), h.requestShape());
});
test("BR-F06-pass-then-stderr", async (h, check) => {
  const cap = await h.created();
  h.handler = (request) => {
    if (request.op !== "write") return h.normal(request);
    h.output("stdout", h.line(request)); h.output("stderr", "SYNTHETIC_HOST_STDERR\n");
  };
  h.result("write", await settle(h.broker.writeNativeEvidence(cap, h.summary())), "NATIVE_HOST_STDERR");
  h.result("observe", h.broker.observeNativeEvidence(cap), "NATIVE_HOST_STDERR");
  check("rpc.exact", ops("init", "write"), h.requestShape());
});
test("BR-F07-pipe-limit-cannot-wash-pass", async (h, check) => {
  const cap = await h.created();
  h.handler = (request) => request.op === "write" ? h.output("stdout", Buffer.concat([h.line(request), Buffer.alloc(262145, 0x20)])) : h.normal(request);
  h.result("write", await settle(h.broker.writeNativeEvidence(cap, h.summary())), "NATIVE_PIPE_LIMIT_EXCEEDED");
  h.result("observe", h.broker.observeNativeEvidence(cap), "NATIVE_PIPE_LIMIT_EXCEEDED");
  check("rpc.exact", ops("init", "write"), h.requestShape());
});
test("BR-F08-queued-late-and-subsequent-operations-sticky", async (h, check) => {
  const cap = await h.created();
  let held;
  h.handler = (request) => { if (request.op === "write" && !held) held = request; else h.normal(request); };
  const first = h.broker.writeNativeEvidence(cap, h.summary());
  const queuedValidate = h.broker.validateNativeEvidence(cap);
  const queuedWrite = h.broker.writeNativeEvidence(cap, h.summary());
  await flush(); check("queue.first.request.started", 2, h.requests.length);
  if (!held) throw new Error("HARNESS_WRITE_NOT_STARTED");
  h.output("stdout", Buffer.concat([h.line(held), Buffer.from("SYNTHETIC_INVALID_JSON\n")]));
  const results = await settle(Promise.all([first, queuedValidate, queuedWrite]));
  results.forEach((value, index) => h.result(`queue.result.${index + 1}`, value));
  check("queue.no.new.rpc", ops("init", "write"), h.requestShape());
  h.output("stdout", h.line({ id: 999, op: "write" }));
  h.result("latePass.observe", h.broker.observeNativeEvidence(cap));
  h.result("later.validate", await settle(h.broker.validateNativeEvidence(cap)));
  h.result("later.write", await settle(h.broker.writeNativeEvidence(cap, h.summary())));
  check("later.no.new.rpc", ops("init", "write"), h.requestShape());
  const closing = h.broker.closeNativeEvidence(cap);
  await flush(); h.emitClose();
  h.result("close", await settle(closing));
  h.result("closed.observe", h.broker.observeNativeEvidence(cap));
  check("closed.flag", true, h.broker.observeNativeEvidence(cap).closed);
  h.result("closed.validate", await settle(h.broker.validateNativeEvidence(cap)));
  h.result("closed.write", await settle(h.broker.writeNativeEvidence(cap, h.summary())));
  h.result("closed.close.again", await settle(h.broker.closeNativeEvidence(cap)));
  check("all.no.new.rpc", ops("init", "write"), h.requestShape());
});

for (const [id, kind, code] of [
  ["BR-F09-init-pass-plus-invalid", "stdout", "NATIVE_PROTOCOL_INVALID"],
  ["BR-F10-init-pass-then-stderr", "stderr", "NATIVE_HOST_STDERR"],
]) test(id, async (h, check) => {
  h.handler = (request) => {
    if (request.op !== "init") return h.normal(request);
    if (kind === "stdout") h.output("stdout", Buffer.concat([h.line(request), Buffer.from("SYNTHETIC_INVALID_JSON\n")]));
    else { h.output("stdout", h.line(request)); h.output("stderr", "SYNTHETIC_INIT_STDERR\n"); }
    h.emitClose();
  };
  const result = await settle(h.broker.createNativeEvidenceBroker());
  h.result("init", result, code); check("init.capability.null", null, result.capability);
  check("rpc.exact", ops("init"), h.requestShape());
});

async function bridgeCase(h, check, malformed) {
  const entry = h.entry.createSyntheticWindowsEvidenceEntry(h.realm(contextFixture()));
  const prepared = await settle(entry.prepareWindowsBytes(h.realm([...Buffer.from(JSON.stringify(inputFixture()))])));
  check("bridge.prepare", { status: "PASS", code: "OK", binding: true }, { status: prepared.status, code: prepared.code, binding: prepared.binding !== null });
  if (!prepared.binding) throw new Error("HARNESS_NO_BINDING");
  const transport = entry.createFakeTransport(h.realm({
    expected: expectedFixture(),
    responses: IDS.map((endpointId) => ({ endpointId, attempt: 1, status: 200, parseable: true, model: "DS-K1T671BM", capability: "confirmed", challenge: null, elapsedMs: 0 })),
  }));
  check("bridge.transport", "PASS", transport.status);
  const permit = await settle(entry.issueWindowsPermit(prepared.binding, h.realm({ scope: "synthetic-fake-execution-only", approvalRef: "synthetic-approval-terminal", windowStart: 0, windowEnd: 100000 })));
  check("bridge.permit", "PASS", permit.status);
  if (malformed) h.handler = (request) => request.op === "write" ? h.output("stdout", Buffer.concat([h.line(request), Buffer.from("SYNTHETIC_INVALID_JSON\n")])) : h.normal(request);
  const result = await settle(entry.executeWindows(prepared.binding, permit.token, transport.fakeTransport));
  const code = malformed ? "NATIVE_PROTOCOL_INVALID" : "OK";
  check("bridge.execute.status", malformed ? "FAIL" : "PASS", result.status);
  check("bridge.execute.code", code, result.code);
  h.result("bridge.execute.native", result.native, code, malformed);
  check("bridge.summary.allowReadStayedFalse", true, result.summary?.allowReadStayedFalse);
  check("bridge.summary.counts", { logicalEndpoints: 6, transmissions: 6, authRetries: 0, unknownEndpoints: 0 }, result.summary?.counts);
  const observed = entry.observeTransport(transport.fakeTransport);
  check("bridge.transport.calls", 6, observed.calls);
  check("bridge.transport.remaining", 0, observed.remainingResponses);
  check("bridge.transport.trace", IDS.map((endpointId) => ({ endpointId, attempt: 1, authenticated: false, requestMatched: true })), observed.trace);
  check("bridge.transport.allProjectionChecks", true, observed.last !== null && Object.values(observed.last).every((value) => value === true));
  check("bridge.write.summary.allowReadStayedFalse", true, h.requests.find((request) => request.op === "write")?.summary.allowReadStayedFalse);
  check("bridge.rpc.before.close", ops("init", ...Array(9).fill("validate"), "write"), h.requestShape());
  const closing = entry.closeWindowsBinding(prepared.binding);
  await flush(); h.emitClose();
  const closed = await settle(closing);
  check("bridge.close.code", code, closed.code);
  h.result("bridge.close.native", closed.native, code, malformed);
  check("bridge.close.closed", true, closed.native?.closed);
  check("bridge.rpc.final", ops("init", ...Array(9).fill("validate"), "write", ...(malformed ? [] : ["close"])), h.requestShape());
}
test("BR-B01-real-bridge-six-call-positive", (h, check) => bridgeCase(h, check, false));
test("BR-B02-real-bridge-six-call-terminal-fail", (h, check) => bridgeCase(h, check, true));

console.log(JSON.stringify({ scope: SCOPE, kind: "manifest", declaredCases: 14, caseIds: cases.map(({ id }) => id), sources: SOURCE_AUDIT, actualNativeObjects: 0, actualWorkerSpawns: 0, actualFilesystemWrites: 0 }));
const records = [];
for (const { id, run } of cases) {
  const checks = [];
  const check = (name, expected, actual) => {
    const expectedValue = plain(expected), actualValue = plain(actual);
    checks.push({ name, status: isDeepStrictEqual(expectedValue, actualValue) ? "PASS" : "FAIL", expected: expectedValue, actual: actualValue });
  };
  let h, audit = null;
  try { h = await environment(check); await run(h, check); }
  catch (error) {
    const code = typeof error?.message === "string" && /^HARNESS_[A-Z_]+$/.test(error.message) ? error.message : "HARNESS_UNEXPECTED_ERROR";
    check("case.completed", "COMPLETED", code);
  }
  finally {
    if (h) {
      try { audit = await h.finish(); }
      catch { check("audit.completed", "COMPLETED", "HARNESS_AUDIT_FAILED"); }
    }
  }
  const failedChecks = checks.filter((item) => item.status === "FAIL").length;
  const record = { scope: SCOPE, kind: "case", id, status: failedChecks === 0 ? "PASS" : "FAIL", expected: { failedChecks: 0 }, actual: { failedChecks }, checks, audit };
  records.push(record); console.log(JSON.stringify(record));
}
const failedCases = records.filter((record) => record.status === "FAIL");
const manifestValid = cases.length === 14 && new Set(cases.map(({ id }) => id)).size === 14 && records.length === 14;
const final = { scope: SCOPE, kind: "summary", status: failedCases.length === 0 && manifestValid ? "PASS" : "FAIL", expected: { cases: 14, passed: 14, failed: 0, uniqueIds: 14 }, actual: { cases: records.length, passed: records.length - failedCases.length, failed: failedCases.length, uniqueIds: new Set(records.map(({ id }) => id)).size }, failedIds: failedCases.map(({ id }) => id), actualNativeObjects: 0, actualWorkerSpawns: 0, actualFilesystemWrites: 0 };
console.log(JSON.stringify(final));
if (final.status !== "PASS") process.exitCode = 1;
