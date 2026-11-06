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
export function operationKey({ orgId, method, actorType, actorId, idempotencyKey }) {
  for (const [field, value] of Object.entries({ orgId, method, actorType, actorId, idempotencyKey })) {
    assertId(value, field);
  }
  return `op:${orgId}:${method}:${actorType}:${actorId}:${idempotencyKey}`;
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
  if (typeof record.provider !== "string" || !record.provider) throw schemaError("provider 必填");
  if (typeof record.digestRealm !== "string" || !record.digestRealm) throw schemaError("digestRealm 必填");
  if (!Number.isInteger(record.keyVersion) || record.keyVersion < 1) {
    throw schemaError("keyVersion 必须是正整数");
  }
  return record;
}

export function schemaError(message) {
  const error = new Error(message);
  error.code = "PARAM_ERROR";
  return error;
}
