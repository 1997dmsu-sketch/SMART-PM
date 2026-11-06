/**
 * HK-AI-04 服务层入口（骨架）。
 *
 * live 模式禁止选择 Mock；真实 Provider 未实现前，live 必须失败关闭。
 */
export * from "./dto.mjs";
export * from "./state.mjs";
export * from "./routes.mjs";
export * from "./mock-provider.mjs";

import { MockFaceAccessProvider } from "./mock-provider.mjs";

export function createFaceProvider({ mode, provider = "mock", scenario = "success" } = {}) {
  if (mode === "live") {
    const error = new Error("live 模式禁止 Mock Provider；真实 Provider 未实现");
    error.code = "MOCK_FORBIDDEN";
    throw error;
  }
  if (provider !== "mock") {
    const error = new Error(`未知 provider：${provider}`);
    error.code = "PROVIDER_UNKNOWN";
    throw error;
  }
  return new MockFaceAccessProvider({ scenario, providerKind: "mock" });
}
