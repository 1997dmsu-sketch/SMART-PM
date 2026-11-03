import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DB08_BASELINE, SCENARIOS, INDEXES, SECURITY_CHECKS,
  resolveConfig, dryRunReport,
} from "./manifest.mjs";
import { createCloudBackend, isCloudProbeBackend, ProbeError } from "./backend.mjs";
import { runTransactionProbe } from "./transaction-probes.mjs";
import { runSecurityProbes } from "./security-probes.mjs";

async function loadSecurityAdapter(config) {
  if (!config.securityAdapter) return null;
  const module = await import(pathToFileURL(resolve(config.securityAdapter)).href);
  const exported = module.default ?? module.securityAdapter ?? module.createSecurityAdapter;
  return typeof exported === "function" ? exported({ config }) : exported;
}

async function loadSecurityVerifier(config, backend) {
  if (!config.securityVerifier) return null;
  const module = await import(pathToFileURL(resolve(config.securityVerifier)).href);
  const exported = module.default ?? module.securityVerifier ?? module.createSecurityVerifier;
  return typeof exported === "function" ? exported({ config, backend }) : exported;
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
  const backendFactory = options.backendFactory || createCloudBackend;
  const backend = await backendFactory(config, env);
  const securityVerifier = options.securityVerifier ||
    (needsSecurity ? await loadSecurityVerifier(config, backend) : null);
  const cloudBackend = isCloudProbeBackend(backend);
  const report = {
    schemaVersion: 2,
    baseline: DB08_BASELINE,
    mode: config.cleanupOnly ? "cleanup-isolated" : config.mode,
    runId: config.runId,
    prefix: config.prefix,
    envId: config.envId,
    organizations: [config.orgA, config.orgB],
    executionScope: cloudBackend ? "isolated-cloud-backend" : "local-only",
    startedAt: new Date().toISOString(),
    results: [],
    plannedIndexes: INDEXES.length,
    plannedSecurityChecks: SECURITY_CHECKS.length,
    indexesCreated: false,
    securityRulesApplied: false,
    cloudEvidenceAccepted: false,
  };
  let failure = null;
  try {
    if (config.cleanupOnly) {
      report.cleanup = await backend.cleanup();
    } else {
      for (const scenario of selected) {
        const beforeCalls = backend.metrics.cloudCalls;
        try {
          let result = scenario.kind === "security"
            ? await runSecurityProbes(securityAdapter, config, { backend, verifier: securityVerifier })
            : await runTransactionProbe(scenario.id, backend);
          const cloudCalls = backend.metrics.cloudCalls - beforeCalls;
          if (scenario.kind !== "security") {
            const evidenceScope = cloudBackend
              ? cloudCalls > 0 ? "isolated-cloud" : "cloud-evidence-missing"
              : "local-only";
            result = { ...result, evidenceScope, cloudCalls };
          }
          if (cloudBackend && result.status === "pass" && cloudCalls === 0)
            throw new ProbeError("CLOUD_EVIDENCE_MISSING",
              `${scenario.id}: 云后端没有观察到任何云调用，不能形成云验收通过`);
          report.results.push({ id: scenario.id, cloudCalls, ...result });
        } catch (error) {
          report.results.push({ id: scenario.id, status: "fail", code: error.code || "ERROR",
            message: error.message, evidenceScope: cloudBackend ? "cloud-evidence-failed" : "local-only" });
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
  report.cloudEvidenceAccepted = !failure && report.results.length > 0 &&
    report.results.every((result) => result.status === "pass" &&
      result.evidenceScope?.startsWith("isolated-cloud"));
  report.status = failure ? "fail" : report.results.some((result) => result.status === "not-run")
    ? "incomplete" : "pass";
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
