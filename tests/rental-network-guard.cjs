"use strict";
// Test-only network guard for the rental suites (task card §3.5-3.9 / S1 §7).
//
// The guard replaces every networking entry point of the running Node process
// with a blocking stub that records a violation and returns an inert sentinel.
// It never listens, never dials out and never forwards to the real function.
// Loading this module installs the guard once, immediately, so that the subject
// modules can only be loaded through a dynamic import/require afterwards.
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");
const dns = require("node:dns");
const dgram = require("node:dgram");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const nodeCrypto = require("node:crypto");
const nodeBuffer = require("node:buffer");
const nodeUrl = require("node:url");
const nodePath = require("node:path");
const nodeFs = require("node:fs/promises");
const { syncBuiltinESMExports } = require("node:module");
const { spawnSync } = require("node:child_process");

const SENTINEL = Object.freeze({
  blocked: true,
  code: "RENTAL_NETWORK_GUARD",
  message: "network access is blocked in offline rental tests",
});

const state = {
  installed: false,
  esmSynced: false,
  phase: "load",
  loadViolations: [],
  runtimeViolations: [],
  entries: [],
  forwarded: [],
};

const DNS_RESOLVE_NAMES = [
  "resolve",
  "resolve4",
  "resolve6",
  "resolveAny",
  "resolveCaa",
  "resolveCname",
  "resolveMx",
  "resolveNaptr",
  "resolveNs",
  "resolvePtr",
  "resolveSoa",
  "resolveSrv",
  "resolveTlsa",
  "resolveTxt",
];
const DNS_PROMISE_NAMES = [
  "lookup",
  "lookupService",
  "reverse",
  ...DNS_RESOLVE_NAMES,
];

function record(name) {
  if (state.phase === "load") state.loadViolations.push(name);
  else state.runtimeViolations.push(name);
}

// The real implementation is moved into a tripwire that records any forwarding
// attempt; the installed stub never has a reference to it.
function installEntry(name, target, key) {
  if (!target || typeof target !== "object")
    throw new Error(`guard entry target missing: ${name}`);
  const real = target[key];
  if (typeof real !== "function")
    throw new Error(`guard entry missing or not callable: ${name}`);
  const tripwire = function (...args) {
    state.forwarded.push(name);
    return real.apply(this, args);
  };
  const blocked = function () {
    record(name);
    return SENTINEL;
  };
  blocked.__rentalNetworkGuardEntry = name;
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: blocked,
  });
  state.entries.push({ name, target, key, blocked });
  return tripwire;
}

function installNetworkGuard() {
  if (state.installed)
    throw new Error("rental network guard is already installed");
  const table = [
    ["net.createServer", net, "createServer"],
    ["net.Server.prototype.listen", net.Server.prototype, "listen"],
    ["http.Server.prototype.listen", http.Server.prototype, "listen"],
    ["https.Server.prototype.listen", https.Server.prototype, "listen"],
    ["net.connect", net, "connect"],
    ["net.createConnection", net, "createConnection"],
    ["net.Socket.prototype.connect", net.Socket.prototype, "connect"],
    ["tls.connect", tls, "connect"],
    ["http.request", http, "request"],
    ["http.get", http, "get"],
    ["https.request", https, "request"],
    ["https.get", https, "get"],
    ["dns.lookup", dns, "lookup"],
    ["dns.lookupService", dns, "lookupService"],
    ["dns.reverse", dns, "reverse"],
    ...DNS_RESOLVE_NAMES.map((name) => [`dns.${name}`, dns, name]),
    ...DNS_PROMISE_NAMES.map((name) => [
      `dns.promises.${name}`,
      dns.promises,
      name,
    ]),
    ["dgram.createSocket", dgram, "createSocket"],
    ["dgram.Socket.prototype.send", dgram.Socket.prototype, "send"],
    ["dgram.Socket.prototype.bind", dgram.Socket.prototype, "bind"],
    ["dgram.Socket.prototype.connect", dgram.Socket.prototype, "connect"],
    ["globalThis.fetch", globalThis, "fetch"],
  ];
  for (const [name, target, key] of table) installEntry(name, target, key);
  // ESM named bindings keep referring to the builtin namespace, so they have to
  // be re-synchronised after patching the CommonJS exports.
  syncBuiltinESMExports();
  state.esmSynced = true;
  state.installed = true;
  state.phase = "load";
}

function assertInstalled() {
  if (!state.installed) throw new Error("rental network guard is not installed");
  return true;
}

function assertNoLoadTimeViolation() {
  assertInstalled();
  if (state.loadViolations.length)
    throw new Error(
      "network access during module load: " + state.loadViolations.join(", "),
    );
  state.phase = "runtime";
  return { loadViolations: 0, phase: state.phase };
}

function entryNames() {
  return state.entries.map((e) => e.name);
}

function violationCount() {
  return state.loadViolations.length + state.runtimeViolations.length;
}

function resetRuntimeViolations() {
  const cleared = state.runtimeViolations.length;
  state.runtimeViolations = [];
  // Load-time violations are permanent evidence and are never cleared here.
  return { cleared, loadViolations: state.loadViolations.length };
}

function activeNetworkResources() {
  const info =
    typeof process.getActiveResourcesInfo === "function"
      ? process.getActiveResourcesInfo()
      : [];
  return info.filter((name) => /TCP|UDP|TLSWRAP|GETADDRINFOREQWRAP/i.test(name));
}

function negativeControls(evidence) {
  const started = violationCount();
  const resourcesBefore = activeNetworkResources();
  const sentinels = [];
  for (const entry of state.entries) {
    const before = violationCount();
    const returned = entry.target[entry.key]();
    const after = violationCount();
    if (after !== before + 1)
      throw new Error(`violation counter did not move for ${entry.name}`);
    if (returned !== SENTINEL)
      throw new Error(`entry did not return the safe sentinel: ${entry.name}`);
    if (returned && typeof returned === "object" && !returned.blocked)
      throw new Error(`entry returned a live object: ${entry.name}`);
    sentinels.push(entry.name);
  }
  if (state.forwarded.length)
    throw new Error(
      "guard forwarded to a real network implementation: " +
        [...new Set(state.forwarded)].join(", "),
    );
  const resourcesAfter = activeNetworkResources();
  if (resourcesAfter.length > resourcesBefore.length)
    throw new Error(
      "negative controls created a live network handle: " +
        resourcesAfter.join(", "),
    );
  evidence.negatives = {
    passed: sentinels.length,
    total: state.entries.length,
    violations: violationCount() - started,
  };
}

async function esmControls() {
  let checked = 0;
  const httpNs = await import("node:http");
  const netNs = await import("node:net");
  const dnsNs = await import("node:dns");
  const tlsNs = await import("node:tls");
  const cases = [
    ["http.request", httpNs.request],
    ["http.get", httpNs.get],
    ["net.connect", netNs.connect],
    ["net.createConnection", netNs.createConnection],
    ["dns.lookup", dnsNs.lookup],
    ["tls.connect", tlsNs.connect],
  ];
  for (const [name, fn] of cases) {
    const before = violationCount();
    if (typeof fn !== "function")
      throw new Error(`ESM binding missing for ${name}`);
    const returned = fn();
    if (violationCount() !== before + 1)
      throw new Error(`ESM binding not intercepted: ${name}`);
    if (returned !== SENTINEL)
      throw new Error(`ESM binding did not return the sentinel: ${name}`);
    checked += 1;
  }
  if (!state.esmSynced)
    throw new Error("syncBuiltinESMExports() was not applied");
  return { passed: checked, total: cases.length, synced: state.esmSynced };
}

function positiveControls() {
  const checks = [];
  // RSA-SHA256 sign/verify must really produce a valid signature.
  const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const signer = nodeCrypto.createSign("RSA-SHA256");
  signer.update("rental-guard-positive-control");
  const signature = signer.sign(privateKey, "base64");
  const verifier = nodeCrypto.createVerify("RSA-SHA256");
  verifier.update("rental-guard-positive-control");
  if (verifier.verify(publicKey, signature, "base64") !== true)
    throw new Error("crypto positive control failed: RSA verify is not true");
  checks.push("crypto:rsa-sha256");

  // AES-256-GCM must round-trip the exact plaintext.
  const key = nodeCrypto.randomBytes(32);
  const iv = nodeCrypto.randomBytes(12);
  const cipher = nodeCrypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("rental-aad"));
  const plain = Buffer.from("rental-guard-secret", "utf8");
  const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);
  const decipher = nodeCrypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from("rental-aad"));
  decipher.setAuthTag(cipher.getAuthTag());
  const opened = Buffer.concat([decipher.update(sealed), decipher.final()]);
  if (opened.toString("utf8") !== "rental-guard-secret")
    throw new Error("crypto positive control failed: AES-256-GCM round trip");
  checks.push("crypto:aes-256-gcm");

  // Node builtins used by the suites must stay untouched.
  if (nodeBuffer.Buffer.from("ok", "utf8").toString("hex") !== "6f6b")
    throw new Error("buffer positive control failed");
  if (new nodeUrl.URL("https://example.invalid/a?b=1").hostname !== "example.invalid")
    throw new Error("url positive control failed");
  if (nodePath.join("a", "b") !== path.join("a", "b"))
    throw new Error("path positive control failed");
  if (!nodePath.isAbsolute(os.tmpdir()))
    throw new Error("os positive control failed");
  checks.push("builtins:buffer/url/path/os");

  // The injected payment adapter is a plain in-memory mock, never a network call.
  const adapter = {
    appid: "wx-guard-appid",
    mchid: "guard-mchid",
    create: (input) => ({ package: "prepay_id=guard", tradeNo: input.tradeNo }),
    query: () => ({ trade_state: "NOTPAY" }),
  };
  const created = adapter.create({ tradeNo: "Lguard" });
  const queried = adapter.query("Lguard");
  if (created.package !== "prepay_id=guard" || created.tradeNo !== "Lguard")
    throw new Error("adapter positive control failed: create result mismatch");
  if (queried.trade_state !== "NOTPAY")
    throw new Error("adapter positive control failed: query result mismatch");
  checks.push("adapter:mock-create-query");

  // Temporary file round trip with real content.
  const dir = nodeCrypto.randomUUID();
  const base = path.join(os.tmpdir(), "rental-guard-" + dir);
  const result = nodeFs
    .mkdir(base, { recursive: true })
    .then(() => nodeFs.writeFile(path.join(base, "probe.txt"), "guard-probe"))
    .then(() => nodeFs.readFile(path.join(base, "probe.txt"), "utf8"))
    .then((value) => {
      if (value !== "guard-probe")
        throw new Error("fs/promises positive control failed: content mismatch");
      return nodeFs.rm(base, { recursive: true, force: true });
    })
    .then(() => "fs/promises:temp-round-trip");
  checks.push("fs/promises:pending");
  return { checks, pending: result };
}

function subprocessControl() {
  const guardPath = __filename;
  const script = `
"use strict";
const guard = require(${JSON.stringify(guardPath)});
const net = require("node:net");
const dgram = require("node:dgram");
const tcp = net.connect({ port: 9, host: "127.0.0.1" });
const tcp2 = net.createConnection({ port: 9, host: "127.0.0.1" });
const server = net.createServer();
const udp = dgram.createSocket("udp4");
const fetched = globalThis.fetch("http://127.0.0.1:9/");
(async () => {
  const awaited = await fetched;
  const results = [tcp, tcp2, server, udp, awaited];
  console.log(JSON.stringify({
    installed: guard.isInstalled(),
    violations: guard.violationCount(),
    allBlocked: results.every((value) => value && value.blocked === true),
  }));
})().catch((error) => {
  console.error(String((error && error.stack) || error));
  process.exit(3);
});
`;
  const child = spawnSync(process.execPath, ["-e", script], {
    env: {
      ...process.env,
      // The only supported way to make the child inherit the guard.
      NODE_OPTIONS: "--require " + guardPath,
    },
    encoding: "utf8",
    timeout: 30000,
  });
  if (child.error)
    throw new Error("subprocess guard control failed: " + child.error.message);
  if (child.status !== 0)
    throw new Error(
      "subprocess guard control exited " +
        child.status +
        ": " +
        String(child.stderr || "").trim(),
    );
  let parsed;
  try {
    parsed = JSON.parse(String(child.stdout || "").trim().split("\n").pop());
  } catch {
    throw new Error(
      "subprocess guard control returned unparsable output: " +
        String(child.stdout || ""),
    );
  }
  if (parsed.installed !== true)
    throw new Error("subprocess did not inherit the guard installation");
  if (parsed.allBlocked !== true)
    throw new Error("subprocess network calls were not all blocked");
  if (!(parsed.violations >= 5))
    throw new Error(
      "subprocess recorded too few blocked calls: " + parsed.violations,
    );
  return { passed: 1, total: 1, violations: parsed.violations };
}

function assertNonListeningFiles(files) {
  const checked = [];
  for (const file of files) {
    if (!fs.existsSync(file)) throw new Error("non-listening file missing: " + file);
    const source = fs.readFileSync(file, "utf8");
    if (/\.listen\s*\(/.test(source))
      throw new Error("listening call found in non-listening file: " + file);
    checked.push(path.basename(file));
  }
  return checked;
}

function assertNoUncontrolledChildProcess(files) {
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    if (/child_process/.test(source))
      throw new Error(
        "uncontrolled child process usage in test/subject file: " + file,
      );
  }
  const guardSource = fs.readFileSync(__filename, "utf8");
  if (!/NODE_OPTIONS:\s*"--require "/.test(guardSource))
    throw new Error("guard subprocess control does not inherit NODE_OPTIONS");
  return files.length;
}

async function runNetworkGuardSelfCheck() {
  assertInstalled();
  const evidence = {
    version: process.version,
    platform: process.platform,
    entryCount: state.entries.length,
    esmSynced: state.esmSynced,
    loadViolations: state.loadViolations.length,
  };
  if (state.loadViolations.length)
    throw new Error(
      "network access during module load: " + state.loadViolations.join(", "),
    );
  negativeControls(evidence);
  evidence.esm = await esmControls();
  const violationsBeforePositives = violationCount();
  const positives = positiveControls();
  const fsResult = await positives.pending;
  if (violationCount() !== violationsBeforePositives)
    throw new Error("a necessary dependency was intercepted by the guard");
  const finished = positives.checks
    .filter((name) => name !== "fs/promises:pending")
    .concat(fsResult);
  evidence.positives = { passed: finished.length, total: finished.length };
  evidence.subprocess = subprocessControl();
  evidence.loadViolations = state.loadViolations.length;
  evidence.runtimeViolations = state.runtimeViolations.length;
  evidence.forwarded = state.forwarded.length;
  return evidence;
}

installNetworkGuard();

module.exports = {
  SENTINEL,
  isInstalled: () => state.installed === true,
  assertInstalled,
  assertNoLoadTimeViolation,
  entryNames,
  violationCount,
  loadViolationCount: () => state.loadViolations.length,
  runtimeViolationCount: () => state.runtimeViolations.length,
  resetRuntimeViolations,
  activeNetworkResources,
  runNetworkGuardSelfCheck,
  assertNonListeningFiles,
  assertNoUncontrolledChildProcess,
  installNetworkGuard,
};
