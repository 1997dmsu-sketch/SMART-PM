import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, createHmac } from "node:crypto";

import { CloudStore, LocalStore, seed } from "../lib/store.mjs";
import {
  EVIDENCE_COLLECTION,
  EVIDENCE_DIGEST_ALGORITHM,
  EVIDENCE_DIGEST_ALGORITHM_VERSION,
  EVIDENCE_DIGEST_DOMAIN,
  EVIDENCE_DOMAIN_HEAD_ID,
  EVIDENCE_DOMAINS_COLLECTION,
  EVIDENCE_HEADS_COLLECTION,
  EVIDENCE_SCHEMA_VERSION,
  appendEvidenceWrites,
  applyEvidenceDomain,
  assertC1AppendRefs,
  evidenceAppendRefs,
  evidenceDigest,
  evidenceDomainIds,
  evidenceHeadId,
  evidenceId,
  evidenceKeyConfig,
  evidenceKeyFingerprint,
  stableStringify,
  validateEvidenceDomainRecord,
  validateEvidenceHead,
  validateEvidenceRecord,
} from "../lib/face-service/h4c-evidence.mjs";
import {
  AdmissionValid,
  CLOCK_SKEW_MS,
  CoverageValid,
  DOMAIN_HEAD_FIELDS,
  DOMAIN_VERSION_FIELDS,
  EVIDENCE_ANCHOR_FIELDS,
  EVIDENCE_AUDIT_FIELDS,
  EVIDENCE_AUDIT_PROOF_FIELDS,
  EVIDENCE_CHAIN_ANCHOR_PREFIX,
  EVIDENCE_CHAIN_FENCE_ID,
  EVIDENCE_CHAIN_K3_MARKER_ID,
  EVIDENCE_FENCE_FIELDS,
  EVIDENCE_FIELDS,
  EVIDENCE_HEAD_FIELDS,
  EVIDENCE_K3_MARKER_FIELDS,
  EVIDENCE_PLAN_FIELDS,
  FenceExpired,
  FenceHealthy,
  FenceHeartbeatable,
  FenceRecordValid,
  FenceStructValid,
  FenceValid,
  H4C_DIGEST_DOMAINS,
  H4C_ERROR_CODES,
  H4C_SCHEMA_FIELDS,
  K3DomainExact,
  K3MarkerValid,
  MONITOR_HEALTH_WINDOW_MS,
  PlanRecordValid,
  WriterPlanValid,
  createH4cGate,
  evidenceAnchorId,
  evidenceC1AuditId,
  evidenceC1AuditRecord,
  evidencePlanId,
  evidenceProofId,
  h4cAdmissionTicketDigest,
  h4cAuditProofDigest,
  h4cFenceDigest,
  h4cFinalWriteSet,
  h4cK3DomainTicket,
  h4cK3MarkerDigest,
  h4cKeyedDigest,
  h4cMaintenanceManifestTicket,
  h4cMonitorAuthDigest,
  h4cPlanDigest,
  h4cPlanStatusTicket,
  h4cPlanTicket,
  h4cRecoveryTicket,
  h4cRefsDigest,
  h4cWritesDigest,
  h4cWriterRuntimeTicket,
  mintH4cAdmission,
  validateEvidenceAnchorRecord,
  validateEvidenceC1AuditRecord,
  validateH4cAdmission,
  validateH4cAdmissionProof,
  validateH4cAuditProofRecord,
  validateH4cAuditRecord,
  validateH4cFenceRecord,
  validateH4cK3MarkerRecord,
  validateH4cPlanRecord,
  validateH4cPrecheck,
  writerEpochFromRunId,
  writerPlanId,
  writerRunId,
} from "../lib/face-service/h4c-evidence.mjs";
import {
  H4C, H4C_AUDIT_COLLECTION, H4C_COLLECTION_NAMES, isH4cCollection,
} from "../lib/h4c-collections.mjs";

const ORG = "org-h4c";
const JOB_ID = "job-h4c-1";
const ACTOR = "actor-h4c";
const NOW = 1_760_000_000_000;
const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");
const ENV_A = {
  H4_EVIDENCE_HMAC_KEY_B64: KEY_A,
  H4_EVIDENCE_KEY_VERSION: "1",
  H4_EVIDENCE_REALM: "h4c-realm",
};
const CONFIG = evidenceKeyConfig(ENV_A);
const JOB = {
  _id: JOB_ID,
  orgId: ORG,
  createdAt: NOW - 10_000,
  result: { finishedAt: NOW - 5_000 },
};
const OBSERVED = NOW - 2_000;
const AUDIT = { actorId: ACTOR, actorType: "user", action: "seed", orgId: ORG };
const SOURCE_CODES = {
  confirmed_removed: "OPERATOR_CONFIRMED_REMOVED",
  confirmed_present: "OPERATOR_CONFIRMED_PRESENT",
  still_unknown: "OPERATOR_UNCERTAIN",
};
const PROOF = s1Proof();
const PROOF_ID = PROOF._id;
const WRITE_EPOCH = PROOF.writeEpoch;
const AUDIT_ID = evidenceC1AuditId({
  orgId: ORG,
  scopeKey: JOB_ID,
  action: "h4c.evidence.genesis",
  targetList: [
    `${H4C.anchors}/${evidenceAnchorId(ORG, JOB_ID)}`,
    `${H4C.evidence}/${evidenceId(ORG, JOB_ID, 1)}`,
    `${H4C.evidenceHeads}/${evidenceHeadId(ORG, JOB_ID)}`,
  ].sort(),
  revision: 1,
});
const ref = (collection, id) => ({ collection, id });

function ensureProof(data) {
  if (!data[H4C.auditProofs]) data[H4C.auditProofs] = [];
  if (!data[H4C.auditProofs].some((row) => row._id === PROOF_ID)) {
    data[H4C.auditProofs].push(structuredClone(PROOF));
  }
}

function chainState(data, refs) {
  return Object.fromEntries(refs.map(({ collection, id }) => {
    const row = (data[collection] || []).find((entry) => entry._id === id);
    return [`${collection}/${id}`, row === undefined ? null : structuredClone(row)];
  }));
}

function applyWrites(data, writes) {
  for (const item of writes) {
    const rows = (data[item.collection] ||= []);
    const index = rows.findIndex((row) => row._id === item.id);
    if (index < 0) rows.push(structuredClone(item.data));
    else rows[index] = structuredClone(item.data);
  }
}

function applyStateWrites(state, writes) {
  for (const item of writes) {
    state[`${item.collection}/${item.id}`] = structuredClone(item.data);
  }
}

function makeAnchor({ orgId = ORG, jobId = JOB_ID, createdAt = NOW } = {}) {
  return {
    _id: evidenceAnchorId(orgId, jobId),
    orgId,
    jobId,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    firstEvidenceId: evidenceId(orgId, jobId, 1),
    createdAt,
  };
}

function chainFor(count, { job = JOB, decision = "confirmed_removed" } = {}) {
  const evidence = [];
  for (let sequence = 1; sequence <= count; sequence += 1) {
    evidence.push(makeEvidenceRecord({
      orgId: job.orgId,
      jobId: job._id,
      sequence,
      decision,
      observedAt: OBSERVED + sequence,
    }));
  }
  const head = count === 0 ? null : makeHead({
    orgId: job.orgId,
    jobId: job._id,
    revision: count,
    lastSequence: count,
    lastEvidenceId: evidence[count - 1]._id,
    lastObservedAt: evidence[count - 1].observedAt,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return { anchor: count === 0 ? null : makeAnchor({ orgId: job.orgId, jobId: job._id }), evidence, head };
}

function s2State({
  job = JOB, config = CONFIG, head = null, anchor = null, evidence = [], proof = PROOF,
} = {}) {
  const domain = makeDomainRecords(config);
  const state = domainState(config, domain.head, domain.version);
  state[`${H4C.auditProofs}/${PROOF_ID}`] = proof === null ? null : structuredClone(proof);
  state[`${H4C.anchors}/${evidenceAnchorId(job.orgId, job._id)}`] =
    anchor === null ? null : structuredClone(anchor);
  state[`${H4C.evidenceHeads}/${evidenceHeadId(job.orgId, job._id)}`] =
    head === null ? null : structuredClone(head);
  for (let sequence = 1; sequence <= 9; sequence += 1) {
    state[`${H4C.evidence}/${evidenceId(job.orgId, job._id, sequence)}`] =
      evidence[sequence - 1] ? structuredClone(evidence[sequence - 1]) : null;
  }
  return state;
}

function appendArgs({ decision = "still_unknown", ...overrides } = {}) {
  return {
    job: JOB,
    expectedHead: null,
    proofId: PROOF_ID,
    writeEpoch: WRITE_EPOCH,
    auditId: AUDIT_ID,
    config: CONFIG,
    now: NOW,
    decision,
    sourceType: "operator",
    sourceCode: SOURCE_CODES[decision],
    observedAt: OBSERVED,
    actorId: ACTOR,
    ...overrides,
  };
}

async function localStore(t) {
  const directory = await mkdtemp(join(tmpdir(), "smartpm-h4c-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new LocalStore(directory).init();
}

function makeEvidenceRecord({
  orgId = ORG,
  jobId = JOB_ID,
  sequence = 1,
  decision = "confirmed_removed",
  sourceType = "operator",
  sourceCode = SOURCE_CODES[decision],
  observedAt = OBSERVED,
  config = CONFIG,
  createdAt = observedAt,
} = {}) {
  const record = {
    _id: evidenceId(orgId, jobId, sequence),
    orgId,
    jobId,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    sequence,
    decision,
    sourceType,
    sourceCode,
    observedAt,
    digestDomain: EVIDENCE_DIGEST_DOMAIN,
    digestAlgorithm: EVIDENCE_DIGEST_ALGORITHM,
    digestAlgorithmVersion: EVIDENCE_DIGEST_ALGORITHM_VERSION,
    keyRealm: config.realm,
    keyVersion: config.version,
    keyFingerprint: config.fingerprint,
    digest: "",
    previousEvidenceId: sequence === 1 ? null : evidenceId(orgId, jobId, sequence - 1),
    evidenceScope: "simulated",
    actorId: ACTOR,
    createdAt,
  };
  record.digest = evidenceDigest(record, config);
  return record;
}

function makeHead({
  orgId = ORG,
  jobId = JOB_ID,
  revision = 1,
  lastSequence = 1,
  lastEvidenceId,
  lastObservedAt = OBSERVED,
  createdAt = NOW,
  updatedAt = NOW,
} = {}) {
  const empty = lastSequence === 0;
  return {
    _id: evidenceHeadId(orgId, jobId),
    orgId,
    jobId,
    revision,
    lastSequence,
    lastEvidenceId: empty ? null : (lastEvidenceId ?? evidenceId(orgId, jobId, lastSequence)),
    lastObservedAt: empty ? 0 : lastObservedAt,
    createdAt,
    updatedAt,
  };
}

function makeDomainRecords(config = CONFIG, now = NOW) {
  const { headId, versionId } = evidenceDomainIds(config.realm, config.version);
  return {
    head: {
      _id: headId, kind: "head", realm: config.realm, keyVersion: config.version,
      keyFingerprint: config.fingerprint, revision: 1, createdAt: now,
    },
    version: {
      _id: versionId, kind: "version", realm: config.realm, keyVersion: config.version,
      keyFingerprint: config.fingerprint, enabledAt: now,
    },
  };
}

function domainState(config, head, version) {
  const ids = evidenceDomainIds(config.realm, config.version);
  const state = {};
  state[`${EVIDENCE_DOMAINS_COLLECTION}/${ids.headId}`] = head ?? null;
  state[`${EVIDENCE_DOMAINS_COLLECTION}/${ids.versionId}`] = version ?? null;
  return state;
}

async function insert(store, collection, record) {
  await store.transact([ref(collection, record._id)], () => [{
    collection, id: record._id, data: structuredClone(record),
  }], AUDIT);
}

/**
 * Test-only fixture: build the fixed global head+version pair as plain data
 * (no Store access) and then seed it through the normal create-only Store
 * transaction. This is the ONLY setup path; production C1 has no
 * initialization capability.
 */
async function seedDomain(store, config = CONFIG, now = NOW) {
  const { head, version } = makeDomainRecords(config, now);
  await insert(store, EVIDENCE_DOMAINS_COLLECTION, head);
  await insert(store, EVIDENCE_DOMAINS_COLLECTION, version);
  // S2 synthetic proof fixture: a minimal read target for the proof ref. Full
  // CoverageValid is S5, so this fixture is intentionally not used as a claim
  // of proof/fence/marker/plan validity.
  if (store.data) ensureProof(store.data);
  return { head, version };
}

async function domainStateFor(store, config = CONFIG) {
  const state = {};
  const { headId, versionId } = evidenceDomainIds(config.realm, config.version);
  for (const id of [headId, versionId]) {
    state[`${EVIDENCE_DOMAINS_COLLECTION}/${id}`] =
      await store.get(EVIDENCE_DOMAINS_COLLECTION, id);
  }
  return state;
}

/**
 * S2 helper-layer append runner. Store wiring/anchor exactness belongs to S4,
 * so this runner assembles the 18-ref state from LocalStore data, calls the
 * pure helper and applies its exact writes to store.data. This keeps the
 * tests focused on the S2 chain contract without modifying store.mjs.
 */
async function runAppend(store, {
  job = JOB,
  config = CONFIG,
  now = NOW,
  decision = "still_unknown",
  sourceType = "operator",
  sourceCode = SOURCE_CODES[decision],
  observedAt = OBSERVED,
  expectedHead,
  proofId = PROOF_ID,
  writeEpoch = WRITE_EPOCH,
  auditId = AUDIT_ID,
  onBuild,
} = {}) {
  if (!store.data) throw Error("runAppend requires a data-backed store");
  const actualHead = (store.data[EVIDENCE_HEADS_COLLECTION] || [])
    .find((row) => row._id === evidenceHeadId(job.orgId, job._id)) ?? null;
  const expected = expectedHead !== undefined ? expectedHead : actualHead;
  const refs = evidenceAppendRefs({
    job, expectedHead: expected, proofId, writeEpoch, auditId, config,
  });
  const state = chainState(store.data, refs);
  const writes = appendEvidenceWrites(state, {
    job,
    expectedHead: expected,
    proofId,
    writeEpoch,
    auditId,
    config,
    now,
    decision,
    sourceType,
    sourceCode,
    observedAt,
    actorId: ACTOR,
  });
  onBuild?.(writes, refs);
  applyWrites(store.data, writes);
  return writes;
}

function rejectCode(code) {
  return (error) => {
    assert.equal(error.code, code);
    return true;
  };
}

async function expectFailure(store, options, code) {
  const before = structuredClone(store.data);
  await assert.rejects(() => runAppend(store, options), rejectCode(code));
  assert.deepEqual(store.data, before);
}

function assertNoBusinessWrites(store) {
  assert.deepEqual(store.data[EVIDENCE_COLLECTION] ?? [], []);
  assert.deepEqual(store.data[EVIDENCE_HEADS_COLLECTION] ?? [], []);
  assert.deepEqual(store.data[H4C.anchors] ?? [], []);
}

function cloudHarness(initial = []) {
  let records = new Map(initial.map(({ collection, id, data }) => [
    `${collection}/${id}`, structuredClone(data),
  ]));
  const rowsFor = (name, where = null) => [...records.entries()]
    .filter(([key]) => key.startsWith(`${name}/`))
    .map(([key, data]) => ({ _id: key.slice(name.length + 1), ...structuredClone(data) }))
    .filter((row) => !where || Object.entries(where).every(([field, value]) => row[field] === value));
  const db = {
    async runTransaction(callback) {
      const staged = new Map([...records].map(([key, value]) => [key, structuredClone(value)]));
      const tx = {
        collection(name) {
          return {
            doc(id) {
              const key = `${name}/${id}`;
              return {
                async get() {
                  const value = staged.get(key);
                  return { data: value === undefined ? [] : [{ _id: id, ...structuredClone(value) }] };
                },
                async set(data) {
                  staged.set(key, structuredClone(data));
                  return {};
                },
              };
            },
          };
        },
      };
      const result = await callback(tx);
      records = staged;
      return result;
    },
    collection(name) {
      let where = null;
      let limit = Infinity;
      const query = {
        where(value) { where = value; return query; },
        orderBy() { return query; },
        skip() { return query; },
        limit(value) { limit = value; return query; },
        async get() { return { data: rowsFor(name, where).slice(0, limit) }; },
      };
      return query;
    },
  };
  return {
    store: new CloudStore({ database: () => db }),
    record(collection, id) {
      const value = records.get(`${collection}/${id}`);
      return value === undefined ? null : { _id: id, ...structuredClone(value) };
    },
    snapshot() {
      return Object.fromEntries([...records].map(([key, value]) => [key, structuredClone(value)]));
    },
  };
}

test("K3 config is independent, canonical and fingerprint-bound", () => {
  assert.equal(CONFIG.key.length, 32);
  assert.equal(CONFIG.realm, "h4c-realm");
  assert.equal(CONFIG.version, 1);
  assert.match(CONFIG.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(CONFIG.fingerprint, evidenceKeyFingerprint(CONFIG));
  assert.equal(evidenceKeyConfig(ENV_A).fingerprint, CONFIG.fingerprint);

  assert.throws(() => evidenceKeyConfig({}), rejectCode("NOT_CONFIGURED"));
  assert.throws(() => evidenceKeyConfig({
    OPERATION_KEY_HMAC_KEY_B64: KEY_A,
    OPERATION_KEY_VERSION: "1",
    OPERATION_KEY_REALM: "op-realm",
  }), rejectCode("NOT_CONFIGURED"));
  assert.throws(() => evidenceKeyConfig({
    DEVICE_CLAIM_HMAC_KEY_B64: KEY_A,
    DEVICE_CLAIM_KEY_VERSION: "1",
    DEVICE_DIGEST_REALM: "device-realm",
  }), rejectCode("NOT_CONFIGURED"));
  for (const env of [
    { ...ENV_A, H4_EVIDENCE_HMAC_KEY_B64: "not-base64" },
    { ...ENV_A, H4_EVIDENCE_HMAC_KEY_B64: Buffer.alloc(16, 1).toString("base64") },
    { ...ENV_A, H4_EVIDENCE_REALM: "UPPER" },
    { ...ENV_A, H4_EVIDENCE_KEY_VERSION: "0" },
    { ...ENV_A, H4_EVIDENCE_KEY_VERSION: "1.5" },
    { ...ENV_A, H4_EVIDENCE_KEY_VERSION: "" },
  ]) {
    assert.throws(() => evidenceKeyConfig(env), rejectCode("NOT_CONFIGURED"));
  }

  const same = evidenceKeyConfig(ENV_A);
  const otherKey = evidenceKeyConfig({ ...ENV_A, H4_EVIDENCE_HMAC_KEY_B64: KEY_B });
  const otherVersion = evidenceKeyConfig({ ...ENV_A, H4_EVIDENCE_KEY_VERSION: "2" });
  assert.equal(same.fingerprint, CONFIG.fingerprint);
  assert.notEqual(otherKey.fingerprint, CONFIG.fingerprint);
  assert.notEqual(otherVersion.fingerprint, CONFIG.fingerprint);
});

test("evidence/head/domain IDs are deterministic and the head is realm/org independent", () => {
  const expected = "h4c-evidence-v1:" + createHash("sha256")
    .update(stableStringify([ORG, JOB_ID, 1])).digest("hex").slice(0, 32);
  assert.equal(evidenceId(ORG, JOB_ID, 1), expected);
  assert.equal(evidenceId(ORG, JOB_ID, 1), evidenceId(ORG, JOB_ID, 1));
  assert.notEqual(evidenceId(ORG, JOB_ID, 1), evidenceId(ORG, JOB_ID, 2));
  assert.notEqual(evidenceId(ORG, JOB_ID, 1), evidenceId("org-other", JOB_ID, 1));
  assert.notEqual(evidenceId(ORG, JOB_ID, 1), evidenceId(ORG, "job-other", 1));
  assert.match(evidenceId(ORG, JOB_ID, 1), /^h4c-evidence-v1:[0-9a-f]{32}$/);

  assert.equal(evidenceHeadId(ORG, JOB_ID), evidenceHeadId(ORG, JOB_ID));
  assert.notEqual(evidenceHeadId(ORG, JOB_ID), evidenceHeadId(ORG, "job-other"));
  assert.match(evidenceHeadId(ORG, JOB_ID), /^h4c-evidence-head-v1:[0-9a-f]{32}$/);

  const ids = evidenceDomainIds("h4c-realm", 1);
  assert.equal(ids.headId, EVIDENCE_DOMAIN_HEAD_ID);
  assert.equal(ids.headId, "evidence-digest-domain:v1:global");
  assert.equal(ids.headId.includes("h4c-realm"), false);
  assert.equal(ids.headId.includes(ORG), false);
  assert.equal(ids.headId, evidenceDomainIds("another-realm", 7).headId);
  assert.equal(ids.headId, evidenceDomainIds("h4c-realm", 99).headId);
  assert.equal(ids.versionId, "evidence-digest-domain-version:" +
    Buffer.from("h4c-realm").toString("base64url") + ":1");
  assert.notEqual(ids.versionId, evidenceDomainIds("h4c-realm", 2).versionId);
  assert.notEqual(ids.versionId, evidenceDomainIds("another-realm", 1).versionId);
});

test("structured HMAC is canonical, sorted and binds every message field", () => {
  const record = makeEvidenceRecord();
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
  const expected = createHmac("sha256", CONFIG.key)
    .update(stableStringify(message)).digest("hex");
  assert.equal(record.digest, expected);
  assert.match(record.digest, /^[0-9a-f]{64}$/);

  const reordered = Object.fromEntries(Object.entries(record).reverse());
  assert.equal(evidenceDigest(reordered, CONFIG), record.digest);

  for (const change of [
    { decision: "confirmed_present", sourceCode: "OPERATOR_CONFIRMED_PRESENT" },
    { sequence: 2 },
    { observedAt: OBSERVED + 1 },
    { keyVersion: 2 },
    { previousEvidenceId: evidenceId(ORG, JOB_ID, 7) },
  ]) {
    assert.notEqual(evidenceDigest({ ...record, ...change }, CONFIG), record.digest);
  }
  const tamperedConfig = { ...CONFIG, fingerprint: "0".repeat(64) };
  assert.throws(() => evidenceDigest(record, tamperedConfig), rejectCode("NOT_CONFIGURED"));
});

test("evidence validator is exact and enforces schema, source and sequence rules", () => {
  const record = makeEvidenceRecord();
  assert.equal(validateEvidenceRecord(record), undefined);
  assert.equal(validateEvidenceRecord(makeEvidenceRecord({
    sequence: 9, decision: "confirmed_removed",
    sourceCode: SOURCE_CODES.confirmed_removed,
  })), undefined);

  const failures = [
    () => validateEvidenceRecord({ ...record, extra: true }),
    () => validateEvidenceRecord((({ _id, ...rest }) => rest)(record)),
    () => validateEvidenceRecord({ ...record, schemaVersion: 2 }),
    () => validateEvidenceRecord({ ...record, decision: "approved" }),
    () => validateEvidenceRecord({ ...record, sourceType: "mock_provider" }),
    () => validateEvidenceRecord({ ...record, sourceType: "device" }),
    () => validateEvidenceRecord({ ...record, sourceCode: "OPERATOR_UNCERTAIN" }),
    () => validateEvidenceRecord({ ...record, evidenceScope: "device_verified" }),
    () => validateEvidenceRecord({ ...record, sequence: 0 }),
    () => validateEvidenceRecord({ ...record, sequence: 10 }),
    () => validateEvidenceRecord({ ...record, sequence: 9 }),
    () => validateEvidenceRecord(makeEvidenceRecord({
      sequence: 9, decision: "still_unknown", sourceCode: SOURCE_CODES.still_unknown,
    })),
    () => validateEvidenceRecord({ ...record, previousEvidenceId: evidenceId(ORG, JOB_ID, 5) }),
    () => validateEvidenceRecord({ ...record, keyRealm: "UPPER" }),
    () => validateEvidenceRecord({ ...record, keyVersion: 0 }),
    () => validateEvidenceRecord({ ...record, keyFingerprint: "A".repeat(64) }),
    () => validateEvidenceRecord({ ...record, digest: "abc" }),
    () => validateEvidenceRecord({ ...record, observedAt: -1 }),
    () => validateEvidenceRecord({ ...record, createdAt: record.observedAt - 1 }),
    () => validateEvidenceRecord({ ...record, actorId: "bad actor" }),
    () => validateEvidenceRecord({ ...record, _id: evidenceId(ORG, JOB_ID, 2) }),
    () => validateEvidenceRecord(null),
    () => validateEvidenceRecord([]),
    () => validateEvidenceRecord(new (class Evidence {})()),
  ];
  for (const failure of failures) assert.throws(failure, rejectCode("EVIDENCE_INVALID"));
});

test("head validator is exact and enforces CAS fields", () => {
  const head = makeHead();
  assert.equal(validateEvidenceHead(head), undefined);
  assert.equal(validateEvidenceHead(makeHead({ lastSequence: 0 })), undefined);
  const failures = [
    () => validateEvidenceHead({ ...head, extra: true }),
    () => validateEvidenceHead((({ _id, ...rest }) => rest)(head)),
    () => validateEvidenceHead({ ...head, _id: evidenceHeadId(ORG, "job-other") }),
    () => validateEvidenceHead({ ...head, revision: 0 }),
    () => validateEvidenceHead({ ...head, lastSequence: 10 }),
    () => validateEvidenceHead({ ...head, lastEvidenceId: evidenceId(ORG, JOB_ID, 2) }),
    () => validateEvidenceHead({ ...makeHead({ lastSequence: 0 }), lastObservedAt: 1 }),
    () => validateEvidenceHead({ ...head, lastObservedAt: NOW + 1 }),
    () => validateEvidenceHead({ ...head, createdAt: NOW + 1 }),
    () => validateEvidenceHead({ ...head, updatedAt: head.createdAt - 1 }),
    () => validateEvidenceHead(null),
    () => validateEvidenceHead([]),
  ];
  for (const failure of failures) assert.throws(failure, rejectCode("EVIDENCE_INVALID"));
});

test("domain validator is exact for the stable head and frozen version records", () => {
  const { head, version } = makeDomainRecords();
  assert.equal(validateEvidenceDomainRecord(head), undefined);
  assert.equal(validateEvidenceDomainRecord(version), undefined);
  assert.equal(validateEvidenceDomainRecord({ ...head, realm: "another-realm" }), undefined,
    "the stable head ID does not encode the realm");
  const failures = [
    () => validateEvidenceDomainRecord({ ...head, extra: true }),
    () => validateEvidenceDomainRecord((({ _id, ...rest }) => rest)(head)),
    () => validateEvidenceDomainRecord({ ...head, kind: "version" }),
    () => validateEvidenceDomainRecord({ ...version, kind: "head" }),
    () => validateEvidenceDomainRecord({ ...head, kind: "other" }),
    () => validateEvidenceDomainRecord({ ...head, _id: "evidence-digest-domain:other" }),
    () => validateEvidenceDomainRecord({ ...head, realm: "UPPER" }),
    () => validateEvidenceDomainRecord({ ...head, keyVersion: 0 }),
    () => validateEvidenceDomainRecord({ ...head, keyFingerprint: "A".repeat(64) }),
    () => validateEvidenceDomainRecord({ ...head, revision: 0 }),
    () => validateEvidenceDomainRecord({ ...version, _id: evidenceDomainIds("another-realm", 1).versionId }),
    () => validateEvidenceDomainRecord({ ...version, enabledAt: -1 }),
    () => validateEvidenceDomainRecord(null),
    () => validateEvidenceDomainRecord([]),
  ];
  for (const failure of failures) assert.throws(failure, rejectCode("DOMAIN_INCOMPLETE"));
});

test("runtime domain guard never creates the K3 domain on empty state", () => {
  const state = domainState(CONFIG, null, null);
  const before = structuredClone(state);
  assert.throws(() => applyEvidenceDomain(state, CONFIG), rejectCode("DOMAIN_INCOMPLETE"));
  assert.deepEqual(state, before);
});

test("runtime domain guard rejects one-sided and corrupt domains without backfill", () => {
  const { head, version } = makeDomainRecords();
  const cases = [
    ["both missing", domainState(CONFIG, null, null)],
    ["head only", domainState(CONFIG, head, null)],
    ["version only", domainState(CONFIG, null, version)],
    ["head kind swapped", domainState(CONFIG, version, version)],
    ["version kind swapped", domainState(CONFIG, head, head)],
    ["head unknown field", domainState(CONFIG, { ...head, extra: 1 }, version)],
    ["version unknown field", domainState(CONFIG, head, { ...version, extra: 1 })],
    ["head missing field", domainState(CONFIG, (({ revision, ...rest }) => rest)(head), version)],
    ["version missing field", domainState(CONFIG, head,
      (({ enabledAt, ...rest }) => rest)(version))],
    ["head fingerprint corrupt", domainState(CONFIG, {
      ...head, keyFingerprint: "NOTHEX",
    }, version)],
    ["version kind corrupt", domainState(CONFIG, head, { ...version, kind: "other" })],
    ["version keyVersion corrupt", domainState(CONFIG, head, { ...version, keyVersion: 0 })],
    ["head revision corrupt", domainState(CONFIG, { ...head, revision: 0 }, version)],
    ["version fingerprint corrupt", domainState(CONFIG, head, {
      ...version, keyFingerprint: "0".repeat(64),
    })],
    ["version realm/id corrupt", domainState(CONFIG, head, {
      ...version, realm: "another-realm",
    })],
  ];
  for (const [name, state] of cases) {
    const before = structuredClone(state);
    assert.throws(() => applyEvidenceDomain(state, CONFIG),
      rejectCode("DOMAIN_INCOMPLETE"), name);
    assert.deepEqual(state, before, name);
  }
});

test("runtime domain guard fails closed on realm switch, version change and same-version rekey", () => {
  const records = makeDomainRecords(CONFIG);
  const complete = domainState(CONFIG, records.head, records.version);
  const before = structuredClone(complete);
  assert.deepEqual(applyEvidenceDomain(complete, CONFIG), []);
  assert.deepEqual(complete, before);

  const rekeyed = evidenceKeyConfig({ ...ENV_A, H4_EVIDENCE_HMAC_KEY_B64: KEY_B });
  assert.throws(() => applyEvidenceDomain(complete, rekeyed),
    rejectCode("DOMAIN_MISMATCH"));

  const versioned = evidenceKeyConfig({ ...ENV_A, H4_EVIDENCE_KEY_VERSION: "2" });
  assert.throws(() => applyEvidenceDomain(complete, versioned),
    rejectCode("DOMAIN_MISMATCH"));

  const otherRealm = evidenceKeyConfig({ ...ENV_A, H4_EVIDENCE_REALM: "h4c-realm-b" });
  assert.throws(() => applyEvidenceDomain(complete, otherRealm),
    rejectCode("DOMAIN_MISMATCH"));

  const stateV2 = domainState(versioned, records.head, null);
  assert.throws(() => applyEvidenceDomain(stateV2, versioned),
    rejectCode("DOMAIN_MISMATCH"), "stable head detects version change even without a v2 record");
  assert.throws(() => applyEvidenceDomain(domainState(CONFIG, records.head, null), CONFIG),
    rejectCode("DOMAIN_INCOMPLETE"), "same version missing record is damage");
  assert.throws(() => applyEvidenceDomain(domainState(CONFIG, {
    ...records.head, realm: "another-realm",
  }, records.version), CONFIG), rejectCode("DOMAIN_MISMATCH"),
  "a stable head bound to another realm is a config mismatch");
  assert.throws(() => applyEvidenceDomain(domainState(CONFIG, {
    ...records.head, keyVersion: 2,
  }, records.version), CONFIG), rejectCode("DOMAIN_MISMATCH"),
  "a stable head bound to another keyVersion is a config mismatch");
  assert.throws(() => applyEvidenceDomain(domainState(CONFIG, {
    ...records.head, keyFingerprint: "0".repeat(64),
  }, records.version), CONFIG), rejectCode("DOMAIN_MISMATCH"),
  "a stable head bound to another fingerprint is a config mismatch");
});

test("append fails closed on K3 rekey, realm/version change and one-sided domain", async (t) => {
  const store = await localStore(t);
  await seedDomain(store);

  const rekeyed = evidenceKeyConfig({ ...ENV_A, H4_EVIDENCE_HMAC_KEY_B64: KEY_B });
  await expectFailure(store, { config: rekeyed }, "DOMAIN_MISMATCH");
  const versioned = evidenceKeyConfig({ ...ENV_A, H4_EVIDENCE_KEY_VERSION: "2" });
  await expectFailure(store, { config: versioned }, "DOMAIN_MISMATCH");
  const otherRealm = evidenceKeyConfig({ ...ENV_A, H4_EVIDENCE_REALM: "h4c-realm-b" });
  await expectFailure(store, { config: otherRealm }, "DOMAIN_MISMATCH");

  const headOnly = makeDomainRecords().head;
  const orphanStore = await localStore(t);
  await insert(orphanStore, EVIDENCE_DOMAINS_COLLECTION, headOnly);
  await expectFailure(orphanStore, {}, "DOMAIN_INCOMPLETE");
  assert.equal(orphanStore.data[EVIDENCE_DOMAINS_COLLECTION].length, 1);
  assert.equal(orphanStore.data[EVIDENCE_DOMAINS_COLLECTION][0].kind, "head");
});

test("test fixture seeds the fixed global pair and runtime verification is read-only", async (t) => {
  const store = await localStore(t);
  const { head, version } = await seedDomain(store);
  assert.equal(head._id, EVIDENCE_DOMAIN_HEAD_ID);
  assert.equal(head._id, "evidence-digest-domain:v1:global");
  assert.equal(Object.hasOwn(head, "orgId"), false);
  assert.deepEqual(Object.keys(head).sort(), [
    "_id", "createdAt", "keyFingerprint", "keyVersion", "kind", "realm", "revision",
  ]);
  assert.deepEqual(Object.keys(version).sort(), [
    "_id", "enabledAt", "keyFingerprint", "keyVersion", "kind", "realm",
  ]);
  assert.equal(store.data[EVIDENCE_DOMAINS_COLLECTION].length, 2);
  assert.equal(store.data[EVIDENCE_COLLECTION].length, 0);
  assert.equal(store.data[EVIDENCE_HEADS_COLLECTION].length, 0);

  const before = structuredClone(store.data);
  const state = await domainStateFor(store);
  assert.deepEqual(applyEvidenceDomain(state, CONFIG), []);
  assert.deepEqual(applyEvidenceDomain(state, CONFIG), []);
  assert.deepEqual(store.data, before);

  // The Store stays create-only: the same fixed pair cannot be written twice
  // and the fixture never introduces an alternate pair.
  await assert.rejects(() => insert(store, EVIDENCE_DOMAINS_COLLECTION, head),
    (error) => error.status === 409);
  assert.deepEqual(store.data, before);
});

test("production module, public index and production tree expose no K3 initialization capability", async () => {
  const service = await import("../lib/face-service/index.mjs");
  const module = await import("../lib/face-service/h4c-evidence.mjs");

  // 1. Public runtime index: no initialize/bootstrap/create-domain export, by
  //    exact name and by name family.
  for (const name of ["initializeEvidenceDomain", "evidenceDomainInitPrecondition",
    "evidenceDomainInitRefs", "evidenceDomainInitWrites", "bootstrapEvidenceDomain",
    "createEvidenceDomain", "ensureEvidenceDomain"]) {
    assert.equal(Object.hasOwn(service, name), false, name);
    assert.equal(service[name], undefined, name);
  }
  for (const name of Object.keys(service)) {
    assert.doesNotMatch(name, /init|bootstrap|create.*domain/i, `index export ${name}`);
  }
  // The module itself also has no such export: C1 cannot initialize at all.
  for (const name of Object.keys(module)) {
    assert.doesNotMatch(name, /init|bootstrap|create.*domain/i, `module export ${name}`);
  }

  // 2. The two C1 sources contain no init token, mode switch or bypass proof.
  const moduleSource = await readFile(
    new URL("../lib/face-service/h4c-evidence.mjs", import.meta.url), "utf8");
  const indexSource = await readFile(
    new URL("../lib/face-service/index.mjs", import.meta.url), "utf8");
  const forbidden = [
    "initialize", "bootstrapEvidence", "evidenceDomainInit", "INIT_PRECONDITION",
    "DOMAIN_INIT_CONFLICT", "allowInitialize", "allowInitEvidence",
    'mode: "initialize"', 'mode === "initialize"', "createEvidenceDomain",
    "ensureEvidenceDomain", "emptyProof", "emptyBootstrap",
  ];
  for (const source of [moduleSource, indexSource]) {
    for (const token of forbidden) assert.equal(source.includes(token), false, token);
  }

  // 3. The runtime functions cannot emit a domain write: the guard only reads
  //    and returns [], append only writes evidence/head, and the module holds no
  //    Store handle / async transaction helper that could bootstrap a domain.
  const functionBody = (name) => {
    const start = moduleSource.indexOf(`export function ${name}(`);
    assert.ok(start >= 0, name);
    const end = moduleSource.indexOf("\nexport function ", start + 1);
    return moduleSource.slice(start, end < 0 ? moduleSource.length : end);
  };
  const guard = functionBody("applyEvidenceDomain");
  assert.equal(guard.includes("write("), false);
  assert.equal(guard.includes("transact("), false);
  assert.match(guard, /return \[\];/);
  const append = functionBody("appendEvidenceWrites");
  assert.equal(append.includes("write(EVIDENCE_DOMAINS_COLLECTION"), false);
  assert.equal(append.includes("applyEvidenceDomain(state, cfg)"), true);
  assert.equal(moduleSource.includes("transact("), false);
  assert.equal(/export\s+async\s+function/.test(moduleSource), false);

  // 4. Search the whole production tree (admin-web minus tests/node_modules),
  //    not just the two files above: no caller can reach an init/bootstrap/
  //    create-domain helper or a mode: "initialize" branch.
  const adminRoot = fileURLToPath(new URL("..", import.meta.url));
  const entries = await readdir(adminRoot, { recursive: true });
  const files = entries
    .filter((name) => typeof name === "string" && /\.(?:mjs|cjs|js)$/.test(name))
    .filter((name) => !/(^|[\\/])(?:tests|node_modules)([\\/]|$)/.test(name));
  assert.ok(files.length >= 30, `production tree unexpectedly small: ${files.length}`);
  assert.ok(files.some((name) => /face-service[\\/]h4c-evidence\.mjs$/.test(name)),
    "C1 evidence module must be inside the scanned production tree");
  const treeTokens = [
    "initializeEvidenceDomain", "bootstrapEvidenceDomain", "bootstrapEvidence",
    "evidenceDomainInit", "INIT_PRECONDITION", "DOMAIN_INIT_CONFLICT",
    "allowInitialize", "allowInitEvidence", 'mode: "initialize"',
    'mode === "initialize"', "createEvidenceDomain", "ensureEvidenceDomain",
  ];
  let scanned = 0;
  for (const name of files) {
    const text = await readFile(join(adminRoot, name), "utf8");
    scanned += 1;
    for (const token of treeTokens) {
      assert.equal(text.includes(token), false, `${name}: ${token}`);
    }
  }
  assert.equal(scanned, files.length);
});

test("constant-time digest comparison validates canonical hex before timingSafeEqual", async () => {
  const source = await readFile(
    new URL("../lib/face-service/h4c-evidence.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function constantTimeHexEqual");
  assert.ok(start >= 0);
  const end = source.indexOf("\n}", start);
  assert.ok(end > start);
  const body = source.slice(start, end + 2);
  const formatCheck = body.indexOf("if (!hex(left) || !hex(right)) return false;");
  const timing = body.indexOf("timingSafeEqual(");
  assert.ok(formatCheck >= 0, "format check is required");
  assert.ok(timing > formatCheck, "timingSafeEqual must follow the format check");
  assert.match(body, /Buffer\.from\(left, "hex"\)/);
  assert.match(body, /Buffer\.from\(right, "hex"\)/);
  // Both canonical 64-hex inputs decode to exactly 32 bytes, so the
  // timingSafeEqual operands are guaranteed equal-length.
  assert.equal(Buffer.from("0".repeat(64), "hex").length, 32);
});

test("both-missing after existing evidence or evidence head fails closed with every collection unchanged", async (t) => {
  for (const keep of ["evidence", "evidence-head"]) {
    const store = await localStore(t);
    await seedDomain(store);
    await runAppend(store, { decision: "confirmed_removed" });
    store.data[EVIDENCE_DOMAINS_COLLECTION] = [];
    if (keep === "evidence") store.data[EVIDENCE_HEADS_COLLECTION] = [];
    else store.data[EVIDENCE_COLLECTION] = [];
    const before = structuredClone(store.data);
    await expectFailure(store, {}, "DOMAIN_INCOMPLETE");
    assert.deepEqual(store.data, before, keep);
    assert.equal(store.data[EVIDENCE_DOMAINS_COLLECTION].length, 0, keep);
    assert.equal(store.data[EVIDENCE_COLLECTION].length,
      keep === "evidence" ? 1 : 0, keep);
    assert.equal(store.data[EVIDENCE_HEADS_COLLECTION].length,
      keep === "evidence-head" ? 1 : 0, keep);
  }
});

test("append on an empty store never initializes the domain implicitly", async (t) => {
  const store = await localStore(t);
  await expectFailure(store, {}, "DOMAIN_INCOMPLETE");
  assert.deepEqual(store.data[EVIDENCE_DOMAINS_COLLECTION], []);
  assert.deepEqual(store.data[EVIDENCE_COLLECTION], []);
  assert.deepEqual(store.data[EVIDENCE_HEADS_COLLECTION], []);
});

test("runtime rejects both-missing, head-only, version-only and evidence-only states with zero writes", async (t) => {
  const domain = makeDomainRecords();
  const cases = [
    ["empty", null, null, null],
    ["evidence only", EVIDENCE_COLLECTION, makeEvidenceRecord(), null],
    ["evidence head only", EVIDENCE_HEADS_COLLECTION, makeHead(), null],
    ["domain head only", EVIDENCE_DOMAINS_COLLECTION, domain.head, null],
    ["domain version only", EVIDENCE_DOMAINS_COLLECTION, domain.version, null],
  ];
  for (const [name, collection, record] of cases) {
    const store = await localStore(t);
    if (collection !== null) await insert(store, collection, record);
    const before = structuredClone(store.data);
    await expectFailure(store, {}, "DOMAIN_INCOMPLETE");
    assert.deepEqual(store.data, before, name);
    assert.equal(store.data[EVIDENCE_COLLECTION].length,
      collection === EVIDENCE_COLLECTION ? 1 : 0, name);
    assert.equal(store.data[EVIDENCE_HEADS_COLLECTION].length,
      collection === EVIDENCE_HEADS_COLLECTION ? 1 : 0, name);
    assert.equal(store.data[EVIDENCE_DOMAINS_COLLECTION].length,
      collection === EVIDENCE_DOMAINS_COLLECTION ? 1 : 0, name);
  }
});

test("first evidence appends anchor+evidence+head after a fixed fixture seed", async (t) => {
  const store = await localStore(t);
  await seedDomain(store);
  let built = null;
  await runAppend(store, {
    onBuild: (writes, refs) => { built = { writes, refs }; },
  });
  assert.equal(built.writes.length, 3);
  assert.deepEqual(built.writes.map((write) => write.collection), [
    H4C.anchors, EVIDENCE_COLLECTION, EVIDENCE_HEADS_COLLECTION,
  ]);
  assert.ok(built.writes.every((write) => write.collection !== EVIDENCE_DOMAINS_COLLECTION));
  for (const write of built.writes) {
    assert.ok(built.refs.some((item) => item.collection === write.collection && item.id === write.id),
      `undeclared write ${write.collection}/${write.id}`);
  }

  assert.equal(store.data[EVIDENCE_DOMAINS_COLLECTION].length, 2);
  assert.equal(store.data[EVIDENCE_COLLECTION].length, 1);
  assert.equal(store.data[EVIDENCE_HEADS_COLLECTION].length, 1);
  assert.equal(store.data[H4C.anchors].length, 1);
  assert.deepEqual(store.data.device_operation_logs, []);

  const [anchor] = store.data[H4C.anchors];
  assert.equal(validateEvidenceAnchorRecord(anchor), undefined);
  assert.equal(anchor._id, evidenceAnchorId(ORG, JOB_ID));
  assert.equal(anchor.firstEvidenceId, evidenceId(ORG, JOB_ID, 1));
  assert.equal(anchor.schemaVersion, EVIDENCE_SCHEMA_VERSION);
  assert.equal(anchor.createdAt, NOW);
  assert.equal(Object.hasOwn(anchor, "updatedAt"), false);
  assert.deepEqual(Object.keys(anchor).sort(), [
    "_id", "createdAt", "firstEvidenceId", "jobId", "orgId", "schemaVersion",
  ]);

  const [evidence] = store.data[EVIDENCE_COLLECTION];
  assert.equal(validateEvidenceRecord(evidence), undefined);
  assert.equal(evidence._id, evidenceId(ORG, JOB_ID, 1));
  assert.equal(evidence.sequence, 1);
  assert.equal(evidence.previousEvidenceId, null);
  assert.equal(evidence.sourceType, "operator");
  assert.equal(evidence.evidenceScope, "simulated");
  assert.equal(evidence.digest, evidenceDigest(evidence, CONFIG));
  assert.equal(Object.hasOwn(evidence, "updatedAt"), false);
  assert.deepEqual(Object.keys(evidence).sort(), [
    "_id", "actorId", "createdAt", "decision", "digest", "digestAlgorithm",
    "digestAlgorithmVersion", "digestDomain", "evidenceScope", "jobId", "keyFingerprint",
    "keyRealm", "keyVersion", "observedAt", "orgId", "previousEvidenceId", "schemaVersion",
    "sequence", "sourceCode", "sourceType",
  ]);

  const [head] = store.data[EVIDENCE_HEADS_COLLECTION];
  assert.equal(validateEvidenceHead(head), undefined);
  assert.equal(head._id, evidenceHeadId(ORG, JOB_ID));
  assert.equal(head.revision, 1);
  assert.equal(head.lastSequence, 1);
  assert.equal(head.lastEvidenceId, evidence._id);
  assert.equal(head.lastObservedAt, OBSERVED);
  assert.equal(head.createdAt, NOW);
  assert.equal(head.updatedAt, NOW);

  for (const record of store.data[EVIDENCE_DOMAINS_COLLECTION]) {
    assert.equal(validateEvidenceDomainRecord(record), undefined);
  }

  const refs = evidenceAppendRefs({
    job: JOB, expectedHead: null, proofId: PROOF_ID,
    writeEpoch: WRITE_EPOCH, auditId: AUDIT_ID, config: CONFIG,
  });
  assert.equal(refs.length, 18);
  const expectedRefs = new Set([
    `${EVIDENCE_DOMAINS_COLLECTION}/${EVIDENCE_DOMAIN_HEAD_ID}`,
    `${EVIDENCE_DOMAINS_COLLECTION}/${evidenceDomainIds(CONFIG.realm, CONFIG.version).versionId}`,
    `${H4C.auditProofs}/${PROOF_ID}`,
    `${H4C_AUDIT_COLLECTION}/${AUDIT_ID}`,
    `${H4C.fences}/${EVIDENCE_CHAIN_FENCE_ID}`,
    `${H4C.k3Markers}/${EVIDENCE_CHAIN_K3_MARKER_ID}`,
    `${H4C.plans}/${writerPlanId(WRITE_EPOCH)}`,
    `${H4C.anchors}/${evidenceAnchorId(ORG, JOB_ID)}`,
    `${H4C.evidenceHeads}/${evidenceHeadId(ORG, JOB_ID)}`,
    ...Array.from({ length: 9 }, (_, index) =>
      `${EVIDENCE_COLLECTION}/${evidenceId(ORG, JOB_ID, index + 1)}`),
  ]);
  assert.deepEqual(new Set(refs.map((item) => `${item.collection}/${item.id}`)), expectedRefs);
  assert.equal(refs.filter((item) => item.collection === H4C.auditProofs).length, 1);

  const audit = store.data.admin_audit;
  // Two audits from the domain fixture seed; S2 helper deliberately writes no audit.
  assert.equal(audit.length, 2);
  for (const entry of audit) {
    assert.deepEqual(Object.keys(entry).sort(), [
      "_id", "action", "actorId", "actorType", "createdAt", "orgId", "target",
    ]);
  }
});

test("second evidence validates its parent and CAS-increments the head", async (t) => {
  const store = await localStore(t);
  await seedDomain(store);
  await runAppend(store, { decision: "still_unknown" });
  const firstHead = structuredClone(store.data[EVIDENCE_HEADS_COLLECTION][0]);
  const firstEvidence = structuredClone(store.data[EVIDENCE_COLLECTION][0]);

  let built = null;
  await runAppend(store, {
    decision: "confirmed_present",
    observedAt: OBSERVED + 100,
    now: NOW + 1_000,
    onBuild: (writes, refs) => { built = { writes, refs }; },
  });
  assert.equal(built.writes.length, 2);
  for (const write of built.writes) {
    assert.ok(built.refs.some((item) => item.collection === write.collection && item.id === write.id),
      `undeclared write ${write.collection}/${write.id}`);
  }

  assert.equal(store.data[EVIDENCE_COLLECTION].length, 2);
  const second = store.data[EVIDENCE_COLLECTION][1];
  assert.equal(validateEvidenceRecord(second), undefined);
  assert.equal(second.sequence, 2);
  assert.equal(second.previousEvidenceId, firstEvidence._id);
  assert.equal(second.digest, evidenceDigest(second, CONFIG));
  assert.equal(store.data[EVIDENCE_HEADS_COLLECTION].length, 1);
  assert.equal(store.data[H4C.anchors].length, 1);
  const head = store.data[EVIDENCE_HEADS_COLLECTION][0];
  assert.equal(head.revision, 2);
  assert.equal(head.lastSequence, 2);
  assert.equal(head.lastEvidenceId, second._id);
  assert.equal(head.lastObservedAt, OBSERVED + 100);
  assert.equal(head.createdAt, firstHead.createdAt);
  assert.equal(head.updatedAt, NOW + 1_000);

  const refs = evidenceAppendRefs({
    job: JOB, expectedHead: firstHead, proofId: PROOF_ID,
    writeEpoch: WRITE_EPOCH, auditId: AUDIT_ID, config: CONFIG,
  });
  assert.equal(refs.length, 18);
  assert.ok(refs.some((item) => item.collection === H4C.auditProofs && item.id === PROOF_ID));
  assert.ok(refs.some((item) => item.collection === H4C.anchors &&
    item.id === evidenceAnchorId(ORG, JOB_ID)));
  assert.ok(refs.some((item) => item.collection === EVIDENCE_COLLECTION &&
    item.id === firstEvidence._id));
  assert.ok(refs.some((item) => item.collection === EVIDENCE_COLLECTION &&
    item.id === second._id));
});

test("stale head CAS and missing/orphan head fail closed with zero writes", async (t) => {
  const store = await localStore(t);
  await seedDomain(store);
  await runAppend(store);
  const firstHead = structuredClone(store.data[EVIDENCE_HEADS_COLLECTION][0]);
  await runAppend(store, { observedAt: OBSERVED + 100, now: NOW + 1_000 });
  const settled = structuredClone(store.data);

  await expectFailure(store, { expectedHead: firstHead }, "EVIDENCE_HEAD_CONFLICT");
  await expectFailure(store, { expectedHead: null }, "EVIDENCE_CHAIN_BROKEN");

  store.data = structuredClone(settled);
  store.data[EVIDENCE_HEADS_COLLECTION] = [];
  await expectFailure(store, {}, "EVIDENCE_CHAIN_BROKEN");

  store.data = structuredClone(settled);
  store.data[EVIDENCE_HEADS_COLLECTION][0].revision = 0;
  await expectFailure(store, {}, "EVIDENCE_CHAIN_BROKEN");

  store.data = structuredClone(settled);
  store.data[EVIDENCE_HEADS_COLLECTION][0].lastEvidenceId = evidenceId(ORG, JOB_ID, 9);
  await expectFailure(store, {}, "EVIDENCE_CHAIN_BROKEN");

  store.data = structuredClone(settled);
  store.data[EVIDENCE_HEADS_COLLECTION][0].lastSequence = 9;
  await expectFailure(store, {}, "EVIDENCE_CHAIN_BROKEN");
});

test("concurrent appends on the same head have one winner and no fork", async (t) => {
  const store = await localStore(t);
  await seedDomain(store);
  await runAppend(store);
  const head = structuredClone(store.data[EVIDENCE_HEADS_COLLECTION][0]);
  const options = {
    decision: "confirmed_present",
    observedAt: OBSERVED + 100,
    now: NOW + 1_000,
    expectedHead: head,
  };
  const results = await Promise.allSettled([
    runAppend(store, options),
    runAppend(store, options),
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "EVIDENCE_HEAD_CONFLICT");

  assert.equal(store.data[EVIDENCE_COLLECTION].length, 2);
  assert.deepEqual(store.data[EVIDENCE_COLLECTION].map((row) => row.sequence).sort(), [1, 2]);
  assert.equal(store.data[EVIDENCE_HEADS_COLLECTION].length, 1);
  assert.equal(store.data[EVIDENCE_HEADS_COLLECTION][0].revision, 2);
  assert.equal(store.data[EVIDENCE_HEADS_COLLECTION][0].lastSequence, 2);
});

test("damaged previous evidence is chain-broken across schema, identity, org/job, time, K3 and HMAC", async (t) => {
  const store = await localStore(t);
  await seedDomain(store);
  await runAppend(store, { decision: "confirmed_removed" });
  const baseline = structuredClone(store.data);
  const evidenceKey = `${EVIDENCE_COLLECTION}/${baseline[EVIDENCE_COLLECTION][0]._id}`;

  const cases = [
    ["missing digest", (record) => { delete record.digest; }],
    ["unknown field", (record) => { record.rawResponse = "forbidden"; }],
    ["schemaVersion", (record) => { record.schemaVersion = 2; }],
    ["_id", (record) => { record._id = evidenceId(ORG, JOB_ID, 9); }],
    ["org", (record) => { record.orgId = "org-other"; }],
    ["job", (record) => { record.jobId = "job-other"; }],
    ["sequence", (record) => {
      record.sequence = 2;
      record._id = evidenceId(ORG, JOB_ID, 2);
      record.previousEvidenceId = evidenceId(ORG, JOB_ID, 1);
      record.digest = evidenceDigest(record, CONFIG);
    }],
    ["observedAt vs head", (record) => {
      record.observedAt += 1;
      record.createdAt = record.observedAt;
      record.digest = evidenceDigest(record, CONFIG);
    }],
    ["k3 realm", (record) => {
      record.keyRealm = "other-realm";
      record.digest = evidenceDigest(record, CONFIG);
    }],
    ["k3 version", (record) => {
      record.keyVersion = 2;
      record.digest = evidenceDigest(record, CONFIG);
    }],
    ["k3 fingerprint", (record) => { record.keyFingerprint = "0".repeat(64); }],
    ["hmac digest", (record) => {
      record.digest = (record.digest[0] === "0" ? "1" : "0") + record.digest.slice(1);
    }],
    ["digest length", (record) => { record.digest = "0".repeat(63); }],
    ["digest uppercase", (record) => { record.digest = record.digest.toUpperCase(); }],
    ["sourceType", (record) => { record.sourceType = "mock_provider"; }],
    ["evidenceScope", (record) => { record.evidenceScope = "device_verified"; }],
    ["previousEvidenceId", (record) => {
      record.previousEvidenceId = evidenceId(ORG, JOB_ID, 5);
    }],
    ["createdAt", (record) => { record.createdAt = record.observedAt - 1; }],
    ["digestAlgorithm", (record) => { record.digestAlgorithm = "SHA-256"; }],
  ];
  for (const [name, mutate] of cases) {
    store.data = structuredClone(baseline);
    mutate(store.data[EVIDENCE_COLLECTION][0]);
    await expectFailure(store, {}, "EVIDENCE_CHAIN_BROKEN");
    assert.ok(Object.hasOwn(store.data[EVIDENCE_COLLECTION][0], "_id"), name);
    assert.equal(store.data[EVIDENCE_COLLECTION].length, 1, name);
  }

  store.data = structuredClone(baseline);
  delete store.data[EVIDENCE_COLLECTION];
  await expectFailure(store, {}, "EVIDENCE_CHAIN_BROKEN");
  assert.equal(store.data[EVIDENCE_COLLECTION], undefined);
  assert.ok(evidenceKey.startsWith(`${EVIDENCE_COLLECTION}/`));
});

test("damaged head variants are chain-broken without repair", async (t) => {
  const store = await localStore(t);
  await seedDomain(store);
  await runAppend(store, { decision: "confirmed_removed" });
  const baseline = structuredClone(store.data);

  const cases = [
    ["extra field", (head) => { head.extra = 1; }],
    ["revision zero", (head) => { head.revision = 0; }],
    ["lastEvidenceId missing target", (head) => { head.lastEvidenceId = evidenceId(ORG, JOB_ID, 9); }],
    ["lastSequence with wrong evidence", (head) => {
      head.lastSequence = 2;
      head.lastEvidenceId = evidenceId(ORG, JOB_ID, 1);
    }],
    ["lastObservedAt vs previous", (head) => { head.lastObservedAt += 1; }],
    ["updatedAt before createdAt", (head) => { head.updatedAt = head.createdAt - 1; }],
    ["org mismatch", (head) => { head.orgId = "org-other"; }],
  ];
  for (const [name, mutate] of cases) {
    store.data = structuredClone(baseline);
    mutate(store.data[EVIDENCE_HEADS_COLLECTION][0]);
    await expectFailure(store, {}, "EVIDENCE_CHAIN_BROKEN");
    assert.equal(store.data[EVIDENCE_COLLECTION].length, 1, name);
  }
});

test("observedAt bounds, monotonicity and invalid clock fail closed", async (t) => {
  const store = await localStore(t);
  await seedDomain(store);
  await expectFailure(store, { observedAt: JOB.createdAt - 1 }, "EVIDENCE_STALE");
  await expectFailure(store, { observedAt: NOW + 1 }, "EVIDENCE_STALE");
  await expectFailure(store, { observedAt: "3000" }, "EVIDENCE_STALE");
  await expectFailure(store, { now: 1.5, observedAt: OBSERVED }, "EVIDENCE_INVALID");
  assertNoBusinessWrites(store);
  assert.equal(store.data[EVIDENCE_DOMAINS_COLLECTION].length, 2);

  await runAppend(store);
  await expectFailure(store, { observedAt: OBSERVED - 1, now: NOW + 1_000 }, "EVIDENCE_STALE");
  await expectFailure(store, { observedAt: NOW + 1, now: NOW }, "EVIDENCE_STALE");
  await expectFailure(store, { observedAt: JOB.result.finishedAt - 1, now: NOW + 1_000 },
    "EVIDENCE_STALE");
});

test("S2 refs are exactly 18, stable, unique and reject a missing proof ref", () => {
  const args = {
    job: JOB, expectedHead: null, proofId: PROOF_ID,
    writeEpoch: WRITE_EPOCH, auditId: AUDIT_ID, config: CONFIG,
  };
  const refs = evidenceAppendRefs(args);
  assert.equal(refs.length, 18);
  assert.equal(new Set(refs.map((item) => `${item.collection}/${item.id}`)).size, 18);
  assert.deepEqual(evidenceAppendRefs(args), refs);
  const proofRefs = refs.filter((item) => item.collection === H4C.auditProofs);
  assert.equal(proofRefs.length, 1);
  assert.equal(proofRefs[0].id, PROOF_ID);
  assert.equal(assertC1AppendRefs(refs), refs);
  assert.throws(() => assertC1AppendRefs(refs.slice(0, 17)),
    rejectCode("EVIDENCE_CHAIN_ADMISSION_REQUIRED"));
  assert.throws(() => assertC1AppendRefs(refs.filter(
    (item) => item.collection !== H4C.auditProofs)),
  rejectCode("EVIDENCE_CHAIN_ADMISSION_REQUIRED"));
  // 17 refs cannot be produced: the exact-length invariant is enforced, and a
  // missing proof id is rejected instead of silently dropped.
  assert.throws(() => evidenceAppendRefs({ ...args, proofId: undefined }),
    rejectCode("EVIDENCE_CHAIN_PROOF_REQUIRED"));
  assert.throws(() => evidenceAppendRefs({ ...args, proofId: "" }),
    rejectCode("EVIDENCE_CHAIN_PROOF_REQUIRED"));
  assert.throws(() => evidenceAppendRefs({ ...args, writeEpoch: 0 }),
    rejectCode("EVIDENCE_INVALID"));
});

test("S2 genesis returns anchor+E1+head only and leaves state untouched", () => {
  const state = s2State();
  const before = structuredClone(state);
  const writes = appendEvidenceWrites(state, appendArgs());
  assert.equal(writes.length, 3);
  assert.deepEqual(writes.map((item) => item.collection), [
    H4C.anchors, EVIDENCE_COLLECTION, EVIDENCE_HEADS_COLLECTION,
  ]);
  assert.equal(writes.some((item) => item.collection === EVIDENCE_DOMAINS_COLLECTION ||
    item.collection === H4C_AUDIT_COLLECTION), false);
  assert.equal(validateEvidenceAnchorRecord(writes[0].data), undefined);
  assert.equal(validateEvidenceRecord(writes[1].data), undefined);
  assert.equal(validateEvidenceHead(writes[2].data), undefined);
  assert.equal(writes[0].data.firstEvidenceId, evidenceId(ORG, JOB_ID, 1));
  assert.deepEqual(state, before);
});

test("S2 append returns E+head only and leaves anchor/state untouched", () => {
  const chain = chainFor(2);
  const state = s2State(chain);
  const before = structuredClone(state);
  const writes = appendEvidenceWrites(state, appendArgs({
    expectedHead: chain.head,
    decision: "confirmed_present",
    observedAt: OBSERVED + 10,
  }));
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map((item) => item.collection), [
    EVIDENCE_COLLECTION, EVIDENCE_HEADS_COLLECTION,
  ]);
  assert.equal(writes.some((item) => item.collection === H4C.anchors), false);
  assert.equal(validateEvidenceRecord(writes[0].data), undefined);
  assert.equal(validateEvidenceHead(writes[1].data), undefined);
  assert.deepEqual(state, before);
});

test("S2 empty-chain genesis rejects E1..E9 residuals, an anchor or an expected head", () => {
  const cases = [
    ["E1", { evidence: chainFor(1).evidence }],
    ["E2", { evidence: chainFor(2).evidence }],
    ["E9", { evidence: chainFor(9).evidence }],
    ["anchor", { anchor: makeAnchor() }],
  ];
  for (const [name, fixture] of cases) {
    const state = s2State(fixture);
    const before = structuredClone(state);
    assert.throws(() => appendEvidenceWrites(state, appendArgs()),
      rejectCode("EVIDENCE_CHAIN_BROKEN"), name);
    assert.deepEqual(state, before, name);
  }
  const state = s2State();
  const before = structuredClone(state);
  assert.throws(() => appendEvidenceWrites(state, appendArgs({ expectedHead: makeHead() })),
    rejectCode("EVIDENCE_CHAIN_BROKEN"));
  assert.deepEqual(state, before);
});

test("S2 damaged anchor is chain-broken without repair", () => {
  const chain = chainFor(1);
  const cases = [
    ["extra field", (anchor) => { anchor.extra = 1; }],
    ["_id", (anchor) => { anchor._id = `${EVIDENCE_CHAIN_ANCHOR_PREFIX}other`; }],
    ["firstEvidenceId", (anchor) => { anchor.firstEvidenceId = evidenceId(ORG, JOB_ID, 2); }],
    ["orgId", (anchor) => { anchor.orgId = "org-other"; }],
    ["jobId", (anchor) => { anchor.jobId = "job-other"; }],
    ["schemaVersion", (anchor) => { anchor.schemaVersion = 2; }],
    ["missing createdAt", (anchor) => { delete anchor.createdAt; }],
  ];
  for (const [name, mutate] of cases) {
    const anchor = structuredClone(chain.anchor);
    mutate(anchor);
    const state = s2State({ ...chain, anchor });
    const before = structuredClone(state);
    assert.throws(() => appendEvidenceWrites(state, appendArgs({ expectedHead: chain.head })),
      rejectCode("EVIDENCE_CHAIN_BROKEN"), name);
    assert.deepEqual(state, before, name);
  }
});

test("S2 complete chain bounds reject N+1 target reservation and later residuals", () => {
  const chain = chainFor(2);
  const e3 = makeEvidenceRecord({ sequence: 3, observedAt: OBSERVED + 3 });
  let state = s2State({ ...chain, evidence: [...chain.evidence, e3] });
  let before = structuredClone(state);
  assert.throws(() => appendEvidenceWrites(state, appendArgs({
    expectedHead: chain.head, observedAt: OBSERVED + 10,
  })), rejectCode("CONFLICT"));
  assert.deepEqual(state, before);

  const e4 = makeEvidenceRecord({ sequence: 4, observedAt: OBSERVED + 4 });
  state = s2State({ ...chain, evidence: [...chain.evidence, undefined, e4] });
  before = structuredClone(state);
  assert.throws(() => appendEvidenceWrites(state, appendArgs({
    expectedHead: chain.head, observedAt: OBSERVED + 10,
  })), rejectCode("EVIDENCE_CHAIN_BROKEN"));
  assert.deepEqual(state, before);

  const chain2 = chainFor(2);
  const missingE1 = s2State({
    anchor: chain2.anchor,
    head: chain2.head,
    evidence: [null, chain2.evidence[1]],
  });
  const missingBefore = structuredClone(missingE1);
  assert.throws(() => appendEvidenceWrites(missingE1, appendArgs({
    expectedHead: chain2.head, observedAt: OBSERVED + 10,
  })), rejectCode("EVIDENCE_CHAIN_BROKEN"));
  assert.deepEqual(missingE1, missingBefore);

  const chain9 = chainFor(9);
  assert.throws(() => appendEvidenceWrites(s2State(chain9), appendArgs({
    expectedHead: chain9.head, observedAt: OBSERVED + 10,
  })), rejectCode("EVIDENCE_INVALID"));

  const chain8 = chainFor(8, { decision: "still_unknown" });
  const state8 = s2State(chain8);
  assert.equal(state8[`${H4C.evidence}/${evidenceId(ORG, JOB_ID, 9)}`], null);
  assert.throws(() => appendEvidenceWrites(state8, appendArgs({
    expectedHead: chain8.head, decision: "still_unknown", observedAt: OBSERVED + 10,
  })), rejectCode("EVIDENCE_INVALID"));
});

test("S2 observedAt equality is allowed and decreasing/out-of-bounds is stale", () => {
  const chain = chainFor(1);
  const previous = chain.evidence[0];
  const equalState = s2State(chain);
  const equalWrites = appendEvidenceWrites(equalState, appendArgs({
    expectedHead: chain.head,
    decision: "confirmed_present",
    observedAt: previous.observedAt,
  }));
  assert.equal(equalWrites.length, 2);

  const decreasing = s2State(chain);
  const before = structuredClone(decreasing);
  assert.throws(() => appendEvidenceWrites(decreasing, appendArgs({
    expectedHead: chain.head,
    decision: "confirmed_present",
    observedAt: previous.observedAt - 1,
  })), rejectCode("EVIDENCE_STALE"));
  assert.deepEqual(decreasing, before);

  assert.throws(() => appendEvidenceWrites(s2State(chain), appendArgs({
    expectedHead: chain.head, decision: "confirmed_present", observedAt: NOW + 1,
  })), rejectCode("EVIDENCE_STALE"));
  assert.throws(() => appendEvidenceWrites(s2State(chain), appendArgs({
    expectedHead: chain.head, decision: "confirmed_present", observedAt: JOB.createdAt - 1,
  })), rejectCode("EVIDENCE_STALE"));
});

test("S2 proof ref target is required and epoch/writer-plan bound", () => {
  const cases = [
    ["missing", null],
    ["wrong epoch", { ...PROOF, writeEpoch: WRITE_EPOCH + 1 }],
    ["wrong plan", { ...PROOF, writerPlanId: writerPlanId(WRITE_EPOCH + 1) }],
  ];
  for (const [name, proof] of cases) {
    const state = s2State({ proof });
    const before = structuredClone(state);
    assert.throws(() => appendEvidenceWrites(state, appendArgs()),
      rejectCode("EVIDENCE_CHAIN_PROOF_REQUIRED"), name);
    assert.deepEqual(state, before, name);
  }
});

test("S2 expectedHead CAS: stale is head-conflict and deleted head is broken", () => {
  const chain = chainFor(1);
  const state = s2State(chain);
  const before = structuredClone(state);
  assert.throws(() => appendEvidenceWrites(state, appendArgs({
    expectedHead: { ...chain.head, revision: 0 },
  })), rejectCode("EVIDENCE_HEAD_CONFLICT"));
  assert.deepEqual(state, before);

  const deleted = s2State({ anchor: chain.anchor, evidence: chain.evidence, head: null });
  const deletedBefore = structuredClone(deleted);
  assert.throws(() => appendEvidenceWrites(deleted, appendArgs({
    expectedHead: chain.head,
  })), rejectCode("EVIDENCE_CHAIN_BROKEN"));
  assert.throws(() => appendEvidenceWrites(deleted, appendArgs({ expectedHead: null })),
    rejectCode("EVIDENCE_CHAIN_BROKEN"));
  assert.deepEqual(deleted, deletedBefore);
});

test("S2 helper concurrency: one CAS loser and no half writes", () => {
  const chain = chainFor(1);
  const state = s2State(chain);
  const first = appendEvidenceWrites(state, appendArgs({
    expectedHead: chain.head,
    decision: "confirmed_present",
    observedAt: chain.evidence[0].observedAt + 1,
  }));
  assert.equal(first.length, 2);
  applyStateWrites(state, first);
  const settled = structuredClone(state);
  assert.throws(() => appendEvidenceWrites(state, appendArgs({
    expectedHead: chain.head,
    decision: "confirmed_present",
    observedAt: chain.evidence[0].observedAt + 2,
  })), rejectCode("EVIDENCE_HEAD_CONFLICT"));
  assert.deepEqual(state, settled);

  const genesis = s2State();
  applyStateWrites(genesis, appendEvidenceWrites(genesis, appendArgs()));
  const genesisSettled = structuredClone(genesis);
  assert.throws(() => appendEvidenceWrites(genesis, appendArgs({ expectedHead: null })),
    rejectCode("EVIDENCE_CHAIN_BROKEN"));
  assert.deepEqual(genesis, genesisSettled);
});

test("decision/source binding and job invariants reject before writing", async (t) => {
  const store = await localStore(t);
  await seedDomain(store);
  for (const options of [
    { decision: "approved" },
    { decision: "still_unknown", sourceType: "mock_provider" },
    { decision: "still_unknown", sourceType: "device" },
    { decision: "still_unknown", sourceCode: "OPERATOR_CONFIRMED_REMOVED" },
    { decision: "confirmed_removed", sourceCode: "OPERATOR_UNCERTAIN" },
    { job: { ...JOB, result: null } },
    { job: { ...JOB, orgId: " " } },
    { job: { ...JOB, createdAt: -1 } },
  ]) {
    await expectFailure(store, options, "EVIDENCE_INVALID");
  }
  store.data[H4C.auditProofs] = [];
  await expectFailure(store, {}, "EVIDENCE_CHAIN_PROOF_REQUIRED");
  assertNoBusinessWrites(store);
  assert.equal(store.data[EVIDENCE_DOMAINS_COLLECTION].length, 2);
});

test("LocalStore registers the three collections and upgrades old local data", async (t) => {
  for (const name of [EVIDENCE_COLLECTION, EVIDENCE_HEADS_COLLECTION, EVIDENCE_DOMAINS_COLLECTION]) {
    assert.deepEqual(seed()[name], []);
  }
  const directory = await mkdtemp(join(tmpdir(), "smartpm-h4c-legacy-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "demo-data.json"), JSON.stringify({
    houses: [{ _id: "legacy-house" }],
    admin_audit: [],
  }));
  const store = await new LocalStore(directory).init();
  assert.deepEqual(store.data[EVIDENCE_COLLECTION], []);
  assert.deepEqual(store.data[EVIDENCE_HEADS_COLLECTION], []);
  assert.deepEqual(store.data[EVIDENCE_DOMAINS_COLLECTION], []);
  assert.equal(store.data.houses[0]._id, "legacy-house");
  const persisted = JSON.parse(await readFile(join(directory, "demo-data.json"), "utf8"));
  assert.deepEqual(persisted[EVIDENCE_COLLECTION] ?? [], []);
});

test("LocalStore keeps evidence/domain create-only and exact, head updates exact", async (t) => {
  const store = await localStore(t);
  await seedDomain(store);
  await runAppend(store);
  const evidence = structuredClone(store.data[EVIDENCE_COLLECTION][0]);
  const domain = structuredClone(store.data[EVIDENCE_DOMAINS_COLLECTION][0]);

  const evidenceWrite = {
    collection: EVIDENCE_COLLECTION, id: evidence._id,
    data: { ...evidence, observedAt: evidence.observedAt + 1 },
  };
  let before = structuredClone(store.data);
  await assert.rejects(() => store.transact(
    [ref(EVIDENCE_COLLECTION, evidence._id)], () => [evidenceWrite], AUDIT,
  ), (error) => error.status === 409);
  assert.deepEqual(store.data, before);

  const domainWrite = {
    collection: EVIDENCE_DOMAINS_COLLECTION, id: domain._id,
    data: { ...domain, revision: 2 },
  };
  before = structuredClone(store.data);
  await assert.rejects(() => store.transact(
    [ref(EVIDENCE_DOMAINS_COLLECTION, domain._id)], () => [domainWrite], AUDIT,
  ), (error) => error.status === 409);
  assert.deepEqual(store.data, before);

  before = structuredClone(store.data);
  const mismatchedId = evidenceId(ORG, JOB_ID, 3);
  await assert.rejects(() => store.transact(
    [ref(EVIDENCE_COLLECTION, mismatchedId)],
    () => [{
      collection: EVIDENCE_COLLECTION,
      id: mismatchedId,
      data: { ...evidence, _id: "h4c-evidence-v1:other" },
    }],
    AUDIT,
  ), (error) => error.status === 400);
  assert.deepEqual(store.data, before);

  const duplicateId = evidenceId(ORG, JOB_ID, 4);
  const duplicate = { ...evidence, _id: duplicateId };
  before = structuredClone(store.data);
  await assert.rejects(() => store.transact(
    [ref(EVIDENCE_COLLECTION, duplicateId)],
    () => [
      { collection: EVIDENCE_COLLECTION, id: duplicateId, data: duplicate },
      { collection: EVIDENCE_COLLECTION, id: duplicateId, data: duplicate },
    ],
    AUDIT,
  ), (error) => error.status === 409);
  assert.deepEqual(store.data, before);

  await runAppend(store, { observedAt: OBSERVED + 100, now: NOW + 1_000 });
  const head = store.data[EVIDENCE_HEADS_COLLECTION][0];
  assert.deepEqual(Object.keys(head).sort(), [
    "_id", "createdAt", "jobId", "lastEvidenceId", "lastObservedAt", "lastSequence",
    "orgId", "revision", "updatedAt",
  ]);
  assert.equal(head.updatedAt, NOW + 1_000);
  assert.equal(store.data[EVIDENCE_COLLECTION][0].digest, evidence.digest);
});

test("CloudStore keeps evidence/domain exact fields and create-only semantics", async (t) => {
  const harness = cloudHarness();
  const store = harness.store;
  await seedDomain(store);

  const evidenceId1 = evidenceId(ORG, JOB_ID, 1);
  const evidenceRecord = makeEvidenceRecord();
  await insert(store, EVIDENCE_COLLECTION, evidenceRecord);
  const headId = evidenceHeadId(ORG, JOB_ID);
  const headRecord = makeHead({ lastSequence: 1 });
  await insert(store, EVIDENCE_HEADS_COLLECTION, headRecord);

  const evidence = harness.record(EVIDENCE_COLLECTION, evidenceId1);
  assert.equal(validateEvidenceRecord(evidence), undefined);
  assert.equal(Object.hasOwn(evidence, "updatedAt"), false);
  assert.deepEqual(Object.keys(evidence).sort(), Object.keys(makeEvidenceRecord()).sort());

  const head = harness.record(EVIDENCE_HEADS_COLLECTION, headId);
  assert.equal(validateEvidenceHead(head), undefined);
  assert.equal(head.updatedAt, NOW);
  assert.deepEqual(Object.keys(head).sort(), [
    "_id", "createdAt", "jobId", "lastEvidenceId", "lastObservedAt", "lastSequence",
    "orgId", "revision", "updatedAt",
  ]);

  let before = harness.record(EVIDENCE_COLLECTION, evidenceId1);
  let snapshot = harness.snapshot();
  await assert.rejects(() => store.transact(
    [ref(EVIDENCE_COLLECTION, evidenceId1)],
    () => [{ collection: EVIDENCE_COLLECTION, id: evidenceId1, data: { ...before } }],
    AUDIT,
  ), (error) => error.status === 409);
  assert.deepEqual(harness.record(EVIDENCE_COLLECTION, evidenceId1), before);
  assert.deepEqual(harness.snapshot(), snapshot);

  const domainId = EVIDENCE_DOMAIN_HEAD_ID;
  const domain = harness.record(EVIDENCE_DOMAINS_COLLECTION, domainId);
  before = harness.record(EVIDENCE_DOMAINS_COLLECTION, domainId);
  snapshot = harness.snapshot();
  await assert.rejects(() => store.transact(
    [ref(EVIDENCE_DOMAINS_COLLECTION, domainId)],
    () => [{ collection: EVIDENCE_DOMAINS_COLLECTION, id: domainId, data: { ...domain } }],
    AUDIT,
  ), (error) => error.status === 409);
  assert.deepEqual(harness.record(EVIDENCE_DOMAINS_COLLECTION, domainId), before);
  assert.deepEqual(harness.snapshot(), snapshot);

  const duplicateId = evidenceId(ORG, JOB_ID, 4);
  const duplicate = { ...evidence, _id: duplicateId };
  snapshot = harness.snapshot();
  await assert.rejects(() => store.transact(
    [ref(EVIDENCE_COLLECTION, duplicateId)],
    () => [
      { collection: EVIDENCE_COLLECTION, id: duplicateId, data: duplicate },
      { collection: EVIDENCE_COLLECTION, id: duplicateId, data: duplicate },
    ],
    AUDIT,
  ), (error) => error.status === 409);
  assert.deepEqual(harness.snapshot(), snapshot);

  // S2 does not wire Store; this is the existing exact head-update path only.
  const nextHead = {
    ...head,
    revision: 2,
    lastSequence: 2,
    lastEvidenceId: evidenceId(ORG, JOB_ID, 2),
    lastObservedAt: OBSERVED + 100,
    updatedAt: NOW + 1_000,
  };
  await store.transact(
    [ref(EVIDENCE_HEADS_COLLECTION, headId)],
    () => [{ collection: EVIDENCE_HEADS_COLLECTION, id: headId, data: nextHead }],
    AUDIT,
  );
  const updated = harness.record(EVIDENCE_HEADS_COLLECTION, headId);
  assert.equal(updated.revision, 2);
  assert.equal(updated.updatedAt, NOW + 1_000);
  assert.equal(updated.createdAt, NOW);
});

test("persisted evidence, logs and audits contain no secrets or forbidden payloads", async (t) => {
  const store = await localStore(t);
  await seedDomain(store);
  await runAppend(store, { decision: "still_unknown" });
  await runAppend(store, {
    decision: "confirmed_present", observedAt: OBSERVED + 100, now: NOW + 1_000,
  });

  const collections = [
    EVIDENCE_COLLECTION,
    EVIDENCE_HEADS_COLLECTION,
    EVIDENCE_DOMAINS_COLLECTION,
    "device_operation_logs",
    "admin_audit",
  ];
  const strings = [];
  const keys = [];
  const walk = (value) => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        keys.push(key);
        walk(child);
      }
    }
  };
  for (const name of collections) walk(store.data[name]);

  const forbiddenKeys = [
    "serialNumber", "mac", "ip", "phone", "name", "address", "idCard", "objectKey",
    "checksum", "stack", "message", "raw", "payload", "response", "image", "base64",
    "secret", "idempotencyKey", "requestDigest", "providerResponse",
  ];
  for (const key of forbiddenKeys) assert.equal(keys.includes(key), false, key);

  const keyHex = CONFIG.key.toString("hex");
  const forbiddenStrings = [
    KEY_A, keyHex, "H4_EVIDENCE_HMAC_KEY_B64", "OPERATION_KEY_HMAC_KEY_B64",
    "objectKey", "checksum", "data:image", "-----BEGIN", "Error:",
    "idempotency", "serialNumber", "providerResponse",
  ];
  for (const value of strings) {
    for (const forbidden of forbiddenStrings) {
      assert.equal(value.includes(forbidden), false, `${forbidden} in ${value}`);
    }
    assert.equal(/\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(value), false, `ip in ${value}`);
    assert.equal(/\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b/.test(value), false, `mac in ${value}`);
    assert.equal(/\b1[3-9]\d{9}\b/.test(value), false, `phone in ${value}`);
  }
  assert.deepEqual(store.data.device_operation_logs, []);
});

test("face-service index exports only the non-init C1 evidence surface", async () => {
  const service = await import("../lib/face-service/index.mjs");
  for (const name of [
    "appendEvidenceWrites", "applyEvidenceDomain", "evidenceAppendRefs",
    "evidenceDigest", "evidenceDomainIds", "evidenceHeadId", "evidenceId",
    "evidenceKeyConfig", "evidenceKeyFingerprint", "stableStringify", "stableValue",
    "validateEvidenceDomainRecord", "validateEvidenceHead", "validateEvidenceRecord",
  ]) {
    assert.equal(typeof service[name], "function", name);
  }
  assert.equal(service.EVIDENCE_DOMAIN_HEAD_ID, EVIDENCE_DOMAIN_HEAD_ID);
  for (const name of ["initializeEvidenceDomain", "evidenceDomainInitPrecondition",
    "evidenceDomainInitRefs", "evidenceDomainInitWrites"]) {
    assert.equal(name in service, false, name);
  }
});

test("one stable global head is shared by multiple organizations and cannot fork", async (t) => {
  const store = await localStore(t);
  await seedDomain(store);
  const jobB = {
    _id: "job-h4c-2", orgId: "org-h4c-b",
    createdAt: NOW - 10_000, result: { finishedAt: NOW - 5_000 },
  };
  await runAppend(store, { decision: "confirmed_removed" });
  await runAppend(store, { job: jobB, decision: "confirmed_present" });

  assert.equal(store.data[EVIDENCE_DOMAINS_COLLECTION].length, 2);
  const heads = store.data[EVIDENCE_DOMAINS_COLLECTION].filter((row) => row.kind === "head");
  assert.equal(heads.length, 1);
  assert.equal(heads[0]._id, EVIDENCE_DOMAIN_HEAD_ID);
  assert.equal(heads[0].realm, CONFIG.realm);
  assert.equal(Object.hasOwn(heads[0], "orgId"), false);
  assert.equal(store.data[EVIDENCE_HEADS_COLLECTION].length, 2);
  assert.deepEqual(store.data[EVIDENCE_HEADS_COLLECTION]
    .map((row) => `${row.orgId}/${row.jobId}`).sort(), [
    "org-h4c-b/job-h4c-2", `${ORG}/${JOB_ID}`,
  ]);
  assert.equal(store.data[EVIDENCE_COLLECTION].length, 2);
  const state = await domainStateFor(store);
  assert.deepEqual(applyEvidenceDomain(state, CONFIG), []);

  await runAppend(store, {
    decision: "still_unknown", observedAt: OBSERVED + 100, now: NOW + 1_000,
  });
  assert.equal(store.data[EVIDENCE_DOMAINS_COLLECTION].length, 2);
});

test("realm switch/version change/rekey are DOMAIN_MISMATCH and never add a head/version", async (t) => {
  const store = await localStore(t);
  await seedDomain(store);
  const before = structuredClone(store.data);

  const rekeyed = evidenceKeyConfig({ ...ENV_A, H4_EVIDENCE_HMAC_KEY_B64: KEY_B });
  const versioned = evidenceKeyConfig({ ...ENV_A, H4_EVIDENCE_KEY_VERSION: "2" });
  const realmB = evidenceKeyConfig({ ...ENV_A, H4_EVIDENCE_REALM: "h4c-realm-b" });
  for (const config of [rekeyed, versioned, realmB]) {
    await expectFailure(store, { config }, "DOMAIN_MISMATCH");
    assert.deepEqual(store.data, before);
  }
  assert.equal(store.data[EVIDENCE_DOMAINS_COLLECTION].length, 2);

  // A pre-seeded version record for a second realm cannot create a parallel
  // namespace: the stable head still binds realm-a and yields DOMAIN_MISMATCH.
  const realmBVersion = makeDomainRecords(realmB).version;
  await insert(store, EVIDENCE_DOMAINS_COLLECTION, realmBVersion);
  const preseeded = structuredClone(store.data);
  await expectFailure(store, { config: realmB }, "DOMAIN_MISMATCH");
  assert.deepEqual(store.data, preseeded);
  assert.equal(store.data[EVIDENCE_DOMAINS_COLLECTION]
    .filter((row) => row.kind === "head").length, 1);
  assert.equal(store.data[EVIDENCE_DOMAINS_COLLECTION]
    .find((row) => row.kind === "head").realm, CONFIG.realm);
  assert.equal(store.data[EVIDENCE_DOMAINS_COLLECTION].length, 3);

  // The extra second-realm version record must not disturb the fixed head for
  // realm-a: read-only verification still passes and append still works.
  const stateA = await domainStateFor(store);
  assert.deepEqual(applyEvidenceDomain(stateA, CONFIG), []);
  await runAppend(store, { observedAt: OBSERVED + 200, now: NOW + 2_000 });
  assert.equal(store.data[EVIDENCE_DOMAINS_COLLECTION].length, 3);
  assert.equal(store.data[EVIDENCE_DOMAINS_COLLECTION]
    .filter((row) => row.kind === "head").length, 1);
  assert.equal(store.data[EVIDENCE_DOMAINS_COLLECTION]
    .find((row) => row.kind === "head").realm, CONFIG.realm);
});

/* ------------------------------------------------------------------------- *
 * S1 contract-layer tests
 * ------------------------------------------------------------------------- */

function s1Marker(overrides = {}) {
  const { head, version } = makeDomainRecords();
  const marker = {
    _id: EVIDENCE_CHAIN_K3_MARKER_ID,
    kind: "k3-marker",
    scope: "global",
    schemaVersion: 1,
    fenceId: EVIDENCE_CHAIN_FENCE_ID,
    k3DomainHeadId: head._id,
    k3DomainVersionId: version._id,
    k3DomainHeadRevision: head.revision,
    realm: CONFIG.realm,
    keyVersion: CONFIG.version,
    keyFingerprint: CONFIG.fingerprint,
    bootstrapRunId: "run-bootstrap",
    maintenanceId: "maint-1",
    maintenanceManifestDigest: "c".repeat(64),
    windowStart: NOW - 10_000,
    windowEnd: NOW + 10_000,
    createdAt: NOW,
    markerDigest: "",
    ...overrides,
  };
  marker.markerDigest = h4cK3MarkerDigest(marker, CONFIG);
  return marker;
}

function s1Proof(overrides = {}) {
  const marker = overrides.marker ?? s1Marker();
  const proof = {
    _id: "",
    kind: "audit",
    scope: "global",
    schemaVersion: 1,
    realm: CONFIG.realm,
    keyVersion: CONFIG.version,
    keyFingerprint: CONFIG.fingerprint,
    domainHeadId: EVIDENCE_DOMAIN_HEAD_ID,
    domainHeadRevision: 1,
    writeEpoch: 4,
    admissionPolicyVersion: "policy-v1",
    writerSetDigest: "a".repeat(64),
    auditedCollections: [...H4C_COLLECTION_NAMES].sort(),
    status: "verified",
    canonicalEvidenceCount: 1,
    canonicalHeadCount: 1,
    anchorCount: 1,
    legacyCount: 0,
    inventoryDigest: "b".repeat(64),
    checkedAt: NOW,
    checkedBy: ACTOR,
    auditDigest: "",
    k3MarkerDigest: marker.markerDigest,
    writerPlanId: writerPlanId(4),
    ...overrides,
  };
  delete proof.marker;
  if (overrides._id === undefined) {
    proof._id = evidenceProofId(
      proof.keyFingerprint, proof.domainHeadRevision, proof.writeEpoch);
  }
  proof.auditDigest = h4cAuditProofDigest(proof, CONFIG);
  return proof;
}

function s1Plan(overrides = {}) {
  const plan = {
    _id: "",
    kind: "plan",
    scope: "global",
    schemaVersion: 1,
    planKind: "migration",
    phase: "pre-anchor",
    runId: "run-1",
    issuedBy: ACTOR,
    issuedAt: NOW,
    windowStart: NOW - 1_000,
    windowEnd: NOW + 1_000,
    keyFingerprint: CONFIG.fingerprint,
    k3MarkerId: EVIDENCE_CHAIN_K3_MARKER_ID,
    sourceKind: "none",
    sourceHaltedEpoch: null,
    sourceFenceDigest: null,
    targetWriteEpoch: 1,
    targetAdmissionPolicyVersion: "policy-v1",
    targetWriterSetDigest: "a".repeat(64),
    targetProofId: evidenceProofId(CONFIG.fingerprint, 1, 1),
    writerEpoch: null,
    revokedWriterSetDigest: null,
    revocationReceiptDigest: null,
    finalInventoryDigest: null,
    canonicalEvidenceCount: 0,
    canonicalHeadCount: 0,
    anchorCount: 0,
    auditedCollections: null,
    status: "active",
    statusFrom: "none",
    statusTargetProofId: null,
    statusUpdatedAt: NOW,
    statusReason: "plan-issue",
    statusActor: ACTOR,
    statusTicket: "",
    initialStatusTicket: "",
    runtimeTicket: null,
    ...overrides,
  };
  if (plan.planKind === "writer") {
    plan.phase = "writer";
    plan.runId = writerRunId(plan.writerEpoch);
    plan._id = writerPlanId(plan.writerEpoch);
    plan.targetWriteEpoch = plan.writerEpoch;
    if (overrides.targetProofId === undefined) {
      plan.targetProofId = evidenceProofId(CONFIG.fingerprint, 1, plan.writerEpoch);
    }
  } else {
    plan._id = evidencePlanId(plan.planKind, plan.runId, plan.phase);
  }
  plan.initialStatusTicket = h4cPlanStatusTicket({
    planId: plan._id,
    fromStatus: "none",
    toStatus: "active",
    targetProofId: null,
    statusUpdatedAt: plan.issuedAt,
    statusReason: "plan-issue",
    actor: plan.issuedBy,
  }, CONFIG);
  if (plan.status === "active") {
    plan.statusFrom = "none";
    plan.statusTargetProofId = null;
    plan.statusUpdatedAt = plan.issuedAt;
    plan.statusReason = "plan-issue";
    plan.statusActor = plan.issuedBy;
    plan.statusTicket = plan.initialStatusTicket;
    plan.runtimeTicket = null;
  } else if (plan.status === "consumed") {
    plan.statusFrom = "active";
    plan.statusTargetProofId = plan.targetProofId;
    plan.statusTicket = h4cPlanStatusTicket({
      planId: plan._id,
      fromStatus: "active",
      toStatus: "consumed",
      targetProofId: plan.targetProofId,
      statusUpdatedAt: plan.statusUpdatedAt,
      statusReason: plan.statusReason,
      actor: plan.statusActor,
    }, CONFIG);
    if (plan.planKind === "writer") {
      plan.runtimeTicket = h4cWriterRuntimeTicket({
        planId: plan._id,
        proofId: plan.targetProofId,
        writerEpoch: plan.writerEpoch,
        targetWriterSetDigest: plan.targetWriterSetDigest,
        k3MarkerId: plan.k3MarkerId,
        keyFingerprint: plan.keyFingerprint,
        activatedAt: plan.statusUpdatedAt,
      }, CONFIG);
    } else {
      plan.runtimeTicket = null;
    }
  } else {
    plan.statusFrom = "active";
    plan.statusTargetProofId = null;
    plan.statusReason = "revoked:plan-revoke";
    plan.statusTicket = h4cPlanStatusTicket({
      planId: plan._id,
      fromStatus: "active",
      toStatus: "revoked",
      targetProofId: null,
      statusUpdatedAt: plan.statusUpdatedAt,
      statusReason: plan.statusReason,
      actor: plan.statusActor,
    }, CONFIG);
    plan.runtimeTicket = null;
  }
  const core = {};
  for (const field of EVIDENCE_PLAN_FIELDS.slice(0, 28)) core[field] = plan[field];
  plan.planDigest = h4cPlanDigest(core);
  plan.planTicket = h4cPlanTicket({ ...core, planDigest: plan.planDigest }, CONFIG);
  return plan;
}

function s1Fence(overrides = {}) {
  const fence = {
    _id: EVIDENCE_CHAIN_FENCE_ID,
    kind: "fence",
    scope: "global",
    schemaVersion: 1,
    status: "clear",
    epoch: 4,
    reasonCode: "monitor-ok",
    monitorId: "monitor-1",
    heartbeatAt: NOW,
    validUntil: NOW + MONITOR_HEALTH_WINDOW_MS,
    updatedAt: NOW,
    fenceDigest: "",
    ...overrides,
  };
  fence.fenceDigest = h4cFenceDigest(fence, CONFIG);
  return fence;
}

function s1State({ proof, marker, plan, fence } = {}) {
  const domain = makeDomainRecords();
  const state = domainState(CONFIG, domain.head, domain.version);
  state[`${H4C.auditProofs}/${proof._id}`] = proof;
  state[`${H4C.k3Markers}/${EVIDENCE_CHAIN_K3_MARKER_ID}`] = marker;
  state[`${H4C.plans}/${plan._id}`] = plan;
  state[`${H4C.fences}/${EVIDENCE_CHAIN_FENCE_ID}`] = fence;
  return state;
}

function s1GateWrites(proof, marker, plan, fence) {
  const anchor = {
    _id: evidenceAnchorId(ORG, JOB._id),
    orgId: ORG,
    jobId: JOB._id,
    schemaVersion: 1,
    firstEvidenceId: evidenceId(ORG, JOB._id, 1),
    createdAt: NOW,
  };
  const evidence = { _id: evidenceId(ORG, JOB._id, 1) };
  const head = { _id: evidenceHeadId(ORG, JOB._id) };
  const targetList = [
    `${H4C.anchors}/${anchor._id}`,
    `${H4C.evidence}/${evidence._id}`,
    `${H4C.evidenceHeads}/${head._id}`,
  ].sort();
  const audit = evidenceC1AuditRecord({
    orgId: ORG,
    jobId: JOB._id,
    targetList,
    sequence: 1,
    actorId: ACTOR,
    actorType: "user",
    now: NOW,
  });
  const refs = [
    { collection: H4C.anchors, id: anchor._id },
    { collection: H4C.evidence, id: evidence._id },
    { collection: H4C.evidenceHeads, id: head._id },
    { collection: H4C.auditProofs, id: proof._id },
    { collection: H4C.fences, id: fence._id },
    { collection: H4C.k3Markers, id: marker._id },
    { collection: H4C.plans, id: plan._id },
    { collection: H4C.domains, id: EVIDENCE_DOMAIN_HEAD_ID },
    { collection: H4C.domains, id: evidenceDomainIds(CONFIG.realm, CONFIG.version).versionId },
    { collection: H4C_AUDIT_COLLECTION, id: audit._id },
  ];
  const writes = [
    { collection: H4C.anchors, id: anchor._id, data: anchor },
    { collection: H4C.evidence, id: evidence._id, data: evidence },
    { collection: H4C.evidenceHeads, id: head._id, data: head },
    { collection: H4C_AUDIT_COLLECTION, id: audit._id, data: audit },
  ];
  return { refs, writes };
}

function s1Admission({ refs, writes, proof, overrides = {} }) {
  const admission = {
    kind: "runtime",
    operation: "genesis",
    writeEpoch: proof.writeEpoch,
    admissionPolicyVersion: proof.admissionPolicyVersion,
    writerSetDigest: proof.writerSetDigest,
    proofId: proof._id,
    refsDigest: h4cRefsDigest(refs),
    writesDigest: h4cWritesDigest(writes),
    operationAuthDigest: null,
    ticket: "",
    ...overrides,
  };
  admission.ticket = h4cAdmissionTicketDigest(admission, CONFIG);
  return admission;
}

function s1Fixture() {
  const marker = s1Marker();
  const proof = s1Proof({ marker });
  const plan = s1Plan({
    planKind: "writer",
    writerEpoch: 4,
    sourceKind: "halted-fence",
    sourceHaltedEpoch: 3,
    sourceFenceDigest: "d".repeat(64),
    targetProofId: proof._id,
    targetWriterSetDigest: proof.writerSetDigest,
    revokedWriterSetDigest: "e".repeat(64),
    revocationReceiptDigest: "f".repeat(64),
    status: "consumed",
    statusUpdatedAt: NOW + 1,
  });
  const fence = s1Fence({ epoch: proof.writeEpoch });
  const state = s1State({ proof, marker, plan, fence });
  const { refs, writes } = s1GateWrites(proof, marker, plan, fence);
  const admission = s1Admission({ refs, writes, proof });
  return { marker, proof, plan, fence, state, refs, writes, admission };
}

test("S1 collection gate is closed, frozen and Set-free", async () => {
  const ns = await import("../lib/h4c-collections.mjs");
  assert.deepEqual(Object.keys(ns).sort(), [
    "H4C", "H4C_AUDIT_COLLECTION", "H4C_COLLECTION_NAMES", "isH4cCollection",
  ]);
  assert.equal(Object.hasOwn(ns, "H4C_COLLECTION_SET"), false);
  assert.equal(Object.isFrozen(ns.H4C), true);
  assert.equal(Object.isFrozen(ns.H4C_COLLECTION_NAMES), true);
  assert.deepEqual([...ns.H4C_COLLECTION_NAMES], [
    "device_operation_evidence",
    "device_operation_evidence_heads",
    "evidence_digest_domains",
    "evidence_chain_anchors",
    "evidence_chain_audits",
    "evidence_chain_fences",
    "evidence_chain_k3_markers",
    "evidence_chain_plans",
  ]);
  assert.equal(ns.H4C_AUDIT_COLLECTION, "admin_audit");
  assert.throws(() => { ns.H4C.evidence = "x"; }, TypeError);
  assert.throws(() => { ns.H4C.other = "x"; }, TypeError);
  assert.throws(() => { ns.H4C_COLLECTION_NAMES.push("x"); }, TypeError);
  assert.throws(() => { ns.H4C_COLLECTION_NAMES[0] = "x"; }, TypeError);
  for (const name of ns.H4C_COLLECTION_NAMES) {
    assert.equal(ns.isH4cCollection(name), true, name);
  }
  for (const name of [
    "admin_audit", "__proto__", "constructor", "", "device_operation_evidence_2",
    "evidence_chain_audits_v2", "evidence-chain-audits", null, undefined, 0, 7,
    {}, [], Symbol("x"),
  ]) {
    assert.equal(ns.isH4cCollection(name), false, String(name));
  }

  // A frozen Set is still mutable; that is exactly why no Set is exported.
  const frozenSet = Object.freeze(new Set(["a"]));
  frozenSet.add("b");
  assert.equal(frozenSet.has("b"), true);

  // Replacing Set.prototype.has after load cannot change the captured decision.
  const originalHas = Set.prototype.has;
  Set.prototype.has = () => false;
  try {
    assert.equal(ns.isH4cCollection("device_operation_evidence"), true);
    assert.equal(ns.isH4cCollection("admin_audit"), false);
  } finally {
    Set.prototype.has = originalHas;
  }
  for (const name of [
    "addH4cCollection", "removeH4cCollection", "setH4cCollections",
    "getH4cCollectionSet", "H4C_COLLECTION_SET",
  ]) assert.equal(Object.hasOwn(ns, name), false);

  assert.equal(EVIDENCE_COLLECTION, ns.H4C.evidence);
  assert.equal(EVIDENCE_HEADS_COLLECTION, ns.H4C.evidenceHeads);
  assert.equal(EVIDENCE_DOMAINS_COLLECTION, ns.H4C.domains);
});

test("S1 canonical IDs cover anchor/proof/plan/audit and writer epoch parsing", () => {
  const anchor = evidenceAnchorId(ORG, JOB._id);
  assert.equal(anchor, EVIDENCE_CHAIN_ANCHOR_PREFIX + createHash("sha256")
    .update(stableStringify([ORG, JOB._id])).digest("hex").slice(0, 32));
  assert.match(anchor, /^h4c-evidence-anchor-v1:[0-9a-f]{32}$/);
  assert.notEqual(anchor, evidenceAnchorId(ORG, "job-other"));

  assert.equal(evidenceProofId(CONFIG.fingerprint, 3, 7),
    `evidence-chain-audit:v1:${CONFIG.fingerprint}:3:7`);
  assert.throws(() => evidenceProofId("A".repeat(64), 3, 7), rejectCode("EVIDENCE_CHAIN_PROOF_REQUIRED"));
  assert.throws(() => evidenceProofId(CONFIG.fingerprint, 0, 7), rejectCode("EVIDENCE_CHAIN_PROOF_REQUIRED"));

  for (const epoch of [1, 7, 10]) {
    assert.equal(writerRunId(epoch), `we-${epoch}`);
    assert.equal(writerPlanId(epoch),
      `evidence-chain-plan:v1:writer:we-${epoch}:writer`);
    assert.equal(writerEpochFromRunId(`we-${epoch}`), epoch);
  }
  assert.equal(writerPlanId(7),
    "evidence-chain-plan:v1:writer:we-7:writer");
  assert.throws(() => writerPlanId(0), rejectCode("PLAN_INVALID"));
  assert.throws(() => writerPlanId(1.5), rejectCode("PLAN_INVALID"));
  for (const bad of [
    "we-07", "we-0", "WE-7", "", "we-", "we-1.0", "we-+1", " we-7", "we- 7",
    "we-9007199254740993", null, 7,
  ]) {
    assert.throws(() => writerEpochFromRunId(bad), rejectCode("PLAN_INVALID"), String(bad));
  }
  assert.equal(evidencePlanId("migration", "run-1", "pre-anchor"),
    "evidence-chain-plan:v1:migration:run-1:pre-anchor");
  assert.equal(evidencePlanId("recovery", "run-2", "recovery"),
    "evidence-chain-plan:v1:recovery:run-2:recovery");
  assert.throws(() => evidencePlanId("writer", "run-1", "pre-anchor"), rejectCode("PLAN_INVALID"));

  const targetList = [
    `${H4C.anchors}/${anchor}`,
    `${H4C.evidence}/${evidenceId(ORG, JOB._id, 1)}`,
  ].sort();
  const auditId = evidenceC1AuditId({
    orgId: ORG, scopeKey: JOB._id, action: "h4c.evidence.genesis", targetList, revision: 1,
  });
  assert.equal(auditId, "audit-h4c-v1:" + createHash("sha256").update(stableStringify([
    ORG, JOB._id, "h4c.evidence.genesis", targetList, 1,
  ])).digest("hex").slice(0, 32));
  assert.match(auditId, /^audit-h4c-v1:[0-9a-f]{32}$/);
  assert.throws(() => evidenceC1AuditId({
    orgId: ORG, scopeKey: JOB._id, action: "h4c.evidence.genesis",
    targetList: [...targetList].reverse(), revision: 1,
  }), rejectCode("EVIDENCE_CHAIN_ADMISSION_REQUIRED"));
  assert.throws(() => evidenceC1AuditId({
    orgId: ORG, scopeKey: JOB._id, action: "h4c.evidence.genesis",
    targetList: [targetList[0], targetList[0]], revision: 1,
  }), rejectCode("EVIDENCE_CHAIN_ADMISSION_REQUIRED"));
  assert.throws(() => evidenceC1AuditId({
    orgId: ORG, scopeKey: JOB._id, action: "h4c.evidence.genesis",
    targetList: [`${H4C_AUDIT_COLLECTION}/audit-h4c-v1:${"0".repeat(32)}`], revision: 1,
  }), rejectCode("EVIDENCE_CHAIN_ADMISSION_REQUIRED"));
});

test("S1 schema arrays freeze the exact field counts and reject non-exact records", () => {
  assert.equal(EVIDENCE_ANCHOR_FIELDS.length, 6);
  assert.equal(EVIDENCE_FIELDS.length, 20);
  assert.equal(EVIDENCE_HEAD_FIELDS.length, 9);
  assert.equal(DOMAIN_HEAD_FIELDS.length, 7);
  assert.equal(DOMAIN_VERSION_FIELDS.length, 6);
  assert.equal(EVIDENCE_AUDIT_FIELDS.length, 7);
  assert.equal(EVIDENCE_FENCE_FIELDS.length, 12);
  assert.equal(EVIDENCE_K3_MARKER_FIELDS.length, 18);
  assert.equal(EVIDENCE_AUDIT_PROOF_FIELDS.length, 24);
  assert.equal(EVIDENCE_PLAN_FIELDS.length, 39);
  for (const fields of Object.values(H4C_SCHEMA_FIELDS)) {
    assert.equal(Object.isFrozen(fields), true);
  }
  assert.equal(Object.isFrozen(H4C_SCHEMA_FIELDS), true);

  const { head } = makeDomainRecords();
  const anchor = {
    _id: evidenceAnchorId(ORG, JOB._id), orgId: ORG, jobId: JOB._id, schemaVersion: 1,
    firstEvidenceId: evidenceId(ORG, JOB._id, 1), createdAt: NOW,
  };
  assert.equal(validateEvidenceAnchorRecord(anchor), undefined);
  const audit = evidenceC1AuditRecord({
    orgId: ORG, jobId: JOB._id,
    targetList: [`${H4C.evidence}/${evidenceId(ORG, JOB._id, 1)}`],
    sequence: 1, actorId: ACTOR, actorType: "user", now: NOW,
  });
  assert.equal(validateH4cAuditRecord(audit), undefined);
  const proof = s1Proof();
  assert.equal(validateH4cAuditProofRecord(proof, CONFIG), undefined);
  const marker = s1Marker();
  assert.equal(validateH4cK3MarkerRecord(marker, CONFIG), undefined);
  const fence = s1Fence();
  assert.equal(validateH4cFenceRecord(fence, CONFIG), undefined);
  const plan = s1Plan();
  assert.equal(validateH4cPlanRecord(plan, CONFIG), undefined);

  const cases = [
    [() => validateEvidenceAnchorRecord({ ...anchor, extra: 1 }), "EVIDENCE_INVALID"],
    [() => validateEvidenceAnchorRecord((({ _id, ...rest }) => rest)(anchor)), "EVIDENCE_INVALID"],
    [() => validateEvidenceAnchorRecord({ ...anchor, createdAt: "x" }), "EVIDENCE_INVALID"],
    [() => validateH4cAuditRecord({ ...audit, extra: 1 }), "EVIDENCE_INVALID"],
    [() => validateH4cAuditRecord((({ target, ...rest }) => rest)(audit)), "EVIDENCE_INVALID"],
    [() => validateH4cAuditRecord({ ...audit, createdAt: "x" }), "EVIDENCE_INVALID"],
    [() => validateH4cAuditProofRecord({ ...proof, extra: 1 }, CONFIG), "EVIDENCE_CHAIN_PROOF_REQUIRED"],
    [() => validateH4cAuditProofRecord((({ legacyCount, ...rest }) => rest)(proof), CONFIG), "EVIDENCE_CHAIN_PROOF_REQUIRED"],
    [() => validateH4cAuditProofRecord({ ...proof, writeEpoch: "4" }, CONFIG), "EVIDENCE_CHAIN_PROOF_REQUIRED"],
    [() => validateH4cFenceRecord({ ...fence, extra: 1 }, CONFIG), "EVIDENCE_CHAIN_HALTED"],
    [() => validateH4cFenceRecord((({ epoch, ...rest }) => rest)(fence), CONFIG), "EVIDENCE_CHAIN_HALTED"],
    [() => validateH4cFenceRecord({ ...fence, epoch: "4" }, CONFIG), "EVIDENCE_CHAIN_HALTED"],
    [() => validateH4cK3MarkerRecord({ ...marker, extra: 1 }, CONFIG), "EVIDENCE_CHAIN_PROOF_REQUIRED"],
    [() => validateH4cK3MarkerRecord((({ realm, ...rest }) => rest)(marker), CONFIG), "EVIDENCE_CHAIN_PROOF_REQUIRED"],
    [() => validateH4cK3MarkerRecord({ ...marker, createdAt: "x" }, CONFIG), "EVIDENCE_CHAIN_PROOF_REQUIRED"],
    [() => validateH4cPlanRecord({ ...plan, extra: 1 }, CONFIG), "PLAN_INVALID"],
    [() => validateH4cPlanRecord((({ status, ...rest }) => rest)(plan), CONFIG), "PLAN_INVALID"],
    [() => validateH4cPlanRecord({ ...plan, issuedAt: "x" }, CONFIG), "PLAN_INVALID"],
  ];
  for (const [fn, code] of cases) assert.throws(fn, rejectCode(code));
  for (const value of [null, [], new (class Record {})()]) {
    assert.throws(() => validateEvidenceAnchorRecord(value), rejectCode("EVIDENCE_INVALID"));
    assert.throws(() => validateH4cAuditRecord(value), rejectCode("EVIDENCE_INVALID"));
    assert.throws(() => validateH4cAuditProofRecord(value, CONFIG),
      rejectCode("EVIDENCE_CHAIN_PROOF_REQUIRED"));
    assert.throws(() => validateH4cFenceRecord(value, CONFIG),
      rejectCode("EVIDENCE_CHAIN_HALTED"));
    assert.throws(() => validateH4cK3MarkerRecord(value, CONFIG),
      rejectCode("EVIDENCE_CHAIN_PROOF_REQUIRED"));
    assert.throws(() => validateH4cPlanRecord(value, CONFIG), rejectCode("PLAN_INVALID"));
  }
  assert.equal(Object.hasOwn(head, "_id"), true);
});

test("S1 D4a proof status/legacyCount and snapshot fields (V01-V05)", () => {
  assert.equal(validateH4cAuditProofRecord(s1Proof(), CONFIG), undefined);
  for (const status of ["valid", "empty", "backfilled", "", null, 1]) {
    assert.throws(() => validateH4cAuditProofRecord(s1Proof({ status }), CONFIG),
      rejectCode("EVIDENCE_CHAIN_PROOF_REQUIRED"), String(status));
  }
  const missingStatus = s1Proof();
  delete missingStatus.status;
  assert.throws(() => validateH4cAuditProofRecord(missingStatus, CONFIG),
    rejectCode("EVIDENCE_CHAIN_PROOF_REQUIRED"));
  for (const legacyCount of [-1, 1, 1.5, "0", Number.MAX_SAFE_INTEGER + 2]) {
    assert.throws(() => validateH4cAuditProofRecord(s1Proof({ legacyCount }), CONFIG),
      rejectCode("EVIDENCE_CHAIN_PROOF_REQUIRED"), String(legacyCount));
  }
  const snapshot = s1Proof({
    canonicalEvidenceCount: 99,
    canonicalHeadCount: 42,
    anchorCount: 7,
    inventoryDigest: "d".repeat(64),
  });
  assert.equal(validateH4cAuditProofRecord(snapshot, CONFIG), undefined);
  assert.equal(snapshot.inventoryDigest, "d".repeat(64));
  const coverageMarker = s1Marker();
  const coveragePlan = s1Plan({
    planKind: "writer", writerEpoch: 4, sourceKind: "halted-fence",
    sourceHaltedEpoch: 3, sourceFenceDigest: "d".repeat(64),
    targetProofId: snapshot._id, targetWriterSetDigest: snapshot.writerSetDigest,
    revokedWriterSetDigest: "e".repeat(64), revocationReceiptDigest: "f".repeat(64),
    status: "consumed", statusUpdatedAt: NOW + 1,
  });
  const coverageState = s1State({
    proof: snapshot,
    marker: coverageMarker,
    plan: coveragePlan,
    fence: s1Fence({ epoch: snapshot.writeEpoch }),
  });
  assert.equal(CoverageValid(snapshot, coverageMarker, coveragePlan, CONFIG, coverageState), true);
  assert.equal(CoverageValid(snapshot, coverageMarker, coveragePlan, CONFIG), false);
  const tampered = s1Proof();
  tampered.auditDigest = "0".repeat(64);
  assert.throws(() => validateH4cAuditProofRecord(tampered, CONFIG),
    rejectCode("EVIDENCE_CHAIN_PROOF_REQUIRED"));
});

test("S1 C1 audit D4b formula, fields and V06-V09", () => {
  const anchor = evidenceAnchorId(ORG, JOB._id);
  const evidence = evidenceId(ORG, JOB._id, 1);
  const head = evidenceHeadId(ORG, JOB._id);
  const targetList = [
    `${H4C.anchors}/${anchor}`,
    `${H4C.evidence}/${evidence}`,
    `${H4C.evidenceHeads}/${head}`,
  ].sort();
  const context = { orgId: ORG, jobId: JOB._id, targetList, sequence: 1, now: NOW };
  const audit = evidenceC1AuditRecord({
    orgId: ORG, jobId: JOB._id, targetList, sequence: 1, actorId: ACTOR,
    actorType: "user", now: NOW,
  });
  assert.equal(audit._id, evidenceC1AuditId({
    orgId: ORG, scopeKey: JOB._id, action: "h4c.evidence.genesis", targetList, revision: 1,
  }));
  assert.equal(audit.action, "h4c.evidence.genesis");
  assert.equal(audit.target, targetList.join(", "));
  assert.equal(audit.createdAt, NOW);
  assert.deepEqual(Object.keys(audit).sort(), [
    "_id", "action", "actorId", "actorType", "createdAt", "orgId", "target",
  ]);
  assert.equal(validateEvidenceC1AuditRecord(audit, context), undefined);

  const append = evidenceC1AuditRecord({
    orgId: ORG, jobId: JOB._id, targetList, sequence: 4, actorId: ACTOR,
    actorType: "user", now: NOW + 1,
  });
  assert.equal(append.action, "h4c.evidence.append");
  assert.equal(validateEvidenceC1AuditRecord(append, { ...context, sequence: 4, now: NOW + 1 }),
    undefined);

  const wrongScope = evidenceC1AuditRecord({
    orgId: ORG, jobId: "job-other", targetList, sequence: 1, actorId: ACTOR,
    actorType: "user", now: NOW,
  });
  assert.throws(() => validateEvidenceC1AuditRecord(wrongScope, context),
    rejectCode("EVIDENCE_CHAIN_ADMISSION_REQUIRED"));
  const wrongAction = { ...audit, action: "h4c.evidence.append" };
  assert.throws(() => validateEvidenceC1AuditRecord(wrongAction, context),
    rejectCode("EVIDENCE_CHAIN_ADMISSION_REQUIRED"));
  const wrongRevision = { ...audit, _id: evidenceC1AuditId({
    orgId: ORG, scopeKey: JOB._id, action: "h4c.evidence.append", targetList, revision: 2,
  }), action: "h4c.evidence.append" };
  assert.throws(() => validateEvidenceC1AuditRecord(wrongRevision, context),
    rejectCode("EVIDENCE_CHAIN_ADMISSION_REQUIRED"));
  assert.throws(() => validateEvidenceC1AuditRecord({ ...audit, createdAt: NOW + 1 }, context),
    rejectCode("EVIDENCE_CHAIN_ADMISSION_REQUIRED"));
  assert.throws(() => validateEvidenceC1AuditRecord({ ...audit, target: "x" }, context),
    rejectCode("EVIDENCE_CHAIN_ADMISSION_REQUIRED"));
  assert.throws(() => evidenceC1AuditRecord({
    orgId: ORG, jobId: JOB._id, targetList: [...targetList].reverse(), sequence: 1,
    actorId: ACTOR, actorType: "user", now: NOW,
  }), rejectCode("EVIDENCE_CHAIN_ADMISSION_REQUIRED"));
  assert.throws(() => evidenceC1AuditRecord({
    orgId: ORG, jobId: JOB._id, targetList: [targetList[0], targetList[0]], sequence: 1,
    actorId: ACTOR, actorType: "user", now: NOW,
  }), rejectCode("EVIDENCE_CHAIN_ADMISSION_REQUIRED"));
  assert.throws(() => evidenceC1AuditRecord({
    orgId: ORG, jobId: JOB._id,
    targetList: [`${H4C_AUDIT_COLLECTION}/audit-h4c-v1:${"0".repeat(32)}`],
    sequence: 1, actorId: ACTOR, actorType: "user", now: NOW,
  }), rejectCode("EVIDENCE_CHAIN_ADMISSION_REQUIRED"));
});

test("S1 plan 39 fields, planKind null table and consumed branches", () => {
  const pre = s1Plan();
  const final = s1Plan({
    phase: "final",
    finalInventoryDigest: "d".repeat(64),
    canonicalEvidenceCount: 3,
    canonicalHeadCount: 2,
    anchorCount: 1,
    auditedCollections: [...H4C_COLLECTION_NAMES].sort(),
  });
  const recovery = s1Plan({
    planKind: "recovery", phase: "recovery", runId: "run-recovery",
    sourceKind: "halted-fence", sourceHaltedEpoch: 3, sourceFenceDigest: "d".repeat(64),
    targetWriteEpoch: 4, targetProofId: evidenceProofId(CONFIG.fingerprint, 1, 4),
    finalInventoryDigest: "e".repeat(64), canonicalEvidenceCount: 3,
    canonicalHeadCount: 2, anchorCount: 1,
    auditedCollections: [...H4C_COLLECTION_NAMES].sort(),
  });
  const bootstrap = s1Plan({
    planKind: "writer", writerEpoch: 1, sourceKind: "bootstrap",
    targetProofId: evidenceProofId(CONFIG.fingerprint, 1, 1),
    revokedWriterSetDigest: "e".repeat(64), revocationReceiptDigest: "f".repeat(64),
  });
  const rotate = s1Plan({
    planKind: "writer", writerEpoch: 4, sourceKind: "halted-fence",
    sourceHaltedEpoch: 3, sourceFenceDigest: "d".repeat(64),
    targetProofId: evidenceProofId(CONFIG.fingerprint, 1, 4),
    targetWriterSetDigest: "a".repeat(64),
    revokedWriterSetDigest: "e".repeat(64), revocationReceiptDigest: "f".repeat(64),
  });
  const consumedWriter = s1Plan({
    planKind: "writer", writerEpoch: 4, sourceKind: "halted-fence",
    sourceHaltedEpoch: 3, sourceFenceDigest: "d".repeat(64),
    targetProofId: evidenceProofId(CONFIG.fingerprint, 1, 4),
    targetWriterSetDigest: "a".repeat(64),
    revokedWriterSetDigest: "e".repeat(64), revocationReceiptDigest: "f".repeat(64),
    status: "consumed", statusUpdatedAt: NOW + 1,
  });
  const consumedMigration = s1Plan({
    phase: "final", finalInventoryDigest: "d".repeat(64),
    canonicalEvidenceCount: 3, canonicalHeadCount: 2, anchorCount: 1,
    auditedCollections: [...H4C_COLLECTION_NAMES].sort(),
    status: "consumed", statusUpdatedAt: NOW + 1,
  });
  const revoked = s1Plan({ status: "revoked", statusUpdatedAt: NOW + 1 });
  for (const plan of [pre, final, recovery, bootstrap, rotate, consumedWriter,
    consumedMigration, revoked]) {
    assert.equal(validateH4cPlanRecord(plan, CONFIG), undefined);
    assert.equal(PlanRecordValid(plan, CONFIG), true);
  }
  assert.equal(bootstrap._id, writerPlanId(1));
  assert.equal(bootstrap.runId, "we-1");

  const negatives = [
    () => ({ ...pre, finalInventoryDigest: "d".repeat(64) }),
    () => ({ ...final, auditedCollections: null }),
    () => ({ ...recovery, sourceKind: "none" }),
    () => ({ ...bootstrap, sourceHaltedEpoch: 1 }),
    () => ({ ...rotate, runId: "we-04" }),
    () => ({ ...rotate, writerEpoch: 3 }),
    (() => { const copy = structuredClone(consumedWriter); copy.runtimeTicket = null; return copy; }),
    (() => { const copy = structuredClone(consumedMigration); copy.runtimeTicket = "0".repeat(64); return copy; }),
    (() => { const copy = structuredClone(pre); copy.runtimeTicket = "0".repeat(64); return copy; }),
    () => ({ ...revoked, statusTargetProofId: evidenceProofId(CONFIG.fingerprint, 1, 1) }),
    (() => { const copy = structuredClone(consumedWriter); copy.runtimeTicket = "0".repeat(64); return copy; }),
    (() => { const copy = structuredClone(consumedWriter); copy.statusTicket = "0".repeat(64); return copy; }),
  ];
  for (const mutate of negatives) {
    assert.throws(() => validateH4cPlanRecord(mutate(), CONFIG), rejectCode("PLAN_INVALID"));
  }
  assert.equal(PlanRecordValid({ ...pre, extra: 1 }, CONFIG), false);
});

test("S1 11 digest domains use canonical HMAC and rebuild from persisted fields", () => {
  assert.deepEqual(Object.keys(H4C_DIGEST_DOMAINS).sort(), [
    "audit", "fence", "k3Bootstrap", "k3Marker", "maintenanceManifest",
    "monitor", "plan", "planStatus", "recovery", "ticket", "writerRuntime",
  ]);
  assert.equal(Object.keys(H4C_DIGEST_DOMAINS).length, 11);
  const expected = (domain, fields) => createHmac("sha256", CONFIG.key)
    .update(stableStringify({ domain, version: 1, ...fields })).digest("hex");

  const proof = s1Proof();
  const { auditDigest, ...proofFields } = proof;
  assert.equal(auditDigest, expected(H4C_DIGEST_DOMAINS.audit, proofFields));
  assert.equal(auditDigest, h4cAuditProofDigest(proof, CONFIG));

  const fence = s1Fence();
  const { fenceDigest, ...fenceFields } = fence;
  assert.equal(fenceDigest, expected(H4C_DIGEST_DOMAINS.fence, fenceFields));

  const marker = s1Marker();
  const { markerDigest, ...markerFields } = marker;
  assert.equal(markerDigest, expected(H4C_DIGEST_DOMAINS.k3Marker, markerFields));

  const monitor = { monitorId: "m1", observedEpoch: 3, reasonCode: "monitor-halt", halt: true, fenceId: EVIDENCE_CHAIN_FENCE_ID };
  assert.equal(h4cMonitorAuthDigest(monitor, CONFIG),
    expected(H4C_DIGEST_DOMAINS.monitor, monitor));

  const admission = s1Fixture().admission;
  const { ticket, ...ticketFields } = admission;
  assert.equal(ticket, expected(H4C_DIGEST_DOMAINS.ticket, ticketFields));

  const core = {};
  const plan = s1Plan();
  for (const field of EVIDENCE_PLAN_FIELDS.slice(0, 28)) core[field] = plan[field];
  assert.equal(plan.planDigest, createHash("sha256")
    .update(stableStringify(core)).digest("hex"));
  assert.equal(plan.planTicket, expected(H4C_DIGEST_DOMAINS.plan,
    { ...core, planDigest: plan.planDigest }));
  assert.equal(plan.statusTicket, expected(H4C_DIGEST_DOMAINS.planStatus, {
    planId: plan._id, fromStatus: "none", toStatus: "active", targetProofId: null,
    statusUpdatedAt: plan.issuedAt, statusReason: "plan-issue", actor: plan.issuedBy,
  }));

  const runtimeFields = {
    planId: "p", proofId: "e", writerEpoch: 4, targetWriterSetDigest: "a".repeat(64),
    k3MarkerId: EVIDENCE_CHAIN_K3_MARKER_ID, keyFingerprint: CONFIG.fingerprint,
    activatedAt: NOW,
  };
  assert.equal(h4cWriterRuntimeTicket(runtimeFields, CONFIG),
    expected(H4C_DIGEST_DOMAINS.writerRuntime, runtimeFields));

  const recoveryFields = { recoveryRunId: "r1", haltedEpoch: 3, targetProofId: "p1" };
  assert.equal(h4cRecoveryTicket(recoveryFields, CONFIG),
    expected(H4C_DIGEST_DOMAINS.recovery, recoveryFields));

  const bootstrapFields = { bootstrapRunId: "b1", realm: CONFIG.realm, keyVersion: 1 };
  assert.equal(h4cK3DomainTicket(bootstrapFields, CONFIG),
    expected(H4C_DIGEST_DOMAINS.k3Bootstrap, bootstrapFields));

  const manifestFields = { maintenanceId: "m1", windowStart: NOW, windowEnd: NOW + 1 };
  assert.equal(h4cMaintenanceManifestTicket(manifestFields, CONFIG),
    expected(H4C_DIGEST_DOMAINS.maintenanceManifest, manifestFields));

  const refs = [
    { collection: H4C.evidence, id: "b" },
    { collection: H4C.anchors, id: "a" },
  ];
  assert.equal(h4cRefsDigest(refs), h4cRefsDigest([...refs].reverse()));
  assert.throws(() => h4cKeyedDigest("KEYED_DIGEST/unknown", {}, CONFIG),
    rejectCode("EVIDENCE_INVALID"));
  assert.throws(() => h4cKeyedDigest(H4C_DIGEST_DOMAINS.audit, [], CONFIG),
    rejectCode("EVIDENCE_INVALID"));
});

test("S1 fence predicates split healthy/expired/halted/clock and never mix usage", () => {
  const proof = s1Proof();
  const healthy = s1Fence({ epoch: proof.writeEpoch });
  assert.equal(FenceRecordValid(healthy, CONFIG), true);
  assert.equal(FenceStructValid(healthy, proof, CONFIG), true);
  assert.equal(FenceHealthy(healthy, proof, NOW, CONFIG), true);
  assert.equal(FenceValid(healthy, proof, NOW, CONFIG), true);
  assert.equal(FenceExpired(healthy, proof, NOW, CONFIG), false);
  assert.equal(FenceHeartbeatable(healthy, proof, NOW, CONFIG), true);

  const expired = s1Fence({
    epoch: proof.writeEpoch, heartbeatAt: NOW - 400_000, validUntil: NOW - 100_000,
    updatedAt: NOW - 400_000,
  });
  assert.equal(FenceValid(expired, proof, NOW, CONFIG), false);
  assert.equal(FenceExpired(expired, proof, NOW, CONFIG), true);
  assert.equal(FenceHealthy(expired, proof, NOW, CONFIG), false);
  assert.equal(FenceHeartbeatable(expired, proof, NOW, CONFIG), true);

  const halted = s1Fence({ epoch: proof.writeEpoch, status: "halted", reasonCode: "monitor-halt" });
  assert.equal(FenceValid(halted, proof, NOW, CONFIG), false);
  assert.equal(FenceHeartbeatable(halted, proof, NOW, CONFIG), false);
  assert.equal(FenceExpired(halted, proof, NOW, CONFIG), false);

  const rolledBack = NOW - CLOCK_SKEW_MS - 1;
  assert.equal(FenceHealthy(healthy, proof, rolledBack, CONFIG), false);
  assert.equal(FenceExpired(healthy, proof, rolledBack, CONFIG), false);
  assert.equal(FenceHeartbeatable(healthy, proof, rolledBack, CONFIG), false);

  const tooWide = s1Fence({
    epoch: proof.writeEpoch, heartbeatAt: NOW,
    validUntil: NOW + MONITOR_HEALTH_WINDOW_MS + 1,
  });
  assert.equal(FenceRecordValid(tooWide, CONFIG), false);

  const wrongEpoch = s1Proof({ writeEpoch: 5 });
  assert.equal(FenceStructValid(healthy, wrongEpoch, CONFIG), false);
  assert.equal(FenceValid(healthy, wrongEpoch, NOW, CONFIG), false);
});

test("S1 marker/coverage/writer-plan predicates enforce consumed+runtimeTicket binding", () => {
  const { marker, proof, plan, state } = s1Fixture();
  assert.equal(K3DomainExact(state, CONFIG), true);
  assert.equal(K3MarkerValid(marker, state, CONFIG), true);
  assert.equal(WriterPlanValid(plan, proof, marker, CONFIG), true);
  assert.equal(CoverageValid(proof, marker, plan, CONFIG, state), true);

  const active = s1Plan({
    planKind: "writer", writerEpoch: 4, sourceKind: "halted-fence",
    sourceHaltedEpoch: 3, sourceFenceDigest: "d".repeat(64),
    targetProofId: proof._id, targetWriterSetDigest: proof.writerSetDigest,
    revokedWriterSetDigest: "e".repeat(64), revocationReceiptDigest: "f".repeat(64),
  });
  assert.equal(WriterPlanValid(active, proof, marker, CONFIG), false);

  const wrongPlanProof = s1Proof({ marker, writerPlanId: writerPlanId(5) });
  assert.equal(WriterPlanValid(plan, wrongPlanProof, marker, CONFIG), false);

  const badMarker = s1Marker();
  badMarker.markerDigest = "0".repeat(64);
  assert.equal(CoverageValid(proof, badMarker, plan, CONFIG, state), false);
  assert.equal(K3MarkerValid(badMarker, state, CONFIG), false);

  const badCoverage = s1Proof({ marker, legacyCount: 1 });
  assert.equal(CoverageValid(badCoverage, marker, plan, CONFIG, state), false);

  const mismatchedSet = s1Plan({
    planKind: "writer", writerEpoch: 4, sourceKind: "halted-fence",
    sourceHaltedEpoch: 3, sourceFenceDigest: "d".repeat(64),
    targetProofId: proof._id, targetWriterSetDigest: "9".repeat(64),
    revokedWriterSetDigest: "e".repeat(64), revocationReceiptDigest: "f".repeat(64),
    status: "consumed", statusUpdatedAt: NOW + 1,
  });
  assert.equal(CoverageValid(proof, marker, mismatchedSet, CONFIG, state), false);
});

test("S1 D5 runtime whitelist and ticket binding (V10-V13)", () => {
  const { proof, state, refs, writes, admission } = s1Fixture();
  assert.equal(AdmissionValid(admission, refs, writes, CONFIG), true);
  const gate = createH4cGate({ config: CONFIG });

  const authVariants = [
    (copy) => { delete copy.operationAuthDigest; },
    (copy) => { copy.operationAuthDigest = undefined; },
    (copy) => { copy.operationAuthDigest = ""; },
    (copy) => { copy.operationAuthDigest = "digest"; },
  ];
  for (const mutate of authVariants) {
    const copy = structuredClone(admission);
    mutate(copy);
    assert.equal(AdmissionValid(copy, refs, writes, CONFIG), false);
    assert.throws(() => gate.verify({ state, refs, writes, admission: copy, now: NOW }),
      rejectCode("EVIDENCE_CHAIN_ADMISSION_REQUIRED"));
  }
  for (const overrides of [
    { kind: "migration" },
    { kind: "recovery" },
    { operation: "k3-domain-bootstrap" },
    { operation: "recover" },
  ]) {
    const copy = structuredClone(admission);
    Object.assign(copy, overrides);
    copy.ticket = h4cAdmissionTicketDigest(copy, CONFIG);
    assert.equal(AdmissionValid(copy, refs, writes, CONFIG), false);
  }
  const digestMismatch = structuredClone(admission);
  digestMismatch.refsDigest = "0".repeat(64);
  assert.equal(AdmissionValid(digestMismatch, refs, writes, CONFIG), false);
  const ticketMismatch = structuredClone(admission);
  ticketMismatch.ticket = "0".repeat(64);
  assert.equal(AdmissionValid(ticketMismatch, refs, writes, CONFIG), false);
  const duplicateRefs = [...refs, { ...refs[0] }];
  assert.equal(AdmissionValid(admission, duplicateRefs, writes, CONFIG), false);
  const undeclaredWrites = [...writes, {
    collection: H4C.evidence, id: "h4c-evidence-v1:missing", data: { _id: "h4c-evidence-v1:missing" },
  }];
  assert.equal(AdmissionValid(admission, refs, undeclaredWrites, CONFIG), false);
  const epochMismatch = structuredClone(admission);
  epochMismatch.writeEpoch = 5;
  epochMismatch.ticket = h4cAdmissionTicketDigest(epochMismatch, CONFIG);
  assert.throws(() => gate.verify({ state, refs, writes, admission: epochMismatch, now: NOW }),
    rejectCode("EVIDENCE_CHAIN_ADMISSION_REQUIRED"));
});

test("S1 gate is frozen, pure and enforces coverage/fence before writing", () => {
  const { proof, fence, state, refs, writes, admission } = s1Fixture();
  const gate = createH4cGate({ config: CONFIG });
  assert.equal(Object.isFrozen(gate), true);
  assert.deepEqual(Object.keys(gate), ["verify"]);
  assert.equal(typeof gate.verify, "function");
  for (const name of ["key", "config", "health", "setConfig", "replace"]) {
    assert.equal(Object.hasOwn(gate, name), false, name);
  }
  assert.throws(() => createH4cGate({
    config: { ...CONFIG, fingerprint: "0".repeat(64) },
  }), rejectCode("NOT_CONFIGURED"));
  assert.throws(() => createH4cGate({ config: CONFIG, health: { windowMs: 0 } }),
    rejectCode("NOT_CONFIGURED"));
  assert.throws(() => createH4cGate({ config: CONFIG, health: { skewMs: -1 } }),
    rejectCode("NOT_CONFIGURED"));

  const stateBefore = structuredClone(state);
  const refsBefore = structuredClone(refs);
  const writesBefore = structuredClone(writes);
  const admissionBefore = structuredClone(admission);
  assert.equal(gate.verify({ state, refs, writes, admission, now: NOW }), undefined);
  assert.deepEqual(state, stateBefore);
  assert.deepEqual(refs, refsBefore);
  assert.deepEqual(writes, writesBefore);
  assert.deepEqual(admission, admissionBefore);

  const noProofState = structuredClone(state);
  delete noProofState[`${H4C.auditProofs}/${proof._id}`];
  assert.throws(() => gate.verify({ state: noProofState, refs, writes, admission, now: NOW }),
    rejectCode("EVIDENCE_CHAIN_PROOF_REQUIRED"));

  const expiredState = structuredClone(state);
  expiredState[`${H4C.fences}/${EVIDENCE_CHAIN_FENCE_ID}`] = s1Fence({
    epoch: proof.writeEpoch, heartbeatAt: NOW - 400_000, validUntil: NOW - 100_000,
    updatedAt: NOW - 400_000,
  });
  assert.throws(() => gate.verify({ state: expiredState, refs, writes, admission, now: NOW }),
    rejectCode("EVIDENCE_CHAIN_FENCE_EXPIRED"));

  const haltedState = structuredClone(state);
  haltedState[`${H4C.fences}/${EVIDENCE_CHAIN_FENCE_ID}`] = s1Fence({
    epoch: fence.epoch, status: "halted", reasonCode: "monitor-halt",
  });
  assert.throws(() => gate.verify({ state: haltedState, refs, writes, admission, now: NOW }),
    rejectCode("EVIDENCE_CHAIN_HALTED"));

  assert.throws(() => gate.verify({ state, refs, writes, admission, now: 1.5 }),
    rejectCode("EVIDENCE_INVALID"));
});

test("S1 error-code table and public index stay add-only", async () => {
  const values = Object.values(H4C_ERROR_CODES);
  assert.equal(new Set(values).size, values.length);
  assert.equal(H4C_ERROR_CODES.EVIDENCE_CHAIN_PROOF_REQUIRED,
    "EVIDENCE_CHAIN_PROOF_REQUIRED");
  assert.notEqual(H4C_ERROR_CODES.EVIDENCE_CHAIN_PROOF_REQUIRED,
    H4C_ERROR_CODES.EVIDENCE_CHAIN_ADMISSION_REQUIRED);
  assert.notEqual(H4C_ERROR_CODES.EVIDENCE_CHAIN_HALTED,
    H4C_ERROR_CODES.EVIDENCE_CHAIN_FENCE_EXPIRED);

  const service = await import("../lib/face-service/index.mjs");
  for (const name of [
    "H4C", "isH4cCollection", "createH4cGate", "CoverageValid",
    "WriterPlanValid", "AdmissionValid", "FenceValid", "FenceHeartbeatable",
    "evidenceAnchorId", "evidenceProofId", "writerPlanId", "writerRunId",
    "evidenceC1AuditRecord", "H4C_SCHEMA_FIELDS", "H4C_DIGEST_DOMAINS",
  ]) assert.equal(typeof service[name] !== "undefined", true, name);
  for (const name of ["initializeEvidenceDomain", "bootstrapEvidenceDomain",
    "createEvidenceDomain", "ensureEvidenceDomain"]) {
    assert.equal(name in service, false, name);
  }
  assert.equal(Object.hasOwn(service, "H4C_COLLECTION_SET"), false);
});

/* ---- S3 authorization layer (precheck -> finalWriteSet -> ticket) -------- */

const S3_ADMISSION = "EVIDENCE_CHAIN_ADMISSION_REQUIRED";
const S3_PROOF = "EVIDENCE_CHAIN_PROOF_REQUIRED";

function s3Reject(values, code, fn) {
  const before = values.map((value) => structuredClone(value));
  assert.throws(fn, rejectCode(code));
  values.forEach((value, index) => assert.deepEqual(value, before[index]));
}

function s3Precheck(operation = "genesis") {
  return {
    kind: "runtime",
    operation,
    writeEpoch: WRITE_EPOCH,
    admissionPolicyVersion: PROOF.admissionPolicyVersion,
    writerSetDigest: PROOF.writerSetDigest,
    proofId: PROOF_ID,
  };
}

function s3GenesisContext({ now = NOW } = {}) {
  const state = s2State();
  const args = appendArgs({ now });
  const businessWrites = appendEvidenceWrites(state, args);
  const sequence = 1;
  const targetList = businessWrites.map((item) => `${item.collection}/${item.id}`).sort();
  const audit = evidenceC1AuditRecord({
    orgId: ORG, jobId: JOB_ID, targetList, sequence,
    actorId: ACTOR, actorType: "user", now,
  });
  const writes = h4cFinalWriteSet({
    businessWrites, audit, orgId: ORG, jobId: JOB_ID, sequence, now,
  });
  const refs = evidenceAppendRefs({
    job: JOB, expectedHead: null, proofId: PROOF_ID,
    writeEpoch: WRITE_EPOCH, auditId: audit._id, config: CONFIG,
  });
  const precheck = s3Precheck("genesis");
  const admission = mintH4cAdmission({ precheck, refs, writes, config: CONFIG, now });
  return { state, businessWrites, audit, writes, refs, precheck, admission, sequence, now };
}

function s3AppendContext({ now = NOW + 1_000 } = {}) {
  const chain = chainFor(2);
  const state = s2State(chain);
  const args = appendArgs({
    expectedHead: chain.head,
    decision: "confirmed_present",
    observedAt: OBSERVED + 10,
    now,
  });
  const businessWrites = appendEvidenceWrites(state, args);
  const evidenceWrite = businessWrites.find((item) => item.collection === H4C.evidence);
  const sequence = evidenceWrite.data.sequence;
  const targetList = businessWrites.map((item) => `${item.collection}/${item.id}`).sort();
  const audit = evidenceC1AuditRecord({
    orgId: ORG, jobId: JOB_ID, targetList, sequence,
    actorId: ACTOR, actorType: "user", now,
  });
  const writes = h4cFinalWriteSet({
    businessWrites, audit, orgId: ORG, jobId: JOB_ID, sequence, now,
  });
  const refs = evidenceAppendRefs({
    job: JOB, expectedHead: chain.head, proofId: PROOF_ID,
    writeEpoch: WRITE_EPOCH, auditId: audit._id, config: CONFIG,
  });
  const precheck = s3Precheck("append");
  const admission = mintH4cAdmission({ precheck, refs, writes, config: CONFIG, now });
  return {
    state, chain, businessWrites, audit, writes, refs, precheck, admission,
    sequence, now,
  };
}

test("S3 precheck is exact, digest-free and runtime-only (S3-01/S3-09)", () => {
  const { precheck } = s3GenesisContext();
  assert.equal(validateH4cPrecheck(precheck), undefined);
  const variants = [
    ["missing proofId", (copy) => { delete copy.proofId; }],
    ["missing policy", (copy) => { delete copy.admissionPolicyVersion; }],
    ["extra refsDigest", (copy) => { copy.refsDigest = "a".repeat(64); }],
    ["extra ticket", (copy) => { copy.ticket = ""; }],
    ["extra operationAuthDigest", (copy) => { copy.operationAuthDigest = null; }],
    ["control kind", (copy) => { copy.kind = "migration"; }],
    ["control operation", (copy) => { copy.operation = "k3-domain-bootstrap"; }],
    ["unknown operation", (copy) => { copy.operation = "recover"; }],
    ["zero epoch", (copy) => { copy.writeEpoch = 0; }],
    ["fractional epoch", (copy) => { copy.writeEpoch = 1.5; }],
    ["empty policy", (copy) => { copy.admissionPolicyVersion = ""; }],
    ["uppercase writer digest", (copy) => { copy.writerSetDigest = "A".repeat(64); }],
    ["empty proofId", (copy) => { copy.proofId = ""; }],
    ["numeric proofId", (copy) => { copy.proofId = 7; }],
  ];
  for (const [label, mutate] of variants) {
    const copy = structuredClone(precheck);
    mutate(copy);
    s3Reject([copy], S3_ADMISSION, () => validateH4cPrecheck(copy));
    assert.ok(label.length > 0);
  }
  for (const bad of [null, undefined, [], "precheck", 7]) {
    assert.throws(() => validateH4cPrecheck(bad), rejectCode(S3_ADMISSION));
  }
});

test("S3 finalWriteSet is 3/2 business writes plus exactly one explicit audit (S3-04/S3-13)", () => {
  const genesis = s3GenesisContext();
  const append = s3AppendContext();
  assert.equal(genesis.businessWrites.length, 3);
  assert.equal(genesis.writes.length, 4);
  assert.equal(append.businessWrites.length, 2);
  assert.equal(append.writes.length, 3);
  for (const [label, context] of [["genesis", genesis], ["append", append]]) {
    assert.equal(context.writes.filter(
      (item) => item.collection === H4C_AUDIT_COLLECTION).length, 1, label);
    assert.equal(context.writes.some((item) => [
      H4C.domains, H4C.auditProofs, H4C.fences, H4C.k3Markers, H4C.plans,
    ].includes(item.collection)), false, label);
    assert.ok(context.writes.every((item) => item.data._id === item.id), label);
    assert.deepEqual(Object.keys(context.audit).sort(), [
      "_id", "action", "actorId", "actorType", "createdAt", "orgId", "target",
    ], label);
  }
  s3Reject([genesis.businessWrites], S3_ADMISSION, () => h4cFinalWriteSet({
    businessWrites: genesis.businessWrites, audit: null,
    orgId: ORG, jobId: JOB_ID, sequence: 1, now: NOW,
  }));
  s3Reject([genesis.businessWrites, genesis.audit], S3_ADMISSION,
    () => h4cFinalWriteSet({
      businessWrites: [...genesis.businessWrites, genesis.writes[3]],
      audit: genesis.audit, orgId: ORG, jobId: JOB_ID, sequence: 1, now: NOW,
    }));
  s3Reject([genesis.writes, genesis.refs], S3_ADMISSION, () => validateH4cAdmission({
    admission: genesis.admission, refs: genesis.refs,
    writes: genesis.businessWrites, config: CONFIG,
  }));
  const auditIndex = genesis.refs.findIndex(
    (item) => item.collection === H4C_AUDIT_COLLECTION);
  const refsWithoutAudit = genesis.refs.map((item, index) => index === auditIndex
    ? { ...item, id: "audit-h4c-v1:" + "f".repeat(32) } : item);
  s3Reject([genesis.writes, refsWithoutAudit], S3_ADMISSION, () => validateH4cAdmission({
    admission: genesis.admission, refs: refsWithoutAudit, writes: genesis.writes,
    config: CONFIG,
  }));
  const shortTargetList = genesis.businessWrites.slice(1)
    .map((item) => `${item.collection}/${item.id}`).sort();
  const mismatchedAudit = evidenceC1AuditRecord({
    orgId: ORG, jobId: JOB_ID, targetList: shortTargetList, sequence: 1,
    actorId: ACTOR, actorType: "user", now: NOW,
  });
  s3Reject([genesis.businessWrites, mismatchedAudit], S3_ADMISSION,
    () => h4cFinalWriteSet({
      businessWrites: genesis.businessWrites, audit: mismatchedAudit,
      orgId: ORG, jobId: JOB_ID, sequence: 1, now: NOW,
    }));
});

test("S3 D4b audit formula V06-V09 holds through finalWriteSet (S3-05/S3-06)", () => {
  const genesis = s3GenesisContext();
  const append = s3AppendContext();
  for (const [label, context] of [["genesis", genesis], ["append", append]]) {
    const targetList = context.businessWrites
      .map((item) => `${item.collection}/${item.id}`).sort();
    assert.equal(context.audit.orgId, ORG, label);
    assert.equal(context.audit.action, label === "genesis"
      ? "h4c.evidence.genesis" : "h4c.evidence.append", label);
    assert.equal(context.audit.target, targetList.join(", "), label);
    assert.equal(context.audit.createdAt, context.now, label);
    assert.equal(context.audit._id, evidenceC1AuditId({
      orgId: ORG, scopeKey: JOB_ID, action: context.audit.action,
      targetList, revision: context.sequence,
    }), label);
  }
  const genesisTarget = genesis.businessWrites
    .map((item) => `${item.collection}/${item.id}`).sort();
  const wrongScope = evidenceC1AuditRecord({
    orgId: ORG, jobId: "job-other", targetList: genesisTarget, sequence: 1,
    actorId: ACTOR, actorType: "user", now: NOW,
  });
  s3Reject([genesis.businessWrites, wrongScope], S3_ADMISSION, () => h4cFinalWriteSet({
    businessWrites: genesis.businessWrites, audit: wrongScope,
    orgId: ORG, jobId: JOB_ID, sequence: 1, now: NOW,
  }));
  const wrongAction = structuredClone(genesis.audit);
  wrongAction.action = "h4c.evidence.append";
  wrongAction._id = evidenceC1AuditId({
    orgId: ORG, scopeKey: JOB_ID, action: "h4c.evidence.append",
    targetList: genesisTarget, revision: 1,
  });
  s3Reject([genesis.businessWrites, wrongAction], S3_ADMISSION, () => h4cFinalWriteSet({
    businessWrites: genesis.businessWrites, audit: wrongAction,
    orgId: ORG, jobId: JOB_ID, sequence: 1, now: NOW,
  }));
  const wrongRevision = evidenceC1AuditRecord({
    orgId: ORG, jobId: JOB_ID, targetList: genesisTarget, sequence: 2,
    actorId: ACTOR, actorType: "user", now: NOW,
  });
  s3Reject([genesis.businessWrites, wrongRevision], S3_ADMISSION, () => h4cFinalWriteSet({
    businessWrites: genesis.businessWrites, audit: wrongRevision,
    orgId: ORG, jobId: JOB_ID, sequence: 1, now: NOW,
  }));
  const badTargetLists = [
    [...genesisTarget].reverse(),
    [...genesisTarget, `${H4C_AUDIT_COLLECTION}/audit-h4c-v1:` + "a".repeat(32)],
    [...genesisTarget, genesisTarget[0]],
  ];
  for (const targetList of badTargetLists) {
    assert.throws(() => evidenceC1AuditRecord({
      orgId: ORG, jobId: JOB_ID, targetList, sequence: 1,
      actorId: ACTOR, actorType: "user", now: NOW,
    }), rejectCode(S3_ADMISSION));
  }
  const extraField = structuredClone(genesis.audit);
  extraField.extra = "x";
  s3Reject([genesis.businessWrites, extraField], S3_ADMISSION, () => h4cFinalWriteSet({
    businessWrites: genesis.businessWrites, audit: extraField,
    orgId: ORG, jobId: JOB_ID, sequence: 1, now: NOW,
  }));
  const missingField = structuredClone(genesis.audit);
  delete missingField.target;
  s3Reject([genesis.businessWrites, missingField], S3_ADMISSION, () => h4cFinalWriteSet({
    businessWrites: genesis.businessWrites, audit: missingField,
    orgId: ORG, jobId: JOB_ID, sequence: 1, now: NOW,
  }));
  const staleNow = evidenceC1AuditRecord({
    orgId: ORG, jobId: JOB_ID, targetList: genesisTarget, sequence: 1,
    actorId: ACTOR, actorType: "user", now: NOW - 1,
  });
  s3Reject([genesis.businessWrites, staleNow], S3_ADMISSION, () => h4cFinalWriteSet({
    businessWrites: genesis.businessWrites, audit: staleNow,
    orgId: ORG, jobId: JOB_ID, sequence: 1, now: NOW,
  }));
  const wrongTarget = structuredClone(genesis.audit);
  wrongTarget.target = "x/y";
  s3Reject([genesis.businessWrites, wrongTarget], S3_ADMISSION, () => h4cFinalWriteSet({
    businessWrites: genesis.businessWrites, audit: wrongTarget,
    orgId: ORG, jobId: JOB_ID, sequence: 1, now: NOW,
  }));
});

test("S3 refs digest sorts without de-duplicating; reorder positive, mutation negative (S3-02)", () => {
  const genesis = s3GenesisContext();
  const reversedRefs = [...genesis.refs].reverse();
  assert.equal(h4cRefsDigest(reversedRefs), h4cRefsDigest(genesis.refs));
  assert.equal(validateH4cAdmission({
    admission: genesis.admission, refs: reversedRefs, writes: genesis.writes,
    config: CONFIG,
  }), undefined);
  assert.deepEqual(mintH4cAdmission({
    precheck: genesis.precheck, refs: reversedRefs, writes: genesis.writes,
    config: CONFIG, now: genesis.now,
  }), genesis.admission);
  const duplicateRefs = [...genesis.refs, { ...genesis.refs[0] }];
  const duplicateDigest = h4cRefsDigest(duplicateRefs);
  assert.match(duplicateDigest, /^[0-9a-f]{64}$/);
  assert.notEqual(duplicateDigest, h4cRefsDigest(genesis.refs));
  assert.equal(AdmissionValid(genesis.admission, duplicateRefs, genesis.writes, CONFIG), false);
  s3Reject([genesis.writes, duplicateRefs], S3_ADMISSION, () => validateH4cAdmission({
    admission: genesis.admission, refs: duplicateRefs, writes: genesis.writes,
    config: CONFIG,
  }));
  const added = [...genesis.refs, { collection: H4C.fences, id: "extra-fence" }];
  const removed = genesis.refs.slice(0, 17);
  const replaced = genesis.refs.map((item) => item.collection === H4C.auditProofs
    ? { ...item, id: "evidence-chain-audit:v1:" + "0".repeat(64) + ":1:4" } : item);
  const tampered = genesis.refs.map((item) => item.collection === H4C.evidence &&
    item.id === evidenceId(ORG, JOB_ID, 9) ? { ...item, id: item.id + "x" } : item);
  const extraKey = genesis.refs.map((item, index) => index === 0
    ? { ...item, extra: "x" } : item);
  for (const [label, refs] of [
    ["added", added], ["removed", removed], ["replaced", replaced], ["tampered", tampered],
    ["extra-key", extraKey],
  ]) {
    s3Reject([genesis.writes, refs], S3_ADMISSION, () => validateH4cAdmission({
      admission: genesis.admission, refs, writes: genesis.writes, config: CONFIG,
    }));
    assert.ok(label.length > 0);
  }
  const replacedAdmission = structuredClone(genesis.admission);
  replacedAdmission.refsDigest = h4cRefsDigest(replaced);
  replacedAdmission.ticket = h4cAdmissionTicketDigest(replacedAdmission, CONFIG);
  assert.equal(AdmissionValid(replacedAdmission, replaced, genesis.writes, CONFIG), true);
  s3Reject([genesis.writes, replaced, replacedAdmission], S3_ADMISSION,
    () => validateH4cAdmission({
      admission: replacedAdmission, refs: replaced, writes: genesis.writes,
      config: CONFIG,
    }));
});

test("S3 writes digest binds every finalWriteSet byte including the audit (S3-03)", () => {
  const genesis = s3GenesisContext();
  assert.equal(h4cWritesDigest([...genesis.writes].reverse()),
    h4cWritesDigest(genesis.writes));
  const tamperedBusiness = structuredClone(genesis.writes);
  const evidenceIndex = tamperedBusiness.findIndex(
    (item) => item.collection === H4C.evidence);
  tamperedBusiness[evidenceIndex].data.decision = "confirmed_present";
  assert.notEqual(h4cWritesDigest(tamperedBusiness), genesis.admission.writesDigest);
  s3Reject([genesis.writes, genesis.admission], S3_ADMISSION, () => validateH4cAdmission({
    admission: genesis.admission, refs: genesis.refs, writes: tamperedBusiness,
    config: CONFIG,
  }));
  const tamperedAudit = structuredClone(genesis.writes);
  const auditIndex = tamperedAudit.findIndex(
    (item) => item.collection === H4C_AUDIT_COLLECTION);
  tamperedAudit[auditIndex].data.target = "x/y";
  s3Reject([genesis.writes, genesis.admission], S3_ADMISSION, () => validateH4cAdmission({
    admission: genesis.admission, refs: genesis.refs, writes: tamperedAudit,
    config: CONFIG,
  }));
  const digestDrift = structuredClone(genesis.admission);
  digestDrift.writesDigest = "0".repeat(64);
  s3Reject([genesis.writes, digestDrift], S3_ADMISSION, () => validateH4cAdmission({
    admission: digestDrift, refs: genesis.refs, writes: genesis.writes,
    config: CONFIG,
  }));
});

test("S3 ticket signs the exact fields with explicit null operationAuthDigest (S3-07/S3-08 V10-V13)", () => {
  const genesis = s3GenesisContext();
  const { admission, refs, writes, precheck } = genesis;
  assert.deepEqual(Object.keys(admission).sort(), [
    "admissionPolicyVersion", "kind", "operation", "operationAuthDigest",
    "proofId", "refsDigest", "ticket", "writeEpoch", "writerSetDigest",
    "writesDigest",
  ]);
  const { ticket, ...fields } = admission;
  const raw = createHmac("sha256", Buffer.from(KEY_A, "base64"))
    .update(stableStringify({
      domain: "KEYED_DIGEST/h4-canonical-write-admission", version: 1, ...fields,
    }), "utf8").digest("hex");
  assert.equal(ticket, raw);
  assert.equal(h4cAdmissionTicketDigest({
    ...admission, ticket: "f".repeat(64),
  }, CONFIG), ticket);
  assert.throws(() => mintH4cAdmission({
    precheck, refs, writes, config: CONFIG,
  }), rejectCode(S3_ADMISSION));
  assert.throws(() => mintH4cAdmission({
    precheck, refs, writes, config: CONFIG, now: NOW + 1,
  }), rejectCode(S3_ADMISSION));
  const append = s3AppendContext();
  assert.equal(validateH4cAdmission({
    admission: append.admission, refs: append.refs, writes: append.writes,
    config: CONFIG, precheck: append.precheck,
  }), undefined);
  const authVariants = [
    ["missing", (copy) => { delete copy.operationAuthDigest; }],
    ["undefined", (copy) => { copy.operationAuthDigest = undefined; }],
    ["empty", (copy) => { copy.operationAuthDigest = ""; }],
    ["digest", (copy) => { copy.operationAuthDigest = "a".repeat(64); }],
  ];
  for (const [label, mutate] of authVariants) {
    const copy = structuredClone(admission);
    mutate(copy);
    s3Reject([copy, refs, writes], S3_ADMISSION, () => validateH4cAdmission({
      admission: copy, refs, writes, config: CONFIG,
    }));
    assert.ok(label.length > 0);
  }
  for (const overrides of [
    { kind: "migration" }, { kind: "recovery" }, { kind: "monitor" },
    { kind: "k3-bootstrap" }, { operation: "plan-issue" }, { operation: "recover" },
  ]) {
    const copy = structuredClone(admission);
    Object.assign(copy, overrides);
    copy.operationAuthDigest = null;
    copy.ticket = h4cAdmissionTicketDigest(copy, CONFIG);
    s3Reject([copy, refs, writes], S3_ADMISSION, () => validateH4cAdmission({
      admission: copy, refs, writes, config: CONFIG,
    }));
  }
  const proofIdDrift = structuredClone(admission);
  proofIdDrift.proofId = "evidence-chain-audit:v1:" + "0".repeat(64) + ":1:4";
  s3Reject([proofIdDrift, refs, writes], S3_ADMISSION, () => validateH4cAdmission({
    admission: proofIdDrift, refs, writes, config: CONFIG,
  }));
  const precheckDrift = { ...precheck, proofId: proofIdDrift.proofId };
  assert.throws(() => validateH4cAdmission({
    admission, refs, writes, config: CONFIG, precheck: precheckDrift,
  }), rejectCode(S3_ADMISSION));
  for (const field of ["writeEpoch", "writerSetDigest", "admissionPolicyVersion"]) {
    const copy = { ...precheck };
    if (field === "writeEpoch") copy.writeEpoch = precheck.writeEpoch + 1;
    else if (field === "writerSetDigest") copy.writerSetDigest = "b".repeat(64);
    else copy.admissionPolicyVersion = "policy-v2";
    assert.throws(() => validateH4cAdmission({
      admission, refs, writes, config: CONFIG, precheck: copy,
    }), rejectCode(S3_ADMISSION));
  }
  for (const field of ["refsDigest", "writesDigest"]) {
    const copy = structuredClone(admission);
    copy[field] = "0".repeat(64);
    s3Reject([copy], S3_ADMISSION, () => validateH4cAdmission({
      admission: copy, refs, writes, config: CONFIG,
    }));
  }
  for (const [field, value] of [
    ["writeEpoch", 0], ["proofId", 7], ["kind", "runtime2"],
    ["operation", "recover"], ["ticket", "0".repeat(64)],
  ]) {
    const copy = structuredClone(admission);
    copy[field] = value;
    if (field !== "ticket") copy.ticket = h4cAdmissionTicketDigest(copy, CONFIG);
    s3Reject([copy], S3_ADMISSION, () => validateH4cAdmission({
      admission: copy, refs, writes, config: CONFIG,
    }));
  }
  const extra = structuredClone(admission);
  extra.extraField = "x";
  extra.ticket = h4cAdmissionTicketDigest(extra, CONFIG);
  s3Reject([extra], S3_ADMISSION, () => validateH4cAdmission({
    admission: extra, refs, writes, config: CONFIG,
  }));
});

test("S3 rejects the legacy no-ticket path and keeps chain errors ahead of admission (S3-01/S3-10/S3-11)", () => {
  const genesis = s3GenesisContext();
  s3Reject([genesis.businessWrites, genesis.refs], S3_ADMISSION, () => validateH4cAdmission({
    admission: null, refs: genesis.refs, writes: genesis.businessWrites,
    config: CONFIG,
  }));
  const append = s3AppendContext();
  const damaged = structuredClone(append.state);
  delete damaged[`${H4C.evidence}/${evidenceId(ORG, JOB_ID, 1)}`];
  s3Reject([damaged], "EVIDENCE_CHAIN_BROKEN", () => appendEvidenceWrites(
    damaged, appendArgs({
      expectedHead: append.chain.head, decision: "confirmed_present",
      observedAt: OBSERVED + 20, now: NOW + 2_000,
    })));
  assert.equal(validateH4cAdmission({
    admission: append.admission, refs: append.refs, writes: append.writes,
    config: CONFIG,
  }), undefined);
  const admissionCopy = structuredClone(genesis.admission);
  admissionCopy.ticket = "0".repeat(64);
  s3Reject([
    genesis.state, genesis.refs, genesis.precheck, genesis.admission, genesis.writes,
  ], S3_ADMISSION, () => validateH4cAdmission({
    admission: admissionCopy, refs: genesis.refs, writes: genesis.writes,
    config: CONFIG, precheck: genesis.precheck,
  }));
});

test("S3 keeps proof-body errors separate from ticket/admission errors (S3-19)", () => {
  const genesis = s3GenesisContext();
  const args = {
    admission: genesis.admission, refs: genesis.refs, writes: genesis.writes,
    state: genesis.state, config: CONFIG, precheck: genesis.precheck,
  };
  assert.equal(validateH4cAdmissionProof(args), undefined);
  const missing = structuredClone(genesis.state);
  delete missing[`${H4C.auditProofs}/${PROOF_ID}`];
  s3Reject([missing], S3_PROOF,
    () => validateH4cAdmissionProof({ ...args, state: missing }));
  const idMismatch = structuredClone(genesis.state);
  idMismatch[`${H4C.auditProofs}/${PROOF_ID}`]._id =
    "evidence-chain-audit:v1:" + "0".repeat(64) + ":1:4";
  s3Reject([idMismatch], S3_PROOF,
    () => validateH4cAdmissionProof({ ...args, state: idMismatch }));
  const hmacDrift = structuredClone(genesis.state);
  hmacDrift[`${H4C.auditProofs}/${PROOF_ID}`].auditDigest = "0".repeat(64);
  s3Reject([hmacDrift], S3_PROOF,
    () => validateH4cAdmissionProof({ ...args, state: hmacDrift }));
  const admissionDrift = structuredClone(genesis.admission);
  admissionDrift.proofId = "evidence-chain-audit:v1:" + "d".repeat(64) + ":1:4";
  s3Reject([admissionDrift, missing], S3_ADMISSION, () => validateH4cAdmissionProof({
    ...args, admission: admissionDrift, state: missing,
  }));
  const resigned = structuredClone(genesis.admission);
  resigned.proofId = "evidence-chain-audit:v1:" + "d".repeat(64) + ":1:4";
  const refsForMissing = genesis.refs.map((item) => item.collection === H4C.auditProofs
    ? { ...item, id: resigned.proofId } : item);
  resigned.refsDigest = h4cRefsDigest(refsForMissing);
  resigned.ticket = h4cAdmissionTicketDigest(resigned, CONFIG);
  assert.throws(() => validateH4cAdmissionProof({
    ...args, admission: resigned, refs: refsForMissing,
  }), rejectCode(S3_ADMISSION));
  assert.throws(() => validateH4cAdmissionProof({
    ...args, admission: resigned, refs: refsForMissing, precheck: undefined,
    state: missing,
  }), rejectCode(S3_PROOF));
  const proofDrift = structuredClone(genesis.state);
  const driftedProof = proofDrift[`${H4C.auditProofs}/${PROOF_ID}`];
  driftedProof.writerSetDigest = "c".repeat(64);
  driftedProof.auditDigest = h4cAuditProofDigest(driftedProof, CONFIG);
  assert.equal(validateH4cAuditProofRecord(driftedProof, CONFIG), undefined);
  s3Reject([proofDrift], S3_ADMISSION,
    () => validateH4cAdmissionProof({ ...args, state: proofDrift }));
  const badAdmission = structuredClone(genesis.admission);
  badAdmission.writesDigest = "0".repeat(64);
  assert.throws(() => validateH4cAdmissionProof({
    ...args, admission: badAdmission, state: missing,
  }), rejectCode(S3_ADMISSION));
});

test("S3 rejects a second audit appended after signing without re-signing (S3-20)", () => {
  const genesis = s3GenesisContext();
  const targetList = genesis.businessWrites
    .map((item) => `${item.collection}/${item.id}`).sort();
  const secondAudit = evidenceC1AuditRecord({
    orgId: ORG, jobId: JOB_ID, targetList, sequence: 2,
    actorId: ACTOR, actorType: "user", now: NOW + 1,
  });
  const tampered = structuredClone(genesis.writes);
  tampered.push({
    collection: H4C_AUDIT_COLLECTION, id: secondAudit._id, data: secondAudit,
  });
  assert.equal(tampered.length, 5);
  assert.notEqual(h4cWritesDigest(tampered), genesis.admission.writesDigest);
  assert.equal(AdmissionValid(genesis.admission, genesis.refs, tampered, CONFIG), false);
  s3Reject([
    genesis.state, genesis.refs, genesis.precheck, genesis.admission, genesis.writes,
  ], S3_ADMISSION, () => validateH4cAdmission({
    admission: genesis.admission, refs: genesis.refs, writes: tampered,
    config: CONFIG,
  }));
  const resigned = structuredClone(genesis.admission);
  resigned.writesDigest = h4cWritesDigest(tampered);
  resigned.ticket = h4cAdmissionTicketDigest(resigned, CONFIG);
  s3Reject([
    genesis.state, genesis.refs, genesis.precheck, genesis.admission, genesis.writes,
    tampered, resigned,
  ], S3_ADMISSION, () => validateH4cAdmission({
    admission: resigned, refs: genesis.refs, writes: tampered, config: CONFIG,
  }));
  assert.equal(validateH4cAdmission({
    admission: genesis.admission, refs: genesis.refs, writes: genesis.writes,
    config: CONFIG,
  }), undefined);
});

test("S3 synthetic concurrency: refreshed state rejects the losing genesis/append (S3-12)", () => {
  const genesis = s3GenesisContext();
  const stateAfterGenesis = structuredClone(genesis.state);
  applyStateWrites(stateAfterGenesis, genesis.writes);
  assert.equal(stateAfterGenesis[
    `${H4C.evidence}/${evidenceId(ORG, JOB_ID, 1)}`].sequence, 1);
  s3Reject([stateAfterGenesis], "EVIDENCE_CHAIN_BROKEN",
    () => appendEvidenceWrites(stateAfterGenesis, appendArgs()));
  assert.equal(validateH4cAdmission({
    admission: genesis.admission, refs: genesis.refs, writes: genesis.writes,
    config: CONFIG,
  }), undefined);
  const refreshedGenesisHead = stateAfterGenesis[
    `${H4C.evidenceHeads}/${evidenceHeadId(ORG, JOB_ID)}`];
  const nextGenesisBusiness = appendEvidenceWrites(stateAfterGenesis, appendArgs({
    expectedHead: refreshedGenesisHead, observedAt: OBSERVED + 10, now: NOW + 1_000,
  }));
  const nextGenesisSequence = nextGenesisBusiness.find(
    (item) => item.collection === H4C.evidence).data.sequence;
  const nextGenesisTargets = nextGenesisBusiness
    .map((item) => `${item.collection}/${item.id}`).sort();
  const nextGenesisAudit = evidenceC1AuditRecord({
    orgId: ORG, jobId: JOB_ID, targetList: nextGenesisTargets,
    sequence: nextGenesisSequence, actorId: ACTOR, actorType: "user", now: NOW + 1_000,
  });
  const nextGenesisWrites = h4cFinalWriteSet({
    businessWrites: nextGenesisBusiness, audit: nextGenesisAudit,
    orgId: ORG, jobId: JOB_ID, sequence: nextGenesisSequence, now: NOW + 1_000,
  });
  const nextGenesisRefs = evidenceAppendRefs({
    job: JOB, expectedHead: refreshedGenesisHead, proofId: PROOF_ID,
    writeEpoch: WRITE_EPOCH, auditId: nextGenesisAudit._id, config: CONFIG,
  });
  s3Reject([
    genesis.state, genesis.refs, genesis.precheck, genesis.admission, genesis.writes,
    nextGenesisWrites, nextGenesisRefs,
  ], S3_ADMISSION, () => validateH4cAdmission({
    admission: genesis.admission, refs: nextGenesisRefs, writes: nextGenesisWrites,
    config: CONFIG,
  }));
  const append = s3AppendContext();
  const stateAfterAppend = structuredClone(append.state);
  applyStateWrites(stateAfterAppend, append.writes);
  s3Reject([stateAfterAppend], "EVIDENCE_HEAD_CONFLICT",
    () => appendEvidenceWrites(stateAfterAppend, appendArgs({
      expectedHead: append.chain.head, decision: "confirmed_present",
      observedAt: OBSERVED + 20, now: NOW + 2_000,
    })));
  assert.equal(validateH4cAdmission({
    admission: append.admission, refs: append.refs, writes: append.writes,
    config: CONFIG,
  }), undefined);
  const refreshedAppendHead = stateAfterAppend[
    `${H4C.evidenceHeads}/${evidenceHeadId(ORG, JOB_ID)}`];
  const nextAppendBusiness = appendEvidenceWrites(stateAfterAppend, appendArgs({
    expectedHead: refreshedAppendHead, decision: "still_unknown",
    observedAt: OBSERVED + 30, now: NOW + 3_000,
  }));
  const nextAppendSequence = nextAppendBusiness.find(
    (item) => item.collection === H4C.evidence).data.sequence;
  const nextAppendTargets = nextAppendBusiness
    .map((item) => `${item.collection}/${item.id}`).sort();
  const nextAppendAudit = evidenceC1AuditRecord({
    orgId: ORG, jobId: JOB_ID, targetList: nextAppendTargets,
    sequence: nextAppendSequence, actorId: ACTOR, actorType: "user", now: NOW + 3_000,
  });
  const nextAppendWrites = h4cFinalWriteSet({
    businessWrites: nextAppendBusiness, audit: nextAppendAudit,
    orgId: ORG, jobId: JOB_ID, sequence: nextAppendSequence, now: NOW + 3_000,
  });
  const nextAppendRefs = evidenceAppendRefs({
    job: JOB, expectedHead: refreshedAppendHead, proofId: PROOF_ID,
    writeEpoch: WRITE_EPOCH, auditId: nextAppendAudit._id, config: CONFIG,
  });
  s3Reject([
    append.state, append.refs, append.precheck, append.admission, append.writes,
    nextAppendWrites, nextAppendRefs,
  ], S3_ADMISSION, () => validateH4cAdmission({
    admission: append.admission, refs: nextAppendRefs, writes: nextAppendWrites,
    config: CONFIG,
  }));
  const ticketDrift = structuredClone(append.admission);
  ticketDrift.ticket = "0".repeat(64);
  assert.throws(() => validateH4cAdmission({
    admission: ticketDrift, refs: append.refs, writes: append.writes,
    config: CONFIG,
  }), rejectCode(S3_ADMISSION));
});

test("S3 negative classes leave the complete input snapshot untouched (S3-11)", () => {
  const genesis = s3GenesisContext();
  const append = s3AppendContext();
  const snapshot = (context) => [
    context.state, context.refs, context.precheck, context.admission, context.writes,
  ];
  const cases = [
    ["precheck", genesis, S3_ADMISSION, () => {
      const copy = structuredClone(genesis.precheck);
      copy.kind = "migration";
      return validateH4cPrecheck(copy);
    }],
    ["audit", genesis, S3_ADMISSION, () => {
      const copy = structuredClone(genesis.audit);
      copy.target = "x/y";
      return h4cFinalWriteSet({
        businessWrites: genesis.businessWrites, audit: copy,
        orgId: ORG, jobId: JOB_ID, sequence: 1, now: NOW,
      });
    }],
    ["refs", genesis, S3_ADMISSION, () => validateH4cAdmission({
      admission: genesis.admission, refs: genesis.refs.slice(0, 17),
      writes: genesis.writes, config: CONFIG,
    })],
    ["ticket", genesis, S3_ADMISSION, () => {
      const copy = structuredClone(genesis.admission);
      copy.ticket = "0".repeat(64);
      return validateH4cAdmission({
        admission: copy, refs: genesis.refs, writes: genesis.writes, config: CONFIG,
      });
    }],
    ["writes", genesis, S3_ADMISSION, () => {
      const copy = structuredClone(genesis.writes);
      copy[0] = { ...copy[0], data: { ...copy[0].data, createdAt: NOW + 1 } };
      return validateH4cAdmission({
        admission: genesis.admission, refs: genesis.refs, writes: copy, config: CONFIG,
      });
    }],
    ["proof", genesis, S3_PROOF, () => {
      const state = structuredClone(genesis.state);
      delete state[`${H4C.auditProofs}/${PROOF_ID}`];
      return validateH4cAdmissionProof({
        admission: genesis.admission, refs: genesis.refs, writes: genesis.writes,
        state, config: CONFIG,
      });
    }],
    ["append ticket", append, S3_ADMISSION, () => {
      const copy = structuredClone(append.admission);
      copy.operationAuthDigest = "";
      return validateH4cAdmission({
        admission: copy, refs: append.refs, writes: append.writes, config: CONFIG,
      });
    }],
  ];
  for (const [label, context, code, fn] of cases) {
    const values = snapshot(context);
    const before = values.map((value) => structuredClone(value));
    assert.throws(fn, rejectCode(code), label);
    values.forEach((value, index) => assert.deepEqual(value, before[index], label));
  }
});

test("S3 service index re-exports only the pure authorization additions", async () => {
  const service = await import("../lib/face-service/index.mjs");
  for (const name of [
    "h4cFinalWriteSet", "mintH4cAdmission", "validateH4cAdmission",
    "validateH4cAdmissionProof", "validateH4cPrecheck",
  ]) {
    assert.equal(typeof service[name], "function", name);
  }
  for (const name of ["initializeEvidenceDomain", "bootstrapEvidenceDomain",
    "createEvidenceDomain", "ensureEvidenceDomain"]) {
    assert.equal(name in service, false, name);
  }
});
