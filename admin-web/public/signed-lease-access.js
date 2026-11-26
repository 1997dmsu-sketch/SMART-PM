const BASE = "/api/signed-lease-access";
const FIELDS = Object.freeze({
  confirm: ["contractId", "expectedRevision", "userId", "houseId", "doorBindingId", "startDate", "endDate", "signedEvidenceRef"],
  revoke: ["contractId", "expectedRevision", "reason"],
  program: ["expectedRevision", "enabled", "dispatchEnabled"],
  binding: ["bindingId", "expectedRevision", "houseId", "displayName", "deviceKey", "doorNo", "expectedModel", "enabled"],
  worker: ["workerId", "expectedRevision", "deviceKey", "tokenHash", "enabled"],
  "resolve-unknown": ["taskId", "expectedRevision", "reason"],
});
const RECEIPT_FIELDS = Object.freeze({
  confirm: ["contractId", "revision", "status", "userId", "houseId", "doorBindingId", "startDate", "endDate", "validFrom", "validUntil"],
  revoke: ["contractId", "revision", "status"],
  program: ["revision", "enabled", "dispatchEnabled"],
  binding: ["bindingId", "revision", "houseId", "displayName", "deviceKey", "doorNo", "expectedModel", "enabled"],
  worker: ["workerId", "revision", "deviceKey", "enabled"],
  "resolve-unknown": ["taskId", "revision", "status", "resolved"],
});
const RECORD_FIELDS = Object.freeze({
  contract: RECEIPT_FIELDS.confirm, binding: RECEIPT_FIELDS.binding, worker: RECEIPT_FIELDS.worker,
  program: RECEIPT_FIELDS.program,
  task: ["taskId", "revision", "status", "resolved", "contractId", "expiresAt", "message"],
});
const ERROR_MESSAGES = Object.freeze({
  ADMIN_REQUIRED: "需要当前有效的系统管理员会话。",
  INVALID_INPUT: "提交格式无效，请核对必填字段和当前版本。",
  USER_NOT_VERIFIED: "住户的本人手机号验证未通过，本次未建立资格。",
  IDENTITY_UNVERIFIED: "当前住户身份无法核对，本次未建立资格。",
  REVISION_CONFLICT: "记录版本已改变，请核对最新记录；不要重复提交旧版本。",
  CONTRACT_NOT_FOUND: "合同不存在，请核对编号。",
  CONTRACT_CONFLICT: "合同事实与现有记录冲突，请核对住户、房产和签署证据。",
  HOUSE_NOT_FOUND: "房产不存在，请刷新房产选择。",
  HOUSE_UNVERIFIED: "房产与房门绑定无法唯一核对，请检查房产及绑定记录。",
  ROOM_NOT_FOUND: "房产不存在，请刷新房产选择。",
  ROOM_NOT_UNIQUE: "房产编号存在重复，须先核对后台房产记录。",
  BINDING_NOT_FOUND: "房门绑定不存在，请先核对绑定配置。",
  WORKER_NOT_FOUND: "worker 记录不存在，请核对编号。",
  TASK_NOT_FOUND: "任务不存在，请核对编号。",
  TASK_NOT_UNKNOWN: "任务尚不能作未知结果处置，请先人工核查状态和执行期限。",
  ACCESS_UNVERIFIED: "现有资格资料无法核对，本次未获确认，请联系维护人员核查。",
  ACCESS_LIMIT: "住户合同记录已达到本次容量，请联系维护人员核查。",
  INVALID_STATE: "当前状态不允许此操作，请核查后再处置。",
});
const safeText = (value) => typeof value === "string" && value.length > 0
  && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);

/** Build a closed payload; no role, identity proof or device address comes from this page. */
export function operationInput(operation, values) {
  if (!Object.hasOwn(FIELDS, operation)) throw new Error("操作不存在。");
  const data = {};
  for (const key of FIELDS[operation]) {
    const value = values[key];
    if (key === "expectedRevision" || key === "doorNo") {
      if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error("版本和门号须填写明确的非负整数。");
      data[key] = Number(value);
      if (!Number.isSafeInteger(data[key]) || (key === "doorNo" && (data[key] < 1 || data[key] > 65535))) throw new Error("版本或门号无效。");
    } else if (key === "enabled" || key === "dispatchEnabled") {
      if (!["true", "false"].includes(value)) throw new Error("请明确选择每一项启停状态。");
      data[key] = value === "true";
    } else {
      if (!safeText(value?.trim())) throw new Error("请完整填写所选操作的资料。");
      data[key] = value.trim();
    }
  }
  if (operation === "confirm" && (!/^\d{4}-\d{2}-\d{2}$/.test(data.startDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(data.endDate) || data.startDate > data.endDate)) throw new Error("请手动填写正确的租期起止日期。");
  if (operation === "worker" && !/^[a-f0-9]{64}$/.test(data.tokenHash)) throw new Error("仅接受64位小写 SHA256 哈希，不填写明文凭据。");
  return data;
}

export function receiptView(operation, row) {
  const fields = RECEIPT_FIELDS[operation];
  if (!fields || !row || typeof row !== "object" || Array.isArray(row)
    || !Number.isSafeInteger(row.revision) || row.revision < 1
    || (operation === "confirm" && (row.status !== "signed" || row.validUntil <= row.validFrom))
    || (operation === "revoke" && row.status !== "revoked")
    || (operation === "resolve-unknown" && (row.status !== "unknown" || row.resolved !== true))) throw new Error("回执格式无法核对，请联系维护人员确认当前版本。");
  return Object.fromEntries(fields.map((key) => {
    const value = row[key];
    if (!["string", "number", "boolean"].includes(typeof value)
      || (typeof value === "number" && !Number.isSafeInteger(value))
      || (typeof value === "string" && !safeText(value))) throw new Error("回执字段无法核对，请联系维护人员确认。");
    return [key, value];
  }));
}

export function recordView(payload, kind, id) {
  if (typeof kind !== "string" || !Object.hasOwn(RECORD_FIELDS, kind) || !payload || payload.kind !== kind) throw new Error("查询记录类型无法核对。");
  if (payload.record === null) return { kind, record: null };
  const row = payload.record;
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("查询记录格式无效。");
  const record = {};
  for (const key of RECORD_FIELDS[kind]) {
    const value = row[key];
    const numeric = ["revision", "doorNo", "validFrom", "validUntil", "expiresAt"].includes(key);
    const boolean = ["enabled", "dispatchEnabled", "resolved"].includes(key);
    if (numeric ? !Number.isSafeInteger(value) || (key === "revision" && value < 1)
      || (key === "doorNo" && (value < 1 || value > 65535))
      : boolean ? typeof value !== "boolean" : !safeText(value)) throw new Error("查询记录字段无法核对。");
    record[key] = value;
  }
  const idKey = { contract: "contractId", binding: "bindingId", worker: "workerId", task: "taskId" }[kind];
  if ((idKey && record[idKey] !== id)
    || (kind === "contract" && (!["signed", "revoked"].includes(record.status) || record.validUntil <= record.validFrom))
    || (kind === "binding" && (record.doorNo < 1 || record.doorNo > 65535))
    || (kind === "task" && !["queued", "claimed", "executing", "unknown", "device_confirmed", "failed", "expired", "denied"].includes(record.status))) throw new Error("查询记录状态或编号无法核对。");
  return { kind, record };
}

export function createSignedLeaseAccessPage({ document: doc, fetch: fetcher }) {
  const state = { csrf: "", authorized: false, busy: false, epoch: 0, residents: new Set(), houses: new Set() };
  const $ = (id) => doc.getElementById(id);
  const forms = [...doc.querySelectorAll("form[data-operation]")];
  const message = (text) => { $("lease-message").textContent = text; $("lease-message").hidden = false; };
  function setBusy(value) {
    state.busy = value;
    for (const control of doc.querySelectorAll("#lease-content input, #lease-content select, #lease-content button")) control.disabled = value || !state.authorized;
  }
  function lock() {
    state.epoch += 1;
    state.authorized = false;
    state.csrf = "";
    state.residents.clear();
    state.houses.clear();
    $("lease-worker-hash").value = "";
    $("lease-receipt").textContent = "会话失效，当前回执已清除。";
    $("lease-record-result").textContent = "会话失效，已清除查询记录。";
    $("lease-content").hidden = true;
    $("lease-login").hidden = false;
  }
  async function request(path, data) {
    const epoch = state.epoch;
    const init = { method: data === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } };
    if (data !== undefined) Object.assign(init, { body: JSON.stringify(data), headers: {
      ...init.headers, "Content-Type": "application/json", "X-CSRF-Token": state.csrf,
    } });
    let response, payload;
    try { response = await fetcher(path, init); payload = await response.json(); }
    catch { throw new Error("未收到服务端确认，请人工核对当前记录和版本；不会自动重试。"); }
    if (epoch !== state.epoch) throw new Error("会话已变更，请重新登录后核对。");
    if (!response.ok || payload?.error) {
      if (response.status === 401 || (response.status === 403 && (!payload?.code || payload.code === "ADMIN_REQUIRED"))) lock();
      throw new Error(Object.hasOwn(ERROR_MESSAGES, payload?.code) ? ERROR_MESSAGES[payload.code]
        : response.status === 401 || response.status === 403 ? ERROR_MESSAGES.ADMIN_REQUIRED
          : "操作未获确认，请核对当前记录和版本；不会自动重试。");
    }
    return payload;
  }
  function renderOptions(select, rows, key, label, placeholderText) {
    const placeholder = doc.createElement("option");
    placeholder.value = "";
    placeholder.textContent = placeholderText;
    select.replaceChildren(placeholder, ...rows.map((row) => {
      const option = doc.createElement("option");
      option.value = row[key]; option.textContent = label(row); return option;
    }));
    select.value = "";
  }
  async function reload() {
    state.residents.clear(); state.houses.clear();
    renderOptions($("lease-resident"), [], "userId", () => "", "请选择住户");
    for (const select of doc.querySelectorAll("[data-house-options]")) renderOptions(select, [], "houseId", () => "", "请选择房产");
    const payload = await request(`${BASE}/options`);
    if (!Array.isArray(payload?.residents) || !Array.isArray(payload?.rooms)) throw new Error("选择列表格式无法核对。");
    const residents = payload.residents.map((row) => {
      if (!safeText(row?.userId) || !/^[0-9]{6,15}$/.test(row?.phone) || (row.name && !safeText(row.name))) throw new Error("住户选择资料无效。");
      return { userId: row.userId, phone: row.phone, name: row.name || "" };
    });
    const rooms = payload.rooms.map((row) => {
      if (!safeText(row?.houseId) || !safeText(row?.displayName)) throw new Error("房产选择资料无效。");
      return { houseId: row.houseId, displayName: row.displayName };
    });
    if (new Set(residents.map((row) => row.userId)).size !== residents.length
      || new Set(rooms.map((row) => row.houseId)).size !== rooms.length) throw new Error("选择列表存在重复记录，请先核查资料。");
    state.residents = new Set(residents.map((row) => row.userId));
    state.houses = new Set(rooms.map((row) => row.houseId));
    renderOptions($("lease-resident"), residents, "userId", (row) => `${row.phone}${row.name ? `（${row.name}）` : ""}`, "请选择住户");
    for (const select of doc.querySelectorAll("[data-house-options]")) renderOptions(select, rooms, "houseId", (row) => `${row.displayName}（${row.houseId}）`, "请选择房产");
  }
  for (const form of forms) form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.authorized || state.busy) return;
    setBusy(true);
    let data, submitted = false;
    try {
      const operation = form.dataset.operation;
      const values = Object.fromEntries([...form.elements].filter((control) => control.name).map((control) => [control.name, control.value]));
      data = operationInput(operation, values);
      $("lease-worker-hash").value = "";
      if (Object.hasOwn(data, "userId") && !state.residents.has(data.userId)) throw new Error("请先选择列表中已验证的本人住户。");
      if (Object.hasOwn(data, "houseId") && !state.houses.has(data.houseId)) throw new Error("请先选择列表中的现有房产。");
      $("lease-receipt").textContent = "正在等待本次操作的服务端确认。";
      submitted = true;
      const payload = await request(`${BASE}/${operation}`, data);
      $("lease-receipt").textContent = JSON.stringify(receiptView(operation, payload), null, 2);
      message(operation === "confirm" ? "已记录签约事实并建立租期资格。没有发送开门命令，人脸可之后补录。"
        : operation === "resolve-unknown" ? "已记录人工处置；没有重发指令，不代表现场开门成功。"
          : "服务端已确认本次操作，详情见回执。没有发送开门命令。");
    } catch (error) {
      if (submitted && state.authorized) $("lease-receipt").textContent = "本次操作未获确认，请人工核对当前记录及版本。";
      message(error.message);
    }
    finally { if (data?.tokenHash) data.tokenHash = ""; $("lease-worker-hash").value = ""; setBusy(false); }
  });
  $("lease-record-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.authorized || state.busy) return;
    setBusy(true);
    $("lease-record-result").textContent = "正在读取当前记录。";
    try {
      const kind = $("lease-record-kind").value, id = $("lease-record-id").value.trim();
      if (!Object.hasOwn(RECORD_FIELDS, kind) || (kind === "program" ? id && id !== "program" : !safeText(id))) throw new Error("请选择记录类型并填写对应编号；服务配置编号可留空。");
      const query = `kind=${encodeURIComponent(kind)}${id ? `&id=${encodeURIComponent(id)}` : ""}`;
      const payload = await request(`${BASE}/record?${query}`);
      $("lease-record-result").textContent = JSON.stringify(recordView(payload, kind, id), null, 2);
      message("当前脱敏记录已读取。请核对后手动复制所需资料，原表单与开关没有改变。");
    } catch (error) {
      $("lease-record-result").textContent = "未获得可核对的当前记录，请重新确认类型与编号。";
      message(error.message);
    } finally { setBusy(false); }
  });
  $("lease-reload").addEventListener("click", async () => {
    if (!state.authorized || state.busy) return;
    setBusy(true);
    try { await reload(); message("住户与房产选择已刷新，未修改任何合同或开关。"); }
    catch (error) { message(error.message); }
    finally { setBusy(false); }
  });
  return { async start() {
    lock(); setBusy(true);
    try {
      const me = await request("/api/me");
      if (me?.account?.role !== "admin" || !safeText(me.csrf)) throw new Error(ERROR_MESSAGES.ADMIN_REQUIRED);
      state.csrf = me.csrf; state.authorized = true;
      await reload();
      $("lease-receipt").textContent = "尚无本次操作回执。";
      $("lease-record-result").textContent = "尚未读取记录。";
      $("lease-login").hidden = true; $("lease-content").hidden = false;
    } catch (error) { lock(); $("lease-login-message").textContent = error.message; }
    finally { setBusy(false); }
  } };
}

if (typeof document !== "undefined" && typeof globalThis.fetch === "function") {
  createSignedLeaseAccessPage({ document, fetch: globalThis.fetch.bind(globalThis) }).start();
}
