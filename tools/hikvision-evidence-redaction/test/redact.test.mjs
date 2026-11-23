import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { TextDecoder, types } from "node:util";
import vm from "node:vm";

// The driver reads exactly the two business source files below. Every fixture,
// path and expectation is synthetic; no captured/raw evidence file is opened.
// The VM restricts business-module dependencies and globals for this test. It is
// a dependency test, not an operating-system security sandbox.
const TEST_SCOPE = "offline-evidence-path-redaction-tests";
let assertions = 0;
let cases = 0;
let passed = 0;
let failures = 0;

function emit(record) { process.stdout.write(`${JSON.stringify(record)}\n`); }

const checks = Object.freeze({
  equal(actual, expected) { assertions += 1; assert.equal(actual, expected); },
  deepEqual(actual, expected) { assertions += 1; assert.deepEqual(actual, expected); },
  run(caseId, test) {
    const before = assertions;
    cases += 1;
    try {
      test();
      passed += 1;
      emit({ scope: TEST_SCOPE, type: "case", caseId, status: "PASS", assertions: assertions - before });
    } catch {
      failures += 1;
      // Never print an AssertionError, input, actual/expected value or stack.
      emit({ scope: TEST_SCOPE, type: "case", caseId, status: "FAIL", failureClass: "ASSERTION_FAILED", assertions: assertions - before });
    }
  },
});

// This function executes inside the module's realm, so ordinary records,
// arrays, descriptors and Proxy fixtures use the business realm's intrinsics.
// Expected values are independent literals, never production transformations.
function runSyntheticSuite(api, check) {
  const SCOPE = "offline-evidence-path-redaction-only";
  const W = String.raw`D:\SYNTHETIC\workspace`;
  const P = String.raw`C:\Users\SYNTHETIC_USER`;
  const C = (records = 0, stringTokens = 0, changedTokens = 0, worktreeReplacements = 0, profileReplacements = 0) =>
    ({ records, stringTokens, changedTokens, worktreeReplacements, profileReplacements });
  const input = (text = "", format = "text", worktreeRoot = W, profileRoot = P) =>
    ({ text, format, worktreeRoot, profileRoot });
  const captureInput = (stdout = "", stderr = "", worktreeRoot = W, profileRoot = P) =>
    ({ stdout, stderr, worktreeRoot, profileRoot });
  const redact = (text, format = "text", worktreeRoot = W, profileRoot = P) =>
    api.redactEvidenceText(input(text, format, worktreeRoot, profileRoot));

  function frozen(value, seen = new Set()) {
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    check.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) frozen(child, seen);
  }
  function pass(result, text, counts) {
    check.deepEqual(result, { scope: SCOPE, status: "PASS", code: "OK", text, counts });
    frozen(result);
    return result;
  }
  function fail(result, code) {
    check.deepEqual(result, { scope: SCOPE, status: "FAIL", code, text: null, counts: null });
    frozen(result);
    return result;
  }
  function capturePass(result, stdout, stderr, stdoutCounts, stderrCounts) {
    check.deepEqual(result, { scope: SCOPE, status: "PASS", code: "OK", stdout, stderr,
      counts: { stdout: stdoutCounts, stderr: stderrCounts } });
    frozen(result);
    return result;
  }
  function captureFail(result, code) {
    check.deepEqual(result, { scope: SCOPE, status: "FAIL", code, stdout: null, stderr: null, counts: null });
    frozen(result);
    return result;
  }

  const manifest = {
    kind: "synthetic-broker-manifest", status: "PASS", sourceCount: 5,
    sources: [
      { id: "synthetic-source-1", path: String.raw`D:\SYNTHETIC\workspace\source\one.mjs` },
      { id: "synthetic-source-2", path: String.raw`D:\SYNTHETIC\workspace\source\two.mjs` },
      { id: "synthetic-source-3", path: String.raw`D:\SYNTHETIC\workspace\source\three.mjs` },
      { id: "synthetic-source-4", path: String.raw`D:\SYNTHETIC\workspace\source\four.mjs` },
      { id: "synthetic-source-5", path: String.raw`D:\SYNTHETIC\workspace\source\five.mjs` },
    ],
    counts: { scanned: 5, matched: 5, rejected: 0 },
  };
  const expectedManifest = {
    kind: "synthetic-broker-manifest", status: "PASS", sourceCount: 5,
    sources: [
      { id: "synthetic-source-1", path: String.raw`<TASK_WORKTREE>\source\one.mjs` },
      { id: "synthetic-source-2", path: String.raw`<TASK_WORKTREE>\source\two.mjs` },
      { id: "synthetic-source-3", path: String.raw`<TASK_WORKTREE>\source\three.mjs` },
      { id: "synthetic-source-4", path: String.raw`<TASK_WORKTREE>\source\four.mjs` },
      { id: "synthetic-source-5", path: String.raw`<TASK_WORKTREE>\source\five.mjs` },
    ],
    counts: { scanned: 5, matched: 5, rejected: 0 },
  };
  const manifestText = JSON.stringify(manifest);
  const expectedManifestText = JSON.stringify(expectedManifest);

  check.run("RD-01", () => {
    pass(redact(`${W}\\logs\\one.txt | ${P}\\Desktop\\two.txt`),
      String.raw`<TASK_WORKTREE>\logs\one.txt | <USER_PROFILE>\Desktop\two.txt`, C(0, 0, 0, 1, 1));
  });

  check.run("RD-02", () => {
    const original = manifestText;
    const result = pass(redact(manifestText, "json-lines"), expectedManifestText, C(1, 30, 5, 5, 0));
    const parsed = JSON.parse(result.text);
    check.equal(parsed.sources.length, 5);
    check.deepEqual(parsed.sources, expectedManifest.sources);
    check.equal(parsed.status, "PASS");
    check.deepEqual(parsed.counts, { scanned: 5, matched: 5, rejected: 0 });
    check.equal(parsed.sourceCount, 5);
    check.equal(manifestText, original);
    check.equal(JSON.stringify(manifest), original);
  });

  check.run("RD-03", () => {
    const stdout = `${manifestText}\r\n`;
    const stderr = `synthetic stderr ${P}\\Desktop\\capture.txt\n`;
    capturePass(api.prepareRedactedCapture(captureInput(stdout, stderr)), `${expectedManifestText}\r\n`,
      "synthetic stderr <USER_PROFILE>\\Desktop\\capture.txt\n", C(1, 30, 5, 5, 0), C(0, 0, 0, 0, 1));
    check.equal(stdout, `${manifestText}\r\n`);
    check.equal(stderr, `synthetic stderr ${P}\\Desktop\\capture.txt\n`);
  });

  check.run("RD-04", () => {
    pass(redact(String.raw`{"path":"D:\\SYNTHETIC\\workspace\\logs\\a.json"}`, "json-lines"),
      String.raw`{"path":"<TASK_WORKTREE>\\logs\\a.json"}`, C(1, 2, 1, 1, 0));
  });

  check.run("RD-05", () => {
    pass(redact(' { "path" : "D:/SYNTHETIC/workspace/logs/a.json", "status" : "PASS" }\r\n', "json-lines"),
      ' { "path" : "<TASK_WORKTREE>/logs/a.json", "status" : "PASS" }\r\n', C(1, 4, 1, 1, 0));
  });

  check.run("RD-06", () => {
    pass(redact(String.raw`d:/SyNtHeTiC\\//wOrKsPaCe\logs\a.txt; c:/uSeRs\\SYNTHETIC_USER\out.txt`),
      String.raw`<TASK_WORKTREE>\logs\a.txt; <USER_PROFILE>\out.txt`, C(0, 0, 0, 1, 1));
  });

  check.run("RD-07", () => {
    pass(redact(String.raw`{"path":"\u0044\u003a\u005cSYNTHETIC\u005cworkspace\u005clogs\u005ca.txt","tag":"\u0050ASS"}`, "json-lines"),
      String.raw`{"path":"<TASK_WORKTREE>\\logs\\a.txt","tag":"\u0050ASS"}`, C(1, 4, 1, 1, 0));
  });

  check.run("RD-08", () => {
    pass(redact(String.raw`{"path":"D:\/SYNTHETIC\/workspace\/logs\/a.txt"}`, "json-lines"),
      '{"path":"<TASK_WORKTREE>/logs/a.txt"}', C(1, 2, 1, 1, 0));
  });

  check.run("RD-09", () => {
    const text = JSON.stringify({ message: `${W}\\a | ${W}\\b | ${P}\\c` });
    pass(redact(text, "json-lines"),
      JSON.stringify({ message: String.raw`<TASK_WORKTREE>\a | <TASK_WORKTREE>\b | <USER_PROFILE>\c` }), C(1, 2, 1, 2, 1));
  });

  check.run("RD-10", () => {
    const text = ' \t{"status":"PASS", "n":7,"flag":true}\r\n';
    pass(redact(text, "json-lines"), text, C(1, 4));
    pass(redact("SYNTHETIC ordinary text: PASS 5 /ISAPI/System/deviceInfo"),
      "SYNTHETIC ordinary text: PASS 5 /ISAPI/System/deviceInfo", C());
  });

  check.run("RD-11", () => {
    const expected = String.raw`{"path":"<TASK_WORKTREE>\\a.txt"}`;
    const first = pass(redact(String.raw`{"path":"D:\\SYNTHETIC\\workspace\\a.txt"}`, "json-lines"), expected, C(1, 2, 1, 1, 0));
    pass(redact(first.text, "json-lines"), expected, C(1, 2));
    const text = String.raw`<TASK_WORKTREE>\a <USER_PROFILE>\b`;
    pass(redact(text), text, C());
  });

  check.run("RD-12", () => {
    const specialRoot = String.raw`D:\SYNTHETIC\work[space](a)+$^.{root}`;
    pass(redact(`${specialRoot}\\a.txt`, "text", specialRoot), String.raw`<TASK_WORKTREE>\a.txt`, C(0, 0, 0, 1, 0));
    const near = String.raw`D:\SYNTHETIC\workspacesaaaaZroot\a.txt`;
    pass(redact(near, "text", specialRoot), near, C());
  });

  check.run("RD-13", () => {
    const text = `${W}Suffix\\a | ${W}-suffix\\b | ${W}_suffix\\c | ${W}.suffix\\d`;
    pass(redact(text), text, C());
    fail(redact(`${P}Suffix\\a`), "RESIDUAL_PATH");
  });

  check.run("RD-14", () => {
    const nestedWorktree = String.raw`C:\Users\SYNTHETIC_USER\workspace`;
    pass(redact(`${nestedWorktree}\\a | ${P}\\Desktop\\b`, "text", nestedWorktree),
      String.raw`<TASK_WORKTREE>\a | <USER_PROFILE>\Desktop\b`, C(0, 0, 0, 1, 1));
  });

  check.run("RD-15", () => {
    fail(redact(JSON.stringify({ [W]: "SYNTHETIC_VALUE", untouched: `${W}\\a` }), "json-lines"), "SENSITIVE_KEY");
    fail(redact(JSON.stringify({ [P]: "SYNTHETIC_VALUE" }), "json-lines"), "SENSITIVE_KEY");
  });

  check.run("RD-16", () => {
    fail(redact(String.raw`{"C:\\Users\\SYNTHETIC_OTHER\\a":"SYNTHETIC_VALUE"}`, "json-lines"), "SENSITIVE_KEY");
    fail(redact(String.raw`{"\u0044:\\SYNTHETIC\\workspace":"SYNTHETIC_VALUE"}`, "json-lines"), "SENSITIVE_KEY");
  });

  check.run("RD-17", () => {
    for (const path of [String.raw`C:\Users\SYNTHETIC_OTHER\a`, "d:/users/SYNTHETIC_OTHER/a", String.raw`E:\\Users//SYNTHETIC_OTHER\a`]) {
      fail(redact(path), "RESIDUAL_PATH");
      fail(redact(JSON.stringify({ path }), "json-lines"), "RESIDUAL_PATH");
    }
  });

  check.run("RD-18", () => {
    fail(redact(`${manifestText}\n{"later":`, "json-lines"), "INVALID_JSON_LINES");
    fail(redact(`${manifestText}\r\nnot-json\r\n`, "json-lines"), "INVALID_JSON_LINES");
  });

  check.run("RD-19", () => {
    for (const text of ['{"a":1,"a":2}', String.raw`{"a":1,"\u0061":2}`, '{"outer":{"a":1,"a":2}}']) {
      fail(redact(text, "json-lines"), "INVALID_JSON_LINES");
    }
  });

  check.run("RD-20", () => {
    fail(redact('\uFEFF{"ok":true}', "json-lines"), "INVALID_JSON_LINES");
    fail(redact('{"ok":true}\n\uFEFF{"ok":true}', "json-lines"), "INVALID_JSON_LINES");
  });

  check.run("RD-21", () => {
    for (const text of ['{"a":1,}', '[1,]', '{"a":undefined}', '{"a":NaN}', '{"a":1e999}', 'true false', '{"a":"bad\nline"}', '{"a":01}']) {
      fail(redact(text, "json-lines"), "INVALID_JSON_LINES");
    }
  });

  check.run("RD-22", () => {
    const text = ` \t\r\n${String.raw`{"path":"D:\\SYNTHETIC\\workspace\\a"}`}\r\n\t\n{"ok":true}\n`;
    const expected = ` \t\r\n${String.raw`{"path":"<TASK_WORKTREE>\\a"}`}\r\n\t\n{"ok":true}\n`;
    pass(redact(text, "json-lines"), expected, C(2, 3, 1, 1, 0));
  });

  check.run("RD-23", () => {
    for (const text of ["", " \t\r\n\t\n", "\n\n", "\t "]) {
      pass(redact(text, "json-lines"), text, C());
      pass(redact(text), text, C());
    }
  });

  check.run("RD-24", () => {
    const exactAscii = "a".repeat(262144);
    pass(redact(exactAscii), exactAscii, C());
    fail(redact("a".repeat(262145)), "INPUT_TOO_LARGE");
    const exactUtf8 = `${"测".repeat(87381)}a`;
    pass(redact(exactUtf8), exactUtf8, C());
    fail(redact(`${exactUtf8}a`), "INPUT_TOO_LARGE");
  });

  check.run("RD-25", () => {
    const exactLine = `"${"a".repeat(65534)}"`;
    pass(redact(exactLine, "json-lines"), exactLine, C(1, 1));
    fail(redact(`"${"a".repeat(65535)}"`, "json-lines"), "INVALID_JSON_LINES");
    const utf8Line = `"${"测".repeat(21844)}aa"`;
    pass(redact(utf8Line, "json-lines"), utf8Line, C(1, 1));
    fail(redact(`"${"测".repeat(21845)}"`, "json-lines"), "INVALID_JSON_LINES");
  });

  check.run("RD-26", () => {
    const depth16 = `${"[".repeat(16)}0${"]".repeat(16)}`;
    pass(redact(depth16, "json-lines"), depth16, C(1));
    fail(redact(`${"[".repeat(17)}0${"]".repeat(17)}`, "json-lines"), "INVALID_JSON_LINES");
  });

  check.run("RD-27", () => {
    for (const text of ["\ud800", "\udfff", "\ud800x", "x\udfff"]) fail(redact(text), "INVALID_INPUT");
    for (const text of [String.raw`"\ud800"`, String.raw`{"key":"\udfff"}`, String.raw`{"\ud800":1}`]) {
      fail(redact(text, "json-lines"), "INVALID_JSON_LINES");
    }
    pass(redact('"\ud83d\ude00"', "json-lines"), '"\ud83d\ude00"', C(1, 1));
  });

  check.run("RD-28", () => {
    for (const bad of [undefined, null, true, 3, "text", [], () => {}, new Date(0), new Map()]) {
      fail(api.redactEvidenceText(bad), "INVALID_INPUT");
    }
    for (const key of ["text", "format", "worktreeRoot", "profileRoot"]) {
      for (const bad of [undefined, null, 1, true, {}, [], new String("synthetic")]) {
        fail(api.redactEvidenceText({ ...input(), [key]: bad }), "INVALID_INPUT");
      }
      const missing = input();
      delete missing[key];
      fail(api.redactEvidenceText(missing), "INVALID_INPUT");
    }
    for (const format of ["JSON-LINES", "json", " text", "text ", ""]) fail(api.redactEvidenceText(input("", format)), "INVALID_INPUT");
  });

  check.run("RD-29", () => {
    let getterHits = 0;
    for (const key of ["text", "format", "worktreeRoot", "profileRoot"]) {
      const record = input();
      Object.defineProperty(record, key, { enumerable: true, get() { getterHits += 1; throw new Error("SYNTHETIC_MUST_NOT_SURFACE"); } });
      fail(api.redactEvidenceText(record), "INVALID_INPUT");
    }
    let proxyHits = 0;
    const hostile = new Proxy(input(), {
      get() { proxyHits += 1; throw new Error("SYNTHETIC_MUST_NOT_SURFACE"); },
      ownKeys() { proxyHits += 1; throw new Error("SYNTHETIC_MUST_NOT_SURFACE"); },
      getPrototypeOf() { proxyHits += 1; throw new Error("SYNTHETIC_MUST_NOT_SURFACE"); },
      getOwnPropertyDescriptor() { proxyHits += 1; throw new Error("SYNTHETIC_MUST_NOT_SURFACE"); },
    });
    fail(api.redactEvidenceText(hostile), "INVALID_INPUT");
    const revoked = Proxy.revocable(input(), {});
    revoked.revoke();
    fail(api.redactEvidenceText(revoked.proxy), "INVALID_INPUT");
    check.equal(getterHits, 0);
    check.equal(proxyHits, 0);
  });

  check.run("RD-30", () => {
    fail(api.redactEvidenceText({ ...input(), unknown: "synthetic" }), "INVALID_INPUT");
    const symbol = input(); symbol[Symbol("synthetic")] = "synthetic";
    fail(api.redactEvidenceText(symbol), "INVALID_INPUT");
    const hidden = input(); Object.defineProperty(hidden, "hidden", { value: "synthetic" });
    fail(api.redactEvidenceText(hidden), "INVALID_INPUT");
    const hiddenRequired = input(); Object.defineProperty(hiddenRequired, "text", { value: "", enumerable: false });
    fail(api.redactEvidenceText(hiddenRequired), "INVALID_INPUT");
    const inherited = Object.create(input());
    fail(api.redactEvidenceText(inherited), "INVALID_INPUT");
    const customPrototype = Object.assign(Object.create({ synthetic: true }), input());
    fail(api.redactEvidenceText(customPrototype), "INVALID_INPUT");
    const nullPrototype = Object.assign(Object.create(null), input(`${W}\\a`));
    pass(api.redactEvidenceText(nullPrototype), String.raw`<TASK_WORKTREE>\a`, C(0, 0, 0, 1, 0));
  });

  check.run("RD-31", () => {
    for (const badRoot of ["", "D:", "D:\\", "relative\\root", "\\\\SYNTHETIC\\share", String.raw`D:\a\..\b`,
      String.raw`D:\a\.\b`, String.raw`D:\a\bad?`, String.raw`D:\a\bad*`, String.raw`D:\a\bad:part`,
      String.raw`D:\a\bad|part`, String.raw`D:\a\bad<part`, String.raw`D:\a\bad>part`, String.raw`D:\a\bad"part`,
      "D:\\a\\bad\npart", "D:\\a\\trailing ", "D:\\a\\trailing.", String.raw`D:\a\CON`]) {
      fail(api.redactEvidenceText(input("", "text", badRoot)), "INVALID_ROOT");
    }
    for (const badRoot of ["C:\\", String.raw`C:\Users`, String.raw`C:\Users\SYNTHETIC_USER\nested`,
      String.raw`C:\People\SYNTHETIC_USER`, String.raw`C:\Users\..`, String.raw`C:\Users\bad?`]) {
      fail(api.redactEvidenceText(input("", "text", W, badRoot)), "INVALID_ROOT");
    }
  });

  check.run("RD-32", () => {
    pass(redact(String.raw`D:\SYNTHETIC\workspace\a | C:\Users\SYNTHETIC_USER\b`, "text", "d:/synthetic/workspace/", "c:/users/SYNTHETIC_USER/"),
      String.raw`<TASK_WORKTREE>\a | <USER_PROFILE>\b`, C(0, 0, 0, 1, 1));
  });

  check.run("RD-33", () => {
    const text = String.raw` {"path":"D:\\SYNTHETIC\\workspace\\a","large":900719925474099312345, "negative":-0,"exponent":1.2300e+04,"utc":"2026-11-23T00:00:00.000Z"} `;
    const expected = String.raw` {"path":"<TASK_WORKTREE>\\a","large":900719925474099312345, "negative":-0,"exponent":1.2300e+04,"utc":"2026-11-23T00:00:00.000Z"} `;
    pass(redact(text, "json-lines"), expected, C(1, 7, 1, 1, 0));
  });

  check.run("RD-34", () => {
    // Path redaction deliberately preserves unrelated synthetic sensitive data.
    // This assertion does not claim password/token/IP or general secret DLP.
    const text = String.raw`{"username":"SYNTHETIC_USER","password":"SYNTHETIC_PASSWORD","token":"SYNTHETIC_TOKEN","address":"192.0.2.10","path":"D:\\SYNTHETIC\\workspace\\a"}`;
    const expected = String.raw`{"username":"SYNTHETIC_USER","password":"SYNTHETIC_PASSWORD","token":"SYNTHETIC_TOKEN","address":"192.0.2.10","path":"<TASK_WORKTREE>\\a"}`;
    pass(redact(text, "json-lines"), expected, C(1, 10, 1, 1, 0));
  });

  check.run("RD-35", () => {
    captureFail(api.prepareRedactedCapture(captureInput(`${manifestText}\n{"broken":`, `${P}\\stderr.txt`)), "INVALID_JSON_LINES");
    captureFail(api.prepareRedactedCapture(captureInput(manifestText, String.raw`C:\Users\SYNTHETIC_OTHER\stderr.txt`)), "RESIDUAL_PATH");
    captureFail(api.prepareRedactedCapture(captureInput(String.raw`{"C:\\Users\\SYNTHETIC_OTHER":"value"}`, `${P}\\stderr.txt`)), "SENSITIVE_KEY");
  });

  check.run("RD-36", () => {
    for (const bad of [undefined, null, [], "synthetic", 1]) captureFail(api.prepareRedactedCapture(bad), "INVALID_INPUT");
    for (const key of ["stdout", "stderr", "worktreeRoot", "profileRoot"]) {
      captureFail(api.prepareRedactedCapture({ ...captureInput(), [key]: new String("synthetic") }), "INVALID_INPUT");
      const missing = captureInput(); delete missing[key];
      captureFail(api.prepareRedactedCapture(missing), "INVALID_INPUT");
    }
    captureFail(api.prepareRedactedCapture({ ...captureInput(), format: "text" }), "INVALID_INPUT");
    const symbol = captureInput(); symbol[Symbol("synthetic")] = "synthetic";
    captureFail(api.prepareRedactedCapture(symbol), "INVALID_INPUT");
    const hidden = captureInput(); Object.defineProperty(hidden, "hidden", { value: "synthetic" });
    captureFail(api.prepareRedactedCapture(hidden), "INVALID_INPUT");
    let invoked = 0;
    const getter = captureInput();
    Object.defineProperty(getter, "stderr", { enumerable: true, get() { invoked += 1; throw new Error("SYNTHETIC_MUST_NOT_SURFACE"); } });
    captureFail(api.prepareRedactedCapture(getter), "INVALID_INPUT");
    const proxy = new Proxy(captureInput(), { ownKeys() { invoked += 1; throw new Error("SYNTHETIC_MUST_NOT_SURFACE"); } });
    captureFail(api.prepareRedactedCapture(proxy), "INVALID_INPUT");
    check.equal(invoked, 0);
  });

  check.run("RD-37", () => {
    capturePass(api.prepareRedactedCapture(captureInput()), "", "", C(), C());
    const record = Object.assign(Object.create(null), captureInput('{"status":"PASS"}\n', "synthetic stderr\n"));
    capturePass(api.prepareRedactedCapture(record), '{"status":"PASS"}\n', "synthetic stderr\n", C(1, 2), C());
  });

  check.run("RD-38", () => {
    const text = `["${String.raw`D:\\SYNTHETIC\\workspace\\a`}",{"k":"${String.raw`C:\\Users\\SYNTHETIC_USER\\b`}"},3,true,null]`;
    const expected = String.raw`["<TASK_WORKTREE>\\a",{"k":"<USER_PROFILE>\\b"},3,true,null]`;
    pass(redact(text, "json-lines"), expected, C(1, 3, 2, 1, 1));
    pass(redact('900719925474099312345\n-0\n1.20e+04\ntrue\nnull\n', "json-lines"),
      '900719925474099312345\n-0\n1.20e+04\ntrue\nnull\n', C(5));
    pass(redact(String.raw`"D:\\SYNTHETIC\\workspace\\a"`, "json-lines"), String.raw`"<TASK_WORKTREE>\\a"`, C(1, 1, 1, 1, 0));
  });

  check.run("RD-39", () => {
    const record = input(`${W}\\a`);
    const before = Object.getOwnPropertyDescriptors(record);
    Object.freeze(record);
    const frozenBefore = Object.getOwnPropertyDescriptors(record);
    pass(api.redactEvidenceText(record), String.raw`<TASK_WORKTREE>\a`, C(0, 0, 0, 1, 0));
    check.deepEqual(Object.getOwnPropertyDescriptors(record), frozenBefore);
    check.equal(before.text.value, record.text);
    const capture = Object.freeze(captureInput(manifestText, `${P}\\a`));
    const captureBefore = Object.getOwnPropertyDescriptors(capture);
    capturePass(api.prepareRedactedCapture(capture), expectedManifestText, String.raw`<USER_PROFILE>\a`, C(1, 30, 5, 5, 0), C(0, 0, 0, 0, 1));
    check.deepEqual(Object.getOwnPropertyDescriptors(capture), captureBefore);
  });

  check.run("RD-40", () => {
    const text = `(${W}), [${P}]; ${W}\n${P}\t${W}`;
    pass(redact(text), "(<TASK_WORKTREE>), [<USER_PROFILE>]; <TASK_WORKTREE>\n<USER_PROFILE>\t<TASK_WORKTREE>", C(0, 0, 0, 3, 2));
  });

  check.run("RD-41", () => {
    captureFail(api.prepareRedactedCapture(captureInput(manifestText, "a".repeat(262145))), "INPUT_TOO_LARGE");
    captureFail(api.prepareRedactedCapture(captureInput('"synthetic"', "\ud800")), "INVALID_INPUT");
    captureFail(api.prepareRedactedCapture(captureInput("", "", "D:\\")), "INVALID_ROOT");
    captureFail(api.prepareRedactedCapture(captureInput('"synthetic"', "", W, "C:\\Users")), "INVALID_ROOT");
  });

  check.run("RD-42", () => {
    const text = String.raw`{"unchanged":"keep\\n\u0041\/","path":"D:\\SYNTHETIC\\workspace\\a","empty":"","boolean":false}`;
    const expected = String.raw`{"unchanged":"keep\\n\u0041\/","path":"<TASK_WORKTREE>\\a","empty":"","boolean":false}`;
    pass(redact(text, "json-lines"), expected, C(1, 7, 1, 1, 0));
  });

  check.run("RD-43", () => {
    // One JSON decoding layer exposes repeated actual separator characters.
    const text = String.raw`{"path":"D:\\\\SYNTHETIC\\\\workspace\\a"}`;
    pass(redact(text, "json-lines"), String.raw`{"path":"<TASK_WORKTREE>\\a"}`, C(1, 2, 1, 1, 0));
  });

  check.run("RD-44", () => {
    // Limited encoded-path detection fails closed; it is not a general decoder.
    fail(redact("C%3A%5CUsers%5CSYNTHETIC_OTHER%5Ca"), "RESIDUAL_PATH");
    fail(redact(String.raw`D:\u005cSYNTHETIC\u005cworkspace\u005ca`), "RESIDUAL_PATH");
    fail(redact(String.raw`{"path":"C%3A%5CUsers%5CSYNTHETIC_OTHER%5Ca"}`, "json-lines"), "RESIDUAL_PATH");
    fail(redact(String.raw`{"C%3A%5CUsers%5CSYNTHETIC_OTHER":"synthetic"}`, "json-lines"), "SENSITIVE_KEY");
  });

  check.run("RD-45", () => {
    // Required input validation runs before source processing. Error objects
    // never contain the synthetic material, even when multiple fields are bad.
    fail(api.redactEvidenceText({ ...input(String.raw`C:\Users\SYNTHETIC_OTHER\secret`), unexpected: "SYNTHETIC_ERROR_MATERIAL" }), "INVALID_INPUT");
    fail(api.redactEvidenceText(input("\ud800", "text", "invalid-root")), "INVALID_INPUT");
    fail(api.redactEvidenceText(input("a".repeat(262145), "text", "invalid-root")), "INPUT_TOO_LARGE");
  });

  check.run("RD-46", () => {
    for (const name of ["process", "fs", "net", "fetch", "setTimeout", "setInterval", "require"]) check.equal(typeof globalThis[name], "undefined");
    check.equal(typeof api.redactEvidenceText, "function");
    check.equal(typeof api.prepareRedactedCapture, "function");
    check.deepEqual(Object.keys(api).sort(), ["prepareRedactedCapture", "redactEvidenceText"]);
  });

  check.run("RD-47", () => {
    fail(api.redactEvidenceText(input("", "text", String.raw`D:\Users`)), "INVALID_ROOT");
    fail(api.redactEvidenceText(input("", "text", String.raw`C:\Users`)), "INVALID_ROOT");
    fail(api.redactEvidenceText(input("", "text", `D:\\${"a".repeat(1022)}`)), "INVALID_ROOT");
    fail(api.redactEvidenceText(input("", "text", W, `C:\\Users\\${"a".repeat(1016)}`)), "INVALID_ROOT");
    pass(redact(`${P}\\a`, "text", P), String.raw`<TASK_WORKTREE>\a`, C(0, 0, 0, 1, 0));
  });

  check.run("RD-48", () => {
    const sensitiveKey = String.raw`{"C:\\Users\\SYNTHETIC_OTHER":"synthetic"}`;
    const residualValue = String.raw`{"path":"C:\\Users\\SYNTHETIC_OTHER\\a"}`;
    fail(redact(`${sensitiveKey}\n{"broken":`, "json-lines"), "INVALID_JSON_LINES");
    fail(redact(`${residualValue}\n{"broken":`, "json-lines"), "INVALID_JSON_LINES");
    captureFail(api.prepareRedactedCapture(captureInput(`${sensitiveKey}\n{"broken":`, `${P}\\stderr`)), "INVALID_JSON_LINES");
  });

  check.run("RD-49", () => {
    for (const text of ["\r", " \t\r", '{"ok":true}\r', '{"ok":true}\r{"ok":false}']) {
      fail(redact(text, "json-lines"), "INVALID_JSON_LINES");
      pass(redact(text), text, C());
    }
    captureFail(api.prepareRedactedCapture(captureInput("\r", `${P}\\stderr`)), "INVALID_JSON_LINES");
    pass(redact(`${W}\\a\r${P}\\b`), "<TASK_WORKTREE>\\a\r<USER_PROFILE>\\b", C(0, 0, 0, 1, 1));
  });

  check.run("RD-50", () => {
    // Embedded known-root fragments intentionally match without a left
    // boundary, including adjacent natural-language explanation text.
    pass(redact(`prefix${W}\\a | 合成说明${P}\\b`), "prefix<TASK_WORKTREE>\\a | 合成说明<USER_PROFILE>\\b", C(0, 0, 0, 1, 1));
    pass(redact(JSON.stringify({ message: `prefix${W}\\a` }), "json-lines"),
      String.raw`{"message":"prefix<TASK_WORKTREE>\\a"}`, C(1, 2, 1, 1, 0));
  });
}

try {
  const redactorUrl = new URL("../src/redact.mjs", import.meta.url);
  const bytesUrl = new URL("../../hikvision-offline-entry/src/bytes.mjs", import.meta.url);
  const [redactorSource, bytesSource] = await Promise.all([
    readFile(redactorUrl, "utf8"), readFile(bytesUrl, "utf8"),
  ]);
  const context = vm.createContext({ Buffer }, { codeGeneration: { strings: false, wasm: false } });
  const utilModule = new vm.SyntheticModule(["TextDecoder", "types"], function initialize() {
    this.setExport("TextDecoder", TextDecoder);
    this.setExport("types", types);
  }, { context, identifier: "node:util" });
  const bytesModule = new vm.SourceTextModule(bytesSource, { context, identifier: bytesUrl.href });
  const redactorModule = new vm.SourceTextModule(redactorSource, { context, identifier: redactorUrl.href });
  await redactorModule.link((specifier, referencingModule) => {
    if (specifier === "node:util") return utilModule;
    if (referencingModule === redactorModule && specifier === "../../hikvision-offline-entry/src/bytes.mjs") return bytesModule;
    throw new Error("UNAPPROVED_DEPENDENCY");
  });
  await redactorModule.evaluate({ timeout: 10000 });
  context.syntheticRedactionApi = redactorModule.namespace;
  context.syntheticChecks = checks;
  vm.runInContext(`(${runSyntheticSuite.toString()})(syntheticRedactionApi, syntheticChecks)`, context, { timeout: 30000 });
} catch {
  failures += 1;
  emit({ scope: TEST_SCOPE, type: "harness", status: "FAIL", failureClass: "HARNESS_ERROR" });
}

emit({ scope: TEST_SCOPE, type: "summary", status: failures === 0 ? "PASS" : "FAIL", cases,
  passed, failed: failures, assertions });
if (failures !== 0) process.exitCode = 1;
