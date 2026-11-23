import { capturePlan, inspectPlan, stopPlan } from "./private-plan.mjs";
import { makePublicResult } from "./public-result.mjs";

/**
 * CR-1 production boundary. No verified approval/native evidence bridge exists
 * in this delivery, so no input, callback, ref, JSON or synthetic model can
 * create an evidence session or a network capability through this entry point.
 */
export function executeControlledE1(input) {
  const captured = capturePlan(input);
  if (!captured.ok) return makePublicResult({ status: "BLOCKED", code: captured.code });
  const snapshot = inspectPlan(captured.plan);
  stopPlan(captured.plan, "APPROVAL_UNVERIFIED", "INVALIDATED");
  return makePublicResult({
    status: "BLOCKED", code: "APPROVAL_UNVERIFIED", planRef: snapshot.planRef,
  });
}
