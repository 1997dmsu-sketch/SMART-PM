import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const rounds = Number(process.env.H2D_STABILITY_ROUNDS ?? 20);
if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 100) {
  throw new Error("H2D_STABILITY_ROUNDS 必须是 1–100 的安全整数");
}

const groups = [
  {
    id: "same-slot-race",
    file: "tests/face-grant-d-matrix.test.mjs",
    pattern: "C4 D66",
    expectedPass: 1,
  },
  {
    id: "same-operation-key-race",
    file: "tests/face-grant-d-matrix.test.mjs",
    pattern: "H2-d 同 operation key",
    expectedPass: 1,
  },
  {
    id: "blacklist-retry-success-and-exhaustion",
    file: "tests/face-grant-d-matrix.test.mjs",
    pattern: "C4 D60|C4 D62",
    expectedPass: 2,
  },
  {
    id: "d75-token-and-callback",
    file: "tests/face-grant-d-matrix.test.mjs",
    pattern: "C4 D75",
    expectedPass: 4,
  },
  {
    id: "decode-timeout-recovery",
    file: "tests/face-biometric.test.mjs",
    pattern: "解码超时后槽位可恢复",
    expectedPass: 1,
  },
];

const summaries = [];
for (const group of groups) {
  const started = performance.now();
  const runs = [];
  for (let round = 1; round <= rounds; round += 1) {
    const result = spawnSync(process.execPath, [
      "--test",
      "--test-isolation=none",
      "--test-reporter=tap",
      `--test-name-pattern=${group.pattern}`,
      group.file,
    ], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: process.env,
    });
    const pass = Number(result.stdout.match(/# pass (\d+)/)?.[1] ?? -1);
    const ok = result.status === 0 && pass === group.expectedPass;
    runs.push({ round, ok, pass, status: result.status });
    if (!ok) {
      process.stderr.write(result.stdout);
      process.stderr.write(result.stderr);
      throw new Error(`${group.id} 第 ${round}/${rounds} 轮失败：status=${result.status}, pass=${pass}`);
    }
  }
  const summary = {
    group: group.id,
    rounds,
    failures: runs.filter((item) => !item.ok).length,
    expectedPassPerRound: group.expectedPass,
    durationMs: Math.round(performance.now() - started),
    runs,
  };
  summaries.push(summary);
  console.log(JSON.stringify(summary));
}

console.log(JSON.stringify({
  result: "PASS",
  groups: summaries.length,
  totalRuns: summaries.length * rounds,
  totalFailures: summaries.reduce((sum, item) => sum + item.failures, 0),
}));
