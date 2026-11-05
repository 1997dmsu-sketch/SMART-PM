import https from "node:https";
import { redactText } from "./redact.mjs";

/**
 * 只读 HTTPS 客户端。
 *
 * 安全约束：
 * - 只发 GET；不接受重定向（任何 3xx 直接失败，避免被引到其他主机）；
 * - 校验证书（默认 rejectUnauthorized），支持受控 CA 或证书指纹固定；
 * - 连接与整体超时；响应体超过 maxBytes 立即中断；
 * - 错误信息经过脱敏后才向上抛。
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

export function assertContentType(headers, expect) {
  const raw = String(headers["content-type"] || "").toLowerCase();
  if (!raw) return ""; // 部分固件不返回 content-type，交给解析层判断
  const json = raw.includes("json");
  const xml = raw.includes("xml");
  const text = raw.includes("text/plain");
  const acceptable = expect === "json" ? json || text : xml || json || text;
  if (!acceptable) throw new HttpError("CONTENT_TYPE", `意外的响应类型：${raw}`);
  return raw;
}

/**
 * @param {object} options
 * @param {string} options.host
 * @param {number} [options.port]
 * @param {string} options.path      已包含白名单查询串
 * @param {Record<string,string>} [options.headers]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxBytes]
 * @param {string|Buffer} [options.ca]   受控 CA（PEM）
 * @param {string} [options.fingerprint256] 证书 SHA-256 指纹（冒号可有可无）
 * @param {string} [options.servername]
 * @param {object} [options.agent]
 */
export function httpsGet({
  host,
  port = 443,
  path,
  headers = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  ca,
  fingerprint256,
  servername,
  agent,
}) {
  return new Promise((resolve, reject) => {
    let settled = false;
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
      rejectUnauthorized: true,
      agent,
    };
    if (ca) options.ca = ca;
    if (servername) options.servername = servername;
    if (fingerprint256) options.checkServerIdentity = () => undefined; // 仅跳过主机名校验部分，证书链仍校验

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
        });
      });
      response.on("error", (error) => finish(new HttpError("RESPONSE_ERROR", redactText(error.message))));
    });

    request.on("socket", (socket) => {
      socket.once("secureConnect", () => {
        if (!fingerprint256) return;
        const certificate = socket.getPeerCertificate?.();
        const actual = normalizeFingerprint(certificate?.fingerprint256);
        if (!actual || actual !== normalizeFingerprint(fingerprint256)) {
          request.destroy(new HttpError("FINGERPRINT_MISMATCH", "证书指纹与固定值不一致"));
        }
      });
    });

    request.on("timeout", () => {
      request.destroy(new HttpError("TIMEOUT", `请求超时（${timeoutMs}ms）`));
    });
    request.on("error", (error) => {
      finish(error instanceof HttpError ? error : new HttpError("NETWORK", redactText(error.message)));
    });

    request.end();
  });
}
