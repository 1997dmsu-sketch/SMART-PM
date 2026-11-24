'use strict';
/**
 * 不转发网络 guard（本次 C 路合成测试专用）：在业务模块加载前以 --require 安装。
 * 计数并阻断出站入口，任何触发都抛错，绝不转发真实目标；同步 ESM 绑定。
 * 自检标记：globalThis.__CHECKIN_FACE_NETWORK_GUARD__（installed/totalCalls/firstCall）。
 * 子进程继承：CHECKIN_FACE_NETWORK_GUARD 环境变量 + NODE_OPTIONS 追加 --require 本文件。
 * 退出证据：设置 CHECKIN_FACE_GUARD_EXIT_LOG 时按进程追加一行 JSON（exitCode/totalCalls/first）。
 * 本 guard 未覆盖所有操作系统网络方式或文件系统，仅陈述本次已安装入口的观察。
 */

const net = require('node:net');
const tls = require('node:tls');
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');

const state = { totalCalls: 0, first: null };

function record(kind) {
  state.totalCalls += 1;
  if (!state.first) state.first = { kind, at: new Date().toISOString() };
}

function block(kind) {
  record(kind);
  throw new Error(`network guard: 出站网络被阻断（${kind}），未转发任何请求`);
}

function patch(obj, method, kind) {
  const original = obj[method];
  if (typeof original !== 'function') return;
  obj[method] = function guardedNetworkCall() { return block(kind); };
  Object.defineProperty(obj[method], 'name', { value: method, configurable: true });
}

patch(net, 'connect', 'net.connect');
patch(net, 'createConnection', 'net.createConnection');
patch(tls, 'connect', 'tls.connect');
patch(http, 'request', 'http.request');
patch(http, 'get', 'http.get');
patch(https, 'request', 'https.request');
patch(https, 'get', 'https.get');
patch(dns, 'lookup', 'dns.lookup');
patch(dns, 'resolve', 'dns.resolve');
patch(dns, 'resolve4', 'dns.resolve4');
patch(dns, 'resolve6', 'dns.resolve6');

const OriginalSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedSocketConnect(...args) {
  const options = typeof args[0] === 'object' && args[0] !== null ? args[0] : null;
  if (options && (options.fd !== undefined || options.handle !== undefined)) {
    // 进程内 IPC / fd 复用不是出站网络，放行（保证 node --test 子进程测试运行正常）。
    return OriginalSocketConnect.apply(this, args);
  }
  record('net.Socket.connect');
  throw new Error('network guard: 出站 socket 被阻断');
};

process.env.CHECKIN_FACE_NETWORK_GUARD = '1';
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--require ${__filename}`;

globalThis.__CHECKIN_FACE_NETWORK_GUARD__ = Object.freeze({
  installed: true,
  totalCalls: () => state.totalCalls,
  firstCall: () => state.first,
});

process.on('exit', () => {
  const target = process.env.CHECKIN_FACE_GUARD_EXIT_LOG;
  if (typeof target !== 'string' || !target) return;
  try {
    require('node:fs').appendFileSync(
      target,
      `${JSON.stringify({ exitCode: process.exitCode ?? 0, totalCalls: state.totalCalls, first: state.first, pid: process.pid })}\n`,
    );
  } catch {
    // 证据写入失败不改变测试结果。
  }
});
