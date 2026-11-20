/**
 * HK-AI-04 H4-c C1: immutable reconcile evidence foundation.
 *
 * This module deliberately does not implement the reconcile state machine,
 * operation keys, HTTP routes, Provider calls or K3 domain initialization.
 * It provides:
 *   - exact schema validators for evidence/head/global K3 domain records;
 *   - independent K3 config, fingerprint and a strictly READ-ONLY global
 *     domain guard (append/reconcile can never create or repair the domain);
 *   - deterministic evidence/head IDs and one stable global domain head ID;
 *   - canonical (sorted-key) structured HMAC digests;
 *   - append helpers that re-validate the previous evidence, the head CAS and
 *     the K3 domain inside one Store transaction.
 *
 * First deployment initialization (the fixed head + version pair) is NOT a
 * runtime capability here. It belongs to a separate, controlled deployment
 * migration task; C1 only ever reads the pair and fails closed.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { failCode } from "../model.mjs";
import { H4C, H4C_AUDIT_COLLECTION, H4C_COLLECTION_NAMES } from "../h4c-collections.mjs";

export const EVIDENCE_COLLECTION = H4C.evidence;
export const EVIDENCE_HEADS_COLLECTION = H4C.evidenceHeads;
export const EVIDENCE_DOMAINS_COLLECTION = H4C.domains;

export const EVIDENCE_DIGEST_DOMAIN = "KEYED_DIGEST/h4-reconcile-evidence";
export const EVIDENCE_DIGEST_ALGORITHM = "HMAC-SHA256";
export const EVIDENCE_DIGEST_ALGORITHM_VERSION = 1;
export const EVIDENCE_SCHEMA_VERSION = 1;
export const H4C_EVIDENCE_SCOPE = "simulated";
export const EVIDENCE_MAX_SEQUENCE = 9;
export const STILL_UNKNOWN_MAX_SEQUENCE = 8;
export const EVIDENCE_KEY_FINGERPRINT_DOMAIN = "KEYED_DIGEST/h4-evidence-fingerprint";

/**
 * P0-2: one global, fixed, versioned domain-head ID. It is deliberately
 * independent of realm/keyVersion/org: a realm or version change must compare
 * against the SAME head (and fail DOMAIN_MISMATCH), never create a parallel
 * domain namespace. Rotation/migration requires a separate controlled task.
 */
export const EVIDENCE_DOMAIN_HEAD_ID = "evidence-digest-domain:v1:global";

const SOURCE_CODES = new Map([
  ["confirmed_removed", "OPERATOR_CONFIRMED_REMOVED"],
  ["confirmed_present", "OPERATOR_CONFIRMED_PRESENT"],
  ["still_unknown", "OPERATOR_UNCERTAIN"],
]);

export const EVIDENCE_FIELDS = Object.freeze("_id orgId jobId schemaVersion sequence decision sourceType sourceCode observedAt digestDomain digestAlgorithm digestAlgorithmVersion keyRealm keyVersion keyFingerprint digest previousEvidenceId evidenceScope actorId createdAt".split(" "));
export const EVIDENCE_HEAD_FIELDS = Object.freeze("_id orgId jobId revision lastSequence lastEvidenceId lastObservedAt createdAt updatedAt".split(" "));
export const DOMAIN_HEAD_FIELDS = Object.freeze("_id kind realm keyVersion keyFingerprint revision createdAt".split(" "));
export const DOMAIN_VERSION_FIELDS = Object.freeze("_id kind realm keyVersion keyFingerprint enabledAt".split(" "));

const fail = (code, status = 409) => failCode(code, code, status);
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
const matches = (value, regex) => typeof value === "string" && regex.test(value);
const realmValid = (value) => matches(value, /^[a-z0-9][a-z0-9-]{2,63}$/);
const hex = (value) => matches(value, /^[0-9a-f]{64}$/);
const opaque = (value) => matches(value, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
  [null, Object.prototype].includes(Object.getPrototypeOf(value));

function assertExact(record, fields, code) {
  if (!isPlainObject(record)) fail(code);
  const ownKeys = Reflect.ownKeys(record);
  if (ownKeys.length !== fields.length) fail(code);
  for (const key of fields) {
    if (!Object.hasOwn(record, key)) fail(code);
  }
  for (const key of ownKeys) {
    if (typeof key !== "string" || !fields.includes(key)) fail(code);
  }
}

/** Canonical value used by every HMAC/ID in this module (object keys sorted). */
export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = stableValue(value[key]);
    return result;
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

const hashId = (prefix, parts) => prefix + createHash("sha256")
  .update(stableStringify(parts), "utf8").digest("hex").slice(0, 32);

export const evidenceId = (orgId, jobId, sequence) =>
  hashId("h4c-evidence-v1:", [orgId, jobId, sequence]);

export const evidenceHeadId = (orgId, jobId) =>
  hashId("h4c-evidence-head-v1:", [orgId, jobId]);

function domainSegment(realm) {
  return Buffer.from(String(realm), "utf8").toString("base64url");
}

/**
 * The head ID is the fixed global anchor. Only the version-history ID is
 * frozen from the configured realm/version; it is still constrained by the
 * stable head inside applyEvidenceDomain.
 */
export function evidenceDomainIds(realm, version) {
  const segment = domainSegment(realm);
  return {
    headId: EVIDENCE_DOMAIN_HEAD_ID,
    versionId: "evidence-digest-domain-version:" + segment + ":" + version,
  };
}

export function validateEvidenceRecord(record) {
  assertExact(record, EVIDENCE_FIELDS, "EVIDENCE_INVALID");
  const maxSequence = record.decision === "still_unknown"
    ? STILL_UNKNOWN_MAX_SEQUENCE : EVIDENCE_MAX_SEQUENCE;
  if (!opaque(record.orgId) || !opaque(record.jobId) || !opaque(record.actorId) ||
      record._id !== evidenceId(record.orgId, record.jobId, record.sequence) ||
      record.schemaVersion !== EVIDENCE_SCHEMA_VERSION ||
      !integer(record.sequence, 1, maxSequence) ||
      !SOURCE_CODES.has(record.decision) || record.sourceType !== "operator" ||
      SOURCE_CODES.get(record.decision) !== record.sourceCode ||
      !integer(record.observedAt) || !integer(record.createdAt, record.observedAt) ||
      record.digestDomain !== EVIDENCE_DIGEST_DOMAIN ||
      record.digestAlgorithm !== EVIDENCE_DIGEST_ALGORITHM ||
      record.digestAlgorithmVersion !== EVIDENCE_DIGEST_ALGORITHM_VERSION ||
      !realmValid(record.keyRealm) || !integer(record.keyVersion, 1) ||
      !hex(record.keyFingerprint) || !hex(record.digest) ||
      record.previousEvidenceId !== (record.sequence === 1
        ? null : evidenceId(record.orgId, record.jobId, record.sequence - 1)) ||
      record.evidenceScope !== H4C_EVIDENCE_SCOPE) fail("EVIDENCE_INVALID");
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > 4096) fail("EVIDENCE_INVALID");
}

export function validateEvidenceHead(record) {
  assertExact(record, EVIDENCE_HEAD_FIELDS, "EVIDENCE_INVALID");
  if (!opaque(record.orgId) || !opaque(record.jobId) ||
      record._id !== evidenceHeadId(record.orgId, record.jobId) ||
      !integer(record.revision, 1) || !integer(record.lastSequence, 0, EVIDENCE_MAX_SEQUENCE) ||
      record.lastEvidenceId !== (record.lastSequence === 0
        ? null : evidenceId(record.orgId, record.jobId, record.lastSequence)) ||
      !integer(record.lastObservedAt, 0,
        record.lastSequence === 0 ? 0 : record.updatedAt) ||
      !integer(record.createdAt) || !integer(record.updatedAt, record.createdAt)) {
    fail("EVIDENCE_INVALID");
  }
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > 4096) fail("EVIDENCE_INVALID");
}

export function validateEvidenceDomainRecord(record) {
  const kind = isPlainObject(record) ? record.kind : null;
  const fields = kind === "head" ? DOMAIN_HEAD_FIELDS : DOMAIN_VERSION_FIELDS;
  assertExact(record, fields, "DOMAIN_INCOMPLETE");
  if (!["head", "version"].includes(kind) || !realmValid(record.realm) ||
      !integer(record.keyVersion, 1) || !hex(record.keyFingerprint)) {
    fail("DOMAIN_INCOMPLETE");
  }
  const { headId, versionId } = evidenceDomainIds(record.realm, record.keyVersion);
  if (kind === "head") {
    if (record._id !== headId || !integer(record.revision, 1) || !integer(record.createdAt)) {
      fail("DOMAIN_INCOMPLETE");
    }
  } else if (record._id !== versionId || !integer(record.enabledAt)) {
    fail("DOMAIN_INCOMPLETE");
  }
}

export function evidenceKeyFingerprint({ key, realm, version }) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !realmValid(realm) || !integer(version, 1)) {
    fail("NOT_CONFIGURED", 503);
  }
  return createHmac("sha256", key)
    .update(stableStringify([EVIDENCE_KEY_FINGERPRINT_DOMAIN, "v1", realm, version]), "utf8")
    .digest("hex");
}

/** Independent K3 config. K1/K2 variables are never consulted. */
export function evidenceKeyConfig(env = process.env) {
  const encoded = env.H4_EVIDENCE_HMAC_KEY_B64;
  const realm = env.H4_EVIDENCE_REALM;
  const rawVersion = env.H4_EVIDENCE_KEY_VERSION;
  if (typeof encoded !== "string" || encoded.length === 0 ||
      encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    fail("NOT_CONFIGURED", 503);
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) fail("NOT_CONFIGURED", 503);
  if (typeof rawVersion !== "string" || !/^[0-9]+$/.test(rawVersion)) {
    fail("NOT_CONFIGURED", 503);
  }
  const version = Number(rawVersion);
  if (!integer(version, 1) || !realmValid(realm)) fail("NOT_CONFIGURED", 503);
  return { key, realm, version, fingerprint: evidenceKeyFingerprint({ key, realm, version }) };
}

function normalizedConfig(config) {
  if (!config || !Buffer.isBuffer(config.key) || config.key.length !== 32 ||
      !realmValid(config.realm) || !integer(config.version, 1) ||
      !hex(config.fingerprint) ||
      evidenceKeyFingerprint(config) !== config.fingerprint) {
    fail("NOT_CONFIGURED", 503);
  }
  return config;
}

/**
 * Structured HMAC over the exact design message. JSON keys are sorted so the
 * digest is independent of object insertion order.
 */
export function evidenceDigest(record, config) {
  const cfg = normalizedConfig(config);
  if (!record || !realmValid(record.keyRealm) || !integer(record.keyVersion, 1)) {
    fail("EVIDENCE_INVALID");
  }
  const message = {
    algorithmVersion: EVIDENCE_DIGEST_ALGORITHM_VERSION,
    decision: record.decision,
    domain: EVIDENCE_DIGEST_DOMAIN,
    evidenceScope: record.evidenceScope,
    jobId: record.jobId,
    keyVersion: record.keyVersion,
    observedAt: record.observedAt,
    orgId: record.orgId,
    previousEvidenceId: record.previousEvidenceId,
    realm: record.keyRealm,
    sequence: record.sequence,
    sourceCode: record.sourceCode,
    sourceType: record.sourceType,
  };
  return createHmac("sha256", cfg.key).update(stableStringify(message), "utf8").digest("hex");
}

const ref = (collection, id) => ({ collection, id });
const write = (collection, data) => ({ collection, id: data._id, data });
const unique = (refs) => [...new Map(refs.map((item) => [
  `${item.collection}/${item.id}`, item,
])).values()];
const read = (state, collection, id) => state[`${collection}/${id}`] ?? null;

function constantTimeHexEqual(left, right) {
  // Both sides must be canonical 64-char lowercase hex before timingSafeEqual:
  // that check also guarantees equal-length (32-byte) Buffers.
  if (!hex(left) || !hex(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

/**
 * READ-ONLY runtime K3 domain validation. It never creates, repairs or
 * backfills records:
 *   - both sides absent / only head / only version -> DOMAIN_INCOMPLETE;
 *   - corrupt or internally contradictory pair -> DOMAIN_INCOMPLETE;
 *   - the stable head's realm/keyVersion/keyFingerprint differs from the
 *     current config -> DOMAIN_MISMATCH (a version bump and a realm switch
 *     both land here even when the version record for the new config is
 *     absent).
 * Only an exact match returns an empty write set. There is no initialization
 * branch, hidden switch or catch-based auto-write: first deployment setup is
 * a separate controlled migration, outside C1.
 */
export function applyEvidenceDomain(state, { realm, version, fingerprint } = {}) {
  if (!isPlainObject(state) || !realmValid(realm) || !integer(version, 1) ||
      !hex(fingerprint)) fail("DOMAIN_INCOMPLETE");
  const { headId, versionId } = evidenceDomainIds(realm, version);
  const head = read(state, EVIDENCE_DOMAINS_COLLECTION, headId);
  const versionRecord = read(state, EVIDENCE_DOMAINS_COLLECTION, versionId);

  // Missing both sides, or a missing stable head, is storage incompleteness,
  // never an initialization signal. C1 has no initialization path at all;
  // first deployment setup is a separate controlled migration.
  if (head === null) fail("DOMAIN_INCOMPLETE");
  try {
    validateEvidenceDomainRecord(head);
  } catch {
    fail("DOMAIN_INCOMPLETE");
  }
  // The SAME stable head is the realm/version/fingerprint anchor. Compare the
  // current config against it before looking at the version record, so a realm
  // switch, version bump or same-version rekey is always DOMAIN_MISMATCH even
  // when the version record for the new config is absent or pre-seeded.
  if (head.realm !== realm || head.keyVersion !== version ||
      head.keyFingerprint !== fingerprint) {
    fail("DOMAIN_MISMATCH");
  }
  // The head matches config, so a missing version record is damage, not a
  // configuration change.
  if (versionRecord === null) fail("DOMAIN_INCOMPLETE");
  try {
    validateEvidenceDomainRecord(versionRecord);
  } catch {
    fail("DOMAIN_INCOMPLETE");
  }
  // The version record must agree with the stable head; never adopt one side.
  if (head.kind !== "head" || versionRecord.kind !== "version" ||
      head.realm !== versionRecord.realm ||
      head.keyVersion !== versionRecord.keyVersion ||
      head.keyFingerprint !== versionRecord.keyFingerprint) {
    fail("DOMAIN_INCOMPLETE");
  }
  return [];
}

function checkHead(head, orgId, jobId) {
  try {
    validateEvidenceHead(head);
  } catch {
    fail("EVIDENCE_CHAIN_BROKEN");
  }
  if (head.orgId !== orgId || head.jobId !== jobId) fail("EVIDENCE_CHAIN_BROKEN");
}

/**
 * Point-read refs for one append transaction. The head/domain snapshots are
 * only used to choose the deterministic IDs; every check repeats inside the
 * transaction. A previous evidence ref is added only when the head points at it.
 */
export function evidenceAppendRefs(job, head, domainHead, config) {
  const cfg = normalizedConfig(config);
  if (!job || !opaque(job.orgId) || !opaque(job._id)) fail("EVIDENCE_INVALID");
  if (head != null) checkHead(head, job.orgId, job._id);
  if (domainHead != null) {
    try {
      validateEvidenceDomainRecord(domainHead);
      if (domainHead.kind !== "head") fail("DOMAIN_INCOMPLETE");
    } catch {
      fail("DOMAIN_INCOMPLETE");
    }
  }
  const { headId, versionId } = evidenceDomainIds(cfg.realm, cfg.version);
  const refs = [
    ref(EVIDENCE_DOMAINS_COLLECTION, headId),
    ref(EVIDENCE_DOMAINS_COLLECTION, versionId),
    ref(EVIDENCE_HEADS_COLLECTION, evidenceHeadId(job.orgId, job._id)),
    ref(EVIDENCE_COLLECTION, evidenceId(job.orgId, job._id, (head?.lastSequence ?? 0) + 1)),
  ];
  if (head?.lastEvidenceId) refs.push(ref(EVIDENCE_COLLECTION, head.lastEvidenceId));
  return unique(refs);
}

/**
 * Pure transaction builder for one evidence append. The global K3 domain is
 * only READ here; append never creates it. It re-reads the head for CAS, fully
 * re-validates the previous evidence (schema, org/job/sequence, observedAt,
 * K3 realm/version/fingerprint and timing-safe HMAC), then returns the new
 * evidence and head writes. Any failure throws before returning writes.
 */
export function appendEvidenceWrites(state, {
  job, expectedHead = null, hasExistingEvidence, config, now,
  decision, sourceType, sourceCode, observedAt, actorId,
} = {}) {
  const cfg = normalizedConfig(config);
  if (!isPlainObject(state) || !job || !isPlainObject(job) ||
      !opaque(job.orgId) || !opaque(job._id)) fail("EVIDENCE_INVALID");
  if (!integer(now) || !opaque(actorId)) fail("EVIDENCE_INVALID");
  const finishedAt = job.result?.finishedAt;
  if (!integer(job.createdAt) || !integer(finishedAt)) fail("EVIDENCE_INVALID");
  if (!SOURCE_CODES.has(decision) || sourceType !== "operator" ||
      SOURCE_CODES.get(decision) !== sourceCode) fail("EVIDENCE_INVALID");

  const floor = Math.max(job.createdAt, finishedAt);
  if (!integer(observedAt) || observedAt > now || observedAt < floor) {
    fail("EVIDENCE_STALE");
  }

  // Read-only domain validation must run before any evidence/head decision.
  // A missing/damaged/mismatched domain fails closed with zero writes; it is
  // never an implicit initialization signal. The guard returns an empty write
  // set by contract, and append deliberately ignores it: this path writes only
  // evidence + head and can never contribute a domain write.
  applyEvidenceDomain(state, cfg);

  const headId = evidenceHeadId(job.orgId, job._id);
  const head = read(state, EVIDENCE_HEADS_COLLECTION, headId);
  if (expectedHead == null) {
    if (head !== null) fail("EVIDENCE_CHAIN_BROKEN");
    if (hasExistingEvidence !== false) fail("EVIDENCE_CHAIN_BROKEN");
  } else {
    checkHead(head, job.orgId, job._id);
    if (head.revision !== expectedHead.revision ||
        head.lastEvidenceId !== expectedHead.lastEvidenceId ||
        head.lastSequence !== expectedHead.lastSequence) {
      fail("EVIDENCE_HEAD_CONFLICT");
    }
  }

  const previousEvidenceId = head?.lastEvidenceId ?? null;
  let previous = null;
  if (previousEvidenceId === null) {
    if (hasExistingEvidence !== false) fail("EVIDENCE_CHAIN_BROKEN");
    if (head !== null && head.lastSequence !== 0) fail("EVIDENCE_CHAIN_BROKEN");
  } else {
    previous = read(state, EVIDENCE_COLLECTION, previousEvidenceId);
    if (previous === null) fail("EVIDENCE_CHAIN_BROKEN");
    try {
      validateEvidenceRecord(previous);
      if (previous._id !== previousEvidenceId ||
          previous.orgId !== job.orgId ||
          previous.jobId !== job._id ||
          previous.sequence !== head.lastSequence ||
          previous.observedAt !== head.lastObservedAt ||
          previous.keyRealm !== cfg.realm ||
          previous.keyVersion !== cfg.version ||
          previous.keyFingerprint !== cfg.fingerprint ||
          !integer(previous.observedAt, floor, now) ||
          !constantTimeHexEqual(previous.digest, evidenceDigest(previous, cfg))) {
        fail("EVIDENCE_CHAIN_BROKEN");
      }
    } catch {
      fail("EVIDENCE_CHAIN_BROKEN");
    }
    if (observedAt < previous.observedAt) fail("EVIDENCE_STALE");
  }

  const sequence = (head?.lastSequence ?? 0) + 1;
  const maxSequence = decision === "still_unknown"
    ? STILL_UNKNOWN_MAX_SEQUENCE : EVIDENCE_MAX_SEQUENCE;
  if (sequence > maxSequence) fail("EVIDENCE_INVALID");

  const id = evidenceId(job.orgId, job._id, sequence);
  if (read(state, EVIDENCE_COLLECTION, id) !== null) {
    fail(sequence === 1 ? "EVIDENCE_CHAIN_BROKEN" : "CONFLICT");
  }

  const record = {
    _id: id,
    orgId: job.orgId,
    jobId: job._id,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    sequence,
    decision,
    sourceType,
    sourceCode,
    observedAt,
    digestDomain: EVIDENCE_DIGEST_DOMAIN,
    digestAlgorithm: EVIDENCE_DIGEST_ALGORITHM,
    digestAlgorithmVersion: EVIDENCE_DIGEST_ALGORITHM_VERSION,
    keyRealm: cfg.realm,
    keyVersion: cfg.version,
    keyFingerprint: cfg.fingerprint,
    digest: "",
    previousEvidenceId,
    evidenceScope: H4C_EVIDENCE_SCOPE,
    actorId,
    createdAt: now,
  };
  record.digest = evidenceDigest(record, cfg);
  validateEvidenceRecord(record);

  const nextHead = {
    _id: headId,
    orgId: job.orgId,
    jobId: job._id,
    revision: (head?.revision ?? 0) + 1,
    lastSequence: sequence,
    lastEvidenceId: id,
    lastObservedAt: observedAt,
    createdAt: head?.createdAt ?? now,
    updatedAt: now,
  };
  validateEvidenceHead(nextHead);

  return [
    write(EVIDENCE_COLLECTION, record),
    write(EVIDENCE_HEADS_COLLECTION, nextHead),
  ];
}

/* ------------------------------------------------------------------------- *
 * S1 contract layer
 *
 * Pure constants, canonical IDs, exact schema arrays, digests and predicates
 * for the C1 contracts. This layer deliberately has no Store access, no I/O,
 * no clock read and no mutation of its inputs. Store wiring and the 18-refs
 * append path belong to later stages.
 * ------------------------------------------------------------------------- */

export const EVIDENCE_CHAIN_ANCHOR_PREFIX = "h4c-evidence-anchor-v1:";
export const EVIDENCE_CHAIN_FENCE_ID = "evidence-chain-fence:v1:global";
export const EVIDENCE_CHAIN_K3_MARKER_ID = "evidence-chain-k3-marker:v1:global";
export const MONITOR_HEALTH_WINDOW_MS = 300_000;
export const CLOCK_SKEW_MS = 30_000;

export const H4C_DIGEST_DOMAINS = Object.freeze({
  audit: "KEYED_DIGEST/h4-evidence-chain-audit",
  fence: "KEYED_DIGEST/h4-evidence-chain-fence",
  monitor: "KEYED_DIGEST/h4-evidence-monitor",
  ticket: "KEYED_DIGEST/h4-canonical-write-admission",
  plan: "KEYED_DIGEST/h4-evidence-plan",
  planStatus: "KEYED_DIGEST/h4-evidence-plan-status",
  recovery: "KEYED_DIGEST/h4-evidence-chain-recovery",
  k3Bootstrap: "KEYED_DIGEST/h4-k3-bootstrap",
  writerRuntime: "KEYED_DIGEST/h4-evidence-writer-runtime",
  k3Marker: "KEYED_DIGEST/h4-evidence-k3-marker",
  maintenanceManifest: "KEYED_DIGEST/h4-maintenance-manifest",
});

export const H4C_ERROR_CODES = Object.freeze({
  NOT_CONFIGURED: "NOT_CONFIGURED",
  DOMAIN_INCOMPLETE: "DOMAIN_INCOMPLETE",
  DOMAIN_MISMATCH: "DOMAIN_MISMATCH",
  K3_BOOTSTRAP_DENIED: "K3_BOOTSTRAP_DENIED",
  EVIDENCE_CHAIN_PROOF_REQUIRED: "EVIDENCE_CHAIN_PROOF_REQUIRED",
  EVIDENCE_CHAIN_ADMISSION_REQUIRED: "EVIDENCE_CHAIN_ADMISSION_REQUIRED",
  EVIDENCE_CHAIN_HALTED: "EVIDENCE_CHAIN_HALTED",
  EVIDENCE_CHAIN_FENCE_EXPIRED: "EVIDENCE_CHAIN_FENCE_EXPIRED",
  EVIDENCE_CHAIN_BROKEN: "EVIDENCE_CHAIN_BROKEN",
  EVIDENCE_HEAD_CONFLICT: "EVIDENCE_HEAD_CONFLICT",
  CONFLICT: "CONFLICT",
  EVIDENCE_INVALID: "EVIDENCE_INVALID",
  EVIDENCE_STALE: "EVIDENCE_STALE",
  MIGRATION_CAPACITY_EXCEEDED: "MIGRATION_CAPACITY_EXCEEDED",
  MAINTENANCE_WINDOW_EXPIRED: "MAINTENANCE_WINDOW_EXPIRED",
  MAINTENANCE_MANIFEST_INVALID: "MAINTENANCE_MANIFEST_INVALID",
  PLAN_DUPLICATE: "PLAN_DUPLICATE",
  PLAN_INVALID: "PLAN_INVALID",
  PLAN_CONSUMED: "PLAN_CONSUMED",
  PLAN_EXPIRED: "PLAN_EXPIRED",
  PLAN_REVOKED: "PLAN_REVOKED",
  PLAN_STALE: "PLAN_STALE",
});

export const EVIDENCE_ANCHOR_FIELDS = Object.freeze(
  "_id orgId jobId schemaVersion firstEvidenceId createdAt".split(" "));
export const EVIDENCE_AUDIT_FIELDS = Object.freeze(
  "_id orgId actorId actorType action target createdAt".split(" "));
export const EVIDENCE_FENCE_FIELDS = Object.freeze(
  "_id kind scope schemaVersion status epoch reasonCode monitorId heartbeatAt validUntil updatedAt fenceDigest".split(" "));
export const EVIDENCE_K3_MARKER_FIELDS = Object.freeze(
  "_id kind scope schemaVersion fenceId k3DomainHeadId k3DomainVersionId k3DomainHeadRevision realm keyVersion keyFingerprint bootstrapRunId maintenanceId maintenanceManifestDigest windowStart windowEnd createdAt markerDigest".split(" "));
export const EVIDENCE_AUDIT_PROOF_FIELDS = Object.freeze(
  "_id kind scope schemaVersion realm keyVersion keyFingerprint domainHeadId domainHeadRevision writeEpoch admissionPolicyVersion writerSetDigest auditedCollections status canonicalEvidenceCount canonicalHeadCount anchorCount legacyCount inventoryDigest checkedAt checkedBy auditDigest k3MarkerDigest writerPlanId".split(" "));
export const EVIDENCE_PLAN_FIELDS = Object.freeze([
  "_id", "kind", "scope", "schemaVersion", "planKind", "phase", "runId", "issuedBy",
  "issuedAt", "windowStart", "windowEnd", "keyFingerprint", "k3MarkerId", "sourceKind",
  "sourceHaltedEpoch", "sourceFenceDigest", "targetWriteEpoch", "targetAdmissionPolicyVersion",
  "targetWriterSetDigest", "targetProofId", "writerEpoch", "revokedWriterSetDigest",
  "revocationReceiptDigest", "finalInventoryDigest", "canonicalEvidenceCount",
  "canonicalHeadCount", "anchorCount", "auditedCollections", "planDigest", "planTicket",
  "status", "statusFrom", "statusTargetProofId", "statusUpdatedAt", "statusReason",
  "statusActor", "statusTicket", "initialStatusTicket", "runtimeTicket",
]);

export const H4C_SCHEMA_FIELDS = Object.freeze({
  anchor: EVIDENCE_ANCHOR_FIELDS,
  evidence: EVIDENCE_FIELDS,
  head: EVIDENCE_HEAD_FIELDS,
  domainHead: DOMAIN_HEAD_FIELDS,
  domainVersion: DOMAIN_VERSION_FIELDS,
  audit: EVIDENCE_AUDIT_FIELDS,
  fence: EVIDENCE_FENCE_FIELDS,
  k3Marker: EVIDENCE_K3_MARKER_FIELDS,
  auditProof: EVIDENCE_AUDIT_PROOF_FIELDS,
  plan: EVIDENCE_PLAN_FIELDS,
});

const AUDITED_COLLECTIONS_SORTED = Object.freeze([...H4C_COLLECTION_NAMES].sort());
const PLAN_KINDS = new Set(["migration", "recovery", "writer"]);
const PLAN_PHASES = new Set(["pre-anchor", "final", "recovery", "writer"]);
const PLAN_STATUSES = new Set(["active", "consumed", "revoked"]);
const PLAN_STATUS_REASONS = new Set([
  "plan-issue", "consumed:migration-finalize", "consumed:recovery-finalize",
  "consumed:writer-rotate", "revoked:plan-revoke",
]);
const ADMISSION_FIELDS = Object.freeze([
  "kind", "operation", "writeEpoch", "admissionPolicyVersion", "writerSetDigest",
  "proofId", "refsDigest", "writesDigest", "operationAuthDigest", "ticket",
]);

/** Canonical keyed digest: HMAC-SHA256 over { domain, version:1, ...fields }. */
function keyedDigest(domain, fields, config) {
  const cfg = normalizedConfig(config);
  return createHmac("sha256", cfg.key)
    .update(stableStringify({ domain, version: 1, ...fields }), "utf8").digest("hex");
}

export function h4cKeyedDigest(domain, fields, config) {
  if (!Object.values(H4C_DIGEST_DOMAINS).includes(domain)) fail("EVIDENCE_INVALID");
  if (!isPlainObject(fields)) fail("EVIDENCE_INVALID");
  return keyedDigest(domain, fields, config);
}

const sha256 = (value) => createHash("sha256")
  .update(stableStringify(value), "utf8").digest("hex");

export function h4cAuditProofDigest(proof, config) {
  if (!isPlainObject(proof)) fail("EVIDENCE_CHAIN_PROOF_REQUIRED");
  const { auditDigest, ...fields } = proof;
  return keyedDigest(H4C_DIGEST_DOMAINS.audit, fields, config);
}

export function h4cFenceDigest(fence, config) {
  if (!isPlainObject(fence)) fail("EVIDENCE_CHAIN_HALTED");
  const { fenceDigest, ...fields } = fence;
  return keyedDigest(H4C_DIGEST_DOMAINS.fence, fields, config);
}

export function h4cMonitorAuthDigest(message, config) {
  if (!isPlainObject(message)) fail("EVIDENCE_INVALID");
  return keyedDigest(H4C_DIGEST_DOMAINS.monitor, message, config);
}

export function h4cAdmissionTicketDigest(admission, config) {
  if (!isPlainObject(admission)) fail("EVIDENCE_CHAIN_ADMISSION_REQUIRED");
  const { ticket, ...fields } = admission;
  return keyedDigest(H4C_DIGEST_DOMAINS.ticket, fields, config);
}

export function h4cPlanDigest(core) {
  if (!isPlainObject(core)) fail("PLAN_INVALID");
  return createHash("sha256").update(stableStringify(core), "utf8").digest("hex");
}

export function h4cPlanTicket(core, config) {
  if (!isPlainObject(core)) fail("PLAN_INVALID");
  return keyedDigest(H4C_DIGEST_DOMAINS.plan, core, config);
}

export function h4cPlanStatusTicket(fields, config) {
  if (!isPlainObject(fields)) fail("PLAN_INVALID");
  return keyedDigest(H4C_DIGEST_DOMAINS.planStatus, fields, config);
}

export function h4cRecoveryTicket(plan, config) {
  if (!isPlainObject(plan)) fail("PLAN_INVALID");
  const { recoveryTicket, ...fields } = plan;
  return keyedDigest(H4C_DIGEST_DOMAINS.recovery, fields, config);
}

export function h4cK3DomainTicket(bootstrap, config) {
  if (!isPlainObject(bootstrap)) fail("PLAN_INVALID");
  const { ticket, ...fields } = bootstrap;
  return keyedDigest(H4C_DIGEST_DOMAINS.k3Bootstrap, fields, config);
}

export function h4cWriterRuntimeTicket(fields, config) {
  if (!isPlainObject(fields)) fail("PLAN_INVALID");
  return keyedDigest(H4C_DIGEST_DOMAINS.writerRuntime, fields, config);
}

export function h4cK3MarkerDigest(marker, config) {
  if (!isPlainObject(marker)) fail("EVIDENCE_CHAIN_PROOF_REQUIRED");
  const { markerDigest, ...fields } = marker;
  return keyedDigest(H4C_DIGEST_DOMAINS.k3Marker, fields, config);
}

export function h4cMaintenanceManifestTicket(manifest, config) {
  if (!isPlainObject(manifest)) fail("MAINTENANCE_MANIFEST_INVALID");
  const { maintenanceTicket, ...fields } = manifest;
  return keyedDigest(H4C_DIGEST_DOMAINS.maintenanceManifest, fields, config);
}

function sortRefRows(left, right) {
  if (left.collection !== right.collection) return left.collection < right.collection ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

export function h4cRefsDigest(refs) {
  if (!Array.isArray(refs)) fail("EVIDENCE_INVALID");
  const canonical = refs.map((item) => {
    if (!isPlainObject(item) || typeof item.collection !== "string" ||
        typeof item.id !== "string") fail("EVIDENCE_INVALID");
    return { collection: item.collection, id: item.id };
  }).sort(sortRefRows);
  return sha256(canonical);
}

export function h4cWritesDigest(writes) {
  if (!Array.isArray(writes)) fail("EVIDENCE_INVALID");
  const canonical = writes.map((item) => {
    if (!isPlainObject(item) || typeof item.collection !== "string" ||
        typeof item.id !== "string" || !isPlainObject(item.data)) fail("EVIDENCE_INVALID");
    return { collection: item.collection, id: item.id, data: item.data };
  }).sort(sortRefRows);
  return sha256(canonical);
}

/* ---- canonical IDs ------------------------------------------------------- */

export function evidenceAnchorId(orgId, jobId) {
  if (!opaque(orgId) || !opaque(jobId)) fail("EVIDENCE_INVALID");
  return hashId(EVIDENCE_CHAIN_ANCHOR_PREFIX, [orgId, jobId]);
}

export function evidenceProofId(keyFingerprint, domainHeadRevision, writeEpoch) {
  if (!hex(keyFingerprint) || !integer(domainHeadRevision, 1) || !integer(writeEpoch, 1)) {
    fail("EVIDENCE_CHAIN_PROOF_REQUIRED");
  }
  return `evidence-chain-audit:v1:${keyFingerprint}:${domainHeadRevision}:${writeEpoch}`;
}

export function writerRunId(writerEpoch) {
  if (!integer(writerEpoch, 1)) fail("PLAN_INVALID");
  return `we-${writerEpoch}`;
}

/** Parse only the canonical writer runId (`we-<positive decimal, no zeros>`). */
export function writerEpochFromRunId(runId) {
  if (typeof runId !== "string" || !/^we-(0|[1-9][0-9]*)$/.test(runId)) fail("PLAN_INVALID");
  const writerEpoch = Number(runId.slice(3));
  if (!integer(writerEpoch, 1)) fail("PLAN_INVALID");
  return writerEpoch;
}

export function writerPlanId(writerEpoch) {
  return `evidence-chain-plan:v1:writer:${writerRunId(writerEpoch)}:writer`;
}

export function evidencePlanId(planKind, runId, phase) {
  if (!PLAN_KINDS.has(planKind) || !PLAN_PHASES.has(phase) ||
      typeof runId !== "string" || runId.length === 0 || runId !== runId.trim()) {
    fail("PLAN_INVALID");
  }
  if (planKind === "writer" && phase !== "writer") fail("PLAN_INVALID");
  if (planKind === "migration" && !["pre-anchor", "final"].includes(phase)) {
    fail("PLAN_INVALID");
  }
  if (planKind === "recovery" && phase !== "recovery") fail("PLAN_INVALID");
  return `evidence-chain-plan:v1:${planKind}:${runId}:${phase}`;
}

export function evidenceC1AuditId({ orgId, scopeKey, action, targetList, revision } = {}) {
  if (!opaque(orgId) || !opaque(scopeKey) ||
      !["h4c.evidence.genesis", "h4c.evidence.append"].includes(action) ||
      !Array.isArray(targetList) || targetList.length === 0 ||
      !integer(revision, 1)) fail("EVIDENCE_CHAIN_ADMISSION_REQUIRED");
  const seen = new Set();
  for (let index = 0; index < targetList.length; index += 1) {
    const target = targetList[index];
    if (typeof target !== "string" || !target.includes("/") ||
        target.startsWith(`${H4C_AUDIT_COLLECTION}/`) || seen.has(target) ||
        (index > 0 && targetList[index - 1] >= target)) {
      fail("EVIDENCE_CHAIN_ADMISSION_REQUIRED");
    }
    seen.add(target);
  }
  return hashId("audit-h4c-v1:", [orgId, scopeKey, action, targetList, revision]);
}

/** Build the exact 7-field C1 test-only explicit audit record. */
export function evidenceC1AuditRecord({
  orgId, jobId, targetList, sequence, actorId, actorType, now,
} = {}) {
  if (!integer(sequence, 1) || !integer(now) || !opaque(actorId) || !opaque(actorType)) {
    fail("EVIDENCE_CHAIN_ADMISSION_REQUIRED");
  }
  const action = sequence === 1 ? "h4c.evidence.genesis" : "h4c.evidence.append";
  const audit = {
    _id: evidenceC1AuditId({ orgId, scopeKey: jobId, action, targetList, revision: sequence }),
    orgId,
    actorId,
    actorType,
    action,
    target: targetList.join(", "),
    createdAt: now,
  };
  validateH4cAuditRecord(audit);
  return audit;
}

/** Rebuild and compare a C1 audit against the exact D4b inputs. */
export function validateEvidenceC1AuditRecord(record, {
  orgId, jobId, targetList, sequence, now,
} = {}) {
  validateH4cAuditRecord(record);
  if (!integer(sequence, 1) || !integer(now)) {
    fail("EVIDENCE_CHAIN_ADMISSION_REQUIRED");
  }
  const expected = evidenceC1AuditRecord({
    orgId, jobId, targetList, sequence, actorId: record.actorId,
    actorType: record.actorType, now,
  });
  if (record._id !== expected._id || record.orgId !== expected.orgId ||
      record.action !== expected.action || record.target !== expected.target ||
      record.createdAt !== now) fail("EVIDENCE_CHAIN_ADMISSION_REQUIRED");
}

/* ---- exact schema validators -------------------------------------------- */

export function validateEvidenceAnchorRecord(record) {
  assertExact(record, EVIDENCE_ANCHOR_FIELDS, "EVIDENCE_INVALID");
  if (!opaque(record.orgId) || !opaque(record.jobId) ||
      record._id !== evidenceAnchorId(record.orgId, record.jobId) ||
      record.schemaVersion !== EVIDENCE_SCHEMA_VERSION ||
      record.firstEvidenceId !== evidenceId(record.orgId, record.jobId, 1) ||
      !integer(record.createdAt)) fail("EVIDENCE_INVALID");
}

export function validateH4cAuditRecord(record) {
  assertExact(record, EVIDENCE_AUDIT_FIELDS, "EVIDENCE_INVALID");
  if (!/^audit-h4c-v1:[0-9a-f]{32}$/.test(record._id ?? "") ||
      !opaque(record.orgId) || !opaque(record.actorId) || !opaque(record.actorType) ||
      !opaque(record.action) || typeof record.target !== "string" ||
      record.target.length === 0 || !integer(record.createdAt)) fail("EVIDENCE_INVALID");
}

export function validateH4cAuditProofRecord(record, config) {
  const code = "EVIDENCE_CHAIN_PROOF_REQUIRED";
  assertExact(record, EVIDENCE_AUDIT_PROOF_FIELDS, code);
  const cfg = normalizedConfig(config);
  if (!hex(record.keyFingerprint) || !integer(record.domainHeadRevision, 1) ||
      !integer(record.writeEpoch, 1)) fail(code);
  let expectedDigest = null;
  try {
    expectedDigest = h4cAuditProofDigest(record, cfg);
  } catch {
    fail(code);
  }
  if (record._id !== evidenceProofId(record.keyFingerprint, record.domainHeadRevision,
    record.writeEpoch) ||
      record.kind !== "audit" || record.scope !== "global" || record.schemaVersion !== 1 ||
      record.realm !== cfg.realm || record.keyVersion !== cfg.version ||
      record.keyFingerprint !== cfg.fingerprint ||
      record.domainHeadId !== EVIDENCE_DOMAIN_HEAD_ID ||
      !opaque(record.admissionPolicyVersion) || !hex(record.writerSetDigest) ||
      !Array.isArray(record.auditedCollections) ||
      record.auditedCollections.length !== AUDITED_COLLECTIONS_SORTED.length ||
      record.auditedCollections.some((name, index) => name !== AUDITED_COLLECTIONS_SORTED[index]) ||
      record.status !== "verified" ||
      !integer(record.canonicalEvidenceCount, 0) ||
      !integer(record.canonicalHeadCount, 0) || !integer(record.anchorCount, 0) ||
      !integer(record.legacyCount, 0) || record.legacyCount !== 0 ||
      !hex(record.inventoryDigest) || !integer(record.checkedAt) ||
      !opaque(record.checkedBy) || !hex(record.auditDigest) ||
      !hex(record.k3MarkerDigest) ||
      record.writerPlanId !== writerPlanId(record.writeEpoch) ||
      record.auditDigest !== expectedDigest) fail(code);
}

export function validateH4cFenceRecord(record, config) {
  const code = "EVIDENCE_CHAIN_HALTED";
  assertExact(record, EVIDENCE_FENCE_FIELDS, code);
  const cfg = normalizedConfig(config);
  let expectedDigest = null;
  try {
    expectedDigest = h4cFenceDigest(record, cfg);
  } catch {
    fail(code);
  }
  if (record._id !== EVIDENCE_CHAIN_FENCE_ID || record.kind !== "fence" ||
      record.scope !== "global" || record.schemaVersion !== 1 ||
      !["clear", "halted"].includes(record.status) ||
      !integer(record.epoch, 1) || !opaque(record.reasonCode) ||
      !opaque(record.monitorId) || !integer(record.heartbeatAt) ||
      !integer(record.validUntil) || record.validUntil <= record.heartbeatAt ||
      record.validUntil - record.heartbeatAt > MONITOR_HEALTH_WINDOW_MS ||
      !integer(record.updatedAt) || !hex(record.fenceDigest) ||
      record.fenceDigest !== expectedDigest) fail(code);
}

export function validateH4cK3MarkerRecord(record, config) {
  const code = "EVIDENCE_CHAIN_PROOF_REQUIRED";
  assertExact(record, EVIDENCE_K3_MARKER_FIELDS, code);
  const cfg = normalizedConfig(config);
  let expectedDigest = null;
  try {
    expectedDigest = h4cK3MarkerDigest(record, cfg);
  } catch {
    fail(code);
  }
  if (record._id !== EVIDENCE_CHAIN_K3_MARKER_ID || record.kind !== "k3-marker" ||
      record.scope !== "global" || record.schemaVersion !== 1 ||
      record.fenceId !== EVIDENCE_CHAIN_FENCE_ID ||
      record.k3DomainHeadId !== EVIDENCE_DOMAIN_HEAD_ID ||
      !opaque(record.k3DomainVersionId) || !integer(record.k3DomainHeadRevision, 1) ||
      record.realm !== cfg.realm || record.keyVersion !== cfg.version ||
      record.keyFingerprint !== cfg.fingerprint ||
      !opaque(record.bootstrapRunId) || !opaque(record.maintenanceId) ||
      !hex(record.maintenanceManifestDigest) ||
      !integer(record.windowStart) || !integer(record.windowEnd) ||
      record.windowEnd < record.windowStart || !integer(record.createdAt) ||
      record.createdAt < record.windowStart || record.createdAt > record.windowEnd ||
      !hex(record.markerDigest) || record.markerDigest !== expectedDigest) fail(code);
}

function sortedUniqueStrings(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (typeof value[index] !== "string" || value[index].length === 0 ||
        (index > 0 && value[index - 1] >= value[index])) return false;
  }
  return true;
}

function planCore28(plan) {
  const core = {};
  for (const field of EVIDENCE_PLAN_FIELDS.slice(0, 28)) core[field] = plan[field];
  return core;
}

function planEmptyValuesValid(plan) {
  if (plan.planKind === "migration") {
    if (!["pre-anchor", "final"].includes(plan.phase) || plan.sourceKind !== "none") return false;
    if (plan.sourceHaltedEpoch !== null || plan.sourceFenceDigest !== null) return false;
    if (plan.writerEpoch !== null || plan.revokedWriterSetDigest !== null ||
        plan.revocationReceiptDigest !== null) return false;
    if (plan.phase === "pre-anchor") {
      if (plan.finalInventoryDigest !== null || plan.auditedCollections !== null) return false;
      return plan.canonicalEvidenceCount === 0 && plan.canonicalHeadCount === 0 &&
        plan.anchorCount === 0;
    }
    return hex(plan.finalInventoryDigest) && sortedUniqueStrings(plan.auditedCollections) &&
      integer(plan.canonicalEvidenceCount, 0) && integer(plan.canonicalHeadCount, 0) &&
      integer(plan.anchorCount, 0);
  }
  if (plan.planKind === "recovery") {
    if (plan.phase !== "recovery" || plan.sourceKind !== "halted-fence") return false;
    if (!integer(plan.sourceHaltedEpoch, 1) || !hex(plan.sourceFenceDigest)) return false;
    if (plan.writerEpoch !== null || plan.revokedWriterSetDigest !== null ||
        plan.revocationReceiptDigest !== null) return false;
    return hex(plan.finalInventoryDigest) && sortedUniqueStrings(plan.auditedCollections) &&
      integer(plan.canonicalEvidenceCount, 0) && integer(plan.canonicalHeadCount, 0) &&
      integer(plan.anchorCount, 0);
  }
  if (plan.phase !== "writer" || !integer(plan.writerEpoch, 1)) return false;
  if (!hex(plan.revokedWriterSetDigest) || !hex(plan.revocationReceiptDigest)) return false;
  if (plan.finalInventoryDigest !== null || plan.auditedCollections !== null) return false;
  if (plan.canonicalEvidenceCount !== 0 || plan.canonicalHeadCount !== 0 ||
      plan.anchorCount !== 0) return false;
  if (plan.sourceKind === "bootstrap") {
    return plan.sourceHaltedEpoch === null && plan.sourceFenceDigest === null;
  }
  if (plan.sourceKind === "halted-fence") {
    return integer(plan.sourceHaltedEpoch, 1) && hex(plan.sourceFenceDigest) &&
      plan.writerEpoch > plan.sourceHaltedEpoch;
  }
  return false;
}

export function validateH4cPlanRecord(record, config) {
  const code = "PLAN_INVALID";
  assertExact(record, EVIDENCE_PLAN_FIELDS, code);
  const cfg = normalizedConfig(config);
  if (record.kind !== "plan" || record.scope !== "global" || record.schemaVersion !== 1 ||
      !PLAN_KINDS.has(record.planKind) || !PLAN_PHASES.has(record.phase) ||
      typeof record.runId !== "string" || record.runId.length === 0 ||
      !opaque(record.issuedBy) || !integer(record.issuedAt) ||
      !integer(record.windowStart) || !integer(record.windowEnd) ||
      record.windowStart > record.issuedAt || record.issuedAt >= record.windowEnd ||
      !hex(record.keyFingerprint) || record.keyFingerprint !== cfg.fingerprint ||
      record.k3MarkerId !== EVIDENCE_CHAIN_K3_MARKER_ID ||
      !integer(record.targetWriteEpoch, 1) ||
      !opaque(record.targetAdmissionPolicyVersion) ||
      !hex(record.targetWriterSetDigest) ||
      typeof record.targetProofId !== "string" || record.targetProofId.length === 0 ||
      !["none", "bootstrap", "halted-fence"].includes(record.sourceKind) ||
      !hex(record.planDigest) || !hex(record.planTicket) ||
      !PLAN_STATUSES.has(record.status) || !["none", "active"].includes(record.statusFrom) ||
      !integer(record.statusUpdatedAt) || !PLAN_STATUS_REASONS.has(record.statusReason) ||
      !opaque(record.statusActor) || !hex(record.statusTicket) ||
      !hex(record.initialStatusTicket) ||
      (record.runtimeTicket !== null && !hex(record.runtimeTicket))) fail(code);

  if (record.planKind === "writer") {
    if (!integer(record.writerEpoch, 1) || record.phase !== "writer" ||
        record.runId !== writerRunId(record.writerEpoch) ||
        record._id !== writerPlanId(record.writerEpoch) ||
        record.targetWriteEpoch !== record.writerEpoch) fail(code);
  } else if (record._id !== evidencePlanId(record.planKind, record.runId, record.phase)) {
    fail(code);
  }
  if (!planEmptyValuesValid(record)) fail(code);

  const core = planCore28(record);
  let expectedPlanDigest = null;
  let expectedPlanTicket = null;
  let expectedInitialTicket = null;
  try {
    expectedPlanDigest = h4cPlanDigest(core);
    expectedPlanTicket = h4cPlanTicket({ ...core, planDigest: expectedPlanDigest }, cfg);
    expectedInitialTicket = h4cPlanStatusTicket({
      planId: record._id, fromStatus: "none", toStatus: "active", targetProofId: null,
      statusUpdatedAt: record.issuedAt, statusReason: "plan-issue", actor: record.issuedBy,
    }, cfg);
  } catch {
    fail(code);
  }
  if (record.planDigest !== expectedPlanDigest ||
      record.planTicket !== expectedPlanTicket ||
      record.initialStatusTicket !== expectedInitialTicket) fail(code);

  const statusFields = {
    planId: record._id,
    fromStatus: record.statusFrom,
    toStatus: record.status,
    targetProofId: record.statusTargetProofId,
    statusUpdatedAt: record.statusUpdatedAt,
    statusReason: record.statusReason,
    actor: record.statusActor,
  };
  if (record.status === "active") {
    if (record.statusFrom !== "none" || record.statusTargetProofId !== null ||
        record.statusReason !== "plan-issue" || record.statusUpdatedAt !== record.issuedAt ||
        record.statusActor !== record.issuedBy ||
        record.statusTicket !== record.initialStatusTicket ||
        record.runtimeTicket !== null) fail(code);
  } else if (record.status === "consumed") {
    if (record.statusFrom !== "active" ||
        record.statusTargetProofId !== record.targetProofId) fail(code);
    let expectedStatusTicket = null;
    try {
      expectedStatusTicket = h4cPlanStatusTicket(statusFields, cfg);
    } catch {
      fail(code);
    }
    if (record.statusTicket !== expectedStatusTicket) fail(code);
    if (record.planKind === "writer") {
      if (record.runtimeTicket === null) fail(code);
      let expectedRuntimeTicket = null;
      try {
        expectedRuntimeTicket = h4cWriterRuntimeTicket({
          planId: record._id,
          proofId: record.statusTargetProofId,
          writerEpoch: record.writerEpoch,
          targetWriterSetDigest: record.targetWriterSetDigest,
          k3MarkerId: record.k3MarkerId,
          keyFingerprint: record.keyFingerprint,
          activatedAt: record.statusUpdatedAt,
        }, cfg);
      } catch {
        fail(code);
      }
      if (record.runtimeTicket !== expectedRuntimeTicket) fail(code);
    } else if (record.runtimeTicket !== null) {
      fail(code);
    }
  } else {
    if (record.statusFrom !== "active" || record.statusTargetProofId !== null ||
        record.statusReason !== "revoked:plan-revoke" ||
        record.runtimeTicket !== null) fail(code);
    let expectedStatusTicket = null;
    try {
      expectedStatusTicket = h4cPlanStatusTicket(statusFields, cfg);
    } catch {
      fail(code);
    }
    if (record.statusTicket !== expectedStatusTicket) fail(code);
  }
}

/* ---- predicates (booleans; no throws on invalid records) ---------------- */

function healthOptions(health) {
  return {
    windowMs: health?.windowMs ?? MONITOR_HEALTH_WINDOW_MS,
    skewMs: health?.skewMs ?? CLOCK_SKEW_MS,
  };
}

export function FenceRecordValid(fence, config) {
  try {
    validateH4cFenceRecord(fence, config);
    return true;
  } catch {
    return false;
  }
}

export function FenceStructValid(fence, proof, config) {
  if (!FenceRecordValid(fence, config) || !proof) return false;
  return fence.epoch === proof.writeEpoch;
}

export function FenceHealthy(fence, proof, now, config, health = {}) {
  if (!FenceStructValid(fence, proof, config) || !integer(now)) return false;
  const { windowMs, skewMs } = healthOptions(health);
  if (!integer(windowMs, 1) || !integer(skewMs, 0)) return false;
  return fence.status === "clear" && now >= fence.heartbeatAt - skewMs &&
    now <= fence.validUntil;
}

export function FenceExpired(fence, proof, now, config, health = {}) {
  if (!FenceStructValid(fence, proof, config) || !integer(now)) return false;
  const { skewMs } = healthOptions(health);
  if (!integer(skewMs, 0)) return false;
  return fence.status === "clear" && now > fence.validUntil &&
    now >= fence.heartbeatAt - skewMs;
}

export function FenceValid(fence, proof, now, config, health = {}) {
  return FenceHealthy(fence, proof, now, config, health);
}

export function FenceHeartbeatable(fence, proof, now, config, health = {}) {
  if (!FenceStructValid(fence, proof, config) || !integer(now)) return false;
  const { skewMs } = healthOptions(health);
  if (!integer(skewMs, 0)) return false;
  return fence.status === "clear" && now >= fence.heartbeatAt - skewMs;
}

export function K3DomainExact(state, config) {
  try {
    if (!isPlainObject(state)) return false;
    applyEvidenceDomain(state, normalizedConfig(config));
    return true;
  } catch {
    return false;
  }
}

export function K3MarkerValid(marker, state, config) {
  try {
    const cfg = normalizedConfig(config);
    validateH4cK3MarkerRecord(marker, cfg);
    if (!isPlainObject(state)) return false;
    applyEvidenceDomain(state, cfg);
    const { versionId } = evidenceDomainIds(cfg.realm, cfg.version);
    const head = read(state, H4C.domains, EVIDENCE_DOMAIN_HEAD_ID);
    const version = read(state, H4C.domains, versionId);
    return Boolean(head && version) &&
      marker.k3DomainHeadId === head._id &&
      marker.k3DomainHeadRevision === head.revision &&
      marker.k3DomainVersionId === version._id &&
      marker.realm === head.realm && marker.keyVersion === head.keyVersion &&
      marker.keyFingerprint === head.keyFingerprint;
  } catch {
    return false;
  }
}

export function PlanRecordValid(plan, config) {
  try {
    validateH4cPlanRecord(plan, config);
    return true;
  } catch {
    return false;
  }
}

export function WriterPlanValid(plan, proof, marker, config) {
  try {
    const cfg = normalizedConfig(config);
    validateH4cPlanRecord(plan, cfg);
    if (plan.planKind !== "writer" || plan.status !== "consumed" || !proof || !marker) {
      return false;
    }
    return plan.statusTargetProofId === proof._id &&
      proof.writerPlanId === plan._id &&
      plan.writerEpoch === proof.writeEpoch &&
      plan.k3MarkerId === marker._id && proof.k3MarkerDigest === marker.markerDigest &&
      plan.keyFingerprint === cfg.fingerprint &&
      proof.keyFingerprint === cfg.fingerprint;
  } catch {
    return false;
  }
}

export function CoverageValid(proof, marker, writerPlan, config, state = null) {
  try {
    const cfg = normalizedConfig(config);
    validateH4cAuditProofRecord(proof, cfg);
    if (proof.status !== "verified" || proof.legacyCount !== 0) return false;
    if (proof.realm !== cfg.realm || proof.keyVersion !== cfg.version ||
        proof.keyFingerprint !== cfg.fingerprint) return false;
    if (!isPlainObject(state) || !K3MarkerValid(marker, state, cfg)) return false;
    if (!marker || proof.k3MarkerDigest !== marker.markerDigest) return false;
    if (!WriterPlanValid(writerPlan, proof, marker, cfg)) return false;
    if (proof.writerSetDigest !== writerPlan.targetWriterSetDigest) return false;
    const audited = [...proof.auditedCollections].sort();
    return audited.length === AUDITED_COLLECTIONS_SORTED.length &&
      audited.every((name, index) => name === AUDITED_COLLECTIONS_SORTED[index]);
  } catch {
    return false;
  }
}

export function AdmissionValid(admission, refs, writes, config) {
  try {
    const cfg = normalizedConfig(config);
    if (!isPlainObject(admission)) return false;
    const keys = Object.keys(admission);
    if (keys.length !== ADMISSION_FIELDS.length ||
        ADMISSION_FIELDS.some((field) => !Object.hasOwn(admission, field)) ||
        keys.some((field) => !ADMISSION_FIELDS.includes(field))) return false;
    if (admission.kind !== "runtime" ||
        !["genesis", "append"].includes(admission.operation)) return false;
    if (!Object.hasOwn(admission, "operationAuthDigest") ||
        admission.operationAuthDigest !== null) return false;
    if (!integer(admission.writeEpoch, 1) ||
        !opaque(admission.admissionPolicyVersion) ||
        !hex(admission.writerSetDigest) ||
        typeof admission.proofId !== "string" || admission.proofId.length === 0 ||
        !hex(admission.refsDigest) || !hex(admission.writesDigest) ||
        !hex(admission.ticket)) return false;

    if (!Array.isArray(refs) || refs.length === 0 || refs.length > 90) return false;
    const refKeys = new Set();
    for (const item of refs) {
      if (!isPlainObject(item) || typeof item.collection !== "string" ||
          item.collection.length === 0 || typeof item.id !== "string" ||
          item.id.length === 0) return false;
      const key = `${item.collection}/${item.id}`;
      if (refKeys.has(key)) return false;
      refKeys.add(key);
    }

    if (!Array.isArray(writes)) return false;
    const writeKeys = new Set();
    for (const item of writes) {
      if (!isPlainObject(item) || typeof item.collection !== "string" ||
          item.collection.length === 0 || typeof item.id !== "string" ||
          item.id.length === 0 || !isPlainObject(item.data) ||
          item.data._id !== item.id) return false;
      const key = `${item.collection}/${item.id}`;
      if (!refKeys.has(key) || writeKeys.has(key)) return false;
      writeKeys.add(key);
    }
    if (admission.refsDigest !== h4cRefsDigest(refs) ||
        admission.writesDigest !== h4cWritesDigest(writes)) return false;
    const { ticket, ...fields } = admission;
    return ticket === h4cAdmissionTicketDigest(fields, cfg);
  } catch {
    return false;
  }
}

export function createH4cGate({ config, health = {} } = {}) {
  const cfg = normalizedConfig(config);
  if (!isPlainObject(health)) fail("NOT_CONFIGURED", 503);
  const windowMs = health.windowMs === undefined
    ? MONITOR_HEALTH_WINDOW_MS : health.windowMs;
  const skewMs = health.skewMs === undefined ? CLOCK_SKEW_MS : health.skewMs;
  if (!integer(windowMs, 1) || !integer(skewMs, 0)) fail("NOT_CONFIGURED", 503);
  const options = Object.freeze({ windowMs, skewMs });

  const gate = {
    verify({ state, refs, writes, admission, now } = {}) {
      if (!integer(now)) fail("EVIDENCE_INVALID");
      if (!AdmissionValid(admission, refs, writes, cfg)) {
        fail("EVIDENCE_CHAIN_ADMISSION_REQUIRED");
      }
      if (!isPlainObject(state)) fail("EVIDENCE_INVALID");
      const proof = read(state, H4C.auditProofs, admission.proofId);
      if (!proof || proof._id !== admission.proofId) {
        fail("EVIDENCE_CHAIN_PROOF_REQUIRED");
      }
      if (proof.writeEpoch !== admission.writeEpoch ||
          proof.writerSetDigest !== admission.writerSetDigest ||
          proof.admissionPolicyVersion !== admission.admissionPolicyVersion) {
        fail("EVIDENCE_CHAIN_ADMISSION_REQUIRED");
      }
      const marker = read(state, H4C.k3Markers, EVIDENCE_CHAIN_K3_MARKER_ID);
      const writerPlan = read(state, H4C.plans, proof.writerPlanId);
      const fence = read(state, H4C.fences, EVIDENCE_CHAIN_FENCE_ID);
      if (!CoverageValid(proof, marker, writerPlan, cfg, state)) {
        fail("EVIDENCE_CHAIN_PROOF_REQUIRED");
      }
      if (!FenceValid(fence, proof, now, cfg, options)) {
        if (FenceExpired(fence, proof, now, cfg, options)) {
          fail("EVIDENCE_CHAIN_FENCE_EXPIRED");
        }
        fail("EVIDENCE_CHAIN_HALTED");
      }
      return undefined;
    },
  };
  return Object.freeze(gate);
}
