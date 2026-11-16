// HK-AI-07D G1 P2 取证 guard。
//
// 该模块必须在任何业务模块之前加载（测试文件首个 import，或 node --import /
// NODE_OPTIONS=--import）。它只做两件事：
//   1. 禁止 TCP/UDP 监听（server.listen / dgram.bind），不启动任何监听；
//   2. 禁止并计数业务网络调用（fetch、http/https request/get）。
//
// 计数只增不清零；自检会真实触发被禁止入口并记录增量，供测试证明 guard 有效。
// restore() 幂等，测试用 after/finally 恢复。
import net from "node:net";
import dgram from "node:dgram";
import http from "node:http";
import https from "node:https";

const counters = { listen: 0, network: 0 };
const originals = {};
let installed = false;

function forbidden(kind, entry) {
  const error = new Error(`G1 guard forbids ${kind}: ${entry}`);
  error.code = kind === "listen" ? "G1_LISTEN_FORBIDDEN" : "G1_NETWORK_FORBIDDEN";
  throw error;
}

function install() {
  if (installed) return;
  originals.netListen = net.Server.prototype.listen;
  originals.dgramBind = dgram.Socket.prototype.bind;
  originals.httpRequest = http.request;
  originals.httpGet = http.get;
  originals.httpsRequest = https.request;
  originals.httpsGet = https.get;
  originals.fetch = globalThis.fetch;

  net.Server.prototype.listen = function forbiddenListen(..._args) {
    counters.listen += 1;
    return forbidden("listen", "net.Server.listen");
  };
  dgram.Socket.prototype.bind = function forbiddenBind(..._args) {
    counters.listen += 1;
    return forbidden("listen", "dgram.Socket.bind");
  };
  http.request = function forbiddenHttpRequest(..._args) {
    counters.network += 1;
    return forbidden("network", "http.request");
  };
  http.get = function forbiddenHttpGet(..._args) {
    counters.network += 1;
    return forbidden("network", "http.get");
  };
  https.request = function forbiddenHttpsRequest(..._args) {
    counters.network += 1;
    return forbidden("network", "https.request");
  };
  https.get = function forbiddenHttpsGet(..._args) {
    counters.network += 1;
    return forbidden("network", "https.get");
  };
  if (typeof originals.fetch === "function") {
    globalThis.fetch = function forbiddenFetch(..._args) {
      counters.network += 1;
      return forbidden("network", "globalThis.fetch");
    };
  }
  installed = true;
}

function read() {
  return { ...counters };
}

function delta(from = { listen: 0, network: 0 }) {
  const now = read();
  return {
    listen: now.listen - (from.listen ?? 0),
    network: now.network - (from.network ?? 0),
  };
}

function selfCheck() {
  const before = read();
  const results = {};
  const probe = (name, fn) => {
    let threw = false;
    try {
      fn();
    } catch (error) {
      threw = error?.code === "G1_LISTEN_FORBIDDEN" || error?.code === "G1_NETWORK_FORBIDDEN";
    }
    results[name] = threw;
  };

  probe("listen", () => {
    const server = net.createServer();
    server.listen(0);
  });
  probe("fetch", () => globalThis.fetch("http://127.0.0.1:9/g1-guard"));
  probe("httpRequest", () => http.request("http://127.0.0.1:9/g1-guard"));
  probe("httpGet", () => http.get("http://127.0.0.1:9/g1-guard"));
  probe("httpsRequest", () => https.request("https://127.0.0.1:9/g1-guard"));
  probe("httpsGet", () => https.get("https://127.0.0.1:9/g1-guard"));

  const after = read();
  return {
    before,
    after,
    delta: delta(before),
    results,
    allThrew: Object.values(results).every(Boolean),
  };
}

function restore() {
  if (!installed) return false;
  net.Server.prototype.listen = originals.netListen;
  dgram.Socket.prototype.bind = originals.dgramBind;
  http.request = originals.httpRequest;
  http.get = originals.httpGet;
  https.request = originals.httpsRequest;
  https.get = originals.httpsGet;
  if (typeof originals.fetch === "function") globalThis.fetch = originals.fetch;
  installed = false;
  return true;
}

install();

export const guard = Object.freeze({
  read,
  delta,
  selfCheck,
  restore,
  get installed() {
    return installed;
  },
});

globalThis.__G1_GUARD__ = guard;
