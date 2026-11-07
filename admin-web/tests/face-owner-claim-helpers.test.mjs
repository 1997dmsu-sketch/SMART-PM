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
  digestRealm: "test-realm", digestDomain: "KEYED_DIGEST/device", keyVersion: 1,
  state: "active", revision: 1, createdAt: 1, updatedAt: 2,
  activatedAt: 1, activatedByAuditId: "audit-1",
};
const releasedClaim = {
  ...claim,
  boundDeviceId: undefined,
  activatedAt: undefined,
  activatedByAuditId: undefined,
  state: "released",
  releasedAt: 5,
  releasedByAuditId: "audit-2",
  releaseReason: "device retired",
};
const slot = {
  orgId: "org-a", personId: "p1", deviceId: "device-1", cycleId: "c1",
  activeClaimId: "grant-1", state: "active", revision: 1,
  createdAt: 1, updatedAt: 2, activatedAt: 1,
};
const releasedSlot = {
  ...slot,
  activeClaimId: undefined,
  activatedAt: undefined,
  state: "released",
  releasedAt: 5,
  releasedByJobId: "job-1",
};

test("device：orgId/ownerOrgId/时间/face 校验", () => {
  assert.equal(validateAccessDeviceRecord(device), device);
  assert.throws(() => validateAccessDeviceRecord({ ...device, ownerOrgId: "org-b" }), /ownerOrgId 必须等于 orgId/);
  assert.throws(() => validateAccessDeviceRecord({ ...device, updatedAt: -1 }), /updatedAt/);
  assert.throws(() => validateAccessDeviceRecord({ ...device, capabilities: {} }), /capabilities.face/);
});

test("owner claim：digestDomain、激活审计、released 墓碑与互斥", () => {
  assert.equal(validateOwnerClaimRecord(claim), claim);
  assert.throws(() => validateOwnerClaimRecord({ ...claim, digestDomain: "" }), /digestDomain/);
  assert.throws(() => validateOwnerClaimRecord({ ...claim, activatedAt: -1 }), /activatedAt/);
  assert.throws(() => validateOwnerClaimRecord({ ...claim, releasedAt: 1 }), /released/);

  const released = validateOwnerClaimRecord(releasedClaim);
  assert.equal(released.state, "released");
  assert.throws(() => validateOwnerClaimRecord({ ...releasedClaim, boundDeviceId: "device-1" }), /boundDeviceId/);
  assert.throws(() => validateOwnerClaimRecord({ ...releasedClaim, releasedByAuditId: "" }), /releasedByAuditId/);
  assert.throws(() => validateOwnerClaimRecord({ ...releasedClaim, releaseReason: "" }), /releaseReason/);
});

test("owner claim：拒绝 grantId/orgId/serialNumber 与非有界 ID", () => {
  for (const field of ["grantId", "orgId", "serialNumber"]) {
    assert.throws(() => validateOwnerClaimRecord({ ...claim, [field]: "x" }), new RegExp(field));
  }
  assert.throws(() => validateOwnerClaimRecord({ ...claim, ownerOrgId: "x".repeat(129) }), /ownerOrgId/);
});

test("slot：active 生命周期字段；released 清除并保留墓碑", () => {
  assert.equal(validateGrantSlotRecord(slot), slot);
  assert.throws(() => validateGrantSlotRecord({ ...slot, grantId: "g1" }), /grantId/);
  assert.throws(() => validateGrantSlotRecord({ ...slot, activatedAt: -1 }), /activatedAt/);
  assert.throws(() => validateGrantSlotRecord({ ...slot, activeClaimId: "" }), /activeClaimId/);

  assert.equal(validateGrantSlotRecord(releasedSlot).state, "released");
  assert.throws(() => validateGrantSlotRecord({ ...releasedSlot, activeClaimId: "grant-1" }), /activeClaimId/);
  assert.throws(() => validateGrantSlotRecord({ ...releasedSlot, releasedByJobId: "" }), /releasedByJobId/);
});

test("ownerClaimMatchesDevice：任一绑定字段不一致即 false", () => {
  assert.equal(ownerClaimMatchesDevice(claim, device, "device-1"), true);
  assert.equal(ownerClaimMatchesDevice({ ...claim, boundDeviceId: "device-2" }, device, "device-1"), false);
  assert.equal(ownerClaimMatchesDevice({ ...claim, ownerOrgId: "org-b" }, device, "device-1"), false);
  assert.equal(ownerClaimMatchesDevice({ ...claim, provider: "other" }, device, "device-1"), false);
});

test("digestDomain：复用官方 validator，损坏 INCOMPLETE，配置不符 CONFIG_CHANGED", () => {
  const head = { kind: "head", provider: "hikvision", digestRealm: "test-realm", keyVersion: 1, revision: 1, createdAt: 1 };
  const version = { kind: "version", provider: "hikvision", digestRealm: "test-realm", keyVersion: 1, enabledAt: 1 };
  const config = { provider: "hikvision", digestRealm: "test-realm", keyVersion: 1 };

  assert.equal(digestDomainMatchesDevice(head, version, config).ok, true);
  assert.equal(digestDomainMatchesDevice({ ...head, createdAt: -1 }, version, config).code, "DOMAIN_INCOMPLETE");
  assert.equal(digestDomainMatchesDevice(head, { ...version, enabledAt: -1 }, config).code, "DOMAIN_INCOMPLETE");
  assert.equal(digestDomainMatchesDevice({ ...head, digestRealm: "other" }, { ...version, digestRealm: "other" }, config).code, "DEVICE_DIGEST_CONFIG_CHANGED");
  assert.equal(digestDomainMatchesDevice(null, version, config).code, "DOMAIN_INCOMPLETE");
  assert.equal(digestDomainMatchesDevice({ ...head, createdAt: undefined }, version, config).code, "DOMAIN_INCOMPLETE");
  assert.equal(digestDomainMatchesDevice(head, { ...version, enabledAt: undefined }, config).code, "DOMAIN_INCOMPLETE");
  assert.equal(digestDomainMatchesDevice({ ...head, keyVersion: 2 }, { ...version, keyVersion: 2 }, config).code, "DEVICE_DIGEST_CONFIG_CHANGED");
  assert.equal(digestDomainMatchesDevice(head, version, { ...config, keyVersion: 2 }).code, "DEVICE_DIGEST_CONFIG_CHANGED");
});
