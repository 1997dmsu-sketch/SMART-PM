import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DRY_RUN_ID, SCENARIOS, INDEXES, SECURITY_CHECKS,
  resolveConfig, dryRunReport,
} from "../probes/db08/manifest.mjs";
import { LocalProbeBackend } from "../probes/db08/backend.mjs";
import {
  identityPhoneProbe, identityWechatProbe, identityDocumentProbe,
  primarySlotProbe, blacklistActivationProbe, occupancyReviewRace,
  organizationIsolationProbe, indexQueryProbe, transactionReferenceProbe,
  roomBatchProbe,
} from "../probes/db08/transaction-probes.mjs";
import { runSecurityProbes } from "../probes/db08/security-probes.mjs";
import { run } from "../probes/db08/run.mjs";

const configFor = (label) => resolveConfig(["--run-id", `db08-${label}`], {});
const backendFor = (label) => new LocalProbeBackend(configFor(label), { now: () => 1_000_000 });
const ref = (collection, id) => ({ collection, id });
const quiet = async (fn) => {
  const original = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = original; }
};
const executeEnv = (config) => ({
  DB08_PROBE_ENV: "db08-isolated-test",
  DB08_PROBE_CONFIRM: `db08:db08-isolated-test:${config.orgA}`,
});
const fakeSecurityAdapter = (override = null) => ({
  privileged: false,
  calls: [],
  cleaned: false,
  async prepare(context) { this.context = context; },
  async check(check, context) {
    this.calls.push(check.id);
    const result = {
      decision: check.expected,
      audited: Boolean(check.requiresAudit),
      ...(check.requiresAudit ? { auditId: `${context.prefix}security-audit-${check.id}` } : {}),
      publicUrlIssued: false,
    };
    return override ? override(check, result) : result;
  },
  async cleanup() { this.cleaned = true; },
});

test("DB-08 defaults to a complete zero-cloud dry-run plan", () => {
  const config = resolveConfig([], {});
  const report = dryRunReport(config);
  assert.equal(config.runId, DRY_RUN_ID);
  assert.equal(config.mode, "dry-run");
  assert.equal(report.selectedScenarios.length, SCENARIOS.length);
  assert.equal(report.selectedScenarios.length, 11);
  assert.equal(report.indexes.length, 17);
  assert.equal(report.securityChecks.length, 19);
  assert.equal(report.cloudCalls, 0);
  assert.equal(report.cloudWrites, 0);
  assert.equal(report.credentialsRead, false);
  assert.equal(report.limits.transactionRefs, 90);
  assert.equal(report.limits.rejectRefs, 91);
  assert.equal(report.limits.roomTotal, 1000);
  assert.equal(report.limits.expectedRoomBatches, 40);
});

test("DB-08 execution requires explicit isolated environment, confirmation and safe cleanup flags", () => {
  assert.throws(() => resolveConfig(["--execute-isolated", "--run-id", "db08-env-test"], {
    DB08_PROBE_ENV: "production",
  }), /专用隔离环境/);
  assert.throws(() => resolveConfig(["--execute-isolated", "--run-id", "db08-env-test"], {
    DB08_PROBE_ENV: "db08-isolated-test", DB08_PROBE_CONFIRM: "wrong",
  }), /DB08_PROBE_CONFIRM/);
  const args = ["--execute-isolated", "--run-id", "db08-env-test"];
  const config = resolveConfig(args, {
    DB08_PROBE_ENV: "db08-isolated-test",
    DB08_PROBE_CONFIRM: "db08:db08-isolated-test:db08-env-test-a",
  });
  assert.deepEqual(executeEnv(config), {
    DB08_PROBE_ENV: "db08-isolated-test",
    DB08_PROBE_CONFIRM: "db08:db08-isolated-test:db08-env-test-a",
  });
  assert.throws(() => resolveConfig(["--cleanup-only", "--run-id", "db08-env-test"]), /execute-isolated/);
  assert.throws(() => resolveConfig([...args, "--cleanup-only", "--keep-fixtures"], executeEnv(config)), /不能同时使用/);
  assert.throws(() => resolveConfig(["--only", "not-a-probe"]), /未知探针场景/);
});

test("DB-08 dry-run never invokes backend factory or reads execution credentials", async () => {
  const env = new Proxy({}, { get() { throw Error("credential read"); } });
  const report = await quiet(() => run(["--dry-run"], env, {
    backendFactory() { throw Error("cloud backend initialized"); },
  }));
  assert.equal(report.mode, "dry-run");
  assert.equal(report.cloudCalls, 0);
});

test("DB-08 backend enforces prefixes, orgs, declared writes and preserves foreign fixtures", async () => {
  const backend = backendFor("backend-guards");
  const id = backend.id("person");
  await assert.rejects(backend.transact([ref("persons", "unprefixed")], () => [], {}),
    (error) => error.code === "PREFIX_VIOLATION");
  await assert.rejects(backend.transact([ref("persons", id)], () => [{
    collection: "persons", id, data: { orgId: "other-org", status: "active" },
  }], {}), (error) => error.code === "ORG_VIOLATION");
  await assert.rejects(backend.transact([], () => [{
    collection: "persons", id, data: { orgId: backend.config.orgA },
  }], {}), (error) => error.code === "UNDECLARED_WRITE");
  backend.rows.set("persons/foreign-person", {
    _id: "foreign-person", orgId: "foreign-org", status: "active",
  });
  await backend.transact([ref("persons", id)], () => [{
    collection: "persons", id, data: { orgId: backend.config.orgA, status: "active" },
  }], { orgId: backend.config.orgA });
  const cleaned = await backend.cleanup();
  assert.equal(cleaned.status, "cleaned");
  assert.equal(await backend.get("persons", id), null);
  assert.equal(backend.rows.get("persons/foreign-person").orgId, "foreign-org");
});

test("DB-08 fixed-ID phone, WeChat and document registrations resolve to one stable user", async () => {
  const backend = backendFor("identity-races");
  for (const probe of [identityPhoneProbe, identityWechatProbe, identityDocumentProbe]) {
    const result = await probe(backend);
    assert.equal(result.status, "pass");
    assert.equal(result.mappingCount, 1);
    assert.equal(result.replayedToSameUser, true);
  }
});

test("DB-08 primary-slot contention leaves exactly one active primary", async () => {
  const result = await primarySlotProbe(backendFor("primary-race"));
  assert.equal(result.activePrimaryCount, 1);
  assert.deepEqual(result.rejected, ["PRIMARY_OCCUPIED"]);
});

test("DB-08 blacklist/activation race retains the entry and rejects activation without a slot", async () => {
  const result = await blacklistActivationProbe(backendFor("blacklist-race"));
  assert.equal(result.activationState, "pending_review");
  assert.equal(result.primarySlotCreated, false);
  assert.equal(result.guardReadBeforeCandidates, true);
  assert.equal(result.finalGuardEpoch, 1);
});

test("DB-08 review/request race cannot combine a changed request with an old allow", async () => {
  const reviewFirst = await occupancyReviewRace(backendFor("review-first"));
  assert.equal(reviewFirst.outcome, "request-v1-allowed");
  assert.equal(reviewFirst.decisionDigestMatches, true);
  const mutationFirst = await occupancyReviewRace(backendFor("review-mutate"), { reverse: true });
  assert.equal(mutationFirst.outcome, "request-v2-pending");
  assert.equal(mutationFirst.decisionDigestMatches, false);
});

test("DB-08 organization queries and transactions reject cross-org and forged membership access", async () => {
  const result = await organizationIsolationProbe(backendFor("org-isolation"));
  assert.equal(result.rejectedCrossOrgReferences, 1);
  assert.equal(result.rejectedForgedMemberships, 1);
  assert.ok(result.orgACount > 0);
  assert.ok(result.orgBCount > 0);
});

test("DB-08 all 17 candidate index queries keep org filtering and stable ID order", async () => {
  const result = await indexQueryProbe(backendFor("index-smoke"));
  assert.equal(result.candidateQueries, INDEXES.length);
  assert.equal(result.organizationFilterBeforePagination, true);
  assert.equal(result.stableIdTiebreaker, true);
});

test("DB-08 accepts 90 total refs and rejects 91 before starting a transaction", async () => {
  const backend = backendFor("reference-budget");
  const result = await transactionReferenceProbe(backend);
  assert.equal(result.acceptedTotalRefs, 90);
  assert.equal(result.rejectedTotalRefs, 91);
  assert.equal(result.rejectedBeforeTransaction, true);
  assert.equal(result.applicationLimitNotPlatformLimit, true);
});

test("DB-08 1000-room batches replay 40 operation keys without duplicates", async () => {
  const backend = backendFor("room-batch");
  const result = await roomBatchProbe(backend);
  assert.equal(result.rooms, 1000);
  assert.equal(result.batchSize, 25);
  assert.equal(result.batchesPerPass, 40);
  assert.equal(result.replayedBatches, 40);
  assert.equal(result.duplicateRooms, 0);
  const cleanup = await backend.cleanup();
  assert.equal(cleanup.verifiedEmpty, true);
});

test("DB-08 security probes require 19 explicit decisions, audits and no private public URLs", async () => {
  const adapter = fakeSecurityAdapter();
  const result = await runSecurityProbes(adapter, configFor("security-pass"));
  assert.equal(result.checks, SECURITY_CHECKS.length);
  assert.equal(result.checks, 19);
  assert.equal(adapter.calls.length, 19);
  assert.equal(adapter.cleaned, true);
  assert.equal(result.managementSdkUsedForRules, false);
});

test("DB-08 security probes fail closed without an unprivileged adapter or on a public URL", async () => {
  await assert.rejects(runSecurityProbes(null, configFor("security-deny")),
    (error) => error.code === "SECURITY_ADAPTER_UNAVAILABLE");
  await assert.rejects(runSecurityProbes({ privileged: true, check() {} }, configFor("security-admin")),
    (error) => error.code === "SECURITY_ADAPTER_UNAVAILABLE");
  const adapter = fakeSecurityAdapter((check, result) => check.forbidPublicUrl
    ? { ...result, publicUrlIssued: true } : result);
  await assert.rejects(runSecurityProbes(adapter, configFor("security-url")),
    (error) => error.code === "PRIVATE_FILE_PUBLIC_URL");
  assert.equal(adapter.cleaned, true);
});

test("DB-08 real-mode security preflight fails before backend creation when adapter is absent", async () => {
  const args = ["--execute-isolated", "--run-id", "db08-preflight"];
  const config = resolveConfig(args, {
    DB08_PROBE_ENV: "db08-isolated-test",
    DB08_PROBE_CONFIRM: "db08:db08-isolated-test:db08-preflight-a",
  });
  await assert.rejects(run(args, executeEnv(config), {
    backendFactory() { throw Error("must not initialize"); },
  }), /DB08_SECURITY_ADAPTER/);
});

test("DB-08 injected local execution is labelled non-cloud and cleans its fixtures", async () => {
  const args = ["--execute-isolated", "--run-id", "db08-local-run",
    "--only", "identity-phone-fixed-id,security-access-rules"];
  const config = resolveConfig(args, {
    DB08_PROBE_ENV: "db08-isolated-test",
    DB08_PROBE_CONFIRM: "db08:db08-isolated-test:db08-local-run-a",
  });
  let backend;
  const report = await quiet(() => run(args, executeEnv(config), {
    backendFactory: (resolved) => (backend = new LocalProbeBackend(resolved)),
    securityAdapter: fakeSecurityAdapter(),
  }));
  assert.equal(report.status, "pass");
  assert.equal(report.results.length, 2);
  assert.equal(report.evidenceScope, "local-adapter-only-not-cloud-proof");
  assert.equal(report.metrics.cloudCalls, 0);
  assert.equal(report.cleanup.verifiedEmpty, true);
  assert.equal(backend.rows.size, 0);
});
