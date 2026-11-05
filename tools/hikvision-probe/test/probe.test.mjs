import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { READ_ENDPOINTS, buildRequestPath } from "../src/allowlist.mjs";
import { HttpError } from "../src/http.mjs";
import { runProbe } from "../src/probe.mjs";

const fixture = (name) => readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const [deviceXml, capsXml, userCaps, fdlibCaps, fdlibList, fdlibCount] = await Promise.all([
  fixture("deviceInfo.xml"),
  fixture("acs-capabilities.xml"),
  fixture("userinfo-capabilities.json"),
  fixture("fdlib-capabilities.json"),
  fixture("fdlib-list.json"),
  fixture("fdlib-count.json"),
]);

const CHALLENGE =
  'Digest realm="DS-K1T671BM", qop="auth", nonce="abc123def456", opaque="op-1", algorithm=MD5';

const BASE = {
  allowRead: true,
  host: "192.168.1.64",
  port: 443,
  allowedHosts: ["192.168.1.64"],
  allowedPorts: [443],
  username: "admin",
  password: "Passw0rd!",
  timeoutMs: 500,
  maxBytes: 1024 * 1024,
  salt: "test-salt",
};

function fixturesFor(id) {
  return {
    deviceInfo: { type: "application/xml", body: deviceXml },
    acsCapabilities: { type: "application/xml", body: capsXml },
    userInfoCapabilities: { type: "application/json", body: userCaps },
    fdlibCapabilities: { type: "application/json", body: fdlibCaps },
    fdlibList: { type: "application/json", body: fdlibList },
    fdlibCount: { type: "application/json", body: fdlibCount },
  }[id];
}

function endpointOf(path) {
  return READ_ENDPOINTS.find((endpoint) => buildRequestPath(endpoint) === path);
}

/** 模拟一台要求 Digest 的设备；可用 overrides 覆盖单个端点行为。 */
function makeTransport(overrides = {}) {
  const calls = [];
  const fn = async (options) => {
    calls.push(options);
    const endpoint = endpointOf(options.path);
    if (!endpoint) return { status: 404, headers: {}, body: Buffer.from("") };
    if (overrides[endpoint.id]) return overrides[endpoint.id](options, endpoint);
    if (!options.headers?.Authorization) {
      return { status: 401, headers: { "www-authenticate": CHALLENGE }, body: Buffer.from("") };
    }
    const item = fixturesFor(endpoint.id);
    return { status: 200, headers: { "content-type": item.type }, body: Buffer.from(item.body) };
  };
  fn.calls = calls;
  return fn;
}

test("dry-run 不调用 transport，只返回计划", async () => {
  const transport = makeTransport();
  const result = await runProbe({ config: { ...BASE, allowRead: false }, transport });
  assert.equal(result.mode, "dry-run");
  assert.equal(result.plan.length, 6);
  assert.equal(result.report, null);
  assert.equal(transport.calls.length, 0);
});

test("只读探针：先 401 取挑战，再带 Digest 重试，其余端点复用挑战", async () => {
  const transport = makeTransport();
  const result = await runProbe({ config: BASE, transport });

  assert.equal(result.mode, "read-only");
  assert.equal(transport.calls.length, 7, "首个端点 2 次，其余各 1 次");
  assert.equal(transport.calls[0].headers?.Authorization, undefined);
  assert.match(transport.calls[1].headers.Authorization, /^Digest /);

  assert.equal(result.report.checks.length, 6);
  assert.ok(result.report.checks.every((check) => check.ok), JSON.stringify(result.report.checks));
  assert.equal(result.report.device.model, "DS-K1T671BM");
  assert.equal(result.report.device.firmwareVersion, "V3.2.1");
  assert.equal(result.report.capabilities.faceLibraryManagement, true);
  assert.equal(result.report.counts.faceRecords, 12);
  assert.deepEqual(result.report.blockers, []);
});

test("报告与目标字段全部脱敏（无 IP/序列号/MAC/账号/nonce）", async () => {
  const transport = makeTransport();
  const result = await runProbe({ config: BASE, transport });
  const text = JSON.stringify(result.report);

  assert.equal(result.report.target.host, "192.168.x.x");
  for (const secret of ["192.168.1.64", "SN1234567890", "aa-bb-cc-dd-ee-ff", "admin", "abc123def456", "op-1"]) {
    assert.equal(text.includes(secret), false, `报告不应包含 ${secret}`);
  }
});

test("认证失败：两端点均 401 时所有检查失败并给出 blockers", async () => {
  const transport = async () => ({ status: 401, headers: { "www-authenticate": CHALLENGE }, body: Buffer.from("") });
  const result = await runProbe({ config: BASE, transport });
  assert.equal(result.report.checks.filter((check) => check.ok).length, 0);
  assert.equal(result.report.blockers.length, 6);
  assert.match(result.report.blockers[0], /HTTP 401/);
});

test("设备不返回 Digest 挑战时记录为认证失败", async () => {
  const transport = async () => ({ status: 401, headers: {}, body: Buffer.from("") });
  const result = await runProbe({ config: BASE, transport });
  assert.match(result.report.checks[0].error, /Digest|认证/);
});

test("证书错误与超时：按端点记录错误，不中断整体", async () => {
  const certTransport = makeTransport({
    deviceInfo: () => {
      throw new HttpError("CERT", "certificate has expired");
    },
    acsCapabilities: () => {
      throw new HttpError("TIMEOUT", "请求超时（500ms）");
    },
  });
  const result = await runProbe({ config: BASE, transport: certTransport });
  assert.equal(result.report.checks.find((c) => c.id === "deviceInfo").ok, false);
  assert.match(result.report.checks.find((c) => c.id === "deviceInfo").error, /certificate/);
  assert.match(result.report.checks.find((c) => c.id === "acsCapabilities").error, /超时/);
  // 其余端点仍应成功
  assert.equal(result.report.checks.filter((c) => c.ok).length, 4);
});

test("空能力集：不误判为支持人脸库", async () => {
  const transport = makeTransport({
    acsCapabilities: () => ({
      status: 200,
      headers: { "content-type": "application/xml" },
      body: Buffer.from('<?xml version="1.0"?><AccessControlCapabilities/>'),
    }),
  });
  const result = await runProbe({ config: BASE, transport });
  assert.equal(result.report.capabilities.faceLibraryManagement, false);
  assert.equal(result.report.capabilities.acsNodeCount, 0);
});

test("畸形 JSON：计数解析失败但探针不崩溃", async () => {
  const transport = makeTransport({
    fdlibCount: () => ({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("{broken") }),
    fdlibList: () => ({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("{broken") }),
  });
  const result = await runProbe({ config: BASE, transport });
  assert.equal(result.report.counts.faceRecords, null);
  assert.ok(result.report.checks.every((check) => check.ok), "HTTP 层成功即视为端点可用");
});

test("近似型号且能力不支持：如实记录，不推断为支持", async () => {
  const transport = makeTransport({
    deviceInfo: () => ({
      status: 200,
      headers: { "content-type": "application/xml" },
      body: Buffer.from(deviceXml.replace("DS-K1T671BM", "DS-K1T671B")),
    }),
    acsCapabilities: () => ({
      status: 200,
      headers: { "content-type": "application/xml" },
      body: Buffer.from("<AccessControlCapabilities><isSupportCard>true</isSupportCard></AccessControlCapabilities>"),
    }),
  });
  const result = await runProbe({ config: BASE, transport });
  assert.equal(result.report.device.model, "DS-K1T671B");
  assert.equal(result.report.capabilities.faceLibraryManagement, false);
});

test("响应类型不符：记录错误而不是当作成功", async () => {
  const transport = makeTransport({
    deviceInfo: () => ({
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from("<html></html>"),
    }),
  });
  const result = await runProbe({ config: BASE, transport });
  const check = result.report.checks.find((c) => c.id === "deviceInfo");
  assert.equal(check.ok, false);
  assert.match(check.error, /响应类型/);
});

test("越权主机在发起请求前被拒绝", async () => {
  const transport = makeTransport();
  await assert.rejects(
    () => runProbe({ config: { ...BASE, host: "10.0.0.9", allowedHosts: ["192.168.1.64"] }, transport }),
    /不在允许列表/,
  );
  assert.equal(transport.calls.length, 0);
});

test("缺少账号密码时拒绝执行", async () => {
  const transport = makeTransport();
  await assert.rejects(
    () => runProbe({ config: { ...BASE, username: "", password: "" }, transport }),
    /缺少设备账号或密码/,
  );
  assert.equal(transport.calls.length, 0);
});
