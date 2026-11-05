import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

import { crc32, inspectImage } from "../lib/image-size.mjs";
import {
  FACE_MAX_DIMENSION,
  FACE_MIN_DIMENSION,
  assertFaceImage,
  publicAsset,
} from "../lib/files.mjs";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** 生成结构完整、CRC 与解压尺寸都正确的 PNG（RGB 8bit，无隔行）。 */
function png(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const row = Buffer.alloc(1 + width * 3); // filter 字节 + 全零像素
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 最小但结构合法的 JPEG：SOI + SOF0 + SOS + EOI。 */
function jpeg(width, height) {
  const sof = Buffer.alloc(8);
  sof.writeUInt16BE(8, 0); // 段长
  sof[2] = 8; // 精度
  sof.writeUInt16BE(height, 3);
  sof.writeUInt16BE(width, 5);
  sof[7] = 1; // 分量数
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xc0]),
    sof,
    Buffer.from([0xff, 0xda, 0x00, 0x02]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

test("inspectImage 严格校验 PNG/JPEG 并返回尺寸", () => {
  assert.deepEqual(inspectImage(png(640, 480)), { format: "png", width: 640, height: 480 });
  assert.deepEqual(inspectImage(jpeg(1280, 720)), { format: "jpeg", width: 1280, height: 720 });
});

test("伪造的 24 字节 PNG 头不再通过（复审要求）", () => {
  const fake = Buffer.alloc(24);
  PNG_SIGNATURE.copy(fake, 0);
  fake.write("IHDR", 12, "ascii");
  fake.writeUInt32BE(640, 16);
  fake.writeUInt32BE(480, 20);
  assert.equal(inspectImage(fake), null);
  assert.throws(() => assertFaceImage(fake), /完整性校验失败/);
});

test("PNG CRC 被篡改时拒绝", () => {
  const valid = png(128, 128);
  const corrupted = Buffer.from(valid);
  corrupted[40] ^= 0xff;
  assert.equal(inspectImage(corrupted), null);
});

test("JPEG 缺少 EOI 时拒绝", () => {
  const truncated = jpeg(200, 200).subarray(0, -2);
  assert.equal(inspectImage(truncated), null);
});

test("assertFaceImage：区间内通过，过小/过大拒绝", () => {
  assert.deepEqual(assertFaceImage(png(640, 480)), { width: 640, height: 480, format: "png" });
  assert.throws(() => assertFaceImage(png(FACE_MIN_DIMENSION - 1, 480)), /尺寸需在/);
  assert.throws(() => assertFaceImage(jpeg(640, FACE_MAX_DIMENSION + 1)), /尺寸需在/);
});

test("尺寸策略常量：64–4096", () => {
  assert.equal(FACE_MIN_DIMENSION, 64);
  assert.equal(FACE_MAX_DIMENSION, 4096);
});

test("publicAsset 不返回任何摘要（连前缀也不返回）", () => {
  const masked = publicAsset({
    _id: "file-1",
    checksum: "a".repeat(64),
    purpose: "face-biometric",
  });
  assert.equal("checksum" in masked, false);
  assert.equal("checksumPrefix" in masked, false);
  assert.equal(masked._id, "file-1");
  assert.equal(publicAsset(null), null);
});
