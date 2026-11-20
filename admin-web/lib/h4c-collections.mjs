/**
 * HK-AI-04 H4-c C1: closed H4-c collection gate.
 *
 * Pure constants module: no imports, no side effects, no Store access.
 * The Set is deliberately module-private: callers can only ask the read-only
 * membership predicate, never obtain or mutate the Set itself.
 */

export const H4C = Object.freeze({
  evidence: "device_operation_evidence",
  evidenceHeads: "device_operation_evidence_heads",
  domains: "evidence_digest_domains",
  anchors: "evidence_chain_anchors",
  auditProofs: "evidence_chain_audits",
  fences: "evidence_chain_fences",
  k3Markers: "evidence_chain_k3_markers",
  plans: "evidence_chain_plans",
});

/** Frozen enumeration snapshot; only for enumeration/assertions. */
export const H4C_COLLECTION_NAMES = Object.freeze([
  H4C.evidence, H4C.evidenceHeads, H4C.domains, H4C.anchors,
  H4C.auditProofs, H4C.fences, H4C.k3Markers, H4C.plans,
]);

/** The generic explicit audit collection is not one of the 8 H4-c sets. */
export const H4C_AUDIT_COLLECTION = "admin_audit";

const H4C_COLLECTION_SET = new Set(H4C_COLLECTION_NAMES);

// Capture at module load so a later Set.prototype.has replacement cannot
// widen or bypass the closed membership decision.
const setHas = Set.prototype.has;

/** Read-only membership predicate. Accepts only strings; exposes no Set. */
export function isH4cCollection(name) {
  return typeof name === "string" && setHas.call(H4C_COLLECTION_SET, name);
}
