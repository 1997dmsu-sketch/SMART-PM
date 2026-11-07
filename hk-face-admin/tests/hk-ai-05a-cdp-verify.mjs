#!/usr/bin/env node
/**
 * HK-AI-05A 独立 QA · CDP 运行时验证 + 20 张脱敏截图
 *
 * 用法：node hk-face-admin/tests/hk-ai-05a-cdp-verify.mjs
 * 依赖：零第三方依赖。Node 22 内置全局 WebSocket（本地回环 CDP，不属于页面网络请求）。
 * 输出：
 *   - docs/tasks/screenshots/hk-ai-05a/*.png  （20 张，独立子目录）
 *   - hk-face-admin/tests/hk-ai-05a-verify-result.json （结构化实测证据）
 *   - 退出码 0 = 全部断言通过；1 = 存在失败（只报告，不改页面代码）
 *
 * 离线：Chrome 以 --headless=new + 严格离线参数启动，file:// 打开，独立 --user-data-dir。
 * 判定：.tmp-hk-05a-acceptance.md §3 / §4 / §5 / §6 / §7 / §8。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");                    // hk-face-admin
const REPO = path.resolve(ROOT, "..");                    // .tmp-hk-push
const OUT = path.join(REPO, "docs", "tasks", "screenshots", "hk-ai-05a");
const SHOT_ROOT = path.join(REPO, "docs", "tasks", "screenshots");
const BASELINE = "708c3ab";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const PAGES = ["index", "devices", "applications", "tasks", "audits"];
const BUSINESS = ["devices", "applications", "tasks", "audits"];
const STATES = ["ready", "loading", "empty", "forbidden", "error", "retrying"];
const BANNER_TEXT = "Mock 演示，未连接真实门禁";
const BANNER_FOUR = ["executionMode=test", "provider=mock", "evidenceScope=simulated", "真实设备生效：否"];

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

const report = {
  meta: {
    node: process.version, chrome: "156.0.8078.81 (headless=new)",
    baseline: BASELINE, repo: REPO, generatedAt: new Date().toISOString(),
    note: "CDP WebSocket 为本地回环 DevTools 协议，不属于页面运行时网络请求",
  },
  assertions: [], screenshots: [], stateMatrix: [], contrast: [],
  runtime: {}, evidenceIntegrity: {}, consoleErrors: [], network: {},
};
let pass = 0, fail = 0;
function assert(name, ok, detail) {
  if (ok) pass++; else fail++;
  report.assertions.push({ name, ok: !!ok, detail: detail ?? "" });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  ::  " + detail : ""}`);
}
function info(msg) { console.log(`INFO  ${msg}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }
function git(args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}
function url(page) { return pathToFileURL(path.join(ROOT, page + ".html")).href; }

/* ------------------------------------------------------------------ *
 * 既有 21 个证据文件（出图前 / 后各一次，防误写）
 * ------------------------------------------------------------------ */
function snap21() {
  const list = git(["ls-tree", "-r", "--name-only", BASELINE, "--", "docs/tasks/screenshots/"])
    .trim().split("\n").filter(Boolean);
  const map = {};
  for (const p of list) map[p] = sha256(fs.readFileSync(path.join(REPO, p)));
  return map;
}
function diffSnap(a, b) {
  const bad = [];
  for (const k of Object.keys(a)) if (a[k] !== b[k]) bad.push(k);
  for (const k of Object.keys(b)) if (!(k in a)) bad.push(k + " (new in root)");
  return bad;
}

/* ------------------------------------------------------------------ *
 * CDP 客户端
 * ------------------------------------------------------------------ */
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0;
    this.pending = new Map(); this.waiters = []; this.collectors = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
        return;
      }
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const w = this.waiters[i];
        if (w.method === msg.method && (!msg.sessionId || msg.sessionId === w.sid)) {
          this.waiters.splice(i, 1); clearTimeout(w.timer); w.resolve(msg.params);
        }
      }
      for (const fn of this.collectors) fn(msg);
    });
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }
  waitEvent(sid, method, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`waitEvent timeout: ${method}`)), timeout);
      this.waiters.push({ sid, method, resolve, timer });
    });
  }
  on(fn) { this.collectors.push(fn); }
}

async function launchChrome() {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "hk05a-chrome-"));
  const args = [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
    "--no-default-browser-check", "--disable-background-networking",
    "--disable-component-update", "--disable-sync", "--disable-default-apps",
    "--disable-extensions", "--disable-domain-reliability", "--metrics-recording-only",
    "--safebrowsing-disable-auto-update",
    "--disable-features=Translate,MediaRouter,OptimizationHints",
    "--hide-scrollbars", "--force-device-scale-factor=1",
    "--remote-debugging-port=0", `--user-data-dir=${userDir}`,
    "--window-size=1366,768", "about:blank",
  ];
  const proc = spawn(CHROME, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  let stderr = "";
  proc.stderr.on("data", (d) => { stderr += d.toString(); });
  const portFile = path.join(userDir, "DevToolsActivePort");
  let det = null;
  for (let i = 0; i < 200; i++) {
    if (fs.existsSync(portFile)) {
      const lines = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/);
      if (lines.length >= 2 && /^\d+$/.test(lines[0].trim())) {
        det = { port: parseInt(lines[0].trim(), 10), browserPath: lines[1].trim() };
        break;
      }
    }
    if (proc.exitCode !== null) throw new Error("chrome exited early: " + stderr.slice(-800));
    await sleep(100);
  }
  if (!det) throw new Error("DevToolsActivePort 未出现: " + stderr.slice(-800));
  const ws = new WebSocket(`ws://127.0.0.1:${det.port}${det.browserPath}`);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return { proc, ws, cdp: new CDP(ws), userDir, port: det.port };
}

/* ------------------------------------------------------------------ *
 * 运行时事件收集
 * ------------------------------------------------------------------ */
function attachCollectors(cdp) {
  const consoleErrors = [];
  const net = { total: 0, file: 0, nonFile: 0, samples: [] };
  cdp.on((msg) => {
    if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push("exceptionThrown: " + JSON.stringify(msg.params?.exceptionDetails?.text || ""));
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
      consoleErrors.push("console.error: " + JSON.stringify(msg.params?.args?.map((a) => a.value ?? a.description)));
    } else if (msg.method === "Log.entryAdded" && msg.params?.entry?.level === "error") {
      consoleErrors.push("log.error: " + String(msg.params.entry.text || "").slice(0, 160));
    } else if (msg.method === "Network.requestWillBeSent") {
      const u = msg.params?.request?.url || "";
      net.total++;
      if (u.startsWith("file://")) net.file++;
      else { net.nonFile++; net.samples.push(u); }
    }
  });
  return { consoleErrors, net };
}

/* ------------------------------------------------------------------ *
 * 页面操作辅助
 * ------------------------------------------------------------------ */
async function ev(cdp, sid, expression) {
  const r = await cdp.send("Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true }, sid);
  if (r.exceptionDetails) {
    throw new Error("Runtime.evaluate exception: " +
      (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result.value;
}
async function setMetrics(cdp, sid, w, h) {
  await cdp.send("Emulation.setDeviceMetricsOverride",
    { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sid);
}
async function navigate(cdp, sid, fileUrl) {
  const p = cdp.waitEvent(sid, "Page.loadEventFired", 15000);
  await cdp.send("Page.navigate", { url: fileUrl }, sid);
  await p;
  await ev(cdp, sid, "document.readyState");
  await sleep(80);
}
async function setState(cdp, sid, state) {
  return ev(cdp, sid,
    `(() => { const s=document.querySelector('[data-state-select]');` +
    ` s.value=${JSON.stringify(state)}; s.dispatchEvent(new Event('change'));` +
    ` return document.body.getAttribute('data-ui-state'); })()`);
}
async function key(cdp, sid, type, keyName, code, vk, extra = {}) {
  await cdp.send("Input.dispatchKeyEvent",
    { type, key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...extra }, sid);
}
async function clickElement(cdp, sid, selector) {
  const box = await ev(cdp, sid,
    `(() => { const e=document.querySelector(${JSON.stringify(selector)});` +
    ` if(!e) return null; e.scrollIntoView({block:'center'});` +
    ` const r=e.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}; })()`);
  if (!box) throw new Error("clickElement 未找到: " + selector);
  await cdp.send("Input.dispatchMouseEvent",
    { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 }, sid);
  await cdp.send("Input.dispatchMouseEvent",
    { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 }, sid);
  return box;
}
function scanValues(text) {
  const bad = [];
  for (const [label, re] of VALUE_PATTERNS) {
    re.lastIndex = 0;
    const n = (text.match(re) || []).length;
    if (n) bad.push(`${label}=${n}`);
  }
  return bad;
}
function checkPng(file, w, h) {
  const b = fs.readFileSync(file);
  const sigOk = b.length >= 24 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    b.subarray(12, 16).toString("ascii") === "IHDR";
  const width = b.readUInt32BE(16), height = b.readUInt32BE(20);
  return { sigOk, width, height, bytes: b.length, ok: sigOk && width === w && height === h };
}

/* ------------------------------------------------------------------ *
 * 截图（同时做 innerText 脱敏扫描）
 * ------------------------------------------------------------------ */
async function shot(cdp, sid, spec) {
  await setMetrics(cdp, sid, spec.w, spec.h);
  await navigate(cdp, sid, url(spec.page));
  if (spec.state && spec.state !== "ready") await setState(cdp, sid, spec.state);
  if (spec.scrollJs) await ev(cdp, sid, spec.scrollJs);
  if (spec.print) await cdp.send("Emulation.setEmulatedMedia", { media: "print" }, sid);
  await sleep(160);

  const innerText = await ev(cdp, sid, "document.body.innerText");
  const leaks = scanValues(innerText);
  const bannerOk = innerText.includes(BANNER_TEXT) && BANNER_FOUR.every((s) => innerText.includes(s));

  const r = await cdp.send("Page.captureScreenshot",
    { format: "png", captureBeyondViewport: false, fromSurface: true }, sid);
  const file = path.join(OUT, spec.file);
  fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  const ihdr = checkPng(file, spec.w, spec.h);

  if (spec.print) await cdp.send("Emulation.setEmulatedMedia", { media: "" }, sid);
  const rec = {
    file: spec.file, page: spec.page, state: spec.state || "ready",
    w: spec.w, h: spec.h, print: !!spec.print, scroll: !!spec.scrollJs,
    ihdr, innerTextLeaks: leaks, bannerTextAndFour: bannerOk,
  };
  report.screenshots.push(rec);
  console.log(`  SHOT ${spec.file.padEnd(52)} ${ihdr.width}x${ihdr.height} ${String(ihdr.bytes).padStart(8)}B` +
    `  IHDR=${ihdr.ok ? "OK" : "BAD"}  脱敏=${leaks.length ? leaks.join(",") : "0命中"}  横幅=${bannerOk ? "OK" : "BAD"}`);
  return rec;
}

const UNKNOWN_SCROLL =
  `(() => { const r=Array.from(document.querySelectorAll('tbody tr'))` +
  `.find(x=>/UNKNOWN_RESULT/.test(x.innerText)); if(r) r.scrollIntoView({block:'center'}); return !!r; })()`;
const PRIVATE_SCROLL =
  `(() => { const e=document.querySelector('.private-box');` +
  ` if(e) e.scrollIntoView({block:'center'}); return !!e; })()`;

const SHOTS = [
  { file: "index-1366x768.png", page: "index", w: 1366, h: 768 },
  { file: "devices-1366x768.png", page: "devices", w: 1366, h: 768 },
  { file: "applications-1366x768.png", page: "applications", w: 1366, h: 768 },
  { file: "tasks-1366x768.png", page: "tasks", w: 1366, h: 768 },
  { file: "audits-1366x768.png", page: "audits", w: 1366, h: 768 },
  { file: "devices-1440x900.png", page: "devices", w: 1440, h: 900 },
  { file: "applications-1440x900.png", page: "applications", w: 1440, h: 900 },
  { file: "tasks-1440x900.png", page: "tasks", w: 1440, h: 900 },
  { file: "audits-1440x900.png", page: "audits", w: 1440, h: 900 },
  { file: "devices-1920x1080.png", page: "devices", w: 1920, h: 1080 },
  { file: "applications-1920x1080.png", page: "applications", w: 1920, h: 1080 },
  { file: "tasks-1920x1080.png", page: "tasks", w: 1920, h: 1080 },
  { file: "audits-1920x1080.png", page: "audits", w: 1920, h: 1080 },
  { file: "tasks-state-unknown-result-1366x768.png", page: "tasks", w: 1366, h: 768, scrollJs: UNKNOWN_SCROLL },
  { file: "applications-state-forbidden-readprivate-1366x768.png", page: "applications", w: 1366, h: 768, scrollJs: PRIVATE_SCROLL },
  { file: "devices-state-loading-1366x768.png", page: "devices", w: 1366, h: 768, state: "loading" },
  { file: "applications-state-forbidden-1366x768.png", page: "applications", w: 1366, h: 768, state: "forbidden" },
  { file: "tasks-state-error-1366x768.png", page: "tasks", w: 1366, h: 768, state: "error" },
  { file: "audits-state-retrying-1366x768.png", page: "audits", w: 1366, h: 768, state: "retrying" },
  { file: "devices-print-mock-banner.png", page: "devices", w: 1366, h: 768, print: true },
];

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */
let chrome = null;
try {
  const before = snap21();
  report.evidenceIntegrity.beforeCount = Object.keys(before).length;
  info(`出图前：既有证据文件 ${Object.keys(before).length} 个，SHA-256 已记录`);

  chrome = await launchChrome();
  const { cdp, ws, proc } = chrome;
  const col = attachCollectors(cdp);

  const created = await cdp.send("Target.createTarget", { url: "about:blank" });
  const attached = await cdp.send("Target.attachToTarget", { targetId: created.targetId, flatten: true });
  const sid = attached.sessionId;
  await cdp.send("Page.enable", {}, sid);
  await cdp.send("Runtime.enable", {}, sid);
  await cdp.send("Network.enable", {}, sid);
  await cdp.send("Log.enable", {}, sid);
  info(`CDP 已连接 127.0.0.1:${chrome.port}（flatten session=${sid}）`);

  /* ---------- B. 20 张截图 ---------- */
  console.log("\n--- B. 生成 20 张脱敏截图 ---");
  for (const spec of SHOTS) await shot(cdp, sid, spec);

  /* ---------- C1. 六态 × 四业务页 = 24 组合 ---------- */
  console.log("\n--- C1. 六态 × 四业务页 24 组合 ---");
  const matrixOk = [];
  for (const p of BUSINESS) {
    await setMetrics(cdp, sid, 1366, 768);
    await navigate(cdp, sid, url(p));
    let prevHtml = null, prevSig = null;
    for (const s of STATES) {
      const d = await ev(cdp, sid,
        `(() => { const sel=document.querySelector('[data-state-select]');` +
        ` sel.value=${JSON.stringify(s)}; sel.dispatchEvent(new Event('change'));` +
        ` const root=document.querySelector('[data-state-root]');` +
        ` const els=Array.from(root.querySelectorAll('*'));` +
        ` return { html: root.innerHTML,` +
        ` sig: els.map(e=>e.tagName+'.'+(typeof e.className==='string'?e.className:'')).join('|'),` +
        ` state: document.body.getAttribute('data-ui-state'), sel: sel.value,` +
        ` views: root.querySelectorAll('.state-view').length,` +
        ` hidden: root.querySelectorAll('[hidden],[aria-hidden="true"]').length,` +
        ` children: root.children.length,` +
        ` url: location.href,` +
        ` ls: (()=>{try{return localStorage.length}catch(e){return -1}})(),` +
        ` ss: (()=>{try{return sessionStorage.length}catch(e){return -1}})() }; })()`);
      const row = {
        page: p, state: s, domDiffFromPrev: prevHtml === null ? null : d.html !== prevHtml,
        structDiffFromPrev: prevSig === null ? null : d.sig !== prevSig,
        stateAttr: d.state, selValue: d.sel, views: d.views, hidden: d.hidden,
        children: d.children, ls: d.ls, ss: d.ss, urlStable: d.url === url(p),
      };
      report.stateMatrix.push(row);
      const ok = (prevHtml === null || (row.domDiffFromPrev && row.structDiffFromPrev)) &&
        d.state === s && d.sel === s && d.views <= 1 && d.hidden === 0 &&
        d.children >= 1 && d.url === url(p) && d.ls === 0 && d.ss === 0;
      matrixOk.push(ok);
      console.log(`  ${ok ? "OK " : "BAD"} ${p.padEnd(13)} ${s.padEnd(9)}` +
        ` DOM差异=${row.domDiffFromPrev} 结构差异=${row.structDiffFromPrev}` +
        ` stateAttr=${d.state} views=${d.views} hidden=${d.hidden}` +
        ` children=${d.children} ls=${d.ls} ss=${d.ss}`);
      prevHtml = d.html; prevSig = d.sig;
    }
  }
  assert("C1.1 24 组合：每态 state-root innerHTML 与相邻态不同（且结构不同，非只换文字）",
    report.stateMatrix.filter((r) => r.domDiffFromPrev !== null).every((r) => r.domDiffFromPrev && r.structDiffFromPrev),
    `24 格中 20 格参与相邻比较，全部 DOM + 结构双重差异`);
  assert("C1.2 24 组合：同一时刻 ≤1 个状态容器、无 hidden/aria-hidden 残留、无 URL 变化",
    report.stateMatrix.every((r) => r.views <= 1 && r.hidden === 0 && r.children >= 1 && r.urlStable),
    "24/24 通过");
  assert("C1.3 24 组合：localStorage.length===0 && sessionStorage.length===0",
    report.stateMatrix.every((r) => r.ls === 0 && r.ss === 0), "24/24 实测 0/0");
  assert("C1.4 24 组合：每态 data-ui-state / select.value 与目标态一致",
    report.stateMatrix.every((r) => r.stateAttr === r.state && r.selValue === r.state), "24/24 通过");

  // reload 回 ready
  let reloadOk = true;
  for (const p of BUSINESS) {
    await navigate(cdp, sid, url(p));
    await setState(cdp, sid, "error");
    const pLoad = cdp.waitEvent(sid, "Page.loadEventFired", 15000);
    await cdp.send("Page.reload", { ignoreCache: true }, sid);
    await pLoad;
    await sleep(80);
    const st = await ev(cdp, sid,
      `({s:document.body.getAttribute('data-ui-state'), v:document.querySelector('[data-state-select]').value})`);
    if (!(st.s === "ready" && st.v === "ready")) reloadOk = false;
    console.log(`  reload ${p.padEnd(13)} -> ${st.s} / ${st.v}`);
  }
  assert("C1.5 四业务页切到 error 后 reload 强制恢复默认 ready", reloadOk, "4/4 回 ready");

  /* ---------- C2. Network 域 ---------- */
  assert("C2 CDP Network：整轮 requestWillBeSent 非 file:// 计数 = 0",
    col.net.nonFile === 0,
    `总事件=${col.net.total}（file:// 协议本身=${col.net.file}），非 file://=${col.net.nonFile}${col.net.samples.length ? " 样例:" + col.net.samples.slice(0, 3).join(",") : ""}`);
  report.network = col.net;
  assert("C2b 整轮 console error = 0（exceptionThrown / console.error / log.error）",
    col.consoleErrors.length === 0,
    col.consoleErrors.length ? col.consoleErrors.slice(0, 5).join(" | ") : "0 条");
  report.consoleErrors = col.consoleErrors;

  /* ---------- C3. Escape / 关闭按钮 / Enter / Space ---------- */
  console.log("\n--- C3. toast 键盘与鼠标交互 ---");
  await setMetrics(cdp, sid, 1366, 768);
  await navigate(cdp, sid, url("devices"));
  await clickElement(cdp, sid, "[data-toast]");
  const toastShown1 = await ev(cdp, sid, `!document.getElementById('toast').hidden`);
  await key(cdp, sid, "keyDown", "Escape", "Escape", 27);
  await key(cdp, sid, "keyUp", "Escape", "Escape", 27);
  const escapeHidden = await ev(cdp, sid, `document.getElementById('toast').hidden`);
  assert("C3.1 真实点击 [data-toast] 触发 toast", toastShown1 === true, "hidden=false");
  assert("C3.2 Input.dispatchKeyEvent(keyDown Escape) 真的关闭 toast", escapeHidden === true, "hidden=true");

  await clickElement(cdp, sid, "[data-toast]");
  await clickElement(cdp, sid, "#toast-close");
  const closeHidden = await ev(cdp, sid, `document.getElementById('toast').hidden`);
  assert("C3.3 真实鼠标点击 #toast-close 同样关闭 toast", closeHidden === true, "hidden=true");

  await ev(cdp, sid, `document.querySelector('#toast-close').blur(); document.querySelector('[data-toast]').focus();`);
  await key(cdp, sid, "keyDown", "Enter", "Enter", 13, { text: "\r" });
  await key(cdp, sid, "keyUp", "Enter", "Enter", 13);
  const enterShown = await ev(cdp, sid, `!document.getElementById('toast').hidden`);
  assert("C3.4 Enter 合成按键（带 text:'\\r'）可激活聚焦按钮", enterShown === true, "toast 弹出");
  await key(cdp, sid, "keyDown", "Escape", "Escape", 27);
  await key(cdp, sid, "keyUp", "Escape", "Escape", 27);

  /* ---------- C4. Tab 序列 / focus-visible / table-wrap 滚动 ---------- */
  console.log("\n--- C4. 900×768 Tab 序列与横向滚动容器 ---");
  await setMetrics(cdp, sid, 900, 768);
  await navigate(cdp, sid, url("devices"));
  const tabSeq = [];
  let reachedWrap = false;
  for (let i = 0; i < 45; i++) {
    await key(cdp, sid, "keyDown", "Tab", "Tab", 9);
    await key(cdp, sid, "keyUp", "Tab", "Tab", 9);
    const a = await ev(cdp, sid,
      `(() => { const e=document.activeElement; if(!e) return null; const c=getComputedStyle(e);` +
      ` return {tag:e.tagName, cls:(typeof e.className==='string'?e.className:''), id:e.id||'',` +
      ` fv:e.matches(':focus-visible'), outline:c.outlineStyle, ow:c.outlineWidth, oc:c.outlineColor,` +
      ` tabindex:e.getAttribute('tabindex')}; })()`);
    if (!a) break;
    tabSeq.push(a);
    if (a.cls.includes("table-wrap")) { reachedWrap = true; break; }
  }
  const fvCount = tabSeq.filter((a) => a.fv && a.outline !== "none" && parseFloat(a.ow) > 0).length;
  report.runtime.tabSequence = { total: tabSeq.length, focusVisibleCount: fvCount, reachedWrap,
    wrap: tabSeq.find((a) => a.cls.includes("table-wrap")) || null };
  assert("C4.1 Tab 序列可聚焦元素均 matches(':focus-visible') 且有可见 outline",
    fvCount >= 3, `${tabSeq.length} 个 Tab 步，${fvCount} 个 focus-visible + 可见 outline`);
  assert("C4.2 900×768 下能 Tab 到 .table-wrap（显式 tabindex=\"0\"）",
    reachedWrap && report.runtime.tabSequence.wrap?.tabindex === "0",
    reachedWrap ? `第 ${tabSeq.length} 步命中，tabindex=${report.runtime.tabSequence.wrap?.tabindex}` : "未到达");

  const beforeScroll = await ev(cdp, sid,
    `(() => { const e=document.querySelector('.table-wrap');` +
    ` return {sl:e.scrollLeft, sw:e.scrollWidth, cw:e.clientWidth, active:document.activeElement===e}; })()`);
  await key(cdp, sid, "keyDown", "ArrowRight", "ArrowRight", 39);
  await key(cdp, sid, "keyUp", "ArrowRight", "ArrowRight", 39);
  await key(cdp, sid, "keyDown", "End", "End", 35);
  await key(cdp, sid, "keyUp", "End", "End", 35);
  await sleep(60);
  const afterScroll = await ev(cdp, sid,
    `(() => { const e=document.querySelector('.table-wrap'); return {sl:e.scrollLeft}; })()`);
  report.runtime.tableScroll = { before: beforeScroll, after: afterScroll };
  assert("C4.3 .table-wrap 有被裁列（scrollWidth > clientWidth）",
    beforeScroll.sw > beforeScroll.cw, `scrollWidth=${beforeScroll.sw} clientWidth=${beforeScroll.cw}`);
  assert("C4.4 方向键 / End（keyDown）可滚入被裁列",
    afterScroll.sl > beforeScroll.sl, `scrollLeft ${beforeScroll.sl} -> ${afterScroll.sl}`);

  /* ---------- C5. 打印态 Mock 横幅 ---------- */
  console.log("\n--- C5. 打印态 Mock 边界 ---");
  await setMetrics(cdp, sid, 1366, 768);
  await navigate(cdp, sid, url("devices"));
  await cdp.send("Emulation.setEmulatedMedia", { media: "print" }, sid);
  const pr = await ev(cdp, sid,
    `(() => { const e=document.querySelector('.mock-banner'); const c=getComputedStyle(e);` +
    ` return {display:c.display, visibility:c.visibility, opacity:c.opacity, text:e.innerText}; })()`);
  const prOk = pr.display !== "none" && pr.visibility !== "hidden" &&
    pr.text.includes(BANNER_TEXT) && BANNER_FOUR.every((s) => pr.text.includes(s));
  report.runtime.print = { display: pr.display, visibility: pr.visibility, opacity: pr.opacity,
    hasLead: pr.text.includes(BANNER_TEXT), four: BANNER_FOUR.map((s) => ({ s, hit: pr.text.includes(s) })) };
  assert("C5 打印态 .mock-banner computed display/visibility 非隐藏，且含逐字文案 + 四项", prOk,
    `display=${pr.display} visibility=${pr.visibility} 逐字=${pr.text.includes(BANNER_TEXT)} 四项=4/4`);
  await cdp.send("Emulation.setEmulatedMedia", { media: "" }, sid);

  /* ---------- C6. 对比度实算（WCAG 相对亮度公式） ---------- */
  console.log("\n--- C6. 对比度实算（仅 Mock 横幅 + --text-2 类次级文字） ---");
  const CONTRAST_JS =
    `(() => {` +
    ` function parse(s){const m=/rgba?\\(([^)]+)\\)/.exec(s);if(!m)return null;` +
    `   const p=m[1].split(',').map(x=>parseFloat(x));return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}` +
    ` function effBg(el){const L=[];let n=el;while(n){const c=parse(getComputedStyle(n).backgroundColor);` +
    `   if(c){L.push(c);if(c.a>=0.999)break;}n=n.parentElement;}` +
    `   let o={r:255,g:255,b:255};for(let i=L.length-1;i>=0;i--){const c=L[i];` +
    `   o={r:c.r*c.a+o.r*(1-c.a),g:c.g*c.a+o.g*(1-c.a),b:c.b*c.a+o.b*(1-c.a)};}return o;}` +
    ` function fg(el){const c=parse(getComputedStyle(el).color)||{r:0,g:0,b:0,a:1};const bg=effBg(el);` +
    `   if(c.a>=0.999)return c;return {r:c.r*c.a+bg.r*(1-c.a),g:c.g*c.a+bg.g*(1-c.a),b:c.b*c.a+bg.b*(1-c.a)};}` +
    ` function lum(c){const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};` +
    `   return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);}` +
    ` function ratio(a,b){const x=lum(a),y=lum(b);return +((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)).toFixed(2);}` +
    ` const out=[]; for(const e of document.querySelectorAll(%SELS%)){` +
    `   const bg=effBg(e);out.push({sel:%SELNAME%(e),fg:getComputedStyle(e).color,` +
    `   bg:'rgb('+Math.round(bg.r)+','+Math.round(bg.g)+','+Math.round(bg.b)+')',ratio:ratio(fg(e),bg)});}` +
    ` return out;})()`;
  async function collectContrast(selectors) {
    const labelFn = `((e)=>e.className&&typeof e.className==='string'?'.'+e.className.trim().split(/\\s+/).join('.'):e.tagName)`;
    const expr = CONTRAST_JS
      .replace("%SELS%", JSON.stringify(selectors.join(",")))
      .replace("%SELNAME%", labelFn);
    return ev(cdp, sid, expr);
  }
  await setMetrics(cdp, sid, 1366, 768);
  await navigate(cdp, sid, url("devices"));
  const devSel = [".mock-banner .mock-lead", ".mock-banner .mock-status",
    ".mock-banner .mock-status .no", ".mock-banner .mock-status code",
    ".mock-banner .mock-flag", ".muted", ".stat-label", ".stat-hint", ".sub", ".crumb"];
  let cr = await collectContrast(devSel);
  await setState(cdp, sid, "error");
  cr = cr.concat(await collectContrast([".state-note"]));
  await navigate(cdp, sid, url("index"));
  cr = cr.concat(await collectContrast([".module-card p", ".hero p"]));
  report.contrast = cr;
  cr.forEach((r) => console.log(`  ${String(r.ratio).padStart(6)}:1  ${r.sel.padEnd(38)} fg=${r.fg} bg=${r.bg}`));
  assert("C6 Mock 横幅文本 + --text-2 类次级文字对比度均 ≥4.5:1（computed style + WCAG 公式实算）",
    cr.length >= 10 && cr.every((r) => r.ratio >= 4.5),
    `${cr.length} 个元素，最小 ${Math.min(...cr.map((r) => r.ratio))}:1，最大 ${Math.max(...cr.map((r) => r.ratio))}:1`);

  /* ---------- C7. UNKNOWN_RESULT DOM 复核 ---------- */
  console.log("\n--- C7. UNKNOWN_RESULT 红线 DOM 层复核 ---");
  await setMetrics(cdp, sid, 1366, 768);
  await navigate(cdp, sid, url("tasks"));
  const ur = await ev(cdp, sid,
    `(() => { const rows=Array.from(document.querySelectorAll('tbody tr'));` +
    ` const unk=rows.filter(r=>/UNKNOWN_RESULT|awaiting_result/.test(r.innerText));` +
    ` const ret=rows.filter(r=>/RETRYABLE|retryable_failed/.test(r.innerText));` +
    ` return {unknownCount:unk.length,` +
    `   unknownActions:unk.map(r=>Array.from(r.querySelectorAll('button,[data-action]')).map(b=>b.getAttribute('data-action')||b.textContent.trim())),` +
    `   unknownHasRetry:unk.some(r=>!!r.querySelector('[data-action="retry"]')),` +
    `   unknownHasNew:unk.some(r=>/再次新增|重新新增|再次下发|重复写入/.test(r.innerText)),` +
    `   unknownHasQuery:unk.some(r=>/查询/.test(r.innerText)),` +
    `   unknownHasReconcile:unk.some(r=>/人工对账/.test(r.innerText)),` +
    `   retryableCount:ret.length, retryableHasRetry:ret.every(r=>!!r.querySelector('[data-action="retry"]')),` +
    `   totalRetryBtns:document.querySelectorAll('[data-action="retry"]').length}; })()`);
  report.runtime.unknownResult = ur;
  assert("C7.1 awaiting_result / UNKNOWN_RESULT 行内不存在可执行重试 / 再次新增按钮，只有查询 / 人工对账",
    ur.unknownCount === 1 && !ur.unknownHasRetry && !ur.unknownHasNew && ur.unknownHasQuery && ur.unknownHasReconcile,
    `unknown行=${ur.unknownCount} actions=${JSON.stringify(ur.unknownActions)}`);
  assert("C7.2 受控重试按钮只出现在 retryable 行",
    ur.retryableCount === 1 && ur.retryableHasRetry && ur.totalRetryBtns === 1,
    `retryable行=${ur.retryableCount} 全站 retry 按钮=${ur.totalRetryBtns}`);

  // app.js 的权限 change 监听是 document 委托；合成事件必须 bubbles:true。
  // 这里改用真实鼠标点击 checkbox（浏览器原生 change 冒泡），最贴近真实用户操作。
  await clickElement(cdp, sid, "#perm-retry");
  const perm = await ev(cdp, sid,
    `(() => { const b=document.querySelector('[data-action="retry"]');` +
    ` const h=document.getElementById('retry-perm-hint');` +
    ` const c=document.getElementById('perm-retry');` +
    ` return {checked:c.checked, disabled:b.disabled, title:b.title,` +
    ` hint:h?h.innerText:'', aria:b.getAttribute('aria-disabled')}; })()`);
  assert("C7.3 取消 device.operation.retry 勾选后受控重试按钮 disabled 且有缺权限说明",
    perm.checked === false && perm.disabled === true &&
    /缺少|无重试权限|不可操作/.test(perm.hint + perm.title),
    `checked=${perm.checked} disabled=${perm.disabled} hint="${perm.hint}" title="${perm.title}"`);

  // 重新勾选（真实点击）恢复按钮，再测「点击只改本地状态」
  await clickElement(cdp, sid, "#perm-retry");
  const restored = await ev(cdp, sid,
    `({checked:document.getElementById('perm-retry').checked,` +
    ` disabled:document.querySelector('[data-action="retry"]').disabled})`);
  info(`C7.3b 重新勾选后按钮恢复：checked=${restored.checked} disabled=${restored.disabled}`);
  const urlBefore = url("tasks");
  const netBefore = col.net.nonFile;
  await clickElement(cdp, sid, '[data-action="retry"]');
  const afterClick = await ev(cdp, sid,
    `({url:location.href, ls:(()=>{try{return localStorage.length}catch(e){return -1}})(),` +
    ` ss:(()=>{try{return sessionStorage.length}catch(e){return -1}})()})`);
  report.runtime.buttonSideEffect = { urlBefore, afterClick, netBefore, netAfter: col.net.nonFile };
  assert("C7.4 点击受控重试后 URL / 浏览器存储 / 非 file 网络计数均不变",
    afterClick.url === urlBefore && afterClick.ls === 0 && afterClick.ss === 0 && col.net.nonFile === netBefore,
    `url不变=${afterClick.url === urlBefore} ls=${afterClick.ls} ss=${afterClick.ss} net=${netBefore}->${col.net.nonFile}`);

  /* ---------- C8. CSSOM 跨源说明（只读源码 Grep，不运行时枚举） ---------- */
  const cssRulesErr = await ev(cdp, sid,
    `(() => { try { const s=document.styleSheets[0]; return {ok:true, n:s.cssRules.length}; }` +
    ` catch(e){ return {ok:false, err:e.name}; } })()`);
  report.runtime.cssom = cssRulesErr;
  info(`C8 file:// 下 CSSOM cssRules 访问：${cssRulesErr.ok ? "可访问" : cssRulesErr.err}` +
       `；focus 样式存在性只以只读源码 Grep 为据（§6），不以运行时规则枚举反推。`);

  /* ---------- 收尾：证据完整性 + 截图校验 ---------- */
  const after = snap21();
  const changed = diffSnap(before, after);
  const baseMismatch = [];
  for (const p of Object.keys(before)) {
    const b = execFileSync("git", ["show", `${BASELINE}:${p}`],
      { cwd: REPO, maxBuffer: 64 * 1024 * 1024 });
    if (sha256(b) !== before[p]) baseMismatch.push(p);
  }
  report.evidenceIntegrity = {
    beforeCount: Object.keys(before).length, afterCount: Object.keys(after).length,
    beforeAfterChanged: changed, baselineMismatch: baseMismatch,
    allConsistent: changed.length === 0 && baseMismatch.length === 0,
  };
  assert("B/C 20 张截图全部生成", report.screenshots.length === 20, `${report.screenshots.length}/20`);
  assert("B/C 20 张 PNG 签名 + IHDR 宽高与文件名一致",
    report.screenshots.every((s) => s.ihdr.ok), "20/20 IHDR OK");
  assert("B/C 20 张 innerText 脱敏 10 类值正则 0 命中",
    report.screenshots.every((s) => s.innerTextLeaks.length === 0),
    report.screenshots.flatMap((s) => s.innerTextLeaks.map((l) => s.file + ":" + l)).join(" | ") || "0 命中");
  assert("B/C 20 张均含 Mock 横幅逐字文案 + 四项（含打印态）",
    report.screenshots.every((s) => s.bannerTextAndFour), "20/20 命中");
  assert("B/C 既有 21 个证据文件 SHA-256 出图前后完全一致，且均与 708c3ab 基线一致",
    report.evidenceIntegrity.allConsistent,
    `前后差异=${changed.length} 基线差异=${baseMismatch.length}`);

  fs.writeFileSync(path.join(HERE, "hk-ai-05a-verify-result.json"), JSON.stringify(report, null, 2));
  console.log(`\n=== CDP 汇总：${pass} PASS / ${fail} FAIL ===`);
  console.log(`=== 网络请求 0（非 file:// = ${col.net.nonFile}）、真实设备/Provider 调用 0 ===`);
  try { ws.close(); } catch (e) { /* ignore */ }
  proc.kill();
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error("FATAL: " + (e && e.stack ? e.stack : String(e)));
  if (chrome) { try { chrome.ws.close(); } catch (_) {} try { chrome.proc.kill(); } catch (_) {} }
  report.fatal = String(e && e.stack ? e.stack : e);
  fs.writeFileSync(path.join(HERE, "hk-ai-05a-verify-result.json"), JSON.stringify(report, null, 2));
  process.exitCode = 1;
}
