import {
  READ_ENDPOINTS,
  assertAllowedHost,
  assertAllowedPort,
  assertAllowedRequest,
  buildRequestPath,
} from "./allowlist.mjs";
import { buildAuthorization, makeCnonce, parseChallenge } from "./digest.mjs";
import { assertContentType } from "./http.mjs";
import { parseCapabilities, parseCount, parseDeviceInfo, parseFdLibList } from "./report.mjs";
import { fingerprintValue, maskIp } from "./redact.mjs";

/**
 * 探针编排。
 *
 * - `config.allowRead !== true` 时只返回计划，**不调用 transport**；
 * - 每个端点先按白名单逐字校验，再发请求；
 * - 首次 401 时解析 Digest 挑战并重试一次，之后复用挑战做预认证；
 * - 认证失败、超时、过大响应、类型不符都记为该端点失败，不中断其余端点。
 */
export async function runProbe({ config, transport, now = () => new Date().toISOString() }) {
  const plan = READ_ENDPOINTS.map((endpoint) => ({
    id: endpoint.id,
    method: "GET",
    path: buildRequestPath(endpoint),
  }));

  if (!config.allowRead) {
    return { mode: "dry-run", plan, report: null, results: [] };
  }

  const host = assertAllowedHost(config.host, config.allowedHosts);
  const port = assertAllowedPort(config.port, config.allowedPorts);
  if (!config.username || !config.password) {
    const error = new Error("缺少设备账号或密码环境变量");
    error.code = "MISSING_CREDENTIALS";
    throw error;
  }

  const base = {
    host,
    port,
    timeoutMs: config.timeoutMs,
    maxBytes: config.maxBytes,
    ca: config.ca,
    fingerprint256: config.fingerprint256,
  };

  const results = [];
  let challenge = null;
  let nonceCount = 0;

  for (const endpoint of READ_ENDPOINTS) {
    assertAllowedRequest({ method: "GET", endpointId: endpoint.id, path: endpoint.path, query: endpoint.query });
    const path = buildRequestPath(endpoint);
    const record = { id: endpoint.id, path, status: 0, headers: {}, body: Buffer.alloc(0), contentType: "", error: "" };

    try {
      let response = await transport(challenge
        ? { ...base, path, headers: { Authorization: authHeader(endpoint, path) } }
        : { ...base, path });

      if (response.status === 401) {
        const parsed = parseChallenge(response.headers["www-authenticate"]);
        if (!parsed) {
          const error = new Error("设备要求认证，但未返回可解析的 Digest 挑战");
          error.code = "AUTH_CHALLENGE";
          throw error;
        }
        challenge = parsed;
        nonceCount = 0;
        response = await transport({ ...base, path, headers: { Authorization: authHeader(endpoint, path) } });
      }

      record.status = response.status;
      record.headers = response.headers;
      record.body = response.body;

      if (response.status !== 200) {
        const error = new Error(`HTTP ${response.status}`);
        error.code = "HTTP_STATUS";
        throw error;
      }
      record.contentType = assertContentType(response.headers, endpoint.expect);
      if (endpoint.id === "deviceInfo") record.parsed = parseDeviceInfo(response.body.toString("utf8"));
    } catch (error) {
      record.error = error.message || String(error);
    }

    results.push(record);
  }

  function authHeader(endpoint, path) {
    nonceCount += 1;
    return buildAuthorization({
      username: config.username,
      password: config.password,
      method: "GET",
      uri: path,
      challenge,
      nc: String(nonceCount),
      cnonce: makeCnonce(),
    });
  }

  const deviceParsed = results.find((item) => item.id === "deviceInfo")?.parsed || {};
  const byId = Object.fromEntries(results.map((item) => [item.id, item]));
  const acsCaps = parseCapabilities(byId.acsCapabilities?.body || "");
  const userCaps = parseCapabilities(byId.userInfoCapabilities?.body || "");
  const fdlibCaps = parseCapabilities(byId.fdlibCapabilities?.body || "");
  const fdlibList = parseFdLibList(byId.fdlibList?.body || "");

  const report = {
    generatedAt: now(),
    target: {
      host: maskIp(host),
      port,
      hostFingerprint: fingerprintValue(host, config.salt),
      caMode: config.fingerprint256 ? "fingerprint-pinned" : config.ca ? "controlled-ca" : "system-store",
    },
    // 只保留型号/固件类字段；序列号、MAC、设备名等身份信息不进入报告。
    device: {
      model: deviceParsed.model || "",
      deviceType: deviceParsed.deviceType || "",
      firmwareVersion: deviceParsed.firmwareVersion || "",
      firmwareReleasedDate: deviceParsed.firmwareReleasedDate || "",
    },
    capabilities: {
      acsNodeCount: acsCaps.nodeCount,
      acsSupportedSample: acsCaps.supported.slice(0, 40),
      acsFaceRelated: acsCaps.faceRelated,
      userInfoFaceRelated: userCaps.faceRelated,
      fdlibFaceRelated: fdlibCaps.faceRelated,
      faceLibraryManagement: acsCaps.supported.some((name) => /facelibrary|fdlib/i.test(name)),
    },
    counts: {
      faceRecords: parseCount(byId.fdlibCount?.body || ""),
      faceLibraries: Array.isArray(fdlibList) ? fdlibList.length : 0,
    },
    checks: results.map((item) => ({
      id: item.id,
      status: item.status,
      ok: item.status === 200 && !item.error,
      contentType: item.contentType,
      error: item.error,
    })),
    blockers: results
      .filter((item) => item.status !== 200 || item.error)
      .map((item) => `${item.id}: ${item.error || `HTTP ${item.status}`}`),
  };

  return { mode: "read-only", plan, report, results };
}
