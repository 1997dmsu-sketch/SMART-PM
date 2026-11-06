/**
 * 路由描述表（提案，不注册到 server.mjs）。
 * 路径按 72a093a 裁定：撤权走 device-access-grants，任务统一 device-operation-jobs。
 */

export const FACE_ROUTES = Object.freeze([
  {
    id: "face-credential-submit",
    method: "POST",
    path: "/api/v2/face-credentials",
    permission: "device.face.submit",
    idempotent: true,
  },
  {
    id: "face-review-queue",
    method: "GET",
    path: "/api/v2/face-credentials/review-queue",
    permission: "device.face.review",
  },
  {
    id: "face-credential-review",
    method: "POST",
    path: "/api/v2/face-credentials/:credentialId/review",
    permission: "device.face.review",
    idempotent: true,
  },
  {
    id: "face-credential-image",
    method: "GET",
    path: "/api/v2/face-credentials/:credentialId/image",
    permission: "device.face.readPrivate",
  },
  {
    id: "device-grant-revoke",
    method: "POST",
    path: "/api/v2/device-access-grants/:grantId/revoke",
    permission: "device.access.manage",
    idempotent: true,
  },
  {
    id: "device-operation-job-list",
    method: "GET",
    path: "/api/v2/device-operation-jobs",
    permission: "device.audit.read",
  },
  {
    id: "device-operation-job-retry",
    method: "POST",
    path: "/api/v2/device-operation-jobs/:jobId/retry",
    permission: "device.operation.retry",
    idempotent: true,
  },
  {
    id: "device-operation-job-reconcile",
    method: "POST",
    path: "/api/v2/device-operation-jobs/:jobId/reconcile",
    permission: "device.operation.reconcile",
    idempotent: true,
  },
]);

const patternOf = (path) => new RegExp(`^${path.replace(/:[A-Za-z0-9_]+/g, "([^/]+)")}$`);

export function matchFaceRoute(method, path) {
  for (const route of FACE_ROUTES) {
    if (route.method !== method.toUpperCase()) continue;
    const match = patternOf(route.path).exec(path);
    if (!match) continue;
    const keys = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    return {
      route,
      params: Object.fromEntries(keys.map((key, i) => [key, decodeURIComponent(match[i + 1])])),
    };
  }
  return null;
}
