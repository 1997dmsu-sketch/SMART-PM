import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import {
  runSecurityProbes, CloudSecurityEvidenceVerifier,
} from "../probes/db08/security-probes.mjs";
import { run } from "../probes/db08/run.mjs";
import { IdentityService } from "../lib/identity.mjs";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

function resourceFor(check, context) {
  const f = context.fixtures;
  if (check.collection === "identity_private") return f.identityPrivateId;
  if (check.collection === "blacklist_entries") return f.blacklistEntryId;
  if (check.collection === "file_assets") return check.visibility === "public" ? f.publicFileId : f.privateFileId;
  if (check.collection === "persons") return check.org === "B" ? f.personBId : f.personAId;
  if (check.collection === "rooms") return check.org === "B" ? f.roomBId : f.roomAId;
  if (check.collection === "occupancies") return f.occupancyId;
  if (check.collection === "auth_identities") return f.authIdentityId;
  if (check.collection === "content") return f.publicContentId;
  if (check.action === "readBlacklistEvidence") return f.blacklistEvidenceFileId;
  if (check.action === "readPrivateIdentity") return f.identityPrivateId;
  return check.purpose === "listing-image" ? f.publicObjectKey : f.privateObjectKey;
}

function evidenceFor(check, context) {
  const resourceId = resourceFor(check, context);
  const rawResponse = { syntheticRawResult: check.expected, checkId: check.id };
  const audit = check.requiresAudit ? {
    actorId: `${context.prefix}security-actor-${check.actor}`,
    actorType: "adminAccount", action: check.action,
    entityType: check.action === "readPrivateIdentity" ? "identity_private" : "blacklist_entries",
    entityId: resourceId,
  } : null;
  return {
    envId: context.envId, actorType: check.actor,
    tokenType: check.actor === "anonymous" ? "none" : "isolated-test-token",
    transport: check.channel, requestId: `request-${check.id}`, observedAt: Date.now(),
    httpStatus: check.expected === "allow" ? 200 : 403,
    errorCode: check.expected === "allow" ? null : "PERMISSION_DENIED",
    rawResponse, responseDigest: hash(rawResponse),
    target: {
      orgId: context.orgId, action: check.action, resourceId,
      ...(check.collection ? { collection: check.collection } : {}),
      ...(check.purpose ? { purpose: check.purpose } : {}),
    },
    ...(check.requiresAudit ? { auditId: `${context.prefix}audit-${check.id}`, audit } : {}),
    ...(check.channel === "storage" || check.forbidPublicUrl ? {
      objectUrl: `https://isolated.invalid/${resourceId}`,
      publicUrl: check.forbidPublicUrl ? null : `https://isolated.invalid/${resourceId}`,
    } : {}),
  };
}

const fakeSecurityAdapter = (override = null) => ({
  privileged: false,
  calls: [], cleaned: false,
  async prepare(context) { this.context = context; },
  async check(check, context) {
    this.calls.push(check.id);
    const evidence = evidenceFor(check, context);
    return override ? override(check, evidence) : evidence;
  },
  async cleanup() { this.cleaned = true; },
});

const fakeSecurityVerifier = (override = null) => ({
  async verify(check, evidence) {
    const result = {
      requestId: evidence.requestId, responseDigest: evidence.responseDigest,
      targetDigest: hash(evidence.target), actorType: evidence.actorType,
      observedDecision: check.expected, verifiedAt: Date.now(),
      evidenceRef: `independent-${check.id}`, verificationMethod: "local-independent-replay",
    };
    return override ? override(check, result) : result;
  },
  async reverseRequest(request) {
    const isPublic = request.url.includes("public");
    const rawResponse = { anonymousObjectStatus: isPublic ? "public" : "denied" };
    return {
      requestId: `reverse-${request.url.split("/").at(-1)}`,
      httpStatus: isPublic ? 200 : 403, errorCode: isPublic ? null : "PERMISSION_DENIED",
      rawResponse, responseDigest: hash(rawResponse),
    };
  },
});

async function seedSecurityAudits(backend, config) {
  const checks = SECURITY_CHECKS.filter((check) => check.requiresAudit);
  const refs = [];
  const writes = [];
  for (const check of checks) {
    const context = {
      ...config, orgId: check.org === "B" ? config.orgB : config.orgA,
      fixtures: Object.fromEntries(Object.entries({
        identityPrivateId: "security-identity-private", blacklistEvidenceFileId: "security-blacklist-evidence",
      }).map(([key, value]) => [key, `${config.prefix}${value}`])),
    };
    const evidence = evidenceFor(check, context);
    refs.push(ref("admin_audit", evidence.auditId));
    writes.push({ collection: "admin_audit", id: evidence.auditId, data: {
      orgId: context.orgId, ...evidence.audit,
    } });
  }
  await backend.transact(refs, () => writes, {}, { withAudit: false });
}

test("DB-08 defaults to a complete zero-cloud dry-run plan", () => {
  const report = dryRunReport(resolveConfig([], {}));
  assert.equal(report.runId, DRY_RUN_ID);
  assert.equal(report.mode, "dry-run");
  assert.equal(report.selectedScenarios.length, SCENARIOS.length);
  assert.equal(report.indexes.length, 17);
  assert.equal(report.securityChecks.length, 19);
  assert.equal(report.cloudCalls, 0);
  assert.equal(report.cloudWrites, 0);
  assert.equal(report.credentialsRead, false);
  assert.equal(report.limits.expectedRoomBatches, 40);
});

test("DB-08 execution requires isolated confirmation and independent verifier configuration", () => {
  const args = ["--execute-isolated", "--run-id", "db08-env-test"];
  assert.throws(() => resolveConfig(args, { DB08_PROBE_ENV: "production" }), /专用隔离环境/);
  assert.throws(() => resolveConfig(args, {
    DB08_PROBE_ENV: "db08-isolated-test", DB08_PROBE_CONFIRM: "wrong",
  }), /DB08_PROBE_CONFIRM/);
  const config = resolveConfig(args, {
    DB08_PROBE_ENV: "db08-isolated-test",
    DB08_PROBE_CONFIRM: "db08:db08-isolated-test:db08-env-test-a",
    DB08_SECURITY_VERIFIER: "/isolated/verifier.mjs",
  });
  assert.equal(config.securityVerifier, "/isolated/verifier.mjs");
  assert.throws(() => resolveConfig(["--cleanup-only", "--run-id", "db08-env-test"]), /execute-isolated/);
});

test("DB-08 dry-run never invokes backend factory or reads execution credentials", async () => {
  const env = new Proxy({}, { get() { throw Error("credential read"); } });
  const report = await quiet(() => run(["--dry-run"], env, {
    backendFactory() { throw Error("cloud backend initialized"); },
  }));
  assert.equal(report.mode, "dry-run");
  assert.equal(report.cloudCalls, 0);
});

test("DB-08 backend enforces prefixes, rollback and foreign-fixture preservation", async () => {
  const backend = backendFor("backend-guards");
  const id = backend.id("person");
  await assert.rejects(backend.transact([ref("persons", "unprefixed")], () => [], {}),
    (error) => error.code === "PREFIX_VIOLATION");
  await assert.rejects(backend.transact([ref("persons", id)], () => [{
    collection: "persons", id, data: { orgId: "other-org" },
  }], {}), (error) => error.code === "ORG_VIOLATION");
  assert.equal(await backend.get("persons", id), null);
  backend.rows.set("persons/foreign-person", { _id: "foreign-person", orgId: "foreign-org" });
  await backend.transact([ref("persons", id)], () => [{
    collection: "persons", id, data: { orgId: backend.config.orgA },
  }], { orgId: backend.config.orgA });
  const cleaned = await backend.cleanup();
  assert.equal(cleaned.verifiedEmpty, true);
  assert.equal(backend.rows.get("persons/foreign-person").orgId, "foreign-org");
});

test("DB-08 probes execute the formal service rather than a shadow algorithm", async () => {
  const original = IdentityService.prototype.login;
  IdentityService.prototype.login = async function () { throw Error("formal-service-regression"); };
  try {
    await assert.rejects(identityPhoneProbe(backendFor("formal-binding")), /formal-service-regression/);
  } finally {
    IdentityService.prototype.login = original;
  }
});

for (const [name, probe] of [["phone", identityPhoneProbe], ["WeChat", identityWechatProbe]]) {
  test(`DB-08 ${name} formal login resolves both candidates for winner 0 and winner 1`, async () => {
    for (const winner of [0, 1]) {
      const result = await probe(backendFor(`${name.toLowerCase()}-winner-${winner}`), { winner });
      assert.equal(result.productionMethod, "IdentityService.login");
      assert.equal(result.winnerCandidate, winner);
      assert.equal(result.bothRequestsResolved, true);
      assert.equal(result.ownerRefRetryObserved, true);
      assert.ok(result.loserTransactionCalls >= 2);
      assert.equal(result.mappingCount, 1);
    }
  });
}

test("DB-08 document probe uses VerificationService.review and one verified-person claim in both orders", async () => {
  for (const winner of [0, 1]) {
    const result = await identityDocumentProbe(backendFor(`document-winner-${winner}`), { winner });
    assert.equal(result.productionMethod, "VerificationService.review");
    assert.equal(result.winnerCandidate, winner);
    assert.equal(result.rejectedCode, "IDENTITY_CONFLICT");
    assert.equal(result.verifiedPersonClaimCount, 1);
  }
});

test("DB-08 formal primary activation leaves exactly one active primary", async () => {
  const result = await primarySlotProbe(backendFor("primary-race"));
  assert.match(result.productionMethod, /OccupancyService\.activate/);
  assert.equal(result.activePrimaryCount, 1);
  assert.deepEqual(result.rejected, ["PRIMARY_OCCUPIED"]);
});

test("DB-08 formal blacklist guard forces candidate re-read and rejects activation", async () => {
  const result = await blacklistActivationProbe(backendFor("blacklist-race"));
  assert.match(result.productionMethod, /BlacklistService\.withEligibility/);
  assert.equal(result.activationState, "pending_review");
  assert.equal(result.primarySlotCreated, false);
  assert.ok(result.candidateReads >= 2);
  assert.equal(result.eligibilityRetryObserved, true);
});

test("DB-08 formal occupancy review binds the original request in both submission orders", async () => {
  for (const reverse of [false, true]) {
    const result = await occupancyReviewRace(backendFor(`review-${reverse}`), { reverse });
    assert.match(result.productionMethod, /BlacklistService\.reviewOccupancy/);
    assert.equal(result.changedRequestCode, "OCCUPANCY_APPLICATION_CONFLICT");
    assert.equal(result.applicationState, "consumed");
    assert.equal(result.requestDigestMatches, true);
  }
});

test("DB-08 formal org services reject cross-org references and forged membership", async () => {
  const result = await organizationIsolationProbe(backendFor("org-isolation"));
  assert.equal(result.rejectedCrossOrgReferences, 2);
  assert.equal(result.rejectedForgedMemberships, 1);
  assert.equal(result.occupancyWrites, 0);
});

test("DB-08 all 17 candidate index queries keep org filtering and stable ID order", async () => {
  const result = await indexQueryProbe(backendFor("index-smoke"));
  assert.equal(result.candidateQueries, INDEXES.length);
  assert.equal(result.organizationFilterBeforePagination, true);
  assert.equal(result.stableIdTiebreaker, true);
});

test("DB-08 accepts 90 total refs and rejects 91 before starting a transaction", async () => {
  const result = await transactionReferenceProbe(backendFor("reference-budget"));
  assert.equal(result.acceptedTotalRefs, 90);
  assert.equal(result.rejectedTotalRefs, 91);
  assert.equal(result.rejectedBeforeTransaction, true);
});

test("DB-08 formal createRooms replays 40 batches and 1000 stable IDs", async () => {
  const backend = backendFor("room-batch");
  const result = await roomBatchProbe(backend);
  assert.match(result.productionMethod, /OrgPropertyService\.createRooms/);
  assert.equal(result.rooms, 1000);
  assert.equal(result.replayedBatches, 40);
  assert.equal(result.floorSlots, 1000);
  assert.ok(result.maxTransactionRefs <= 90);
  assert.equal((await backend.cleanup()).verifiedEmpty, true);
});

test("DB-08 security evidence needs independent replay, audit reads and five reverse object requests", async () => {
  const config = configFor("security-pass");
  const backend = new LocalProbeBackend(config);
  await seedSecurityAudits(backend, config);
  const adapter = fakeSecurityAdapter();
  const result = await runSecurityProbes(adapter, config, {
    backend, verifier: fakeSecurityVerifier(),
  });
  assert.equal(result.status, "pass");
  assert.equal(result.evidenceScope, "local-independent-simulation");
  assert.equal(result.checks, 19);
  assert.equal(result.independentlyVerifiedChecks, 19);
  assert.equal(result.managementAuditReads, 2);
  assert.equal(result.independentReverseRequests, 5);
  assert.equal(adapter.cleaned, true);
});

test("DB-08 missing independent verification is not-run and mismatches fail", async () => {
  const config = configFor("security-not-run");
  const backend = new LocalProbeBackend(config);
  const missing = await runSecurityProbes(fakeSecurityAdapter(), config, { backend, verifier: null });
  assert.equal(missing.status, "not-run");
  await seedSecurityAudits(backend, config);
  await assert.rejects(runSecurityProbes(fakeSecurityAdapter(), config, {
    backend,
    verifier: fakeSecurityVerifier((check, result) => check.id === "anonymous-identity-private"
      ? { ...result, responseDigest: "0".repeat(64) } : result),
  }), (error) => error.code === "SECURITY_INDEPENDENT_EVIDENCE");
  assert.throws(() => new CloudSecurityEvidenceVerifier(backend),
    (error) => error.code === "CLOUD_CAPABILITY_REQUIRED");
});

test("DB-08 audit IDs must exist with matching fields through an independent management read", async () => {
  const config = configFor("security-audit");
  const backend = new LocalProbeBackend(config);
  await seedSecurityAudits(backend, config);
  await assert.rejects(runSecurityProbes(fakeSecurityAdapter((check, evidence) =>
    check.requiresAudit ? { ...evidence, auditId: `${config.prefix}missing-audit` } : evidence), config, {
    backend, verifier: fakeSecurityVerifier(),
  }), (error) => error.code === "SECURITY_AUDIT_MISMATCH");
});

test("DB-08 same-named local backend and fake adapters cannot obtain cloud evidence acceptance", async () => {
  class CloudProbeBackend extends LocalProbeBackend {}
  const args = ["--execute-isolated", "--run-id", "db08-spoof-check",
    "--only", "identity-phone-fixed-id,security-access-rules"];
  const config = resolveConfig(args, {
    DB08_PROBE_ENV: "db08-isolated-test",
    DB08_PROBE_CONFIRM: "db08:db08-isolated-test:db08-spoof-check-a",
  });
  let backend;
  const report = await quiet(() => run(args, executeEnv(config), {
    backendFactory: async (resolved) => {
      backend = new CloudProbeBackend(resolved);
      await seedSecurityAudits(backend, resolved);
      return backend;
    },
    securityAdapter: fakeSecurityAdapter(), securityVerifier: fakeSecurityVerifier(),
  }));
  assert.equal(report.executionScope, "local-only");
  assert.equal(report.cloudEvidenceAccepted, false);
  assert.equal(report.metrics.cloudCalls, 0);
  assert.equal(report.results[0].evidenceScope, "local-only");
  assert.equal(report.results[1].evidenceScope, "local-independent-simulation");
});

test("DB-08 execution without an independent security verifier is incomplete, not cloud-pass", async () => {
  const args = ["--execute-isolated", "--run-id", "db08-no-verifier",
    "--only", "security-access-rules"];
  const config = resolveConfig(args, {
    DB08_PROBE_ENV: "db08-isolated-test",
    DB08_PROBE_CONFIRM: "db08:db08-isolated-test:db08-no-verifier-a",
  });
  const report = await quiet(() => run(args, executeEnv(config), {
    backendFactory: (resolved) => new LocalProbeBackend(resolved),
    securityAdapter: fakeSecurityAdapter(),
  }));
  assert.equal(report.status, "incomplete");
  assert.equal(report.results[0].status, "not-run");
  assert.equal(report.cloudEvidenceAccepted, false);
});
