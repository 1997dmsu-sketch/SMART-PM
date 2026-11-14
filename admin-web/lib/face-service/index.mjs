/**
 * HK-AI-04 服务层入口（骨架）。
 *
 * Mock 必须由调用者**同时显式**传入 mode=demo|test 与 provider="mock"；
 * 缺任一项、live+mock、未知组合一律 NOT_CONFIGURED。
 */
export * from "./dto.mjs";
export * from "./state.mjs";
export * from "./routes.mjs";
export * from "./mock-provider.mjs";
export * from "./h4b.mjs";
export * from "./h4c-evidence.mjs";

import { MockFaceAccessProvider } from "./mock-provider.mjs";

export function createFaceProvider({ mode, provider } = {}) {
  const explicitMock = (mode === "demo" || mode === "test") && provider === "mock";
  if (!explicitMock) {
    const error = new Error("必须显式选择 mode=demo|test 且 provider=mock；真实 Provider 未配置");
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  return new MockFaceAccessProvider();
}
