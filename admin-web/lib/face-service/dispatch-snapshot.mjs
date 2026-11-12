import { assertSafeInt } from "./collections.mjs";
import { planEligibilityRefs } from "./eligibility.mjs";

export const DISPATCH_SNAPSHOTS = "face_dispatch_snapshots";
export const snapshotIdFor = (jobId) => `dispatch:${jobId}`;
export const ref = (collection, id) => ({ collection, id });
export const keyOf = ({ collection, id }) => `${collection}/${id}`;
export const readRef = (state, reference) => state[keyOf(reference)];

const SNAPSHOT_FIELDS = [
  "_id", "schemaVersion", "orgId", "jobId", "createdAt", "creatorActorId", "membershipId",
  "identityApplicationId", "personId", "occupancyId", "cycleId", "fileId", "claimId", "slotId",
  "domainHeadId", "domainVersionId", "restriction", "versions",
];
const VERSION_FIELDS = ["collection", "id", "present", "revision", "epoch", "keyVersion"];
const bounded = (value) => typeof value === "string" && value.length <= 512 &&
  value.trim() === value && value.length > 0 && !/[\/\x00-\x1f\x7f]/u.test(value);

const COLLECTIONS = new Set([
  "organizations", "org_memberships", "persons", "users", "identity_applications",
  "occupancies", "occupancy_cycles", "rooms", "property_catalog", "unique_claims",
  "room_primary_slots", "lifecycle_guards", "device_access_grants", "face_credentials",
  "file_assets", "access_devices", "device_claims", "device_digest_domains", "grant_slot_claims",
]);

export function versionRef(reference, record) {
  const { collection, id } = reference;
  const revision = record?.revision ?? null;
  const epoch = record?.epoch ?? null;
  const keyVersion = collection === "device_digest_domains" || collection === "identity_applications"
    ? record?.keyVersion ?? null : null;
  if (revision !== null) assertSafeInt(revision, "revision", { min: 1 });
  if (epoch !== null) assertSafeInt(epoch, "epoch");
  if (keyVersion !== null) assertSafeInt(keyVersion, "keyVersion", { min: 1 });
  return { collection, id, present: Boolean(record), revision, epoch, keyVersion };
}

export function createDispatchSnapshot({
  jobId, orgId, actor, now, request, state, grant, grantId, slot,
  credential, credentialId, fileId, deviceId, claimId, domainKeys, slotId,
}) {
  const versions = [
    ...planEligibilityRefs({ ...request, baseRefs: [] }).map((reference) =>
      versionRef(reference, readRef(state, reference))),
    ...[
      ref("organizations", orgId), ref("org_memberships", actor.membershipId),
      ref("face_credentials", credentialId), ref("file_assets", fileId),
      ref("access_devices", deviceId), ref("device_claims", claimId),
      ref("device_digest_domains", domainKeys.headId),
      ref("device_digest_domains", domainKeys.versionId),
    ].map((reference) => versionRef(reference, readRef(state, reference))),
    versionRef(ref("device_access_grants", grantId), grant),
    versionRef(ref("grant_slot_claims", slotId), slot),
  ];
  const snapshot = {
    schemaVersion: 1, orgId, jobId, createdAt: now, creatorActorId: actor.actorId,
    membershipId: actor.membershipId, identityApplicationId: request.identityApplicationId,
    personId: credential.personId, occupancyId: request.occupancyId, cycleId: request.cycleId,
    fileId, claimId, slotId, domainHeadId: domainKeys.headId, domainVersionId: domainKeys.versionId,
    restriction: "occupancy.activate", versions,
  };
  if (!snapshotIsBound({ ...snapshot, _id: snapshotIdFor(jobId) }, {
    _id: jobId, orgId, grantId, credentialId, deviceId,
  })) {
    const error = new Error("派发快照不完整");
    error.code = "DISPATCH_SNAPSHOT_REQUIRED";
    throw error;
  }
  return snapshot;
}

export function snapshotIsBound(snapshot, job) {
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.jobId !== job._id ||
      snapshot.orgId !== job.orgId || snapshot._id !== snapshotIdFor(job._id) ||
      snapshot.restriction !== "occupancy.activate" ||
      !Number.isSafeInteger(snapshot.createdAt) || snapshot.createdAt < 0 ||
      Object.keys(snapshot).length !== SNAPSHOT_FIELDS.length ||
      !SNAPSHOT_FIELDS.every((field) => Object.hasOwn(snapshot, field)) ||
      !SNAPSHOT_FIELDS.slice(5, 16).every((field) => bounded(snapshot[field])) ||
      !Array.isArray(snapshot.versions) || !snapshot.versions.length || snapshot.versions.length > 85) return false;
  const keys = new Set();
  for (const item of snapshot.versions) {
    if (!item || !COLLECTIONS.has(item.collection) || !bounded(item.id) ||
        typeof item.present !== "boolean" || Object.keys(item).length !== VERSION_FIELDS.length ||
        !VERSION_FIELDS.every((field) => Object.hasOwn(item, field)) || keys.has(keyOf(item))) return false;
    keys.add(keyOf(item));
    // Mutable synthetic sources need a version witness. K1 version documents
    // are keyed by their immutable version and checked against the K1 head.
    if (item.present && item.revision === null && item.epoch === null &&
        !(item.collection === "device_digest_domains" && item.id === snapshot.domainVersionId &&
          item.keyVersion !== null)) return false;
    for (const [field, min] of [["revision", 1], ["epoch", 0], ["keyVersion", 1]]) {
      if (item[field] !== null && (!Number.isSafeInteger(item[field]) || item[field] < min)) return false;
    }
  }
  return [
    ref("organizations", job.orgId), ref("org_memberships", snapshot.membershipId),
    ref("persons", snapshot.personId), ref("identity_applications", snapshot.identityApplicationId),
    ref("occupancies", snapshot.occupancyId), ref("occupancy_cycles", snapshot.cycleId),
    ref("device_access_grants", job.grantId), ref("face_credentials", job.credentialId),
    ref("file_assets", snapshot.fileId), ref("access_devices", job.deviceId),
    ref("device_claims", snapshot.claimId), ref("grant_slot_claims", snapshot.slotId),
    ref("device_digest_domains", snapshot.domainHeadId), ref("device_digest_domains", snapshot.domainVersionId),
  ].every((reference) => keys.has(keyOf(reference)));
}
