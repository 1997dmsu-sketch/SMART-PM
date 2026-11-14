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

/*
 * H4-c C1 evidence surface is intentionally explicit: K3 domain
 * initialization is NOT exported. C1 runtime is strictly read-only; first
 * deployment initialization belongs to a separate controlled migration task.
 */
export {
  EVIDENCE_COLLECTION,
  EVIDENCE_DIGEST_ALGORITHM,
  EVIDENCE_DIGEST_ALGORITHM_VERSION,
  EVIDENCE_DIGEST_DOMAIN,
  EVIDENCE_DOMAIN_HEAD_ID,
  EVIDENCE_DOMAINS_COLLECTION,
  EVIDENCE_HEADS_COLLECTION,
  EVIDENCE_KEY_FINGERPRINT_DOMAIN,
  EVIDENCE_MAX_SEQUENCE,
  EVIDENCE_SCHEMA_VERSION,
  H4C_EVIDENCE_SCOPE,
  STILL_UNKNOWN_MAX_SEQUENCE,
  appendEvidenceWrites,
  applyEvidenceDomain,
  evidenceAppendRefs,
  evidenceDigest,
  evidenceDomainIds,
  evidenceHeadId,
  evidenceId,
  evidenceKeyConfig,
  evidenceKeyFingerprint,
  stableStringify,
  stableValue,
  validateEvidenceDomainRecord,
  validateEvidenceHead,
  validateEvidenceRecord,
} from "./h4c-evidence.mjs";

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
