/**
 * Mock FaceAccessProvider（仅 demo/test；精确契约 72a093a）。
 *
 * 冻结方法：enrollFace / updateFace / revokeFace / queryOperation / verifyEvent。
 * - 所有业务方法要求 FaceAccessContext（orgId/deviceId/validFrom/validUntil；
 *   撤权还要求 grantId）；
 * - queryOperation 按 jobId 查询；
 * - verifyEvent 必须提供签名，缺失即拒绝，不使用默认签名；
 * - 幂等：opId + requestDigest；同键不同摘要返回冻结错误 CONFLICT。
 */
import { assertFaceAccessContext, assertFaceCredentialInput, assertRevokeInput } from "./dto.mjs";

export const MOCK_SCENARIOS = Object.freeze([
  "success",
  "device_offline",
  "pre_send_fail",
  "post_send_unknown",
  "terminal_fail",
  "revoke_fail",
  "duplicate_callback",
]);

export class MockFaceAccessProvider {
  constructor({ scenario = "success" } = {}) {
    if (!MOCK_SCENARIOS.includes(scenario)) throw new Error(`未知 Mock 场景：${scenario}`);
    this.scenario = scenario;
    this.ops = new Map(); // opId -> {digest, state, jobId, result}
    this.jobs = new Map(); // jobId -> {opId, state, digest}
    this.people = new Map();
    this.events = new Map();
    this.calls = [];
  }

  async health() {
    return { ok: this.scenario !== "device_offline", scenario: this.scenario };
  }

  async enrollFace(input) {
    const parsed = assertFaceCredentialInput(input);
    return this.#run("enroll", parsed, () => {
      this.people.set(parsed.personId, { faceFileId: parsed.faceFileId });
      return { status: "succeeded", providerRef: `mock-${parsed.personId}` };
    });
  }

  async updateFace(input) {
    const parsed = assertFaceCredentialInput(input);
    return this.#run("update", parsed, () => {
      this.people.set(parsed.personId, { faceFileId: parsed.faceFileId });
      return { status: "succeeded", providerRef: `mock-${parsed.personId}` };
    });
  }

  async revokeFace(input) {
    const parsed = assertRevokeInput(input);
    return this.#run("revoke", parsed, () => {
      this.people.delete(parsed.personId);
      return { status: "succeeded" };
    });
  }

  /** 按 jobId 查询任务状态。 */
  async queryOperation({ jobId }) {
    const job = this.jobs.get(jobId);
    if (!job) return { jobId, state: "unknown" };
    return { jobId, opId: job.opId, state: job.state };
  }

  /** 设备回调：必须带签名；同 eventId 重放返回同一结果。 */
  async verifyEvent({ context, eventId, payload, signature }) {
    assertFaceAccessContext(context);
    if (!signature) {
      throw providerError("SIGNATURE_REQUIRED", "post_send", "回调缺少签名");
    }
    if (this.scenario === "post_send_unknown") {
      throw providerError("UNKNOWN_RESULT", "post_send", "回调内容不可判定");
    }
    if (this.events.has(eventId)) return this.events.get(eventId);
    const result = { eventId, state: "awaiting_result", payload };
    this.events.set(eventId, result);
    return result;
  }

  #run(action, input, execute) {
    const { opId, requestDigest } = input;
    const existing = this.ops.get(opId);
    if (existing) {
      if (existing.digest !== requestDigest) {
        throw providerError("CONFLICT", "pre_send", "同键不同请求摘要");
      }
      return existing.result; // 同键同摘要：重放
    }

    const jobId = input.jobId || opId; // 骨架约定：一次操作对应一个 job
    this.calls.push({ action, opId, jobId });

    if (this.scenario === "device_offline") throw providerError("DEVICE_OFFLINE", "pre_send", "设备离线");
    if (this.scenario === "pre_send_fail") throw providerError("PROVIDER_ERROR", "pre_send", "发送前失败");
    if (this.scenario === "terminal_fail") throw providerError("DEVICE_REJECTED", "post_send", "设备拒绝");
    if (this.scenario === "revoke_fail" && action === "revoke") {
      throw providerError("DEVICE_REJECTED", "post_send", "撤权失败");
    }
    if (this.scenario === "post_send_unknown") {
      this.ops.set(opId, { digest: requestDigest, state: "awaiting_result", jobId, result: null });
      this.jobs.set(jobId, { opId, state: "awaiting_result", digest: requestDigest });
      throw providerError("UNKNOWN_RESULT", "post_send", "发送后结果未知");
    }

    const result = execute();
    this.ops.set(opId, { digest: requestDigest, state: "succeeded", jobId, result });
    this.jobs.set(jobId, { opId, state: "succeeded", digest: requestDigest });
    return result;
  }
}

function providerError(code, phase, message) {
  const error = new Error(message);
  error.code = code;
  error.phase = phase;
  return error;
}

/** 对外统一分类：RETRYABLE / TERMINAL / UNKNOWN_RESULT（冻结）。 */
export function classifyProviderError(error) {
  if (!error || typeof error !== "object") return "TERMINAL";
  if (error.code === "UNKNOWN_RESULT") return "UNKNOWN_RESULT";
  if (error.phase === "post_send") return "TERMINAL";
  if (error.phase === "pre_send" && ["DEVICE_OFFLINE", "PROVIDER_ERROR"].includes(error.code)) {
    return "RETRYABLE";
  }
  return "TERMINAL";
}
