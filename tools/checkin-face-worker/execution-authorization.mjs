/**
 * 执行前复核（R06，Codex 技术裁定 v1 的 worker 侧；与 A 路 INTERFACES.md §2 对齐）。
 *
 * 一次性开始执行语义：claim 后、下载/准备完成、进入设备执行前，调用云端 beginTaskExecution
 * 权威复核。请求字段仅为 action/workerToken/workerId/taskId/claimId/revision（清单 §2.1）；
 * 任何白名单外字段由云端以 CLIENT_FIELD_FORBIDDEN/UNKNOWN_FIELD 拒绝，C 侧绝不携带“已批准”
 * 或任何新目标（新 employeeNo/新租期/新房间不在白名单，无法传入）。
 *
 * 成功条件（清单 §2.3/§2.5，全部满足才返回可执行快照）：
 *   - code===0 且 data 含 task/authorizedAt；authorizedAt 为服务端正整数毫秒且 ≤ claimExpiresAt；
 *   - 快照 status==='DEVICE_PROCESSING'、revision===请求值+1、claimExpiresAt 与领取时一致（不延长）；
 *   - 快照与已领取/实际下载对象的全部业务字段一致：taskId/claimId/applicationId/fileId/cloudPath/
 *     employeeNo/deviceKey/doorNo/validFrom/validTo/timezone/dailyHours/accessPlanFingerprint/name；
 *   - 快照 workerId===本次请求 workerId（严格绑定 worker）；
 *   - 快照携带 configRevision/roomRevision/leaseRevision（非负安全整数）与
 *     roomBindingId/leaseSnapshotId（非空字符串）关联版本；
 *   - task.authorizedAt===data.authorizedAt（同一服务端时间事实，防仅回显被误当授权）。
 *   不把新租期/新目标覆盖进旧任务继续执行。
 *
 * 错误映射（C 本地码 → 清单 §2.4 服务端码；服务端码一律原样透传，绝不编造）：
 *   BEGIN_AUTH_REJECTED:<服务端码>
 *       云端非零码。§2.4 全部条目按原码透传：WORKER_UNAUTHORIZED / INVALID_WORKER_TOKEN /
 *       INVALID_WORKER_ID / INVALID_TASK_ID / INVALID_CLAIM_ID / INVALID_REVISION /
 *       CLIENT_FIELD_FORBIDDEN / UNKNOWN_FIELD / TASK_NOT_FOUND / CLAIM_MISMATCH /
 *       REVISION_CONFLICT / WORKER_MISMATCH / TASK_NOT_CLAIMED / EXECUTION_ALREADY_STARTED /
 *       CLAIM_EXPIRED / EXECUTION_INVALIDATED / TRANSACTION_UNAVAILABLE / TX_UNSUPPORTED_QUERY /
 *       INTERNAL_ERROR。非 §5 闭式形态的异常码以本地兜底标签 CLOUD_REJECTED 表示（不冒充服务端码）。
 *   BEGIN_AUTH_UNAVAILABLE
 *       网络失败/无有效答复/回执未知/缺 task 或 authorizedAt 字段/非对象回显。
 *       服务端已回码时走上一行；INTERNAL_ERROR 若被云端作为响应码返回，同样走上一行。
 *   BEGIN_SNAPSHOT_MISMATCH
 *       code===0 但快照不满足上述成功条件（本地完整性校验，无服务端码）。
 *   BEGIN_AUTH_EXPIRED
 *       仅 C 本地预检（下载前后/执行前最后检查）发现本地 now ≥ claimExpiresAt，尚未发起云端调用；
 *       若由服务端先行判定过期，表现为 BEGIN_AUTH_REJECTED:CLAIM_EXPIRED。
 *
 * 以上任何失败均零设备执行、不自动重领/续期/重试开始；重复开始、旧 revision、已过期、失效、
 * 回执未知不得再次获得可执行授权。后续 report 使用推进后 revision。云端事务与硬件请求之间
 * 仍有窗口：已发生或未知的设备事实保留（report exit 5 / UNKNOWN_RESULT 语义不变），
 * 本契约不承诺跨系统原子撤销。
 */

import { WorkerInputError } from "./worker-runtime.mjs";

export class AuthorizationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
    this.exitCode = 5;
  }
}

/** 与云端 CLAIM_TTL_MS（10 分钟）对齐的本地容差上限；超过视为字段/时钟异常，失败关闭。 */
const MAX_CLAIM_TTL_SKEW_MS = 30 * 60 * 1000;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 校验 claim 时间字段与本地新鲜度（R06 本地预检；权威判断在云端事务，清单 §2.2.6）。
 * 返回 claimExpiresAt（正整数毫秒）。
 * 本地已过期抛 AuthorizationError BEGIN_AUTH_EXPIRED（exit 5）；字段缺失/无效、本地时钟不可用
 * 或偏差过大抛 WorkerInputError 并失败关闭（与清单“本地时间/字段无效同样失败关闭”一致）。
 */
export function checkClaimTime(task, nowMs) {
  if (!isObject(task)) throw new WorkerInputError("TASK_INVALID", "云任务格式无效");
  if (!Object.hasOwn(task, "claimExpiresAt")) {
    throw new WorkerInputError("TASK_FIELD_MISSING", "任务字段 claimExpiresAt 缺失，拒绝执行");
  }
  const value = task.claimExpiresAt;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new WorkerInputError("TASK_FIELD_INVALID", "任务字段 claimExpiresAt 必须是正整数毫秒");
  }
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
    throw new WorkerInputError("CLOCK_INVALID", "本地时间不可用，无法校验领取时效，拒绝执行", 5);
  }
  if (value - nowMs > MAX_CLAIM_TTL_SKEW_MS) {
    throw new WorkerInputError("CLAIM_TIME_INVALID", "领取到期时间与本地时间偏差过大，拒绝执行", 5);
  }
  if (nowMs >= value) {
    throw new AuthorizationError("BEGIN_AUTH_EXPIRED", "领取已过期，未执行设备登记。");
  }
  return value;
}

/**
 * 快照一致性校验（清单 §2.5）：只接受预期状态推进、revision+1 与明确时间事实；
 * 任何字段与已领取/实际下载对象不一致（撤权/改租期/改绑定/新目标覆盖旧任务）均拒绝执行。
 */
export function verifyAuthorizedSnapshot({ claimed, snapshot, authorizedAt, workerId }) {
  const mismatch = (detail) => {
    throw new AuthorizationError("BEGIN_SNAPSHOT_MISMATCH", `执行前复核快照不一致（${detail}），未执行设备登记。`);
  };
  if (!isObject(claimed) || !isObject(snapshot)) mismatch("快照或领取任务无效");
  if (typeof workerId !== "string" || !workerId) mismatch("缺少本次请求 workerId");
  if (!Number.isSafeInteger(authorizedAt) || authorizedAt <= 0) mismatch("authorizedAt 不是正整数毫秒");
  if (snapshot.status !== "DEVICE_PROCESSING") {
    mismatch(`状态为 ${String(snapshot.status).slice(0, 32)}，未按预期推进`);
  }
  if (snapshot.revision !== claimed.revision + 1) {
    mismatch(`revision ${String(snapshot.revision)} 不是预期推进值 ${claimed.revision + 1}`);
  }
  if (!Number.isSafeInteger(snapshot.claimExpiresAt) || snapshot.claimExpiresAt !== claimed.claimExpiresAt) {
    mismatch("claimExpiresAt 与领取时不一致（不允许延长原 claim）");
  }
  for (const key of [
    "taskId", "claimId", "applicationId", "fileId", "cloudPath", "employeeNo", "deviceKey",
    "doorNo", "validFrom", "validTo", "timezone", "dailyHours", "accessPlanFingerprint", "name",
  ]) {
    if (snapshot[key] !== claimed[key]) mismatch(`字段 ${key} 与已领取/实际下载对象不一致`);
  }
  if (snapshot.workerId !== workerId) mismatch("快照 workerId 与本次请求 workerId 不一致");
  if (!Number.isSafeInteger(snapshot.authorizedAt) || snapshot.authorizedAt !== authorizedAt) {
    mismatch("task.authorizedAt 与 data.authorizedAt 不一致（同一服务端时间事实）");
  }
  for (const key of ["configRevision", "roomRevision", "leaseRevision"]) {
    if (!Number.isSafeInteger(snapshot[key]) || snapshot[key] < 0) mismatch(`缺少配置/房间/租约关联版本 ${key}`);
  }
  for (const key of ["roomBindingId", "leaseSnapshotId"]) {
    if (typeof snapshot[key] !== "string" || !snapshot[key]) mismatch(`缺少关联标识 ${key}`);
  }
  if (authorizedAt > claimed.claimExpiresAt) mismatch("authorizedAt 晚于 claim 到期时间");
  return snapshot;
}

/**
 * 调用云端 beginTaskExecution 并核验返回（R06 权威复核，清单 §2）。
 * 云端拒绝（非零码）→ BEGIN_AUTH_REJECTED:<服务端码原样>；网络失败/无有效答复（回执未知）→
 * BEGIN_AUTH_UNAVAILABLE；缺字段/仅回显 → BEGIN_AUTH_UNAVAILABLE（不视为授权）。
 */
export async function authorizeTaskExecution({ cloud, config, task, workerId }) {
  if (!cloud || typeof cloud.callFunction !== "function") {
    throw new AuthorizationError("BEGIN_AUTH_UNAVAILABLE", "云客户端不可用，未执行设备登记。");
  }
  let data;
  try {
    data = await cloud.callFunction("beginTaskExecution", {
      workerToken: config?.workerToken || "",
      workerId,
      taskId: task.taskId,
      claimId: task.claimId,
      revision: task.revision,
    });
  } catch (error) {
    if (error?.cloudCode !== undefined) {
      const code = /^[A-Z_][A-Z_0-9]{2,63}$/.test(String(error.cloudCode)) ? String(error.cloudCode) : "CLOUD_REJECTED";
      throw new AuthorizationError(`BEGIN_AUTH_REJECTED:${code}`, `执行前复核被云端拒绝（${code}），未执行设备登记。`);
    }
    throw new AuthorizationError("BEGIN_AUTH_UNAVAILABLE", "执行前复核未获得有效答复（云不可用或回执未知），未执行设备登记。");
  }
  if (!isObject(data) || data.task === undefined || data.authorizedAt === undefined) {
    throw new AuthorizationError("BEGIN_AUTH_UNAVAILABLE", "执行前复核缺少任务快照或 authorizedAt，未执行设备登记。");
  }
  const snapshot = verifyAuthorizedSnapshot({
    claimed: task,
    snapshot: data.task,
    authorizedAt: data.authorizedAt,
    workerId,
  });
  return { snapshot, authorizedAt: data.authorizedAt };
}
