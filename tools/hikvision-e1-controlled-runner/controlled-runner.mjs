// CR-2 compatibility facade. The single private runtime owner lives in
// private-plan.mjs; the original synthetic controller keeps its method set,
// return shapes and CR-1 behavior there. This module re-exports the original
// factory and never returns secrets, configuration, sessions or transport
// abilities. (The CR-2 synthetic probe factory is added in the next commit.)
export { createSyntheticController } from "./private-plan.mjs";
