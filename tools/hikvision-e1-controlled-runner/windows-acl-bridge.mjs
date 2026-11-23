// CR-1 deliberately has no native bridge. Neither a historical PowerShell
// result nor caller data can create a live evidence capability here.
export function prepareEvidenceGate() {
  return Object.freeze({
    scope: "native-capability-unavailable",
    ready: false,
    code: "EVIDENCE_GATE_UNVERIFIED",
  });
}
