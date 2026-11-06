import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COLLECTIONS,
  deviceClaimKey,
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

test("设备占用与 grant slot 键稳定且不串用", () => {
  assert.equal(deviceClaimKey("dev-1"), "device:dev-1");
  assert.equal(grantSlotKey("dev-1", "grant-1"), "slot:dev-1:grant-1");
  assert.notEqual(deviceClaimKey("dev-1"), deviceClaimKey("dev-2"));
  assert.throws(() => deviceClaimKey(""), /deviceId/);
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
