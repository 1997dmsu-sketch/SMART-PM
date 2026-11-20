"use strict";
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");
const dns = require("node:dns");
const dgram = require("node:dgram");
let http2 = null;
try { http2 = require("node:http2"); } catch { http2 = null; }

const checks = [];
function expectBlocked(name, fn) {
  try {
    fn();
    checks.push({ name, blocked: false });
  } catch (error) {
    checks.push({ name, blocked: error && error.code === "H4C_GUARD_BLOCKED" });
  }
}

expectBlocked("net.createServer", () => net.createServer());
expectBlocked("net.Server.listen", () => new net.Server().listen(0));
expectBlocked("http.Server.listen", () => new http.Server().listen(0));
expectBlocked("https.Server.listen", () => new https.Server({}).listen(0));
expectBlocked("net.connect", () => net.connect(9, "127.0.0.1"));
expectBlocked("net.createConnection", () => net.createConnection(9, "127.0.0.1"));
expectBlocked("net.Socket.connect", () => new net.Socket().connect(9, "127.0.0.1"));
expectBlocked("tls.connect", () => tls.connect(9, "127.0.0.1"));
expectBlocked("http.request", () => http.request("http://127.0.0.1:9/"));
expectBlocked("http.get", () => http.get("http://127.0.0.1:9/"));
expectBlocked("https.request", () => https.request("https://127.0.0.1:9/"));
expectBlocked("https.get", () => https.get("https://127.0.0.1:9/"));
expectBlocked("globalThis.fetch", () => globalThis.fetch("http://127.0.0.1:9/"));
if (http2) expectBlocked("http2.connect", () => http2.connect("http://127.0.0.1:9/"));

const dnsNames = [
  "lookup", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa",
  "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr",
  "resolveSoa", "resolveSrv", "resolveTxt", "reverse",
];
for (const name of dnsNames) {
  expectBlocked("dns." + name, () => dns[name]("example.invalid", () => {}));
  expectBlocked("dns.promises." + name, () => dns.promises[name]("example.invalid"));
}
const dnsPromises = require("node:dns/promises");
for (const name of dnsNames) {
  expectBlocked("dns/promises." + name, () => dnsPromises[name]("example.invalid"));
}

expectBlocked("dgram.createSocket", () => dgram.createSocket("udp4"));
const fakeSocket = Object.create(dgram.Socket.prototype);
expectBlocked("dgram.Socket.bind", () => fakeSocket.bind(0));
expectBlocked("dgram.Socket.send", () => fakeSocket.send(Buffer.from("x"), 0, "127.0.0.1"));
if (typeof dgram.Socket.prototype.connect === "function") {
  expectBlocked("dgram.Socket.connect", () => fakeSocket.connect(0, "127.0.0.1"));
}

const failed = checks.filter((check) => !check.blocked);
console.log(JSON.stringify({ total: checks.length, failed: failed.length, checks }));
if (failed.length > 0) process.exit(1);
