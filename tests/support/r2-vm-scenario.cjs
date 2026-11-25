/**
 * CF-R2-12 第二轮 VM 场景（子进程运行）：
 * 预载顺序 --require d-network-fakes.cjs --require <guard|guard-mutant>。
 * 证明：捕获=安装目标、正控调用目标 +1、过 wrapper 目标零增长（逐槽相等断言）、
 * 缺陷注入（wrapper 直接调用 record.original 再抛拦截错误）必须被转发计数拒绝。
 */
'use strict';
const assert = require('node:assert/strict');

const fakes = globalThis.__DSH_D_NETWORK_FAKES__;
const guard = globalThis.__DSH_D_NETWORK_GUARD__;
assert.ok(fakes, 'VM 场景要求先预载 d-network-fakes');
assert.ok(guard, 'VM 场景要求再预载 d-network-guard');

const EXPECTED_LABELS = [
  'net.connect', 'net.createConnection', 'net.createServer', 'net.Socket.prototype.connect', 'net.Server.prototype.listen',
  'tls.connect', 'tls.createServer', 'tls.TLSSocket.prototype.connect', 'tls.Server.prototype.listen',
  'http.request', 'http.get', 'http.createServer', 'https.request', 'https.get', 'https.createServer',
  'http.Server.prototype.listen', 'https.Server.prototype.listen',
  'http.Agent.prototype.createConnection', 'https.Agent.prototype.createConnection',
  'dgram.createSocket', 'dgram.Socket.prototype.send', 'dgram.Socket.prototype.bind', 'dgram.Socket.prototype.connect',
  'dns.lookup', 'dns.lookupService', 'dns.resolve', 'dns.resolve4', 'dns.resolve6', 'dns.resolveAny', 'dns.resolveCaa',
  'dns.resolveCname', 'dns.resolveMx', 'dns.resolveNaptr', 'dns.resolveNs', 'dns.resolvePtr', 'dns.resolveSoa',
  'dns.resolveSrv', 'dns.resolveTlsa', 'dns.resolveTxt', 'dns.reverse',
  'dns.promises.lookup', 'dns.promises.lookupService', 'dns.promises.resolve', 'dns.promises.resolve4',
  'dns.promises.resolve6', 'dns.promises.resolveAny', 'dns.promises.resolveCaa', 'dns.promises.resolveCname',
  'dns.promises.resolveMx', 'dns.promises.resolveNaptr', 'dns.promises.resolveNs', 'dns.promises.resolvePtr',
  'dns.promises.resolveSoa', 'dns.promises.resolveSrv', 'dns.promises.resolveTlsa', 'dns.promises.resolveTxt',
  'dns.promises.reverse',
  'dns.Resolver.prototype.resolveAny', 'dns.Resolver.prototype.resolve4', 'dns.Resolver.prototype.resolve6',
  'dns.Resolver.prototype.resolveCaa', 'dns.Resolver.prototype.resolveCname', 'dns.Resolver.prototype.resolveMx',
  'dns.Resolver.prototype.resolveNs', 'dns.Resolver.prototype.resolveTlsa', 'dns.Resolver.prototype.resolveTxt',
  'dns.Resolver.prototype.resolveSrv', 'dns.Resolver.prototype.resolvePtr', 'dns.Resolver.prototype.resolveNaptr',
  'dns.Resolver.prototype.resolveSoa', 'dns.Resolver.prototype.reverse', 'dns.Resolver.prototype.resolve',
  'dns.Resolver.prototype.cancel', 'dns.Resolver.prototype.getServers', 'dns.Resolver.prototype.setServers',
  'dns.Resolver.prototype.setLocalAddress',
  'dns.promises.Resolver.prototype.resolveAny', 'dns.promises.Resolver.prototype.resolve4',
  'dns.promises.Resolver.prototype.resolve6', 'dns.promises.Resolver.prototype.resolveCaa',
  'dns.promises.Resolver.prototype.resolveCname', 'dns.promises.Resolver.prototype.resolveMx',
  'dns.promises.Resolver.prototype.resolveNs', 'dns.promises.Resolver.prototype.resolveTlsa',
  'dns.promises.Resolver.prototype.resolveTxt', 'dns.promises.Resolver.prototype.resolveSrv',
  'dns.promises.Resolver.prototype.resolvePtr', 'dns.promises.Resolver.prototype.resolveNaptr',
  'dns.promises.Resolver.prototype.resolveSoa', 'dns.promises.Resolver.prototype.reverse',
  'dns.promises.Resolver.prototype.resolve', 'dns.promises.Resolver.prototype.cancel',
  'dns.promises.Resolver.prototype.getServers', 'dns.promises.Resolver.prototype.setServers',
  'dns.promises.Resolver.prototype.setLocalAddress',
  'dns.Resolver', 'dns.promises.Resolver',
  'globalThis.fetch', 'globalThis.WebSocket',
];

function failForwarding(name, delta) {
  const error = new Error(`FORWARDING_DETECTED: ${name} countDelta=${delta}`);
  error.code = 'FORWARDING_DETECTED';
  throw error;
}

async function main() {
  const report = {
    guardVersion: guard.version,
    patchedCount: guard.patchedCount,
    expectedCount: EXPECTED_LABELS.length,
    identityMismatches: [],
    positiveFailures: [],
    covered: [],
    uncovered: [],
    forwarded: [],
    selfTest: null,
    bindings: null,
  };
  const captured = guard.capturedTargets();
  const byName = new Map(captured.map((c) => [c.name, c.target]));

  // 期望清单与捕获集合相等（双向）。
  const patchedSet = new Set(guard.patchedEntries);
  const expectedSet = new Set(EXPECTED_LABELS);
  report.expectedMissingFromPatched = EXPECTED_LABELS.filter((l) => !patchedSet.has(l));
  report.patchedExtra = guard.patchedEntries.filter((l) => !expectedSet.has(l));

  // 1) 捕获身份：每个槽捕获的必须就是注入器安装的 fake 目标。
  for (const label of EXPECTED_LABELS) {
    if (!byName.has(label) || fakes.target(label) !== byName.get(label)) {
      report.identityMismatches.push(label);
    }
  }

  // 2) 正控：直接调用安装目标 → 计数 +1（逐槽相等断言）。
  for (const label of EXPECTED_LABELS) {
    const before = fakes.countOf(label);
    fakes.target(label).apply(undefined, []);
    if (fakes.countOf(label) !== before + 1) report.positiveFailures.push(label);
  }

  // 3) 负控：经 wrapper 调用 → 必须抛拦截错误，且外部目标计数零增长。
  for (const label of EXPECTED_LABELS) {
    const before = fakes.countOf(label);
    let code = null;
    try { guard.invokeWrapper(label); } catch (error) { code = error && error.code; }
    const delta = fakes.countOf(label) - before;
    if (delta > 0) failForwarding(label, delta);
    if (code !== 'D_NETWORK_GUARD_BLOCKED') report.uncovered.push({ label, code });
    else if (delta === 0) report.covered.push(label);
    else report.uncovered.push({ label, code, delta });
  }
  report.covered.sort();
  report.coveredEqual = JSON.stringify(report.covered) === JSON.stringify([...EXPECTED_LABELS].sort());

  // 4) VM 内 selfTest（fake 目标下委托无内部网络命中，blocked 增量必须精确归因）。
  report.selfTest = guard.selfTest();

  // 5) ESM 命名绑定仍指向守卫 wrapper。
  report.bindings = await guard.verifyNamedBindings();

  const ok = report.identityMismatches.length === 0
    && report.positiveFailures.length === 0
    && report.uncovered.length === 0
    && report.coveredEqual
    && report.expectedMissingFromPatched.length === 0
    && report.patchedExtra.length === 0
    && report.selfTest.ok === true
    && report.selfTest.internalBlocked === 0
    && report.selfTest.blockedDelta === report.patchedCount
    && report.bindings.ok === true;
  process.stdout.write(JSON.stringify({ ok, report }));
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  if (error && error.code === 'FORWARDING_DETECTED') {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`SCENARIO_ERROR: ${error && error.message}\n`);
    process.exitCode = 3;
  }
});
