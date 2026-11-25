/** Same-origin admin page. Secrets never enter storage, list rows or messages. */
const BASE = "/api/tenant-password-accounts";
const ERROR_MESSAGES = Object.freeze({
  ADMIN_REQUIRED: "仅系统管理员可管理租客密码账号。",
  INVALID_INPUT: "提交格式无效，请检查住户选择、账号及密码要求。",
  USER_NOT_VERIFIED: "该住户尚未完成微信手机号注册验证，不能开通账号。",
  IDENTITY_UNVERIFIED: "住户微信身份无法核对，本次未开通账号。",
  ACCOUNT_EXISTS: "该账号或本人绑定已开通，请刷新列表后核对。",
  ACCOUNT_NOT_FOUND: "账号不存在，请刷新列表。",
  REVISION_CONFLICT: "账号已被其他管理员更新，请刷新后重试。",
  ACCOUNT_LIST_LIMIT: "记录数量超出本次列表容量，请联系维护人员处理；未返回截断列表。",
  ACCOUNT_DATA_UNVERIFIED: "账号资料完整性未通过检查，请联系维护人员核对；未隐藏异常记录。",
  SERVICE_UNAVAILABLE: "账号服务暂不可用，本次未确认完成，请刷新后核对。",
});

/** Explicit display projection; additional server fields are never retained. */
export function accountView(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)
    || typeof row.id !== "string" || !row.id || row.id.length > 160
    || typeof row.username !== "string" || !/^[a-z0-9][a-z0-9._-]{3,31}$/.test(row.username)
    || !["active", "disabled"].includes(row.status)
    || !Number.isSafeInteger(row.revision) || row.revision < 1) {
    throw new Error("账号列表格式无效，请联系管理员核对服务端版本。");
  }
  return {
    id: row.id, username: row.username, status: row.status, revision: row.revision,
    updatedAt: Number.isSafeInteger(row.updatedAt) && row.updatedAt > 0 ? row.updatedAt : null,
  };
}

/** Verified-phone resident projection; openid and other server fields are never retained. */
export function residentView(row) {
  const safeId = (value) => typeof value === "string" && value.length > 0 && value.length <= 256
    && !/[\x00-\x20\x7f/\\]/.test(value);
  if (!row || typeof row !== "object" || Array.isArray(row)
    || !safeId(row.userId)
    || typeof row.phone !== "string" || !/^[0-9]{6,15}$/.test(row.phone)
    || !Array.isArray(row.houses) || !row.houses.every(safeId)
    || (row.name !== undefined && (typeof row.name !== "string" || row.name.length > 128 || /[\x00-\x1f\x7f]/.test(row.name)))) {
    throw new Error("住户列表格式无效，请联系管理员核对服务端版本。");
  }
  return { userId: row.userId, phone: row.phone,
    name: row.name || "",
    houses: row.houses.slice() };
}

function validPassword(password) {
  return typeof password === "string" && password.length >= 8 && password.length <= 128
    && new TextEncoder().encode(password).length <= 256;
}

export function createTenantPasswordAccountsPage({ document: doc, fetch: fetcher }) {
  const state = { csrf: "", authorized: false, busy: false, rows: new Map(), residents: new Set() };
  const $ = (id) => doc.getElementById(id);
  const message = (text) => { $("account-message").textContent = text; $("account-message").hidden = false; };
  const clearSecrets = () => {
    $("create-password").value = "";
    $("reset-password").value = "";
  };
  const setBusy = (value) => {
    state.busy = value;
    for (const control of doc.querySelectorAll("#account-content button, #account-content input, #account-content select")) {
      control.disabled = value || !state.authorized;
    }
  };
  async function request(path, data) {
    const init = { method: data === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
      headers: { Accept: "application/json" } };
    if (data !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.headers["X-CSRF-Token"] = state.csrf;
      init.body = JSON.stringify(data);
    }
    let response, payload;
    try {
      response = await fetcher(path, init);
      payload = await response.json();
    } catch { throw new Error("未获得服务端确认，请刷新列表核对；不要重复提交开通请求。"); }
    if (!response.ok || payload?.error) {
      if (response.status === 401 || response.status === 403) {
        state.authorized = false;
        state.csrf = "";
        state.rows.clear();
        state.residents.clear();
        clearSecrets();
        $("account-content").hidden = true;
        $("account-login").hidden = false;
      }
      const knownMessage = Object.hasOwn(ERROR_MESSAGES, payload?.code) ? ERROR_MESSAGES[payload.code] : null;
      throw new Error(knownMessage || (response.status === 403 ? ERROR_MESSAGES.ADMIN_REQUIRED : "操作未获确认，请刷新列表后核对。"));
    }
    return payload;
  }
  function renderRows(rows) {
    const fragment = doc.createDocumentFragment();
    for (const row of rows) {
      const tr = doc.createElement("tr");
      for (const value of [row.username, row.status === "active" ? "已启用" : "已停用", row.revision,
        row.updatedAt === null ? "—" : new Date(row.updatedAt).toLocaleString("zh-CN")]) {
        const td = doc.createElement("td");
        td.textContent = String(value);
        tr.append(td);
      }
      fragment.append(tr);
    }
    $("account-rows").replaceChildren(fragment);
    $("accounts-empty").hidden = rows.length !== 0;
    for (const id of ["reset-account", "status-account"]) {
      const select = $(id), previous = select.value;
      const options = rows.map((row) => {
        const option = doc.createElement("option");
        option.value = row.id;
        option.textContent = `${row.username}（${row.status === "active" ? "已启用" : "已停用"}）`;
        return option;
      });
      const placeholder = doc.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "请选择账号";
      select.replaceChildren(placeholder, ...options);
      select.value = rows.some((row) => row.id === previous) ? previous : "";
    }
  }
  function renderResidents(rows) {
    const select = $("resident-user"), previous = select.value;
    const options = rows.map((row) => {
      const option = doc.createElement("option");
      option.value = row.userId;
      option.textContent = `${row.phone}${row.name ? `（${row.name}）` : ""}`;
      return option;
    });
    const placeholder = doc.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "请选择住户";
    select.replaceChildren(placeholder, ...options);
    select.value = rows.some((row) => row.userId === previous) ? previous : "";
  }
  async function reload() {
    try {
      const payload = await request(BASE);
      if (!Array.isArray(payload?.rows)) throw new Error("账号列表格式无效，请联系管理员核对服务端版本。");
      const rows = payload.rows.map(accountView);
      if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error("账号列表存在重复记录，请联系管理员核对。");
      const residents = await request(`${BASE}/residents`);
      if (!Array.isArray(residents?.rows)) throw new Error("住户列表格式无效，请联系管理员核对服务端版本。");
      const residentRows = residents.rows.map(residentView);
      if (new Set(residentRows.map((row) => row.userId)).size !== residentRows.length) throw new Error("住户列表存在重复记录，请联系管理员核对。");
      state.rows = new Map(rows.map((row) => [row.id, row]));
      state.residents = new Set(residentRows.map((row) => row.userId));
      renderRows(rows);
      renderResidents(residentRows);
    } catch (error) {
      state.rows.clear();
      state.residents.clear();
      renderRows([]);
      renderResidents([]);
      throw error;
    }
  }
  async function mutate(path, data, successMessage) {
    if (!state.authorized || state.busy) return;
    setBusy(true);
    try {
      await request(`${BASE}/${path}`, data);
      await reload();
      message(successMessage);
    } catch (error) { message(error.message); }
    finally {
      if (Object.hasOwn(data, "password")) data.password = "";
      if (Object.hasOwn(data, "newPassword")) data.newPassword = "";
      clearSecrets();
      setBusy(false);
    }
  }
  function selectedAccount(id) {
    const row = state.rows.get($(id).value);
    if (!row) { message("请先选择当前列表中的账号。"); return null; }
    return row;
  }
  $("create-account-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = { userId: $("resident-user").value, username: $("create-username").value,
      password: $("create-password").value };
    $("create-password").value = "";
    if (!state.residents.has(data.userId)) { data.password = ""; message("请先选择当前列表中已完成微信手机号验证的住户。"); return; }
    if (!validPassword(data.password)) { data.password = ""; message("密码需为8–128个字符，UTF-8不超过256字节。"); return; }
    await mutate("create", data, "账号已开通，请将账号与初始密码交给本人。");
  });
  $("reset-password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const newPassword = $("reset-password").value;
    $("reset-password").value = "";
    const row = selectedAccount("reset-account");
    if (!row) return;
    if (!validPassword(newPassword)) { message("密码需为8–128个字符，UTF-8不超过256字节。"); return; }
    await mutate("reset", { accountId: row.id, newPassword, expectedRevision: row.revision }, "密码已重置，账号绑定与启停状态保持不变。");
  });
  $("account-status-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const row = selectedAccount("status-account");
    if (!row) return;
    const status = $("password-status").value;
    if (!["active", "disabled"].includes(status)) { message("请选择密码入口状态。"); return; }
    await mutate("status", { accountId: row.id, status, expectedRevision: row.revision }, "密码入口状态已保存；微信／手机号登录及房产权限未改变。");
  });
  $("reload-accounts").addEventListener("click", async () => {
    if (state.busy || !state.authorized) return;
    setBusy(true);
    try { await reload(); message("账号列表已更新。"); }
    catch (error) { message(error.message); }
    finally { setBusy(false); }
  });
  return {
    async start() {
      clearSecrets();
      setBusy(true);
      try {
        const me = await request("/api/me");
        if (me?.account?.role !== "admin" || typeof me.csrf !== "string" || !me.csrf) throw new Error(ERROR_MESSAGES.ADMIN_REQUIRED);
        state.csrf = me.csrf;
        state.authorized = true;
        await reload();
        $("account-login").hidden = true;
        $("account-content").hidden = false;
      } catch (error) {
        state.authorized = false;
        state.csrf = "";
        $("login-message").textContent = error.message;
        $("account-login").hidden = false;
        $("account-content").hidden = true;
      } finally { setBusy(false); }
    },
  };
}

if (typeof document !== "undefined" && typeof globalThis.fetch === "function") {
  const page = createTenantPasswordAccountsPage({ document, fetch: globalThis.fetch.bind(globalThis) });
  page.start();
}
