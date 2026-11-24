import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../face-enroll.mjs";

const cliPath = fileURLToPath(new URL("../face-enroll.mjs", import.meta.url));
const outcomes = { 0: "simulation-completed", 2: "invalid-input", 4: "failed", 5: "stopped" };
const syntheticInput = { name: "合成测试人员", room: "TEST1205", consent: true };

function safeOutput(exitCode = 0) {
  return {
    protocolVersion: 1, outcome: outcomes[exitCode], mode: "simulation",
    personnelId: "SYNTHETIC001", roomNote: "TEST1205", validityMode: "unlimited", dailyHours: "24x7",
    siteVerification: "NOT_APPLICABLE",
    device: { model: "模拟门禁设备", firmware: "simulation" },
    enrollment: {
      employeeNo: "SYNTHETIC001", name: "合成测试人员", mode: "simulation", status: exitCode ? "failed" : "ready",
      faceSubmitted: true,
      steps: [{ key: "person", label: "建人", state: "success", message: "" }],
    },
    ...(exitCode ? { error: { code: "COMMAND_FAILED", message: "合成错误", requiresInspection: exitCode === 5 } } : {}),
  };
}

async function invoke({ input = syntheticInput, chunks, stdin, argv = [], run = async () => ({ exitCode: 0, output: safeOutput() }) } = {}) {
  const output = [];
  const errors = [];
  const exitCode = await main({
    argv,
    stdin: stdin || Readable.from(chunks || [Buffer.from(JSON.stringify(input))]),
    stdout: { write: (chunk) => { output.push(String(chunk)); return true; } },
    stderr: { write: (chunk) => { errors.push(String(chunk)); return true; } },
    run,
  });
  const stdout = output.join("");
  assert.equal(output.length, 1, "stdout must be emitted exactly once");
  assert.equal(stdout.split("\n").length, 2, "stdout must contain exactly one JSON line");
  assert.equal(stdout.endsWith("\n"), true);
  return { exitCode, stdout, stderr: errors.join(""), output: JSON.parse(stdout) };
}

function unreadableInput(counter) {
  return { [Symbol.asyncIterator]() { counter.reads++; throw Error("SYNTHETIC_PRIVATE_INPUT"); } };
}

test("help produces one safe JSON line without consuming stdin or invoking the runner", async () => {
  const counter = { reads: 0, runs: 0 };
  const result = await invoke({ argv: ["--help"], stdin: unreadableInput(counter), run: async () => { counter.runs++; throw Error("must not run"); } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.outcome, "help");
  assert.equal(result.output.usage, "node admin-web/face-enroll.mjs");
  assert.match(result.output.input, /内存.*标准输入/);
  assert.doesNotMatch(result.stdout, /config\.json|< /);
  assert.equal(result.stderr, "");
  assert.deepEqual(counter, { reads: 0, runs: 0 });
});

test("unknown and mixed arguments are rejected before reading stdin and never echoed", async () => {
  for (const argv of [["--password=SYNTHETIC_ARG_SECRET"], ["--help", "SYNTHETIC_ARG_SECRET"], ["--photo", "SYNTHETIC_ARG_SECRET"]]) {
    const counter = { reads: 0, runs: 0 };
    const result = await invoke({ argv, stdin: unreadableInput(counter), run: async () => { counter.runs++; } });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr, "UNSUPPORTED_ARGUMENTS\n");
    assert.equal(result.output.error.code, "COMMAND_INPUT_INVALID");
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_ARG_SECRET|--password|--photo/);
    assert.deepEqual(counter, { reads: 0, runs: 0 });
  }
});

test("a single JSON object defaults only an absent mode to simulation", async () => {
  let received;
  const result = await invoke({ run: async (input) => { received = input; return { exitCode: 0, output: safeOutput() }; } });
  assert.equal(received.mode, "simulation");
  assert.equal(received.name, syntheticInput.name);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.output.enrollment.faceSubmitted, true);
  const deviceResult = await invoke({ input: { ...syntheticInput, mode: "device", expectedModel: "SYNTHETIC_EXPECTED_MODEL" }, run: async (input) => {
    assert.equal(input.mode, "device");
    assert.equal(input.expectedModel, "SYNTHETIC_EXPECTED_MODEL");
    return { exitCode: 0, output: { ...safeOutput(), mode: "device", outcome: "device-enrollment-confirmed-pending-site", siteVerification: "PASSED" } };
  } });
  assert.equal(deviceResult.output.siteVerification, "PENDING");
});

test("empty, malformed, invalid UTF-8 and non-object JSON input are rejected safely", async () => {
  for (const chunk of [Buffer.from(""), Buffer.from("{SYNTHETIC_BAD_JSON_SECRET"), Buffer.from([0xff, 0xfe]), Buffer.from("[]"), Buffer.from("null"), Buffer.from('"SYNTHETIC_BAD_JSON_SECRET"')]) {
    let runs = 0;
    const result = await invoke({ chunks: [chunk], run: async () => { runs++; } });
    assert.equal(result.exitCode, 2);
    assert.equal(runs, 0);
    assert.match(result.stderr, /^(INPUT_JSON_INVALID|INPUT_OBJECT_REQUIRED)\n$/);
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_BAD_JSON_SECRET|SyntaxError|at main/);
  }
});

test("stdin is bounded by UTF-8 bytes and accepts a JSON object exactly at 32 KiB", async () => {
  const prefix = '{"padding":"';
  const suffix = '"}';
  const exact = prefix + "x".repeat(32768 - Buffer.byteLength(prefix + suffix)) + suffix;
  assert.equal(Buffer.byteLength(exact), 32768);
  assert.equal((await invoke({ chunks: [Buffer.from(exact).subarray(0, 12000), Buffer.from(exact).subarray(12000)] })).exitCode, 0);
  for (const text of [exact + " ", JSON.stringify({ padding: "中".repeat(11000) })]) {
    let runs = 0;
    const result = await invoke({ chunks: [Buffer.from(text)], run: async () => { runs++; } });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr, "INPUT_TOO_LARGE\n");
    assert.equal(runs, 0);
    assert.doesNotMatch(result.stdout, /padding/);
  }
});

test("interrupted stdin returns an input failure without exposing the stream error", async () => {
  const stdin = Readable.from((async function* () {
    yield Buffer.from('{"name":"');
    throw Error("SYNTHETIC_PRIVATE_STREAM_ERROR C:\\private\\fixture.jpg");
  })());
  let runs = 0;
  const result = await invoke({ stdin, run: async () => { runs++; } });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "INPUT_INTERRUPTED\n");
  assert.equal(runs, 0);
  assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_PRIVATE_STREAM_ERROR|private|fixture\.jpg/);
});

test("runner exit codes 2, 4 and 5 are preserved without retrying", async () => {
  for (const exitCode of [2, 4, 5]) {
    let runs = 0;
    const result = await invoke({ run: async () => { runs++; return { exitCode, output: safeOutput(exitCode) }; } });
    assert.equal(result.exitCode, exitCode);
    assert.equal(result.output.outcome, outcomes[exitCode]);
    assert.equal(runs, 1);
    assert.match(result.stderr, /^[A-Z_]+\n$/);
  }
});

test("successful runner results must remain in the requested known mode", async () => {
  for (const [requested, reported] of [
    ["simulation", "device"], ["device", "simulation"],
    ["simulation", "unknown"], ["device", undefined], ["simulation", null],
  ]) {
    let runs = 0;
    const result = await invoke({ input: { ...syntheticInput, mode: requested }, run: async () => {
      runs++;
      return { exitCode: 0, output: {
        ...safeOutput(), mode: reported,
        outcome: reported === "device" ? "device-enrollment-confirmed-pending-site" : "simulation-completed",
      } };
    } });
    assert.equal(result.exitCode, 5);
    assert.equal(result.output.mode, requested);
    assert.equal(result.output.outcome, "stopped");
    assert.equal(result.output.error.requiresInspection, true);
    assert.equal(result.stderr, "UNEXPECTED_RUNNER_ERROR\n");
    assert.equal(runs, 1);
  }
});

test("runner failures preserve exit codes and project the request mode instead of a conflicting response mode", async () => {
  for (const exitCode of [2, 4, 5]) {
    for (const mode of ["simulation", "device"]) {
      const result = await invoke({ input: { ...syntheticInput, mode }, run: async () => ({
        exitCode, output: { ...safeOutput(exitCode), mode: mode === "device" ? "simulation" : "device" },
      }) });
      assert.equal(result.exitCode, exitCode);
      assert.equal(result.output.mode, mode);
      assert.equal(result.output.outcome, outcomes[exitCode]);
      assert.equal(result.output.siteVerification, mode === "device" ? "PENDING" : "NOT_APPLICABLE");
    }
  }
});

test("unexpected runner errors and invalid responses stop with inspection required and no retry", async () => {
  for (const behavior of [
    async () => { throw Error("SYNTHETIC_RUNNER_SECRET C:\\private\\photo.jpg"); },
    async () => ({ exitCode: 1, output: safeOutput() }),
    async () => ({ exitCode: 4, output: safeOutput() }),
    async () => ({ exitCode: 0, output: [] }),
  ]) {
    let runs = 0;
    const result = await invoke({ run: async () => { runs++; return behavior(); } });
    assert.equal(result.exitCode, 5);
    assert.equal(result.stderr, "UNEXPECTED_RUNNER_ERROR\n");
    assert.equal(result.output.outcome, "stopped");
    assert.equal(result.output.error.requiresInspection, true);
    assert.match(result.output.error.message, /人工检查.*未自动重试/);
    assert.equal(runs, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_RUNNER_SECRET|private|photo\.jpg|Error:|at main/);
  }
});

test("the result allowlist and redaction exclude credentials, paths, base64 and injected nested fields", async () => {
  const input = {
    ...syntheticInput, mode: "device", username: "SYNTHETIC_USERNAME_SECRET", password: "SYNTHETIC_PASSWORD_SECRET",
    photoPath: "C:\\synthetic\\SYNTHETIC_PHOTO_PATH.jpg", certificatePath: "C:\\synthetic\\SYNTHETIC_CERT_PATH.pem",
    photoBase64: "SYNTHETIC_PHOTO_BASE64_SECRET", certificateBase64: "SYNTHETIC_CERT_BASE64_SECRET",
  };
  const secretValues = [input.username, input.password, input.photoPath, input.certificatePath, input.photoBase64, input.certificateBase64];
  const result = await invoke({ input, run: async () => ({ exitCode: 4, output: {
    ...safeOutput(4), password: input.password, photoPath: input.photoPath, certificatePath: input.certificatePath,
    device: { model: "合成设备", firmware: "synthetic", password: input.password },
    enrollment: {
      ...safeOutput(4).enrollment, photoBase64: input.photoBase64, certificateBase64: input.certificateBase64,
      connection: { password: input.password },
      error: secretValues.join(" | "),
      steps: [{ key: "face", label: input.photoPath, state: "failed", message: secretValues.join(" | "), password: input.password }],
    },
    error: { code: "ENROLLMENT_FAILED", message: secretValues.join(" | "), requiresInspection: true, password: input.password },
  } }) });
  for (const secret of secretValues) assert.equal((result.stdout + result.stderr).includes(secret), false);
  assert.doesNotMatch(result.stdout, /"password"|"username"|"photoPath"|"certificatePath"|"photoBase64"|"certificateBase64"|"connection"/);
  assert.equal(result.output.enrollment.steps[0].label, "上传人脸");
  assert.equal(result.stderr, "ENROLLMENT_FAILED\n");
});

test("a spawned CLI completes one simulation with a synthetic JPEG in a self-created temporary directory", { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "smart-pm-face-cli-synthetic-"));
  try {
    const photoPath = join(directory, "synthetic-not-a-person.jpg");
    // Synthetic JPEG framing only: it contains no person and is never sent to a device.
    const syntheticPhoto = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x46, 0, 1, 0xff, 0xd9]);
    await writeFile(photoPath, syntheticPhoto);
    const input = { ...syntheticInput, mode: "simulation", photoPath };
    const child = spawn(process.execPath, [cliPath], { cwd: directory, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const completion = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code));
    });
    const timeout = setTimeout(() => child.kill(), 10000);
    let exitCode;
    try {
      child.stdin.end(JSON.stringify(input));
      exitCode = await completion;
    } finally { clearTimeout(timeout); }
    const text = Buffer.concat(stdout).toString("utf8");
    const errorText = Buffer.concat(stderr).toString("utf8");
    assert.equal(exitCode, 0);
    assert.equal(errorText, "");
    assert.equal(text.split("\n").length, 2);
    const result = JSON.parse(text);
    assert.equal(result.protocolVersion, 1);
    assert.equal(result.outcome, "simulation-completed");
    assert.equal(result.mode, "simulation");
    assert.equal(result.siteVerification, "NOT_APPLICABLE");
    assert.equal(result.enrollment.status, "ready");
    assert.equal(result.dailyHours, "24x7");
    assert.equal(result.validityMode, "unlimited");
    assert.match(result.personnelId, /^[A-Za-z0-9_-]+$/);
    assert.equal(text.includes(photoPath), false);
    assert.equal(text.includes(directory), false);
    assert.equal(text.includes(syntheticPhoto.toString("base64")), false);
    assert.doesNotMatch(text, /photoPath|certificatePath|photoBase64|certificateBase64|刷脸已成功|现场识别成功/);
  } finally {
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith("smart-pm-face-cli-synthetic-"));
    await rm(target, { recursive: true, force: true });
  }
});
