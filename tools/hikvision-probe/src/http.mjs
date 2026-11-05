import https from "node:https";
import { createHash, timingSafeEqual } from "node:crypto";
import { redactText } from "./redact.mjs";

/**
 * 只读 HTTPS 客户端。
 *
 * TLS 有两种模式，且**没有"跳过校验"的配置**：
 * 1. 默认模式：系统信任链（rejectUnauthorized=true）。
 * 2. 指纹固定模式：现场线下核验过的 SHA-256 叶证书指纹（可多枚，支持轮换）。
 *    握手时临时关闭系统信任链，但随即用**常量时间比较**校验叶证书指纹；
 *    不匹配或取不到证书立即终止，请求不会发出。
 *
 * 其他约束：只发 GET；拒绝 3xx；连接/整体超时；响应体超过 maxBytes 立即中断。
 */

export class HttpError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HttpError";
    this.code = code;
  }
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 256 * 1024;

export function normalizeFingerprint(value) {
  return String(value || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
}

/**
 * 解析 `HIKVISION_PROBE_FINGERPRINT256`：逗号分隔，顺序为「当前, 下一枚」。
 * 任一项不是 64 位十六进制即整体拒绝（fail closed）。
 */
export function parseFingerprints(raw) {
  if (raw === undefined || raw === null) return [];
  const text = String(raw).trim();
  if (!text) return [];

  const parsed = [];
  for (const item of text.split(",")) {
    const normalized = normalizeFingerprint(item);
    // 复审：非空配置里出现空项或不可解析内容必须报错，不能静默忽略。
    if (!normalized) {
      throw new HttpError("BAD_FINGERPRINT", "指纹配置包含空项或无法解析的内容");
    }
    if (!/^[0-9A-F]{64}$/.test(normalized)) {
      throw new HttpError("BAD_FINGERPRINT", "证书指纹必须是 64 位十六进制的 SHA-256");
    }
    if (!parsed.includes(normalized)) parsed.push(normalized);
  }
  if (!parsed.length) {
    throw new HttpError("BAD_FINGERPRINT", "指纹配置非空但无法解析");
  }
  if (parsed.length > 2) {
    throw new HttpError("BAD_FINGERPRINT", "最多配置两枚指纹（当前, 下一枚）");
  }
  return parsed;
}

/** 常量时间比较；返回命中下标，未命中返回 -1。 */
export function matchFingerprint(rawCertificate, allowed) {
  if (!rawCertificate || !allowed?.length) return -1;
  const actual = createHash("sha256").update(rawCertificate).digest();
  for (let index = 0; index < allowed.length; index += 1) {
    const expected = Buffer.from(allowed[index], "hex");
    if (expected.length === actual.length && timingSafeEqual(actual, expected)) return index;
  }
  return -1;
}

export function assertContentType(headers, expect) {  const raw = String(headers["content-type"] || "").toLowerCase();
  if (!raw) return ""; // 部分固件不返回 content-type，交给解析层判断
  const json = raw.includes("json");
  const xml = raw.includes("xml");
  const text = raw.includes("text/plain");
  const acceptable = expect === "json" ? json || text : xml || json || text;
  if (!acceptable) throw new HttpError("CONTENT_TYPE", `意外的响应类型：${raw}`);
  return raw;
}

export function certificateValidity(certificate, now = Date.now()) {
  const raw = certificate?.valid_to;
  if (!raw) return { validTo: null, expired: null };
  const validTo = new Date(raw);
  if (Number.isNaN(validTo.getTime())) return { validTo: null, expired: null };
  return { validTo: validTo.toISOString(), expired: validTo.getTime() < now };
}

/**
 * @param {object} options
 * @param {string} options.host
 * @param {number} [options.port]
 * @param {string} options.path
 * @param {Record<string,string>} [options.headers]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxBytes]
 * @param {string|Buffer} [options.ca]          受控 CA（默认模式下的补充信任根）
 * @param {string[]} [options.fingerprints]     已线下核验的 SHA-256 叶证书指纹（可多枚）
 */
export function httpsGet({
  host,
  port = 443,
  path,
  headers = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  ca,
  fingerprints = [],
  servername,
  agent,
}) {
  const pinned = fingerprints.length > 0;

  return new Promise((resolve, reject) => {
    let settled = false;
    let pinnedSlot = null;
    let certExpired = null;
    let certValidTo = null;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };

    const options = {
      host,
      port,
      path,
      method: "GET",
      headers: { Accept: "*/*", "User-Agent": "smart-pm-hikvision-probe/0.1", ...headers },
      timeout: timeoutMs,
      // 指纹模式：系统信任链必然拒绝自签名证书，改为自有校验；
      // 没有指纹时保持系统校验，二者不存在"全部跳过"的中间态。
      rejectUnauthorized: !pinned,
      agent,
    };
    if (pinned) {
      // 指纹固定时主机名不再作为信任依据（设备通常用 IP 访问）；
      // 安全边界完全由下面的叶证书指纹比较承担。
      options.checkServerIdentity = () => undefined;
    } else if (ca) {
      options.ca = ca;
    }
    if (servername) options.servername = servername;

    const request = https.request(options, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400) {
        response.resume();
        finish(new HttpError("REDIRECT", `拒绝重定向：${status} ${response.headers.location || ""}`.trim()));
        return;
      }

      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes) {
        response.destroy();
        finish(new HttpError("TOO_LARGE", `响应体超过上限：${declared} > ${maxBytes}`));
        return;
      }

      const chunks = [];
      let received = 0;
      response.on("data", (chunk) => {
        received += chunk.length;
        if (received > maxBytes) {
          response.destroy();
          finish(new HttpError("TOO_LARGE", `响应体超过上限：>${maxBytes}`));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        finish(null, {
          status,
          headers: response.headers,
          body: Buffer.concat(chunks),
          pinnedSlot,
          certExpired,
          certValidTo,
        });
      });
      response.on("error", (error) => finish(new HttpError("RESPONSE_ERROR", redactText(error.message))));
    });

    if (pinned) {
      request.on("socket", (socket) => {
        socket.once("secureConnect", () => {
          const certificate = socket.getPeerCertificate?.();
          const slot = matchFingerprint(certificate?.raw, fingerprints);
          if (slot < 0) {
            request.destroy(
              new HttpError(
                "FINGERPRINT_MISMATCH",
                certificate?.raw ? "叶证书指纹与固定值不一致" : "未能取得叶证书，拒绝连接",
              ),
            );
            return;
          }
          pinnedSlot = slot;
          // 复审决定：纯指纹模式不校验证书有效期与主机名。
          // 过期只作为告警上报，绝不阻断（现场自签名设备常带过期证书）。
          const validity = certificateValidity(certificate);
          certExpired = validity.expired;
          certValidTo = validity.validTo;
        });
      });
    }

    request.on("timeout", () => {
      request.destroy(new HttpError("TIMEOUT", `请求超时（${timeoutMs}ms）`));
    });
    request.on("error", (error) => {
      finish(error instanceof HttpError ? error : new HttpError("NETWORK", redactText(error.message)));
    });

    request.end();
  });
}
