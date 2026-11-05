/**
 * 人脸图片安全解码（sharp / libvips）。
 *
 * 复审要求：不能只检查文件头，必须真正解码像素，并限制字节、像素、内存与时间。
 * - 输入字节上限：200KB（与 face-biometric 用途一致）
 * - 像素上限：4096 × 4096（同时交给 libvips 的 limitInputPixels 兜底）
 * - 解码后内存上限：64MB
 * - 单次解码超时：3s（超时即拒绝，不进入设备建模流程）
 *
 * 只接受 JPEG/PNG，不透明格式；失败一律抛出模型层错误（fail closed）。
 */
import sharp from "sharp";
import { failCode } from "./model.mjs";

export const FACE_MIN_DIMENSION = 64;
export const FACE_MAX_DIMENSION = 4096;
export const FACE_MAX_PIXELS = FACE_MAX_DIMENSION * FACE_MAX_DIMENSION;
export const FACE_MAX_INPUT_BYTES = 200 * 1024;
export const FACE_MAX_DECODED_BYTES = 64 * 1024 * 1024;
export const FACE_DECODE_TIMEOUT_MS = 3000;

class DecodeTimeout extends Error {}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new DecodeTimeout("decode timeout")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {Buffer} bytes
 * @param {{timeoutMs?:number, maxPixels?:number, maxDecodedBytes?:number}} [options]
 * @returns {Promise<{width:number,height:number,format:string,decodedBytes:number,elapsedMs:number}>}
 */
export async function decodeFaceImage(bytes, options = {}) {
  const limits = {
    timeoutMs: options.timeoutMs ?? FACE_DECODE_TIMEOUT_MS,
    maxPixels: options.maxPixels ?? FACE_MAX_PIXELS,
    maxDecodedBytes: options.maxDecodedBytes ?? FACE_MAX_DECODED_BYTES,
  };

  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    failCode("PARAM_ERROR", "人脸图片为空");
  }
  if (bytes.length > FACE_MAX_INPUT_BYTES) {
    failCode("PARAM_ERROR", "人脸图片超过 200KB");
  }

  const started = Date.now();
  let metadata;
  try {
    const image = sharp(bytes, {
      limitInputPixels: limits.maxPixels,
      failOn: "error",
      sequentialRead: true,
      animated: false,
    });
    metadata = await withTimeout(image.metadata(), limits.timeoutMs);
    if (!["jpeg", "png"].includes(metadata.format)) {
      failCode("PARAM_ERROR", "人脸图片仅支持 JPEG 或 PNG");
    }
    if (!metadata.width || !metadata.height) {
      failCode("PARAM_ERROR", "无法读取人脸图片尺寸");
    }
    const pixels = metadata.width * metadata.height;
    if (pixels > limits.maxPixels) {
      failCode("PARAM_ERROR", "人脸图片像素数超过上限");
    }
    const channels = metadata.channels || 4;
    if (pixels * channels > limits.maxDecodedBytes) {
      failCode("PARAM_ERROR", "人脸图片解码后内存超过上限");
    }
    // 强制完整解码：只有 toBuffer 成功才证明像素数据可用（而非仅头部）。
    const raw = await withTimeout(image.raw().toBuffer(), limits.timeoutMs);
    if (!raw || raw.length !== pixels * channels) {
      failCode("PARAM_ERROR", "人脸图片解码结果不完整");
    }
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      decodedBytes: raw.length,
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    if (error?.code && typeof error.code === "string" && error.code === "PARAM_ERROR") throw error;
    if (error instanceof DecodeTimeout || /timeout/i.test(String(error?.message))) {
      failCode("PARAM_ERROR", "人脸图片解码超时");
    }
    failCode("PARAM_ERROR", "人脸图片解码失败（文件损坏或格式不受支持）");
  }
}
