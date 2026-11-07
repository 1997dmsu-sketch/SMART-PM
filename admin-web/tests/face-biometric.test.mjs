import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { decodeFaceImage, FACE_MAX_INPUT_BYTES } from "../lib/face-image.mjs";
import { FACE_MIN_DIMENSION, assertFaceImage, publicAsset } from "../lib/files.mjs";

const jpegOf = (width, height) =>
  sharp({ create: { width, height, channels: 3, background: { r: 12, g: 34, b: 56 } } })
    .jpeg({ quality: 80 })
    .toBuffer();

const pngOf = (width, height) =>
  sharp({ create: { width, height, channels: 3, background: { r: 12, g: 34, b: 56 } } })
    .png()
    .toBuffer();

test("真实解码：JPEG / PNG 返回像素级尺寸", async () => {
  const jpeg = await decodeFaceImage(await jpegOf(640, 480));
  assert.equal(jpeg.format, "jpeg");
  assert.equal(jpeg.width, 640);
  assert.equal(jpeg.height, 480);
  assert.equal(jpeg.decodedBytes, 640 * 480 * 3);

  const png = await decodeFaceImage(await pngOf(320, 240));
  assert.equal(png.format, "png");
  assert.equal(png.width, 320);
  assert.equal(png.height, 240);
});

test("伪造头部不再通过（必须真正解码）", async () => {
  const fake = Buffer.alloc(24);
  fake[0] = 0xff;
  fake[1] = 0xd8;
  fake[2] = 0xff;
  fake[3] = 0xc0;
  await assert.rejects(() => decodeFaceImage(fake), /结构不完整|解码失败|仅支持/);
});

test("截断的 JPEG 拒绝", async () => {
  const full = await jpegOf(200, 200);
  const truncated = full.subarray(0, Math.floor(full.length / 2));
  await assert.rejects(() => decodeFaceImage(truncated), /解码失败|不完整/);
});

test("超 200KB 输入直接拒绝（不进入解码）", async () => {
  const big = Buffer.alloc(FACE_MAX_INPUT_BYTES + 1, 1);
  await assert.rejects(() => decodeFaceImage(big), /超过 200KB/);
});

test("assertFaceImage：区间内通过，过小/过大拒绝", async () => {
  assert.deepEqual(await assertFaceImage(await jpegOf(640, 480)), {
    width: 640,
    height: 480,
    format: "jpeg",
  });
  await assert.rejects(async () => assertFaceImage(await jpegOf(FACE_MIN_DIMENSION - 1, 480)), /尺寸需在/);
  await assert.rejects(async () => assertFaceImage(await jpegOf(5000, 100)), /尺寸需在/);
});

test("解码超时后槽位可恢复（不会永久占用）", async () => {
  const jpeg = await jpegOf(640, 480);
  await assert.rejects(() => decodeFaceImage(jpeg, { timeoutMs: 0 }), /超时/);
  // 并发测试环境下 libvips 结束时间不确定：轮询直到槽位释放（上限 3s），
  // 避免固定 sleep 造成的偶发失败。
  const deadline = Date.now() + 3000;
  let ok = null;
  while (!ok && Date.now() < deadline) {
    try {
      ok = await decodeFaceImage(jpeg, { timeoutMs: 3000 });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.equal(ok?.width, 640);
});

test("publicAsset 不返回任何摘要", () => {
  const masked = publicAsset({ _id: "file-1", checksum: "a".repeat(64), purpose: "face-biometric" });
  assert.equal("checksum" in masked, false);
  assert.equal("checksumPrefix" in masked, false);
  assert.equal(publicAsset(null), null);
});
