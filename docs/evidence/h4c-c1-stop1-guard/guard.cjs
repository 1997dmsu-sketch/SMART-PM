"use strict";
/*
 * HK-AI-04 H4-c C1 guard (external control file, never committed).
 * Preloaded via NODE_OPTIONS=--require before any test module is loaded.
 * It intercepts every network/listen/DNS/dgram entry, counts it and throws a
 * controlled error without forwarding to the real implementation.
 */
const fs = require("node:fs");

if (!globalThis.__H4C_GUARD__) {
  const entries = Object.create(null);
  const counters = {
    listen_calls: 0,
    network_attempts: 0,
    dns_calls: 0,
    dgram_calls: 0,
    provider_calls: 0,
    load_violations: 0,
    blocked_calls: 0,
    real_leaks: 0,
  };
  let runtimeStarted = false;
  setImmediate(() => { runtimeStarted = true; });
  const reportPath = process.env.H4C_GUARD_REPORT || "";

  function block(name, category) {
    counters[category] += 1;
    counters.blocked_calls += 1;
    entries[name] = (entries[name] || 0) + 1;
    if (!runtimeStarted) counters.load_violations += 1;
    const error = new Error("H4C_GUARD_BLOCKED:" + name);
    error.code = "H4C_GUARD_BLOCKED";
    throw error;
  }

  function patch(object, key, name, category) {
    if (!object || typeof object[key] !== "function") return false;
    const original = object[key];
    object[key] = function h4cGuardedEntry() {
      return block(name, category);
    };
    object[key].__h4cOriginal = original;
    return true;
  }

  const net = require("node:net");
  const http = require("node:http");
  const https = require("node:https");
  const tls = require("node:tls");
  const dns = require("node:dns");
  const dgram = require("node:dgram");
  let http2 = null;
  try { http2 = require("node:http2"); } catch { http2 = null; }

  patch(net, "createServer", "net.createServer", "listen_calls");
  patch(net.Server.prototype, "listen", "net.Server.listen", "listen_calls");
  patch(http.Server.prototype, "listen", "http.Server.listen", "listen_calls");
  patch(https.Server.prototype, "listen", "https.Server.listen", "listen_calls");

  patch(net, "connect", "net.connect", "network_attempts");
  patch(net, "createConnection", "net.createConnection", "network_attempts");
  patch(net.Socket.prototype, "connect", "net.Socket.connect", "network_attempts");
  patch(tls, "connect", "tls.connect", "network_attempts");
  patch(http, "request", "http.request", "network_attempts");
  patch(http, "get", "http.get", "network_attempts");
  patch(https, "request", "https.request", "network_attempts");
  patch(https, "get", "https.get", "network_attempts");
  if (http2) patch(http2, "connect", "http2.connect", "network_attempts");
  if (typeof globalThis.fetch === "function") {
    patch(globalThis, "fetch", "globalThis.fetch", "network_attempts");
  }

  const dnsNames = [
    "lookup", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa",
    "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr",
    "resolveSoa", "resolveSrv", "resolveTxt", "reverse",
  ];
  for (const name of dnsNames) patch(dns, name, "dns." + name, "dns_calls");
  if (dns.promises) {
    for (const name of dnsNames) {
      patch(dns.promises, name, "dns.promises." + name, "dns_calls");
    }
  }
  try {
    const dnsPromises = require("node:dns/promises");
    for (const name of dnsNames) {
      patch(dnsPromises, name, "dns/promises." + name, "dns_calls");
    }
  } catch { /* optional module */ }

  patch(dgram, "createSocket", "dgram.createSocket", "dgram_calls");
  for (const name of ["send", "bind", "connect"]) {
    patch(dgram.Socket.prototype, name, "dgram.Socket." + name, "dgram_calls");
  }

  for (const mod of [net, http, https, tls, dns, dgram, http2]) {
    if (mod && typeof mod.syncBuiltinESMExports === "function") {
      mod.syncBuiltinESMExports();
    }
  }

  function writeReport() {
    if (!reportPath) return;
    try {
      fs.writeFileSync(reportPath, JSON.stringify({
        pid: process.pid,
        active: true,
        version: process.version,
        platform: process.platform,
        runtimeStarted,
        counters,
        entries,
      }));
    } catch { /* report failure is checked by the wrapper */ }
  }

  process.on("exit", writeReport);
  globalThis.__H4C_GUARD__ = {
    active: true,
    version: process.version,
    platform: process.platform,
    counters,
    entries,
    block,
    writeReport,
  };
}
