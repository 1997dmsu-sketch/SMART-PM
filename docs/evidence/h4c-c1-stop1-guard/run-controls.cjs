"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const guardPath = path.join(__dirname, "guard.cjs");
const guardOption = guardPath.replace(/\\/g, "/");
const adminWeb = process.env.H4C_ADMIN_WEB;
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " " + detail : ""));
}

function readReport(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function spawnNode(name, args, { guard = true, cwd = adminWeb, timeout = 180000 } = {}) {
  const report = path.join(__dirname, name + ".report.json");
  try { fs.unlinkSync(report); } catch { /* absent */ }
  const env = {
    ...process.env,
    H4C_ADMIN_WEB: adminWeb,
    H4C_GUARD_REPORT: report,
  };
  if (guard) env.NODE_OPTIONS = '--require "' + guardOption + '"';
  else delete env.NODE_OPTIONS;
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ...result, report: readReport(report), reportPath: report };
}

function zeroCounters(report) {
  return Boolean(report && report.active) &&
    report.counters.listen_calls === 0 &&
    report.counters.network_attempts === 0 &&
    report.counters.dns_calls === 0 &&
    report.counters.dgram_calls === 0 &&
    report.counters.provider_calls === 0 &&
    report.counters.load_violations === 0;
}

if (!process.env.NODE_OPTIONS || !process.env.NODE_OPTIONS.includes(guardOption) ||
    !globalThis.__H4C_GUARD__ || !globalThis.__H4C_GUARD__.active) {
  console.error("BLOCKED: wrapper must be launched with NODE_OPTIONS=--require <guard.cjs> and an active sentinel");
  process.exit(1);
}
if (!adminWeb) {
  console.error("BLOCKED: H4C_ADMIN_WEB is required");
  process.exit(1);
}

// 1. No-guard negative control: without the preload there is no sentinel.
{
  const result = spawnNode("no-guard", ["-e",
    "if(globalThis.__H4C_GUARD__){console.log('UNEXPECTED_GUARD');process.exit(0);}" +
    "console.log('NO_GUARD');process.exit(3);"], { guard: false });
  record("negative:no-guard", result.status === 3 && /NO_GUARD/.test(result.stdout || ""),
    "exit=" + result.status);
}

// 2. Sentinel positive control: the preload is active before any test module.
{
  const result = spawnNode("sentinel", ["-e",
    "if(!globalThis.__H4C_GUARD__?.active){process.exit(9);}console.log('GUARD_ACTIVE');"]);
  record("positive:preload-sentinel", result.status === 0 &&
    /GUARD_ACTIVE/.test(result.stdout || ""), "exit=" + result.status);
}

// 3. ESM named-import sentinel: syncBuiltinESMExports must intercept it.
{
  const result = spawnNode("esm-sentinel", [path.join(__dirname, "esm-sentinel.mjs")]);
  const report = result.report;
  record("negative:esm-named-import", result.status === 0 &&
    Boolean(report && report.entries["http.request"] >= 1) &&
    Boolean(report && report.counters.network_attempts >= 1),
    "exit=" + result.status + " http.request=" +
      (report ? report.entries["http.request"] : "missing"));
}

// 4. Per-entry runtime negative control.
{
  const result = spawnNode("entry-negative", [path.join(__dirname, "entry-negative.cjs")]);
  let parsed = null;
  try { parsed = JSON.parse((result.stdout || "").trim().split(/\r?\n/).pop()); } catch { parsed = null; }
  const report = result.report;
  const counters = report ? report.counters : null;
  record("negative:per-entry", result.status === 0 && Boolean(parsed) &&
    parsed.failed === 0 && parsed.total >= 30 &&
    Boolean(counters && counters.listen_calls > 0 &&
      counters.network_attempts > 0 && counters.dns_calls > 0 &&
      counters.dgram_calls > 0),
    "exit=" + result.status + " entries=" + (parsed ? parsed.total : "missing") +
      " blocked=" + (counters ? counters.blocked_calls : "missing"));
}

// 5. Load-time negative control: a top-level request must be a load violation.
{
  const result = spawnNode("load-negative", [path.join(__dirname, "load-negative.cjs")]);
  const report = result.report;
  record("negative:load-before-runtime", result.status !== 0 &&
    Boolean(report && report.counters.load_violations >= 1),
    "exit=" + result.status + " load_violations=" +
      (report ? report.counters.load_violations : "missing"));
}

// 6. Real subprocess inherits the guard and returns its counters.
{
  const result = spawnNode("child-net", [path.join(__dirname, "child-net.cjs")]);
  let parsed = null;
  try { parsed = JSON.parse((result.stdout || "").trim().split(/\r?\n/).pop()); } catch { parsed = null; }
  const report = result.report;
  record("negative:subprocess-inheritance", result.status === 0 &&
    Boolean(parsed && parsed.blocked && parsed.active) &&
    Boolean(report && report.counters.network_attempts === 1 &&
      report.counters.listen_calls === 0),
    "exit=" + result.status + " child=" + JSON.stringify(parsed));
}

// 7. Positive controls must produce real crypto/fs/K3/LocalStore results.
{
  const result = spawnNode("positive", [path.join(__dirname, "positive.cjs")]);
  record("positive:crypto-fs-k3-localstore", result.status === 0 &&
    /POSITIVE_OK/.test(result.stdout || "") && zeroCounters(result.report),
    "exit=" + result.status);
}

// 8. Actual C1 targeted test under the same preload.
{
  const result = spawnNode("c1-test", ["--test", "--test-isolation=none",
    "tests/face-h4c-evidence.test.mjs"]);
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const pass = (/(?:#|ℹ)\s*pass (\d+)/.exec(stdout) || [])[1] || null;
  const fail = (/(?:#|ℹ)\s*fail (\d+)/.exec(stdout) || [])[1] || null;
  const report = result.report;
  console.log("----- C1 TEST STDOUT -----");
  console.log(stdout.trim());
  if (stderr.trim()) {
    console.log("----- C1 TEST STDERR -----");
    console.log(stderr.trim());
  }
  record("test:c1-targeted", result.status === 0 && fail === "0" &&
    pass !== null && zeroCounters(report),
    "exit=" + result.status + " pass=" + pass + " fail=" + fail +
      " counters=" + (report ? JSON.stringify(report.counters) : "missing"));
}

const failed = results.filter((result) => !result.ok);
console.log("S1_GUARD_SUMMARY " + JSON.stringify({
  guard: guardPath,
  version: process.version,
  platform: process.platform,
  total: results.length,
  failed: failed.length,
  results,
}));
process.exit(failed.length === 0 ? 0 : 1);
