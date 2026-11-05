/**
 * 图片容器边界检查：确认 EOI / IEND 之后没有任何字节。
 *
 * 复审要求：
 * - PNG：唯一 IEND 的结束位置必须等于文件长度；
 * - JPEG：正确解析 marker、scan、字节填充（0xFF00）与 restart marker（0xFFD0–D7），
 *   定位**真实** EOI；
 * - EOI/IEND 之后任何字节（0x00、重复结束标记、伪装载荷）一律拒绝；
 * - 不能只看最后两个字节。
 *
 * 本模块只做容器边界，不做像素解码；像素解码仍由 sharp 负责。
 */
import { failCode } from "./model.mjs";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 返回 IEND 之后的偏移；结构异常返回 -1。 */
export function pngEndOffset(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 20) return -1;
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return -1;
  let offset = 8;
  let end = -1;
  let iendCount = 0;

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length) return -1;
    const dataEnd = offset + 8 + length;
    if (dataEnd + 4 > bytes.length) return -1;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IEND") {
      iendCount += 1;
      end = dataEnd + 4;
      break;
    }
    offset = dataEnd + 4;
  }
  return iendCount === 1 ? end : -1;
}

/**
 * 返回真实 EOI 之后的偏移；结构异常返回 -1。
 * 支持多扫描（progressive）、填充字节、restart marker 与扫描内字节填充。
 */
export function jpegEndOffset(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) return -1;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return -1;

  let offset = 2;
  scan: while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return -1;
    let marker = bytes[offset + 1];
    // 填充字节：0xFF 可重复出现
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (offset + 2 > bytes.length) return -1;
    offset += 2;

    if (marker === 0xd9) return offset; // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // 独立标记
    if (offset + 2 > bytes.length) return -1;

    const length = bytes.readUInt16BE(offset);
    if (length < 2) return -1;
    const segmentEnd = offset + length;
    if (segmentEnd > bytes.length) return -1;

    if (marker === 0xda) {
      // 熵编码数据：处理 0xFF00 填充与 restart marker，直到遇到下一个真实标记。
      let cursor = segmentEnd;
      while (cursor + 1 < bytes.length) {
        if (bytes[cursor] !== 0xff) {
          cursor += 1;
          continue;
        }
        const next = bytes[cursor + 1];
        if (next === 0x00) {
          cursor += 2;
          continue;
        }
        if (next >= 0xd0 && next <= 0xd7) {
          cursor += 2;
          continue;
        }
        if (next === 0xd9) return cursor + 2; // 真实 EOI
        // 其它标记：可能是下一扫描段（progressive），回到外层解析。
        offset = cursor;
        continue scan;
      }
      return -1;
    }

    offset = segmentEnd;
  }
  return -1;
}

/**
 * 校验文件在结束标记后没有任何字节。
 * 非 JPEG/PNG 直接拒绝；结构不完整或存在尾随数据同样拒绝。
 */
export function assertNoTrailingPayload(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) {
    failCode("PARAM_ERROR", "人脸图片为空或过短");
  }
  let end = -1;
  let kind = "";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    end = jpegEndOffset(bytes);
    kind = "JPEG";
  } else if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    end = pngEndOffset(bytes);
    kind = "PNG";
  } else {
    failCode("PARAM_ERROR", "人脸图片仅支持 JPEG 或 PNG");
  }
  if (end < 0) failCode("PARAM_ERROR", `${kind} 结构不完整或缺少结束标记`);
  if (end !== bytes.length) {
    failCode("PARAM_ERROR", `${kind} 结束标记之后存在多余数据（尾随载荷）`);
  }
  return end;
}
