/**
 * HK-AI-04 人脸门禁集合定义与键规则（接线第 1 步：只定义，不建表、不访问 store）。
 *
 * 冻结集合（复审 72a093a 认可）：
 *   access_devices / face_credentials / device_access_grants /
 *   device_operation_jobs / device_operation_logs /
 *   device_claims / grant_slot_claims / operation_keys
 *
 * 组织域记录带 orgId；可变记录带 revision；设备唯一占用由 device_claims 保证。
 */
import { createHmac } from "node:crypto";
import {
  GRANT_STATE,
  IMAGE_STATE,
  JOB_STATE,
  REVIEW_STATE,
} from "./dto.mjs";

export const COLLECTIONS = Object.freeze({
  ACCESS_DEVICES: "access_devices",
  FACE_CREDENTIALS: "face_credentials",
  DEVICE_ACCESS_GRANTS: "device_access_grants",
  DEVICE_OPERATION_JOBS: "device_operation_jobs",
  DEVICE_OPERATION_LOGS: "device_operation_logs",
  DEVICE_CLAIMS: "device_claims",
  GRANT_SLOT_CLAIMS: "grant_slot_claims",
  OPERATION_KEYS: "operation_keys",
  // 全局部署域记录：跨组织共享，不能按 orgId 隔离，否则换钥保护可被绕过。
  DEVICE_DIGEST_DOMAINS: "device_digest_domains",
  OPERATION_KEY_DOMAINS: "operation_key_domains",
});

const ORG_SCOPED = new Set([
  COLLECTIONS.ACCESS_DEVICES,
  COLLECTIONS.FACE_CREDENTIALS,
  COLLECTIONS.DEVICE_ACCESS_GRANTS,
  COLLECTIONS.DEVICE_OPERATION_JOBS,
  COLLECTIONS.DEVICE_OPERATION_LOGS,
]);

const ENUMS = {
  [COLLECTIONS.FACE_CREDENTIALS]: {
    reviewState: Object.values(REVIEW_STATE),
    imageState: Object.values(IMAGE_STATE),
  },
  [COLLECTIONS.DEVICE_ACCESS_GRANTS]: {
    state: Object.values(GRANT_STATE),
  },
  [COLLECTIONS.DEVICE_OPERATION_JOBS]: {
    state: Object.values(JOB_STATE),
    action: ["enroll", "update", "revoke"],
  },
};

export function isKnownCollection(name) {
  return Object.values(COLLECTIONS).includes(name);
}

/**
 * 轻量 schema 校验：只校验契约要求的必填与枚举，不做业务判断。
 * @param {string} collection
 * @param {object} record
 * @param {{partial?: boolean}} [options]
 */
export function validateRecord(collection, record, { partial = false } = {}) {
  if (!isKnownCollection(collection)) {
    throw schemaError(`未知集合：${collection}`);
  }
  if (!record || typeof record !== "object") throw schemaError("记录必须是对象");
  if (collection === COLLECTIONS.OPERATION_KEY_DOMAINS) {
    return validateOperationKeyDomainRecord(record);
  }
  if (collection === COLLECTIONS.DEVICE_DIGEST_DOMAINS) {
    return validateDigestDomainRecord(record);
  }

  if (ORG_SCOPED.has(collection) && !partial) {
    if (!record.orgId) throw schemaError(`${collection}.orgId 必填`);
    if (!Number.isInteger(record.revision) || record.revision < 1) {
      throw schemaError(`${collection}.revision 必须是 ≥1 的整数`);
    }
  }

  const enums = ENUMS[collection];
  if (enums) {
    for (const [field, allowed] of Object.entries(enums)) {
      if (record[field] !== undefined && !allowed.includes(record[field])) {
        throw schemaError(`${collection}.${field} 非法：${record[field]}`);
      }
    }
  }
  return record;
}

export function nextRevision(record) {
  const current = Number.isInteger(record?.revision) ? record.revision : 0;
  return current + 1;
}



/** K1 配置：Base64 32 字节密钥、正整数版本、独立部署域。缺失/非法一律失败关闭。 */
export function deviceClaimConfig(env = process.env) {
  const encoded = env.DEVICE_CLAIM_HMAC_KEY_B64 || "";
  const canonical = /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) && encoded.length % 4 === 0;
  if (!canonical) throw schemaError("DEVICE_CLAIM_HMAC_KEY_B64 不是规范的 Base64");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw schemaError("DEVICE_CLAIM_HMAC_KEY_B64 必须是规范的 Base64 编码的 32 字节密钥");
  }
  const version = Number(env.DEVICE_CLAIM_KEY_VERSION);
  if (!Number.isInteger(version) || version < 1) throw schemaError("DEVICE_CLAIM_KEY_VERSION 必须是正整数");
  const realm = String(env.DEVICE_DIGEST_REALM || "").trim();
  if (!realm) throw schemaError("DEVICE_DIGEST_REALM 必填");
  return { key, version, realm };
}

/** 规范化设备标识：去首尾空白并统一大写。 */
export function normalizeDeviceSerial(serial) {
  const normalized = String(serial ?? "").trim().toUpperCase();
  if (!normalized) throw schemaError("设备序列号不能为空");
  return normalized;
}

/** HMAC-SHA256(keyVersion + 规范化序列号)，K1 与 K2（operation key）完全分离。 */
export function deviceDigest(serial, { key, version }) {
  return createHmac("sha256", key)
    .update(`${version}:${normalizeDeviceSerial(serial)}`)
    .digest("hex");
}

const encodeSegment = (value) => Buffer.from(String(value), "utf8").toString("base64url");

export function deviceClaimKey({ provider = "hikvision", digestRealm, serial, key, version }) {
  if (!digestRealm) throw schemaError("digestRealm 必填");
  return `provider-device:${encodeSegment(provider)}:${encodeSegment(digestRealm)}:${deviceDigest(serial, { key, version })}`;
}

/** 稳定 head（不含版本）：同一 realm+provider 始终读取同一条记录。 */
export function deviceDigestDomainKey({ provider = "hikvision", digestRealm }) {
  if (!digestRealm) throw schemaError("digestRealm 必填");
  return `device-digest-domain:${encodeSegment(provider)}:${encodeSegment(digestRealm)}`;
}

/** 版本历史记录（可选）：保留每次启用的 keyVersion 供审计。 */
export function deviceDigestDomainVersionKey({ provider = "hikvision", digestRealm, version }) {
  if (!digestRealm) throw schemaError("digestRealm 必填");
  return `device-digest-domain-version:${encodeSegment(provider)}:${encodeSegment(digestRealm)}:${version}`;
}

export function assertDigestDomain(existing, { version }) {
  if (existing && existing.keyVersion !== version) {
    const error = schemaError(`设备摘要域已绑定密钥版本 ${existing.keyVersion}，当前配置为 ${version}`);
    error.code = "DOMAIN_MISMATCH";
    throw error;
  }
}

/** 冻结的 grant slot 键：同一人+设备+入住周期只允许一个有效槽位。 */
export function grantSlotKey({ orgId, personId, deviceId, cycleId }) {
  for (const [field, value] of Object.entries({ orgId, personId, deviceId, cycleId })) {
    assertId(value, field);
  }
  return `grant-slot:${encodeSegment(orgId)}:${encodeSegment(personId)}:${encodeSegment(deviceId)}:${encodeSegment(cycleId)}`;
}

/** 操作幂等键：与 Mock 终审一致的 org + 方法 + actor + idempotencyKey。 */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/;

export function assertIdempotencyKey(value) {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY.test(value)) {
    const error = schemaError("Idempotency-Key 必须是 16–128 位 [A-Za-z0-9._:-]");
    error.status = 400;
    throw error;
  }
  return value;
}

function operationConfigError(message) {
  const error = new Error(message);
  error.code = "NOT_CONFIGURED";
  error.status = 503;
  return error;
}

/** K2 配置：与 K1 完全独立；缺失/非法 -> 503 NOT_CONFIGURED。 */
export function operationKeyConfig(env = process.env) {
  const encoded = env.OPERATION_KEY_HMAC_KEY_B64 || "";
  const canonical = /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) && encoded.length % 4 === 0;
  if (!canonical) throw operationConfigError("OPERATION_KEY_HMAC_KEY_B64 不是规范的 Base64");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw operationConfigError("OPERATION_KEY_HMAC_KEY_B64 必须是规范的 Base64 编码的 32 字节密钥");
  }
  const version = Number(env.OPERATION_KEY_VERSION);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw operationConfigError("OPERATION_KEY_VERSION 必须是正整数");
  }
  const realm = String(env.OPERATION_KEY_REALM ?? "");
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(realm)) {
    throw operationConfigError("OPERATION_KEY_REALM 必须是 3–64 位小写字母/数字/连字符");
  }
  return { key, version, realm };
}

/** 不可逆指纹：同版本换钥可被发现。 */
export function operationKeyFingerprint({ key, version, realm }) {
  return createHmac("sha256", key)
    .update(JSON.stringify(["KEYED_DIGEST/op-key-fingerprint", "v1", realm, version]))
    .digest("hex");
}

export function operationKeyDigest(idempotencyKey, { key, version, realm }) {
  assertIdempotencyKey(idempotencyKey);
  return createHmac("sha256", key)
    .update(JSON.stringify(["KEYED_DIGEST/op", "v1", realm, version, idempotencyKey]))
    .digest("hex");
}

export function operationKeyDomainIds(realm) {
  assertId(valueOfRealm(realm), "realm");
  return {
    headId: `op-domain:${encodeSegment(realm)}`,
    versionIdPrefix: `op-domain-version:${encodeSegment(realm)}:`,
  };
}

function valueOfRealm(realm) {
  return String(realm ?? "");
}

export function operationKey({ orgId, method, actorType, actorId, idempotencyKey, config }) {
  if (!config?.key) throw operationConfigError("缺少 K2 配置");
  for (const [field, value] of Object.entries({ orgId, method, actorType, actorId })) {
    assertId(value, field);
  }
  const digest = operationKeyDigest(idempotencyKey, config);
  return `op:${encodeSegment(config.realm)}:${encodeSegment(orgId)}:${encodeSegment(method)}:${encodeSegment(actorType)}:${encodeSegment(actorId)}:v${config.version}:${digest}`;
}

/**
 * operation_key_domains：head 与版本记录同时存在且 realm/version/fingerprint 全匹配才继续。
 * 单边缺失/损坏 -> DOMAIN_INCOMPLETE；完整但配置不同 -> DOMAIN_MISMATCH。
 */
export function applyOperationKeyDomain(state, { realm, version, fingerprint, now = Date.now() }) {
  if (typeof realm !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(realm)) {
    throw schemaError("realm 必须是 3–64 位小写字母/数字/连字符");
  }
  if (!Number.isSafeInteger(version) || version < 1) throw schemaError("version 必须是正整数");
  if (typeof fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(fingerprint)) {
    throw schemaError("fingerprint 必须是 64 位十六进制");
  }
  if (!Number.isSafeInteger(now) || now < 0) throw schemaError("now 必须是 ≥0 的毫秒时间戳");
  const { headId, versionIdPrefix } = operationKeyDomainIds(realm);
  const versionId = `${versionIdPrefix}${version}`;
  const prefix = `${COLLECTIONS.OPERATION_KEY_DOMAINS}/`;
  const head = state[prefix + headId];
  const versionRecord = state[prefix + versionId];

  if (!head && !versionRecord) {
    const headData = { kind: "head", realm, keyVersion: version, keyFingerprint: fingerprint, revision: 1, createdAt: now };
    const versionData = { kind: "version", realm, keyVersion: version, keyFingerprint: fingerprint, enabledAt: now };
    validateOperationKeyDomainRecord(headData);
    validateOperationKeyDomainRecord(versionData);
    return [
      { collection: COLLECTIONS.OPERATION_KEY_DOMAINS, id: headId, data: headData },
      { collection: COLLECTIONS.OPERATION_KEY_DOMAINS, id: versionId, data: versionData },
    ];
  }

  const incomplete = () => {
    const error = schemaError("operation key domain 记录不完整或损坏，需受控修复");
    error.code = "DOMAIN_INCOMPLETE";
    throw error;
  };
  const mismatch = () => {
    const error = schemaError("operation key domain 与当前配置不一致");
    error.code = "DOMAIN_MISMATCH";
    throw error;
  };
  const validate = (record, kind) => {
    validateOperationKeyDomainRecord(record);
    if (record.kind !== kind) incomplete();
  };

  // 稳定 head 已存在但配置版本不同：直接判定配置不匹配。
  if (head && !versionRecord) {
    try { validate(head, "head"); } catch { incomplete(); }
    if (head.keyVersion !== version) mismatch();
    incomplete(); // 同版本却缺版本历史 = 损坏
  }
  if (!head) incomplete(); // 只有版本记录 = 损坏

  try {
    validate(head, "head");
    validate(versionRecord, "version");
  } catch {
    incomplete();
  }
  // 身份/版本自相矛盾 = 存储损坏
  if (head.realm !== realm || versionRecord.realm !== realm) incomplete();
  if (head.keyVersion !== versionRecord.keyVersion) incomplete();
  if (head.keyFingerprint !== versionRecord.keyFingerprint) incomplete();

  // 完整记录与配置不同 = 配置不匹配
  if (head.keyVersion !== version || versionRecord.keyVersion !== version) mismatch();
  if (head.keyFingerprint !== fingerprint || versionRecord.keyFingerprint !== fingerprint) mismatch();
  return [];
}

function assertId(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw schemaError(`${field} 必须是 1–128 位字符串`);
  }
}

/**
 * device_digest_domains：全局记录，id 使用 deviceDigestDomainKey()（head）
 * 或 deviceDigestDomainVersionKey()（版本历史）。head 保存当前 keyVersion。
 */
export function validateDigestDomainRecord(record) {
  if (!record || typeof record !== "object") throw schemaError("摘要域记录必须是对象");
  if (!["head", "version"].includes(record.kind)) throw schemaError("kind 必须是 head/version");
  if (typeof record.provider !== "string" || !record.provider.trim()) throw schemaError("provider 必填");
  if (typeof record.digestRealm !== "string" || !record.digestRealm.trim()) throw schemaError("digestRealm 必填");
  if (!Number.isInteger(record.keyVersion) || record.keyVersion < 1) {
    throw schemaError("keyVersion 必须是正整数");
  }
  if (record.kind === "head") {
    if (!Number.isInteger(record.revision) || record.revision < 1) throw schemaError("head.revision 必须是 ≥1 整数");
    if (!Number.isInteger(record.createdAt)) throw schemaError("head.createdAt 必须是时间戳");
  }
  if (record.kind === "version" && !Number.isInteger(record.enabledAt)) {
    throw schemaError("version.enabledAt 必须是时间戳");
  }
  return record;
}

/**
 * 换钥语义（冻结）：无 head 则创建 head＋版本记录；版本相同继续；
 * 版本不同 DOMAIN_MISMATCH 且零写入。真正换钥只能走独立受控迁移。
 */
export function applyDigestDomain(state, { provider = "hikvision", digestRealm, version, now = Date.now() }) {
  const prefix = `${COLLECTIONS.DEVICE_DIGEST_DOMAINS}/`;
  const headId = deviceDigestDomainKey({ provider, digestRealm });
  const versionId = deviceDigestDomainVersionKey({ provider, digestRealm, version });
  const head = state[prefix + headId];
  const versionRecord = state[prefix + versionId];
  // 已有 head 但配置版本不同：直接 DOMAIN_MISMATCH（换钥须受控迁移）。
  if (head && head.keyVersion !== version) assertDigestDomain(head, { version });

  if (!head && !versionRecord) {
    return [
      {
        collection: COLLECTIONS.DEVICE_DIGEST_DOMAINS,
        id: headId,
        data: { kind: "head", provider, digestRealm, keyVersion: version, revision: 1, createdAt: now },
      },
      {
        collection: COLLECTIONS.DEVICE_DIGEST_DOMAINS,
        id: versionId,
        data: { kind: "version", provider, digestRealm, keyVersion: version, enabledAt: now },
      },
    ];
  }

  const failIncomplete = () => {
    const error = schemaError("摘要域记录不完整或身份不符，需受控修复");
    error.code = "DOMAIN_INCOMPLETE";
    throw error;
  };
  if (!head || !versionRecord) failIncomplete();

  try {
    validateDigestDomainRecord(head);
    validateDigestDomainRecord(versionRecord);
  } catch {
    failIncomplete();
  }
  if (head.kind !== "head" || versionRecord.kind !== "version") failIncomplete();
  if (head.provider !== provider || head.digestRealm !== digestRealm ||
      versionRecord.provider !== provider || versionRecord.digestRealm !== digestRealm) {
    failIncomplete();
  }
  if (head.keyVersion !== version || versionRecord.keyVersion !== version) {
    assertDigestDomain(head, { version });
    failIncomplete();
  }
  return [];
}

export const CLAIM_STATE = Object.freeze({ ACTIVE: "active", RELEASED: "released" });

/** 有界字符串 ID：非空、≤128、无控制字符；不接受纯空白。 */
export function assertBoundedId(value, field) {
  if (typeof value !== "string" || value.trim() === "" || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw schemaError(field + " 必须是有界非空字符串");
  }
  return value;
}

/** 安全整数：Number.isSafeInteger 且 ≥ min。 */
export function assertSafeInt(value, field, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) {
    throw schemaError(field + " 必须是 ≥" + min + " 的安全整数");
  }
  return value;
}

/** 墓碑释放：只改状态与审计字段，不删除历史。 */
export function releaseClaim(record, { jobId, now = Date.now() }) {
  if (!record) throw schemaError("claim/slot 记录不存在");
  if (record.state !== CLAIM_STATE.ACTIVE) throw schemaError("仅 active claim/slot 可释放");
  assertBoundedId(jobId, "releasedByJobId");
  assertBoundedId(record.grantId, "grantId");
  assertSafeInt(record.revision, "record.revision", { min: 1 });
  assertSafeInt(now, "now");
  return {
    grantId: record.grantId,
    state: CLAIM_STATE.RELEASED,
    releasedAt: now,
    releasedByJobId: jobId,
    revision: (Number.isInteger(record.revision) ? record.revision : 0) + 1,
    updatedAt: now,
  };
}

/** 可占用：不存在、已墓碑释放，或声明为 active 但属于本 grant。 */
export function isReclaimable(record, ownerGrantId) {
  if (!record) return true;
  try {
    assertBoundedId(record.grantId, "grantId");
    assertSafeInt(record.revision, "record.revision", { min: 1 });
    if (record.state === CLAIM_STATE.RELEASED) {
      assertSafeInt(record.releasedAt, "releasedAt");
      assertBoundedId(record.releasedByJobId, "releasedByJobId");
      return true;
    }
    if (record.state === CLAIM_STATE.ACTIVE) return record.grantId === ownerGrantId;
    return false;
  } catch {
    return false; // 任何损坏/缺字段 -> 失败关闭
  }
}

/** 确定性 log ID：同一 job 的同一状态迁移只产生一条日志。 */
export function deterministicLogId(jobId, state, occurrence = 1) {
  assertId(jobId, "jobId");
  assertId(state, "state");
  assertSafeInt(occurrence, "occurrence", { min: 1 });
  return `log:${encodeSegment(jobId)}:${encodeSegment(state)}:${occurrence}`;
}

/** 租约结构：不保存凭据，仅 owner/过期时间/次数。 */
export function leasePatch({ owner, expiresAt, attempts = 0, revision = 1, now = Date.now() }) {
  assertBoundedId(owner, "leaseOwner");
  assertSafeInt(now, "now");
  assertSafeInt(expiresAt, "leaseExpiresAt", { min: now + 1 });
  assertSafeInt(attempts, "attempts", { min: 0 });
  assertSafeInt(revision, "revision", { min: 1 });
  return {
    leaseOwner: owner,
    leaseExpiresAt: expiresAt,
    attempts: attempts + 1,
    revision: revision + 1,
    updatedAt: now,
  };
}

export function validateOperationKeyDomainRecord(record) {
  if (!record || typeof record !== "object") throw schemaError("操作域记录必须是对象");
  if (!["head", "version"].includes(record.kind)) throw schemaError("kind 必须是 head/version");
  if (typeof record.realm !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(record.realm)) {
    throw schemaError("realm 必须是 3–64 位小写字母/数字/连字符");
  }
  if (!Number.isSafeInteger(record.keyVersion) || record.keyVersion < 1) throw schemaError("keyVersion 必须是正整数");
  if (typeof record.keyFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(record.keyFingerprint)) {
    throw schemaError("keyFingerprint 必须是 64 位十六进制");
  }
  if (record.kind === "head") {
    if (!Number.isSafeInteger(record.revision) || record.revision < 1) throw schemaError("head.revision 必须是 ≥1 整数");
    if (!Number.isSafeInteger(record.createdAt) || record.createdAt < 0) throw schemaError("head.createdAt 必须是 ≥0 时间戳");
  }
  if (record.kind === "version" && (!Number.isSafeInteger(record.enabledAt) || record.enabledAt < 0)) {
    throw schemaError("version.enabledAt 必须是时间戳");
  }
  return record;
}

export function schemaError(message) {
  const error = new Error(message);
  error.code = "PARAM_ERROR";
  return error;
}
