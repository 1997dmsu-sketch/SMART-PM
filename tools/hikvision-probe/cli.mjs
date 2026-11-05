#!/usr/bin/env node
/**
 * 海康只读 capability 探针 CLI。
 *
 * 默认 dry-run：只打印将要访问的白名单端点，不发起任何网络请求。
 * 只有显式设置 HIKVISION_PROBE_ALLOW_READ=true 才会连接设备。
 *
 * 环境变量（只列名称）：
 *   HIKVISION_PROBE_ALLOW_READ      true 才允许发请求
 *   HIKVISION_PROBE_HOST            目标设备地址（必须在允许列表内）
 *   HIKVISION_PROBE_ALLOWED_HOSTS   允许访问的主机，逗号分隔
 *   HIKVISION_PROBE_PORT            默认 443
 *   HIKVISION_PROBE_ALLOWED_PORTS   默认 443,8443
 *   HIKVISION_PROBE_USERNAME        设备账号
 *   HIKVISION_PROBE_PASSWORD        设备密码（只用于 Digest 计算，不落盘）
 *   HIKVISION_PROBE_CA_PEM          受控 CA 文件路径
 *   HIKVISION_PROBE_FINGERPRINT256  证书 SHA-256 指纹（固定）
 *   HIKVISION_PROBE_OUT_DIR         报告与原始响应目录（默认系统临时目录）
 *   HIKVISION_PROBE_TIMEOUT_MS      默认 10000
 *   HIKVISION_PROBE_MAX_BYTES       默认 262144
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listEndpoints, parseAllowedHosts, parseAllowedPorts } from "./src/allowlist.mjs";
import { httpsGet } from "./src/http.mjs";
import { runProbe } from "./src/probe.mjs";

const env = process.env;

function numberEnv(name, fallback) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function loadCa() {
  if (!env.HIKVISION_PROBE_CA_PEM) return undefined;
  return readFile(env.HIKVISION_PROBE_CA_PEM, "utf8");
}

async function main() {
  const allowRead = env.HIKVISION_PROBE_ALLOW_READ === "true";
  const config = {
    allowRead,
    host: env.HIKVISION_PROBE_HOST || "",
    port: Number(env.HIKVISION_PROBE_PORT || 443),
    allowedHosts: parseAllowedHosts(env.HIKVISION_PROBE_ALLOWED_HOSTS || env.HIKVISION_PROBE_HOST || ""),
    allowedPorts: parseAllowedPorts(env.HIKVISION_PROBE_ALLOWED_PORTS),
    username: env.HIKVISION_PROBE_USERNAME || "",
    password: env.HIKVISION_PROBE_PASSWORD || "",
    ca: await loadCa(),
    fingerprint256: env.HIKVISION_PROBE_FINGERPRINT256 || "",
    timeoutMs: numberEnv("HIKVISION_PROBE_TIMEOUT_MS", 10_000),
    maxBytes: numberEnv("HIKVISION_PROBE_MAX_BYTES", 262_144),
    salt: env.HIKVISION_PROBE_SALT || "smart-pm-probe",
  };

  const endpointCount = listEndpoints().length;
  const result = await runProbe({ config, transport: httpsGet });

  if (result.mode === "dry-run") {
    console.log("DRY-RUN：未发起任何网络请求");
    console.log(`白名单端点 ${endpointCount} 个：`);
    for (const item of result.plan) console.log(`  ${item.method} ${item.path}`);
    console.log("\n确认环境后设置 HIKVISION_PROBE_ALLOW_READ=true 才会执行只读探针。");
    return 0;
  }

  const outDir = env.HIKVISION_PROBE_OUT_DIR || join(tmpdir(), `hikvision-probe-${Date.now()}`);
  await mkdir(outDir, { recursive: true, mode: 0o700 });

  for (const item of result.results) {
    if (!item.body?.length) continue;
    const safeName = item.id.replace(/[^a-z0-9_-]/gi, "_");
    await writeFile(join(outDir, `${safeName}.raw`), item.body, { mode: 0o600 });
  }

  const reportPath = join(outDir, "report.json");
  await writeFile(reportPath, JSON.stringify(result.report, null, 2), "utf8");

  const ok = result.report.checks.filter((check) => check.ok).length;
  console.log(`只读探针完成：${ok}/${result.report.checks.length} 个端点成功`);
  if (result.report.device?.model) console.log(`设备型号：${result.report.device.model}`);
  if (result.report.device?.firmwareVersion) console.log(`固件版本：${result.report.device.firmwareVersion}`);
  for (const check of result.report.checks) {
    console.log(`  ${check.ok ? "OK  " : "FAIL"} ${check.id.padEnd(22)} ${check.status || "-"} ${check.error || ""}`);
  }
  console.log(`\n报告：${reportPath}`);
  console.log("原始响应已写入同一目录（权限 600），仅用于受控分析，禁止提交 Git。");

  return ok === result.report.checks.length ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`探针中止：${error.code || ""} ${error.message}`);
    process.exitCode = 2;
  });
