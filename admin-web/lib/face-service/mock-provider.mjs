/**
 * Mock FaceAccessProvider（仅 demo/test；契约修订版 f044a04）。
 *
 * 冻结方法：enrollFace / updateFace / revokeFace / queryOperation / verifyEvent。
 * health 仅作独立健康检查适配，不参与业务方法编号。
 *
 * 幂等语义：opId + requestDigest —— 同键同摘要重放同一结果；
 * 同键不同摘要抛 IDEMPOTENCY_CONFLICT；不同键各自执行。
 * post_send 未知结果不可自动重试，投影为 UNKNOWN_RESULT。
 */

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
    this.ops = new Map();
    this.people = new Map();
    this.events = new Map();
    this.calls = [];
  }

  async health() {
    return { ok: this.scenario !== "device_offline", scenario: this.scenario };
  }

  async enrollFace(input) {
    return this.#run("enroll", input, () => {
      this.people.set(input.personId, { faceFileId: input.faceFileId });
      return { status: "succeeded", providerRef: `mock-${input.personId}` };
    });
  }

  async updateFace(input) {
    return this.#run("update", input, () => {
      this.people.set(input.personId, { faceFileId: input.faceFileId });
      return { status: "succeeded", providerRef: `mock-${input.personId}` };
    });
  }

  async revokeFace(input) {
    return this.#run("revoke", input, () => {
      this.people.delete(input.personId);
      return { status: "succeeded" };
    });
  }

  async queryOperation({ opId }) {
    const op = this.ops.get(opId);
    if (!op) return { opId, state: "unknown" };
    return { opId, state: op.state, digest: op.digest };
  }

  /** 设备回调验签/去重：同一 eventId 重放返回同一结果。 */
  async verifyEvent({ eventId, payload, signature = "mock-signature" }) {
    if (this.scenario === "post_send_unknown") {
      throw providerError("UNKNOWN_RESULT", "post_send", "回调内容不可判定");
    }
    if (!signature) throw providerError("TERMINAL", "post_send", "回调验签失败");
    if (this.events.has(eventId)) return this.events.get(eventId);
    const result = { eventId, state: "awaiting_result", payload };
    this.events.set(eventId, result);
    return result;
  }

  #run(action, input, execute) {
    const { opId, requestDigest } = input;
    if (!opId || !requestDigest) throw providerError("TERMINAL", "pre_send", "缺少 opId/requestDigest");
    const existing = this.ops.get(opId);
    if (existing) {
      if (existing.digest !== requestDigest) {
        const error = providerError("TERMINAL", "pre_send", "同键不同请求摘要");
        error.code = "IDEMPOTENCY_CONFLICT";
        throw error;
      }
      return existing.result; // 同键同摘要：重放，不再执行
    }

    if (this.scenario === "device_offline") throw providerError("DEVICE_OFFLINE", "pre_send", "设备离线");
    if (this.scenario === "pre_send_fail") throw providerError("PROVIDER_ERROR", "pre_send", "发送前失败");
    if (this.scenario === "terminal_fail") throw providerError("DEVICE_REJECTED", "post_send", "设备拒绝");
    if (this.scenario === "revoke_fail" && action === "revoke") {
      throw providerError("DEVICE_REJECTED", "post_send", "撤权失败");
    }
    if (this.scenario === "post_send_unknown") {
      this.ops.set(opId, { digest: requestDigest, state: "awaiting_result", result: null });
      throw providerError("UNKNOWN_RESULT", "post_send", "发送后结果未知");
    }

    this.calls.push({ action, opId });
    const result = execute();
    this.ops.set(opId, { digest: requestDigest, state: "succeeded", result });
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
