import {
  deviceDigestDomainKey,
  deviceDigestDomainVersionKey,
} from "../../lib/face-service/collections.mjs";

export function makeAccessDeviceFixture({ id, orgId, status = "active", face = true, overrides = {} }) {
  return {
    collection: "access_devices",
    id,
    data: {
      orgId,
      ownerOrgId: orgId,
      claimId: `claim-${id}`,
      provider: "hikvision",
      digestRealm: "test-realm",
      keyVersion: 1,
      revision: 1,
      status,
      capabilities: { face },
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    },
  };
}

export function makeOwnerClaimFixture({ deviceId, orgId, state = "active", overrides = {} }) {
  const base = {
    ownerOrgId: orgId,
    provider: "hikvision",
    digestRealm: "test-realm",
    digestDomain: "KEYED_DIGEST/device",
    keyVersion: 1,
    state,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  if (state === "active") {
    Object.assign(base, { boundDeviceId: deviceId, activatedAt: 1, activatedByAuditId: "audit-1" });
  } else {
    Object.assign(base, { releasedAt: 2, releasedByAuditId: "audit-2", releaseReason: "retired" });
  }
  return { collection: "device_claims", id: `claim-${deviceId}`, data: { ...base, ...overrides } };
}

export function makeDigestDomainFixture({ provider = "hikvision", digestRealm = "test-realm", keyVersion = 1 } = {}) {
  return [
    {
      collection: "device_digest_domains",
      id: deviceDigestDomainKey({ provider, digestRealm }),
      data: { kind: "head", provider, digestRealm, keyVersion, revision: 1, createdAt: 1 },
    },
    {
      collection: "device_digest_domains",
      id: deviceDigestDomainVersionKey({ provider, digestRealm, version: keyVersion }),
      data: { kind: "version", provider, digestRealm, keyVersion, enabledAt: 1 },
    },
  ];
}
