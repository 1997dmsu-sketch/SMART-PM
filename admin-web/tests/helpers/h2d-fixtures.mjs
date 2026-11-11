/**
 * H2-d 验收 fixture：只使用正式 LocalStore、真实 FileService / BlacklistService。
 *
 * 本文件不实现任何资格桩，也不改写生产语义。所有 Person/Device/File 记录中
 * 故意放入敏感字段，供 H2-d 的写集扫描证明这些字段不会被复制到授权核心写集。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalStore } from "../../lib/store.mjs";
import { FileService } from "../../lib/files.mjs";
import { BlacklistService, blacklistDecisionHeadId } from "../../lib/blacklist.mjs";
import { FaceCredentialService } from "../../lib/face-service/service.mjs";
import { occupancyClaimId, primarySlotId } from "../../lib/face-service/eligibility.mjs";
import {
  makeAccessDeviceFixture,
  makeDigestDomainFixture,
  makeOwnerClaimFixture,
} from "./face-fixtures.mjs";

export const H1 = Object.freeze({
  ORG: "org-h2d-h1",
  NOW: 1_700_000_000_000,
  FILE: "file-h2d-private",
  PUBLIC_FILE: "file-h2d-public",
  OTHER_FILE: "file-h2d-cover",
  SUBMIT: "mem-h2d-submit",
  REVIEW: "mem-h2d-review",
  MANAGE: "mem-h2d-manage",
  AUDIT: "mem-h2d-audit",
  RACE: "mem-h2d-race",
  NONE: "mem-h2d-none",
});

export const G = Object.freeze({
  ORG: "org-h2d-grant",
  NOW: 1_700_000_000_000,
  MEMBERSHIP: "mem-h2d-grant-manage",
  PERSON: "person-h2d-grant",
  OCCUPANCY: "occ-h2d-grant",
  CYCLE: "cycle-h2d-grant",
  ROOM: "room-h2d-grant",
  IDENTITY: "id-h2d-grant",
  CREDENTIAL: "fc-h2d-grant",
  DEVICE: "device-h2d-grant",
  FILE: "file-h2d-grant",
  VALID_FROM: 1_700_000_000_000 - 1_000,
  VALID_UNTIL: 1_700_000_000_000 + 1_000,
  IDEMPOTENCY: "idem-h2d-grant-0001",
});

const audit = Object.freeze({ actor: "system", actorId: "system", action: "H2-d 验收 fixture" });
const ref = (collection, id) => ({ collection, id });
const unique = (writes) => [
  ...new Map(writes.map((row) => [`${row.collection}/${row.id}`, row])).values(),
];

export function configureH2DEnv() {
  process.env.DEVICE_CLAIM_HMAC_KEY_B64 = Buffer.alloc(32, 7).toString("base64");
  process.env.DEVICE_CLAIM_KEY_VERSION = "1";
  process.env.DEVICE_DIGEST_REALM = "test-realm";
  process.env.OPERATION_KEY_HMAC_KEY_B64 = Buffer.alloc(32, 9).toString("base64");
  process.env.OPERATION_KEY_VERSION = "1";
  process.env.OPERATION_KEY_REALM = "test-realm";
}

async function initStore(t, writes, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).init();
  const rows = unique(writes);
  await store.transact(rows.map((row) => ref(row.collection, row.id)), () => rows, audit);
  return store;
}

export function makeProviderSpy() {
  const calls = { enroll: 0, revoke: 0 };
  return {
    calls,
    provider: {
      enrollFace: () => { calls.enroll += 1; throw Error("Provider 不得调用"); },
      revokeFace: () => { calls.revoke += 1; throw Error("Provider 不得调用"); },
    },
  };
}

export async function createH1Harness(t) {
  configureH2DEnv();
  const orgId = H1.ORG;
  const memberships = [
    [H1.SUBMIT, ["device.face.submit"], "editor"],
    [H1.REVIEW, ["device.face.review"], "admin"],
    [H1.MANAGE, ["device.access.manage"], "admin"],
    [H1.AUDIT, ["device.audit.read"], "admin"],
    [H1.RACE, ["device.face.submit"], "editor"],
    [H1.NONE, [], "admin"],
  ];
  const writes = [
    { collection: "organizations", id: orgId, data: { orgId, name: "H2-d H1 组织", status: "active", revision: 1 } },
    {
      collection: "file_assets", id: H1.FILE,
      data: {
        orgId, purpose: "face-biometric", status: "ready", visibility: "private",
        mimeType: "image/jpeg", size: 1024, objectKey: "private/h2d-secret.jpg",
        checksum: "c".repeat(64), revision: 1,
      },
    },
    {
      collection: "file_assets", id: H1.PUBLIC_FILE,
      data: {
        orgId, purpose: "face-biometric", status: "ready", visibility: "public",
        mimeType: "image/jpeg", size: 1024, objectKey: "public/h2d-face.jpg",
        checksum: "d".repeat(64), revision: 1,
      },
    },
    {
      collection: "file_assets", id: H1.OTHER_FILE,
      data: {
        orgId, purpose: "house-cover", status: "ready", visibility: "public",
        mimeType: "image/jpeg", size: 1024, objectKey: "public/h2d-cover.jpg",
        checksum: "e".repeat(64), revision: 1,
      },
    },
    ...memberships.map(([id, permissions, role]) => ({
      collection: "org_memberships", id,
      data: {
        orgId, status: "active", role, principalType: "adminAccount", principalId: id,
        permissions, revision: 1,
      },
    })),
  ];
  const store = await initStore(t, writes, "smartpm-h2d-h1-");
  const provider = makeProviderSpy();
  const filesFor = (membershipId) => new FileService(store, orgId, {
    auth: { membershipId },
    actor: {
      actorType: "user", actorId: membershipId, role: "editor",
      permissions: ["device.face.submit"],
    },
  });
  const service = (membershipId, options = {}) => new FaceCredentialService({
    store, orgId,
    actor: { membershipId, actorType: "user", actorId: membershipId },
    files: options.files || filesFor(membershipId),
    blacklist: options.blacklist || new BlacklistService(store, orgId, null, { now: () => H1.NOW }),
    provider: options.provider || provider.provider,
    now: () => H1.NOW,
  });
  return { store, orgId, now: H1.NOW, service, filesFor, provider, providerCalls: provider.calls, audit };
}

export function grantFixtureWrites() {
  const deviceFixture = makeAccessDeviceFixture({
    id: G.DEVICE, orgId: G.ORG,
    overrides: {
      serialNumber: "SN-H2D-SECRET-0001",
      mac: "AA:BB:CC:DD:EE:FF",
      ip: "10.20.30.40",
      certificateFingerprint: "f".repeat(64),
    },
  });
  const claimFixture = makeOwnerClaimFixture({ deviceId: G.DEVICE, orgId: G.ORG });
  return [
    { collection: "organizations", id: G.ORG, data: { orgId: G.ORG, name: "H2-d 授权组织", status: "active", revision: 1 } },
    {
      collection: "org_memberships", id: G.MEMBERSHIP,
      data: {
        orgId: G.ORG, status: "active", role: "admin", principalType: "adminAccount",
        principalId: G.MEMBERSHIP, permissions: ["device.access.manage"], revision: 1,
      },
    },
    {
      collection: "file_assets", id: G.FILE,
      data: {
        orgId: G.ORG, purpose: "face-biometric", status: "ready", visibility: "private",
        mimeType: "image/jpeg", size: 1024, objectKey: "private/h2d-grant-secret.jpg",
        checksum: "b".repeat(64), revision: 1,
      },
    },
    {
      collection: "persons", id: G.PERSON,
      data: {
        orgId: G.ORG, status: "active", userId: null, revision: 1,
        name: "张三", phone: "13800138000", address: "幸福路 1 号 101 室",
        idNumber: "110101199001011234",
      },
    },
    {
      collection: "identity_applications", id: G.IDENTITY,
      data: {
        orgId: G.ORG, personId: G.PERSON, state: "approved",
        identityDigest: "digest-h2d-grant", keyVersion: 1, revision: 1,
      },
    },
    {
      collection: "occupancies", id: G.OCCUPANCY,
      data: {
        orgId: G.ORG, personId: G.PERSON, roomId: G.ROOM, cycleId: G.CYCLE,
        role: "primary", state: "active", startsAt: G.NOW - 10_000, endsAt: G.NOW + 10_000,
        sponsorOccupancyId: null, revision: 1,
      },
    },
    {
      collection: "occupancy_cycles", id: G.CYCLE,
      data: {
        orgId: G.ORG, roomId: G.ROOM, state: "active", primaryOccupancyId: G.OCCUPANCY,
        startsAt: G.NOW - 10_000, endsAt: G.NOW + 10_000, endedAt: null, epoch: 1, revision: 1,
      },
    },
    {
      collection: "rooms", id: G.ROOM,
      data: {
        orgId: G.ORG, status: "active", floorId: "floor-h2d", buildingId: "building-h2d",
        communityId: "community-h2d", revision: 1,
      },
    },
    {
      collection: "property_catalog", id: "floor-h2d",
      data: { orgId: G.ORG, kind: "floor", status: "active", parentId: "building-h2d", revision: 1 },
    },
    {
      collection: "property_catalog", id: "building-h2d",
      data: { orgId: G.ORG, kind: "building", status: "active", parentId: "community-h2d", revision: 1 },
    },
    {
      collection: "property_catalog", id: "community-h2d",
      data: { orgId: G.ORG, kind: "community", status: "active", revision: 1 },
    },
    {
      collection: "unique_claims", id: occupancyClaimId(G.ORG, G.ROOM, G.CYCLE, G.PERSON),
      data: { orgId: G.ORG, state: "bound", ownerId: G.OCCUPANCY, revision: 1 },
    },
    {
      collection: "room_primary_slots", id: primarySlotId(G.ORG, G.ROOM),
      data: {
        orgId: G.ORG, currentCycleId: G.CYCLE, currentOccupancyId: G.OCCUPANCY,
        currentPersonId: G.PERSON, revision: 1,
      },
    },
    {
      collection: "face_credentials", id: G.CREDENTIAL,
      data: {
        orgId: G.ORG, revision: 2, personId: G.PERSON, sourceFileId: G.FILE,
        sourceFileRevision: 1, reviewState: "approved", imageState: "verified",
        evidenceScope: "simulated", createdAt: 1, updatedAt: 1,
      },
    },
    { ...deviceFixture },
    { ...claimFixture },
    ...makeDigestDomainFixture(),
  ];
}

export function grantInput(overrides = {}) {
  return {
    credentialId: G.CREDENTIAL,
    expectedCredentialRevision: 2,
    deviceId: G.DEVICE,
    occupancyId: G.OCCUPANCY,
    cycleId: G.CYCLE,
    identityApplicationId: G.IDENTITY,
    validFrom: G.VALID_FROM,
    validUntil: G.VALID_UNTIL,
    ...overrides,
  };
}

export async function createGrantHarness(t, { extraWrites = [] } = {}) {
  configureH2DEnv();
  const store = await initStore(t, [...grantFixtureWrites(), ...extraWrites], "smartpm-h2d-grant-");
  const provider = makeProviderSpy();
  const blacklist = new BlacklistService(store, G.ORG, null, { now: () => G.NOW });
  const files = new FileService(store, G.ORG, {
    auth: { membershipId: G.MEMBERSHIP },
    actor: {
      actorType: "user", actorId: G.MEMBERSHIP, role: "admin",
      permissions: ["device.access.manage", "device.face.submit"],
    },
  });
  const service = new FaceCredentialService({
    store, orgId: G.ORG,
    actor: { membershipId: G.MEMBERSHIP, actorType: "user", actorId: G.MEMBERSHIP },
    files, blacklist, provider: provider.provider, now: () => G.NOW,
  });
  return {
    store, service, blacklist, files, provider, providerCalls: provider.calls,
    input: grantInput, audit,
  };
}

const GLOBAL = new Set([
  "organizations", "device_digest_domains", "operation_key_domains", "admin_audit",
]);
export const SNAPSHOT_COLLECTIONS = [
  "organizations", "org_memberships", "file_assets", "persons", "identity_applications",
  "occupancies", "occupancy_cycles", "rooms", "property_catalog", "unique_claims",
  "room_primary_slots", "lifecycle_guards", "face_credentials", "access_devices",
  "device_claims", "device_digest_domains", "device_access_grants", "device_operation_jobs",
  "grant_slot_claims", "device_operation_logs", "operation_keys", "operation_key_domains",
  "eligibility_guards", "blacklist_entries", "blacklist_decisions", "admin_audit",
];
export const CORE = [
  "device_access_grants", "device_operation_jobs", "grant_slot_claims",
  "device_operation_logs", "operation_keys",
];

export async function snapshot(store, orgId = G.ORG) {
  const out = {};
  for (const name of SNAPSHOT_COLLECTIONS) {
    out[name] = structuredClone(await store.list(name, GLOBAL.has(name) ? null : orgId));
  }
  return out;
}

export function assertUnchanged(before, after, allowed = new Set()) {
  for (const name of SNAPSHOT_COLLECTIONS) {
    if (allowed.has(name)) continue;
    if (JSON.stringify(after[name]) !== JSON.stringify(before[name])) {
      const error = new Error(`${name} 不得变化`);
      error.actual = after[name];
      error.expected = before[name];
      throw error;
    }
  }
}

export function changedRows(before, after) {
  const out = [];
  for (const name of SNAPSHOT_COLLECTIONS) {
    const old = new Map((before[name] || []).map((row) => [row._id, row]));
    for (const row of after[name] || []) {
      if (JSON.stringify(old.get(row._id)) !== JSON.stringify(row)) {
        out.push({ collection: name, row });
      }
    }
  }
  return out;
}

export function instrument(blacklist, store, onTransact = null) {
  const counts = { prepare: 0, evaluate: 0, transact: 0 };
  const prepare = blacklist.prepareEligibility.bind(blacklist);
  blacklist.prepareEligibility = async (request) => {
    counts.prepare += 1;
    return prepare(request);
  };
  const evaluate = blacklist.evaluateEligibility.bind(blacklist);
  blacklist.evaluateEligibility = (state, token, options) => {
    counts.evaluate += 1;
    return evaluate(state, token, options);
  };
  const transact = store.transact.bind(store);
  store.transact = async (...args) => {
    counts.transact += 1;
    if (onTransact) await onTransact(counts.transact);
    return transact(...args);
  };
  return counts;
}

export function bumpPersonRevision(store) {
  store.data.persons.find((row) => row._id === G.PERSON).revision += 1;
}

export function addBlacklistDeny(store, { entryId = "entry-h2d-deny", decision = "deny" } = {}) {
  const headId = blacklistDecisionHeadId(G.ORG, G.OCCUPANCY, "occupancy.activate");
  return store.transact(
    [
      ref("blacklist_entries", entryId),
      ref("blacklist_decisions", headId),
    ],
    () => [
      {
        collection: "blacklist_entries", id: entryId,
        data: {
          orgId: G.ORG, subjectType: "person", subjectKey: G.PERSON, state: "active",
          restrictions: ["occupancy.activate"], startsAt: 0, endsAt: null,
          reasonCode: "manual", revision: 1,
        },
      },
      {
        collection: "blacklist_decisions", id: headId,
        data: {
          orgId: G.ORG, occupancyId: G.OCCUPANCY, restriction: "occupancy.activate",
          entryIds: [entryId], entryRevisions: [1], decision,
          latestDecisionId: "decision-h2d", expiresAt: null, recordType: "current", revision: 1,
        },
      },
    ],
    audit,
  );
}
