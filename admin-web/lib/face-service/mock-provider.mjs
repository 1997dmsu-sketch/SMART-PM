/**
 * Mock FaceAccessProvider（精确契约 cc569a8）。
 *
 * 双参数签名：enrollFace(input, context) / updateFace / revokeFace /
 * queryOperation / verifyEvent。context 逐字段校验（见 dto.assertFaceAccessContext）。
 *
 * - executionMode=live → NOT_CONFIGURED；
 * - 幂等键由 context.idempotencyKey + 规范化 input 派生；同键同摘要重放，
 *   同键不同摘要 CONFLICT；
 * - jobId 与 operation key 是不同对象，不做 jobId=opId 回退；
 * - 事件：固定测试域、递增版本、时间窗、Mock 签名；同 ID 同摘要重放，
 *   同 ID 不同摘要 CONFLICT；只返回 matchedJobId/action 或 rejected，不回显 payload。
 */
import { createHash } from "node:crypto";

import {
  assertEnrollInput,
  assertEventInput,
  assertFaceAccessContext,
  assertQueryInput,
  assertRevokeInput,
  assertUpdateInput,
  publicJobResult,
} from "./dto.mjs";

export const MOCK_SCENARIOS = Object.freeze([
  "success",
  "device_offline",
  "pre_send_fail",
  "post_send_unknown",
  "terminal_fail",
  "revoke_fail",
  "duplicate_callback",
]);

const digestOf = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class MockFaceAccessProvider {
  constructor({ scenario = "success" } = {}) {
    if (!MOCK_SCENARIOS.includes(scenario)) throw new Error(`未知 Mock 场景：${scenario}`);
    this.scenario = scenario;
    this.operations = new Map(); // idempotencyKey -> {digest, result, jobId}
    this.jobs = new Map(); // jobId -> job record
    this.events = new Map(); // eventId -> {digest, version, result}
    this.maxVersions = new Map(); // org|device|job -> 最高已受理版本
    this.rejections = new Map(); // org|eventId -> 拒绝审计（不参与幂等）
    this.people = new Map();
    this.seq = 0;
    this.calls = [];
  }

  async health() {
    return { ok: this.scenario !== "device_offline", scenario: this.scenario };
  }

  async enrollFace(input, context) {
    const ctx = assertFaceAccessContext(context);
    const parsed = assertEnrollInput(input);
    return this.#run("enroll", parsed, ctx, () => {
      this.people.set(parsed.personId, { sourceFileId: parsed.sourceFileId });
      return { status: "succeeded" };
    });
  }

  async updateFace(input, context) {
    const ctx = assertFaceAccessContext(context);
    const parsed = assertUpdateInput(input);
    return this.#run("update", parsed, ctx, () => ({ status: "succeeded" }));
  }

  async revokeFace(input, context) {
    const ctx = assertFaceAccessContext(context);
    const parsed = assertRevokeInput(input);
    return this.#run("revoke", parsed, ctx, () => {
      return { status: "succeeded" };
    });
  }

  async queryOperation(input, context) {
    const ctx = assertFaceAccessContext(context);
    const { jobId } = assertQueryInput(input);
    if (ctx.executionMode === "live") return this.#notConfigured();
    const job = this.jobs.get(jobId);
    if (!job) return { jobId, state: "unknown", attempts: 0, lastSuccessAt: null, failureReason: null };
    return publicJobResult(job);
  }

  async verifyEvent(input, context) {
    const ctx = assertFaceAccessContext(context);
    if (ctx.executionMode === "live") return this.#notConfigured();
    const event = assertEventInput(input);
    const digest = digestOf(event);

    // 绑定检查必须先于缓存命中：组织 B 提交与组织 A 完全相同的事件时，
    // 不能读到 A 的 matchedJobId。缓存键也按组织隔离。
    const job = this.jobs.get(event.jobId);
    const bound = Boolean(job && job.orgId === context.orgId && job.deviceId === event.deviceId);
    const cacheKey = `${context.orgId}|${event.eventId}`;

    if (!bound) {
      // rejected 只记入独立审计，不写入 accepted 幂等缓存、不更新最高版本；
      // 否则同组织后续改成正确设备会被误判为“同 ID 不同摘要”CONFLICT。
      const result = { rejected: true, reasonCode: job ? "SCOPE_MISMATCH" : "JOB_NOT_FOUND" };
      this.rejections.set(cacheKey, { digest, version: event.version, reasonCode: result.reasonCode });
      return result;
    }

    const existing = this.events.get(cacheKey);
    if (existing) {
      if (existing.digest !== digest) {
        throw providerError("CONFLICT", "post_send", "同事件 ID 不同摘要");
      }
      return existing.result; // 同组织同 ID 同摘要幂等重放
    }

    // 版本严格递增按目标 org+device+job 维度，而不是仅同 eventId。
    const scope = `${context.orgId}|${event.deviceId}|${event.jobId}`;
    const highest = this.maxVersions.get(scope) || 0;
    if (event.version <= highest) {
      throw providerError("CONFLICT", "post_send", "事件版本必须严格递增");
    }

    const result = { matchedJobId: event.jobId, action: job.action };
    this.maxVersions.set(scope, event.version);
    this.events.set(cacheKey, { digest, version: event.version, result });
    return result;
  }

  #notConfigured() {
    const error = new Error("live 模式未配置真实 Provider");
    error.code = "NOT_CONFIGURED";
    throw error;
  }

  #run(action, input, context, execute) {
    if (context.executionMode === "live") return this.#notConfigured();

    const digest = digestOf(input);
    // 幂等作用域：组织 + 方法 + actor 类型 + actor ID + 幂等键；
    // 不同组织/用户即使撞键也不得重放同一 job。
    const scopeKey = [context.orgId, action, context.actorType, context.actorId, context.idempotencyKey].join("|");
    const existing = this.operations.get(scopeKey);
    if (existing) {
      if (existing.digest !== digest) throw providerError("CONFLICT", "pre_send", "同键不同请求摘要");
      return existing.result;
    }

    const jobId = `job-${(this.seq += 1)}`;
    this.calls.push({ action, jobId, orgId: context.orgId });
    const binding = {
      jobId,
      action,
      orgId: context.orgId,
      deviceId: input.deviceId ?? null,
      grantId: input.grantId ?? null,
      credentialId: input.credentialId ?? null,
    };

    if (this.scenario === "device_offline") throw providerError("DEVICE_OFFLINE", "pre_send", "设备离线");
    if (this.scenario === "pre_send_fail") throw providerError("PROVIDER_ERROR", "pre_send", "发送前失败");
    if (this.scenario === "post_send_unknown") {
      this.jobs.set(jobId, { ...binding, state: "awaiting_result", attempts: 1, failureReason: "result_unknown" });
      this.operations.set(scopeKey, { digest, jobId, result: null });
      throw providerError("UNKNOWN_RESULT", "post_send", "发送后结果未知");
    }
    if (this.scenario === "terminal_fail" || (this.scenario === "revoke_fail" && action === "revoke")) {
      this.jobs.set(jobId, { ...binding, state: "terminal_failed", attempts: 1, failureReason: "device_rejected" });
      this.operations.set(scopeKey, { digest, jobId, result: null });
      throw providerError("DEVICE_REJECTED", "post_send", "设备拒绝");
    }

    const result = { ...execute(), jobId };
    this.jobs.set(jobId, {
      ...binding,
      state: "succeeded",
      attempts: 1,
      lastSuccessAt: Date.now(),
      failureReason: null,
    });
    this.operations.set(scopeKey, { digest, jobId, result });
    return result;
  }
}

function providerError(code, phase, message) {
  const error = new Error(message);
  error.code = code;
  error.phase = phase;
  return error;
}

export function classifyProviderError(error) {
  if (!error || typeof error !== "object") return "TERMINAL";
  if (error.code === "NOT_CONFIGURED") return "NOT_CONFIGURED";
  if (error.code === "UNKNOWN_RESULT") return "UNKNOWN_RESULT";
  if (error.phase === "post_send") return "TERMINAL";
  if (error.phase === "pre_send" && ["DEVICE_OFFLINE", "PROVIDER_ERROR"].includes(error.code)) {
    return "RETRYABLE";
  }
  return "TERMINAL";
}
