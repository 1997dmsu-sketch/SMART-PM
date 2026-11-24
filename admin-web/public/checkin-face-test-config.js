/**
 * 入住＋人脸登记测试配置页前端。
 *
 * 只通过同源 fetch 调用本地管理后台的 admin-only 路由；沿用 session + CSRF + origin 校验。
 * 本模块永不请求、展示或缓存设备密码、证书内容、私钥、照片内容与 worker token。
 */

const ROUTES = Object.freeze({
  me: "/api/me",
  config: "/api/checkin-face-test/config",
  switch: "/api/checkin-face-test/switch",
  room: "/api/checkin-face-test/room",
  lease: "/api/checkin-face-test/lease",
  accounts: "/api/checkin-face-test/accounts",
  workerToken: "/api/checkin-face-test/worker-token",
  applicationVersion: "/api/checkin-face-test/application-version",
  storage: "/api/checkin-face-test/storage",
  dispatch: "/api/checkin-face-test/dispatch",
});

// Defensive: even if a server response is widened later, never render a secret-looking key.
const SECRET_KEY = /password|passwd|secret|private|credential|token|certificate|cert|pin|photo|base64/i;

const state = { csrf: "", account: null, revision: null };

function $(selector) {
  return document.querySelector(selector);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function toast(message, kind = "info") {
  const node = $("#toast");
  if (!node) return;
  node.textContent = String(message || "");
  node.className = kind === "error" ? "error" : "success";
  node.hidden = false;
  if (toast.timer) clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    node.textContent = "";
    node.hidden = true;
  }, 6000);
}

/** Render only non-secret scalar fields; drop anything that looks like a device secret. */
function safeView(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    if (typeof item === "string") out[key] = item.slice(0, 300);
    else if (typeof item === "number" && Number.isFinite(item)) out[key] = item;
    else if (typeof item === "boolean" || item === null) out[key] = item;
  }
  return out;
}

async function request(path, { method = "GET", data } = {}) {
  const headers = { Accept: "application/json" };
  const init = { method, headers, credentials: "same-origin" };
  if (data !== undefined) {
    headers["Content-Type"] = "application/json";
    // Browser sets Origin automatically for same-origin PUT; server checks it.
    headers["X-CSRF-Token"] = state.csrf;
    init.body = JSON.stringify(data);
  }
  const response = await fetch(path, init);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`服务端返回无效 JSON（HTTP ${response.status}）`);
  }
  if (!response.ok || (payload && payload.error)) {
    throw new Error(payload?.error || `请求失败（HTTP ${response.status}）`);
  }
  return payload;
}

function showLogin(message) {
  $("#config-content").hidden = true;
  $("#config-login").hidden = false;
  if (message) $("#config-login-msg").textContent = message;
}

function showConfig() {
  $("#config-login").hidden = true;
  $("#config-content").hidden = false;
}

function auditText(audit) {
  const safe = safeView(audit);
  if (!safe) return "—";
  const parts = ["actor", "actorId", "action", "reason", "revision", "createdAt"]
    .filter((key) => safe[key] !== undefined && safe[key] !== null && safe[key] !== "")
    .map((key) => `${key}: ${esc(safe[key])}`);
  return parts.length ? parts.join("\n") : "—";
}

function fillCommon(snapshot) {
  const config = snapshot?.config && typeof snapshot.config === "object" ? snapshot.config : snapshot || {};
  const revision = snapshot?.revision ?? config.revision ?? null;
  state.revision = Number.isFinite(revision) ? revision : null;
  $("#config-revision").textContent = state.revision === null ? "—" : String(state.revision);

  const enabled = config.enabled === true || config.switch?.enabled === true;
  const switchNode = $("#config-switch-state");
  switchNode.textContent = enabled ? "已开启（仅测试范围）" : "已关闭（默认）";
  switchNode.className = `badge ${enabled ? "amber" : "green"}`;
  $("#switch-enabled").value = enabled ? "true" : "false";

  // Only a boolean is returned by the server; no hash or plaintext is rendered.
  const tokenConfigured = snapshot?.workerTokenConfigured === true || config.workerTokenConfigured === true;
  const tokenNode = $("#config-worker-token-state");
  tokenNode.textContent = tokenConfigured ? "已设置" : "未设置";
  tokenNode.className = `badge ${tokenConfigured ? "green" : "amber"}`;

  // 申请版本号与派发开关是区别于「自动通过开关」的两个独立服务端判据。
  const version = typeof config.applicationVersion === "string" ? config.applicationVersion : "";
  $("#config-application-version").textContent = version || "未设置（申请必然失败）";
  $("#application-version-value").value = version;

  // 可信云存储命名空间：配置事实（非秘密），可直接展示与回填编辑。
  const storageNamespace = typeof config.storageNamespace === "string" ? config.storageNamespace : "";
  $("#config-storage-namespace").textContent = storageNamespace || "未设置（上传建任务失败关闭）";
  $("#storage-namespace-value").value = storageNamespace;

  const dispatchEnabled = config.dispatchEnabled === true;
  const dispatchNode = $("#config-dispatch-state");
  dispatchNode.textContent = dispatchEnabled ? "已开启（worker 可领取）" : "已关闭（默认）";
  dispatchNode.className = `badge ${dispatchEnabled ? "amber" : "green"}`;
  $("#dispatch-enabled").value = dispatchEnabled ? "true" : "false";

  const environment = config.environment ?? snapshot?.environment;
  $("#config-environment").textContent = typeof environment === "string" && environment ? environment : "—";

  const lastAudit = snapshot?.lastAudit ?? snapshot?.audit ?? config.lastAudit;
  $("#config-last-audit").textContent = auditText(lastAudit);

  const room = snapshot?.room ?? config.roomBinding ?? config.room ?? {};
  for (const [id, key] of [
    ["#room-project-id", "projectId"],
    ["#room-project-name", "projectName"],
    ["#room-building-id", "buildingId"],
    ["#room-building-name", "buildingName"],
    ["#room-room-id", "roomId"],
    ["#room-house-id", "houseId"],
    ["#room-door-no", "doorNo"],
    ["#room-device-key", "deviceKey"],
  ]) {
    const node = $(id);
    if (node && room[key] !== undefined && room[key] !== null) node.value = String(room[key]);
  }

  const fingerprintNode = $("#room-access-plan-fingerprint");
  if (fingerprintNode && typeof room.accessPlanFingerprint === "string"
    && /^[a-fA-F0-9]{64}$/.test(room.accessPlanFingerprint)) {
    fingerprintNode.value = room.accessPlanFingerprint;
  }

  const lease = snapshot?.lease ?? config.lease ?? config.leaseSnapshot ?? {};
  const startDate = lease.startDate ?? "";
  const endDate = lease.endDate ?? "";
  $("#lease-start").value = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : "";
  $("#lease-end").value = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : "";
  $("#lease-status").value = lease.status === "cancelled" ? "cancelled" : "active";

  const allowlist = snapshot?.allowlist ?? config.allowlist ?? config.accounts ?? [];
  const openids = Array.isArray(allowlist)
    ? allowlist.map((row) => (typeof row === "string" ? row : row?.openid)).filter((v) => typeof v === "string" && v)
    : [];
  $("#accounts-list").value = openids.join("\n");
}

async function reload() {
  try {
    const snapshot = await request(ROUTES.config);
    fillCommon(snapshot);
    showConfig();
  } catch (error) {
    toast(error.message || "读取配置失败", "error");
  }
}

function bindForm(id, path, build) {
  const form = $(id);
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const payload = build(new FormData(form));
      await request(path, { method: "PUT", data: payload });
      toast("已保存，审计已记录", "success");
      await reload();
    } catch (error) {
      toast(error.message || "保存失败", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });
}

/** 明文 token 只在本次提交的内存中短暂存在；读值后立即从 DOM 抹除。 */
function bindWorkerTokenForm() {
  const form = $("#worker-token-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tokenNode = $("#worker-token-value");
    const reasonNode = $("#worker-token-reason");
    let token = typeof tokenNode?.value === "string" ? tokenNode.value : "";
    const reason = typeof reasonNode?.value === "string" ? reasonNode.value.trim() : "";
    if (tokenNode) tokenNode.value = "";
    if (reasonNode) reasonNode.value = "";
    if (!token.trim()) {
      toast("请填写 worker token", "error");
      return;
    }
    if (token.length < 32) {
      toast("worker token 至少 32 位随机字符", "error");
      return;
    }
    if (!reason) {
      toast("请填写变更原因", "error");
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      await request(ROUTES.workerToken, { method: "PUT", data: { token: token.trim(), reason } });
      token = "";
      toast("worker token 已设置，明文已从页面清除", "success");
      await reload();
    } catch (error) {
      token = "";
      toast(error.message || "设置失败", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });
}

function requiredText(data, key, max = 200) {
  const raw = data.get(key);
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) throw new Error(`请填写${key}`);
  if (value.length > max) throw new Error(`${key} 过长`);
  return value;
}

function reasonOf(data) {
  return requiredText(data, "reason", 200);
}

function bind() {
  bindForm("#switch-form", ROUTES.switch, (data) => {
    const raw = data.get("enabled");
    if (!["true", "false"].includes(raw)) throw new Error("开关状态无效");
    return { enabled: raw === "true", reason: reasonOf(data) };
  });

  bindForm("#room-form", ROUTES.room, (data) => {
    const doorNo = Number(data.get("doorNo"));
    if (!Number.isSafeInteger(doorNo) || doorNo < 1 || doorNo > 65535) throw new Error("门号必须是 1–65535 的整数");
    // 设备可信材料：必须由负责人实际核验全天计划后手填，不能自动推断。
    const accessPlanFingerprint = requiredText(data, "accessPlanFingerprint", 64);
    if (!/^[a-fA-F0-9]{64}$/.test(accessPlanFingerprint)) throw new Error("全天计划指纹必须是 64 位十六进制");
    return {
      projectId: requiredText(data, "projectId", 80),
      buildingId: requiredText(data, "buildingId", 80),
      roomId: requiredText(data, "roomId", 80),
      houseId: requiredText(data, "houseId", 80),
      doorNo,
      deviceKey: requiredText(data, "deviceKey", 80),
      accessPlanFingerprint,
      ...(String(data.get("projectName") || "").trim()
        ? { projectName: requiredText(data, "projectName", 128) } : {}),
      ...(String(data.get("buildingName") || "").trim()
        ? { buildingName: requiredText(data, "buildingName", 128) } : {}),
      reason: reasonOf(data),
    };
  });

  bindForm("#lease-form", ROUTES.lease, (data) => {
    const startDate = requiredText(data, "startDate", 10);
    const endDate = requiredText(data, "endDate", 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate))
      throw new Error("租期起止必须手动填写为 YYYY-MM-DD");
    if (startDate > endDate) throw new Error("起始日期不得晚于结束日期");
    const status = data.get("status") === "cancelled" ? "cancelled" : "active";
    return { startDate, endDate, status, reason: reasonOf(data) };
  });

  bindForm("#accounts-form", ROUTES.accounts, (data) => {
    const raw = data.get("openids");
    const openids = String(raw || "")
      .split(/[\r\n,，;；\s]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    if (openids.some((v) => v.length > 128)) throw new Error("单个 openid 过长");
    return { openids, reason: reasonOf(data) };
  });

  bindForm("#application-version-form", ROUTES.applicationVersion, (data) => {
    const version = requiredText(data, "version", 128);
    return { version, reason: reasonOf(data) };
  });

  bindForm("#storage-form", ROUTES.storage, (data) => {
    const namespace = requiredText(data, "namespace", 128);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(namespace)) {
      throw new Error("命名空间须为 1–128 位字母/数字开头，可含 . _ -");
    }
    return { namespace, reason: reasonOf(data) };
  });

  bindForm("#dispatch-form", ROUTES.dispatch, (data) => {
    const raw = data.get("enabled");
    if (!["true", "false"].includes(raw)) throw new Error("派发开关状态无效");
    return { enabled: raw === "true", reason: reasonOf(data) };
  });

  bindWorkerTokenForm();
}

async function boot() {
  try {
    const me = await request(ROUTES.me);
    state.csrf = me?.csrf || "";
    state.account = me?.account || null;
    if (state.account?.role !== "admin" || !state.csrf) {
      showLogin("仅系统管理员可访问本机测试配置；请先在管理工作台登录。");
      return;
    }
  } catch {
    showLogin("请先在主工作台以系统管理员身份登录，再打开本页。");
    return;
  }
  bind();
  await reload();
}

boot();
