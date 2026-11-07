import { test } from "node:test";
import assert from "node:assert/strict";

import {
  digestDomainMatchesDevice,
  ownerClaimMatchesDevice,
  validateAccessDeviceRecord,
  validateGrantSlotRecord,
  validateOwnerClaimRecord,
} from "../lib/face-service/collections.mjs";

const device = {
  claimId: "claim-1", ownerOrgId: "org-a", orgId: "org-a", provider: "hikvision",
  digestRealm: "test-realm", keyVersion: 1, revision: 2, status: "active",
  capabilities: { face: true }, createdAt: 1, updatedAt: 2,
};
const claim = {
  ownerOrgId: "org-a", boundDeviceId: "device-1", provider: "hikvision",
  digestRealm: "test-realm", keyVersion: 1, state: "active",
  revision: 1, createdAt: 1, updatedAt: 2,
};
const slot = {
  orgId: "org-a", personId: "p1", deviceId: "device-1", cycleId: "c1",
  activeClaimId: "claim-1", state: "active", revision: 1,
};

test("device：orgId/ownerOrgId/时间字段/face capability 校验", () => {
  assert.equal(validateAccessDeviceRecord(device), device);
  assert.throws(() => validateAccessDeviceRecord({ ...device, ownerOrgId: "org-b" }), /ownerOrgId 必须等于 orgId/);
  assert.throws(() => validateAccessDeviceRecord({ ...device, createdAt: -1 }), /createdAt/);
  assert.throws(() => validateAccessDeviceRecord({ ...device, capabilities: {} }), /capabilities.face/);
  assert.throws(() => validateAccessDeviceRecord({ ...device, claimId: "" }), /claimId/);
});

test("owner claim：provider/realm/keyVersion/updatedAt 与 released 审计", () => {
  assert.equal(validateOwnerClaimRecord(claim), claim);
  assert.throws(() => validateOwnerClaimRecord({ ...claim, provider: "" }), /provider/);
  assert.throws(() => validateOwnerClaimRecord({ ...claim, digestRealm: "" }), /digestRealm/);
  assert.throws(() => validateOwnerClaimRecord({ ...claim, keyVersion: 0 }), /keyVersion/);
  assert.throws(() => validateOwnerClaimRecord({ ...claim, updatedAt: -1 }), /updatedAt/);
  assert.throws(() => validateOwnerClaimRecord({ ...claim, releasedAt: 1 }), /released/);

  const released = { ...claim, state: "released", releasedAt: 5, releasedByJobId: "job-1" };
  assert.equal(validateOwnerClaimRecord(released), released);
  const { releasedAt, ...withoutReleasedAt } = released;
  assert.throws(() => validateOwnerClaimRecord(withoutReleasedAt), /releasedAt/);
  assert.throws(() => validateOwnerClaimRecord({ ...released, releasedByJobId: "" }), /releasedByJobId/);
});

test("owner claim：拒绝 grantId/orgId/serialNumber", () => {
  for (const field of ["grantId", "orgId", "serialNumber"]) {
    assert.throws(() => validateOwnerClaimRecord({ ...claim, [field]: "x" }), new RegExp(field));
  }
});

test("slot：active 用 activeClaimId；released 清空并保留墓碑", () => {
  assert.equal(validateGrantSlotRecord(slot), slot);
  assert.throws(() => validateGrantSlotRecord({ ...slot, grantId: "g1" }), /grantId/);
  assert.throws(() => validateGrantSlotRecord({ ...slot, activeClaimId: "" }), /activeClaimId/);

  const released = { ...slot, activeClaimId: undefined, state: "released", releasedAt: 5, releasedByJobId: "job-1" };
  assert.equal(validateGrantSlotRecord(released), released);
  assert.throws(() => validateGrantSlotRecord({ ...released, activeClaimId: "claim-1" }), /activeClaimId/);
  assert.throws(() => validateGrantSlotRecord({ ...released, releasedByJobId: "" }), /releasedByJobId/);
});

test("ownerClaimMatchesDevice：bound/owner/provider/realm/version 不一致即 false", () => {
  assert.equal(ownerClaimMatchesDevice(claim, device, "device-1"), true);
  assert.equal(ownerClaimMatchesDevice({ ...claim, boundDeviceId: "device-2" }, device, "device-1"), false);
  assert.equal(ownerClaimMatchesDevice({ ...claim, ownerOrgId: "org-b" }, device, "device-1"), false);
  assert.equal(ownerClaimMatchesDevice({ ...claim, provider: "other" }, device, "device-1"), false);
  assert.equal(ownerClaimMatchesDevice({ ...claim, keyVersion: 2 }, device, "device-1"), false);
});

test("digestDomainMatchesDevice：损坏 INCOMPLETE，配置不符 CONFIG_CHANGED", () => {
  const head = { kind: "head", provider: "hikvision", digestRealm: "test-realm", keyVersion: 1 };
  const version = { kind: "version", provider: "hikvision", digestRealm: "test-realm", keyVersion: 1 };
  const config = { provider: "hikvision", digestRealm: "test-realm", keyVersion: 1 };

  assert.equal(digestDomainMatchesDevice(head, version, config).ok, true);
  assert.equal(digestDomainMatchesDevice(null, version, config).code, "DOMAIN_INCOMPLETE");
  assert.equal(digestDomainMatchesDevice(head, { ...version, kind: "head" }, config).code, "DOMAIN_INCOMPLETE");
  assert.equal(digestDomainMatchesDevice(head, { ...version, keyVersion: 2 }, config).code, "DOMAIN_INCOMPLETE");
  assert.equal(digestDomainMatchesDevice({ ...head, provider: "other" }, { ...version, provider: "other" }, config).code, "DEVICE_DIGEST_CONFIG_CHANGED");
  assert.equal(digestDomainMatchesDevice(head, version, { ...config, keyVersion: 2 }).code, "DEVICE_DIGEST_CONFIG_CHANGED");
});
