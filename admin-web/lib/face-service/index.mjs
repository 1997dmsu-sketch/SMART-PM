/**
 * HK-AI-04 服务层入口（骨架）。
 *
 * 必须显式传入 mode="demo" 或 mode="test" 才会启用 Mock；
 * 缺省、live 或未知 provider 一律 NOT_CONFIGURED（冻结错误码）。
 */
export * from "./dto.mjs";
export * from "./state.mjs";
export * from "./routes.mjs";
export * from "./mock-provider.mjs";

import { MockFaceAccessProvider } from "./mock-provider.mjs";

export function createFaceProvider({ mode, provider = "mock", scenario = "success" } = {}) {
  const mockAllowed = mode === "demo" || mode === "test";
  if (!mockAllowed || provider !== "mock") {
    const error = new Error("未配置真实 Provider；Mock 仅允许 demo/test 显式选择");
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  return new MockFaceAccessProvider({ scenario });
}
