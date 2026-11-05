/**
 * 最小图片尺寸解析（无第三方依赖）。
 *
 * 只解析文件头，不解码像素；用于 `face-biometric` 用途的"解码后尺寸"前置校验。
 * 无法识别或数据截断返回 null，由调用方 fail closed。
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(bytes) {
  // 签名(8) + 长度(4) + "IHDR"(4) + 宽(4) + 高(4)
  if (bytes.length < 24) return null;
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return { format: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    // 独立标记（无长度字段）
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;
    // SOF0..SOF3、SOF5..SOF7、SOF9..SOF11、SOF13..SOF15 含尺寸
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (offset + 8 > bytes.length) return null;
      return {
        format: "jpeg",
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

export function imageSize(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 8) return null;
  return pngSize(bytes) || jpegSize(bytes);
}
