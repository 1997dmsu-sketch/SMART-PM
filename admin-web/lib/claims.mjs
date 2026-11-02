import { createHash } from "node:crypto";
// Fixed-ID unique placeholders (docs/database/DATA-MODEL.md §3.1).
// Keys here are non-sensitive (names, codes, levels, room numbers);
// sensitive subjects (phone, identity) belong to DB-03/04 and must use keyed HMAC.
const hash = (...parts) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
export const claimId = (namespace, scope, key) =>
  `claim-${hash(namespace, scope, key)}`;
export const claims = {
  catalogName: (orgId, parentId, kind, name) =>
    claimId("catalog-name", `${orgId}|${parentId}|${kind}`, name),
  layoutCode: (orgId, buildingId, code) =>
    claimId("layout-code", `${orgId}|${buildingId}`, code),
  floorLevel: (orgId, buildingId, level) =>
    claimId("floor-level", `${orgId}|${buildingId}`, String(level)),
  roomNo: (orgId, floorId, roomNo) =>
    claimId("room-no", `${orgId}|${floorId}`, roomNo),
  roomListing: (orgId, roomId) => claimId("room-listing", `${orgId}`, roomId),
};
export const guardId = (orgId) => `guard-lifecycle-${orgId}`;
// DB-06 eligibility guards are shared by blacklist changes, account claims
// and DB-05 activation. The subject key is already an ID or keyed digest.
export const eligibilityGuardId = (orgId, subjectType, subjectKey) =>
  `eligibility-${hash(orgId, subjectType, subjectKey)}`;
export const operationKeyId = (actorId, orgId, route, key) =>
  `op-${hash("idempotency", actorId, orgId, route, key)}`;
