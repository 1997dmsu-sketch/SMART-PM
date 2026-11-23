// CR-2 fixed-probe binding for the single private runtime owner in
// private-plan.mjs. This module holds no authorization, private configuration,
// owner state or session data and never imports the owner or the facades
// (no reverse import). It exposes only fixed vendor references and pure data
// helpers. There is deliberately no generic invoke(config, callerTransport)
// product entry here: the only transport ever passed to runProbe is the
// owner's private non-forwarding synthetic stub.
import { READ_ENDPOINTS, buildRequestPath } from "./vendor/probe-558b9c8/allowlist.mjs";
import { parseChallenge } from "./vendor/probe-558b9c8/digest.mjs";
import { assertContentType } from "./vendor/probe-558b9c8/http.mjs";
import { runProbe } from "./vendor/probe-558b9c8/probe.mjs";
import { parseDeviceInfo } from "./vendor/probe-558b9c8/report.mjs";

/** Fixed vendor references only; frozen so no caller can re-bind them. */
export const fixedProbe = Object.freeze({
  runProbe,
  parseDeviceInfo,
  parseChallenge,
  assertContentType,
});

/** Private copies of the fixed six-endpoint definitions (pure data). */
export const fixedEndpoints = Object.freeze(
  READ_ENDPOINTS.map((endpoint) => Object.freeze({ ...endpoint })),
);

const PATHS = Object.freeze(Object.fromEntries(
  READ_ENDPOINTS.map((endpoint) => [buildRequestPath(endpoint), endpoint.id]),
));
const BY_ID = Object.freeze(Object.fromEntries(
  READ_ENDPOINTS.map((endpoint) => [endpoint.id, buildRequestPath(endpoint)]),
));

/** Exact fixed-path to endpoint-id mapping; anything else returns null. */
export function endpointIdForPath(path) {
  if (typeof path !== "string") return null;
  return Object.hasOwn(PATHS, path) ? PATHS[path] : null;
}

/** Fixed endpoint-id to exact built request path (including allowed query). */
export function requestPathFor(endpointId) {
  if (typeof endpointId !== "string") return null;
  return Object.hasOwn(BY_ID, endpointId) ? BY_ID[endpointId] : null;
}
