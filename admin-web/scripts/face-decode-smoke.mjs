#!/usr/bin/env node
/**
 * 生产部署前的 Sharp 安装与解码 smoke test（不接触真实人脸）。
 * 用 sharp 现场生成一张 640×480 JPEG，走与线上相同的 decodeFaceImage 路径。
 */
import sharp from "sharp";
import {
  decodeFaceImage,
  FACE_MAX_CONCURRENCY,
  FACE_MAX_INPUT_BYTES,
  FACE_MAX_QUEUE,
} from "../lib/face-image.mjs";

const jpeg = await sharp({
  create: { width: 640, height: 480, channels: 3, background: { r: 10, g: 20, b: 30 } },
})
  .jpeg({ quality: 80 })
  .toBuffer();

if (jpeg.length > FACE_MAX_INPUT_BYTES) {
  throw new Error(`smoke fixture 超出 200KB：${jpeg.length}`);
}

const result = await decodeFaceImage(jpeg);
if (result.width !== 640 || result.height !== 480 || result.format !== "jpeg") {
  throw new Error(`解码结果异常：${JSON.stringify(result)}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      sharp: sharp.versions?.sharp || "unknown",
      vips: sharp.versions?.vips || "unknown",
      decoded: result,
      limits: { maxInputBytes: FACE_MAX_INPUT_BYTES, concurrency: FACE_MAX_CONCURRENCY, queue: FACE_MAX_QUEUE },
    },
    null,
    2,
  ),
);
