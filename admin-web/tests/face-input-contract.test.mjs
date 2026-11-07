import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalStore } from "../lib/store.mjs";
import { assertSubmitInput, assertCreateGrantInput } from "../lib/face-service/dto.mjs";
import {
  CLAIM_STATE,
  deterministicLogId,
  isReclaimable,
  leasePatch,
  releaseClaim,
} from "../lib/face-service/collections.mjs";

const grantInput = {
  credentialId: "cred-1",
  expectedCredentialRevision: 2,
  deviceId: "device-1",
  occupancyId: "occ-1",
  cycleId: "cycle-1",
  identityApplicationId: "id-1",
  validFrom: 1000,
  validUntil: 2000,
};

test("submit 输入只允许 personId/sourceFileId", () => {
  assert.deepEqual(assertSubmitInput({ personId: "p", sourceFileId: "f" }), { personId: "p", sourceFileId: "f" });
  assert.throws(() => assertSubmitInput({ personId: "p", sourceFileId: "f", deviceId: "d" }), /不允许字段/);
  assert.throws(() => assertSubmitInput({ personId: "p" }), /sourceFileId/);
});

test("createGrant 输入冻结八字段，设备/周期/有效期不得缺失", () => {
  assert.deepEqual(assertCreateGrantInput(grantInput), grantInput);
  for (const key of ["deviceId", "cycleId", "validUntil", "expectedCredentialRevision", "identityApplicationId"]) {
    const bad = { ...grantInput };
    delete bad[key];
    assert.throws(() => assertCreateGrantInput(bad), (e) => e.code === "PARAM_ERROR", `缺 ${key} 应拒绝`);
  }
  assert.throws(() => assertCreateGrantInput({ ...grantInput, extra: 1 }), /不允许字段/);
  assert.throws(() => assertCreateGrantInput({ ...grantInput, expectedCredentialRevision: 0 }), /expectedCredentialRevision/);
  assert.throws(() => assertCreateGrantInput({ ...grantInput, validUntil: 1000 }), /validFrom/);
});

test("claim/slot 墓碑：释放后可重新占用，released 记录保留审计", () => {
  const active = { state: CLAIM_STATE.ACTIVE, grantId: "g1", revision: 1 };
  assert.equal(isReclaimable(active, "g2"), false);
  assert.equal(isReclaimable(active, "g1"), true);
  assert.equal(isReclaimable(null, "g1"), true);

  const released = releaseClaim(active, { jobId: "job-1", now: 100 });
  assert.equal(released.state, "released");
  assert.equal(released.releasedByJobId, "job-1");
  assert.equal(released.revision, 2);
  assert.equal(isReclaimable(released, "g3"), true);
  assert.equal(isReclaimable({ state: "corrupt", grantId: "g1" }, "g1"), false);
  assert.throws(() => releaseClaim({ state: "corrupt", revision: 1 }, { jobId: "j" }), /active/);
  assert.throws(() => releaseClaim({ state: "active", revision: 1 }, {}), /releasedByJobId/);
  assert.throws(() => releaseClaim({ state: "active", grantId: "g1", revision: 0 }, { jobId: "j" }), /revision/);
  assert.throws(() => releaseClaim({ state: "active", grantId: "g1", revision: "1" }, { jobId: "j" }), /revision/);
  assert.equal(isReclaimable({ state: "released", releasedAt: 1 }, "g"), false);
  assert.equal(isReclaimable({ state: "released", releasedAt: -1, releasedByJobId: "j", revision: 2 }, "g"), false);
  assert.equal(isReclaimable({ state: "active", revision: 1 }, "g"), false);
  assert.equal(isReclaimable({ state: "active", grantId: "g" }, "g"), false);
  assert.equal(isReclaimable({ state: "released", releasedAt: 1, releasedByJobId: "j" }, "g"), false);
  assert.equal(isReclaimable({ state: "released", grantId: "g1", releasedAt: 1, releasedByJobId: "j", revision: 2 }, "g"), true);
});

test("确定性 log ID 与租约结构", () => {
  assert.match(deterministicLogId("job-1", "queued"), /^log:/);
  for (const bad of [0, -1, "1", Number.MAX_SAFE_INTEGER + 2]) {
    assert.throws(() => deterministicLogId("job-1", "queued", bad), /occurrence/);
  }
  assert.notEqual(
    deterministicLogId("a:b", "c"),
    deterministicLogId("a", "b:c"),
  );
  assert.equal(deterministicLogId("job-1", "queued"), deterministicLogId("job-1", "queued"));
  assert.notEqual(deterministicLogId("job-1", "sending"), deterministicLogId("job-1", "queued"));

  const lease = leasePatch({ owner: "worker-1", expiresAt: 2000, attempts: 0, revision: 1, now: 100 });
  assert.deepEqual(Object.keys(lease).sort(), ["attempts", "leaseExpiresAt", "leaseOwner", "revision", "updatedAt"]);
  assert.equal(lease.attempts, 1);
  assert.throws(() => leasePatch({ owner: "w", expiresAt: 2000, attempts: "0", revision: 1, now: 100 }), /attempts/);
  assert.throws(() => leasePatch({ owner: "w", expiresAt: 2000, attempts: 0, revision: "1", now: 100 }), /revision/);
  assert.throws(() => leasePatch({ owner: "w", expiresAt: 100, attempts: 0, revision: 1, now: 100 }), /leaseExpiresAt/);
  assert.throws(() => leasePatch({ owner: "   ", expiresAt: 2000, now: 100 }), /leaseOwner/);
  assert.throws(() => leasePatch({ owner: "w", expiresAt: 2000, now: "100" }), /now/);
  assert.throws(() => leasePatch({ owner: "w", expiresAt: 2000, now: -1 }), /now/);
  assert.throws(() => leasePatch({ owner: "w", expiresAt: Number.MAX_SAFE_INTEGER + 2, now: 100 }), /leaseExpiresAt/);
});

test("LocalStore 登记本期人脸集合", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smartpm-face-collections-"));
  try {
    const store = await new LocalStore(dir).init();
    for (const name of [
      "face_credentials", "device_access_grants", "device_operation_jobs",
      "device_operation_logs", "device_claims", "grant_slot_claims",
      "device_digest_domains", "access_devices",
    ]) {
      assert.ok(Array.isArray(store.data[name]), `${name} 应已初始化`);
      assert.deepEqual(await store.list(name), []);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
