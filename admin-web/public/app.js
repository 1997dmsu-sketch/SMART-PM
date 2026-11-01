const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  house: "m3 10 9-7 9 7 M5 9v12h14V9 M9 21v-8h6v8",
  file: "M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
  building:
    "M4 21V5h10v16 M14 10h6v11 M2 21h20 M7 8h3 M7 12h3 M7 16h3 M17 13v1 M17 17v1",
  shield: "M12 3 3 7v5c0 6 9 9 9 9s9-3 9-9V7z m-4 9 3 3 5-6",
  clock: "M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  search: "M21 21l-6-6 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  plus: "M12 5v14 M5 12h14",
  arrow: "M5 12h14 m-5-5 5 5-5 5",
  calendar: "M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16",
  refresh:
    "M20 7v5h-5 M4 17v-5h5 M5 7a8 8 0 0 1 13-2l2 3 M4 16l2 3a8 8 0 0 0 13-2",
  upload: "M12 16V3 m-5 5 5-5 5 5 M4 15v6h16v-6",
  box: "M3 7 12 3l9 4v10l-9 4-9-4z M3 7l9 5 9-5 M12 12v9",
  logout: "M9 3H3v18h6 M9 12h13 m-5-5 5 5-5 5",
};
const icon = (n) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[n] || paths.grid}"/></svg>`;
const labels = {
  dashboard: "工作台",
  houses: "房源管理",
  content: "内容管理",
  users: "用户管理",
  rooms: "房产管理",
  audit: "操作日志",
  accounts: "管理员设置",
};
const navIcons = {
  dashboard: "grid",
  houses: "house",
  content: "file",
  users: "users",
  rooms: "building",
  audit: "clock",
  accounts: "shield",
};
const roleNames = {
  admin: "系统管理员",
  editor: "内容运营",
  viewer: "只读成员",
};
let session = null,
  config = null,
  route = "dashboard",
  page = 1,
  query = "",
  status = "",
  rows = [],
  total = 0,
  renderVersion = 0,
  toastTimer;
const canWrite = (r) =>
  session?.account.role === "admin" ||
  (session?.account.role === "editor" && ["houses", "content"].includes(r));
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 3500);
}
async function api(path, { method = "GET", data, raw } = {}) {
  const headers = {};
  if (method !== "GET") {
    headers["X-CSRF-Token"] = session?.csrf || "";
    if (!raw) headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`/api/${path}`, {
    method,
    headers,
    body: raw || (data === undefined ? undefined : JSON.stringify(data)),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && session) {
      session = null;
      $("#editor").close();
      shellLogin();
    }
    throw Error(result.error || "请求失败");
  }
  return result;
}
const modeTag = () =>
  `<span class="mode ${config.mode === "live" ? "live" : ""}"><i class="dot"></i>${config.mode === "live" ? "真实云环境" : "本地演示环境"}</span>`;
function date(v) {
  if (!v) return "—";
  if (typeof v === "object") v = v.$date || v;
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}
function image(src, cls = "thumb") {
  return src
    ? `<img class="${cls}" ${src.startsWith("cloud://") ? `data-cloud="${esc(src)}"` : `src="${esc(src)}"`} alt="房源或内容图片" loading="lazy">`
    : `<span class="${cls}"></span>`;
}
async function resolveImages(container = document) {
  for (const img of container.querySelectorAll("[data-cloud]")) {
    try {
      const r = await api(
        `image-url?id=${encodeURIComponent(img.dataset.cloud)}`,
      );
      if (r.url) img.src = r.url;
    } catch {
      img.alt = "图片暂不可用";
    }
  }
}
function shellLogin() {
  $("#editor").close();
  $("#editor").replaceChildren();
  $("#confirm").close();
  $("#app").innerHTML =
    `<div class="login-page"><section class="login-art"><div class="brand"><div class="brandmark">${icon("building")}</div><div><strong>宇宙物业</strong><small>SMART PROPERTY</small></div></div><h1>把社区事务，<br>安排得井井有条。</h1><p>连接房源、住户与社区生活<br>让每一天的物业管理更从容。</p><div class="orbit">${icon("building")}</div></section><section class="login-form"><h2>欢迎回到管理工作台</h2><p>宇宙物业智联 · 电脑端管理后台</p>${modeTag()}${config.mode === "demo" ? `<div class="notice">当前为本地演示。可体验完整编辑流程，数据保存在本机，不影响小程序真实数据。</div><button id="demo-login" class="btn primary">进入演示工作台 ${icon("arrow")}</button><p class="login-note">也可使用下方账号登录，测试不同角色权限。</p>` : ""}<form id="login-form"><label class="field">管理员账号<input name="username" autocomplete="username" required autofocus></label><label class="field">密码<input name="password" type="password" autocomplete="current-password" required></label><div class="form-error" role="alert"></div><button class="btn primary">登录工作台 ${icon("arrow")}</button></form><div class="login-note">仅供授权管理人员使用<br>管理后台账号与微信手机号登录账号独立。</div></section></div>`;
  const enter = async (button, path, data) => {
    button.disabled = true;
    try {
      session = await api(path, { method: "POST", data });
      shell();
      await loadRoute();
    } catch (e) {
      const error = $(".form-error");
      if (error) error.textContent = e.message;
      else toast(e.message);
    } finally {
      button.disabled = false;
    }
  };
  $("#demo-login")?.addEventListener("click", (e) =>
    enter(e.currentTarget, "demo-login", {}),
  );
  $("#login-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    enter(
      e.target.querySelector("button"),
      "login",
      Object.fromEntries(new FormData(e.target)),
    );
  });
}
function shell() {
  $("#app").innerHTML =
    `<div class="shell"><aside class="sidebar"><a href="#dashboard" class="brand"><div class="brandmark">${icon("building")}</div><div><strong>宇宙物业</strong><small>SMART PROPERTY</small></div></a><div class="nav-label">日常运营</div><nav class="nav">${["dashboard", "houses", "content", "users", "rooms"].map((n) => `<a href="#${n}" data-nav="${n}" title="${labels[n]}">${icon(navIcons[n])}<span>${labels[n]}</span></a>`).join("")}${session.account.role === "admin" ? `<div class="nav-label">系统管理</div>${["audit", "accounts"].map((n) => `<a href="#${n}" data-nav="${n}">${icon(navIcons[n])}<span>${labels[n]}</span></a>`).join("")}` : ""}</nav><div class="sidebar-bottom"><div class="sidebar-card"><strong>${icon("shield")} 管理服务</strong><small>${config.mode === "demo" ? "演示数据仅保存在本机" : "操作将同步至真实云环境"}<br>账号权限由服务端校验</small></div><small>SMART PM · ADMIN v0.1</small></div></aside><div class="main-wrap"><header class="topbar"><div class="breadcrumb">管理控制台 <span>/ <b id="crumb">工作台</b></span></div><div class="top-right">${modeTag()}<div class="account"><div class="avatar">${esc(session.account.name.slice(0, 1))}</div><span>${esc(session.account.name)}<br><small>${roleNames[session.account.role]}</small></span></div>${session.account._id !== "demo-admin" ? '<button class="logout" id="password-change">修改密码</button>' : ""}<button class="logout" id="logout">退出登录</button></div></header><main class="workspace" id="workspace"></main></div></div>`;
  $("#password-change")?.addEventListener("click", changePassword);
  $("#logout").onclick = async () => {
    try {
      await api("logout", { method: "POST", data: {} });
      session = null;
      shellLogin();
    } catch (e) {
      toast(e.message);
    }
  };
}
function head(title, subtitle, button = "") {
  return `<div class="page-head"><div><h1>${title}</h1><p>${subtitle}</p></div>${button || `<div class="date">${icon("calendar")}${new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}</div>`}</div>`;
}
function footer() {
  return '<footer class="footer">宇宙物业智联 · 让社区生活更美好</footer>';
}
function empty(text = "暂无记录") {
  return `<div class="empty">${icon("box")}<p>${esc(text)}</p></div>`;
}
function badge(value) {
  const green = ["在租", true, "admin"].includes(value);
  return `<span class="badge ${green ? "green" : value === "已租" ? "blue" : "amber"}">${green ? "• " : ""}${esc(value === true ? "已发布" : value === false ? "草稿" : value)}</span>`;
}
async function loadRoute(reset = true) {
  if (!session) return;
  route = location.hash.slice(1) || "dashboard";
  if (!labels[route]) route = "dashboard";
  if (reset) {
    page = 1;
    query = "";
    status = "";
  }
  const version = ++renderVersion;
  $(".nav a.active")?.classList.remove("active");
  $(`[data-nav="${route}"]`)?.classList.add("active");
  $("#crumb").textContent = labels[route];
  $("#workspace").innerHTML = '<div class="initial">正在加载数据…</div>';
  try {
    if (route === "dashboard") {
      const data = await api("dashboard");
      if (version !== renderVersion) return;
      dashboard(data);
    } else if (route === "accounts") {
      const data = await api("accounts");
      if (version !== renderVersion) return;
      accountsPage(data.rows);
    } else {
      const data = await api(
        `${route}?${new URLSearchParams({ q: query, status, page, pageSize: 10 })}`,
      );
      if (version !== renderVersion) return;
      rows = data.rows;
      total = data.total;
      listPage();
    }
    resolveImages();
  } catch (e) {
    if (version === renderVersion && $("#workspace")) {
      $("#workspace").innerHTML =
        `<div class="error"><h3>暂时无法加载</h3><p>${esc(e.message)}</p><br><button class="btn" id="retry">重新加载</button></div>`;
      $("#retry").onclick = () => loadRoute(false);
    }
  }
}
function dashboard(data) {
  const c = data.counts;
  $("#workspace").innerHTML =
    head(
      `你好，${esc(session.account.name)} <span class="muted">☀</span>`,
      "欢迎回到工作台，社区的每一件小事，都值得用心。",
    ) +
    `<div class="cards">${[
      ["房源总数", c.houses, `${c.published} 套`, "正在出租", "house"],
      ["注册用户", c.users, `${c.unbound} 位`, "待绑定房产", "users"],
      ["社区内容", c.content, `${c.drafts} 篇`, "草稿待发布", "file"],
      ["管理房产", c.rooms, "房产档案", "统一维护", "building"],
    ]
      .map(
        ([label, value, count, note, i]) =>
          `<div class="stat"><div class="stat-top">${label}<div class="stat-icon">${icon(i)}</div></div><div class="stat-value">${value}</div><div class="stat-note"><b>${count}</b> ${note}</div></div>`,
      )
      .join(
        "",
      )}</div><div class="dashboard-grid"><div class="stack"><section class="panel"><div class="panel-head"><h2>快捷操作 <small>让日常管理更高效</small></h2></div><div class="quick-grid">${[
      ["houses", "house", "发布房源"],
      ["content", "file", "发布内容"],
      ["users", "users", "管理住户"],
      ["rooms", "building", "管理房产"],
    ]
      .map(
        ([r, i, t]) =>
          `<button class="quick" data-quick="${r}"><span class="stat-icon">${icon(i)}</span>${t}</button>`,
      )
      .join(
        "",
      )}</div></section><section class="panel"><div class="panel-head"><h2>最近维护的房源</h2><a href="#houses" class="link">查看全部 →</a></div>${data.recent.length ? houseTable(data.recent, true) : empty("还没有房源，添加第一套房源吧")}</section><section class="panel"><div class="panel-head"><h2>最近操作</h2>${session.account.role === "admin" ? '<a href="#audit" class="link">全部日志 →</a>' : ""}</div>${data.activity.length ? `<div class="activity">${data.activity.map((a) => `<div class="activity-item">${esc(a.actor)} · ${esc(a.action)}<small>${esc(a.target)} · ${date(a.createdAt)}</small></div>`).join("")}</div>` : empty(session.account.role === "admin" ? "暂无操作记录，保存后将在这里显示" : "操作日志由系统管理员查看")}</section></div><div class="stack"><section class="panel"><div class="panel-head"><h2>待办提醒</h2><span class="badge rose">${c.drafts + c.unbound}</span></div><a class="task" href="#content"><span class="task-icon">${icon("file")}</span><div>待发布内容<p>完善内容，让社区更有温度</p></div><b>${c.drafts}</b></a><a class="task" href="#users"><span class="task-icon">${icon("users")}</span><div>待绑定用户<p>核实住户信息与房产关系</p></div><b>${c.unbound}</b></a></section><section class="banner"><h3>把管理留在这里<br>把便利带给住户</h3><p>房源、内容与房产档案<br>在同一处有序维护。</p><a class="link" href="#rooms">查看房产档案 →</a>${icon("building")}</section><section class="panel"><div class="panel-head"><h2>当前环境</h2></div><div class="activity"><p class="muted login-note">${config.mode === "demo" ? "本地演示 · 数据独立保存<br>编辑内容不会影响线上小程序。" : `真实云环境<br>${esc(config.environment)}<br>保存将直接更新云端数据。`}</p></div></section></div></div>` +
    footer();
  document.querySelectorAll("[data-quick]").forEach(
    (b) =>
      (b.onclick = () => {
        location.hash = b.dataset.quick;
      }),
  );
}
function houseTable(items, compact = false) {
  return `<div class="table-wrap"><table><thead><tr><th>房源信息</th>${compact ? "" : "<th>户型 / 面积</th>"}<th>月租金</th><th>状态</th>${compact ? "" : "<th>操作</th>"}</tr></thead><tbody>${items.map((r) => `<tr><td><div class="house-cell">${image(r.cover || r.images?.[0])}<div><strong>${esc(r.title)}</strong><small>${esc(r.community)} · ${esc(r.address)}</small></div></div></td>${compact ? "" : `<td>${esc(r.rooms)}<br><small>${esc(r.area)} ㎡ · ${esc(r.rentType)}</small></td>`}<td class="price">¥ ${Number(r.price || 0).toLocaleString()}<small>/月</small></td><td>${badge(r.status)}</td>${compact ? "" : `<td><div class="actions"><button data-edit="${esc(r._id)}">${canWrite("houses") ? "编辑" : "查看"}</button>${canWrite("houses") ? `<button data-toggle="${esc(r._id)}">${r.status === "在租" ? "下架" : "上架"}</button>` : ""}</div></td>`}</tr>`).join("")}</tbody></table></div>`;
}
const descriptions = {
  houses: "维护房源信息、租金与展示状态，让好房源被看见。",
  content: "管理社区分享与房源推荐，发布前可预览内容。",
  users: "查询微信登录用户，核对资料并维护房产绑定。",
  rooms: "统一管理房产档案，房产编号用于住户与设备关联。",
  audit: "查看管理员操作记录，追踪每一次数据维护。",
};
function listPage() {
  const writable = canWrite(route);
  const add =
    writable && ["houses", "content", "rooms"].includes(route)
      ? `<button class="btn primary" id="add">${icon("plus")}新增${{ houses: "房源", content: "内容", rooms: "房产" }[route]}</button>`
      : "";
  $("#workspace").innerHTML =
    head(labels[route], descriptions[route], add) +
    `<section class="panel"><div class="filters"><form class="search-form" id="search"><label class="search-box">${icon("search")}<input name="q" aria-label="搜索" placeholder="${route === "users" ? "搜索姓名、手机号" : "输入关键词搜索"}" value="${esc(query)}"></label>${["houses", "content"].includes(route) ? `<select class="filter-select" name="status" aria-label="筛选状态"><option value="">全部状态</option>${(route === "houses" ? ["在租", "已租", "下架"] : ["true", "false"]).map((v) => `<option value="${v}" ${status === v ? "selected" : ""}>${v === "true" ? "已发布" : v === "false" ? "草稿" : v}</option>`).join("")}</select>` : ""}<button class="btn">搜索</button></form><button class="btn" id="refresh">${icon("refresh")}刷新</button></div>${rows.length ? (route === "houses" ? houseTable(rows) : otherTable()) : empty(query || status ? "没有符合条件的记录" : "暂无记录，可从右上角开始新增")}<div class="pagination"><span>共 ${total} 条记录 · 每页 10 条</span><div class="pages"><button id="prev" aria-label="上一页" ${page === 1 ? "disabled" : ""}>‹</button><span>${page}</span><small>/ ${Math.max(1, Math.ceil(total / 10))}</small><button id="next" aria-label="下一页" ${page * 10 >= total ? "disabled" : ""}>›</button></div></div></section>` +
    footer();
  $("#search").onsubmit = (e) => {
    e.preventDefault();
    const d = new FormData(e.target);
    query = d.get("q");
    status = d.get("status") || "";
    page = 1;
    loadRoute(false);
  };
  $("#refresh").onclick = () => loadRoute(false);
  $("#prev").onclick = () => {
    page--;
    loadRoute(false);
  };
  $("#next").onclick = () => {
    page++;
    loadRoute(false);
  };
  $("#add")?.addEventListener("click", () => edit(route));
  document.querySelectorAll("[data-edit]").forEach(
    (b) =>
      (b.onclick = () =>
        edit(
          route,
          rows.find((r) => r._id === b.dataset.edit),
        )),
  );
  document
    .querySelectorAll("[data-binding]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          binding(rows.find((r) => r._id === b.dataset.binding))),
    );
  document
    .querySelectorAll("[data-preview]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          preview(rows.find((r) => r._id === b.dataset.preview))),
    );
  document
    .querySelectorAll("[data-toggle]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          toggle(rows.find((r) => r._id === b.dataset.toggle))),
    );
}
function otherTable() {
  let headers, render;
  if (route === "content") {
    headers = ["内容标题", "分类", "状态", "排序", "操作"];
    render = (r) =>
      `<td><div class="house-cell">${image(r.image || r.cover)}<div><strong>${esc(r.title)}</strong><small>${esc(typeof r.author === "string" ? r.author : "物业服务中心")}</small></div></div></td><td>${r.type === "share" ? "社区分享" : "房源推荐"}</td><td>${badge(r.enabled)}</td><td>${esc(r.sortOrder)}</td><td><div class="actions"><button data-preview="${esc(r._id)}">预览</button>${canWrite(route) ? `<button data-edit="${esc(r._id)}">编辑</button><button data-toggle="${esc(r._id)}">${r.enabled ? "撤回" : "发布"}</button>` : ""}</div></td>`;
  }
  if (route === "users") {
    headers = ["住户姓名", "手机号", "已绑定房产", "操作"];
    render = (r) =>
      `<td>${esc(r.name || r.nickname || "未设置姓名")}</td><td>${esc(r.phone || "未授权")}</td><td>${r.houses?.length ? esc(r.houses.join("、")) : '<span class="badge amber">待绑定</span>'}</td><td><div class="actions"><button data-edit="${esc(r._id)}">${canWrite(route) ? "编辑姓名" : "查看"}</button><button data-binding="${esc(r._id)}">${canWrite(route) ? "维护绑定" : "查看房产"}</button></div></td>`;
  }
  if (route === "rooms") {
    headers = ["房产名称", "房产编号", "所在小区", "地址", "操作"];
    render = (r) =>
      `<td>${esc(r.name)}</td><td>${esc(r.houseId)}</td><td>${esc(r.community || "—")}</td><td>${esc(r.address || "—")}</td><td><div class="actions"><button data-edit="${esc(r._id)}">${canWrite(route) ? "编辑" : "查看"}</button></div></td>`;
  }
  if (route === "audit") {
    headers = ["操作时间", "操作人", "操作类型", "目标记录"];
    render = (r) =>
      `<td>${date(r.createdAt)}</td><td>${esc(r.actor)}</td><td>${esc(r.action)}</td><td>${esc(r.target)}</td>`;
  }
  return `<div class="table-wrap"><table><thead><tr>${headers.map((t) => `<th>${t}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${render(r)}</tr>`).join("")}</tbody></table></div>`;
}
function openDialog(title, subtitle, content, buttons = "") {
  const d = $("#editor");
  d.innerHTML = `<div class="dialog-head"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><button class="close" data-close aria-label="关闭">×</button></div>${content}${buttons ? `<div class="dialog-footer">${buttons}</div>` : ""}`;
  if (!d.open) d.showModal();
  d.querySelectorAll("[data-close]").forEach(
    (b) => (b.onclick = () => d.close()),
  );
  resolveImages(d);
}
function field(name, label, value = "", options = {}) {
  const attrs = `name="${name}" ${options.required ? "required" : ""} ${options.readonly ? "readonly" : ""}`;
  let input;
  if (options.choices)
    input = `<select ${attrs}>${options.choices.map(([v, t]) => `<option value="${esc(v)}" ${String(value) === String(v) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  else if (options.textarea)
    input = `<textarea ${attrs} maxlength="5000">${esc(value)}</textarea>`;
  else
    input = `<input ${attrs} type="${options.type || "text"}" value="${esc(value)}" ${options.type === "number" ? 'min="0" step="any"' : ""} ${options.type === "password" ? 'autocomplete="new-password" minlength="12" maxlength="128"' : ""}>`;
  return `<label class="field ${options.full ? "full" : ""}">${label}${input}${options.help ? `<small>${esc(options.help)}</small>` : ""}</label>`;
}
async function edit(resource, record) {
  const r = record || {},
    writable = canWrite(resource);
  let fields = "";
  if (resource === "houses")
    fields =
      field("title", "房源标题 *", r.title, { full: true, required: true }) +
      field("community", "小区 *", r.community, { required: true }) +
      field("address", "详细地址", r.address) +
      field("price", "月租金（元）*", r.price ?? 0, {
        type: "number",
        required: true,
      }) +
      field("area", "面积（㎡）*", r.area ?? 1, {
        type: "number",
        required: true,
      }) +
      field("rooms", "户型 *", r.rooms || "2室1厅", { required: true }) +
      field("orientation", "朝向", r.orientation || "南") +
      field("rentType", "租赁方式", r.rentType || "整租", {
        choices: [
          ["整租", "整租"],
          ["合租", "合租"],
        ],
      }) +
      field("status", "展示状态", r.status || "下架", {
        choices: ["下架", "在租", "已租"].map((v) => [v, v]),
      }) +
      field("tags", "标签（用逗号分隔）", (r.tags || []).join("，"), {
        full: true,
      }) +
      field("description", "房源描述", r.description, {
        full: true,
        textarea: true,
      });
  if (resource === "content")
    fields =
      field("title", "内容标题 *", r.title, { full: true, required: true }) +
      field("type", "内容分类", r.type || "share", {
        choices:
          r.type === "house"
            ? [
                ["share", "社区分享（首页）"],
                ["house", "房源推荐（历史内容）"],
              ]
            : [["share", "社区分享（首页）"]],
      }) +
      field("enabled", "发布状态", r.enabled ?? false, {
        choices: [
          ["false", "草稿"],
          ["true", "已发布"],
        ],
      }) +
      field(
        "author",
        "发布人",
        typeof r.author === "string" ? r.author : "物业服务中心",
      ) +
      field("sortOrder", "排序（越小越靠前）", r.sortOrder ?? 0, {
        type: "number",
      }) +
      field("description", "正文", r.description || r.content || r.text || "", {
        full: true,
        textarea: true,
      });
  if (resource === "rooms")
    fields =
      field("name", "房产名称 *", r.name, { full: true, required: true }) +
      field("houseId", "房产编号 *", r.houseId, {
        required: true,
        readonly: Boolean(r._id),
        help: "创建后不可更改，如 ROOM-101",
      }) +
      field("community", "小区", r.community) +
      field("address", "详细地址", r.address, { full: true }) +
      field("sortOrder", "排序", r.sortOrder || 0, { type: "number" });
  if (resource === "users")
    fields =
      field("name", "住户姓名 *", r.name || r.nickname, {
        full: true,
        required: true,
      }) +
      field("phone", "手机号（微信授权）", r.phone || "未授权", {
        full: true,
        readonly: true,
        help: "手机号通过微信授权获得，不能在此直接修改。",
      });
  const picture =
    resource === "houses" ? "cover" : resource === "content" ? "image" : null;
  if (picture)
    fields +=
      `<div class="field full">${resource === "houses" ? "封面图片" : "内容图片"}<div class="upload-box">${image(r[picture] || r.cover, "upload-preview")}<div><input type="file" id="upload" accept="image/png,image/jpeg,image/webp" aria-label="上传图片" ${writable ? "" : "disabled"}><p>支持 JPG / PNG / WebP，最大 5 MB<br>上传后请保存表单，图片才会关联到记录。</p></div></div></div>` +
      field(picture, "图片地址", r[picture] || r.cover || "", {
        full: true,
        help: "支持 HTTPS 图片链接或上传后生成的地址。",
      });
  openDialog(
    `${record ? (writable ? "编辑" : "查看") : "新增"}${labels[resource].replace("管理", "")}`,
    record ? `记录编号：${r._id}` : "填写资料后保存，可随时继续编辑。",
    `<form id="record-form" class="editor-body"><fieldset ${writable ? "" : "disabled"} class="form-fields"><div class="form-grid">${fields}</div></fieldset><div class="form-error" role="alert"></div></form>`,
    `<button class="btn" data-close>取消</button>${writable ? '<button class="btn primary" form="record-form" id="save">保存更改</button>' : ""}`,
  );
  if (picture && writable) {
    $("#upload").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        toast("图片不能超过 5 MB");
        return;
      }
      $("#save").disabled = true;
      try {
        const result = await api("uploads", { method: "POST", raw: file });
        $(`[name="${picture}"]`).value = result.url;
        const img = $(".upload-preview");
        if (img.tagName === "IMG") img.src = URL.createObjectURL(file);
        else
          img.outerHTML = `<img class="upload-preview" src="${URL.createObjectURL(file)}" alt="上传预览">`;
        toast("上传完成，保存后生效");
      } catch (error) {
        if ($("#record-form .form-error"))
          $("#record-form .form-error").textContent = error.message;
        else toast(error.message);
      } finally {
        if ($("#save")) $("#save").disabled = false;
      }
    };
  }
  $("#record-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!writable) return;
    const d = Object.fromEntries(new FormData(e.target));
    for (const k of ["price", "area", "sortOrder"])
      if (k in d) d[k] = Number(d[k]);
    if ("enabled" in d) d.enabled = d.enabled === "true";
    if ("tags" in d)
      d.tags = d.tags
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
    if (resource === "houses") d.images = r.images || [];
    const save = $("#save");
    save.disabled = true;
    try {
      await api(`${resource}${r._id ? "/" + encodeURIComponent(r._id) : ""}`, {
        method: r._id ? "PUT" : "POST",
        data: d,
      });
      $("#editor").close();
      toast("已保存");
      await loadRoute(false);
    } catch (error) {
      if ($("#record-form .form-error"))
        $("#record-form .form-error").textContent = error.message;
      else toast(error.message);
    } finally {
      save.disabled = false;
    }
  };
}
function confirmAction(title, message) {
  return new Promise((resolve) => {
    const d = $("#confirm");
    d.innerHTML = `<h2>${esc(title)}</h2><p>${esc(message)}</p><div class="confirm-actions"><button class="btn" id="confirm-no">取消</button><button class="btn primary" id="confirm-yes">确认操作</button></div>`;
    let yes = false;
    d.onclose = () => resolve(yes);
    $("#confirm-no").onclick = () => d.close();
    $("#confirm-yes").onclick = () => {
      yes = true;
      d.close();
    };
    d.showModal();
  });
}
async function toggle(r) {
  const resource = route;
  const action =
    resource === "houses"
      ? r.status === "在租"
        ? "下架"
        : "上架"
      : r.enabled
        ? "撤回"
        : "发布";
  if (
    !(await confirmAction(
      `确认${action}？`,
      `「${r.title}」的展示状态将更新。${config.mode === "live" ? "这会影响小程序里的真实内容。" : "当前仅修改本地演示数据。"}`,
    ))
  )
    return;
  try {
    const d =
      resource === "houses"
        ? { ...r, status: r.status === "在租" ? "下架" : "在租" }
        : {
            ...r,
            description: r.description || r.content || r.text || "",
            image: r.image || r.cover || "",
            author: typeof r.author === "string" ? r.author : "物业服务中心",
            sortOrder: r.sortOrder || 0,
            enabled: !r.enabled,
          };
    await api(`${resource}/${encodeURIComponent(r._id)}`, {
      method: "PUT",
      data: d,
    });
    toast(`已${action}`);
    await loadRoute(false);
  } catch (e) {
    toast(e.message);
  }
}
function preview(r) {
  openDialog(
    "内容预览",
    "预览用于核对内容，实际排版以小程序为准。",
    `<div class="editor-body"><div class="preview-card">${image(r.image || r.cover, "preview-image")}<h2>${esc(r.title)}</h2><p>${esc(r.description || r.content || r.text || "暂无正文")}</p><small>${esc(typeof r.author === "string" ? r.author : "物业服务中心")}</small></div>${badge(r.enabled)}</div>`,
    '<button class="btn" data-close>关闭预览</button>',
  );
}
async function binding(user) {
  try {
    const all = [];
    for (let p = 1; ; p++) {
      const result = await api(`rooms?page=${p}&pageSize=100`);
      all.push(...result.rows);
      if (all.length >= result.total) break;
    }
    const writable = canWrite("users");
    const houses = user.houses || [];
    openDialog(
      "维护房产绑定",
      `${user.name || user.nickname || "住户"} · ${user.phone || "未授权手机号"}`,
      `<div class="editor-body"><div class="notice">请核实住户与房产关系后再操作。手动维护后，登录时将保留本次绑定，不再自动覆盖为旧业主记录。</div><h3>已绑定房产</h3>${houses.length ? houses.map((id) => `<div class="binding-item"><div><strong>${esc(all.find((r) => r.houseId === id)?.name || id)}</strong><p class="muted">${esc(id)}</p></div>${writable ? `<button class="btn danger" data-unbind="${esc(id)}">解绑</button>` : ""}</div>`).join("") : empty("当前用户尚未绑定房产")}${
        writable
          ? `<form id="bind-form"><br><label class="field">选择新增绑定的房产<select name="houseId" required><option value="">请选择房产</option>${all
              .filter((r) => !houses.includes(r.houseId))
              .map(
                (r) =>
                  `<option value="${esc(r.houseId)}">${esc(r.community)} · ${esc(r.name)} (${esc(r.houseId)})</option>`,
              )
              .join(
                "",
              )}</select></label><br><button class="btn primary" ${all.length ? "" : "disabled"}>确认绑定</button></form>`
          : ""
      }<div class="form-error" role="alert"></div></div>`,
      '<button class="btn" data-close>完成</button>',
    );
    const perform = async (action, houseId) => {
      if (
        !(await confirmAction(
          action === "bind" ? "确认绑定房产？" : "确认解除绑定？",
          `用户：${user.name || user.nickname || user._id}；房产：${houseId}。此操作会改变用户的房产访问关系。`,
        ))
      )
        return;
      const controls = [...$("#editor").querySelectorAll("button")];
      controls.forEach((b) => (b.disabled = true));
      try {
        const result = await api(
          `users/${encodeURIComponent(user._id)}/binding`,
          { method: "POST", data: { action, houseId } },
        );
        toast("房产绑定已更新");
        await binding(result);
        loadRoute(false);
      } catch (e) {
        $("#editor .form-error").textContent = e.message;
      } finally {
        controls.forEach((b) => (b.disabled = false));
      }
    };
    $("#bind-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      perform("bind", new FormData(e.target).get("houseId"));
    });
    document
      .querySelectorAll("[data-unbind]")
      .forEach((b) => (b.onclick = () => perform("unbind", b.dataset.unbind)));
  } catch (e) {
    toast(e.message);
  }
}
function accountsPage(accounts) {
  $("#workspace").innerHTML =
    head(
      "管理员设置",
      "独立管理后台账号，按职责分配权限。",
      `<button class="btn primary" id="add-account">${icon("plus")}新增管理员</button>`,
    ) +
    `<div class="settings-grid">${[
      ["admin", "全部业务管理、房产绑定、管理员账号与日志。"],
      ["editor", "维护房源和社区内容；用户与房产仅可查看。"],
      ["viewer", "只读浏览业务数据，不允许修改或上传。"],
    ]
      .map(
        ([r, t]) =>
          `<div class="role-card">${icon("shield")}<h3>${roleNames[r]}</h3><p>${t}</p></div>`,
      )
      .join(
        "",
      )}</div><section class="panel"><div class="panel-head"><h2>后台账号</h2><small>${accounts.length} 个账号</small></div>${accounts.length ? `<div class="table-wrap"><table><thead><tr><th>姓名</th><th>登录账号</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>${accounts.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.username)}</td><td>${roleNames[a.role]}</td><td>${badge(a.enabled ? "启用" : "停用")}</td><td><button class="link" data-account="${esc(a._id)}" ${a._id === session.account._id ? "disabled" : ""}>${a._id === session.account._id ? "当前账号" : "编辑"}</button></td></tr>`).join("")}</tbody></table></div>` : empty("演示入口不需要账号；可创建账号测试权限。")}</section>` +
    footer();
  $("#add-account").onclick = () => accountEditor();
  document
    .querySelectorAll("[data-account]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          accountEditor(accounts.find((a) => a._id === b.dataset.account))),
    );
}
function accountEditor(a = {}) {
  openDialog(
    a._id ? "编辑后台账号" : "新增后台账号",
    "账号变更后，已有登录会话立即失效。",
    `<form id="account-form" class="editor-body"><div class="form-grid">${
      field("name", "姓名 *", a.name, { required: true }) +
      field("username", "账号 *", a.username, { required: true }) +
      field("role", "角色", a.role || "viewer", {
        choices: Object.entries(roleNames),
      }) +
      field("enabled", "状态", a.enabled ?? true, {
        choices: [
          ["true", "启用"],
          ["false", "停用"],
        ],
      }) +
      field("password", a._id ? "新密码（留空保留原密码）" : "密码 *", "", {
        full: true,
        type: "password",
        required: !a._id,
        help: "12–128 位，建议使用随机生成的独立密码。",
      })
    }</div><div class="form-error" role="alert"></div></form>`,
    '<button class="btn" data-close>取消</button><button class="btn primary" form="account-form">保存账号</button>',
  );
  $("#account-form").onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.enabled = data.enabled === "true";
    data.id = a._id;
    const b = $('[form="account-form"]');
    b.disabled = true;
    try {
      await api("accounts", { method: "POST", data });
      $("#editor").close();
      toast("账号已保存");
      await loadRoute(false);
    } catch (error) {
      if ($("#account-form .form-error"))
        $("#account-form .form-error").textContent = error.message;
      else toast(error.message);
    } finally {
      b.disabled = false;
    }
  };
}
$("#editor").addEventListener("close", () => {
  if (!$("#editor").open) $("#editor").replaceChildren();
});
window.addEventListener("hashchange", () => loadRoute());
try {
  config = await api("config");
  try {
    session = await api("me");
  } catch {}
  if (session) {
    shell();
    await loadRoute();
  } else shellLogin();
} catch (e) {
  $("#app").innerHTML =
    `<div class="initial">${esc(e.message)}<br>请确认后台服务已经启动，再刷新页面。</div>`;
}

function changePassword() {
  openDialog(
    "修改登录密码",
    "修改成功后需要重新登录。",
    `<form id="password-form" class="editor-body"><div class="form-grid">${field("oldPassword", "当前密码", "", { full: true, type: "password", required: true }) + field("newPassword", "新密码", "", { full: true, type: "password", required: true }) + field("confirmPassword", "确认新密码", "", { full: true, type: "password", required: true })}</div><div class="form-error" role="alert"></div></form>`,
    '<button class="btn" data-close>取消</button><button class="btn primary" form="password-form">确认修改</button>',
  );
  $("#password-form").onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    if (data.newPassword !== data.confirmPassword) {
      $("#password-form .form-error").textContent = "两次新密码不一致";
      return;
    }
    const button = $('[form="password-form"]');
    button.disabled = true;
    try {
      await api("password", { method: "POST", data });
      $("#editor").close();
      session = null;
      shellLogin();
      toast("密码已修改，请重新登录");
    } catch (error) {
      if ($("#password-form .form-error"))
        $("#password-form .form-error").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}
