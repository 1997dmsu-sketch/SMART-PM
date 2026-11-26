/**
 * CF-R2-12 第二轮：安全可计数 fake 注入器。
 * 必须在 d-network-guard 之前预载（--require 顺序），把守卫将捕获的
 * 全部目标位置替换为纯内存计数函数/类（零真实网络/监听/DNS/HTTP），
 * 使「外部原目标调用」可独立观测。守卫记录的是本注入器安装的目标。
 */
'use strict';

// 先强制实例化真实 stdout/stderr（Node 惰性 getter），避免后续构造器 fake
// 影响 console/管道输出；随后替换的目标位置不再被进程自身使用。
void process.stdout;
void process.stderr;

const net = require('node:net');
const tls = require('node:tls');
const http = require('node:http');
const https = require('node:https');
const dgram = require('node:dgram');
const dns = require('node:dns');
const dnsPromises = require('node:dns/promises');

if (globalThis.__DSH_D_NETWORK_FAKES__) {
  module.exports = globalThis.__DSH_D_NETWORK_FAKES__;
} else {
  const counts = new Map();
  const targets = new Map();
  const originals = [];
  const count = (name) => { counts.set(name, (counts.get(name) || 0) + 1); };
  const installFn = (object, key, name) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    const original = object[key];
    originals.push({ object, key, descriptor, original });
    const fake = function (...args) { count(name); return undefined; };
    Object.defineProperty(object, key, descriptor
      ? { ...descriptor, value: fake, writable: true, configurable: true }
      : { value: fake, writable: true, enumerable: false, configurable: true });
    targets.set(name, fake);
  };
  const installCtor = (object, key, name, ctor) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    const original = object[key];
    originals.push({ object, key, descriptor, original });
    Object.defineProperty(object, key, descriptor
      ? { ...descriptor, value: ctor, writable: true, configurable: true }
      : { value: ctor, writable: true, enumerable: false, configurable: true });
    targets.set(name, ctor);
  };
  const makeClassFake = (name, protoNames) => {
    const proto = {};
    for (const pn of protoNames) {
      proto[pn] = function (...args) { count(`${name}.prototype.${pn}`); return undefined; };
      targets.set(`${name}.prototype.${pn}`, proto[pn]);
    }
    const Ctor = function (...args) { count(name); return undefined; };
    Object.defineProperty(Ctor, 'name', { value: name.split('.').at(-1) });
    Ctor.prototype = proto;
    return Ctor;
  };

  // net / tls / http / https / dgram：模块函数 + 构造器（带 prototype 方法）
  installFn(net, 'connect', 'net.connect');
  installFn(net, 'createConnection', 'net.createConnection');
  installFn(net, 'createServer', 'net.createServer');
  installCtor(net, 'Socket', 'net.Socket', makeClassFake('net.Socket', ['connect']));
  installCtor(net, 'Server', 'net.Server', makeClassFake('net.Server', ['listen']));

  installFn(tls, 'connect', 'tls.connect');
  installFn(tls, 'createServer', 'tls.createServer');
  installCtor(tls, 'TLSSocket', 'tls.TLSSocket', makeClassFake('tls.TLSSocket', ['connect']));
  installCtor(tls, 'Server', 'tls.Server', makeClassFake('tls.Server', ['listen']));

  installFn(http, 'request', 'http.request');
  installFn(http, 'get', 'http.get');
  installFn(http, 'createServer', 'http.createServer');
  installCtor(http, 'Server', 'http.Server', makeClassFake('http.Server', ['listen']));
  installCtor(http, 'Agent', 'http.Agent', makeClassFake('http.Agent', ['createConnection']));

  installFn(https, 'request', 'https.request');
  installFn(https, 'get', 'https.get');
  installFn(https, 'createServer', 'https.createServer');
  installCtor(https, 'Server', 'https.Server', makeClassFake('https.Server', ['listen']));
  installCtor(https, 'Agent', 'https.Agent', makeClassFake('https.Agent', ['createConnection']));

  installFn(dgram, 'createSocket', 'dgram.createSocket');
  installCtor(dgram, 'Socket', 'dgram.Socket', makeClassFake('dgram.Socket', ['send', 'bind', 'connect']));

  // dns / dns.promises：模块级 resolve 族 + Resolver 构造器（prototype 全集合）
  const dnsNamesRe = /^(?:lookup|lookupService|resolve[A-Za-z0-9]*|reverse)$/;
  const resolverNamesRe = /^(?:resolve[A-Za-z0-9]*|reverse|cancel|setServers|setLocalAddress|getServers)$/;
  for (const [mod, prefix] of [[dns, 'dns'], [dnsPromises, 'dns.promises']]) {
    for (const key of Object.getOwnPropertyNames(mod)) {
      if (!dnsNamesRe.test(key)) continue;
      installFn(mod, key, `${prefix}.${key}`);
    }
    const realResolver = mod.Resolver;
    const protoNames = [];
    for (let p = realResolver.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      for (const key of Object.getOwnPropertyNames(p)) {
        if (resolverNamesRe.test(key) && !protoNames.includes(key)) protoNames.push(key);
      }
    }
    const fakeResolver = makeClassFake(`${prefix}.Resolver`, protoNames);
    installCtor(mod, 'Resolver', `${prefix}.Resolver`, fakeResolver);
  }

  // globalThis：仅守卫实际可捕获的函数入口（EventSource 在本环境非函数，
  // 真实守卫不会为其建槽；此处不安装，保持与真实环境捕获集合一致）。
  for (const key of ['fetch', 'WebSocket']) {
    installFn(globalThis, key, `globalThis.${key}`);
  }

  const state = Object.freeze({
    name: 'd-network-fakes',
    countOf: (name) => counts.get(name) || 0,
    snapshotCounts: () => Object.freeze(Object.fromEntries([...counts.entries()].sort())),
    target: (name) => targets.get(name),
    installedNames: () => Object.freeze([...targets.keys()].sort()),
    restore() {
      for (const entry of [...originals].reverse()) {
        if (entry.descriptor) Object.defineProperty(entry.object, entry.key, entry.descriptor);
        else delete entry.object[entry.key];
      }
      return Object.freeze({ ok: true, restored: originals.length });
    },
  });
  globalThis.__DSH_D_NETWORK_FAKES__ = state;
  module.exports = state;
}
