/**
 * B05 / §6 — 零依赖静态检查（只扫生产源码，不扫测试文件）。
 *
 * 守护：设备秘密不入小程序/云函数/发布包；新链路不回退 unlimited/simulation；
 * 客户端载荷不含服务端字段；不引入 DB-05 occupancy；allowDeviceOperations:false；
 * 云函数不打印请求体。R10：mode=device 与 validityMode=fixed 逐项断言、全部要求。
 * 违规打印具体文件:行号并以退出码 1 结束。
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

/**
 * Restricted JavaScript lexer for the static gate. Comments are removed across
 * line boundaries; quoted strings, templates and regex literals are opaque.
 * This is deliberately not a general evaluator: uncertain syntax fails closed
 * when inspecting the explicit request object below.
 */
function lexSource(source) {
  const tokens = [];
  const masked = source.split('');
  let index = 0;
  const token = (type, value, start, end) => tokens.push({ type, value, start, end });
  const mask = (start, end) => {
    for (let at = start; at < end; at++) if (masked[at] !== '\n' && masked[at] !== '\r') masked[at] = ' ';
  };
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) { index += 1; continue; }
    const start = index;
    if (source.startsWith('//', index)) {
      while (index < source.length && source[index] !== '\n') index += 1;
      mask(start, index);
      continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
      mask(start, index);
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') { index += 2; continue; }
        if (source[index++] === quote) break;
      }
      const raw = source.slice(start, index);
      // Escaped/templated values are intentionally not accepted as gate facts.
      const value = quote !== '`' && !raw.includes('\\') && raw.at(-1) === quote ? raw.slice(1, -1) : null;
      token(quote === '`' ? 'opaque' : 'string', value, start, index);
      continue;
    }
    const previous = tokens.at(-1);
    const regexPosition = !previous || ['=', '(', '[', '{', ',', ':', ';', '!', '&&', '||', '?', 'return', 'throw', '=>',
      '===', '!==', '==', '!=', '<=', '>=', '??', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '>>>'].includes(previous.value);
    if (char === '/' && regexPosition) {
      let inClass = false;
      index += 1;
      while (index < source.length && source[index] !== '\n') {
        if (source[index] === '\\') { index += 2; continue; }
        if (source[index] === '[') inClass = true;
        if (source[index] === ']') inClass = false;
        if (source[index++] === '/' && !inClass) break;
      }
      while (/[A-Za-z]/.test(source[index] || '') && index < source.length) index += 1;
      token('opaque', null, start, index);
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      index += 1;
      while (/[\w$]/.test(source[index] || '') && index < source.length) index += 1;
      token('identifier', source.slice(start, index), start, index);
      continue;
    }
    if (source.startsWith('...', index)) index += 3;
    else {
      // 统一运算符词法：复合/逻辑/更新/位/移位赋值与比较符按完整 token 产出，
      // 与识别器（ASSIGN_OPS/UPDATE_OPS）同源一致（CF-R2-11 第二轮）。
      const opRun = /^(>>>=|<<=|>>=|>>>|===|!==|=>|&&=|\|\|=|\?\?=|\+=|-=|\*=|\/=|%=|\*\*=|&=|\|=|\^=|==|!=|<=|>=|\+\+|--|&&|\|\||\?\?|\*\*|<<|>>)/.exec(source.slice(index));
      if (opRun) index += opRun[0].length;
      else index += 1;
    }
    token('punctuation', source.slice(start, index), start, index);
  }
  return { tokens, code: masked.join('') };
}

function codeLinesOf(file) {
  return lexSource(readFileSync(file, 'utf8')).code.split(/\r?\n/);
}

function codeTextOf(file) {
  return codeLinesOf(file).join('\n');
}

/**
 * 逐项断言（R10）：每一对 [pattern, message] 都必须命中，缺任何一项都失败，
 * 并且各自打印专属消息，负控可精确命中。
 */
function requireEachText(file, pairs) {
  const text = codeTextOf(file);
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  for (const [pattern, message] of pairs) {
    if (!pattern.test(text)) issues.push(`${rel}:1: ${message}`);
  }
}

/**
 * Inspect the actual `const request = { ... }` constructor and any later writes
 * to its hard-requirement members. Only direct literal fields in that same
 * object are facts; comments, strings, nested/fake objects, duplicate keys,
 * same-name accessors/methods and post-construction assignments to
 * request.mode / request.validityMode / request.consent cannot supply or
 * override the mandatory contract (CF-R2-11).
 */
const HARD_REQUEST_KEYS = ['mode', 'validityMode', 'consent'];
function requireRequestConstruction(file, pairs) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  const { tokens } = lexSource(readFileSync(file, 'utf8'));
  const constructors = [];
  for (let at = 0; at < tokens.length - 3; at++) {
    if (!['const', 'let'].includes(tokens[at].value) || tokens[at + 1].value !== 'request'
      || tokens[at + 2].value !== '=' || tokens[at + 3].value !== '{') continue;
    const fields = new Map();
    const seen = new Set();
    let depth = 1;
    let unsafe = false;
    let closedAt = -1;
    for (let item = at + 4; item < tokens.length && depth > 0; item++) {
      const current = tokens[item];
      if (depth === 1) {
        if (current.type === 'punctuation' && ['...', '['].includes(current.value)) unsafe = true;
        if (HARD_REQUEST_KEYS.includes(current.value)) {
          const next = tokens[item + 1]?.value;
          if (next === ':') {
            const value = tokens[item + 2];
            const ended = [',', '}'].includes(tokens[item + 3]?.value);
            if (seen.has(current.value) || !ended) unsafe = true;
            seen.add(current.value);
            fields.set(current.value, { type: value?.type, value: value?.value });
          } else if (next === '(') {
            // 同名 method 简写会覆盖字面量（CF-R2-11）
            if (seen.has(current.value)) unsafe = true;
          }
        }
        if ((current.value === 'get' || current.value === 'set')
          && HARD_REQUEST_KEYS.includes(tokens[item + 1]?.value) && tokens[item + 2]?.value === '(') {
          // 同名 getter/setter 会覆盖字面量（CF-R2-11）
          if (seen.has(tokens[item + 1].value)) unsafe = true;
        }
      }
      if (['{', '[', '('].includes(current.value)) depth += 1;
      if (['}', ']', ')'].includes(current.value)) {
        depth -= 1;
        if (depth === 0) { closedAt = item; break; }
      }
    }
    constructors.push({ fields, unsafe: unsafe || depth !== 0, closedAt });
  }
  if (constructors.length !== 1) {
    issues.push(`${rel}:1: 找不到唯一实际 request 对象构造，不能以其他 consent 锚点或字符串替代`);
    return;
  }
  const { fields, unsafe, closedAt } = constructors[0];
  // CF-R2-11 第三轮：识别完整赋值左值/解构目标（而非固定相邻 token）——
  // 覆盖括号赋值目标（含多层）、数组/对象多目标与嵌套解构中的硬字段；
  // 点访问与静态字符串下标一致；受限语法无法证明安全时失败关闭。
  const ASSIGN_OPS = ['=', '&&=', '||=', '??=', '+=', '-=', '*=', '/=', '%=', '**=', '&=', '|=', '^=', '<<=', '>>=', '>>>='];
  const UPDATE_OPS = ['++', '--'];
  const OPENERS = new Set(['{', '[', '(']);
  const CLOSERS = new Set(['}', ']', ')']);
  const STATEMENT_BOUNDARY = new Set([';', '{', '}']);
  const LHS_KEYWORDS = new Set(['const', 'let', 'var', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'function', '=>', ':', ',']);
  const HARD_KEY_AT = (k) => HARD_REQUEST_KEYS.includes(tokens[k]?.value);
  const isHardMember = (at) => {
    if (tokens[at]?.type !== 'identifier' || tokens[at].value !== 'request') return false;
    // 经典直连：request.key / request["key"]
    if (tokens[at + 1]?.value === '.' && HARD_KEY_AT(at + 2)) return true;
    if (tokens[at + 1]?.value === '[' && tokens[at + 2]?.type === 'string'
      && HARD_KEY_AT(at + 2) && tokens[at + 3]?.value === ']') return true;
    // CF-R2-11 第四轮：括号基对象（语义透明）——(...((request))...).key / ["key"]。
    // 基对象外侧可有多层括号（含成员整体再被括号包裹的情形）；紧邻基对象前
    // 的 '(' 数至少 1 且其后为 ')' 串 + 成员操作符即归一化为 request 成员。
    let openers = 0;
    let back = at - 1;
    while (back >= 0 && tokens[back]?.value === '(') { openers += 1; back -= 1; }
    if (openers === 0) return false;
    let k = at + 1;
    while (tokens[k]?.value === ')') k += 1;
    if (tokens[k]?.value === '.' && HARD_KEY_AT(k + 1)) return true;
    if (tokens[k]?.value === '[' && tokens[k + 1]?.type === 'string'
      && HARD_KEY_AT(k + 1) && tokens[k + 2]?.value === ']') return true;
    return false;
  };
  // CF-R2-11 第五轮：序列表达式基对象——( <exprs>, request ) 中 request 为
  // 序列末值时的 .key / ["key"] 成员（多层括号/嵌套序列均归一化）。'(' 必须是
  // 分组括号而非调用括号（其前不是被调用者）；只读上下文不会进入本函数
  // （isHardMember 仅用于赋值左值收集范围）。
  const isHardMemberViaSequence = (at) => {
    if (tokens[at]?.type !== 'identifier' || tokens[at].value !== 'request') return false;
    if (tokens[at - 1]?.value !== ',') return false;
    let depth = 0;
    let openIdx = -1;
    for (let j = at - 1; j >= 0; j--) {
      const t = tokens[j];
      if (CLOSERS.has(t.value)) { depth += 1; continue; }
      if (OPENERS.has(t.value)) { depth -= 1; if (depth < 0) { openIdx = j; break; } continue; }
      if (depth === 0 && STATEMENT_BOUNDARY.has(t.value)) break;
      if (depth === 0 && LHS_KEYWORDS.has(t.value) && t.value !== ',') break;
    }
    if (openIdx < 0) return false;
    const before = tokens[openIdx - 1];
    if (before && (before.type === 'identifier' || before.type === 'string' || [')', ']'].includes(before.value))) return false;
    let k = at + 1;
    while (tokens[k]?.value === ')') k += 1;
    if (tokens[k]?.value === '.' && HARD_KEY_AT(k + 1)) return true;
    if (tokens[k]?.value === '[' && tokens[k + 1]?.type === 'string'
      && HARD_KEY_AT(k + 1) && tokens[k + 2]?.value === ']') return true;
    return false;
  };
  const containsHardMember = (from, to) => {
    for (let i = from; i <= to; i++) if (isHardMember(i) || isHardMemberViaSequence(i)) return true;
    return false;
  };
  const collectBackward = (start) => {
    let local = 0;
    const indexes = [];
    for (let j = start; j >= 0; j--) {
      const t = tokens[j];
      if (CLOSERS.has(t.value)) { local += 1; indexes.unshift(j); continue; }
      if (OPENERS.has(t.value)) { local -= 1; if (local < 0) break; indexes.unshift(j); continue; }
      if (local === 0 && (STATEMENT_BOUNDARY.has(t.value) || LHS_KEYWORDS.has(t.value))) break;
      indexes.unshift(j);
    }
    return indexes;
  };
  const collectForward = (start) => {
    let local = 0;
    const indexes = [];
    for (let j = start; j < tokens.length; j++) {
      const t = tokens[j];
      if (OPENERS.has(t.value)) { local += 1; indexes.push(j); continue; }
      if (CLOSERS.has(t.value)) { local -= 1; if (local < 0) break; indexes.push(j); continue; }
      if (local === 0 && (STATEMENT_BOUNDARY.has(t.value) || [',', ':'].includes(t.value))) break;
      indexes.push(j);
    }
    return indexes;
  };
  let postAssigned = false;
  for (let item = Math.max(0, closedAt); item < tokens.length; item++) {
    const current = tokens[item];
    if (current.type !== 'punctuation') continue;
    if (ASSIGN_OPS.includes(current.value)) {
      const lhs = collectBackward(item - 1);
      if (lhs.length && containsHardMember(lhs[0], lhs[lhs.length - 1])) postAssigned = true;
    } else if (UPDATE_OPS.includes(current.value)) {
      const lhs = collectBackward(item - 1);
      if (lhs.length && containsHardMember(lhs[0], lhs[lhs.length - 1])) { postAssigned = true; continue; }
      const operand = collectForward(item + 1);
      if (operand.length && containsHardMember(operand[0], operand[operand.length - 1])) postAssigned = true;
    }
  }
  // Object.assign(request, …) / Object.defineProperty(request, …) 同样失败关闭。
  for (let item = Math.max(0, closedAt); item < tokens.length - 3; item++) {
    if (tokens[item].type === 'identifier' && tokens[item].value === 'Object'
      && tokens[item + 1]?.value === '.'
      && ['assign', 'defineProperty'].includes(tokens[item + 2]?.value)
      && tokens[item + 3]?.value === '('
      && tokens[item + 4]?.type === 'identifier' && tokens[item + 4]?.value === 'request') {
      postAssigned = true;
    }
  }
  if (postAssigned) {
    issues.push(`${rel}:1: request 构造后不得再赋值/更新覆盖 mode/validityMode/consent（CF-R2-11）`);
  }
  if (unsafe) {
    issues.push(`${rel}:1: request 硬要求字段不得被同名 getter/method/重复字段覆盖或扩展（CF-R2-11）`);
  }
  if (fields.get('consent')?.type !== 'identifier' || fields.get('consent')?.value !== 'true' || unsafe) {
    issues.push(`${rel}:1: 实际 request 构造必须直接 consent:true 且无重复、扩展或动态覆盖`);
  }
  const expected = [['mode', 'device'], ['validityMode', 'fixed']];
  for (let item = 0; item < expected.length; item++) {
    const [key, value] = expected[item];
    if (unsafe || fields.get(key)?.type !== 'string' || fields.get(key)?.value !== value) issues.push(`${rel}:1: ${pairs[item][1]}`);
  }
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
requireEachText(
  join(ROOT, 'miniprogram/config/runtime.js'),
  [[/allowDeviceOperations\s*:\s*false/, 'runtime.allowDeviceOperations 必须保持 false']],
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
// R10：mode=device 与 validityMode=fixed 分别断言、全部要求；限定在
// 请求构造处（consent:true 锚点窗口），注释命中不算证据，任一缺失单独报错。
const WORKER_FILES = [
  join(ROOT, 'tools/checkin-face-worker/worker-runtime.mjs'),
  join(ROOT, 'tools/checkin-face-worker/claim-and-enroll.mjs'),
];
requireRequestConstruction(WORKER_FILES[0], [
  [/mode\s*:\s*['"]device['"]/, 'worker 请求构造必须显式 mode=device（缺失即失败）'],
  [/validityMode\s*:\s*['"]fixed['"]/, 'worker 请求构造必须显式 validityMode=fixed（缺失即失败）'],
]);
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
