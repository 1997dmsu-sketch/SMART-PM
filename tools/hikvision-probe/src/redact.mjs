/**
 * 脱敏工具。
 *
 * 原则：进入 Git 或日志的内容不得含有可复用的设备身份信息。
 * - IP 保留网段形态（x.x.0.0）便于区分环境，但不还原主机；
 * - 序列号 / MAC / 用户名只保留长度与末位，另给加盐哈希用于跨报告关联；
 * - realm / nonce / cookie / 证书主体一律不输出。
 */
import { createHash } from "node:crypto";

export function maskIp(host) {
  const value = String(host || "");
  if (!value) return "";
  if (value.includes(":")) return "ipv6:***";
  const parts = value.split(".");
  if (parts.length !== 4) return "***";
  return `${parts[0]}.${parts[1]}.x.x`;
}

export function maskSerial(serial) {
  const value = String(serial || "").trim();
  if (!value) return "";
  if (value.length <= 2) return "*".repeat(value.length);
  return `${"*".repeat(Math.max(0, value.length - 2))}${value.slice(-2)}`;
}

export function maskMac(mac) {
  const value = String(mac || "").trim();
  if (!value) return "";
  const groups = value.split(/[:-]/);
  if (groups.length < 3) return "**:**:**:**:**:**";
  return `${groups[0]}:**:**:**:**:**`;
}

export function maskUser(username) {
  const value = String(username || "").trim();
  if (!value) return "";
  return value.length <= 2 ? "**" : `${value[0]}${"*".repeat(Math.min(6, value.length - 1))}`;
}

/** 加盐哈希，用于同一设备多次报告的关联，不可逆。 */
export function fingerprintValue(value, salt = "smart-pm-probe") {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return createHash("sha256").update(`${salt}:${text}`, "utf8").digest("hex").slice(0, 16);
}

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const MAC = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;
const DIGEST_FIELD = /\b(nonce|realm|cnonce|opaque)=("[^"]*"|[^,\s]+)/gi;
const COOKIE = /\b(?:Set-)?Cookie\s*:\s*[^\r\n]+/gi;

/** 对任意文本做兜底脱敏（用于错误信息、日志行）。 */
export function redactText(text) {
  return String(text ?? "")
    .replace(COOKIE, "Cookie: ***")
    .replace(DIGEST_FIELD, "$1=***")
    .replace(IPV4, "x.x.x.x")
    .replace(MAC, "**:**:**:**:**:**");
}
