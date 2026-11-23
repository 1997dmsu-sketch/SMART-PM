import { types } from "node:util";
import {
  advancePlan, capturePlan, checkCapturedPlan, consumeCapturedPlan, fixedErrorCode,
  getSyntheticWindow, inspectPlan, matchesCapturedInput, matchesNormalizedBinding, snapshotSyntheticControl, stopPlan,
} from "./private-plan.mjs";
import { createSyntheticEvidenceModel } from "./evidence-session.mjs";

const TERMINAL = new Set(["COMPLETED", "FAILED", "UNKNOWN", "INVALIDATED"]);

function response(ok, code, state) {
  return Object.freeze({ ok, code, state });
}

/**
 * Pure CR-1 memory model with closed data controls, not a transport adapter.
 * No caller callback, source loader, writer, clock function or network factory
 * can be supplied. The production index never imports or accepts this model.
 */
export function createSyntheticController(input) {
  const captured = capturePlan(input);
  const plan = captured.plan;
  const model = createSyntheticEvidenceModel();
  let session = null;
  let currentControl = null;
  let lastNow = null;
  let preparing = false;

  const view = () => plan ? inspectPlan(plan) : Object.freeze({
    scope: "cr1-synthetic-only", state: "FAILED", code: captured.code,
    checkerPassed: false, runnerCompatible: false, consumed: false, stopLatched: true,
    sourceCaptureCount: 0, checkerInvocationCount: 0, mintCount: 0, activationCount: 0,
    invokeCount: 0, transportInvocationCount: 0, checkerAllowReadDisabled: false,
    coreFrozen: false, configurationFrozen: false, trace: Object.freeze([]),
  });
  function rejected(code) {
    return response(false, code, view().state);
  }
  function stop(code, stateName = "INVALIDATED") {
    if (plan && !TERMINAL.has(view().state)) stopPlan(plan, code, stateName);
    if (session) {
      try { model.fail(session, plan); } catch { /* fixed failure is retained */ }
    }
    return rejected(code);
  }
  function guardState(expected) {
    const state = view();
    if (!plan) return rejected(captured.code);
    if (state.consumed) return rejected("PLAN_CONSUMED");
    if (TERMINAL.has(state.state)) return rejected(state.code === "OK" ? "PLAN_INVALID" : state.code);
    if (!expected.includes(state.state)) return rejected("PLAN_INVALID");
    return null;
  }
  function control(value, requireConfirmed = false) {
    let next;
    try { next = snapshotSyntheticControl(value, requireConfirmed); }
    catch { return stop("APPROVAL_UNVERIFIED"); }
    if (next.approval !== "VERIFIED_SYNTHETIC" || !next.fresh) return stop("APPROVAL_UNVERIFIED");
    const { windowStartMs, windowEndMs } = getSyntheticWindow(plan);
    if (!Number.isSafeInteger(next.nowMs) || next.nowMs < 0 ||
        (lastNow !== null && next.nowMs < lastNow) ||
        !Number.isSafeInteger(windowStartMs) || !Number.isSafeInteger(windowEndMs) ||
        next.nowMs < windowStartMs || next.nowMs >= windowEndMs || next.revoked) {
      return stop("AUTHORIZATION_INVALID");
    }
    lastNow = next.nowMs;
    currentControl = Object.freeze({ nowMs: next.nowMs, fresh: next.fresh, revoked: next.revoked, approval: next.approval });
    if (requireConfirmed && !next.confirmed) return rejected("AUTHORIZATION_INVALID");
    return null;
  }

  function check(value) {
    const rejectedState = guardState(["CAPTURED"]);
    if (rejectedState) return rejectedState;
    const invalidControl = control(value);
    if (invalidControl) return invalidControl;
    try { return checkCapturedPlan(plan); }
    catch { return stop("INTERNAL_ERROR", "FAILED"); }
  }

  function setControl(value) {
    const state = view();
    if (!plan) return rejected(captured.code);
    if (TERMINAL.has(state.state)) return rejected(state.code === "OK" ? "PLAN_INVALID" : state.code);
    const invalidControl = control(value);
    return invalidControl || response(true, "OK", view().state);
  }

  async function prepare(options) {
    const rejectedState = guardState(["SEALED"]);
    if (rejectedState) return rejectedState;
    if (preparing) return rejected("PLAN_INVALID");
    const invalidControl = control(currentControl);
    if (invalidControl) return invalidControl;
    preparing = true;
    try {
      session = model.prepare(plan, options);
      // A fixed microtask boundary permits an interleaved data-only revoke or
      // expiry update; it never invokes a caller supplied callback.
      await Promise.resolve();
      const afterPrepare = guardState(["SEALED"]);
      if (afterPrepare) {
        model.fail(session, plan);
        return afterPrepare;
      }
      const stale = control(currentControl);
      if (stale) return stale;
      model.assertReady(session, plan);
      return advancePlan(plan, "EVIDENCE_READY");
    } catch (error) {
      const code = fixedErrorCode(error);
      return stop(code === "INTERNAL_ERROR" ? "EVIDENCE_GATE_FAILED" : code, "FAILED");
    } finally {
      preparing = false;
    }
  }

  function arm(value) {
    const rejectedState = guardState(["EVIDENCE_READY"]);
    if (rejectedState) return rejectedState;
    const invalidControl = control(value, true);
    if (invalidControl) return invalidControl;
    try {
      model.assertReady(session, plan);
      return advancePlan(plan, "ARMED");
    } catch { return stop("EVIDENCE_GATE_INVALID"); }
  }

  function consume(value) {
    const rejectedState = guardState(["ARMED"]);
    if (rejectedState) return rejectedState;
    const invalidControl = control(value);
    if (invalidControl) return invalidControl;
    try {
      model.assertReady(session, plan);
      // Final checks, CONSUMED, mint and activation all run synchronously.
      const ticket = consumeCapturedPlan(plan);
      model.activate(session, plan, ticket);
      return response(true, "OK", view().state);
    } catch (error) {
      const code = fixedErrorCode(error);
      return stop(code === "INTERNAL_ERROR" ? "EVIDENCE_GATE_INVALID" : code, "FAILED");
    }
  }

  function complete() {
    const state = view();
    if (!plan || state.state !== "CONSUMED" || state.stopLatched || !session) return rejected(state.consumed ? "PLAN_CONSUMED" : "PLAN_INVALID");
    try {
      model.seal(session, plan);
      model.close(session, plan);
      return advancePlan(plan, "COMPLETED");
    } catch { return stop("EVIDENCE_WRITE_FAILED", "FAILED"); }
  }

  function fail(options) {
    const state = view();
    if (!plan || TERMINAL.has(state.state)) return rejected(state.consumed ? "PLAN_CONSUMED" : "PLAN_INVALID");
    // Use the same closed descriptor reader without inspecting caller getters.
    try {
      if (!options || typeof options !== "object" || types.isProxy(options) || Array.isArray(options) ||
          ![null, Object.prototype].includes(Object.getPrototypeOf(options))) return stop("INTERNAL_ERROR", "FAILED");
      const own = Reflect.ownKeys(options);
      const slot = Object.getOwnPropertyDescriptor(options, "unknown");
      if (own.length !== 1 || own[0] !== "unknown" || !slot || !slot.enumerable ||
          !Object.hasOwn(slot, "value") || typeof slot.value !== "boolean") return stop("INTERNAL_ERROR", "FAILED");
      return stop(slot.value ? "REQUEST_OUTCOME_UNKNOWN" : "INTERNAL_ERROR", slot.value ? "UNKNOWN" : "FAILED");
    } catch { return stop("INTERNAL_ERROR", "FAILED"); }
  }

  return Object.freeze({
    check, setControl, prepare, arm, consume, complete, fail,
    invalidate: () => stop("AUTHORIZATION_INVALID"),
    snapshot: view,
    matchesCapturedInput: (other) => matchesCapturedInput(plan, other),
    matchesNormalizedBinding: (other) => matchesNormalizedBinding(plan, other),
  });
}
