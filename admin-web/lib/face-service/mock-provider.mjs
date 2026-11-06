/**
 * Mock FaceAccessProvider（仅 demo/test）。
 *
 * 真实 Provider 不在本轮范围；此实现用于验证服务层状态机与任务编排。
 * 场景由构造参数显式选择，禁止在 live 模式下实例化（见 index.mjs 的守卫约定）。
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
  constructor({ scenario = "success", providerKind = "mock" } = {}) {
    if (!MOCK_SCENARIOS.includes(scenario)) {
      throw new Error(`未知 Mock 场景：${scenario}`);
    }
    this.scenario = scenario;
    this.providerKind = providerKind;
    this.calls = [];
    this.people = new Map();
  }

  async health() {
    return { ok: this.scenario !== "device_offline", providerKind: this.providerKind, scenario: this.scenario };
  }

  async upsertCredential({ credentialId, personId, faceFileId }) {
    this.calls.push({ action: "upsert", credentialId, personId, faceFileId });
    return this.#act("upsert", () => {
      this.people.set(personId, { credentialId, faceFileId });
      return { status: "succeeded", providerRef: `mock-${personId}` };
    });
  }

  async deleteCredential({ credentialId, personId }) {
    this.calls.push({ action: "delete", credentialId, personId });
    return this.#act("delete", () => {
      this.people.delete(personId);
      return { status: "succeeded" };
    });
  }

  async queryCredential({ personId }) {
    const found = this.people.get(personId);
    return found ? { status: "present", ...found } : { status: "absent" };
  }

  #act(action, run) {
    switch (this.scenario) {
      case "device_offline":
        throw providerError("DEVICE_OFFLINE", "pre_send");
      case "pre_send_fail":
        throw providerError("PROVIDER_ERROR", "pre_send");
      case "post_send_unknown":
        throw providerError("UNKNOWN_RESULT", "post_send");
      case "terminal_fail":
        throw providerError("DEVICE_REJECTED", "post_send");
      case "revoke_fail":
        if (action === "delete") throw providerError("DEVICE_REJECTED", "post_send");
        return run();
      case "duplicate_callback":
        // 同一请求重放返回同一结果，不产生第二次物理操作
        return this.#once(action, run);
      default:
        return run();
    }
  }

  #once(action, run) {
    const key = `${action}:${this.calls.length}`;
    if (!this.cached) this.cached = new Map();
    if (this.cached.has(action)) return this.cached.get(action);
    const result = run();
    this.cached.set(action, result);
    return result;
  }
}

function providerError(code, phase) {
  const error = new Error(`${code} (${phase})`);
  error.code = code;
  error.phase = phase;
  return error;
}

/**
 * 失败分类：post_send 的未知/失败一律不可自动重试（避免重复新增/删除）；
 * pre_send 的设备离线可重试。
 */
export function classifyProviderError(error) {
  if (!error || typeof error !== "object") return { retryable: false, unknownResult: true };
  if (error.phase === "post_send") return { retryable: false, unknownResult: error.code === "UNKNOWN_RESULT" };
  if (error.code === "DEVICE_OFFLINE") return { retryable: true, unknownResult: false };
  return { retryable: false, unknownResult: false };
}
