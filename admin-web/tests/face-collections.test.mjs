import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COLLECTIONS,
  deviceClaimKey,
  deviceClaimConfig,
  deviceDigest,
  deviceDigestDomainKey,
  deviceDigestDomainVersionKey,
  assertDigestDomain,
  normalizeDeviceSerial,
  grantSlotKey,
  isKnownCollection,
  nextRevision,
  operationKey,
  operationKeyConfig,
  operationKeyFingerprint,
  applyOperationKeyDomain,
  validateRecord,
  validateDigestDomainRecord,
  applyDigestDomain,
} from "../lib/face-service/collections.mjs";

test("集合名冻结为十张，且可识别", () => {
  assert.deepEqual(Object.values(COLLECTIONS).sort(), [
    "access_devices",
    "device_access_grants",
    "device_claims",
    "device_digest_domains",
    "device_operation_jobs",
    "device_operation_logs",
    "face_credentials",
    "grant_slot_claims",
    "operation_key_domains",
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
  const config = { key, version: 1, realm: "test-realm" };
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
  const op = operationKey({ orgId: "o", method: "enroll", actorType: "user", actorId: "a", idempotencyKey: "idem-key-0000000001", config: { key: Buffer.alloc(32, 9), version: 1 } });
  assert.notEqual(digest, op);
  assert.equal(op.startsWith("op:"), true);
  assert.equal(op.startsWith("provider-device:"), false);
});

test("K2 operation key：HMAC 摘要、幂等键格式与配置校验", () => {
  const key = Buffer.alloc(32, 9);
  const config = { key, version: 1, realm: "test-realm" };
  const a = operationKey({ orgId: "org-demo", method: "enroll", actorType: "user", actorId: "admin-1", idempotencyKey: "idem-key-0000000001", config });
  assert.match(a, /^op:/);
  assert.equal(a.includes("idem-key-0000000001"), false);
  const b = operationKey({ orgId: "org-other", method: "enroll", actorType: "user", actorId: "admin-1", idempotencyKey: "idem-key-0000000001", config });
  assert.notEqual(a, b);
  assert.throws(
    () => operationKey({ orgId: "o", method: "enroll", actorType: "user", actorId: "a", idempotencyKey: "short", config }),
    /Idempotency-Key/,
  );
  assert.throws(() => operationKeyConfig({ OPERATION_KEY_HMAC_KEY_B64: "", OPERATION_KEY_VERSION: "1", OPERATION_KEY_REALM: "r" }), /Base64/);
  assert.throws(
    () => operationKeyConfig({ OPERATION_KEY_HMAC_KEY_B64: Buffer.alloc(32, 9).toString("base64"), OPERATION_KEY_VERSION: "1", OPERATION_KEY_REALM: "R" }),
    (e) => e.code === "NOT_CONFIGURED",
  );
  assert.throws(
    () => operationKeyConfig({ OPERATION_KEY_HMAC_KEY_B64: Buffer.alloc(32, 9).toString("base64"), OPERATION_KEY_VERSION: "1", OPERATION_KEY_REALM: " test-realm " }),
    (e) => e.code === "NOT_CONFIGURED",
  );
  assert.throws(
    () => operationKeyConfig({ OPERATION_KEY_HMAC_KEY_B64: key.toString("base64"), OPERATION_KEY_VERSION: "0", OPERATION_KEY_REALM: "r" }),
    /正整数/,
  );
  assert.deepEqual(operationKeyConfig({ OPERATION_KEY_HMAC_KEY_B64: key.toString("base64"), OPERATION_KEY_VERSION: "1", OPERATION_KEY_REALM: "test-realm" }), config);
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

test("device_digest_domains：head 与版本历史记录校验", () => {
  assert.equal(validateDigestDomainRecord({ kind: "head", provider: "hikvision", digestRealm: "prod-a", keyVersion: 1, revision: 1, createdAt: 1 }).kind, "head");
  assert.equal(validateDigestDomainRecord({ kind: "version", provider: "hikvision", digestRealm: "prod-a", keyVersion: 2, enabledAt: 2 }).keyVersion, 2);
  assert.throws(() => validateDigestDomainRecord({ kind: "other", provider: "p", digestRealm: "r", keyVersion: 1 }), /kind/);
  assert.throws(() => validateDigestDomainRecord({ kind: "head", provider: "", digestRealm: "r", keyVersion: 1 }), /provider/);
  assert.throws(() => validateDigestDomainRecord({ kind: "head", provider: "p", digestRealm: "r", keyVersion: 0 }), /keyVersion/);
});

test("validateRecord 自动分发摘要域校验；head/version 字段强化", () => {
  assert.throws(
    () => validateRecord(COLLECTIONS.DEVICE_DIGEST_DOMAINS, { kind: "head", provider: "p", digestRealm: "r", keyVersion: 1 }),
    /revision/,
  );
  assert.throws(
    () => validateRecord(COLLECTIONS.DEVICE_DIGEST_DOMAINS, { kind: "version", provider: "p", digestRealm: "r", keyVersion: 1 }),
    /enabledAt/,
  );
  assert.throws(
    () => validateRecord(COLLECTIONS.DEVICE_DIGEST_DOMAINS, { kind: "head", provider: "  ", digestRealm: "r", keyVersion: 1, revision: 1, createdAt: 1 }),
    /provider/,
  );
  assert.equal(
    validateRecord(COLLECTIONS.DEVICE_DIGEST_DOMAINS, {
      kind: "head", provider: "p", digestRealm: "r", keyVersion: 1, revision: 1, createdAt: 1,
    }).kind,
    "head",
  );
});

test("换钥语义：无 head 创建、同版本继续、异版本 DOMAIN_MISMATCH 零写入", () => {
  const config = { provider: "hikvision", digestRealm: "prod-a", version: 1, now: 100 };
  const created = applyDigestDomain({}, config);
  assert.equal(created.length, 2);
  assert.equal(created[0].data.kind, "head");
  assert.equal(created[1].data.kind, "version");

  const state = Object.fromEntries(
    created.map((write) => [`device_digest_domains/${write.id}`, write.data]),
  );
  assert.deepEqual(applyDigestDomain(state, config), []);
  assert.throws(
    () => applyDigestDomain(state, { ...config, version: 2 }),
    (e) => e.code === "DOMAIN_MISMATCH",
  );
});

test("不完整或伪造的 domain 记录一律失败关闭，且不自动补写", () => {
  const config = { provider: "hikvision", digestRealm: "prod-a", version: 1, now: 100 };
  const [headWrite, versionWrite] = applyDigestDomain({}, config);
  const two = {
    [`device_digest_domains/${headWrite.id}`]: headWrite.data,
    [`device_digest_domains/${versionWrite.id}`]: versionWrite.data,
  };

  const onlyHead = { [`device_digest_domains/${headWrite.id}`]: headWrite.data };
  const onlyVersion = { [`device_digest_domains/${versionWrite.id}`]: versionWrite.data };
  for (const bad of [onlyHead, onlyVersion]) {
    assert.throws(() => applyDigestDomain(bad, config), (e) => e.code === "DOMAIN_INCOMPLETE");
  }

  const wrongKind = {
    ...two,
    [`device_digest_domains/${headWrite.id}`]: { ...headWrite.data, kind: "version" },
  };
  assert.throws(() => applyDigestDomain(wrongKind, config), (e) => e.code === "DOMAIN_INCOMPLETE");

  const wrongProvider = {
    ...two,
    [`device_digest_domains/${headWrite.id}`]: { ...headWrite.data, provider: "other" },
  };
  assert.throws(() => applyDigestDomain(wrongProvider, config), (e) => e.code === "DOMAIN_INCOMPLETE");
});

test("operation key domain：fingerprint、同版本换钥与损坏记录", () => {
  const key = Buffer.alloc(32, 9);
  const config = { key, version: 1, realm: "test-realm" };
  const fingerprint = operationKeyFingerprint(config);
  const writes = applyOperationKeyDomain({}, { realm: config.realm, version: config.version, fingerprint, now: 100 });
  assert.equal(writes.length, 2);
  assert.throws(
    () => applyOperationKeyDomain({}, { realm: "Bad", version: 1, fingerprint, now: 100 }),
    /realm/,
  );
  assert.throws(
    () => applyOperationKeyDomain({}, { realm: config.realm, version: 1, fingerprint: "short", now: 100 }),
    /fingerprint/,
  );
  const state = Object.fromEntries(writes.map((w) => [`operation_key_domains/${w.id}`, w.data]));
  assert.deepEqual(applyOperationKeyDomain(state, { realm: config.realm, version: config.version, fingerprint, now: 200 }), []);

  // 同版本换钥 -> fingerprint 不一致
  const otherFingerprint = operationKeyFingerprint({ ...config, key: Buffer.alloc(32, 8) });
  assert.throws(
    () => applyOperationKeyDomain(state, { realm: config.realm, version: config.version, fingerprint: otherFingerprint, now: 200 }),
    (e) => e.code === "DOMAIN_MISMATCH",
  );

  // 完整 v1 + 配置 v2 -> DOMAIN_MISMATCH
  assert.throws(
    () => applyOperationKeyDomain(state, { realm: config.realm, version: 2, fingerprint, now: 200 }),
    (e) => e.code === "DOMAIN_MISMATCH",
  );

  // head/version 版本矛盾 -> DOMAIN_INCOMPLETE
  const contradictory = {
    ...state,
    [`operation_key_domains/${writes[1].id}`]: { ...writes[1].data, keyVersion: 9 },
  };
  assert.throws(
    () => applyOperationKeyDomain(contradictory, { realm: config.realm, version: config.version, fingerprint, now: 200 }),
    (e) => e.code === "DOMAIN_INCOMPLETE",
  );

  // head/version fingerprint 矛盾 -> DOMAIN_INCOMPLETE
  const fpContradiction = {
    ...state,
    [`operation_key_domains/${writes[1].id}`]: { ...writes[1].data, keyFingerprint: otherFingerprint },
  };
  assert.throws(
    () => applyOperationKeyDomain(fpContradiction, { realm: config.realm, version: config.version, fingerprint, now: 200 }),
    (e) => e.code === "DOMAIN_INCOMPLETE",
  );

  // 只存在 head -> DOMAIN_INCOMPLETE
  const headOnly = { [`operation_key_domains/${writes[0].id}`]: writes[0].data };
  assert.throws(
    () => applyOperationKeyDomain(headOnly, { realm: config.realm, version: config.version, fingerprint, now: 200 }),
    (e) => e.code === "DOMAIN_INCOMPLETE",
  );

  // 伪造 kind -> DOMAIN_INCOMPLETE
  const broken = { ...state, [`operation_key_domains/${writes[0].id}`]: { ...writes[0].data, kind: "version" } };
  assert.throws(
    () => applyOperationKeyDomain(broken, { realm: config.realm, version: config.version, fingerprint, now: 200 }),
    (e) => e.code === "DOMAIN_INCOMPLETE",
  );
});
