import { test } from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { readFile } from "node:fs/promises";
import { X509Certificate } from "node:crypto";

import {
  certificateValidity,
  httpsGet,
  matchFingerprint,
  normalizeFingerprint,
  parseFingerprints,
} from "../src/http.mjs";

/**
 * 真实 TLS 集成测试：本地起一个**自签名** HTTPS 服务，验证指纹固定链路。
 * 证书见 fixtures/tls/（仅测试用，口令写在下面；不含任何真实设备材料）。
 */
const PASSPHRASE = "probe-test-only";
const fixture = (name) => readFile(new URL(`../fixtures/tls/${name}`, import.meta.url));

const [pfxA, derA, pfxB, derB] = await Promise.all([
  fixture("cert-a.pfx"),
  fixture("cert-a.der"),
  fixture("cert-b.pfx"),
  fixture("cert-b.der"),
]);
const fpA = normalizeFingerprint(new X509Certificate(derA).fingerprint256);
const fpB = normalizeFingerprint(new X509Certificate(derB).fingerprint256);

async function startServer(pfx, handler) {
  const server = https.createServer({ pfx, passphrase: PASSPHRASE }, handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    port,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

const okHandler = (req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, path: req.url }));
};

test("指纹解析：支持冒号格式、去重、拒绝非法长度", () => {
  const parsed = parseFingerprints(`${fpA.slice(0, 32).toLowerCase()}:${fpA.slice(32).toLowerCase()}, ${fpB}`);
  assert.deepEqual(parsed, [fpA, fpB]);
  assert.deepEqual(parseFingerprints(""), []);
  assert.throws(() => parseFingerprints("abc"), /64 位十六进制/);
});

test("指纹比较：常量时间匹配当前/下一枚", () => {
  assert.equal(matchFingerprint(derA, [fpA]), 0);
  assert.equal(matchFingerprint(derA, [fpB, fpA]), 1);
  assert.equal(matchFingerprint(derA, [fpB]), -1);
  assert.equal(matchFingerprint(null, [fpA]), -1);
});

test("自签名 TLS：正确指纹 → 200", async () => {
  const server = await startServer(pfxA, okHandler);
  try {
    const res = await httpsGet({
      host: "127.0.0.1",
      port: server.port,
      path: "/ISAPI/System/deviceInfo",
      fingerprints: [fpA],
      timeoutMs: 2000,
    });
    assert.equal(res.status, 200);
    assert.equal(res.pinnedSlot, 0);
    assert.equal(res.certExpired, false);
    assert.match(res.body.toString("utf8"), /"ok":true/);
  } finally {
    await server.close();
  }
});

test("自签名 TLS：错误指纹 → 立即终止，请求不发出", async () => {
  let reached = false;
  const server = await startServer(pfxA, (req, res) => {
    reached = true;
    okHandler(req, res);
  });
  try {
    await assert.rejects(
      () =>
        httpsGet({
          host: "127.0.0.1",
          port: server.port,
          path: "/ISAPI/System/deviceInfo",
          fingerprints: [fpB],
          timeoutMs: 2000,
        }),
      (error) => error.code === "FINGERPRINT_MISMATCH",
    );
    assert.equal(reached, false, "指纹不匹配时不得把请求送到设备");
  } finally {
    await server.close();
  }
});

test("自签名 TLS：未配置指纹时仍走系统信任链并失败（不存在跳过校验的配置）", async () => {
  const server = await startServer(pfxA, okHandler);
  try {
    await assert.rejects(
      () =>
        httpsGet({
          host: "127.0.0.1",
          port: server.port,
          path: "/ISAPI/System/deviceInfo",
          timeoutMs: 2000,
        }),
      (error) => error.code === "NETWORK" && /self-signed|certificate/i.test(error.message),
    );
  } finally {
    await server.close();
  }
});

test("双指纹轮换：服务器换成下一枚证书时仍可连接，并标记 pinnedSlot=1", async () => {
  const server = await startServer(pfxB, okHandler);
  try {
    const res = await httpsGet({
      host: "127.0.0.1",
      port: server.port,
      path: "/ISAPI/System/deviceInfo",
      fingerprints: [fpA, fpB],
      timeoutMs: 2000,
    });
    assert.equal(res.status, 200);
    assert.equal(res.pinnedSlot, 1);
  } finally {
    await server.close();
  }
});

test("拒绝重定向：302 不跟随", async () => {
  const server = await startServer(pfxA, (req, res) => {
    res.writeHead(302, { location: "https://example.com/elsewhere" });
    res.end();
  });
  try {
    await assert.rejects(
      () =>
        httpsGet({
          host: "127.0.0.1",
          port: server.port,
          path: "/ISAPI/System/deviceInfo",
          fingerprints: [fpA],
          timeoutMs: 2000,
        }),
      (error) => error.code === "REDIRECT",
    );
  } finally {
    await server.close();
  }
});

test("响应体超过上限：中断并报 TOO_LARGE", async () => {
  const server = await startServer(pfxA, (req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("x".repeat(4096));
  });
  try {
    await assert.rejects(
      () =>
        httpsGet({
          host: "127.0.0.1",
          port: server.port,
          path: "/ISAPI/System/deviceInfo",
          fingerprints: [fpA],
          maxBytes: 1024,
          timeoutMs: 2000,
        }),
      (error) => error.code === "TOO_LARGE",
    );
  } finally {
    await server.close();
  }
});

test("请求超时：服务端不响应时按 TIMEOUT 失败", async () => {
  const server = await startServer(pfxA, () => {
    /* 故意不响应 */
  });
  try {
    await assert.rejects(
      () =>
        httpsGet({
          host: "127.0.0.1",
          port: server.port,
          path: "/ISAPI/System/deviceInfo",
          fingerprints: [fpA],
          timeoutMs: 300,
        }),
      (error) => error.code === "TIMEOUT",
    );
  } finally {
    await server.close();
  }
});

test("证书有效期：过期只标记不阻断（复审决定）", () => {
  assert.equal(certificateValidity({ valid_to: "2020-01-01T00:00:00.000Z" }).expired, true);
  assert.equal(certificateValidity({ valid_to: "2999-01-01T00:00:00.000Z" }).expired, false);
  assert.equal(certificateValidity({}).expired, null);
  assert.equal(certificateValidity(null).expired, null);
});