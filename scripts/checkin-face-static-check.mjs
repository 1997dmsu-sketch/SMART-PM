/**
 * B05 / §6 — 零依赖静态检查（只扫生产源码，不扫测试文件）。
 *
 * 守护：设备秘密不入小程序/云函数/发布包；新链路不回退 unlimited/simulation；
 * 客户端载荷不含服务端字段；不引入 DB-05 occupancy；allowDeviceOperations:false；
 * 云函数不打印请求体。违规打印具体文件:行号并以退出码 1 结束。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const issues = [];
let scanned = 0;

function sourceFiles(relativeDir, extensions) {
  const base = join(ROOT, relativeDir);
  const result = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (extensions.some((ext) => entry.name.endsWith(ext))) result.push(full);
    }
  };
  if (statSync(base).isFile()) result.push(base);
  else walk(base);
  return result.sort();
}

function readLines(file) {
  scanned += 1;
  return readFileSync(file, 'utf8').split(/\r?\n/);
}

function checkLines(file, checks) {
  const lines = readLines(file);
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  lines.forEach((line, index) => {
    for (const [pattern, message] of checks) {
      if ((typeof pattern === "function" ? pattern(line, index, lines) : pattern.test(line))) issues.push(`${rel}:${index + 1}: ${message} | ${line.trim().slice(0, 160)}`);
    }
  });
}

function requireText(file, patterns, message) {
  const text = readFileSync(file, 'utf8');
  for (const pattern of patterns) {
    if (pattern.test(text)) return;
  }
  issues.push(`${relative(ROOT, file).replaceAll('\\', '/')}:1: ${message}`);
}

const DEVICE_SECRET_CHECKS = [
  [/(?:password|privateKey|certificatePath|certificateBase64|clientSecret|accessToken)\s*[:=]/i, '设备/凭据秘密关键字不得进入小程序或云函数'],
  [/\borigin\s*[:=]\s*['"]https?:\/\//i, '设备 origin 主机不得进入小程序或云函数'],
  [/https?:\/\/[^\s'"<>]+/i, '源码不得硬编码设备/服务端主机地址'],
  [/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|BEGIN CERTIFICATE-----/, '证书/私钥内容不得进入源码'],
  [/\bworkerToken\s*[:=]\s*['"][^'"]{8,}['"]/, 'worker 明文凭据不得进入小程序或云函数'],
];

const CLIENT_FILES = [
  ...sourceFiles('miniprogram', ['.js', '.json', '.wxml', '.wxss']),
  ...sourceFiles('cloudfunctions/checkinFaceTest', ['.js', '.json']),
];
for (const file of CLIENT_FILES) checkLines(file, DEVICE_SECRET_CHECKS);

// 新客户端路径：载荷字段白名单与模式/长期兜底。
const API_FILE = join(ROOT, 'miniprogram/services/api.js');
const apiLines = readLines(API_FILE);
const sectionStart = apiLines.findIndex((line) => line.includes('入住＋人脸登记体验版：严格客户端字段白名单'));
const sectionEnd = apiLines.findIndex((line) => line.startsWith('function normalizeHouse'));
if (sectionStart < 0 || sectionEnd <= sectionStart) {
  issues.push('miniprogram/services/api.js:1: 找不到新 API 白名单段落，无法校验客户端载荷');
} else {
  const forbidden = /\b(?:approved|testMode|roomNo|roomId|houseId|doorNo|employeeNo|validFrom|validTo|status|openid)\s*:/;
  apiLines.slice(sectionStart, sectionEnd).forEach((line, index) => {
    if (forbidden.test(line)) {
      issues.push(`miniprogram/services/api.js:${sectionStart + index + 1}: 客户端载荷包含服务端字段 | ${line.trim().slice(0, 160)}`);
    }
  });
}

// 新页面不得自行拼接上传路径、不得调用设备命令、不得默认日期。
const NEW_PAGE_FILES = [
  ...sourceFiles('miniprogram/pages/checkin', ['.js', '.wxml']),
  ...sourceFiles('miniprogram/pages/face-enroll', ['.js', '.wxml']),
];
for (const file of NEW_PAGE_FILES) {
  checkLines(file, [
    [/\bunlimited\b|new\s+Date\s*\(|Date\.now\s*\(|setFullYear\s*\(/, '新页面不得使用长期/自动日期逻辑'],
    [/\brunFaceEnrollment\b|createServer\s*\(|\.listen\s*\(|0\.0\.0\.0|\bunlock\s*\(/, '新页面不得触碰设备命令或监听端口'],
    [/识别通过|已识别通过|已开门/, '不得展示现场识别通过或远程开门结论'],
  ]);
}

// 云函数：没有 unlimited 兜底、不打印请求/响应体、不引入 DB-05 工作线。
for (const file of sourceFiles('cloudfunctions/checkinFaceTest', ['.js', '.json'])) {
  checkLines(file, [
    [/\bunlimited\b/, '新云函数路径不得有 unlimited 兜底'],
    [/console\.(?:log|info|debug|warn|error)\s*\(/, '云函数不得输出请求体/响应体/凭据'],
    [/(?:require\s*\([^)]*occupancy|from\s*['"][^'"]*occupancy|\bLocalStore\b)/i, '不得引入 DB-05 occupancy 工作线'],
    [(line, index, lines) => /\brequeue\b/i.test(line)
      && !/(?:no|not|without)\s*(?:\*\s*)?requeue|无\s*requeue|不得.*requeue|禁止.*requeue/i.test(`${lines[index - 1] || ''} ${line}`), '不得存在 requeue 自动重发入口'],
  ]);
}

// 小程序全局：不开远程设备操作，不引入 Node/DB-05 依赖。
requireText(
  join(ROOT, 'miniprogram/config/runtime.js'),
  [/allowDeviceOperations\s*:\s*false/],
  'runtime.allowDeviceOperations 必须保持 false',
);
checkLines(join(ROOT, 'miniprogram/config/runtime.js'), [
  [/allowDeviceOperations\s*:\s*true/, '不得开启全局远程设备操作'],
]);
for (const file of sourceFiles('miniprogram', ['.js'])) {
  checkLines(file, [
    [/(?:require\s*\([^)]*occupancy|from\s*['"][^'"]*occupancy|\bLocalStore\b)/i, '小程序不得引入 DB-05 occupancy 工作线'],
    [/createServer\s*\(|\.listen\s*\(|0\.0\.0\.0/, '小程序不得监听端口或反代'],
    [/@cloudbase\/node-sdk|node:https/, '小程序不得运行 Node HTTPS adapter'],
  ]);
}

// worker：显式 device + fixed，不能监听端口/远程开门/自动重发。
const WORKER_FILES = [
  join(ROOT, 'tools/checkin-face-worker/worker-runtime.mjs'),
  join(ROOT, 'tools/checkin-face-worker/claim-and-enroll.mjs'),
];
requireText(WORKER_FILES[0], [/mode:\s*['"]device['"]/, /validityMode:\s*['"]fixed['"]/], 'worker 必须显式构造 mode=device 与 validityMode=fixed');
for (const file of WORKER_FILES) {
  checkLines(file, [
    [/createServer\s*\(|\.listen\s*\(|0\.0\.0\.0/, 'worker 不得开监听端口'],
    [/\bunlockDevice\s*\(|\bunlock\s*\(/, 'worker 不得调用远程开门'],
    [(line, index, lines) => /\brequeue\b/i.test(line)
      && !/(?:no|not|without)\s*(?:\*\s*)?requeue|无\s*requeue|不得.*requeue|禁止.*requeue/i.test(`${lines[index - 1] || ''} ${line}`), 'worker 不得实现 requeue 自动重发'],
  ]);
}

// 忽略规则：local 配置与临时照片目录必须永不入包。
const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
for (const pattern of ['tools/checkin-face-worker/*.local.json', 'tools/checkin-face-worker/.data/', 'tools/checkin-face-worker/.cache/']) {
  if (!gitignore.includes(pattern)) issues.push(`.gitignore:1: 缺少忽略规则 ${pattern}`);
}

if (issues.length) {
  process.stderr.write(`[FAIL] checkin-face static check: ${issues.length} violation(s)\n`);
  for (const issue of issues) process.stderr.write(`  - ${issue}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`[PASS] checkin-face static check: ${scanned} source files scanned, 0 violations\n`);
}
