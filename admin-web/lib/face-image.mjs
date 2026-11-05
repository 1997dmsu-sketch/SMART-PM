/**
 * 人脸图片安全解码（sharp / libvips）。
 *
 * 复审要求：必须真正解码像素，并限制字节、像素、内存、时间与并发。
 *
 * 限制说明：
 * - 输入字节：200KB（face-biometric 用途上限）。
 * - 像素：4096 × 4096，同时交给 libvips 的 limitInputPixels 兜底。
 * - 64MB 是**单次 raw 解码输出**上限（width × height × channels），
 *   不是 libvips 进程总内存的硬限制；进程级内存需由部署层限制。
 * - metadata 与像素解码**共用**一个 3s 总期限，不会各自获得 3s。
 * - 解码并发有界（默认 2）且队列有限（默认 8）；超时后槽位只在底层
 *   libvips 任务真正结束后释放，避免后台任务持续堆积。
 */
import sharp from "sharp";
import { failCode } from "./model.mjs";

export const FACE_MIN_DIMENSION = 64;
export const FACE_MAX_DIMENSION = 4096;
export const FACE_MAX_PIXELS = FACE_MAX_DIMENSION * FACE_MAX_DIMENSION;
export const FACE_MAX_INPUT_BYTES = 200 * 1024;
export const FACE_MAX_DECODED_BYTES = 64 * 1024 * 1024;
export const FACE_DECODE_TIMEOUT_MS = 3000;

export const FACE_MAX_CONCURRENCY = Math.max(
  1,
  Number(process.env.FACE_DECODE_CONCURRENCY) || 2,
);
export const FACE_MAX_QUEUE = Math.max(
  0,
  Number(process.env.FACE_DECODE_QUEUE) || 8,
);

class DecodeTimeout extends Error {}

// ── 有界并发：活跃数 ≤ MAX_CONCURRENCY，等待队列 ≤ MAX_QUEUE ──
let active = 0;
const waiters = [];

function acquire() {
  if (active < FACE_MAX_CONCURRENCY) {
    active += 1;
    return Promise.resolve();
  }
  if (waiters.length >= FACE_MAX_QUEUE) {
    return Promise.reject(
      Object.assign(new Error("人脸解码并发已满"), { code: "DECODE_BUSY" }),
    );
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function release() {
  const next = waiters.shift();
  if (next) next(); // 槽位转移，active 不变
  else active -= 1;
}

function deadlineRace(promise, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new DecodeTimeout("decode timeout"));
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new DecodeTimeout("decode timeout")), remaining);
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

  try {
    await acquire();
  } catch {
    failCode("RATE_LIMITED", "人脸解码繁忙，请稍后重试", 503);
  }

  const started = Date.now();
  // 整个解码（metadata + raw）共享同一个截止时间。
  const deadline = started + limits.timeoutMs;

  const job = (async () => {
    const image = sharp(bytes, {
      limitInputPixels: limits.maxPixels,
      failOn: "error",
      sequentialRead: true,
      animated: false,
    });
    const metadata = await image.metadata();
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
      failCode("PARAM_ERROR", "人脸图片解码内存超过上限");
    }
    const raw = await image.raw().toBuffer();
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
  })();

  // 槽位只在底层任务真正 settle 后释放；超时不会提前放行排队请求。
  job.then(release, release);

  try {
    return await deadlineRace(job, deadline);
  } catch (error) {
    if (error?.code === "PARAM_ERROR" || error?.code === "RATE_LIMITED") throw error;
    if (error instanceof DecodeTimeout || /timeout/i.test(String(error?.message))) {
      failCode("PARAM_ERROR", "人脸图片解码超时");
    }
    failCode("PARAM_ERROR", "人脸图片解码失败（文件损坏或格式不受支持）");
  }
}
