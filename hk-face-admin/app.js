/*
 * HK 人脸门禁管理后台 · 合成数据演示 UI 共享脚本
 * 零依赖、零网络请求、零真实设备 / Provider 调用，file:// 直接打开即可运行。
 * 仅切换本地合成 UI 状态与 fixture，不产生任何业务写入。
 */
(function () {
  "use strict";

  var body = document.body;
  var page = body.getAttribute("data-page") || "index";

  /* 1) 根据 body[data-page] 高亮当前侧边栏入口 */
  var links = document.querySelectorAll(".nav-link[data-nav]");
  for (var i = 0; i < links.length; i++) {
    if (links[i].getAttribute("data-nav") === page) {
      links[i].classList.add("is-active");
      links[i].setAttribute("aria-current", "page");
    }
  }

  /* 2) toast：合适的 role / aria-live + 关闭按钮 + Escape 关闭，驻留至手动关闭 */
  var toast = document.getElementById("toast");
  var toastMsg = document.getElementById("toast-msg");
  var toastClose = document.getElementById("toast-close");
  function showToast(text, kind) {
    if (!toast || !toastMsg) return;
    toastMsg.textContent = text;
    toast.setAttribute("data-kind", kind || "info");
    toast.removeAttribute("hidden");
  }
  function hideToast() {
    if (toast) toast.setAttribute("hidden", "");
  }
  if (toastClose) toastClose.addEventListener("click", hideToast);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" || e.key === "Esc") hideToast();
  });

  /* 3) 文本转义：所有插入 innerHTML 的合成值 / 表头统一转义 */
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function th(t) { return '<th scope="col">' + esc(t) + "</th>"; }
  function cellText(v) { return "<td>" + esc(v) + "</td>"; }
  function cellCode(v) { return "<td><code>" + esc(v) + "</code></td>"; }
  function cellBadge(v, cls) {
    return '<td><span class="badge ' + esc(cls) + '">' + esc(v) + "</span></td>";
  }
  function kv(k, v) { return '<div class="kv"><b>' + esc(k) + "</b>" + esc(v) + "</div>"; }
  function statGrid(items) {
    return '<div class="stat-grid">' + items.map(function (it) {
      return '<div class="stat-card"><div class="stat-label">' + esc(it.label) + "</div>"
        + '<div class="stat-value">' + esc(it.value) + "</div>"
        + '<div class="stat-hint">' + esc(it.hint) + "</div></div>";
    }).join("") + "</div>";
  }
  function opLog() {
    return '<div class="op-log"><strong>本地操作记录（仅演示，不写入任何真实系统）</strong>'
      + '<ul id="op-log-list" data-empty="1"><li>暂无本地演示操作。</li></ul></div>';
  }
  function panelHead(title) {
    return '<section class="panel"><div class="panel-head"><h2>' + esc(title)
      + '</h2><a class="back-link" href="index.html">返回概览</a></div>';
  }

  /* 4) 合成 fixture：全部为 DEMO 前缀虚构值，无真实标识 / 无图片字节 / 无外链 */
  var FIXTURES = {
    devices: [
      { id: "DEV-DEMO-001", model: "MODEL-DEMO-A1", fw: "FW-DEMO-2.4.0",
        capability: "capability=face.grant / 就绪", grey: "灰度 canary-10%",
        prov: "mock / test / simulated", online: "在线（模拟）", heartbeat: "2026-11-07 09:12（模拟）" },
      { id: "DEV-DEMO-002", model: "MODEL-DEMO-B2", fw: "FW-DEMO-2.3.7",
        capability: "capability=face.sync / 降级", grey: "灰度 全量-100%",
        prov: "mock / test / simulated", online: "离线（模拟）", heartbeat: "2026-11-07 08:40（模拟）" },
      { id: "DEV-DEMO-003", model: "MODEL-DEMO-A1", fw: "FW-DEMO-2.5.0-rc",
        capability: "capability=face.grant / 待激活", grey: "灰度 canary-0%",
        prov: "mock / test / simulated", online: "待激活（模拟）", heartbeat: "—（模拟）" }
    ],
    applications: [
      { id: "APP-DEMO-0001", person: "PERSON-DEMO-001", room: "ROOM-DEMO-A-101",
        stay: "2026-11-01 ~ 2026-11-30（演示）", device: "DEV-DEMO-001",
        grant: "2026-11-01 00:00 ~ 2026-11-30 23:59（演示）",
        status: "待审批（合成）", consent: "同意记录：已签署（合成）" },
      { id: "APP-DEMO-0002", person: "PERSON-DEMO-002", room: "ROOM-DEMO-B-205",
        stay: "2026-11-10 ~ 2026-12-10（演示）", device: "DEV-DEMO-002",
        grant: "2026-11-10 00:00 ~ 2026-12-10 23:59（演示）",
        status: "已补件（合成）", consent: "同意记录：已签署（合成）" }
    ],
    tasks: [
      { job: "JOB-DEMO-0001", action: "grant.face", state: "succeeded",
        result: "SUCCEEDED", attempts: "1", failure: "—（合成）",
        lastSuccess: "2026-11-07 09:05（模拟）", env: "test / mock / simulated",
        retryable: false, unknown: false },
      { job: "JOB-DEMO-0002", action: "sync.face", state: "awaiting_result",
        result: "UNKNOWN_RESULT", attempts: "2", failure: "上游结果未确认（脱敏合成文本）",
        lastSuccess: "2026-11-06 18:40（模拟）", env: "test / mock / simulated",
        retryable: false, unknown: true },
      { job: "JOB-DEMO-0003", action: "revoke.grant", state: "retryable_failed",
        result: "RETRYABLE", attempts: "3", failure: "临时冲突（脱敏合成文本）",
        lastSuccess: "2026-11-06 17:20（模拟）", env: "test / mock / simulated",
        retryable: true, unknown: false }
    ],
    audits: [
      { time: "2026-11-07 09:10（模拟）", type: "批准", subject: "OPER-DEMO-01",
        result: "通过（合成）", reason: "资料齐全，符合演示口径（合成）", target: "APP-DEMO-0001" },
      { time: "2026-11-07 09:02（模拟）", type: "拒绝", subject: "OPER-DEMO-02",
        result: "驳回（合成）", reason: "授权周期超出演示范围（合成）", target: "APP-DEMO-0002" },
      { time: "2026-11-07 08:55（模拟）", type: "查看原图申请", subject: "OPER-DEMO-01",
        result: "需逐次授权（合成）", reason: "逐次授权演示，本演示不加载任何字节（合成）", target: "APP-DEMO-0001" },
      { time: "2026-11-07 08:40（模拟）", type: "重试", subject: "OPER-DEMO-03",
        result: "受控重试已记录（合成）", reason: "具备重试权限的 retryable 任务演示（合成）", target: "JOB-DEMO-0003" },
      { time: "2026-11-07 08:20（模拟）", type: "撤销", subject: "OPER-DEMO-02",
        result: "已撤销（合成）", reason: "申请人撤回演示记录（合成）", target: "APP-DEMO-0002" },
      { time: "2026-11-07 08:05（模拟）", type: "人工对账", subject: "OPER-DEMO-03",
        result: "结果待确认（合成）", reason: "未知结果先查询 / 人工对账，不自动重试（合成）", target: "JOB-DEMO-0002" }
    ]
  };
  var PERM_NOTE = {
    devices: "device.manage",
    applications: "device.face.review",
    tasks: "device.operation.retry",
    audits: "device.audit.read"
  };
  var STATES = ["ready", "loading", "empty", "forbidden", "error", "retrying"];

  /* 5) 六类状态面板：结构各异，肉眼可辨，均为本地合成、不发网络请求 */
  function renderLoading() {
    var rows = "";
    for (var i = 0; i < 5; i++) {
      rows += '<div class="skel-row"><span class="skel skel-w1"></span>'
        + '<span class="skel skel-w2"></span><span class="skel skel-w3"></span>'
        + '<span class="skel skel-w4"></span></div>';
    }
    return '<section class="state-view state-loading" aria-busy="true">'
      + '<p class="state-title">loading · 正在加载合成数据（演示）</p>'
      + '<div class="stat-skeleton"><span class="skel"></span><span class="skel"></span>'
      + '<span class="skel"></span><span class="skel"></span></div>' + rows
      + '<p class="state-note">骨架屏为本地合成状态，不发送任何网络请求。</p></section>';
  }
  function renderEmpty() {
    return '<section class="state-view state-empty"><div class="big">○</div>'
      + '<strong>empty · 暂无合成数据</strong>'
      + '<p class="state-note">当前合成 fixture 为空；可切回 ready 查看合成记录。本状态不发网络请求。</p>'
      + '<p class="state-note"><a class="back-link" href="index.html">返回概览</a></p></section>';
  }
  function renderForbidden(p) {
    var perm = PERM_NOTE[p] || "device.manage";
    return '<section class="state-view state-forbidden">'
      + '<span class="lock">无权限 · FORBIDDEN</span>'
      + '<p class="state-title">缺少权限：<code>' + esc(perm) + '</code></p>'
      + '<p class="state-note">本演示未实现真实权限体系；此状态表示缺少上述权限点时，相关读取 / 操作不可用。'
      + '审核权限不自动获得私密读取权限，重试权限不自动获得对账权限。</p>'
      + '<p class="state-note"><a class="back-link" href="index.html">返回概览</a></p></section>';
  }
  function renderError() {
    return '<section class="state-view state-error"><span class="err-code">TERMINAL（合成）</span>'
      + '<p class="state-title">error · 合成加载失败</p>'
      + '<p class="state-note">错误分类为脱敏合成枚举（RETRYABLE / TERMINAL / NOT_CONFIGURED / CONFLICT / DENIED / UNKNOWN_RESULT），'
      + '不暴露厂商原始响应或设备地址。此错误态不提供自动重试；如需复核请切到 ready 使用「查询 / 人工对账」。</p>'
      + '<p class="state-note">'
      + '<button class="btn btn-ctrl" data-toast="人工对账（演示占位）">人工对账（演示）</button> '
      + '<a class="back-link" href="index.html">返回概览</a></p></section>';
  }
  function renderRetrying() {
    return '<section class="state-view state-retrying">'
      + '<p class="state-title">retrying · 受控重试中（演示）</p>'
      + '<div class="progress"><span></span></div>'
      + '<p class="state-note">attempts 计数（演示）：2 → 3；仅受控重试，系统自动重试已关闭（冻结契约）。'
      + '未知结果不进入本状态，必须先查询 / 人工对账。</p>'
      + '<p class="state-note"><a class="back-link" href="index.html">返回概览</a></p></section>';
  }

  /* 6) ready 态：各页合成详情 */
  function readyDevices() {
    var rows = FIXTURES.devices.map(function (d) {
      return "<tr>" + cellCode(d.id) + cellText(d.model) + cellCode(d.fw)
        + cellText(d.capability) + cellText(d.grey) + cellCode(d.prov)
        + cellText(d.online) + cellText(d.heartbeat) + "</tr>";
    }).join("");
    return statGrid([
        { label: "设备总数（合成）", value: "3", hint: "DEMO 前缀虚构记录" },
        { label: "在线设备（合成）", value: "1", hint: "模拟在线状态" },
        { label: "离线设备（合成）", value: "1", hint: "模拟离线状态" },
        { label: "待激活（合成）", value: "1", hint: "模拟灰度未放量" }
      ])
      + panelHead("设备列表（合成）")
      + '<div class="rule-note">全部为明显虚构合成记录：DEV-DEMO / FW-DEMO 前缀；'
      + 'provider=mock、executionMode=test、evidenceScope=simulated；真实设备生效：否。</div>'
      + '<div class="table-wrap" tabindex="0" role="region" aria-label="合成设备列表，可横向滚动">'
      + '<table><caption class="sr-only">合成设备演示记录</caption><thead><tr>'
      + th("设备编号（脱敏）") + th("型号") + th("固件版本")
      + th("capability 状态") + th("灰度状态")
      + th("provider / executionMode / evidenceScope") + th("在线状态") + th("最近心跳")
      + "</tr></thead><tbody>" + rows + "</tbody></table></div>"
      + '<p class="muted">以上字段不含任何真实硬件标识、网络地址、登录口令或私密材料；'
      + '「新增设备 / 同步状态 / 导出清单」均为演示占位，不产生任何真实写入。</p></section>';
  }

  function readyApplications() {
    var a = FIXTURES.applications[0];
    return statGrid([
        { label: "待审批（合成）", value: "1", hint: "DEMO 申请记录" },
        { label: "已通过（合成）", value: "0", hint: "模拟累计" },
        { label: "已驳回（合成）", value: "0", hint: "模拟累计" },
        { label: "本月新增（合成）", value: "2", hint: "按演示口径统计" }
      ])
      + panelHead("申请详情（合成）· APP-DEMO-0001")
      + '<div class="rule-note">审核权限（<code>device.face.review</code>）不自动获得私密读取权限'
      + '（<code>device.face.readPrivate</code>）；两者独立授予、逐次授权。</div>'
      + '<div class="detail-grid">'
      + kv("人员代号", a.person) + kv("房间代号", a.room)
      + kv("入住周期", a.stay) + kv("目标设备", a.device)
      + kv("授权起止时间", a.grant) + kv("审核状态", a.status)
      + kv("同意记录", a.consent) + kv("申请单号", a.id)
      + "</div>"
      + '<div class="private-box"><strong>需逐次授权查看（演示占位）</strong>'
      + '私密内容区域：本演示不加载任何图片、外链或字节，不实现真实文件读取或下载；'
      + '即使勾选 readPrivate 演示开关，也仅显示本占位。</div>'
      + '<div class="review-bar">'
      + '<div class="field"><label for="review-reason">操作理由（必填，仅本地演示）</label>'
      + '<textarea id="review-reason" rows="2" placeholder="请输入本次审核 / 拒绝 / 撤销 / 补件的理由"></textarea></div>'
      + '<button class="btn btn-primary" data-action="review" data-kind="approve">审核通过（本地演示）</button>'
      + '<button class="btn" data-action="review" data-kind="reject">拒绝（本地演示）</button>'
      + '<button class="btn" data-action="review" data-kind="revoke">撤销（本地演示）</button>'
      + '<button class="btn" data-action="review" data-kind="supplement">补件（本地演示）</button>'
      + "</div>"
      + '<div class="inline-error" id="review-error" role="alert" aria-live="assertive"></div>'
      + '<div class="perm-line">'
      + '<label><input type="checkbox" id="perm-review" checked /> 演示：具备 '
      + '<code>device.face.review</code>（取消后显示 forbidden 状态）</label>'
      + '<label><input type="checkbox" id="perm-private" /> 演示：具备 '
      + '<code>device.face.readPrivate</code>（与审核权限独立，勾选仍不加载任何字节）</label>'
      + "</div>"
      + opLog() + "</section>";
  }

  function readyTasks() {
    var rows = FIXTURES.tasks.map(function (t) {
      var stateBadge = t.unknown
        ? '<span class="badge badge-unknown">awaiting_result · UNKNOWN_RESULT</span>'
        : (t.retryable
            ? '<span class="badge badge-retry">retryable_failed · RETRYABLE</span>'
            : '<span class="badge badge-ok">succeeded · SUCCEEDED</span>');
      var ops;
      if (t.unknown) {
        ops = '<button class="btn btn-ctrl" data-action="query" data-job="' + esc(t.job) + '">查询（演示）</button> '
            + '<button class="btn btn-ctrl" data-action="reconcile" data-job="' + esc(t.job) + '">人工对账（演示）</button>';
      } else if (t.retryable) {
        ops = '<button class="btn btn-ctrl" data-action="query" data-job="' + esc(t.job) + '">查询（演示）</button> '
            + '<button class="btn" data-action="retry" data-job="' + esc(t.job) + '">受控重试（演示）</button>';
      } else {
        ops = '<button class="btn btn-ctrl" data-action="query" data-job="' + esc(t.job) + '">查询（演示）</button>';
      }
      return "<tr>" + cellCode(t.job) + cellText(t.action + " / " + t.state)
        + "<td>" + stateBadge + "</td>" + cellText(t.attempts)
        + cellText(t.failure) + cellText(t.lastSuccess) + cellCode(t.env)
        + '<td class="col-op">' + ops + "</td></tr>";
    }).join("");
    return statGrid([
        { label: "执行中（合成）", value: "1", hint: "模拟排队下发" },
        { label: "等待中（合成）", value: "0", hint: "模拟队列" },
        { label: "成功（合成）", value: "1", hint: "今日模拟累计" },
        { label: "未知结果 / 待对账（合成）", value: "1", hint: "UNKNOWN_RESULT · 仅查询 / 人工对账" }
      ])
      + panelHead("任务列表（合成）")
      + '<div class="rule-note">冻结契约：系统自动重试已关闭；未知结果（awaiting_result / UNKNOWN_RESULT）'
      + '只允许「查询 / 人工对账」，不提供重复下发；受控重试仅在 retryable 状态展示，并需具备 '
      + '<code>device.operation.retry</code>。</div>'
      + '<div class="perm-line">'
      + '<label><input type="checkbox" id="perm-retry" checked /> 演示：具备 '
      + '<code>device.operation.retry</code>（取消后受控重试不可用并说明缺少权限）</label>'
      + '<div class="state-note" id="retry-perm-hint">已具备 device.operation.retry：受控重试按钮可用（仅本地演示）。</div>'
      + "</div>"
      + '<div class="table-wrap" tabindex="0" role="region" aria-label="合成任务列表，可横向滚动">'
      + '<table><caption class="sr-only">合成任务演示记录</caption><thead><tr>'
      + th("jobId（合成）") + th("action / state") + th("结果")
      + th("attempts") + th("failureReason（脱敏合成）") + th("lastSuccessAt")
      + th("executionMode / provider / evidenceScope") + th("操作")
      + "</tr></thead><tbody>" + rows + "</tbody></table></div>"
      + opLog() + "</section>";
  }

  function readyAudits() {
    var rows = FIXTURES.audits.map(function (e) {
      var badge = (e.result.indexOf("通过") >= 0 || e.result.indexOf("已撤销") >= 0)
        ? "badge-ok" : (e.result.indexOf("驳回") >= 0 ? "badge-warn" : "");
      return "<tr>" + cellText(e.time) + cellText(e.type) + cellCode(e.subject)
        + cellBadge(e.result, badge) + cellText(e.reason) + cellCode(e.target)
        + '<td class="col-op"><button class="btn btn-ctrl" data-action="query" data-job="'
        + esc(e.target) + '">查询（演示）</button></td></tr>';
    }).join("");
    return statGrid([
        { label: "今日通行（合成）", value: "0", hint: "演示空口径" },
        { label: "今日告警（合成）", value: "0", hint: "演示空口径" },
        { label: "管理操作（合成）", value: "6", hint: "合成事件条数" },
        { label: "日志保留（合成）", value: "—", hint: "演示，不代表留存策略" }
      ])
      + panelHead("审计记录（合成）")
      + '<div class="rule-note">本页事件均为合成演示：带理由与结果，不写入任何真实或不可变存储；'
      + '列表仅保留已冻结的展示字段，不预置任何未冻结展示位。</div>'
      + '<div class="table-wrap" tabindex="0" role="region" aria-label="合成审计记录，可横向滚动">'
      + '<table><caption class="sr-only">合成审计演示事件</caption><thead><tr>'
      + th("发生时间") + th("事件类型") + th("主体代号")
      + th("结果") + th("理由（合成）") + th("关联对象（合成）") + th("操作")
      + "</tr></thead><tbody>" + rows + "</tbody></table></div>"
      + '<p class="muted">列表仅保留已冻结的展示字段；「查看原图申请」仅为合成事件类型名，'
      + '本演示不加载任何图片、外链或字节。</p></section>';
  }

  function renderReady(p) {
    if (p === "devices") return readyDevices();
    if (p === "applications") return readyApplications();
    if (p === "tasks") return readyTasks();
    if (p === "audits") return readyAudits();
    return "";
  }

  /* 7) 本地演示交互：只更新本地状态 / 本地操作记录，不发网络请求、不写真实系统 */
  function appendLog(text) {
    var ul = document.getElementById("op-log-list");
    if (!ul) return;
    if (ul.getAttribute("data-empty") === "1") {
      ul.innerHTML = "";
      ul.removeAttribute("data-empty");
    }
    var li = document.createElement("li");
    var stamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    li.textContent = "[" + stamp + "] " + text;
    ul.appendChild(li);
  }
  function handleAction(el) {
    var action = el.getAttribute("data-action");
    var job = el.getAttribute("data-job") || "";
    if (action === "review") {
      var reason = document.getElementById("review-reason");
      var err = document.getElementById("review-error");
      var val = reason ? reason.value.trim() : "";
      if (!val) {
        if (err) err.textContent = "请先填写操作理由；理由为空时不执行任何本地演示操作。";
        showToast("理由为空，未执行（本地演示）。", "warn");
        return;
      }
      if (err) err.textContent = "";
      var labels = { approve: "审核通过", reject: "拒绝", revoke: "撤销", supplement: "补件" };
      var label = labels[el.getAttribute("data-kind")] || "操作";
      appendLog(label + "：理由「" + val + "」（仅本地演示状态，未写入任何真实系统）");
      if (reason) reason.value = "";
      showToast("已记录本地演示「" + label + "」，不发网络请求、不写入真实系统。", "info");
      return;
    }
    if (action === "query") {
      appendLog("查询 " + job + "：返回合成结果（本地演示）。");
      showToast("查询（演示）：" + job + " 仅返回合成状态，未访问真实设备或接口。", "info");
      return;
    }
    if (action === "reconcile") {
      appendLog("人工对账 " + job + "：结果待确认，先查询 / 人工对账，不自动重试（本地演示）。");
      showToast("人工对账（演示）：" + job + " 结果待确认，不执行自动重试。", "info");
      return;
    }
    if (action === "retry") {
      var perm = document.getElementById("perm-retry");
      if (!perm || !perm.checked) {
        showToast("缺少 device.operation.retry 权限，受控重试不可用（演示）。", "warn");
        return;
      }
      appendLog("受控重试 " + job + "：attempts +1（仅本地演示状态，不下发真实指令）。");
      showToast("受控重试（演示）：" + job + " 仅更新本地状态，不下发任何真实设备指令。", "info");
      return;
    }
  }
  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== "function") return;
    var toastEl = target.closest("[data-toast]");
    if (toastEl) {
      event.preventDefault();
      showToast("演示占位（无副作用）：" + (toastEl.getAttribute("data-toast") || "该操作")
        + " · 仅本地提示，不产生任何写入。", "info");
      return;
    }
    var actionEl = target.closest("[data-action]");
    if (actionEl) {
      event.preventDefault();
      if (actionEl.disabled) return;
      handleAction(actionEl);
    }
  });
  document.addEventListener("change", function (event) {
    var t = event.target;
    if (!t || !t.id) return;
    if (t.id === "perm-review") {
      applyState(t.checked ? "ready" : "forbidden");
      return;
    }
    if (t.id === "perm-retry") {
      var btns = document.querySelectorAll('[data-action="retry"]');
      for (var i = 0; i < btns.length; i++) {
        btns[i].disabled = !t.checked;
        btns[i].title = t.checked ? "" : "缺少 device.operation.retry 权限，不可操作";
      }
      var hint = document.getElementById("retry-perm-hint");
      if (hint) hint.textContent = t.checked
        ? "已具备 device.operation.retry：受控重试按钮可用（仅本地演示）。"
        : "缺少 device.operation.retry：受控重试按钮已禁用，不可操作。";
      showToast(t.checked ? "已授予演示重试权限。" : "缺少 device.operation.retry 权限，受控重试不可用。",
        t.checked ? "info" : "warn");
      return;
    }
    if (t.id === "perm-private") {
      showToast("readPrivate 与审核权限独立；本演示始终不加载任何图片、外链或字节。", "info");
      return;
    }
  });

  /* 8) 六态驱动：刷新强制恢复默认 ready，不读取任何持久状态、不发网络请求 */
  var stateSelect = document.querySelector("[data-state-select]");
  var stateRoot = document.querySelector("[data-state-root]");
  function applyState(state) {
    if (STATES.indexOf(state) === -1) state = "ready";
    body.setAttribute("data-ui-state", state);
    if (stateSelect) stateSelect.value = state;
    if (!stateRoot) return;
    var html;
    switch (state) {
      case "loading": html = renderLoading(); break;
      case "empty": html = renderEmpty(); break;
      case "forbidden": html = renderForbidden(page); break;
      case "error": html = renderError(); break;
      case "retrying": html = renderRetrying(); break;
      default: html = renderReady(page);
    }
    stateRoot.innerHTML = html;
  }
  if (stateSelect) {
    stateSelect.addEventListener("change", function () { applyState(stateSelect.value); });
  }
  if (stateRoot) applyState("ready");
})();
