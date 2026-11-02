import { fail } from "./model.mjs";
export const VR_LIMIT = 50 * 1024 * 1024;
export function vrLink(value = "") {
  if (typeof value !== "string" || value.length > 2048) fail("VR 链接格式错误");
  value = value.trim();
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("VR 链接需为完整 HTTPS 地址");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password
  )
    fail("VR 链接仅支持无账号密码的 HTTPS 地址");
  return url.href;
}
export function vrFile(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "object" || Array.isArray(value))
    fail("VR 文件信息无效");
  const { url, name, size } = value;
  if (
    typeof url !== "string" ||
    !/^(\/vr-files\/|cloud:\/\/[^\s]+\/admin-vr\/)[a-f0-9-]+\.(zip|html)$/.test(
      url,
    )
  )
    fail("VR 文件地址无效");
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 180 ||
    /[\r\n/\\]/.test(name) ||
    !/\.(zip|html?)$/i.test(name)
  )
    fail("VR 文件名称无效");
  if (!Number.isInteger(size) || size < 1 || size > VR_LIMIT)
    fail("VR 文件不能超过 50 MB");
  return { url, name, size };
}
export function vrUpload(bytes, name) {
  if (!bytes.length || bytes.length > VR_LIMIT)
    fail("VR 文件需为 1 字节至 50 MB");
  const ext = /\.zip$/i.test(name)
    ? "zip"
    : /\.html?$/i.test(name)
      ? "html"
      : null;
  if (!ext) fail("仅支持 ZIP 或 HTML 项目文件");
  if (
    ext === "zip" &&
    !(
      bytes[0] === 80 &&
      bytes[1] === 75 &&
      ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6))
    )
  )
    fail("文件不是 ZIP 格式");
  if (
    ext === "html" &&
    !/<(!doctype\s+html|html|head|body)\b/i.test(
      bytes.subarray(0, 65536).toString("utf8"),
    )
  )
    fail("文件不是 HTML 文档");
  vrFile({ url: `/vr-files/0000.${ext}`, name, size: bytes.length });
  return ext;
}
