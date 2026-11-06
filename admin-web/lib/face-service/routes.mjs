/**
 * 路由描述表（骨架）。
 *
 * 只声明 method/path/permission/DTO 校验，不注册到 server.mjs；
 * 正式接线等待 AI-C 阶段 2 终审与指定集成基线。
 * permission 中 manage 类为占位，需与 Codex 对齐后定名。
 */

export const FACE_ROUTES = Object.freeze([
  {
    id: "face-credential-create",
    method: "POST",
    path: "/api/v2/face-credentials",
    permission: "device.face.submit",
    dto: "faceCredentialInput",
    idempotent: true,
  },
  {
    id: "face-credential-list",
    method: "GET",
    path: "/api/v2/face-credentials",
    permission: "device.face.readPrivate",
  },
  {
    id: "face-credential-review",
    method: "POST",
    path: "/api/v2/face-credentials/:credentialId/review",
    permission: "device.face.review",
    dto: "reviewInput",
    idempotent: true,
  },
  {
    id: "face-credential-delete",
    method: "POST",
    path: "/api/v2/face-credentials/:credentialId/revoke",
    permission: "device.face.manage",
    idempotent: true,
  },
  {
    id: "device-job-list",
    method: "GET",
    path: "/api/v2/device-jobs",
    permission: "device.face.manage",
  },
]);

const patternOf = (path) =>
  new RegExp(`^${path.replace(/:[A-Za-z0-9_]+/g, "([^/]+)")}$`);

export function matchFaceRoute(method, path) {
  for (const route of FACE_ROUTES) {
    if (route.method !== method.toUpperCase()) continue;
    const match = patternOf(route.path).exec(path);
    if (!match) continue;
    const keys = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    return {
      route,
      params: Object.fromEntries(keys.map((key, index) => [key, decodeURIComponent(match[index + 1])])),
    };
  }
  return null;
}
