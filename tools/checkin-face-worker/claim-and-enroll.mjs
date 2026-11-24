/**
 * 本地受控 worker 主流程（B04）。
 *
 *   claimTask（出站 HTTPS） → 受控下载照片 → 本机受限临时 JPEG（用后清零删除）
 *   → runFaceEnrollment（显式 device + fixed） → reportTask（出站 HTTPS）。
 *
 * 硬边界：
 *   - 不监听任何端口、不反代 admin loopback、不在小程序跑 Node HTTPS adapter；
 *   - 不自动重试失败任务、不换 employeeNo、不删除设备残留；
 *   - 全程脱敏日志；设备秘密只在 *.local.json / 环境变量与进程内存中。
 */

import { mkdir, open as openFile, readFile, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  WorkerConfigError,
  WorkerInputError,
  buildDeviceRequest,
  buildReportPayload,
  createCloudClient,
  loadWorkerConfig,
  runEnrollment,
  safeConfigView,
  safeLog,
  sanitizeEnrollmentOutput,
} from "./worker-runtime.mjs";

const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_DATA_DIR = join(MODULE_DIR, ".data");
const DEFAULT_INTERVAL_MS = 15000;
const MIN_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 600000;
const USAGE = Object.freeze({
  command: "node tools/checkin-face-worker/claim-and-enroll.mjs",
  options: [
    "--once                 只领取并处理一个任务（默认）",
    "--loop                 持续轮询云端新任务；不重试已上报任务",
    "--interval-ms <n>      轮询间隔，1000–600000，默认 15000",
    "--config <path>        本地非机密配置路径（默认同目录 worker-config.example.json 对应的 *.local.json）",
    "--help                 打印本说明",
  ],
  environment: [
    "CHECKIN_FACE_WORKER_TOKEN / 配置 workerTokenEnv：worker 凭据（非设备秘密，可轮换）",
    "TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY：出站调用云函数的云密钥",
    "CHECKIN_FACE_DEVICE_USERNAME / CHECKIN_FACE_DEVICE_PASSWORD：可选；设备账号密码优先走环境变量",
  ],
  exitCodes: {
    0: "空闲无任务，或登记结果已成功上报（exitCode 0）",
    1: "本地配置或云客户端初始化失败，未领取任务",
    2: "登记命令预检失败（invalid-input），已上报，不重试",
    3: "上报失败或任务身份字段无效；不重发、不重试",
    4: "设备业务阶段失败（failed），已上报，需人工核查设备现状",
    5: "连接/未知状态/清理错误（stopped），已上报，需人工核查",
  },
});

function parseArgs(argv) {
  const options = {
    once: true,
    loop: false,
    intervalMs: DEFAULT_INTERVAL_MS,
    configPath: undefined,
    help: false,
    dataDir: DEFAULT_DATA_DIR,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help") options.help = true;
    else if (arg === "--once") options.once = true;
    else if (arg === "--loop") {
      options.loop = true;
      options.once = false;
    } else if (arg === "--interval-ms") {
      const value = Number(argv[++index]);
      if (!Number.isSafeInteger(value) || value < MIN_INTERVAL_MS || value > MAX_INTERVAL_MS) {
        throw new WorkerConfigError("WORKER_ARG_INVALID", `--interval-ms 必须是 ${MIN_INTERVAL_MS}–${MAX_INTERVAL_MS} 的整数`);
      }
      options.intervalMs = value;
    } else if (arg === "--config") {
      const value = argv[++index];
      if (typeof value !== "string" || !value.trim()) throw new WorkerConfigError("WORKER_ARG_INVALID", "--config 缺少路径");
      options.configPath = resolve(value.trim());
    } else if (arg === "--data-dir") {
      const value = argv[++index];
      if (typeof value !== "string" || !value.trim()) throw new WorkerConfigError("WORKER_ARG_INVALID", "--data-dir 缺少路径");
      options.dataDir = resolve(value.trim());
    } else throw new WorkerConfigError("WORKER_ARG_INVALID", `未知参数：${arg.slice(0, 64)}`);
  }
  return options;
}

function inputFailure(error, config, photoPath = "") {
  return {
    exitCode: 2,
    output: sanitizeEnrollmentOutput({
      protocolVersion: 1,
      outcome: "invalid-input",
      mode: "device",
      personnelId: null,
      roomNote: null,
      validityMode: "fixed",
      dailyHours: "24x7",
      siteVerification: "PENDING",
      device: null,
      enrollment: null,
      error: {
        code: typeof error?.code === "string" ? error.code : "WORKER_INPUT_INVALID",
        message: typeof error?.message === "string" ? error.message : "输入预检失败，未执行设备登记。",
        requiresInspection: false,
      },
    }, config, photoPath),
  };
}

function stoppedFailure(code, message, config, photoPath = "") {
  return {
    exitCode: 5,
    output: sanitizeEnrollmentOutput({
      protocolVersion: 1,
      outcome: "stopped",
      mode: "device",
      personnelId: null,
      roomNote: null,
      validityMode: "fixed",
      dailyHours: "24x7",
      siteVerification: "PENDING",
      device: null,
      enrollment: null,
      error: { code, message, requiresInspection: true },
    }, config, photoPath),
  };
}

/** 创建 0o600 的本机临时 JPEG；目录为 Git 忽略的 worker 私有目录。 */
async function writeTempJpeg(bytes, dataDir) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, `face-${randomBytes(16).toString("hex")}.jpg`);
  let handle;
  let success = false;
  try {
    handle = await openFile(path, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    success = true;
    return path;
  } finally {
    await handle?.close();
    if (!success) await unlink(path).catch(() => {});
  }
}

/** 先以零覆盖本地临时照片再删除；不触碰任何设备残留对象。 */
async function destroyTempJpeg(path) {
  if (typeof path !== "string" || !path) return true;
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    await unlink(path).catch(() => {});
    return false;
  }
  try {
    bytes.fill(0);
    const handle = await openFile(path, "w", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    bytes.fill(0);
  } catch {
    // 覆盖失败仍必须尝试删除；结果只记录类别，不记录路径。
  }
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

function logFields(task) {
  return {
    taskId: task?.taskId,
    claimId: task?.claimId,
    revision: task?.revision,
    doorNo: task?.doorNo,
    employeeNo: task?.employeeNo,
    validFrom: task?.validFrom,
    validTo: task?.validTo,
  };
}

/** 处理一个任务。返回进程级退出码；登记结果通过 reportTask 上报，绝不本地重试。 */
async function processOnce({ config, cloud, options, logger, runEnrollmentImpl }) {
  const workerId = config.workerId;
  if (!workerId) throw new WorkerConfigError("WORKER_ID_MISSING", "本地配置缺少 workerId");

  const claimed = await cloud.callFunction("claimTask", {
    workerToken: config.workerToken,
    workerId,
  });
  const task = claimed?.task;
  if (!task) {
    logger("info", "no queued task");
    return { status: "idle", exitCode: 0 };
  }
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    throw new WorkerConfigError("TASK_INVALID", "claimTask 返回的任务格式无效");
  }
  logger("info", "task claimed", logFields(task));

  let photoBuffer = null;
  let photoPath = "";
  let result = null;
  let report = null;
  let cleanupOk = true;
  try {
    try {
      photoBuffer = await cloud.downloadFile(task.fileId);
      photoPath = await writeTempJpeg(photoBuffer, options.dataDir);
      photoBuffer.fill(0);
      photoBuffer = null;
    } catch (error) {
      if (error instanceof WorkerInputError) result = inputFailure(error, config);
      else result = stoppedFailure("PHOTO_PREPARE_FAILED", "照片下载或本地暂存失败，未执行设备登记。", config);
      report = buildReportPayload(task, result, config);
      return { status: "processed", exitCode: result.exitCode, reportOk: false, pendingReport: report };
    }

    try {
      const request = buildDeviceRequest(task, config, photoPath);
      result = await runEnrollmentImpl(request, {
        config,
        photoPath,
        commandDeps: { platform: options.platform },
      });
    } catch (error) {
      result = error instanceof WorkerInputError
        ? inputFailure(error, config, photoPath)
        : stoppedFailure("WORKER_RUNNER_FAILED", "本地执行失败，请人工检查设备现状。", config, photoPath);
    }
    report = buildReportPayload(task, result, config);
    return { status: "processed", exitCode: result.exitCode, reportOk: false, pendingReport: report };
  } finally {
    if (Buffer.isBuffer(photoBuffer)) photoBuffer.fill(0);
    cleanupOk = await destroyTempJpeg(photoPath);
    if (!cleanupOk) logger("warn", "temporary photo cleanup failed");
  }
}

async function wait(ms, shouldStop) {
  if (shouldStop()) return;
  await new Promise((done) => setTimeout(done, ms));
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  loadConfig = loadWorkerConfig,
  createClient = createCloudClient,
  dataDir = DEFAULT_DATA_DIR,
  platform = process.platform,
  stdout = process.stdout,
  runEnrollmentImpl = runEnrollment,
} = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
  if (options.help) {
    stdout.write(`${JSON.stringify(USAGE, null, 2)}\n`);
    return 0;
  }
  options.dataDir = dataDir;
  options.platform = platform;

  let config;
  let cloud;
  const logger = (level, message, fields = {}) => safeLog(level, message, fields, config);
  try {
    config = await loadConfig({ configPath: options.configPath, env });
    logger("info", "worker config loaded", safeConfigView(config));
    cloud = await createClient({ config, env, logger });
  } catch (error) {
    logger("error", error instanceof WorkerConfigError ? error.message : "worker initialization failed", {
      code: error?.code || "WORKER_INIT_FAILED",
    });
    return 1;
  }

  let stopRequested = false;
  const onSignal = () => {
    stopRequested = true;
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  let lastExitCode = 0;
  try {
    do {
      let outcome;
      try {
        outcome = await processOnce({ config, cloud, options, logger, runEnrollmentImpl });
      } catch (error) {
        logger("error", error instanceof WorkerConfigError ? error.message : "worker stage failed", {
          code: error?.code || "WORKER_STAGE_FAILED",
        });
        lastExitCode = 3;
        if (!options.loop) return lastExitCode;
        await wait(options.intervalMs, () => stopRequested);
        continue;
      }

      if (outcome.status === "idle") {
        lastExitCode = 0;
      } else if (outcome.pendingReport) {
        try {
          await cloud.callFunction("reportTask", outcome.pendingReport);
          logger("info", "task reported", { exitCode: outcome.exitCode });
          lastExitCode = outcome.exitCode;
        } catch (error) {
          // 上报失败只记录，不重发、不重试；保留任务与人员编号供人工核查。
          logger("error", "report delivery failed", { exitCode: outcome.exitCode, code: error?.code || "REPORT_FAILED" });
          lastExitCode = 3;
        }
      }
      if (!options.loop) return lastExitCode;
      await wait(options.intervalMs, () => stopRequested);
    } while (!stopRequested);
    return lastExitCode;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
