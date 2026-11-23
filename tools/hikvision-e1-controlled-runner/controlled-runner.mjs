// CR-2 compatibility facade. The single private runtime owner lives in
// private-plan.mjs; the original synthetic controller keeps its method set,
// return shapes and CR-1 behavior there, and the CR-2 synthetic probe
// controller is implemented there too. This module only re-exports the fixed
// factories and never returns secrets, configuration, sessions or transport
// abilities.
export { createSyntheticController, createSyntheticProbeController } from "./private-plan.mjs";
