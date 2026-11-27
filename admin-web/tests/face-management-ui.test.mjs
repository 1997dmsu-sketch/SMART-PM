import test from "node:test";
import assert from "node:assert/strict";
import {
  faceDeviceValidityLabel, faceDoorLabel, faceLibraryStatusLabel,
  followFaceDeletion, mountFaceEnrollment, renderFaceManagement, requestFaceDelete, restoreFacePendingDeletion,
} from "../public/face-ui.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const person = {
  employeeNo: "SYNTHETIC01", name: "合成测试人员", deleteAllowed: true,
  doorRight: "1", RightPlan: [{ doorNo: 1, planTemplateNo: "7" }],
  Valid: { enable: false, beginTime: "1970-01-01T00:00:00", endTime: "1970-01-01T00:00:00" },
  faces: {
    blackFD: { status: "present", libraries: [{ FDID: "7", status: "present" }] },
    infraredFD: { status: "absent", libraries: [{ FDID: "42", status: "absent" }] },
  },
};
const list = { total: 1, complete: true, people: [person] };
const prepared = { employeeNo: person.employeeNo, name: person.name, confirmationToken: "synthetic-single-use-confirmation" };
const final = {
  employeeNo: person.employeeNo, name: person.name, status: "success",
  summary: { total: 1, success: 1, failed: 0, notFound: 0, pending: 0 },
  steps: [{ kind: "face", status: "success", statusCode: 1, statusString: "OK" }],
  list: { total: 0, complete: true, people: [] },
};
const pending = {
  ...final, status: "pending", operationId: "synthetic-operation-01",
  summary: { total: 1, success: 0, failed: 0, notFound: 0, pending: 1 }, list: undefined,
};
const pendingState = {
  operationId: "12345678-1234-1234-1234-123456789abc", employeeNo: person.employeeNo,
  name: person.name, expiresAt: "2026-11-27T12:00:00.000Z",
};

test("management shows exact identity, rights, validity and distinct visible/infrared library states", () => {
  const markup = renderFaceManagement({ list, connected: true }, esc);
  for (const expected of ["人脸登记管理", "总数 1", person.employeeNo, person.name, "门权限 1", "门 1 → 计划 7",
    "长期有效", "可见光已入库", "红外未入库", "删除不可逆，需重新录入才能恢复"])
    assert.ok(markup.includes(expected), expected);
  assert.doesNotMatch(markup, /1970|type="checkbox"|全选|清空|全部删除/);
  assert.match(markup, /data-face-delete="SYNTHETIC01">删除此人员/);
  assert.equal(faceDeviceValidityLabel({ Valid: { enable: true, beginTime: "2026-01-01", endTime: "2026-12-31" } }), "2026-01-01 至 2026-12-31");
  assert.equal(faceDeviceValidityLabel({}), "有效期未确认");
  assert.match(faceDoorLabel({ RightPlan: [] }), /未返回/);
});

test("unknown and unsupported face libraries never render as a confirmed absent or present face", () => {
  assert.equal(faceLibraryStatusLabel({ status: "unknown" }, "blackFD"), "可见光状态未确认");
  assert.equal(faceLibraryStatusLabel({ status: "unsupported" }, "infraredFD"), "红外库不可用");
  assert.equal(faceLibraryStatusLabel(undefined, "blackFD"), "可见光状态未确认");
  assert.equal(faceLibraryStatusLabel({ status: "unexpected" }, "infraredFD"), "红外状态未确认");
});

test("only complete active queries with explicitly permitted valid IDs enable a single-row delete", () => {
  for (const options of [
    { list: { ...list, complete: false }, connected: true },
    { list, connected: false },
    { list, connected: true, modeMatches: false },
    { list, connected: true, busy: true },
    { list, connected: true, deletion: pending },
    { list: { ...list, people: [{ ...person, deleteAllowed: false }] }, connected: true },
    { list: { ...list, people: [{ ...person, employeeNo: "INVALID_01" }] }, connected: true },
  ]) {
    const markup = renderFaceManagement(options, esc);
    assert.match(markup, /data-face-delete="[^"]*" disabled/);
    assert.doesNotMatch(markup, /type="checkbox"|全选|清空|全部删除/);
  }
});

test("management rendering escapes device fields and ignores photo and connection extras", () => {
  const hostile = { ...person, name: '<img src=x onerror="bad()">', employeeNo: '"><script>bad</script>',
    origin: "https://synthetic-secret.invalid", username: "synthetic-private-user",
    password: "synthetic-private-password", faceURL: "https://synthetic-photo.invalid/image.jpg" };
  const markup = renderFaceManagement({ list: { total: 1, complete: true, people: [hostile] }, connected: true }, esc);
  assert.match(markup, /&lt;img/);
  assert.doesNotMatch(markup, /<img|<script>|synthetic-secret|synthetic-private|synthetic-photo|image\.jpg/);
  const resultMarkup = renderFaceManagement({ list, connected: true, deletion: {
    ...final, steps: [{ kind: "<bad>", status: "failed", statusCode: 4, statusString: "<script>device error</script>" }],
  } }, esc);
  assert.match(resultMarkup, /statusCode=4/);
  assert.match(resultMarkup, /statusString=&lt;script&gt;/);
  assert.doesNotMatch(resultMarkup, /<script>|<bad>/);
});

test("pending deletion reports unfinished status and exposes read-only follow-up separately", () => {
  const markup = renderFaceManagement({ connected: true, deletion: pending, listError: "剩余列表尚未确认" }, esc);
  assert.match(markup, /处理中 1/);
  assert.match(markup, /id="face-delete-follow"/);
  assert.match(markup, /不会重新发送删除请求/);
  assert.match(markup, /剩余列表尚未确认/);
  assert.doesNotMatch(markup, /设备未返回已登记人员/);
  const completed = renderFaceManagement({ list: final.list, connected: true, deletion: final }, esc);
  assert.match(completed, /本次删除 1 条：成功 1 \/ 失败 0 \/ 未找到 0/);
  assert.doesNotMatch(completed, /id="face-delete-follow"/);
});

test("invalid, array and unapproved employee inputs produce no API calls", async () => {
  let requests = 0;
  const api = async () => { requests++; };
  for (const candidate of [null, [], [person], { employeeNo: ["A", "B"], deleteAllowed: true },
    { ...person, deleteAllowed: false }, ...["", " ", "SYNTH_01", "SYNTH-01", "../01", "A\nB", "A".repeat(33), "合成人员", " SYNTHETIC01"].map(employeeNo => ({ ...person, employeeNo }))])
    await assert.rejects(requestFaceDelete(candidate, api, async () => true), /一个有效的人员编号/);
  assert.equal(requests, 0);
});

test("canceling the second confirmation only prepares and never confirms deletion", async () => {
  const requests = [], dialogs = [];
  const result = await requestFaceDelete(person, async (path, request) => {
    requests.push({ path, request }); return prepared;
  }, async (title, message) => { dialogs.push({ title, message }); return false; });
  assert.equal(result, null);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].request.data, { action: "prepare", employeeNo: person.employeeNo });
  assert.match(dialogs[0].message, /SYNTHETIC01/);
  assert.ok(dialogs[0].message.includes(person.name));
  assert.match(dialogs[0].message, /删除不可逆，需重新录入才能恢复/);
});

test("confirmed deletion sends exactly one explicit single-use identity-bound confirmation", async () => {
  const requests = [];
  const result = await requestFaceDelete({ ...person, employeeNos: ["OTHER01", "OTHER02"] }, async (path, request) => {
    requests.push({ path, request });
    return request.data.action === "prepare" ? prepared : final;
  }, async () => true);
  assert.deepEqual(result, final);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], { path: "face/delete", request: { method: "POST", data: {
    action: "confirm", employeeNo: person.employeeNo, confirmationToken: prepared.confirmationToken,
    confirmationText: "DELETE " + person.employeeNo,
  } } });
  assert.equal(Object.hasOwn(requests[1].request.data, "employeeNos"), false);
});

test("invalid prepared identities or missing tokens cannot reach a delete confirmation", async () => {
  for (const invalid of [
    { ...prepared, employeeNo: "OTHER01" }, { ...prepared, confirmationToken: "" },
    { ...prepared, confirmationToken: undefined }, { ...prepared, confirmationToken: "bad\nvalue" },
  ]) {
    let requests = 0, dialogs = 0;
    await assert.rejects(requestFaceDelete(person, async () => { requests++; return invalid; },
      async () => { dialogs++; return true; }), /确认资料无效/);
    assert.equal(requests, 1);
    assert.equal(dialogs, 0);
  }
});

test("not-found preparation returns a followable result without a destructive confirmation", async () => {
  let dialogs = 0, requests = 0;
  const missing = { ...final, status: "not-found", summary: { total: 1, success: 0, failed: 0, notFound: 1 } };
  const actual = await requestFaceDelete(person, async () => { requests++; return missing; },
    async () => { dialogs++; return true; });
  assert.equal(actual.status, "not-found");
  assert.equal(requests, 1);
  assert.equal(dialogs, 0);
});

test("leaving the page before or during confirmation prevents the destructive request", async () => {
  for (const point of ["before", "after-prepare", "after-dialog"]) {
    let active = point !== "before", requests = 0;
    const result = await requestFaceDelete(person, async () => {
      requests++; if (point === "after-prepare") active = false; return prepared;
    }, async () => { if (point === "after-dialog") active = false; return true; }, () => active);
    assert.equal(result, null);
    assert.equal(requests, point === "before" ? 0 : 1);
  }
});

test("bounded asynchronous follow-up only requests status and never resubmits a delete", async () => {
  const requests = [], waits = [];
  const result = await followFaceDeletion(pending, async (path, request) => {
    requests.push({ path, request }); return pending;
  }, { wait: async ms => { waits.push(ms); } });
  assert.equal(result.status, "pending");
  assert.equal(requests.length, 3);
  assert.deepEqual(waits, [1000, 1000, 1000]);
  for (const request of requests)
    assert.deepEqual(request, { path: "face/delete", request: { method: "POST", data: { action: "status", id: pending.operationId } } });
  await assert.rejects(followFaceDeletion(pending, async () => final, { maxPolls: 4 }), /跟进次数无效/);
});

test("asynchronous follow-up accepts terminal results and rejects another person's operation", async () => {
  const updates = [];
  const actual = await followFaceDeletion(pending, async () => final,
    { wait: async () => {}, onUpdate: value => updates.push(value) });
  assert.equal(actual.status, "success");
  assert.equal(updates.length, 1);
  for (const invalid of [{ ...final, employeeNo: "OTHER01" }, { ...pending, operationId: "other-operation" }])
    await assert.rejects(followFaceDeletion(pending, async () => invalid, { wait: async () => {} }), /结果不匹配/);
  let active = true, requests = 0;
  await followFaceDeletion(pending, async () => { requests++; return final; },
    { isActive: () => active, wait: async () => { active = false; } });
  assert.equal(requests, 0);
});

test("device UI never re-renders connection inputs or returned connection materials", async (t) => {
  const priorDocument = globalThis.document;
  t.after(() => {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  });
  const control = () => ({ value: "", checked: false, files: [], addEventListener() {} });
  const controls = new Map();
  for (const key of ["#face-refresh", '[name="validityMode"]', "#face-photo", "#face-list"])
    controls.set(key, control());
  const connectForm = {
    elements: {
      mode: { value: "device" }, origin: control(), username: control(), password: control(),
      developmentTls: control(), certificate: control(),
    },
    querySelectorAll: () => [],
  };
  const enrollForm = { elements: {
    employeeNo: control(), name: control(), doorNo: control(), library: control(),
    validityMode: { value: "fixed" }, validFrom: control(), validTo: control(), consent: control(),
  } };
  controls.set("#face-connect-form", connectForm);
  controls.set("#face-enroll-form", enrollForm);
  const root = {
    isConnected: true, innerHTML: "",
    querySelector: selector => controls.get(selector) ?? null,
    querySelectorAll: () => [],
  };
  globalThis.document = { querySelector: () => root };
  const origin = "https://synthetic-private-device.invalid";
  const username = "synthetic-private-device-user";
  const password = "synthetic-private-device-password";
  const toasts = [], requests = [];
  mountFaceEnrollment({ mode: "device", connected: true, device: { origin, username, password },
    capabilities: { libraries: [], doorNumbers: [] }, enrollments: [] }, {
    api: async (path, request) => {
      requests.push({ path, request });
      return { mode: "device", connected: true, device: { origin, username, password },
        capabilities: { libraries: [], doorNumbers: [] }, enrollments: [] };
    },
    esc, icon: () => "", head: () => "", footer: () => "",
    toast: message => toasts.push(message), confirmAction: async () => false, isActive: () => true,
  });
  for (const value of [origin, username, password]) assert.ok(!root.innerHTML.includes(value));
  connectForm.elements.origin.value = origin;
  connectForm.elements.username.value = username;
  connectForm.elements.password.value = password;
  connectForm.onsubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[0].path, "face/connect");
  assert.equal(requests[0].request.data.origin, origin);
  assert.equal(requests[0].request.data.username, username);
  assert.equal(requests[0].request.data.password, password);
  for (const value of [origin, username, password]) {
    assert.ok(!root.innerHTML.includes(value));
    assert.ok(!toasts.join(" ").includes(value));
  }
});

function managementMount(t, api, confirmAction = async () => true, initialState = {}) {
  const priorDocument = globalThis.document;
  t.after(() => {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  });
  const control = () => ({
    value: "", checked: false, files: [], handlers: new Map(),
    addEventListener(event, action) { this.handlers.set(event, action); },
  });
  const controls = new Map();
  for (const selector of ["#face-refresh", '[name="validityMode"]', "#face-photo", "#face-list", "#face-delete-follow"])
    controls.set(selector, control());
  const connectForm = {
    elements: {
      mode: { value: "simulation" }, origin: control(), username: control(), password: control(),
      developmentTls: control(), certificate: control(),
    }, querySelectorAll: () => [],
  };
  const enrollForm = { elements: {
    employeeNo: control(), name: control(), doorNo: control(), library: control(),
    validityMode: { value: "fixed" }, validFrom: control(), validTo: control(), consent: control(),
  } };
  controls.set("#face-connect-form", connectForm);
  controls.set("#face-enroll-form", enrollForm);
  const button = { ...control(), dataset: { faceDelete: person.employeeNo } };
  const root = {
    isConnected: true, innerHTML: "",
    querySelector(selector) {
      if (selector === "#face-delete-follow" && !this.innerHTML.includes('id="face-delete-follow"')) return null;
      return controls.get(selector) ?? null;
    },
    querySelectorAll(selector) {
      return selector === "[data-face-delete]" && this.innerHTML.includes("data-face-delete=") ? [button] : [];
    },
  };
  globalThis.document = { querySelector: () => root };
  mountFaceEnrollment({ mode: "simulation", connected: true, device: {},
    capabilities: { libraries: [], doorNumbers: [] }, enrollments: [], ...initialState }, {
    api, esc, icon: () => "", head: () => "", footer: () => "",
    toast: () => {}, confirmAction, isActive: () => true,
  });
  return { root, controls, button };
}

test("the mounted management flow renders the returned remaining list after one explicit deletion", async (t) => {
  const requests = [];
  const view = managementMount(t, async (path, request) => {
    requests.push({ path, request });
    if (path === "face/list") return list;
    return request.data.action === "prepare" ? prepared : final;
  });
  await view.controls.get("#face-list").handlers.get("click")();
  assert.match(view.root.innerHTML, /data-face-delete="SYNTHETIC01"/);
  view.button.handlers.get("click")();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(view.root.innerHTML, /本次删除 1 条：成功 1/);
  assert.match(view.root.innerHTML, /总数 0/);
  assert.doesNotMatch(view.root.innerHTML, /data-face-delete=/);
  assert.deepEqual(requests.filter(row => row.path === "face/delete").map(row => row.request.data.action), ["prepare", "confirm"]);
});

test("a failed remaining-list refresh does not present an old list as the deletion result", async (t) => {
  const view = managementMount(t, async (path, request) => {
    if (path === "face/list") return list;
    return request.data.action === "prepare" ? prepared : { ...final, list: undefined, refreshError: "合成设备超时" };
  });
  await view.controls.get("#face-list").handlers.get("click")();
  view.button.handlers.get("click")();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(view.root.innerHTML, /本次删除 1 条：成功 1/);
  assert.match(view.root.innerHTML, /剩余列表查询失败/);
  assert.match(view.root.innerHTML, /总数 未查询/);
  assert.doesNotMatch(view.root.innerHTML, /data-face-delete=|设备未返回已登记人员/);
});

test("a lost confirm response can recover through state and status without another delete", async (t) => {
  const requests = [];
  const view = managementMount(t, async (path, request) => {
    requests.push({ path, request });
    if (path === "face/list") return list;
    if (path === "face/state") return { mode: "simulation", connected: true, device: {},
      capabilities: { libraries: [], doorNumbers: [] }, enrollments: [], pendingDelete: pendingState };
    if (request.data.action === "prepare") return prepared;
    if (request.data.action === "status") return final;
    throw Error("合成网络中断");
  });
  await view.controls.get("#face-list").handlers.get("click")();
  view.button.handlers.get("click")();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(view.root.innerHTML, /删除结果未确认，请先刷新状态恢复跟进/);
  assert.doesNotMatch(view.root.innerHTML, /data-face-delete=|本次删除 1 条：成功 1/);
  await view.controls.get("#face-refresh").onclick();
  assert.match(view.root.innerHTML, /id="face-delete-follow"/);
  assert.match(view.root.innerHTML, /处理中 1/);
  assert.doesNotMatch(view.root.innerHTML, /data-face-delete=/);
  await view.controls.get("#face-delete-follow").handlers.get("click")();
  assert.match(view.root.innerHTML, /本次删除 1 条：成功 1/);
  assert.deepEqual(requests.filter(row => row.path === "face/delete").map(row => row.request.data.action), ["prepare", "confirm", "status"]);
  assert.equal(requests.at(-1).request.data.id, pendingState.operationId);
});

test("re-entering with pending state restores only the existing read-only follow-up", async (t) => {
  const requests = [];
  let confirmations = 0;
  const view = managementMount(t, async (path, request) => {
    requests.push({ path, request });
    return final;
  }, async () => { confirmations++; return true; }, { pendingDelete: pendingState });
  assert.match(view.root.innerHTML, /id="face-delete-follow"/);
  assert.match(view.root.innerHTML, /仍有删除任务等待确认结果/);
  assert.match(view.root.innerHTML, /处理中 1/);
  assert.equal(requests.length, 0);
  await view.controls.get("#face-delete-follow").handlers.get("click")();
  assert.deepEqual(requests, [{ path: "face/delete", request: { method: "POST", data: { action: "status", id: pendingState.operationId } } }]);
  assert.equal(confirmations, 0);
  assert.match(view.root.innerHTML, /本次删除 1 条：成功 1/);
});

test("restored pending state retains steps only for the same operation and fails closed on malformed identifiers", () => {
  const previous = { ...pending, operationId: pendingState.operationId,
    steps: [{ kind: "face", status: "success", FDID: "7" }] };
  const state = { connected: true, pendingDelete: pendingState };
  const restored = restoreFacePendingDeletion(state, previous);
  assert.equal(restored.status, "pending");
  assert.equal(restored.operationId, pendingState.operationId);
  assert.deepEqual(restored.steps, previous.steps);
  assert.deepEqual(restored.summary, { total: 1, success: 0, failed: 0, notFound: 0, pending: 1 });
  assert.deepEqual(restoreFacePendingDeletion(state, { ...previous, employeeNo: "OTHER01" }).steps, []);
  assert.deepEqual(restoreFacePendingDeletion(state, { ...previous, operationId: "other-operation" }).steps, []);
  assert.equal(restoreFacePendingDeletion({ connected: true }, final), final);
  assert.equal(restoreFacePendingDeletion({ connected: false, pendingDelete: pendingState }, previous), null);
  const malformed = restoreFacePendingDeletion({ connected: true,
    pendingDelete: { ...pendingState, operationId: "bad\noperation", employeeNo: "../invalid" } });
  assert.equal(malformed.status, "pending");
  assert.equal(malformed.operationId, undefined);
  const markup = renderFaceManagement({ list, connected: true, deletion: malformed }, esc);
  assert.match(markup, /data-face-delete="SYNTHETIC01" disabled/);
  assert.doesNotMatch(markup, /id="face-delete-follow"|bad\noperation|\.\.\/invalid/);
});
