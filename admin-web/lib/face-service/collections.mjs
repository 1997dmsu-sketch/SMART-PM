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

/** 全局设备占用键：一台物理设备只能有一个 owner。 */
export function deviceClaimKey(deviceId) {
  assertId(deviceId, "deviceId");
  return `device:${deviceId}`;
}

/** 入住周期 grant slot：同一设备同一 grant 只有一个有效槽位。 */
export function grantSlotKey(deviceId, grantId) {
  assertId(deviceId, "deviceId");
  assertId(grantId, "grantId");
  return `slot:${deviceId}:${grantId}`;
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

export function schemaError(message) {
  const error = new Error(message);
  error.code = "PARAM_ERROR";
  return error;
}
