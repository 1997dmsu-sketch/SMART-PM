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
 * 探针编排（fail-fast）。
 *
 * 现场规则（复审 52227b6）：
 * - 必须先声明预批准型号 `expectedModel`；缺失即拒绝执行（不发出任何请求）；
 * - `deviceInfo` 返回后立即精确比对完整型号，空/不一致 → **不再发第二个请求**；
 * - 仅"首次 401 Digest challenge"允许重试一次；第二次 401、不可解析 challenge、
 *   指纹错误、重定向、超时、响应超限、内容类型异常、网络/TLS 错误 → 立即中止；
 * - 其它 HTTP 状态码记为端点失败但继续（例如某个 capacity 端点不支持）。
 */

const FATAL_CODES = new Set([
  "MISSING_EXPECTED_MODEL",
  "MODEL_UNPARSED",
  "MODEL_MISMATCH",
  "AUTH_CHALLENGE",
  "AUTH_FAILED",
  "FINGERPRINT_MISMATCH",
  "REDIRECT",
  "TIMEOUT",
  "TOO_LARGE",
  "CONTENT_TYPE",
  "NETWORK",
  // 复审：连接建立后的响应流/读取错误同样必须中止后续请求。
  "RESPONSE_ERROR",
]);

function fatal(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

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
    throw fatal("MISSING_CREDENTIALS", "缺少设备账号或密码环境变量");
  }
  const expectedModel = String(config.expectedModel || "").trim();
  if (!expectedModel) {
    throw fatal("MISSING_EXPECTED_MODEL", "缺少预批准型号 HIKVISION_PROBE_EXPECTED_MODEL，拒绝执行");
  }

  const base = {
    host,
    port,
    timeoutMs: config.timeoutMs,
    maxBytes: config.maxBytes,
    ca: config.ca,
    fingerprints: config.fingerprints || [],
  };

  const results = [];
  let challenge = null;
  let nonceCount = 0;
  let aborted = null;

  for (const endpoint of READ_ENDPOINTS) {
    assertAllowedRequest({ method: "GET", endpointId: endpoint.id, path: endpoint.path, query: endpoint.query });
    const path = buildRequestPath(endpoint);
    const record = {
      id: endpoint.id,
      path,
      status: 0,
      headers: {},
      body: Buffer.alloc(0),
      contentType: "",
      error: "",
      fatal: false,
    };

    try {
      let response = await transport(
        challenge
          ? { ...base, path, headers: { Authorization: authHeader(endpoint, path) } }
          : { ...base, path },
      );

      if (response.status === 401) {
        const parsed = parseChallenge(response.headers["www-authenticate"]);
        if (!parsed) {
          throw fatal("AUTH_CHALLENGE", "设备要求认证，但未返回可解析的 Digest 挑战");
        }
        challenge = parsed;
        nonceCount = 0;
        response = await transport({
          ...base,
          path,
          headers: { Authorization: authHeader(endpoint, path) },
        });
        if (response.status === 401) {
          throw fatal("AUTH_FAILED", "第二次 401：Digest 认证失败，拒绝继续");
        }
      }

      record.status = response.status;
      record.headers = response.headers;
      record.body = response.body;
      record.pinnedSlot = response.pinnedSlot ?? null;
      record.certExpired = response.certExpired ?? null;

      if (response.status !== 200) {
        const error = new Error(`HTTP ${response.status}`);
        error.code = "HTTP_STATUS";
        throw error;
      }
      record.contentType = assertContentType(response.headers, endpoint.expect);

      if (endpoint.id === "deviceInfo") {
        record.parsed = parseDeviceInfo(response.body.toString("utf8"));
        const model = String(record.parsed.model || "").trim();
        if (!model) {
          throw fatal("MODEL_UNPARSED", "deviceInfo 未返回可解析的完整型号");
        }
        if (model !== expectedModel) {
          throw fatal(
            "MODEL_MISMATCH",
            `设备型号「${model}」与预批准型号「${expectedModel}」不一致，已中止`,
          );
        }
      }
    } catch (error) {
      record.error = error.message || String(error);
      if (error?.code && FATAL_CODES.has(error.code)) {
        record.fatal = true;
        aborted = { endpoint: endpoint.id, code: error.code, reason: record.error };
        results.push(record);
        break;
      }
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
    aborted,
    target: {
      host: maskIp(host),
      port,
      hostFingerprint: fingerprintValue(host, config.salt),
      caMode: (config.fingerprints || []).length
        ? "fingerprint-pinned"
        : config.ca
          ? "controlled-ca"
          : "system-store",
      pinnedSlot: results.find((item) => item.id === "deviceInfo")?.pinnedSlot ?? null,
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
      fatal: item.fatal,
      contentType: item.contentType,
      error: item.error,
    })),
    blockers: [
      ...(aborted ? [`ABORTED @${aborted.endpoint}: ${aborted.reason}`] : []),
      ...results
        .filter((item) => !item.fatal && (item.status !== 200 || item.error))
        .map((item) => `${item.id}: ${item.error || `HTTP ${item.status}`}`),
    ],
    warnings: results.find((item) => item.id === "deviceInfo")?.certExpired
      ? ["叶证书已过期：指纹匹配通过，按复审决定仅告警，不影响本次探测"]
      : [],
  };

  return { mode: "read-only", plan, report, results };
}
