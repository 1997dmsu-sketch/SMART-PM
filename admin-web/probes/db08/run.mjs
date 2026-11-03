import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DB08_BASELINE, SCENARIOS, INDEXES, SECURITY_CHECKS,
  resolveConfig, dryRunReport,
} from "./manifest.mjs";
import { createCloudBackend } from "./backend.mjs";
import { runTransactionProbe } from "./transaction-probes.mjs";
import { runSecurityProbes } from "./security-probes.mjs";

async function loadSecurityAdapter(config) {
  if (!config.securityAdapter) return null;
  const module = await import(pathToFileURL(resolve(config.securityAdapter)).href);
  const exported = module.default ?? module.securityAdapter ?? module.createSecurityAdapter;
  return typeof exported === "function" ? exported({ config }) : exported;
}

function emit(report) {
  console.log(JSON.stringify(report, null, 2));
}

export async function run(args = process.argv.slice(2), env = process.env, options = {}) {
  const config = resolveConfig(args, env);
  if (config.mode === "dry-run") {
    const report = dryRunReport(config);
    emit(report);
    return report;
  }

  const selected = SCENARIOS.filter((scenario) => !config.only.length || config.only.includes(scenario.id));
  const needsSecurity = !config.cleanupOnly && selected.some((scenario) => scenario.kind === "security");
  const securityAdapter = options.securityAdapter || (needsSecurity ? await loadSecurityAdapter(config) : null);
  if (needsSecurity && !securityAdapter)
    throw Error("安全探针需要 DB08_SECURITY_ADAPTER；也可用 --only 明确排除 security-access-rules。管理 SDK 不得代替");

  const backendFactory = options.backendFactory || createCloudBackend;
  const backend = await backendFactory(config, env);
  const report = {
    schemaVersion: 1,
    baseline: DB08_BASELINE,
    mode: config.cleanupOnly ? "cleanup-isolated" : config.mode,
    runId: config.runId,
    prefix: config.prefix,
    envId: config.envId,
    organizations: [config.orgA, config.orgB],
    backendType: backend.constructor.name,
    evidenceScope: backend.constructor.name === "CloudProbeBackend"
      ? "isolated-cloud" : "local-adapter-only-not-cloud-proof",
    startedAt: new Date().toISOString(),
    results: [],
    plannedIndexes: INDEXES.length,
    plannedSecurityChecks: SECURITY_CHECKS.length,
    indexesCreated: false,
    securityRulesApplied: false,
  };
  let failure = null;
  try {
    if (config.cleanupOnly) {
      report.cleanup = await backend.cleanup();
    } else {
      for (const scenario of selected) {
        try {
          const result = scenario.kind === "security"
            ? await runSecurityProbes(securityAdapter, config)
            : await runTransactionProbe(scenario.id, backend);
          report.results.push({ id: scenario.id, ...result });
        } catch (error) {
          report.results.push({ id: scenario.id, status: "fail", code: error.code || "ERROR",
            message: error.message });
          failure = error;
          break;
        }
      }
      report.cleanup = config.keepFixtures
        ? { status: "retained-by-request", prefix: config.prefix,
          cleanupCommand: `node admin-web/probes/db08/run.mjs --execute-isolated --cleanup-only --run-id ${config.runId}` }
        : await backend.cleanup();
    }
  } catch (error) {
    failure ||= error;
    report.cleanup = { status: "failed", message: error.message };
  }
  report.finishedAt = new Date().toISOString();
  report.metrics = { ...backend.metrics };
  report.status = failure ? "fail" : "pass";
  emit(report);
  if (failure) throw failure;
  return report;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  run().catch((error) => {
    console.error(`DB-08 未完成：${error.code ? `${error.code}：` : ""}${error.message}`);
    process.exitCode = 1;
  });
}
