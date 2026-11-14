import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";

import { CloudStore, LocalStore, seed } from "../lib/store.mjs";
import {
  EVIDENCE_COLLECTION,
  EVIDENCE_DIGEST_ALGORITHM,
  EVIDENCE_DIGEST_ALGORITHM_VERSION,
  EVIDENCE_DIGEST_DOMAIN,
  EVIDENCE_DOMAINS_COLLECTION,
  EVIDENCE_HEADS_COLLECTION,
  EVIDENCE_SCHEMA_VERSION,
  appendEvidenceWrites,
  applyEvidenceDomain,
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
const ref = (collection, id) => ({ collection, id });

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

async function runAppend(store, {
  job = JOB,
  config = CONFIG,
  now = NOW,
  decision = "still_unknown",
  sourceType = "operator",
  sourceCode = SOURCE_CODES[decision],
  observedAt = OBSERVED,
  head,
  expectedHead,
  domainHead,
  hasExistingEvidence,
  extraRefs = [],
  onBuild,
} = {}) {
  const actualHead = head !== undefined
    ? head
    : await store.get(EVIDENCE_HEADS_COLLECTION, evidenceHeadId(job.orgId, job._id), job.orgId);
  const actualDomainHead = domainHead !== undefined
    ? domainHead
    : await store.get(EVIDENCE_DOMAINS_COLLECTION,
      evidenceDomainIds(config.realm, config.version).headId);
  const exists = hasExistingEvidence !== undefined
    ? hasExistingEvidence
    : (await store.list(EVIDENCE_COLLECTION, job.orgId))
      .some((row) => row.jobId === job._id);
  const refs = evidenceAppendRefs(job, actualHead, actualDomainHead, config);
  return store.transact([...refs, ...extraRefs], (state) => {
    const writes = appendEvidenceWrites(state, {
      job,
      expectedHead: expectedHead !== undefined ? expectedHead : actualHead,
      hasExistingEvidence: exists,
      config,
      now,
      decision,
      sourceType,
      sourceCode,
      observedAt,
      actorId: ACTOR,
    });
    onBuild?.(writes, refs);
    return writes;
  }, AUDIT);
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

function assertNoEvidenceWrites(store) {
  assert.deepEqual(store.data[EVIDENCE_COLLECTION], []);
  assert.deepEqual(store.data[EVIDENCE_HEADS_COLLECTION], []);
  assert.deepEqual(store.data[EVIDENCE_DOMAINS_COLLECTION], []);
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

test("evidence/head/domain IDs are deterministic and scoped", () => {
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
  assert.equal(ids.headId, "evidence-digest-domain:" + Buffer.from("h4c-realm").toString("base64url"));
  assert.equal(ids.versionId, ids.headId.replace("evidence-digest-domain:", "evidence-digest-domain-version:") + ":1");
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

test("domain validator is exact for head and version records", () => {
  const { head, version } = makeDomainRecords();
  assert.equal(validateEvidenceDomainRecord(head), undefined);
  assert.equal(validateEvidenceDomainRecord(version), undefined);
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
    () => validateEvidenceDomainRecord({ ...version, enabledAt: -1 }),
    () => validateEvidenceDomainRecord(null),
    () => validateEvidenceDomainRecord([]),
  ];
  for (const failure of failures) assert.throws(failure, rejectCode("DOMAIN_INCOMPLETE"));
});

test("domain guard creates head and version once and never mutates input", () => {
  const state = domainState(CONFIG, null, null);
  const before = structuredClone(state);
  const writes = applyEvidenceDomain(state, { ...CONFIG, now: NOW });
  assert.equal(writes.length, 2);
  assert.deepEqual(state, before);
  assert.equal(writes[0].collection, EVIDENCE_DOMAINS_COLLECTION);
  assert.equal(writes[0].data.kind, "head");
  assert.equal(writes[1].data.kind, "version");
  for (const write of writes) assert.equal(validateEvidenceDomainRecord(write.data), undefined);

  const next = { ...state };
  for (const write of writes) next[`${write.collection}/${write.id}`] = write.data;
  assert.deepEqual(applyEvidenceDomain(next, { ...CONFIG, now: NOW }), []);
  assert.deepEqual(next, { ...state, ...Object.fromEntries(writes.map((w) => [
    `${w.collection}/${w.id}`, w.data,
  ])) });
});

test("domain guard rejects one-sided and corrupt domains without backfill", () => {
  const { head, version } = makeDomainRecords();
  const cases = [
    ["head only", domainState(CONFIG, head, null)],
    ["version only", domainState(CONFIG, null, version)],
    ["head kind swapped", domainState(CONFIG, version, version)],
    ["version kind swapped", domainState(CONFIG, head, head)],
    ["head unknown field", domainState(CONFIG, { ...head, extra: 1 }, version)],
    ["version unknown field", domainState(CONFIG, head, { ...version, extra: 1 })],
    ["internal version mismatch", domainState(CONFIG, head, { ...version, keyVersion: 2 })],
    ["internal fingerprint mismatch", domainState(CONFIG, head, {
      ...version, keyFingerprint: "0".repeat(64),
    })],
    ["head realm mismatch", domainState(CONFIG, { ...head, realm: "other-realm" }, version)],
  ];
  for (const [name, state] of cases) {
    const before = structuredClone(state);
    assert.throws(() => applyEvidenceDomain(state, { ...CONFIG, now: NOW }),
      rejectCode("DOMAIN_INCOMPLETE"), name);
    assert.deepEqual(state, before, name);
  }
});

test("domain guard fails closed on version changes and same-version rekey", () => {
  const records = makeDomainRecords(CONFIG);
  const complete = domainState(CONFIG, records.head, records.version);
  const before = structuredClone(complete);
  assert.deepEqual(applyEvidenceDomain(complete, { ...CONFIG, now: NOW }), []);
  assert.deepEqual(complete, before);

  const rekeyed = evidenceKeyConfig({ ...ENV_A, H4_EVIDENCE_HMAC_KEY_B64: KEY_B });
  assert.throws(() => applyEvidenceDomain(complete, { ...rekeyed, now: NOW }),
    rejectCode("DOMAIN_MISMATCH"));

  const versioned = evidenceKeyConfig({ ...ENV_A, H4_EVIDENCE_KEY_VERSION: "2" });
  assert.throws(() => applyEvidenceDomain(complete, { ...versioned, now: NOW }),
    rejectCode("DOMAIN_MISMATCH"));

  const stateV2 = domainState(versioned, records.head, null);
  assert.throws(() => applyEvidenceDomain(stateV2, { ...versioned, now: NOW }),
    rejectCode("DOMAIN_MISMATCH"), "stable head detects version change even without v2 record");
  assert.throws(() => applyEvidenceDomain(domainState(CONFIG, records.head, null),
    { ...CONFIG, now: NOW }), rejectCode("DOMAIN_INCOMPLETE"), "same version missing record");
});

test("append fails closed on K3 rekey, version change and one-sided domain", async (t) => {
  const store = await localStore(t);
  await runAppend(store);

  const rekeyed = evidenceKeyConfig({ ...ENV_A, H4_EVIDENCE_HMAC_KEY_B64: KEY_B });
  await expectFailure(store, { config: rekeyed }, "DOMAIN_MISMATCH");
  const versioned = evidenceKeyConfig({ ...ENV_A, H4_EVIDENCE_KEY_VERSION: "2" });
  await expectFailure(store, { config: versioned }, "DOMAIN_MISMATCH");

  const headOnly = makeDomainRecords().head;
  const orphanStore = await localStore(t);
  await orphanStore.transact(
    [ref(EVIDENCE_DOMAINS_COLLECTION, headOnly._id)],
    () => [{
      collection: EVIDENCE_DOMAINS_COLLECTION, id: headOnly._id, data: { ...headOnly },
    }],
    AUDIT,
  );
  await expectFailure(orphanStore, {}, "DOMAIN_INCOMPLETE");
  assert.equal(orphanStore.data[EVIDENCE_DOMAINS_COLLECTION].length, 1);
  assert.equal(orphanStore.data[EVIDENCE_DOMAINS_COLLECTION][0].kind, "head");
});

test("first evidence creates the K3 domain, immutable evidence and head", async (t) => {
  const store = await localStore(t);
  let built = null;
  await runAppend(store, {
    onBuild: (writes, refs) => { built = { writes, refs }; },
  });
  assert.equal(built.writes.length, 4);
  for (const write of built.writes) {
    assert.ok(built.refs.some((item) => item.collection === write.collection && item.id === write.id),
      `undeclared write ${write.collection}/${write.id}`);
  }

  assert.equal(store.data[EVIDENCE_DOMAINS_COLLECTION].length, 2);
  assert.equal(store.data[EVIDENCE_COLLECTION].length, 1);
  assert.equal(store.data[EVIDENCE_HEADS_COLLECTION].length, 1);
  assert.deepEqual(store.data.device_operation_logs, []);

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

  const refs = evidenceAppendRefs(JOB, null, null, CONFIG);
  assert.equal(refs.length, 4);
  assert.deepEqual(new Set(refs.map((item) => `${item.collection}/${item.id}`)), new Set([
    `${EVIDENCE_DOMAINS_COLLECTION}/${evidenceDomainIds(CONFIG.realm, CONFIG.version).headId}`,
    `${EVIDENCE_DOMAINS_COLLECTION}/${evidenceDomainIds(CONFIG.realm, CONFIG.version).versionId}`,
    `${EVIDENCE_HEADS_COLLECTION}/${evidenceHeadId(ORG, JOB_ID)}`,
    `${EVIDENCE_COLLECTION}/${evidenceId(ORG, JOB_ID, 1)}`,
  ]));

  const audit = store.data.admin_audit;
  assert.equal(audit.length, 1);
  assert.deepEqual(Object.keys(audit[0]).sort(), [
    "_id", "action", "actorId", "actorType", "createdAt", "orgId", "target",
  ]);
});

test("second evidence validates its parent and CAS-increments the head", async (t) => {
  const store = await localStore(t);
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
  const head = store.data[EVIDENCE_HEADS_COLLECTION][0];
  assert.equal(head.revision, 2);
  assert.equal(head.lastSequence, 2);
  assert.equal(head.lastEvidenceId, second._id);
  assert.equal(head.lastObservedAt, OBSERVED + 100);
  assert.equal(head.createdAt, firstHead.createdAt);
  assert.equal(head.updatedAt, NOW + 1_000);

  const refs = evidenceAppendRefs(JOB, firstHead,
    store.data[EVIDENCE_DOMAINS_COLLECTION].find((row) => row.kind === "head"), CONFIG);
  assert.equal(refs.length, 5);
  assert.ok(refs.some((item) => item.collection === EVIDENCE_COLLECTION &&
    item.id === firstEvidence._id));
});

test("stale head CAS and missing/orphan head fail closed with zero writes", async (t) => {
  const store = await localStore(t);
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

test("damaged previous evidence is chain-broken across schema, identity, time, K3 and HMAC", async (t) => {
  const store = await localStore(t);
  await runAppend(store, { decision: "confirmed_removed" });
  const baseline = structuredClone(store.data);
  const evidenceKey = `${EVIDENCE_COLLECTION}/${baseline[EVIDENCE_COLLECTION][0]._id}`;

  const cases = [
    ["missing digest", (record) => { delete record.digest; }],
    ["unknown field", (record) => { record.rawResponse = "forbidden"; }],
    ["schemaVersion", (record) => { record.schemaVersion = 2; }],
    ["_id", (record) => { record._id = evidenceId(ORG, JOB_ID, 9); }],
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
  await expectFailure(store, { observedAt: JOB.createdAt - 1 }, "EVIDENCE_STALE");
  await expectFailure(store, { observedAt: NOW + 1 }, "EVIDENCE_STALE");
  await expectFailure(store, { observedAt: "3000" }, "EVIDENCE_STALE");
  await expectFailure(store, { now: 1.5, observedAt: OBSERVED }, "EVIDENCE_INVALID");
  assertNoEvidenceWrites(store);

  await runAppend(store);
  await expectFailure(store, { observedAt: OBSERVED - 1, now: NOW + 1_000 }, "EVIDENCE_STALE");
  await expectFailure(store, { observedAt: NOW + 1, now: NOW }, "EVIDENCE_STALE");
  await expectFailure(store, { observedAt: JOB.result.finishedAt - 1, now: NOW + 1_000 },
    "EVIDENCE_STALE");
});

test("decision/source binding and job invariants reject before writing", async (t) => {
  const store = await localStore(t);
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
  await expectFailure(store, { hasExistingEvidence: true }, "EVIDENCE_CHAIN_BROKEN");
  assertNoEvidenceWrites(store);
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

test("CloudStore keeps exact fields and create-only semantics", async (t) => {
  const harness = cloudHarness();
  const store = harness.store;
  await runAppend(store);

  const evidenceId1 = evidenceId(ORG, JOB_ID, 1);
  const evidence = harness.record(EVIDENCE_COLLECTION, evidenceId1);
  assert.equal(validateEvidenceRecord(evidence), undefined);
  assert.equal(Object.hasOwn(evidence, "updatedAt"), false);
  assert.deepEqual(Object.keys(evidence).sort(), Object.keys(makeEvidenceRecord()).sort());

  const headId = evidenceHeadId(ORG, JOB_ID);
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

  const domainId = evidenceDomainIds(CONFIG.realm, CONFIG.version).headId;
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

  await runAppend(store, { observedAt: OBSERVED + 100, now: NOW + 1_000 });
  const updated = harness.record(EVIDENCE_HEADS_COLLECTION, headId);
  assert.equal(updated.revision, 2);
  assert.equal(updated.updatedAt, NOW + 1_000);
  assert.equal(updated.createdAt, NOW);
});

test("persisted evidence, logs and audits contain no secrets or forbidden payloads", async (t) => {
  const store = await localStore(t);
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

test("face-service index exports the C1 evidence surface", async () => {
  const service = await import("../lib/face-service/index.mjs");
  for (const name of [
    "appendEvidenceWrites", "applyEvidenceDomain", "evidenceAppendRefs",
    "evidenceDigest", "evidenceHeadId", "evidenceId", "evidenceKeyConfig",
    "validateEvidenceDomainRecord", "validateEvidenceHead", "validateEvidenceRecord",
  ]) {
    assert.equal(typeof service[name], "function", name);
  }
});
