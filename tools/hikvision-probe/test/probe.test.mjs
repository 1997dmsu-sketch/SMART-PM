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
  expectedModel: "DS-K1T671BM",
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

const endpointOf = (path) => READ_ENDPOINTS.find((endpoint) => buildRequestPath(endpoint) === path);

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

const deviceInfo200 = (body = deviceXml) => () => ({
  status: 200,
  headers: { "content-type": "application/xml" },
  body: Buffer.from(body),
});

const never = () => {
  throw new Error("不应发送第二个请求");
};

test("dry-run 不校验型号，也不调用 transport", async () => {
  const transport = makeTransport();
  const result = await runProbe({ config: { ...BASE, allowRead: false, expectedModel: "" }, transport });
  assert.equal(result.mode, "dry-run");
  assert.equal(result.plan.length, 6);
  assert.equal(transport.calls.length, 0);
});

test("缺少预批准型号：拒绝执行且零请求", async () => {
  const transport = makeTransport();
  await assert.rejects(() => runProbe({ config: { ...BASE, expectedModel: "" }, transport }), /预批准型号/);
  assert.equal(transport.calls.length, 0);
});

test("正常路径：型号一致后继续全部六个端点", async () => {
  const transport = makeTransport();
  const result = await runProbe({ config: BASE, transport });
  assert.equal(transport.calls.length, 7);
  assert.equal(result.report.checks.length, 6);
  assert.ok(result.report.checks.every((check) => check.ok));
  assert.equal(result.report.device.model, "DS-K1T671BM");
  assert.equal(result.report.capabilities.faceLibraryManagement, true);
  assert.equal(result.report.aborted, null);
});

test("型号不一致：只请求 deviceInfo，立即中止", async () => {
  const transport = makeTransport({
    deviceInfo: deviceInfo200(deviceXml.replace("DS-K1T671BM", "DS-K1T671B")),
    acsCapabilities: never,
  });
  const result = await runProbe({ config: BASE, transport });
  assert.equal(transport.calls.length, 1);
  assert.equal(result.report.aborted.code, "MODEL_MISMATCH");
  assert.equal(result.report.checks.length, 1);
});

test("deviceInfo 无型号：中止且不再请求", async () => {
  const transport = makeTransport({
    deviceInfo: deviceInfo200(deviceXml.replace("<model>DS-K1T671BM</model>", "")),
    acsCapabilities: never,
  });
  const result = await runProbe({ config: BASE, transport });
  assert.equal(transport.calls.length, 1);
  assert.equal(result.report.aborted.code, "MODEL_UNPARSED");
});

test("第二次 401：中止，只发生两次请求", async () => {
  const transport = makeTransport({
    deviceInfo: () => ({ status: 401, headers: { "www-authenticate": CHALLENGE }, body: Buffer.from("") }),
  });
  const result = await runProbe({ config: BASE, transport });
  assert.equal(transport.calls.length, 2);
  assert.equal(result.report.aborted.code, "AUTH_FAILED");
});

test("不可解析的挑战：中止", async () => {
  const transport = makeTransport({
    deviceInfo: () => ({ status: 401, headers: {}, body: Buffer.from("") }),
  });
  const result = await runProbe({ config: BASE, transport });
  assert.equal(transport.calls.length, 1);
  assert.equal(result.report.aborted.code, "AUTH_CHALLENGE");
});

test("畸形 Digest 挑战（缺 realm）：立即中止，后五个端点零调用", async () => {
  const transport = makeTransport({
    deviceInfo: () => ({
      status: 401,
      headers: { "www-authenticate": 'Digest nonce="only-nonce"' },
      body: Buffer.from(""),
    }),
    acsCapabilities: never,
  });
  const result = await runProbe({ config: BASE, transport });
  assert.equal(transport.calls.length, 1);
  assert.equal(result.report.aborted.code, "AUTH_CHALLENGE");
  assert.match(result.report.aborted.reason, /realm/);
});

test("不支持的 Digest 算法（Authorization 构造失败）：中止", async () => {
  const transport = makeTransport({
    deviceInfo: () => ({
      status: 401,
      headers: { "www-authenticate": 'Digest realm="r", nonce="n", algorithm=SHA1' },
      body: Buffer.from(""),
    }),
    acsCapabilities: never,
  });
  const result = await runProbe({ config: BASE, transport });
  assert.equal(transport.calls.length, 1);
  assert.equal(result.report.aborted.code, "AUTH_CHALLENGE");
});

test("响应流错误 RESPONSE_ERROR：立即中止", async () => {
  const transport = makeTransport({
    deviceInfo: () => {
      throw new HttpError("RESPONSE_ERROR", "stream reset");
    },
    acsCapabilities: never,
  });
  const result = await runProbe({ config: BASE, transport });
  assert.equal(transport.calls.length, 1);
  assert.equal(result.report.aborted.code, "RESPONSE_ERROR");
});

for (const [label, error, code] of [
  ["证书/TLS 错误", new HttpError("NETWORK", "self-signed certificate"), "NETWORK"],
  ["超时", new HttpError("TIMEOUT", "请求超时"), "TIMEOUT"],
  ["重定向", new HttpError("REDIRECT", "拒绝重定向：302"), "REDIRECT"],
  ["响应超限", new HttpError("TOO_LARGE", "响应体超过上限"), "TOO_LARGE"],
  ["指纹不匹配", new HttpError("FINGERPRINT_MISMATCH", "指纹不一致"), "FINGERPRINT_MISMATCH"],
]) {
  test(`${label}：立即中止，不再请求其余端点`, async () => {
    const transport = makeTransport({
      deviceInfo: () => {
        throw error;
      },
      acsCapabilities: never,
    });
    const result = await runProbe({ config: BASE, transport });
    assert.equal(transport.calls.length, 1);
    assert.equal(result.report.aborted.code, code);
  });
}

test("内容类型异常：中止", async () => {
  const transport = makeTransport({
    deviceInfo: () => ({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("<html>") }),
    acsCapabilities: never,
  });
  const result = await runProbe({ config: BASE, transport });
  assert.equal(transport.calls.length, 1);
  assert.equal(result.report.aborted.code, "CONTENT_TYPE");
});

test("空能力集不是致命错误：继续完成其余端点", async () => {
  const transport = makeTransport({
    acsCapabilities: () => ({
      status: 200,
      headers: { "content-type": "application/xml" },
      body: Buffer.from('<?xml version="1.0"?><AccessControlCapabilities/>'),
    }),
  });
  const result = await runProbe({ config: BASE, transport });
  assert.equal(result.report.aborted, null);
  assert.equal(result.report.capabilities.faceLibraryManagement, false);
  assert.equal(result.report.checks.length, 6);
});

test("畸形 JSON 计数：不中断，计数为 null", async () => {
  const transport = makeTransport({
    fdlibCount: () => ({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("{broken") }),
  });
  const result = await runProbe({ config: BASE, transport });
  assert.equal(result.report.counts.faceRecords, null);
  assert.equal(result.report.checks.length, 6);
});

test("报告不含 IP/序列号/MAC/账号/nonce", async () => {
  const transport = makeTransport();
  const result = await runProbe({ config: BASE, transport });
  const text = JSON.stringify(result.report);
  assert.equal(result.report.target.host, "192.168.x.x");
  for (const secret of ["192.168.1.64", "SN1234567890", "aa-bb-cc-dd-ee-ff", "admin", "abc123def456"]) {
    assert.equal(text.includes(secret), false, `报告不应包含 ${secret}`);
  }
});

test("越权主机与缺凭据在发请求前拒绝", async () => {
  const transport = makeTransport();
  await assert.rejects(() => runProbe({ config: { ...BASE, host: "10.0.0.9" }, transport }), /不在允许列表/);
  await assert.rejects(() => runProbe({ config: { ...BASE, password: "" }, transport }), /缺少设备账号或密码/);
  assert.equal(transport.calls.length, 0);
});
