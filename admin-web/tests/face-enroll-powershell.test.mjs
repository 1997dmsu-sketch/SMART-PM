import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, copyFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve, isAbsolute } from "node:path";

const windows = process.platform === "win32";
const repository = fileURLToPath(new URL("../../", import.meta.url));
const wrapper = resolve(repository, "tools/hikvision-face-enrollment/Invoke-FaceEnrollment.ps1");
const powershell = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
// Synthetic framing only. This is never a real face or sent to a device.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x46, 0, 1, 0xff, 0xd9]);

async function directory(label) {
  const parent = resolve(repository, "admin-web/.data/face-wrapper-tests");
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, `${label}-`));
}

function run(executable, args, input = "", timeout = 15000) {
  return new Promise((resolveResult, reject) => {
    const started = Date.now();
    let exitElapsedMs;
    const child = spawn(executable, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const output = [], errors = [];
    const timer = setTimeout(() => { child.kill(); reject(Error("synthetic test process exceeded its timeout")); }, timeout);
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", () => { exitElapsedMs = Date.now() - started; });
    child.stdin.on("error", () => {});
    child.on("close", (code) => { clearTimeout(timer); resolveResult({ code, exitElapsedMs, stdout: Buffer.concat(output).toString("utf8"), stderr: Buffer.concat(errors).toString("utf8") }); });
    child.stdin.end(Buffer.from(input, "utf8"));
  });
}

async function invoke(input, outputDirectory, script = wrapper, options = {}) {
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", script];
  if (outputDirectory !== undefined) args.push("-OutputDirectory", outputDirectory);
  if (options.privateConsole) args.push("-PrivateConsoleInput");
  if (options.timeoutSeconds !== undefined) args.push("-TimeoutSeconds", String(options.timeoutSeconds));
  const result = await run(options.executable || powershell, args, Buffer.isBuffer(input) || typeof input === "string" ? input : JSON.stringify(input), options.timeout);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.trim().split(/\r?\n/).length, 1);
  assert(result.stdout.startsWith("{"));
  return { ...result, summary: JSON.parse(result.stdout) };
}

async function fakeEntry(source) {
  const root = await directory("合成 wrapper with spaces");
  const script = join(root, "tools/hikvision-face-enrollment/Invoke-FaceEnrollment.ps1");
  await mkdir(join(root, "tools/hikvision-face-enrollment"), { recursive: true });
  await mkdir(join(root, "admin-web"), { recursive: true });
  await copyFile(wrapper, script);
  await writeFile(join(root, "admin-web/face-enroll.mjs"), source, "utf8");
  return { root, script };
}

test("Windows PowerShell 5.1 parses the wrapper without policy changes", { skip: !windows }, async () => {
  const escaped = wrapper.replaceAll("'", "''");
  const source = `$tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${escaped}',[ref]$tokens,[ref]$errors); [Console]::Out.WriteLine($PSVersionTable.PSVersion.ToString()); if($errors.Count -ne 0){exit 1}`;
  const result = await run(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", source]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^5\.1\./);
  assert.equal(result.stderr, "");
});

test("real PowerShell 5.1 forwards UTF-8 Chinese stdin and saves real simulation evidence", { skip: !windows }, async () => {
  const root = await directory("合成模拟");
  const photoPath = join(root, "合成照片 with spaces.jpg");
  await writeFile(photoPath, jpeg);
  const output = join(root, "新的中文证据");
  const result = await invoke({ name: "合成中文姓名", room: "TEST1205", photoPath, consent: true }, output);
  assert.equal(result.code, 0);
  assert.equal(result.summary.childExitCode, 0);
  assert.equal(result.summary.timedOut, false);
  assert.equal(result.summary.error, null);
  assert.equal(result.summary.evidenceBase, "repository");
  assert(!isAbsolute(result.summary.evidenceRef));
  assert.equal(resolve(repository, result.summary.evidenceRef), output);
  const stdout = await readFile(join(output, "stdout.txt"), "utf8");
  const child = JSON.parse(stdout);
  assert.equal(child.outcome, "simulation-completed");
  assert.equal(child.siteVerification, "NOT_APPLICABLE");
  assert.equal(child.enrollment.name, "合成中文姓名");
  assert.equal(await readFile(join(output, "stderr.txt"), "utf8"), "");
  assert.equal(await readFile(join(output, "exit-code.txt"), "utf8"), "0\n");
  assert(!result.stdout.includes(photoPath));
  assert(!stdout.includes(photoPath));
});

test("Windows quoting keeps only the script path in argv and secrets only in UTF-8 stdin", { skip: !windows }, async () => {
  const fixture = await fakeEntry(`let input=''; for await (const chunk of process.stdin) input+=chunk.toString('utf8'); const value=JSON.parse(input); process.stdout.write(JSON.stringify({protocolVersion:1,outcome:'failed',argvCount:process.argv.length, args:process.argv.slice(2), chineseOk:value.name==='合成中文姓名', pathOk:value.photoPath.endsWith('合成照片.jpg'), credentialsReceived:value.username==='SYNTHETIC_USER'&&value.password==='SYNTHETIC_PASSWORD', configReceived:value.config.token==='SYNTHETIC_TOKEN'})); process.stderr.write('SYNTHETIC_STDERR\\n'); process.exitCode=4;`);
  const output = join(fixture.root, "evidence");
  const request = { name: "合成中文姓名", photoPath: "D:\\synthetic\\合成照片.jpg", username: "SYNTHETIC_USER", password: "SYNTHETIC_PASSWORD", config: { token: "SYNTHETIC_TOKEN" } };
  const result = await invoke(request, output, fixture.script);
  assert.equal(result.code, 4);
  assert.equal(result.summary.childExitCode, 4);
  assert.equal(result.summary.wrapperExitCode, 4);
  assert.equal(result.summary.error, null);
  const raw = await readFile(join(output, "stdout.txt"), "utf8");
  assert.deepEqual(JSON.parse(raw), { protocolVersion: 1, outcome: "failed", argvCount: 2, args: [], chineseOk: true, pathOk: true, credentialsReceived: true, configReceived: true });
  assert.equal(await readFile(join(output, "stderr.txt"), "utf8"), "SYNTHETIC_STDERR\n");
  assert.equal(await readFile(join(output, "exit-code.txt"), "utf8"), "4\n");
  for (const secret of [request.username, request.password, request.config.token, request.photoPath]) assert(!(result.stdout + raw).includes(secret));
});

test("an existing output directory is preserved and prevents starting a child", { skip: !windows }, async () => {
  const output = await directory("existing-output");
  await writeFile(join(output, "keep.txt"), "SYNTHETIC_KEEP", "utf8");
  const result = await invoke({ name: "合成", consent: true }, output);
  assert.equal(result.code, 2);
  assert.equal(result.summary.childExitCode, null);
  assert.equal(result.summary.error, "output-directory-unavailable");
  assert.deepEqual(await readdir(output), ["keep.txt"]);
  assert.equal(await readFile(join(output, "keep.txt"), "utf8"), "SYNTHETIC_KEEP");
});

test("UNC and Windows device output namespaces are rejected before filesystem lookup", { skip: !windows }, async () => {
  for (const output of [
    String.raw`\\synthetic.invalid\share\run`,
    "//synthetic.invalid/share/run",
    String.raw`\\?\C:\synthetic\run`,
    String.raw`\\.\pipe\synthetic`,
    String.raw`\??\C:\synthetic\run`,
    String.raw`\Device\synthetic\run`,
    "CON",
  ]) {
    const result = await invoke({}, output);
    assert.equal(result.code, 2);
    assert.equal(result.summary.childExitCode, null);
    assert.equal(result.summary.evidenceRef, null);
    assert.equal(result.summary.error, "output-directory-local-only");
    assert(!result.stdout.includes(output));
  }
});

test("the stdin limit counts UTF-8 bytes and never saves the rejected input", { skip: !windows }, async () => {
  const root = await directory("input-limit");
  const output = join(root, "evidence");
  const result = await invoke({ synthetic: "合".repeat(12000) }, output);
  assert.equal(result.code, 2);
  assert.equal(result.summary.childExitCode, null);
  assert.equal(result.summary.error, "input-invalid-or-too-large");
  assert.equal(await readFile(join(output, "stdout.txt"), "utf8"), "");
  assert.equal(await readFile(join(output, "stderr.txt"), "utf8"), "");
  assert(!result.stdout.includes("合"));
});

for (const [label, executable] of [["Windows PowerShell 5.1", powershell], ["PowerShell 7", "pwsh.exe"]]) {
  test(`${label} rejects original malformed UTF-8 bytes before starting any child`, { skip: !windows }, async (context) => {
    const fixture = await fakeEntry(`import {writeFileSync} from 'node:fs'; writeFileSync('CHILD_MUST_NOT_START','SYNTHETIC'); process.stdout.write('{"protocolVersion":1,"outcome":"simulation-completed","mode":"simulation","siteVerification":"NOT_APPLICABLE"}');`);
    const malformed = [
      [0xff],                       // Invalid leading byte.
      [0xe4, 0x41, 0x80],           // Invalid continuation byte.
      [0xc0, 0xaf],                 // Overlong form.
      [0xed, 0xa0, 0x80],           // Encoded UTF-16 surrogate.
      [0xf4, 0x90, 0x80, 0x80],     // Above the Unicode scalar range.
      [0xe4, 0xb8],                 // Truncated multibyte sequence.
    ];
    for (const [index, bytes] of malformed.entries()) {
      const input = Buffer.concat([Buffer.from('{"name":"SYNTHETIC'), Buffer.from(bytes), Buffer.from('","consent":true}')]);
      const output = join(fixture.root, `rejected-${index}`);
      let result;
      try { result = await invoke(input, output, fixture.script, { executable }); }
      catch (error) { if (error.code === "ENOENT" && label === "PowerShell 7") { context.skip("PowerShell 7 is not installed"); return; } throw error; }
      assert.equal(result.code, 2, `${label} malformed case ${index}`);
      assert.equal(result.summary.wrapperExitCode, 2);
      assert.equal(result.summary.childExitCode, null);
      assert.equal(result.summary.timedOut, false);
      assert.equal(result.summary.error, "input-invalid-or-too-large");
      assert.equal(await readFile(join(output, "stdout.txt"), "utf8"), "");
      assert.equal(await readFile(join(output, "stderr.txt"), "utf8"), "");
      assert.equal(await readFile(join(output, "exit-code.txt"), "utf8"), "not-started-or-unknown\n");
      assert(!(await readdir(fixture.root)).includes("CHILD_MUST_NOT_START"));
      assert(!result.stdout.includes("SYNTHETIC"));
      assert(!result.stdout.includes("\ufffd"));
    }
  });

  test(`${label} preserves valid replacement characters at the exact 32 KiB input boundary`, { skip: !windows }, async (context) => {
    const fixture = await fakeEntry(`const chunks=[]; for await(const chunk of process.stdin) chunks.push(chunk); const bytes=Buffer.concat(chunks); const value=JSON.parse(bytes.toString('utf8')); process.stdout.write(JSON.stringify({protocolVersion:1,outcome:'failed',nameIntact:value.name==='SYNTHETIC\\ufffd',byteLength:bytes.length})); process.exitCode=4;`);
    const prefix = Buffer.from('{"name":"SYNTHETIC\ufffd","padding":"');
    const suffix = Buffer.from('"}');
    const input = Buffer.concat([prefix, Buffer.alloc(32768 - prefix.length - suffix.length, 0x61), suffix]);
    const output = join(fixture.root, "accepted-boundary");
    let result;
    try { result = await invoke(input, output, fixture.script, { executable }); }
    catch (error) { if (error.code === "ENOENT" && label === "PowerShell 7") { context.skip("PowerShell 7 is not installed"); return; } throw error; }
    assert.equal(result.code, 4);
    assert.equal(result.summary.childExitCode, 4);
    assert.equal(result.summary.wrapperExitCode, 4);
    assert.equal(result.summary.error, null);
    assert.deepEqual(JSON.parse(await readFile(join(output, "stdout.txt"), "utf8")), { protocolVersion: 1, outcome: "failed", nameIntact: true, byteLength: 32768 });
  });
}

test("private console mode fails safely when stdin is a pipe", { skip: !windows }, async () => {
  const root = await directory("private-no-console");
  const result = await invoke({ password: "SYNTHETIC_PRIVATE_INPUT" }, join(root, "evidence"), wrapper, { privateConsole: true });
  assert.equal(result.code, 2);
  assert.equal(result.summary.childExitCode, null);
  assert.equal(result.summary.error, "input-invalid-or-too-large");
  assert(!result.stdout.includes("SYNTHETIC_PRIVATE_INPUT"));
});

test("PowerShell 7 also forwards Chinese simulation input as UTF-8", { skip: !windows }, async (context) => {
  const root = await directory("合成 pwsh7");
  const photoPath = join(root, "合成照片.jpg");
  await writeFile(photoPath, jpeg);
  const output = join(root, "evidence");
  let result;
  try { result = await invoke({ name: "合成中文姓名", room: "TEST1205", photoPath, consent: true }, output, wrapper, { executable: "pwsh.exe" }); }
  catch (error) { if (error.code === "ENOENT") { context.skip("PowerShell 7 is not installed"); return; } throw error; }
  assert.equal(result.code, 0);
  assert.equal(result.summary.childExitCode, 0);
  assert.equal(result.summary.error, null);
  const child = JSON.parse(await readFile(join(output, "stdout.txt"), "utf8"));
  assert.equal(child.outcome, "simulation-completed");
  assert.equal(child.enrollment.name, "合成中文姓名");
});

test("default evidence directories are new and remain relative to the repository", { skip: !windows }, async () => {
  const fakeOutput = { protocolVersion: 1, outcome: "simulation-completed", mode: "simulation", siteVerification: "NOT_APPLICABLE" };
  const fixture = await fakeEntry(`process.stdout.write(${JSON.stringify(JSON.stringify(fakeOutput))});`);
  const first = await invoke({}, undefined, fixture.script);
  const second = await invoke({}, undefined, fixture.script);
  assert.equal(first.code, 0);
  assert.equal(second.code, 0);
  assert.notEqual(first.summary.evidenceRef, second.summary.evidenceRef);
  for (const result of [first, second]) {
    assert.match(result.summary.evidenceRef, /^admin-web\/\.data\/face-runs\/\d{8}T\d{9}-[a-f0-9]{32}\/$/);
    assert.deepEqual(JSON.parse(await readFile(join(fixture.root, result.summary.evidenceRef, "stdout.txt"), "utf8")), fakeOutput);
  }
});

test("a timed out child is terminated once, retains its actual exit code and never reports success", { skip: !windows }, async () => {
  const fixture = await fakeEntry(`process.stdout.write('{"synthetic":"before-timeout"}\\n'); process.stderr.write('SYNTHETIC_WAITING\\n'); setInterval(()=>{},1000);`);
  const output = join(fixture.root, "evidence");
  const started = Date.now();
  const result = await invoke({}, output, fixture.script, { timeoutSeconds: 1 });
  assert(Date.now() - started < 55000);
  assert.equal(result.summary.timedOut, true);
  assert.equal(result.code, 5);
  assert.equal(result.summary.wrapperExitCode, 5);
  assert.notEqual(result.summary.childExitCode, 0);
  assert.equal(await readFile(join(output, "stdout.txt"), "utf8"), '{"synthetic":"before-timeout"}\n');
  assert.equal(await readFile(join(output, "stderr.txt"), "utf8"), "SYNTHETIC_WAITING\n");
  assert.equal(await readFile(join(output, "exit-code.txt"), "utf8"), `${result.summary.childExitCode}\n`);
  assert(!result.stdout.includes("PASS"));
});

test("child zero plus an illegal trailing stdout line is a sticky wrapper failure", { skip: !windows }, async () => {
  const valid = JSON.stringify({ protocolVersion: 1, outcome: "simulation-completed", mode: "simulation", siteVerification: "NOT_APPLICABLE" });
  const raw = `${valid}\nSYNTHETIC_ILLEGAL_TRAILING_LINE\n`;
  const fixture = await fakeEntry(`process.stdout.write(${JSON.stringify(raw)});`);
  const output = join(fixture.root, "evidence");
  const started = Date.now();
  const result = await invoke({}, output, fixture.script);
  assert(Date.now() - started < 5000);
  assert.equal(result.code, 5);
  assert.equal(result.summary.wrapperExitCode, 5);
  assert.equal(result.summary.childExitCode, 0);
  assert.equal(result.summary.error, "child-protocol-invalid");
  assert.equal(await readFile(join(output, "stdout.txt"), "utf8"), raw);
  assert.equal(await readFile(join(output, "exit-code.txt"), "utf8"), "0\n");
});

test("a pipe held by a synthetic grandchild cannot turn incomplete capture into child-zero success", { skip: !windows }, async () => {
  const valid = JSON.stringify({ protocolVersion: 1, outcome: "simulation-completed", mode: "simulation", siteVerification: "NOT_APPLICABLE" });
  const fixture = await fakeEntry(`import {spawn} from 'node:child_process'; const held=spawn(process.execPath,['-e','setTimeout(()=>{},6000)'],{stdio:['ignore',1,2],windowsHide:true,detached:true}); held.unref(); process.stdout.write(${JSON.stringify(valid)}); process.exit(0);`);
  const output = join(fixture.root, "evidence");
  const result = await invoke({}, output, fixture.script);
  assert.equal(result.code, 5);
  assert.equal(result.summary.wrapperExitCode, 5);
  assert.equal(result.summary.childExitCode, 0);
  assert.equal(result.summary.error, "output-capture-incomplete");
  assert(result.exitElapsedMs < 5000);
  assert.equal(await readFile(join(output, "exit-code.txt"), "utf8"), "0\n");
});

test("a child-zero JSON outcome that contradicts its exit code is rejected", { skip: !windows }, async () => {
  const fixture = await fakeEntry(`process.stdout.write('{"protocolVersion":1,"outcome":"failed"}');`);
  const result = await invoke({}, join(fixture.root, "evidence"), fixture.script);
  assert.equal(result.code, 5);
  assert.equal(result.summary.childExitCode, 0);
  assert.equal(result.summary.wrapperExitCode, 5);
  assert.equal(result.summary.error, "child-protocol-invalid");
});
