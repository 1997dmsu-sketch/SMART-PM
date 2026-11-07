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

/** 墓碑释放：只改状态与审计字段，不删除历史。 */
export function releaseClaim(record, { jobId, now = Date.now() }) {
  if (!record) throw schemaError("claim/slot 记录不存在");
  if (record.state !== CLAIM_STATE.ACTIVE) throw schemaError("仅 active claim/slot 可释放");
  if (typeof jobId !== "string" || !jobId.trim()) throw schemaError("releasedByJobId 必填");
  if (!Number.isInteger(record.revision) || record.revision < 1) throw schemaError("claim revision 非法");
  return {
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
  if (record.state === CLAIM_STATE.RELEASED) {
    // 墓碑必须带完整审计字段，否则视为损坏记录，失败关闭。
    return Number.isInteger(record.releasedAt) &&
      typeof record.releasedByJobId === "string" && record.releasedByJobId.trim() !== "" &&
      Number.isInteger(record.revision) && record.revision >= 1;
  }
  if (record.state === CLAIM_STATE.ACTIVE) return record.grantId === ownerGrantId;
  return false; // 未知状态失败关闭
}

/** 确定性 log ID：同一 job 的同一状态迁移只产生一条日志。 */
export function deterministicLogId(jobId, state, occurrence = 1) {
  assertId(jobId, "jobId");
  assertId(state, "state");
  if (!Number.isInteger(occurrence) || occurrence < 1) throw schemaError("occurrence 必须是 ≥1 整数");
  return `log:${encodeSegment(jobId)}:${encodeSegment(state)}:${occurrence}`;
}

/** 租约结构：不保存凭据，仅 owner/过期时间/次数。 */
export function leasePatch({ owner, expiresAt, attempts = 0, revision = 1, now = Date.now() }) {
  if (typeof owner !== "string" || !owner.trim()) throw schemaError("leaseOwner 必须是非空字符串");
  if (!Number.isInteger(now)) throw schemaError("now 必须是毫秒时间戳");
  if (!Number.isInteger(expiresAt) || expiresAt <= now) throw schemaError("leaseExpiresAt 必须是未来毫秒时间戳");
  if (!Number.isInteger(attempts) || attempts < 0) throw schemaError("attempts 必须是 ≥0 整数");
  if (!Number.isInteger(revision) || revision < 1) throw schemaError("revision 必须是 ≥1 整数");
  return {
    leaseOwner: owner,
    leaseExpiresAt: expiresAt,
    attempts: attempts + 1,
    revision: revision + 1,
    updatedAt: now,
  };
}

export function schemaError(message) {
  const error = new Error(message);
  error.code = "PARAM_ERROR";
  return error;
}
