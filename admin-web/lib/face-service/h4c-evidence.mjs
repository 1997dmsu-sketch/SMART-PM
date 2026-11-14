/**
 * HK-AI-04 H4-c C1: immutable reconcile evidence foundation.
 *
 * This module deliberately does not implement the reconcile state machine,
 * operation keys, HTTP routes or Provider calls. It provides:
 *   - exact schema validators for evidence/head/global K3 domain records;
 *   - independent K3 config, fingerprint and a strictly READ-ONLY global
 *     domain guard (append/reconcile can never create or repair the domain);
 *   - a separate, explicit, controlled first-deployment initialization helper
 *     that is NOT called by any runtime append/reconcile path and requires a
 *     recorded global-empty precondition (the Store cannot prove it atomically);
 *   - deterministic evidence/head IDs and one stable global domain head ID;
 *   - canonical (sorted-key) structured HMAC digests;
 *   - append helpers that re-validate the previous evidence, the head CAS and
 *     the K3 domain inside one Store transaction.
 *
 * Runtime only ever reads the fixed head+version pair and fails closed. The
 * initialization helper exists for a future controlled deployment migration;
 * it performs no scan, guesses no emptiness and never repairs existing records.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { failCode } from "../model.mjs";

export const EVIDENCE_COLLECTION = "device_operation_evidence";
export const EVIDENCE_HEADS_COLLECTION = "device_operation_evidence_heads";
export const EVIDENCE_DOMAINS_COLLECTION = "evidence_digest_domains";

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
const EVIDENCE_DOMAIN_HEAD_PURPOSE = "evidence-digest-domain";
const EVIDENCE_DOMAIN_HEAD_VERSION = "v1";
export const EVIDENCE_DOMAIN_HEAD_ID =
  `${EVIDENCE_DOMAIN_HEAD_PURPOSE}:${EVIDENCE_DOMAIN_HEAD_VERSION}:global`;

const SOURCE_CODES = new Map([
  ["confirmed_removed", "OPERATOR_CONFIRMED_REMOVED"],
  ["confirmed_present", "OPERATOR_CONFIRMED_PRESENT"],
  ["still_unknown", "OPERATOR_UNCERTAIN"],
]);

const EVIDENCE_FIELDS = "_id orgId jobId schemaVersion sequence decision sourceType sourceCode observedAt digestDomain digestAlgorithm digestAlgorithmVersion keyRealm keyVersion keyFingerprint digest previousEvidenceId evidenceScope actorId createdAt".split(" ");
const EVIDENCE_HEAD_FIELDS = "_id orgId jobId revision lastSequence lastEvidenceId lastObservedAt createdAt updatedAt".split(" ");
const DOMAIN_HEAD_FIELDS = "_id kind realm keyVersion keyFingerprint revision createdAt".split(" ");
const DOMAIN_VERSION_FIELDS = "_id kind realm keyVersion keyFingerprint enabledAt".split(" ");

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
 * branch, hidden switch or catch-based auto-write here: first deployment setup
 * is only available through the separate initializeEvidenceDomain helper,
 * which this guard never calls. Missing/damaged pairs fail closed.
 */
export function applyEvidenceDomain(state, { realm, version, fingerprint } = {}) {
  if (!isPlainObject(state) || !realmValid(realm) || !integer(version, 1) ||
      !hex(fingerprint)) fail("DOMAIN_INCOMPLETE");
  const { headId, versionId } = evidenceDomainIds(realm, version);
  const head = read(state, EVIDENCE_DOMAINS_COLLECTION, headId);
  const versionRecord = read(state, EVIDENCE_DOMAINS_COLLECTION, versionId);

  // Missing both sides, or a missing stable head, is storage incompleteness,
  // never an initialization signal. Initialization is only available through
  // the separate initializeEvidenceDomain helper, never from this guard.
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
 * Global scope marker for the controlled first-deployment precondition. It is
 * deliberately not derived from realm/org: one deployment has one global K3
 * domain, matching the single stable head.
 */
export const EVIDENCE_DOMAIN_INIT_SCOPE = "global";

const INIT_PRECONDITIONS = new WeakSet();

/**
 * Record the explicit global-empty precondition for controlled initialization.
 *
 * Store.transact can only read declared point refs; neither LocalStore nor
 * CloudStore can atomically prove that three collections are globally empty.
 * This function therefore NEVER scans the Store. The controlled deployment
 * migration performs the authoritative empty check under its maintenance
 * window and records the observed (empty) record-ID lists plus operator/time
 * here. Any observed record, missing metadata, unknown field or malformed
 * input fails closed. A plain object cannot mint this proof.
 */
export function evidenceDomainInitPrecondition(options = {}) {
  if (!isPlainObject(options)) fail("DOMAIN_INCOMPLETE");
  const fields = [
    "scope", "domains", "evidence", "evidenceHeads", "checkedAt", "checkedBy",
  ];
  const keys = Reflect.ownKeys(options);
  if (keys.length !== fields.length ||
      keys.some((key) => typeof key !== "string" || !fields.includes(key))) {
    fail("DOMAIN_INCOMPLETE");
  }
  for (const key of fields) {
    if (!Object.hasOwn(options, key)) fail("DOMAIN_INCOMPLETE");
  }
  const { scope, domains, evidence, evidenceHeads, checkedAt, checkedBy } = options;
  if (scope !== EVIDENCE_DOMAIN_INIT_SCOPE ||
      !Array.isArray(domains) || !Array.isArray(evidence) ||
      !Array.isArray(evidenceHeads) || !integer(checkedAt) ||
      !opaque(checkedBy)) {
    fail("DOMAIN_INCOMPLETE");
  }
  if (domains.length !== 0 || evidence.length !== 0 || evidenceHeads.length !== 0) {
    fail("DOMAIN_INIT_CONFLICT");
  }
  const proof = Object.freeze({
    scope,
    domains: Object.freeze([...domains]),
    evidence: Object.freeze([...evidence]),
    evidenceHeads: Object.freeze([...evidenceHeads]),
    checkedAt,
    checkedBy,
  });
  INIT_PRECONDITIONS.add(proof);
  return proof;
}

function assertInitPrecondition(precondition) {
  // A missing/unverifiable proof means the deployment cannot prove global
  // emptiness: fail closed instead of guessing or scanning. A valid proof can
  // only have been minted with all three observed lists empty, but re-check the
  // recorded counts defensively.
  if (!precondition || !INIT_PRECONDITIONS.has(precondition)) {
    fail("DOMAIN_INCOMPLETE");
  }
  if (precondition.scope !== EVIDENCE_DOMAIN_INIT_SCOPE ||
      precondition.domains.length !== 0 || precondition.evidence.length !== 0 ||
      precondition.evidenceHeads.length !== 0) {
    fail("DOMAIN_INIT_CONFLICT");
  }
}

/** Refs for the fixed head+version pair; no collection listing is involved. */
export function evidenceDomainInitRefs(config) {
  const cfg = normalizedConfig(config);
  const { headId, versionId } = evidenceDomainIds(cfg.realm, cfg.version);
  return [
    ref(EVIDENCE_DOMAINS_COLLECTION, headId),
    ref(EVIDENCE_DOMAINS_COLLECTION, versionId),
  ];
}

/**
 * Pure create-only write builder for the single global domain pair.
 *
 * It refuses to write when any record visible in the transaction state already
 * exists in any of the three H4-c collections, and it requires the recorded
 * global-empty precondition. It never merges, overwrites, repairs or backfills
 * an existing domain record.
 */
export function evidenceDomainInitWrites(state, { config, now, precondition } = {}) {
  const cfg = normalizedConfig(config);
  if (!isPlainObject(state) || !integer(now)) fail("DOMAIN_INCOMPLETE");
  assertInitPrecondition(precondition);
  const { headId, versionId } = evidenceDomainIds(cfg.realm, cfg.version);
  if (read(state, EVIDENCE_DOMAINS_COLLECTION, headId) !== null ||
      read(state, EVIDENCE_DOMAINS_COLLECTION, versionId) !== null) {
    fail("DOMAIN_INIT_CONFLICT");
  }
  const prefixes = [EVIDENCE_DOMAINS_COLLECTION, EVIDENCE_COLLECTION,
    EVIDENCE_HEADS_COLLECTION].map((collection) => `${collection}/`);
  for (const [key, value] of Object.entries(state)) {
    if (value != null && prefixes.some((prefix) => key.startsWith(prefix))) {
      fail("DOMAIN_INIT_CONFLICT");
    }
  }
  const headRecord = {
    _id: headId,
    kind: "head",
    realm: cfg.realm,
    keyVersion: cfg.version,
    keyFingerprint: cfg.fingerprint,
    revision: 1,
    createdAt: now,
  };
  const versionRecord = {
    _id: versionId,
    kind: "version",
    realm: cfg.realm,
    keyVersion: cfg.version,
    keyFingerprint: cfg.fingerprint,
    enabledAt: now,
  };
  validateEvidenceDomainRecord(headRecord);
  validateEvidenceDomainRecord(versionRecord);
  return [
    write(EVIDENCE_DOMAINS_COLLECTION, headRecord),
    write(EVIDENCE_DOMAINS_COLLECTION, versionRecord),
  ];
}

/**
 * Explicit controlled first-deployment initialization.
 *
 * This is NOT called by appendEvidenceWrites or by any future reconcile
 * helper. It creates the global head + frozen version pair exactly once and
 * only with a recorded global-empty precondition. It does not list/scan the
 * Store, does not create a second realm namespace and does not overwrite any
 * existing domain/evidence/evidence-head record. Store create-only semantics
 * are the final duplicate/concurrency guard for the fixed IDs.
 */
export async function initializeEvidenceDomain(store, config, {
  now, precondition, audit,
} = {}) {
  const cfg = normalizedConfig(config);
  if (!store || typeof store.transact !== "function" || !integer(now)) {
    fail("DOMAIN_INCOMPLETE");
  }
  assertInitPrecondition(precondition);
  const refs = evidenceDomainInitRefs(cfg);
  let writes = null;
  await store.transact(refs, (state) => {
    writes = evidenceDomainInitWrites(state, { config: cfg, now, precondition });
    return writes;
  }, audit);
  return writes;
}

/**
 * Pure transaction builder for one evidence append. The global K3 domain is
 * only READ here; append never creates or repairs it. Initialization is a
 * separate controlled helper and is not called on this runtime path. It
 * re-reads the head for CAS, fully re-validates the previous evidence (schema,
 * org/job/sequence, observedAt, K3 realm/version/fingerprint and timing-safe
 * HMAC), then returns the new evidence and head writes. Any failure throws
 * before returning writes.
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
  // never an implicit initialization signal. The guard always returns an empty
  // write set, so append contributes no domain writes at all.
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
