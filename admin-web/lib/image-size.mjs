/**
 * 严格图片完整性校验（PNG / JPEG），无第三方依赖。
 *
 * 与"只读头部"不同，这里做结构级校验，拒绝伪造的 24 字节 PNG：
 * - PNG：逐块校验长度与 CRC32，要求 IHDR/IDAT/IEND，并 inflate IDAT 校验
 *   解压后扫描行长度（非隔行图）；分隔行图仅做 CRC 与结构校验。
 * - JPEG：严格遍历段结构，要求 SOI、SOF、EOI，段长合法且无截断。
 *
 * 这是"安全解码"前的完整性门槛：不解析像素，但拒绝构造不完整的文件。
 */
import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function inspectPng(bytes) {
  if (bytes.length < 8 + 12 + 12 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let offset = 8;
  let header = null;
  const idat = [];
  let sawEnd = false;

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length) return null;
    const end = offset + 8 + length;
    if (end + 4 > bytes.length) return null;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, end);
    const expected = bytes.readUInt32BE(end);
    if (crc32(bytes.subarray(offset + 4, end)) !== expected) return null;

    if (type === "IHDR") {
      if (header || length !== 13) return null;
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      sawEnd = true;
      break;
    }
    offset = end + 4;
  }

  if (!header || !sawEnd || !idat.length) return null;
  if (!header.width || !header.height) return null;

  // 非隔行 PNG：解压后必须正好是 height 行 × (1 过滤字节 + width×bpp) 字节。
  if (header.interlace === 0) {
    const channels = CHANNELS[header.colorType];
    if (!channels) return null;
    const bitsPerPixel = channels * header.bitDepth;
    const bytesPerRow = Math.ceil(bitsPerPixel / 8);
    const expectedSize = header.height * (1 + header.width * bytesPerRow);
    try {
      const raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: 64 * 1024 * 1024 });
      if (raw.length !== expectedSize) return null;
    } catch {
      return null;
    }
  }

  return { format: "png", width: header.width, height: header.height };
}

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const STANDALONE = new Set([0x01, ...Array.from({ length: 8 }, (_, i) => 0xd0 + i)]);

function inspectJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  let dimensions = null;

  while (offset + 2 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    let marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1; // 填充字节
      continue;
    }
    offset += 2;

    if (marker === 0xd9) return dimensions; // EOI
    if (STANDALONE.has(marker)) continue;
    if (offset + 2 > bytes.length) return null;

    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;

    if (SOF_MARKERS.has(marker)) {
      if (length < 8) return null;
      dimensions = {
        format: "jpeg",
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }

    offset += length;

    if (marker === 0xda) {
      // SOS 之后是熵编码数据，必须存在 EOI 且其后不再有结构数据。
      if (!dimensions) return null;
      const end = bytes.lastIndexOf(Buffer.from([0xff, 0xd9]));
      if (end < offset) return null;
      return dimensions;
    }
  }
  return null;
}

export function inspectImage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  return inspectPng(bytes) || inspectJpeg(bytes);
}
