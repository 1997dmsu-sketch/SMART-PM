/**
 * HK-AI-04 服务层入口（骨架）。
 *
 * live 模式未配置真实 Provider 时返回 NOT_CONFIGURED（冻结错误码），
 * 不新增 MOCK_FORBIDDEN 等公共契约之外的状态。
 */
export * from "./dto.mjs";
export * from "./state.mjs";
export * from "./routes.mjs";
export * from "./mock-provider.mjs";

import { MockFaceAccessProvider } from "./mock-provider.mjs";

export function createFaceProvider({ mode, provider = "mock", scenario = "success" } = {}) {
  if (mode === "live") {
    const error = new Error("live 模式未配置真实 Provider");
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  if (provider !== "mock") {
    const error = new Error(`未知 provider：${provider}`);
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  return new MockFaceAccessProvider({ scenario });
}
