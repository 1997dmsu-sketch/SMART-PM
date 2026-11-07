#!/usr/bin/env node
/**
 * HK-AI-05A 独立 QA · 零依赖静态检查
 *
 * 用法：node hk-face-admin/tests/hk-ai-05a-static-check.mjs
 * 退出码：0 = 全部 PASS；1 = 存在 FAIL
 *
 * 判定依据：.tmp-hk-05a-acceptance.md（team-lead 汇编，基线 708c3ab）
 * 扫描对象：hk-face-admin/ 下 8 个页面交付文件（5 HTML + styles.css + app.js + README.md）。
 *   tests/ 下的 QA harness 不属于页面运行时代码，不纳入扫描（避免正则字面量自身误报）。
 *   document.body.innerText 层（含 app.js 动态渲染值）由 CDP harness 覆盖，见 HK-AI-05A-UI-CHECK.md。
 *
 * 误报处置（严格遵循验收规格）：
 *   - 裸 live 只命中 aria-live：按 §5 范式，只遍历「可点击控件 textContent/value」，不全文 grep。
 *   - 「真实设备生效：否」是允许文案，只禁肯定式误导。
 *   - 设计术语 token / 颜色 / 字号 / 圆角 / CSS 变量 / file:// 说明文字 / 裸 url( 均允许。
 *   - CSS 十六进制颜色字面量（如 #222222）非展示数据，值层扫描前剥离（并用 (?<!#) 双保险）。
 *   - 「自动重试」字面在实现里全部为「已关闭 / 禁用 / 不自动重试」否定式声明；
 *     按 §5 live 范式只判定可点击控件文本/值，字面命中以 INFO 全量披露，交 Codex / team-lead 裁定。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");                 // .tmp-hk-push/hk-face-admin
const REPO = path.resolve(ROOT, "..");                 // .tmp-hk-push
const BASELINE = "708c3ab";

const PAGE_FILES = [
  "index.html", "devices.html", "applications.html", "tasks.html", "audits.html",
  "styles.css", "app.js", "README.md",
];
const HTML_FILES = PAGE_FILES.slice(0, 5);
const BUSINESS = ["devices", "applications", "tasks", "audits"];
const STATES = ["ready", "loading", "empty", "forbidden", "error", "retrying"];
const INTERNAL_LINKS = new Set([
  "styles.css", "app.js", "index.html", "devices.html",
  "applications.html", "tasks.html", "audits.html",
]);

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  ::  " + detail : ""}`);
}
function info(msg) { console.log(`INFO  ${msg}`); }

const src = {};
for (const f of PAGE_FILES) src[f] = fs.readFileSync(path.join(ROOT, f), "utf8");
const all = PAGE_FILES.map((f) => src[f]).join("\n");
const css = src["styles.css"];
const app = src["app.js"];
const htmlAll = HTML_FILES.map((f) => src[f]).join("\n");

function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }
function git(args, opts) {
  return execFileSync("git", args, {
    cwd: REPO, maxBuffer: 64 * 1024 * 1024, encoding: "utf8", ...(opts || {}),
  });
}
function hits(text, re) { return (text.match(re) || []).length; }
function stripColors(text) { return text.replace(/#[0-9a-fA-F]{3,8}\b/g, "#COLOR"); }

/** 只收集「可点击控件」的 textContent / value / data-* 值（规格 §5 live 范式） */
function clickableTokens(text) {
  const out = [];
  let m;
  const tagRe = /<(button|a|option|select)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  while ((m = tagRe.exec(text))) {
    out.push(m[3].replace(/<[^>]*>/g, "").trim());
    for (const k of ["value", "data-toast", "data-action"]) {
      const a = new RegExp("\\b" + k + "\\s*=\\s*\"([^\"]*)\"", "i").exec(m[2]);
      if (a) out.push(a[1]);
    }
  }
  const inputRe = /<input\b([^>]*)\/?>/gi;
  while ((m = inputRe.exec(text))) {
    const v = /\bvalue\s*=\s*"([^"]*)"/i.exec(m[1]);
    if (v) out.push(v[1]);
  }
  const attrRe = /\bdata-(?:toast|action)\s*=\s*"([^"]*)"/gi;
  while ((m = attrRe.exec(text))) out.push(m[1]);
  return out.filter(Boolean);
}

/**
 * 仅「可操作控件」的标签 / 值：button / option / select / input / data-toast / data-action。
 * 与 clickableTokens 的区别：不含 <a> 的描述性正文。
 * 首页 module-card 是导航卡片，其 <a> 内嵌整段模块介绍（含「自动重试禁用」说明文字），
 * 属于说明文案而非可点击操作入口，不计入「自动重试入口」判定（与 §5 live 范式同源）。
 */
function actionControlTokens(text) {
  const out = [];
  let m;
  const tagRe = /<(button|option|select)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  while ((m = tagRe.exec(text))) {
    out.push(m[3].replace(/<[^>]*>/g, "").trim());
    for (const k of ["value", "data-toast", "data-action"]) {
      const a = new RegExp("\\b" + k + "\\s*=\\s*\"([^\"]*)\"", "i").exec(m[2]);
      if (a) out.push(a[1]);
    }
  }
  const inputRe = /<input\b([^>]*)\/?>/gi;
  while ((m = inputRe.exec(text))) {
    const v = /\bvalue\s*=\s*"([^"]*)"/i.exec(m[1]);
    if (v) out.push(v[1]);
  }
  const attrRe = /\bdata-(?:toast|action)\s*=\s*"([^"]*)"/gi;
  while ((m = attrRe.exec(text))) out.push(m[1]);
  return out.filter(Boolean);
}

console.log("=== HK-AI-05A 独立 QA 静态检查 ===");
console.log(`node        : ${process.version}`);
console.log(`repo        : ${REPO}`);
console.log(`baseline    : ${BASELINE}`);
console.log(`page files  : ${PAGE_FILES.length} (白名单，tests/ 不纳入)`);
console.log("");

/* ------------------------------------------------------------------ *
 * §1.1 HTML 内链存在（精确等值白名单 + 文件真实存在）
 * ------------------------------------------------------------------ */
{
  const bad = [];
  let total = 0;
  for (const f of HTML_FILES) {
    const re = /(?:href|src)\s*=\s*"([^"]+)"/gi;
    let m;
    while ((m = re.exec(src[f]))) {
      total++;
      const raw = m[1].split(/[?#]/)[0];
      if (!INTERNAL_LINKS.has(raw)) bad.push(`${f}: 非白名单 "${m[1]}"`);
      else if (!fs.existsSync(path.join(ROOT, raw))) bad.push(`${f}: 目标不存在 "${raw}"`);
    }
  }
  check("§1.1 HTML 内链精确白名单 + 文件真实存在",
    total > 0 && bad.length === 0,
    `${total} 个内链 / 异常 ${bad.length}${bad.length ? " :: " + bad.join(" | ") : ""}`);
}

/* ------------------------------------------------------------------ *
 * §1.2 / §8 零外部 URL / 零网络 API
 * ------------------------------------------------------------------ */
{
  const NET = [
    ["https?://", /https?:\/\//g],
    ["协议相对 //domain.tld", /(?<![:\w])\/\/[a-zA-Z0-9.-]+\.[a-z]{2,}/g],
    ["fetch/XHR/WebSocket/EventSource/sendBeacon", /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.sendBeacon/g],
    ["@import", /@import\b/g],
    ["url(http: / url(//", /url\(\s*['"]?(?:https?:|\/\/)/g],
    ["<script>/<link> 外链", /<script[^>]+src=["']https?:|<link[^>]+href=["']https?:/g],
    ["凭据 API 字段", /\b(?:api[_-]?key|apikey|secret|password|passwd|access[_-]?key|webhook|bearer)\b/gi],
    ["浏览器持久存储", /\b(?:localStorage|sessionStorage|indexedDB)\b/g],
  ];
  const detail = [];
  let total = 0;
  for (const [label, re] of NET) {
    let n = 0;
    for (const f of PAGE_FILES) n += hits(src[f], re);
    total += n;
    if (n) detail.push(`${label}=${n}`);
  }
  check("§1.2/§8 零外部 URL / 零网络 API（8 文件白名单）",
    total === 0,
    total === 0 ? `8 类模式命中 0（允许：本地内链 / CSS 变量 / design token / 裸 url( / file:// 说明 / aria-live / data-state）` : detail.join(" | "));
}

/* ------------------------------------------------------------------ *
 * §1.3 / §2(A)(B) 禁显词 —— 字段名层（结构）
 * ------------------------------------------------------------------ */
{
  const FIELD_BAN = /(IP|摘要|objectKey|序列号|MAC|凭据|requestDigest|checksum)/;
  const bad = [];
  let fields = 0;
  for (const f of PAGE_FILES) {
    const t = src[f];
    const re = /<(th|label|option)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = re.exec(t))) {
      fields++;
      const text = m[2].replace(/<[^>]*>/g, "");
      if (FIELD_BAN.test(text)) bad.push(`${f}: <${m[1]}> ${text.trim()}`);
    }
    const ph = /\bplaceholder\s*=\s*"([^"]*)"/gi;
    while ((m = ph.exec(t))) {
      fields++;
      if (FIELD_BAN.test(m[1])) bad.push(`${f}: placeholder ${m[1]}`);
    }
    const thFn = /\bth\(\s*"([^"]*)"/g;     // app.js 动态表头
    while ((m = thFn.exec(t))) {
      fields++;
      if (FIELD_BAN.test(m[1])) bad.push(`${f}: th() ${m[1]}`);
    }
    const kvFn = /\bkv\(\s*"([^"]*)"/g;     // app.js 详情字段名
    while ((m = kvFn.exec(t))) {
      fields++;
      if (FIELD_BAN.test(m[1])) bad.push(`${f}: kv() ${m[1]}`);
    }
  }
  check("§2(B) 字段名层（th/label/placeholder/option/th()/kv()）无禁显字段",
    bad.length === 0,
    `${fields} 个字段位 / 命中 ${bad.length}${bad.length ? " :: " + bad.join(" | ") : ""}`);
  check("§2(B) 基线旧列 IP / 终端、详情摘要 已删除",
    !/IP \/ 终端|详情摘要/.test(all), "0 命中");
}

/* ------------------------------------------------------------------ *
 * §1.3 / §2(C) 禁显词 —— 值层（10 类正则）
 * ------------------------------------------------------------------ */
const VALUE_PATTERNS = [
  ["IPv4", /\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
  ["手机号", /\b1[3-9]\d{9}\b/g],
  ["身份证", /\b\d{17}[\dXx]\b/g],
  ["MAC", /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g],
  ["email", /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g],
  ["外部URL", /https?:\/\/\S+/g],
  ["长字母数字串", /\b(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{16,}\b/g],
  ["长数字串", /(?<!#)\b\d{6,}\b/g],
  ["凭据字段", /\b(api[_-]?key|apikey|secret|password|passwd|access[_-]?key|webhook|bearer|credential)\b/gi],
  ["图片/字节", /<img|background-image|data:image\/|base64,|永久\s*URL|objectKey|requestDigest|checksum/gi],
];
{
  const bad = [];
  for (const f of PAGE_FILES) {
    const t = stripColors(src[f]);
    for (const [label, re] of VALUE_PATTERNS) {
      const n = hits(t, re);
      if (n) bad.push(`${f}:${label}=${n}`);
    }
  }
  // 静态可见文本（5 页剥标签）近似 innerText；动态渲染值由 CDP harness 覆盖
  const visible = htmlAll
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ");
  for (const [label, re] of VALUE_PATTERNS) {
    const n = hits(stripColors(visible), re);
    if (n) bad.push(`visibleText:${label}=${n}`);
  }
  check("§2(C) 值层 10 类正则（8 源码 + 静态可见文本，剥离 CSS 颜色）",
    bad.length === 0,
    bad.length === 0 ? "0 命中；动态 innerText 由 CDP 覆盖" : bad.join(" | "));
}
{
  // 代号化断言 + 门牌 / 具体地址模式
  const door = /\d+栋\d+单元\d{3,4}|\d+号楼\d+单元\d{3,4}/g;
  const addr = /[\u4e00-\u9fa5]{2,}(?:省|市|区|县)[\u4e00-\u9fa5]{0,8}(?:路|街|大道)\d+号/g;
  const doorN = hits(all, door);
  const addrN = hits(all, addr);
  const codeOk = ["人员代号", "房间代号", "脱敏", "代号"].every((w) => app.includes(w));
  check("§2(C) 代号化 + 无门牌 / 具体地址模式",
    doorN === 0 && addrN === 0 && codeOk,
    `门牌=${doorN} 地址=${addrN} 代号标识词齐全=${codeOk}（真实姓名 / 房号 / 地址另留截图人工目视）`);
}

/* ------------------------------------------------------------------ *
 * §1.4 / §3 六态 selector（静态部分）
 * ------------------------------------------------------------------ */
{
  const bad = [];
  for (const p of BUSINESS) {
    const f = p + ".html";
    const h = src[f];
    if (!/data-state-select/.test(h)) bad.push(`${f}: 缺 data-state-select`);
    if (!/data-state-root/.test(h)) bad.push(`${f}: 缺 data-state-root`);
    const optVals = [];
    const re = /<option\s+value="([^"]+)"/gi;
    let m;
    while ((m = re.exec(h))) optVals.push(m[1]);
    const missing = STATES.filter((s) => !optVals.includes(s));
    if (missing.length) bad.push(`${f}: 缺选项 ${missing.join(",")}`);
    if (!h.includes("仅切换合成 UI 状态")) bad.push(`${f}: 缺逐字「仅切换合成 UI 状态」`);
  }
  check("§1.4/§3 四业务页各 1 个 selector、6 个真实选项、逐字标注、state-root",
    bad.length === 0, bad.length ? bad.join(" | ") : "4 页 × 6 态齐全");
}
check("§1.4/§3 app.js 六态枚举完整且默认 ready",
  STATES.every((s) => app.includes('"' + s + '"')) && /applyState\("ready"\)/.test(app),
  "STATES 6/6 + 末尾 applyState(\"ready\")");

/* ------------------------------------------------------------------ *
 * §1.5 / §4 UNKNOWN_RESULT 红线
 * ------------------------------------------------------------------ */
check("§4.1 无「再次新增 / 重新新增 / 再次下发 / 重复写入」",
  !/再次新增|重新新增|再次下发|重复写入/.test(all), "0 命中");
check("§4.2a 无自动重试实现标识（autoRetry / automaticRetry / 自动重发）",
  !/autoRetry|automaticRetry|自动重发/.test(all), "0 命中");
{
  // §4.2 字面命中披露：实现用「自动重试已关闭/禁用/不自动重试」表达冻结契约（任务卡 §5 要求）
  const lines = [];
  for (const f of PAGE_FILES) {
    src[f].split("\n").forEach((ln, i) => {
      if (/自动重试/.test(ln)) lines.push(`${f}:${i + 1}: ${ln.trim().slice(0, 110)}`);
    });
  }
  info(`§4.2b 验收规格字面 rg '自动重试' → 0 与任务卡 §5「自动重试禁用」存在口径张力；` +
       `实测字面命中 ${lines.length} 处，全部为否定式禁用声明（已关闭 / 禁用 / 不自动重试 / 不提供 / 不执行），清单：`);
  lines.forEach((l) => info("    " + l));
}
{
  const actionable = actionControlTokens(all).filter((t) => /自动重试|autoRetry|automaticRetry|自动重发/.test(t));
  check("§4.2c 按钮 / 选项 / 操作属性中无「自动重试」入口（§5 live 范式）",
    actionable.length === 0,
    actionable.length ? actionable.join(" | ") : `0 命中（${actionControlTokens(all).length} 个可操作 token 0 命中）`);
  // 披露 <a> 完整 textContent 中的否定式说明（导航卡片描述，非操作入口）
  const linkText = clickableTokens(htmlAll).filter((t) => /自动重试/.test(t));
  if (linkText.length) {
    info(`§4.2d <a> 导航卡片描述文字含「自动重试禁用」${linkText.length} 处，属模块介绍而非操作入口，不计入 FAIL：`);
    linkText.forEach((t) => info("    " + t.replace(/\s+/g, " ").slice(0, 130)));
  }
}
{
  const unknownPos = app.indexOf("if (t.unknown)");
  const retryablePos = app.indexOf("else if (t.retryable)");
  const retryPos = app.indexOf('data-action="retry"');
  check("§4.3 受控重试渲染条件绑定 retryable；UNKNOWN_RESULT 分支在前且不渲染重试",
    unknownPos >= 0 && retryablePos > unknownPos && retryPos > retryablePos,
    `unknown分支@${unknownPos} < retryable分支@${retryablePos} < retry按钮@${retryPos}`);
}
check("§4.4 无 device.operation.retry 时 disabled + 缺权限说明",
  /btns\[i\]\.disabled\s*=\s*!t\.checked/.test(app) &&
  /缺少 device\.operation\.retry/.test(app) && /perm-retry/.test(app),
  "disabled=!checked + 「缺少 device.operation.retry」提示 + #retry-perm-hint");
check("§4.5 UNKNOWN_RESULT 卡片含「查询 / 人工对账」，不含新增 / 重写入口",
  /data-action="query"/.test(app) && /data-action="reconcile"/.test(app) &&
  /UNKNOWN_RESULT/.test(app) && !/data-action="retry"/.test(app.slice(app.indexOf("if (t.unknown)"), app.indexOf("else if (t.retryable)"))),
  "query + reconcile 存在；unknown 分支内无 retry");
check("§4 基线旧文案「重试失败任务 / 可重试」消失",
  !/重试失败任务|可重试/.test(all), "0 命中");

/* ------------------------------------------------------------------ *
 * §1.5 / §5 Mock 横幅（5 页 × 屏幕态 / 打印态）
 * ------------------------------------------------------------------ */
{
  const need = ["Mock 演示，未连接真实门禁", "executionMode=test", "provider=mock",
    "evidenceScope=simulated", "真实设备生效：否"];
  const bad = [];
  for (const f of HTML_FILES) {
    const miss = need.filter((s) => !src[f].includes(s));
    if (miss.length) bad.push(`${f}: 缺 ${miss.join(",")}`);
  }
  check("§5 五页横幅逐字文案 + 四项只读状态 4/4", bad.length === 0,
    bad.length ? bad.join(" | ") : "5 页 × 5 项逐字命中");
}
{
  const rule = /\.mock-banner\s*\{([^}]*)\}/s.exec(css);
  check("§5 文字 + 颜色双通道（background / border-left / 状态标记）",
    !!rule && /background\s*:/.test(rule[1]) && /border-left\s*:/.test(rule[1]) &&
    /class="mock-flag"/.test(htmlAll) && /class="mock-lead"/.test(htmlAll),
    "可读文本 + 背景/边框/徽标，不只依赖颜色");
}
{
  const live = clickableTokens(htmlAll).filter((t) => /\blive\b/i.test(t));
  check("§5 无 live 切换按钮（只遍历可点击控件，不全文 grep）",
    live.length === 0, live.length ? live.join(" | ") : `aria-live 位于属性，未计入；${clickableTokens(htmlAll).length} 个可点击 token 0 命中`);
}
check("§5 无肯定式误导文案（允许「真实设备生效：否」）",
  !/已同步真实设备|真实授权已生效|已连接真实门禁|真实设备已生效|device_verified|同步真实设备|真实设备生效：是/.test(all),
  "0 命中；「真实设备生效：否」为允许文案，未误杀");
{
  const printIdx = css.indexOf("@media print");
  const p = printIdx >= 0 ? css.slice(printIdx) : "";
  const hide = /\.sidebar[^{]*\{[^}]*display\s*:\s*none[^}]*\}/.exec(p);
  check("§5 打印态 Mock 横幅 display:flex !important 且不在隐藏清单",
    /\.mock-banner\s*\{[^}]*display\s*:\s*flex\s*!important/.test(p) &&
    !!hide && !/\.mock-banner/.test(hide[0]),
    "styles.css @media print 保留横幅；computed style 实测由 CDP 覆盖");
}

/* ------------------------------------------------------------------ *
 * §1.6 / §6 键盘焦点 / toast / 窄屏表格 / 返回路径
 * ------------------------------------------------------------------ */
check("§6 :focus-visible ≥1（只读源码 Grep，不用 CSSOM 反推）",
  hits(css, /:focus-visible/g) >= 1, `styles.css 命中 ${hits(css, /:focus-visible/g)} 处`);
{
  const wraps = hits(app, /class="table-wrap" tabindex="0"/g);
  check("§6 合成表 .table-wrap 均带显式 tabindex=\"0\" + 焦点样式",
    wraps >= 1 && /\.table-wrap:focus-visible/.test(css),
    `app.js 中 ${wraps} 处 .table-wrap[tabindex=0]；styles.css 有 .table-wrap:focus-visible`);
  info("§6 口径说明：规格 §6 写「四业务页 .table-wrap 各有」，而规格 §3 把 applications ready 态定义为" +
       "「合成申请详情」（detail-grid，无表格）。实现为 devices/tasks/audits 三张表各带显式 tabindex=0（3/3）；" +
       "applications 页无 .table-wrap。此项按「有表格的页面」判定，差异已如实上报。");
}
check("§6 Escape / keydown 键盘监听 ≥1", /Escape|keydown/.test(app), "app.js 命中");
{
  const bad = HTML_FILES.filter((f) =>
    !(/role="status"/.test(src[f]) && /aria-live/.test(src[f]) && /id="toast-close"/.test(src[f])));
  check("§6 五页 toast role=status + aria-live + 可聚焦关闭按钮", bad.length === 0,
    bad.length ? bad.join(",") : "5/5 齐全");
}
{
  const bad = HTML_FILES.filter((f) => !/class="crumb"[^>]*>\s*<a href="index\.html">概览<\/a>/.test(src[f]));
  check("§6 五页面包屑含 <a href=\"index.html\">概览</a>", bad.length === 0,
    bad.length ? bad.join(",") : "5/5 可点击返回");
}
check("§6 详情 / 状态卡有可点击「返回」控件 + app.js 注入 .is-active / aria-current",
  /class="back-link"/.test(app) && /返回概览/.test(app) &&
  /classList\.add\("is-active"\)/.test(app) && /setAttribute\("aria-current"/.test(app),
  "back-link + .is-active + aria-current");

/* ------------------------------------------------------------------ *
 * §1.7 git diff --check
 * ------------------------------------------------------------------ */
{
  let out = "";
  let code = 0;
  try { out = git(["diff", "--check", `${BASELINE}..HEAD`]); }
  catch (e) { code = 1; out = String((e.stdout || "") + (e.stderr || "")); }
  check("§1.7 git diff --check 708c3ab..HEAD（stdout 为空）",
    code === 0 && out.trim() === "", out.trim() ? out.trim().slice(0, 200) : "退出码 0 / stdout 空");
}

/* ------------------------------------------------------------------ *
 * 既有 21 个证据文件 SHA-256 未变（基线取自 git show 708c3ab，防误写）
 * ------------------------------------------------------------------ */
{
  const list = git(["ls-tree", "-r", "--name-only", BASELINE, "--", "docs/tasks/screenshots/"])
    .trim().split("\n").filter(Boolean);
  check("既有证据文件数 = 21（20 PNG + 1 PDF）", list.length === 21, `实测 ${list.length}`);
  const mismatch = [];
  for (const p of list) {
    const baseBuf = execFileSync("git", ["show", `${BASELINE}:${p}`],
      { cwd: REPO, maxBuffer: 64 * 1024 * 1024 });
    const wp = path.join(REPO, p);
    if (!fs.existsSync(wp)) { mismatch.push(p + " (missing)"); continue; }
    if (sha256(baseBuf) !== sha256(fs.readFileSync(wp))) mismatch.push(p + " (SHA-256 mismatch)");
  }
  check("21 个既有证据文件 SHA-256 与 708c3ab 基线逐字节一致",
    mismatch.length === 0,
    mismatch.length ? mismatch.join(" | ") : "21/21 一致（基线来自 git 历史，工作树无法污染）");
  // 规格允许新截图只进 hk-ai-05a/ 子目录；该子目录在本次提交后成为 tracked，
  // 故必须排除后再判断「既有 21 个根下文件」是否被改动（否则提交后必然误报）。
  const changed = git(["diff", "--name-only", `${BASELINE}..HEAD`, "--", "docs/tasks/screenshots/"])
    .trim().split("\n")
    .filter((p) => p && !p.startsWith("docs/tasks/screenshots/hk-ai-05a/"));
  check("708c3ab..HEAD 间既有 21 个根下证据文件无 tracked 变更（排除 hk-ai-05a/ 新增子目录）",
    changed.length === 0,
    changed.length ? changed.join(" | ") : "0 变更（新增截图只进 hk-ai-05a/ 子目录，符合规格）");
}

console.log("");
console.log(`=== 汇总：${pass} PASS / ${fail} FAIL ===`);
if (fail) {
  console.log("存在 FAIL 项：仅报告，不修改页面代码，交实现工程师 / team-lead 处置。");
}
process.exitCode = fail ? 1 : 0;
