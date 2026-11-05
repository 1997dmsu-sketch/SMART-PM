import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import {
  assertNoTrailingPayload,
  jpegEndOffset,
  pngEndOffset,
} from "../lib/image-container.mjs";
import { decodeFaceImage } from "../lib/face-image.mjs";

const jpegOf = (width, height, options = {}) =>
  sharp({ create: { width, height, channels: 3, background: { r: 9, g: 8, b: 7 } } })
    .jpeg({ quality: 80, ...options })
    .toBuffer();

const pngOf = (width, height) =>
  sharp({ create: { width, height, channels: 3, background: { r: 9, g: 8, b: 7 } } })
    .png()
    .toBuffer();

test("合法 JPEG/PNG 通过尾随检查并解码", async () => {
  const jpeg = await jpegOf(640, 480);
  assert.equal(assertNoTrailingPayload(jpeg), jpeg.length);
  assert.equal((await decodeFaceImage(jpeg)).width, 640);

  const png = await pngOf(320, 240);
  assert.equal(assertNoTrailingPayload(png), png.length);
  assert.equal((await decodeFaceImage(png)).width, 320);
});

test("JPEG 尾部附加任意字节均拒绝（0x00 / 重复 EOI / 伪装载荷）", async () => {
  const jpeg = await jpegOf(200, 200);
  for (const tail of [Buffer.from([0x00]), Buffer.from([0xff, 0xd9]), Buffer.from("EVIL")]) {
    const tampered = Buffer.concat([jpeg, tail]);
    assert.throws(() => assertNoTrailingPayload(tampered), /尾随载荷/);
    await assert.rejects(() => decodeFaceImage(tampered), /尾随载荷/);
  }
});

test("PNG 尾部附加字节或重复 IEND 均拒绝", async () => {
  const png = await pngOf(128, 128);
  const appended = Buffer.concat([png, Buffer.from([0x00])]);
  assert.throws(() => assertNoTrailingPayload(appended), /尾随载荷/);

  // 末尾 12 字节即完整 IEND（含 CRC），复制一份形成重复结束标记。
  const duplicateIend = Buffer.concat([png, png.subarray(png.length - 12)]);
  assert.throws(() => assertNoTrailingPayload(duplicateIend), /尾随载荷/);
});

test("截断的 JPEG/PNG 报结构不完整", async () => {
  const jpeg = await jpegOf(200, 200);
  assert.throws(() => assertNoTrailingPayload(jpeg.subarray(0, jpeg.length - 2)), /结构不完整/);

  const png = await pngOf(128, 128);
  assert.throws(() => assertNoTrailingPayload(png.subarray(0, png.length - 4)), /结构不完整/);
});

test("progressive JPEG（多扫描）能定位真实 EOI", async () => {
  const progressive = await jpegOf(320, 240, { progressive: true });
  assert.equal(jpegEndOffset(progressive), progressive.length);
  assert.equal((await decodeFaceImage(progressive)).height, 240);
});

test("扫描内字节填充与 restart marker 不误判为 EOI", () => {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  const entropy = Buffer.from([0xff, 0x00, 0x12, 0x34, 0xff, 0xd0, 0x56, 0xff, 0x00]);
  const eoi = Buffer.from([0xff, 0xd9]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), sof, sos, entropy, eoi]);
  assert.equal(jpegEndOffset(jpeg), jpeg.length);
  assert.equal(assertNoTrailingPayload(jpeg), jpeg.length);
});

test("PNG 结束位置必须等于文件长度（唯一 IEND）", async () => {
  const png = await pngOf(96, 96);
  assert.equal(pngEndOffset(png), png.length);
  assert.equal(pngEndOffset(Buffer.concat([png, Buffer.from([0x00])])), png.length);
});
