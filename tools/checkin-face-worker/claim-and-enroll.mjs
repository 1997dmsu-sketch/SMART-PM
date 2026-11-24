/**
 * 本地受控 worker 主流程（B04，R05–R09 退修版）。
 *
 *   claimTask（出站 HTTPS）
 *   → R05 deviceKey 强绑定校验（任务与本地均非空且精确一致，缺任一/不同零执行）
 *   → R06 领取字段与 claim 时效预检（早于任何下载）
 *   → 受控下载照片（进程内存 Buffer，不落盘）
 *   → R06 下载/准备后时效再检（覆盖“下载中到期”）
 *   → beginTaskExecution 权威复核（严格绑定 task/claim/revision/worker 与返回快照）
 *   → 执行前最后一次时效检查
 *   → 内存照片直接驱动登记适配层（显式 device + fixed；R08）
 *   → R09 清理结果纳入真实终态（失败不误报成功、不重发设备）
 *   → reportTask（出站 HTTPS，使用推进后 revision）。
 *
 * 硬边界：
 *   - 不监听任何端口、不反代 admin loopback、不在小程序跑 Node HTTPS adapter；
 *   - 不自动重试失败任务、不换 employeeNo、不删除设备残留；
 *   - 复核失败/过期/撤权/不一致/云不可用/回执未知均零设备执行，不自动重领/续期/重试开始；
 *   - 照片全程内存传递，不在本机落盘；全程脱敏日志；设备秘密只在 *.local.json / 环境变量与进程内存中。
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  WorkerConfigError,
  WorkerInputError,
  applyCleanupResult,
  assertDeviceKeyMatch,
  buildInMemoryDeviceRequest,
  buildReportPayload,
  createCloudClient,
  loadWorkerConfig,
  runEnrollment,
  safeConfigView,
  safeLog,
  sanitizeEnrollmentOutput,
  validateClaimedTask,
} from "./worker-runtime.mjs";
import { AuthorizationError, authorizeTaskExecution, checkClaimTime } from "./execution-authorization.mjs";
import { runInMemoryEnrollment } from "./enrollment-adapter.mjs";

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
  cloudActions: [
    "claimTask              领取排队任务（云端事务核验名单/开关/房间/租期）",
    "beginTaskExecution     执行前权威复核（仅当 CLAIMED 且匹配当前 claim/revision 才推进 DEVICE_PROCESSING，revision+1）",
    "reportTask             上报登记结果（使用推进后 revision；失败不重发）",
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
    5: "复核未通过/过期/撤权/云不可用/连接/未知状态/清理错误（stopped），已上报，需人工核查",
  },
});

function parseArgs(argv) {
  const options = {
    once: true,
    loop: false,
    intervalMs: DEFAULT_INTERVAL_MS,
    configPath: undefined,
    help: false,
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
      options.configPath = resolve(value);
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

/** R06：执行前复核失败 → stopped（exit 5），零设备执行，不自动重领/续期/重试开始。 */
function authorizationFailure(error, config) {
  const code = typeof error?.code === "string" ? error.code : "BEGIN_AUTH_FAILED";
  const message = typeof error?.message === "string" ? error.message : "执行前授权复核未通过，未执行设备登记。";
  return stoppedFailure(code, message, config);
}

/** 领取/预检错误映射：exit 5 类（时钟/时效字段异常）走 stopped，其余走 invalid-input（exit 2）。 */
function failureFromWorkerError(error, config) {
  if (error?.exitCode === 5) return stoppedFailure(error.code, error.message, config);
  return inputFailure(error, config);
}

/** R09：释放下载照片的进程内副本（内存路径没有落盘文件可删；不承诺字符串副本擦除）。 */
async function releasePhotoBuffer(buffer) {
  if (buffer === null || buffer === undefined) return true;
  if (!Buffer.isBuffer(buffer)) return false;
  try {
    buffer.fill(0);
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
async function processOnce({ config, cloud, options, logger, runEnrollmentImpl, nowMs = () => Date.now(), releasePhoto = releasePhotoBuffer }) {
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
  if (typeof task !== "object" || Array.isArray(task)) {
    throw new WorkerConfigError("TASK_INVALID", "claimTask 返回的任务格式无效");
  }
  logger("info", "task claimed", logFields(task));

  let photoBuffer = null;
  let reportTaskRef = task;
  let result = null;
  let report = null;
  let cleanupOk = false;
  try {
    // —— 领取后立即失败关闭（早于任何下载）：身份字段 / R05 设备绑定 / R06 领取时效 ——
    try {
      validateClaimedTask(task);
      assertDeviceKeyMatch(task, config);
      checkClaimTime(task, nowMs());
    } catch (error) {
      result = error instanceof AuthorizationError
        ? authorizationFailure(error, config)
        : failureFromWorkerError(error, config);
      report = buildReportPayload(reportTaskRef, result, config);
      return { status: "processed", exitCode: result.exitCode, reportOk: false, pendingReport: report };
    }

    // —— 受控下载照片（内存）——
    try {
      photoBuffer = await cloud.downloadFile(task.fileId);
    } catch (error) {
      result = error instanceof WorkerInputError
        ? inputFailure(error, config)
        : stoppedFailure("PHOTO_PREPARE_FAILED", "照片下载或本地准备失败，未执行设备登记。", config);
      report = buildReportPayload(reportTaskRef, result, config);
      return { status: "processed", exitCode: result.exitCode, reportOk: false, pendingReport: report };
    }

    // —— R06：下载/准备完成后、进入设备执行前：时效再检 → 权威复核 → 执行前最后检查 ——
    try {
      checkClaimTime(task, nowMs());
      const authorized = await authorizeTaskExecution({ cloud, config, task, workerId });
      logger("info", "execution authorized", logFields(authorized.snapshot));
      // The accepted begin receipt is already an authoritative revision advance.
      // Preserve it even when the final local deadline check stops device execution.
      reportTaskRef = authorized.snapshot; // 后续 report 使用推进后 revision；不把新租期/新目标覆盖进旧任务
      checkClaimTime(authorized.snapshot, nowMs());
      const request = buildInMemoryDeviceRequest(authorized.snapshot, config);
      result = await runEnrollmentImpl(request, {
        config,
        photoPath: "",
        photoBuffer,
        commandDeps: { platform: options.platform },
      });
    } catch (error) {
      result = error instanceof AuthorizationError
        ? authorizationFailure(error, config)
        : error instanceof WorkerInputError
          ? inputFailure(error, config)
          : stoppedFailure("WORKER_RUNNER_FAILED", "本地执行失败，请人工检查设备现状。", config);
    }

    // —— R09：清理结果纳入真实终态；失败不重发设备、不误报成功 ——
    try {
      cleanupOk = await releasePhoto(photoBuffer);
    } catch {
      cleanupOk = false;
    }
    photoBuffer = null;
    result = applyCleanupResult(result, cleanupOk);
    report = buildReportPayload(reportTaskRef, result, config);
    return { status: "processed", exitCode: result.exitCode, reportOk: false, pendingReport: report };
  } finally {
    if (Buffer.isBuffer(photoBuffer)) photoBuffer.fill(0);
  }
}

async function wait(ms, shouldStop) {
  if (shouldStop()) return;
  await new Promise((done) => setTimeout(done, ms));
}

/** 默认执行入口：内存照片适配层（R08），保留 runEnrollment 的输出白名单与未知结果收敛。 */
function defaultRunEnrollmentImpl(request, deps = {}) {
  return runEnrollment(request, {
    run: runInMemoryEnrollment,
    config: deps.config,
    photoPath: typeof deps.photoPath === "string" ? deps.photoPath : "",
    photoBuffer: deps.photoBuffer || null,
    commandDeps: deps.commandDeps,
  });
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  loadConfig = loadWorkerConfig,
  createClient = createCloudClient,
  platform = process.platform,
  stdout = process.stdout,
  runEnrollmentImpl = defaultRunEnrollmentImpl,
  nowMs = () => Date.now(),
  releasePhoto = releasePhotoBuffer,
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
        outcome = await processOnce({ config, cloud, options, logger, runEnrollmentImpl, nowMs, releasePhoto });
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
