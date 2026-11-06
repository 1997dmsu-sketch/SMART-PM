import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COLLECTIONS,
  deviceClaimKey,
  deviceClaimConfig,
  deviceDigest,
  deviceDigestDomainKey,
  assertDigestDomain,
  normalizeDeviceSerial,
  grantSlotKey,
  isKnownCollection,
  nextRevision,
  operationKey,
  validateRecord,
} from "../lib/face-service/collections.mjs";

test("集合名冻结为八张，且可识别", () => {
  assert.deepEqual(Object.values(COLLECTIONS).sort(), [
    "access_devices",
    "device_access_grants",
    "device_claims",
    "device_operation_jobs",
    "device_operation_logs",
    "face_credentials",
    "grant_slot_claims",
    "operation_keys",
  ]);
  assert.equal(isKnownCollection("face_credentials"), true);
  assert.equal(isKnownCollection("face_credentials_extra"), false);
});

test("组织域记录必须带 orgId 与 revision", () => {
  const record = { orgId: "org-demo", revision: 1, reviewState: "draft" };
  assert.equal(validateRecord(COLLECTIONS.FACE_CREDENTIALS, record), record);
  assert.throws(() => validateRecord(COLLECTIONS.FACE_CREDENTIALS, { revision: 1 }), /orgId/);
  assert.throws(
    () => validateRecord(COLLECTIONS.FACE_CREDENTIALS, { orgId: "o", revision: 0 }),
    /revision/,
  );
});

test("枚举校验：reviewState/imageState/grant/job/action", () => {
  const base = { orgId: "o", revision: 1 };
  assert.throws(
    () => validateRecord(COLLECTIONS.FACE_CREDENTIALS, { ...base, reviewState: "synced" }),
    /reviewState/,
  );
  assert.throws(
    () => validateRecord(COLLECTIONS.FACE_CREDENTIALS, { ...base, imageState: "uploaded" }),
    /imageState/,
  );
  assert.throws(
    () => validateRecord(COLLECTIONS.DEVICE_ACCESS_GRANTS, { ...base, state: "active" }),
    /state/,
  );
  assert.throws(
    () => validateRecord(COLLECTIONS.DEVICE_OPERATION_JOBS, { ...base, action: "create" }),
    /action/,
  );
  assert.equal(
    validateRecord(COLLECTIONS.DEVICE_OPERATION_JOBS, { ...base, state: "awaiting_result", action: "enroll" }).state,
    "awaiting_result",
  );
});

test("未知集合与非法记录对象拒绝", () => {
  assert.throws(() => validateRecord("nope", {}), /未知集合/);
  assert.throws(() => validateRecord(COLLECTIONS.ACCESS_DEVICES, null), /对象/);
});

test("nextRevision 递增且从 1 起", () => {
  assert.equal(nextRevision({}), 1);
  assert.equal(nextRevision({ revision: 3 }), 4);
});

test("K1 配置校验：Base64 32 字节、正整数版本、非空 realm", () => {
  const key = Buffer.alloc(32, 7);
  const env = {
    DEVICE_CLAIM_HMAC_KEY_B64: key.toString("base64"),
    DEVICE_CLAIM_KEY_VERSION: "1",
    DEVICE_DIGEST_REALM: "prod-a",
  };
  assert.deepEqual(deviceClaimConfig(env), { key, version: 1, realm: "prod-a" });
  assert.throws(() => deviceClaimConfig({ ...env, DEVICE_CLAIM_HMAC_KEY_B64: "" }), /Base64|32 字节/);
  assert.throws(() => deviceClaimConfig({ ...env, DEVICE_CLAIM_HMAC_KEY_B64: Buffer.alloc(16).toString("base64") }), /32 字节/);
  assert.throws(() => deviceClaimConfig({ ...env, DEVICE_CLAIM_HMAC_KEY_B64: `${"A".repeat(43)}!` }), /Base64/);
  assert.throws(() => deviceClaimConfig({ ...env, DEVICE_CLAIM_HMAC_KEY_B64: `${key.toString("base64")}junk` }), /Base64/);
  assert.throws(() => deviceClaimConfig({ ...env, DEVICE_CLAIM_KEY_VERSION: "0" }), /正整数/);
  assert.throws(() => deviceClaimConfig({ ...env, DEVICE_DIGEST_REALM: "" }), /REALM/);
});

test("设备 claim：HMAC-SHA256、序列号规范化、版本参与摘要", () => {
  const key = Buffer.alloc(32, 7);
  const config = { key, version: 1 };
  assert.equal(normalizeDeviceSerial("  ab-12 "), "AB-12");
  assert.equal(deviceDigest("AB-12", config), deviceDigest(" ab-12 ", config));
  assert.notEqual(deviceDigest("AB-12", config), deviceDigest("AB-12", { key, version: 2 }));
  const claim = deviceClaimKey({ digestRealm: "prod-a", serial: "AB-12", key, version: 1 });
  assert.match(claim, /^provider-device:aGlrdmlzaW9u:cHJvZC1h:[0-9a-f]{64}$/);
});

test("device_digest_domains：换钥后版本不匹配即失败关闭", () => {
  const domainKey = deviceDigestDomainKey({ digestRealm: "prod-a", version: 1 });
  assert.equal(domainKey, "device-digest-domain:aGlrdmlzaW9u:cHJvZC1h");
  assert.doesNotThrow(() => assertDigestDomain({ keyVersion: 1 }, { version: 1 }));
  assert.throws(() => assertDigestDomain({ keyVersion: 1 }, { version: 2 }), (e) => e.code === "DOMAIN_MISMATCH");
});

test("grant slot 固定键：org+person+device+cycle，缺一不可", () => {
  const slot = grantSlotKey({ orgId: "o", personId: "p", deviceId: "d", cycleId: "c" });
  assert.match(slot, /^grant-slot:/);
  assert.throws(() => grantSlotKey({ orgId: "o", personId: "p", deviceId: "d" }), /cycleId/);
  assert.notEqual(
    grantSlotKey({ orgId: "o", personId: "p", deviceId: "d", cycleId: "c1" }),
    grantSlotKey({ orgId: "o", personId: "p", deviceId: "d", cycleId: "c2" }),
  );
});

test("K1 与 K2 分离：设备摘要不等于 operation key", () => {
  const key = Buffer.alloc(32, 7);
  const digest = deviceDigest("AB-12", { key, version: 1 });
  const op = operationKey({ orgId: "o", method: "enroll", actorType: "user", actorId: "a", idempotencyKey: "k" });
  assert.notEqual(digest, op);
  assert.equal(op.startsWith("op:"), true);
});

test("操作幂等键包含组织/方法/actor/幂等键", () => {
  const key = operationKey({
    orgId: "org-demo",
    method: "enroll",
    actorType: "user",
    actorId: "admin-1",
    idempotencyKey: "idem-key-0000000001",
  });
  assert.equal(key, "op:org-demo:enroll:user:admin-1:idem-key-0000000001");
  assert.notEqual(
    key,
    operationKey({
      orgId: "org-other",
      method: "enroll",
      actorType: "user",
      actorId: "admin-1",
      idempotencyKey: "idem-key-0000000001",
    }),
  );
  assert.throws(
    () => operationKey({ orgId: "o", method: "enroll", actorType: "user", actorId: "", idempotencyKey: "k" }),
    /actorId/,
  );
});

test("固定键无分隔符碰撞：冒号不会串键", () => {
  const a = grantSlotKey({ orgId: "a:b", personId: "c", deviceId: "d", cycleId: "e" });
  const b = grantSlotKey({ orgId: "a", personId: "b:c", deviceId: "d", cycleId: "e" });
  assert.notEqual(a, b);

  const key = Buffer.alloc(32, 7);
  const c1 = deviceClaimKey({ provider: "a:b", digestRealm: "c", serial: "S", key, version: 1 });
  const c2 = deviceClaimKey({ provider: "a", digestRealm: "b:c", serial: "S", key, version: 1 });
  assert.notEqual(c1, c2);
});

test("domain head 不含版本：换钥后仍读取同一条记录", () => {
  const head = deviceDigestDomainKey({ digestRealm: "prod-a" });
  const versioned = deviceDigestDomainKey({ provider: "hikvision", digestRealm: "prod-a" });
  assert.equal(head, versioned);
  assert.equal(head.includes(":1"), false);
});
