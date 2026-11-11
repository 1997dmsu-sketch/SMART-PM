/**
 * HK-AI-04 H2-d 全链回归与并发验收（定向测试）。
 *
 * 覆盖：
 *   - H1 原 8 项服务层回归（独立于 C4 文件，不删除/替换既有测试）；
 *   - H2-d 并发：同 slot、同 operation key 并发重放；
 *   - BLACKLIST_RETRY 一次成功与三次耗尽；
 *   - 成功写集 / 错误信封 / 日志字段的敏感信息扫描；
 *   - executionMode=test / provider=mock / evidenceScope=simulated / deviceEffective=false。
 *
 * 真实使用 LocalStore、FileService、BlacklistService 与生产 FaceCredentialService；
 * 不使用 eligible=true 资格桩，不调用 Provider，不连接设备、HTTP 或生产云。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { projectAccess } from "../lib/face-service/state.mjs";
import {
  CORE,
  G,
  H1,
  addBlacklistDeny,
  assertUnchanged,
  bumpPersonRevision,
  changedRows,
  createGrantHarness,
  createH1Harness,
  grantInput,
  instrument,
  snapshot,
} from "./helpers/h2d-fixtures.mjs";

async function captureError(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  assert.fail("预期抛错但调用成功");
}

const coreCounts = async (store, orgId = G.ORG) => {
  const out = {};
  for (const name of CORE) out[name] = (await store.list(name, orgId)).length;
  return out;
};

// ---------------------------------------------------------------------------
// H1 原 8 项（独立文件；不依赖 C4 场景矩阵）
// ---------------------------------------------------------------------------

test("H2D H1-1 submit 最小凭证与私密文件绑定", async (t) => {
  const h = await createH1Harness(t);
  const out = await h.service(H1.SUBMIT).submit(
    { personId: "person-h2d-h1", sourceFileId: H1.FILE },
    { idempotencyKey: "idem-h2d-h1-submit-0001" },
  );
  assert.deepEqual(out, { credentialId: out.credentialId, reviewState: "submitted" });
  assert.match(out.credentialId, /^fc-[0-9a-f]{24}$/);

  const rows = await h.store.list("face_credentials", H1.ORG);
  assert.equal(rows.length, 1);
  const record = rows[0];
  assert.deepEqual(Object.keys(record).sort(), [
    "_id", "createdAt", "evidenceScope", "imageState", "orgId", "personId",
    "reviewState", "revision", "sourceFileId", "sourceFileRevision", "updatedAt",
  ]);
  assert.equal(record.personId, "person-h2d-h1");
  assert.equal(record.sourceFileId, H1.FILE);
  assert.equal(record.sourceFileRevision, 1);
  assert.equal(record.reviewState, "submitted");
  assert.equal(record.imageState, "verified");
  assert.equal(record.evidenceScope, "simulated");
  for (const forbidden of [
    "deviceId", "grantId", "occupancyId", "validFrom", "validUntil",
    "objectKey", "checksum", "visibility", "mimeType", "size", "bytes", "url",
  ]) {
    assert.equal(forbidden in record, false, `credential 不得写入 ${forbidden}`);
  }
  assert.equal(JSON.stringify(record).includes("private/h2d-secret.jpg"), false);
  assert.equal(JSON.stringify(record).includes("c".repeat(64)), false);

  const counts = await coreCounts(h.store, H1.ORG);
  assert.deepEqual(counts, {
    device_access_grants: 0, device_operation_jobs: 0, grant_slot_claims: 0,
    device_operation_logs: 0, operation_keys: 1,
  });
  assert.equal((await h.store.list("face_credentials", H1.ORG)).length, 1);

  for (const [label, fileId] of [["公开文件", H1.PUBLIC_FILE], ["非人脸用途", H1.OTHER_FILE]]) {
    const error = await captureError(() => h.service(H1.SUBMIT).submit(
      { personId: "person-h2d-h1", sourceFileId: fileId },
      { idempotencyKey: `idem-h2d-h1-${label === "公开文件" ? "public" : "cover"}-0001` },
    ));
    assert.equal(error.status, 404, `${label}: 必须同态不可见`);
    assert.equal(error.code, "FILE_NOT_FOUND");
  }
  assert.equal((await h.store.list("face_credentials", H1.ORG)).length, 1);
  assert.deepEqual(h.providerCalls, { enroll: 0, revoke: 0 });
});

test("H2D H1-2 review 权限、expected revision 与状态迁移", async (t) => {
  const h = await createH1Harness(t);
  const first = await h.service(H1.SUBMIT).submit(
    { personId: "person-h2d-h1", sourceFileId: H1.FILE },
    { idempotencyKey: "idem-h2d-h1-review-0001" },
  );
  const approved = await h.service(H1.REVIEW).review(
    first.credentialId, { decision: "approved", expectedRevision: 1 },
    { idempotencyKey: "idem-h2d-h1-review-0002" },
  );
  assert.deepEqual(approved, { credentialId: first.credentialId, reviewState: "approved" });
  let credential = (await h.store.list("face_credentials", H1.ORG))[0];
  assert.equal(credential.reviewState, "approved");
  assert.equal(credential.revision, 2);

  const again = await captureError(() => h.service(H1.REVIEW).review(
    first.credentialId, { decision: "approved", expectedRevision: 2 },
    { idempotencyKey: "idem-h2d-h1-review-0003" },
  ));
  assert.equal(again.code, "INVALID_STATE");
  assert.equal(again.status, 409);

  const second = await h.service(H1.SUBMIT).submit(
    { personId: "person-h2d-h1", sourceFileId: H1.FILE },
    { idempotencyKey: "idem-h2d-h1-review-0004" },
  );
  const rejected = await h.service(H1.REVIEW).review(
    second.credentialId, { decision: "rejected", expectedRevision: 1 },
    { idempotencyKey: "idem-h2d-h1-review-0005" },
  );
  assert.deepEqual(rejected, { credentialId: second.credentialId, reviewState: "rejected" });
  credential = (await h.store.list("face_credentials", H1.ORG))
    .find((row) => row._id === second.credentialId);
  assert.equal(credential.reviewState, "rejected");
  assert.equal(credential.revision, 2);

  const submitter = await captureError(() => h.service(H1.SUBMIT).review(
    second.credentialId, { decision: "approved" },
    { idempotencyKey: "idem-h2d-h1-review-0006" },
  ));
  assert.equal(submitter.code, "FORBIDDEN");
  assert.equal(submitter.status, 403);

  const reviewer = await captureError(() => h.service(H1.REVIEW).createGrant(
    grantInput(), { idempotencyKey: "idem-h2d-h1-review-0007" },
  ));
  assert.equal(reviewer.code, "FORBIDDEN");
  assert.equal(reviewer.status, 403);

  assert.deepEqual(h.providerCalls, { enroll: 0, revoke: 0 });
});

test("H2D H1-3 stale expectedRevision 不改 credential/operation key", async (t) => {
  const h = await createH1Harness(t);
  const created = await h.service(H1.SUBMIT).submit(
    { personId: "person-h2d-h1", sourceFileId: H1.FILE },
    { idempotencyKey: "idem-h2d-h1-stale-0001" },
  );
  const beforeCredential = structuredClone(
    (await h.store.list("face_credentials", H1.ORG)).find((row) => row._id === created.credentialId),
  );
  const beforeKeys = structuredClone(await h.store.list("operation_keys", H1.ORG));
  const beforeCounts = await coreCounts(h.store, H1.ORG);

  const error = await captureError(() => h.service(H1.REVIEW).review(
    created.credentialId, { decision: "approved", expectedRevision: 99 },
    { idempotencyKey: "idem-h2d-h1-stale-0002" },
  ));
  assert.equal(error.code, "REVISION_CONFLICT");
  assert.equal(error.status, 409);

  assert.deepEqual(
    (await h.store.list("face_credentials", H1.ORG)).find((row) => row._id === created.credentialId),
    beforeCredential,
  );
  assert.deepEqual(await h.store.list("operation_keys", H1.ORG), beforeKeys);
  assert.deepEqual(await coreCounts(h.store, H1.ORG), beforeCounts);
  assert.deepEqual(h.providerCalls, { enroll: 0, revoke: 0 });
});

test("H2D H1-4 reviewQueue 最小投影，无图片摘要/私密位置/跨组织记录", async (t) => {
  const h = await createH1Harness(t);
  const first = await h.service(H1.SUBMIT).submit(
    { personId: "person-h2d-h1", sourceFileId: H1.FILE },
    { idempotencyKey: "idem-h2d-h1-queue-0001" },
  );
  const second = await h.service(H1.SUBMIT).submit(
    { personId: "person-h2d-h1", sourceFileId: H1.FILE },
    { idempotencyKey: "idem-h2d-h1-queue-0002" },
  );
  await h.service(H1.REVIEW).review(
    first.credentialId, { decision: "approved", expectedRevision: 1 },
    { idempotencyKey: "idem-h2d-h1-queue-0003" },
  );
  await h.store.transact(
    [{ collection: "face_credentials", id: "fc-h2d-other-org" }],
    () => [{
      collection: "face_credentials", id: "fc-h2d-other-org",
      data: {
        orgId: "org-h2d-other", revision: 1, personId: "person-other",
        sourceFileId: "file-other", sourceFileRevision: 1, reviewState: "submitted",
        imageState: "verified", evidenceScope: "simulated", createdAt: 1, updatedAt: 1,
      },
    }],
    h.audit,
  );

  const queue = await h.service(H1.REVIEW).reviewQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].credentialId, second.credentialId);
  assert.deepEqual(Object.keys(queue[0]).sort(), [
    "cleanupPending", "credentialId", "displayState", "evidenceScope", "imageState",
    "orgId", "personId", "reviewState", "revision", "submittedAt",
  ]);
  assert.equal(queue[0].reviewState, "submitted");
  assert.equal(queue[0].displayState, "pending_review");
  const text = JSON.stringify(queue);
  for (const forbidden of [
    "objectKey", "checksum", "private/", "h2d-secret.jpg", "file_assets",
    "sourceFileId", "originalName", "bytes", "url", "phone", "address", "idNumber",
  ]) {
    assert.equal(text.includes(forbidden), false, `reviewQueue 不得泄露 ${forbidden}`);
  }
  assert.equal(queue.some((row) => row.orgId === "org-h2d-other"), false);
  assert.deepEqual(h.providerCalls, { enroll: 0, revoke: 0 });
});

test("H2D H1-5 queryJob 组织内最小 DTO 与跨组织同态 404", async (t) => {
  const h = await createH1Harness(t);
  await h.store.transact(
    [
      { collection: "device_operation_jobs", id: "job-h2d-in-org" },
      { collection: "device_operation_jobs", id: "job-h2d-other-org" },
    ],
    () => [
      {
        collection: "device_operation_jobs", id: "job-h2d-in-org",
        data: {
          orgId: H1.ORG, revision: 1, action: "enroll", state: "queued",
          attempts: 2, lastSuccessAt: 1_700_000_000_000, failureReason: "upstream timeout",
          opId: "op-secret", requestDigest: "a".repeat(64), deviceId: "device-secret",
          credentialId: "credential-secret", grantId: "grant-secret",
          executionMode: "test", provider: "mock", evidenceScope: "simulated",
          leaseOwner: "lease-secret",
        },
      },
      {
        collection: "device_operation_jobs", id: "job-h2d-other-org",
        data: {
          orgId: "org-h2d-other", revision: 1, action: "enroll", state: "succeeded",
          attempts: 1, lastSuccessAt: 1, failureReason: null,
        },
      },
    ],
    h.audit,
  );

  const job = await h.service(H1.AUDIT).queryJob("job-h2d-in-org");
  assert.deepEqual(job, {
    jobId: "job-h2d-in-org",
    state: "queued",
    attempts: 2,
    lastSuccessAt: 1_700_000_000_000,
    failureReason: "upstream timeout",
  });
  const text = JSON.stringify(job);
  for (const forbidden of [
    "opId", "op-secret", "requestDigest", "deviceId", "device-secret", "credentialId",
    "grantId", "leaseOwner", "lease-secret", "executionMode", "evidenceScope",
    "serialNumber",
  ]) {
    assert.equal(text.includes(forbidden), false, `queryJob 不得返回 ${forbidden}`);
  }
  for (const key of ["provider", "mock"]) {
    assert.equal(new RegExp(`"${key}"\\s*:`).test(text), false, `queryJob 不得返回字段 ${key}`);
  }

  const crossOrg = await captureError(() => h.service(H1.AUDIT).queryJob("job-h2d-other-org"));
  const missing = await captureError(() => h.service(H1.AUDIT).queryJob("job-h2d-missing"));
  for (const error of [crossOrg, missing]) {
    assert.equal(error.code, "NOT_FOUND");
    assert.equal(error.status, 404);
    assert.equal(error.message, "任务不存在或不可见");
  }
  assert.deepEqual(h.providerCalls, { enroll: 0, revoke: 0 });
});

test("H2D H1-6 成员撤权在下一事务生效（submit 与 createGrant）", async (t) => {
  const h = await createH1Harness(t);
  const base = h.filesFor(H1.RACE);
  const racingFiles = {
    prepareReference: async (fileId) => {
      const token = await base.prepareReference(fileId);
      await h.store.transact(
        [{ collection: "org_memberships", id: H1.RACE }],
        (state) => [{
          collection: "org_memberships", id: H1.RACE,
          data: { ...state[`org_memberships/${H1.RACE}`], permissions: [] },
        }],
        h.audit,
      );
      return token;
    },
    assertReference: base.assertReference.bind(base),
  };
  const submitError = await captureError(() => h.service(H1.RACE, { files: racingFiles }).submit(
    { personId: "person-h2d-h1", sourceFileId: H1.FILE },
    { idempotencyKey: "idem-h2d-h1-revoke-0001" },
  ));
  assert.equal(submitError.code, "FILE_NOT_FOUND");
  assert.equal(submitError.status, 404);
  assert.equal((await h.store.list("face_credentials", H1.ORG)).length, 0);
  assert.equal((await h.store.list("operation_keys", H1.ORG)).length, 0);

  const grant = await createGrantHarness(t);
  const before = await snapshot(grant.store);
  const prepare = grant.blacklist.prepareEligibility.bind(grant.blacklist);
  let revoked = false;
  grant.blacklist.prepareEligibility = async (request) => {
    const token = await prepare(request);
    if (!revoked) {
      revoked = true;
      await grant.store.transact(
        [{ collection: "org_memberships", id: G.MEMBERSHIP }],
        (state) => [{
          collection: "org_memberships", id: G.MEMBERSHIP,
          data: { ...state[`org_memberships/${G.MEMBERSHIP}`], permissions: [] },
        }],
        grant.audit,
      );
    }
    return token;
  };
  const grantError = await captureError(() => grant.service.createGrant(
    grant.input(), { idempotencyKey: "idem-h2d-grant-revoke-0001" },
  ));
  assert.equal(grantError.code, "FORBIDDEN");
  assert.equal(grantError.status, 403);
  const after = await snapshot(grant.store);
  assertUnchanged(before, after, new Set(["org_memberships", "admin_audit"]));
  assert.deepEqual(await coreCounts(grant.store), {
    device_access_grants: 0, device_operation_jobs: 0, grant_slot_claims: 0,
    device_operation_logs: 0, operation_keys: 0,
  });
  assert.deepEqual(grant.providerCalls, { enroll: 0, revoke: 0 });
  assert.deepEqual(h.providerCalls, { enroll: 0, revoke: 0 });
});

test("H2D H1-7 文件 revision/可见性变化失败关闭（submit 与 createGrant）", async (t) => {
  {
    const h = await createH1Harness(t);
    const base = h.filesFor(H1.RACE);
    const racingFiles = {
      prepareReference: async (fileId) => {
        const token = await base.prepareReference(fileId);
        await h.store.transact(
          [{ collection: "file_assets", id: H1.FILE }],
          (state) => [{
            collection: "file_assets", id: H1.FILE,
            data: { ...state[`file_assets/${H1.FILE}`], revision: 2 },
          }],
          h.audit,
        );
        return token;
      },
      assertReference: base.assertReference.bind(base),
    };
    const error = await captureError(() => h.service(H1.RACE, { files: racingFiles }).submit(
      { personId: "person-h2d-h1", sourceFileId: H1.FILE },
      { idempotencyKey: "idem-h2d-h1-file-0001" },
    ));
    assert.equal(error.code, "FILE_CHANGED");
    assert.equal(error.status, 409);
    assert.equal((await h.store.list("face_credentials", H1.ORG)).length, 0);
    assert.equal((await h.store.list("operation_keys", H1.ORG)).length, 0);
  }
  {
    const h = await createH1Harness(t);
    const base = h.filesFor(H1.RACE);
    const racingFiles = {
      prepareReference: async (fileId) => {
        const token = await base.prepareReference(fileId);
        await h.store.transact(
          [{ collection: "file_assets", id: H1.FILE }],
          (state) => [{
            collection: "file_assets", id: H1.FILE,
            data: { ...state[`file_assets/${H1.FILE}`], visibility: "public" },
          }],
          h.audit,
        );
        return token;
      },
      assertReference: base.assertReference.bind(base),
    };
    const error = await captureError(() => h.service(H1.RACE, { files: racingFiles }).submit(
      { personId: "person-h2d-h1", sourceFileId: H1.FILE },
      { idempotencyKey: "idem-h2d-h1-file-0002" },
    ));
    assert.equal(error.code, "FILE_NOT_FOUND");
    assert.equal(error.status, 404);
    assert.equal((await h.store.list("face_credentials", H1.ORG)).length, 0);
  }
  for (const [label, patch, expectedStatus, expectedCodes] of [
    ["revision", { revision: 2 }, 409, ["FILE_CHANGED"]],
    ["visibility", { visibility: "public" }, 404, ["FILE_NOT_FOUND"]],
  ]) {
    const h = await createGrantHarness(t);
    const file = h.store.data.file_assets.find((row) => row._id === G.FILE);
    Object.assign(file, patch);
    const before = await snapshot(h.store);
    const error = await captureError(() => h.service.createGrant(
      h.input(), { idempotencyKey: `idem-h2d-grant-file-${label}-0001` },
    ));
    assert.equal(error.status, expectedStatus, `${label}: createGrant 必须失败关闭`);
    assert.ok(expectedCodes.includes(error.code), `${label}: 实际 ${error.code}`);
    assertUnchanged(before, await snapshot(h.store));
    assert.deepEqual(h.providerCalls, { enroll: 0, revoke: 0 });
  }
});

test("H2D H1-8 所有 H1/H2 路径 Provider 零调用", async (t) => {
  const h = await createH1Harness(t);
  await h.service(H1.SUBMIT).submit(
    { personId: "person-h2d-h1", sourceFileId: H1.FILE },
    { idempotencyKey: "idem-h2d-h1-provider-0001" },
  );
  const credential = (await h.store.list("face_credentials", H1.ORG))[0];
  await h.service(H1.REVIEW).review(
    credential._id, { decision: "approved", expectedRevision: 1 },
    { idempotencyKey: "idem-h2d-h1-provider-0002" },
  );
  await h.service(H1.REVIEW).reviewQueue();
  await h.service(H1.AUDIT).queryJob("job-h2d-missing").catch(() => {});
  assert.deepEqual(h.providerCalls, { enroll: 0, revoke: 0 });

  const grant = await createGrantHarness(t);
  await grant.service.createGrant(grant.input(), { idempotencyKey: "idem-h2d-grant-ok-0001" });
  await addBlacklistDeny(grant.store);
  await captureError(() => grant.service.createGrant(
    grant.input(), { idempotencyKey: "idem-h2d-grant-deny-0001" },
  ));
  assert.deepEqual(grant.providerCalls, { enroll: 0, revoke: 0 });
});

test("H2D H1-R1 revoke 仍 STAGE_CLOSED：零写入零 Provider", async (t) => {
  const h = await createH1Harness(t);
  const before = await coreCounts(h.store, H1.ORG);
  const error = await captureError(() => h.service(H1.MANAGE).revoke(
    "grant-h2d-legacy", { idempotencyKey: "idem-h2d-h1-revoke-0009" },
  ));
  assert.equal(error.code, "STAGE_CLOSED");
  assert.equal(error.status, 501);
  assert.deepEqual(await coreCounts(h.store, H1.ORG), before);
  assert.deepEqual(h.providerCalls, { enroll: 0, revoke: 0 });
});

// ---------------------------------------------------------------------------
// H2-d 并发与重放
// ---------------------------------------------------------------------------

test("H2D-R1 同 slot 双请求并发：仅一成功，另一 GRANT_SLOT_CONFLICT，核心写集只一组", async (t) => {
  const h = await createGrantHarness(t);
  const before = await snapshot(h.store);
  const results = await Promise.allSettled([
    h.service.createGrant(h.input(), { idempotencyKey: "idem-h2d-r1-a-0001" }),
    h.service.createGrant(h.input(), { idempotencyKey: "idem-h2d-r1-b-0001" }),
  ]);
  const ok = results.filter((item) => item.status === "fulfilled");
  const failed = results.filter((item) => item.status === "rejected");
  assert.equal(ok.length, 1, "同 slot 并发必须且只能一个成功");
  assert.equal(failed.length, 1, "另一个必须失败关闭");
  assert.equal(failed[0].reason.code, "GRANT_SLOT_CONFLICT");
  assert.equal(failed[0].reason.status, 409);

  const after = await snapshot(h.store);
  assert.deepEqual(await coreCounts(h.store), {
    device_access_grants: 1, device_operation_jobs: 1, grant_slot_claims: 1,
    device_operation_logs: 1, operation_keys: 1,
  });
  assert.equal(after.device_access_grants[0].state, "pending");
  assert.equal(after.device_operation_jobs[0].state, "queued");
  assert.equal(after.grant_slot_claims[0].state, "active");
  assert.equal(after.device_operation_logs[0].jobId, after.device_operation_jobs[0]._id);
  assertUnchanged(before, after, new Set([
    ...CORE, "eligibility_guards", "admin_audit", "operation_key_domains",
  ]));
  assert.deepEqual(h.providerCalls, { enroll: 0, revoke: 0 });
});

test("H2D-R2 同 operation key 并发重放：返回原结果，核心写集不重复，Provider 0", async (t) => {
  const h = await createGrantHarness(t);
  const key = "idem-h2d-r2-replay-0001";
  const first = await h.service.createGrant(h.input(), { idempotencyKey: key });
  const before = await snapshot(h.store);

  const results = await Promise.all([
    h.service.createGrant(h.input(), { idempotencyKey: key }),
    h.service.createGrant(h.input(), { idempotencyKey: key }),
  ]);
  for (const result of results) assert.deepEqual(result, first);

  const after = await snapshot(h.store);
  for (const name of CORE) {
    assert.deepEqual(after[name], before[name], `${name} 合法重放内容必须不变`);
  }
  assert.deepEqual(await coreCounts(h.store), {
    device_access_grants: 1, device_operation_jobs: 1, grant_slot_claims: 1,
    device_operation_logs: 1, operation_keys: 1,
  });
  assert.deepEqual(h.providerCalls, { enroll: 0, revoke: 0 });
});

test("H2D-R3 BLACKLIST_RETRY 一次后成功：完整重跑，仅一组核心写集", async (t) => {
  const h = await createGrantHarness(t);
  const before = await snapshot(h.store);
  const counts = instrument(h.blacklist, h.store, async (attempt) => {
    if (attempt === 1) bumpPersonRevision(h.store);
  });
  const result = await h.service.createGrant(h.input(), {
    idempotencyKey: "idem-h2d-r3-retry-0001",
  });
  assert.equal(result.evidenceScope, "simulated");
  assert.deepEqual(counts, { prepare: 2, evaluate: 1, transact: 2 });
  assert.deepEqual(await coreCounts(h.store), {
    device_access_grants: 1, device_operation_jobs: 1, grant_slot_claims: 1,
    device_operation_logs: 1, operation_keys: 1,
  });
  const after = await snapshot(h.store);
  assert.equal(after.persons[0].revision, 2, "第二次 attempt 必须使用新 revision");
  assertUnchanged(before, after, new Set([
    ...CORE, "persons", "eligibility_guards", "admin_audit", "operation_key_domains",
  ]));
  assert.deepEqual(h.providerCalls, { enroll: 0, revoke: 0 });
});

test("H2D-R4 BLACKLIST_RETRY 三次耗尽：无第四次，核心/guard/op key 零写入", async (t) => {
  const h = await createGrantHarness(t);
  const before = await snapshot(h.store);
  const counts = instrument(h.blacklist, h.store, async () => bumpPersonRevision(h.store));
  const error = await captureError(() => h.service.createGrant(h.input(), {
    idempotencyKey: "idem-h2d-r4-exhaust-0001",
  }));
  assert.equal(error.code, "BLACKLIST_RETRY");
  assert.equal(error.status, 409);
  assert.deepEqual(counts, { prepare: 3, evaluate: 0, transact: 3 });
  const after = await snapshot(h.store);
  assert.equal(after.persons[0].revision, 4, "三次注入后不得再预读第四次");
  for (const name of [...CORE, "eligibility_guards", "admin_audit", "blacklist_decisions"]) {
    assert.deepEqual(after[name], before[name], `${name} 必须零写入`);
  }
  assert.deepEqual(h.providerCalls, { enroll: 0, revoke: 0 });
});

// ---------------------------------------------------------------------------
// 冻结错误优先级：权限 → operation → credential/file → 资格 → 名单 → H2-b
// ---------------------------------------------------------------------------

test("H2D-M1 冻结错误优先级：权限/operation/credential/file/资格/名单/H2-b", async (t) => {
  // 1) 权限最优先：撤权后连事务都不应开启。
  {
    const h = await createGrantHarness(t);
    h.store.data.org_memberships.find((row) => row._id === G.MEMBERSHIP).permissions = [];
    const before = await snapshot(h.store);
    const error = await captureError(() => h.service.createGrant(
      h.input(), { idempotencyKey: "idem-h2d-priority-perm-0001" },
    ));
    assert.equal(error.code, "FORBIDDEN");
    assert.equal(error.status, 403);
    assertUnchanged(before, await snapshot(h.store));
  }

  // 2) operation 次优先：合法成功后损坏同键结果，重放必须是 CONFLICT。
  {
    const h = await createGrantHarness(t);
    const key = "idem-h2d-priority-op-0001";
    await h.service.createGrant(h.input(), { idempotencyKey: key });
    h.store.data.operation_keys[0].requestDigest = "corrupt-digest";
    const before = await snapshot(h.store);
    const error = await captureError(() => h.service.createGrant(
      h.input(), { idempotencyKey: key },
    ));
    assert.equal(error.code, "CONFLICT");
    assert.equal(error.status, 409);
    assertUnchanged(before, await snapshot(h.store));
  }

  // 3) credential 先于 file/资格/名单/设备。
  {
    const h = await createGrantHarness(t);
    h.store.data.file_assets.find((row) => row._id === G.FILE).revision = 2;
    h.store.data.occupancies.find((row) => row._id === G.OCCUPANCY).state = "ended";
    h.store.data.access_devices.find((row) => row._id === G.DEVICE).status = "disabled";
    const before = await snapshot(h.store);
    const error = await captureError(() => h.service.createGrant(
      grantInput({ expectedCredentialRevision: 99 }),
      { idempotencyKey: "idem-h2d-priority-cred-0001" },
    ));
    assert.equal(error.code, "REVISION_CONFLICT");
    assert.equal(error.status, 409);
    assertUnchanged(before, await snapshot(h.store));
  }

  // 4) credential 通过后，file 先于资格/名单/设备。
  {
    const h = await createGrantHarness(t);
    h.store.data.file_assets.find((row) => row._id === G.FILE).revision = 2;
    h.store.data.occupancies.find((row) => row._id === G.OCCUPANCY).state = "ended";
    h.store.data.access_devices.find((row) => row._id === G.DEVICE).status = "disabled";
    const before = await snapshot(h.store);
    const error = await captureError(() => h.service.createGrant(
      h.input(), { idempotencyKey: "idem-h2d-priority-file-0001" },
    ));
    assert.equal(error.code, "FILE_CHANGED");
    assert.equal(error.status, 409);
    assertUnchanged(before, await snapshot(h.store));
  }

  // 5) file 通过后，资格错误先于名单/设备。
  {
    const h = await createGrantHarness(t);
    h.store.data.occupancies.find((row) => row._id === G.OCCUPANCY).state = "ended";
    h.store.data.access_devices.find((row) => row._id === G.DEVICE).status = "disabled";
    await addBlacklistDeny(h.store);
    const before = await snapshot(h.store);
    const error = await captureError(() => h.service.createGrant(
      h.input(), { idempotencyKey: "idem-h2d-priority-qual-0001" },
    ));
    assert.equal(error.code, "INVALID_STATE");
    assert.equal(error.status, 409);
    assertUnchanged(before, await snapshot(h.store));
  }

  // 6) 资格通过后，真实名单 deny 先于 H2-b 设备错误。
  {
    const h = await createGrantHarness(t);
    h.store.data.access_devices.find((row) => row._id === G.DEVICE).status = "disabled";
    await addBlacklistDeny(h.store);
    const before = await snapshot(h.store);
    const error = await captureError(() => h.service.createGrant(
      h.input(), { idempotencyKey: "idem-h2d-priority-blacklist-0001" },
    ));
    assert.equal(error.code, "BLACKLIST_DENIED");
    assert.equal(error.status, 403);
    assertUnchanged(before, await snapshot(h.store));
  }

  // 7) 名单通过后，H2-b 设备冻结错误最后触发。
  {
    const h = await createGrantHarness(t);
    h.store.data.access_devices.find((row) => row._id === G.DEVICE).status = "disabled";
    const before = await snapshot(h.store);
    const error = await captureError(() => h.service.createGrant(
      h.input(), { idempotencyKey: "idem-h2d-priority-device-0001" },
    ));
    assert.equal(error.code, "INVALID_STATE");
    assert.equal(error.status, 409);
    assertUnchanged(before, await snapshot(h.store));
  }
});

// ---------------------------------------------------------------------------
// 敏感写集 / 错误信封 / 运行模式
// ---------------------------------------------------------------------------

test("H2D-S1 成功写集/错误信封/日志无敏感字段，运行模式为 test/mock/simulated/deviceEffective=false", async (t) => {
  const h = await createGrantHarness(t);
  const before = await snapshot(h.store);
  const result = await h.service.createGrant(h.input(), {
    idempotencyKey: "idem-h2d-sensitive-0001",
  });
  const after = await snapshot(h.store);
  const writes = changedRows(before, after);
  assert.ok(writes.some((item) => item.collection === "device_access_grants"));
  assert.ok(writes.some((item) => item.collection === "device_operation_jobs"));
  assert.ok(writes.some((item) => item.collection === "operation_keys"));

  const text = JSON.stringify(writes);
  const forbiddenValues = [
    "张三", "13800138000", "幸福路 1 号 101 室", "110101199001011234",
    "SN-H2D-SECRET-0001", "AA:BB:CC:DD:EE:FF", "10.20.30.40",
    "private/h2d-grant-secret.jpg", "b".repeat(64), "f".repeat(64),
    "idem-h2d-sensitive-0001",
  ];
  for (const value of forbiddenValues) {
    assert.equal(text.includes(value), false, `成功写集不得包含敏感值 ${value}`);
  }
  for (const key of [
    "name", "phone", "address", "idNumber", "serialNumber", "mac", "ip",
    "objectKey", "checksum", "bytes", "base64", "rawIdempotencyKey", "idempotencyKey",
    "certificateFingerprint", "certFingerprint",
  ]) {
    assert.equal(new RegExp(`"${key}"\\s*:`).test(text), false, `成功写集不得包含字段 ${key}`);
  }

  const job = after.device_operation_jobs[0];
  const grant = after.device_access_grants[0];
  assert.equal(job.executionMode, "test");
  assert.equal(job.provider, "mock");
  assert.equal(job.evidenceScope, "simulated");
  assert.equal(grant.evidenceScope, "simulated");
  assert.equal(grant.state, "pending");
  const projection = projectAccess({
    grant, eligibility: { allowed: false }, jobs: [job],
  });
  assert.equal(projection.businessAllowed, false);
  assert.equal(projection.deviceEffective, false);
  assert.equal(result.evidenceScope, "simulated");

  // 错误信封：不泄露人员/设备/文件/原始幂等键。
  await h.store.transact(
    [{ collection: "occupancies", id: G.OCCUPANCY }],
    (state) => [{
      collection: "occupancies", id: G.OCCUPANCY,
      data: { ...state[`occupancies/${G.OCCUPANCY}`], state: "ended" },
    }],
    h.audit,
  );
  const beforeError = await snapshot(h.store);
  const error = await captureError(() => h.service.createGrant(h.input(), {
    idempotencyKey: "idem-h2d-sensitive-error-0001",
  }));
  assert.equal(error.code, "INVALID_STATE");
  assert.equal(error.status, 409);
  const envelope = JSON.stringify({
    code: error.code, status: error.status, message: error.message,
  });
  for (const value of forbiddenValues) {
    assert.equal(envelope.includes(value), false, `错误信封不得包含 ${value}`);
  }
  for (const key of ["objectKey", "checksum", "serialNumber", "phone", "idNumber", "idempotencyKey"]) {
    assert.equal(envelope.includes(key), false, `错误信封不得包含字段名 ${key}`);
  }
  const afterError = await snapshot(h.store);
  for (const name of [...CORE, "device_operation_logs", "admin_audit"]) {
    assert.deepEqual(afterError[name], beforeError[name], `${name} 失败路径零写入`);
  }
  assert.equal(afterError.device_operation_logs.length, 1, "失败不得新增日志");
  assert.deepEqual(h.providerCalls, { enroll: 0, revoke: 0 });
});
