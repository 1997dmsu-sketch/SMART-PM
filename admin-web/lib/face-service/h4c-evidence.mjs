/**
 * HK-AI-04 H4-c C1: immutable reconcile evidence foundation.
 *
 * This module deliberately does not implement the reconcile state machine,
 * operation keys, HTTP routes or Provider calls. It provides:
 *   - exact schema validators for evidence/head/global K3 domain records;
 *   - independent K3 config, fingerprint and global domain guard;
 *   - deterministic evidence/head IDs;
 *   - canonical (sorted-key) structured HMAC digests;
 *   - append helpers that re-validate the previous evidence, the head CAS and
 *     the K3 domain inside one Store transaction.
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

export function evidenceDomainIds(realm, version) {
  const segment = domainSegment(realm);
  return {
    headId: "evidence-digest-domain:" + segment,
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
  if (!hex(left) || !hex(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

/**
 * Global K3 domain guard. Missing either side is corruption, never a signal to
 * backfill. A complete domain whose version/fingerprint differs from config is
 * DOMAIN_MISMATCH. No input state is mutated.
 */
export function applyEvidenceDomain(state, { realm, version, fingerprint, now } = {}) {
  if (!isPlainObject(state) || !realmValid(realm) || !integer(version, 1) ||
      !hex(fingerprint) || !integer(now)) fail("DOMAIN_INCOMPLETE");
  const { headId, versionId } = evidenceDomainIds(realm, version);
  const head = read(state, EVIDENCE_DOMAINS_COLLECTION, headId);
  const versionRecord = read(state, EVIDENCE_DOMAINS_COLLECTION, versionId);

  if (head === null && versionRecord === null) {
    const headRecord = {
      _id: headId, kind: "head", realm, keyVersion: version,
      keyFingerprint: fingerprint, revision: 1, createdAt: now,
    };
    const versionData = {
      _id: versionId, kind: "version", realm, keyVersion: version,
      keyFingerprint: fingerprint, enabledAt: now,
    };
    validateEvidenceDomainRecord(headRecord);
    validateEvidenceDomainRecord(versionData);
    return [
      write(EVIDENCE_DOMAINS_COLLECTION, headRecord),
      write(EVIDENCE_DOMAINS_COLLECTION, versionData),
    ];
  }

  const incomplete = () => fail("DOMAIN_INCOMPLETE");
  if (head === null) incomplete();
  try {
    validateEvidenceDomainRecord(head);
  } catch {
    incomplete();
  }
  // The stable head is the version anchor. A missing record for the current
  // config version means either a controlled version change (mismatch) or a
  // damaged same-version domain (incomplete), never an automatic backfill.
  if (versionRecord === null) {
    if (head.keyVersion !== version) fail("DOMAIN_MISMATCH");
    incomplete();
  }
  try {
    validateEvidenceDomainRecord(versionRecord);
  } catch {
    incomplete();
  }
  if (head.kind !== "head" || versionRecord.kind !== "version" ||
      head.realm !== realm || versionRecord.realm !== realm ||
      head.keyVersion !== versionRecord.keyVersion ||
      head.keyFingerprint !== versionRecord.keyFingerprint) incomplete();
  if (head.keyVersion !== version || versionRecord.keyVersion !== version ||
      head.keyFingerprint !== fingerprint || versionRecord.keyFingerprint !== fingerprint) {
    fail("DOMAIN_MISMATCH");
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
 * Pure transaction builder for one evidence append. It creates the global K3
 * domain (0-2 writes) only when both sides are absent, re-reads the head for
 * CAS, fully re-validates the previous evidence (schema, org/job/sequence,
 * observedAt, K3 realm/version/fingerprint and timing-safe HMAC), then returns
 * the new evidence and head writes. Any failure throws before returning writes.
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

  // Domain guard must run before any evidence/head decision. Writes are only
  // returned at the end, so a later failure cannot persist a partial domain.
  const domainWrites = applyEvidenceDomain(state, { ...cfg, now });

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
    ...domainWrites,
    write(EVIDENCE_COLLECTION, record),
    write(EVIDENCE_HEADS_COLLECTION, nextHead),
  ];
}
