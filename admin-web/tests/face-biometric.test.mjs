import { test } from "node:test";
import assert from "node:assert/strict";

import { imageSize } from "../lib/image-size.mjs";
import {
  FACE_MAX_DIMENSION,
  FACE_MIN_DIMENSION,
  assertFaceImage,
  publicAsset,
} from "../lib/files.mjs";

function png(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function jpeg(width, height) {
  const buffer = Buffer.alloc(20);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xc0; // SOF0
  buffer.writeUInt16BE(17, 4); // 段长
  buffer[6] = 8; // 精度
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  return buffer;
}

test("imageSize 解析 PNG/JPEG 尺寸", () => {
  assert.deepEqual(imageSize(png(640, 480)), { format: "png", width: 640, height: 480 });
  assert.deepEqual(imageSize(jpeg(1280, 720)), { format: "jpeg", width: 1280, height: 720 });
});

test("imageSize 对截断/非图片数据返回 null", () => {
  assert.equal(imageSize(Buffer.from([0x89, 0x50, 0x4e])), null);
  assert.equal(imageSize(Buffer.from("not-an-image")), null);
  assert.equal(imageSize(null), null);
});

test("assertFaceImage：区间内通过，过小/过大拒绝", () => {
  assert.deepEqual(assertFaceImage(png(640, 480)), { width: 640, height: 480, format: "png" });
  assert.throws(() => assertFaceImage(png(FACE_MIN_DIMENSION - 1, 480)), /尺寸需在/);
  assert.throws(() => assertFaceImage(jpeg(640, FACE_MAX_DIMENSION + 1)), /尺寸需在/);
  assert.throws(() => assertFaceImage(Buffer.from("not-an-image")), /无法解析/);
});

test("尺寸策略常量：64–4096", () => {
  assert.equal(FACE_MIN_DIMENSION, 64);
  assert.equal(FACE_MAX_DIMENSION, 4096);
});

test("publicAsset 不返回完整 SHA-256，只保留前缀", () => {
  const checksum = "a".repeat(64);
  const masked = publicAsset({ _id: "file-1", checksum, purpose: "face-biometric" });
  assert.equal(masked.checksum, undefined);
  assert.equal(masked.checksumPrefix, "a".repeat(16));
  assert.equal(masked.purpose, "face-biometric");
  assert.equal(publicAsset(null), null);
});
