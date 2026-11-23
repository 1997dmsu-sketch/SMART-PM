// CR-2 compatibility facade. The single private runtime owner lives in
// private-plan.mjs; the original in-memory evidence model keeps its method
// set, return shapes and CR-1 behavior there. This module exports nothing
// beyond that relocated factory and never returns secrets or sessions.
export { createSyntheticEvidenceModel } from "./private-plan.mjs";
