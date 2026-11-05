import { createHash, randomBytes } from "node:crypto";

/**
 * RFC 7616 / RFC 2617 Digest 客户端。
 *
 * 设备通常只支持 `MD5`（部分固件支持 `SHA-256`），因此这里实现：
 *   - 解析 `WWW-Authenticate: Digest ...` 挑战
 *   - qop 优先选 `auth`（不支持 auth-int）
 *   - 支持 algorithm=MD5 / SHA-256（含 *-sess 最小实现）
 *
 * 不发送密码明文；`nc` 与 `cnonce` 由调用方按会话递增。
 */

const ALGORITHMS = {
  MD5: (value) => createHash("md5").update(value, "utf8").digest("hex"),
  "MD5-SESS": (value) => createHash("md5").update(value, "utf8").digest("hex"),
  SHA256: (value) => createHash("sha256").update(value, "utf8").digest("hex"),
  "SHA256-SESS": (value) => createHash("sha256").update(value, "utf8").digest("hex"),
};

export class DigestError extends Error {
  constructor(message) {
    super(message);
    this.name = "DigestError";
  }
}

function normalizeAlgorithm(value) {
  return String(value || "MD5").trim().toUpperCase();
}

function hashFor(algorithm) {
  const normalized = normalizeAlgorithm(algorithm).replace(/-SESS$/, "");
  const hash = ALGORITHMS[normalized];
  if (!hash) throw new DigestError(`不支持的摘要算法：${algorithm}`);
  return hash;
}

function unquote(value) {
  const trimmed = String(value).trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
}

/** 解析 `WWW-Authenticate` 头；返回 null 表示不是 Digest 挑战。 */
export function parseChallenge(header) {
  if (!header) return null;
  const text = Array.isArray(header) ? header.join(", ") : String(header);
  const match = text.match(/(?:^|,)\s*Digest\s+(.*)$/is);
  if (!match) return null;

  const fields = {};
  const pattern = /([a-zA-Z0-9_-]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^,\s]+)/g;
  let item;
  while ((item = pattern.exec(match[1])) !== null) {
    fields[item[1].toLowerCase()] = unquote(item[2]);
  }
  if (!fields.realm || !fields.nonce) throw new DigestError("Digest 挑战缺少 realm 或 nonce");
  return {
    realm: fields.realm,
    nonce: fields.nonce,
    opaque: fields.opaque || "",
    algorithm: fields.algorithm || "MD5",
    qop: fields.qop ? fields.qop.split(",").map((value) => value.trim().toLowerCase()) : [],
    stale: String(fields.stale || "").toLowerCase() === "true",
  };
}

export function makeCnonce() {
  return randomBytes(8).toString("hex");
}

/**
 * 生成 Authorization 头。
 * @param {object} input
 * @param {string} input.username
 * @param {string} input.password
 * @param {string} input.method
 * @param {string} input.uri  例如 /ISAPI/System/deviceInfo
 * @param {object} input.challenge  parseChallenge 的返回值
 * @param {string} [input.cnonce]
 * @param {string|number} [input.nc]  nonce 计数，默认 00000001
 */
export function buildAuthorization({ username, password, method, uri, challenge, cnonce, nc = "00000001" }) {
  if (!challenge) throw new DigestError("缺少 Digest 挑战");
  if (!username) throw new DigestError("缺少用户名");

  const algorithm = normalizeAlgorithm(challenge.algorithm);
  const hash = hashFor(algorithm);
  const useQop = challenge.qop.includes("auth") ? "auth" : "";
  const cnonceValue = useQop ? cnonce || makeCnonce() : "";
  const ncValue = useQop ? String(nc).padStart(8, "0") : "";

  const ha1Base = hash(`${username}:${challenge.realm}:${password ?? ""}`);
  const ha1 = algorithm.endsWith("-SESS") ? hash(`${ha1Base}:${challenge.nonce}:${cnonceValue}`) : ha1Base;
  const ha2 = hash(`${method}:${uri}`);

  const response = useQop
    ? hash(`${ha1}:${challenge.nonce}:${ncValue}:${cnonceValue}:${useQop}:${ha2}`)
    : hash(`${ha1}:${challenge.nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    `algorithm=${algorithm}`,
  ];
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  if (useQop) parts.push(`qop=${useQop}`, `nc=${ncValue}`, `cnonce="${cnonceValue}"`);
  return `Digest ${parts.join(", ")}`;
}

/**
 * 维护同一台设备的 nonce 只递增不回退；返回自增后的值。
 * 设备重启后 nonce 会变，调用方在 401 后重新取挑战即可。
 */
export function nextNonceCount(counter) {
  const next = (Number(counter) || 0) + 1;
  return { next, value: String(next).padStart(8, "0") };
}
