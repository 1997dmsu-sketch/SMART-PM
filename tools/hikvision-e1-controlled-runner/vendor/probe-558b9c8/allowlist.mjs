/**
 * 只读端点白名单与主机/端口校验。
 *
 * 规则（来自 HK-AI-02 任务卡）：
 * - 只允许 GET；
 * - 路径必须与白名单**完全一致**，不做前缀匹配；
 * - 主机必须由调用方显式列入允许列表，端口必须在允许集合内；
 * - 不跟随重定向（由 http 层拒绝 3xx）。
 */

export const READ_ENDPOINTS = Object.freeze([
  { id: "deviceInfo", path: "/ISAPI/System/deviceInfo", query: "", expect: "xml" },
  { id: "acsCapabilities", path: "/ISAPI/AccessControl/capabilities", query: "", expect: "xml" },
  { id: "userInfoCapabilities", path: "/ISAPI/AccessControl/UserInfo/capabilities", query: "format=json", expect: "json" },
  { id: "fdlibCapabilities", path: "/ISAPI/Intelligent/FDLib/capabilities", query: "format=json", expect: "json" },
  { id: "fdlibList", path: "/ISAPI/Intelligent/FDLib", query: "format=json", expect: "json" },
  { id: "fdlibCount", path: "/ISAPI/Intelligent/FDLib/Count", query: "format=json", expect: "json" },
]);

export const ALLOWED_METHOD = "GET";
export const DEFAULT_ALLOWED_PORTS = Object.freeze([443, 8443]);

export class ProbeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProbeError";
    this.code = code;
  }
}

const PATH_PATTERN = /^\/[A-Za-z0-9/_.-]*$/;

export function listEndpoints() {
  return READ_ENDPOINTS.map((endpoint) => ({ ...endpoint }));
}

export function findEndpoint(id) {
  return READ_ENDPOINTS.find((endpoint) => endpoint.id === id) || null;
}

export function parseAllowedHosts(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function parseAllowedPorts(raw) {
  if (!raw) return [...DEFAULT_ALLOWED_PORTS];
  const ports = String(raw)
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0 && value < 65536);
  if (!ports.length) throw new ProbeError("BAD_PORT_LIST", "允许端口列表为空或非法");
  return [...new Set(ports)];
}

export function assertAllowedHost(host, allowedHosts) {
  const normalized = String(host || "").trim().toLowerCase();
  if (!normalized) throw new ProbeError("BAD_HOST", "缺少目标主机");
  if (!allowedHosts.includes(normalized)) {
    throw new ProbeError("HOST_NOT_ALLOWED", `主机不在允许列表：${normalized}`);
  }
  return normalized;
}

export function assertAllowedPort(port, allowedPorts) {
  const value = Number(port);
  if (!Number.isInteger(value) || !allowedPorts.includes(value)) {
    throw new ProbeError("PORT_NOT_ALLOWED", `端口不在允许列表：${port}`);
  }
  return value;
}

/**
 * 校验一次请求是否在白名单内。路径与查询串必须与端点定义逐字一致，
 * 避免 `/ISAPI/Intelligent/FDLib/../System/deviceInfo` 或额外查询参数绕过。
 */
export function assertAllowedRequest({ method, endpointId, path, query = "" }) {
  const endpoint = findEndpoint(endpointId);
  if (!endpoint) throw new ProbeError("ENDPOINT_NOT_ALLOWED", `未知端点：${endpointId}`);
  if (method !== ALLOWED_METHOD) {
    throw new ProbeError("METHOD_NOT_ALLOWED", `只允许 ${ALLOWED_METHOD}，收到 ${method}`);
  }
  if (!PATH_PATTERN.test(path) || path.includes("..") || path.includes("//")) {
    throw new ProbeError("PATH_NOT_ALLOWED", `路径格式非法：${path}`);
  }
  if (path !== endpoint.path) {
    throw new ProbeError("PATH_NOT_ALLOWED", `路径不在白名单：${path}`);
  }
  if (String(query || "") !== endpoint.query) {
    throw new ProbeError("QUERY_NOT_ALLOWED", `查询串不在白名单：${query}`);
  }
  return endpoint;
}

/** 拼出带白名单查询串的 request path，供 https 客户端使用。 */
export function buildRequestPath(endpoint) {
  return endpoint.query ? `${endpoint.path}?${endpoint.query}` : endpoint.path;
}
