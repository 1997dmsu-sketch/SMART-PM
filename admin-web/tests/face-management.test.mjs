import { test } from "node:test";
import assert from "node:assert/strict";
import { FaceEnrollmentService, HikvisionFaceProvider, SimulatedFaceProvider } from "../lib/face-enrollment.mjs";

const libraries = [{ FDID: "1", faceLibType: "blackFD" }, { FDID: "2", faceLibType: "infraredFD" }];
const person = (id = "EMP1", name = "合成人员") => ({
  employeeNo: id, name, doorRight: "1", RightPlan: [{ doorNo: 1, planTemplateNo: "1" }],
  Valid: { enable: false, beginTime: "1970-01-01T00:00:00", endTime: "1970-01-01T00:00:00" },
  password: "SENSITIVE_PASSWORD_SENTINEL", cardNo: "SENSITIVE_CARD_SENTINEL",
  faceURL: "https://private-device.invalid/photo.jpg",
});
const reply = (value, status = 200) => ({ status, body: Buffer.from(JSON.stringify(value)) });
const faceKey = (library, id) => [library.faceLibType, library.FDID, id].join(":");

class SyntheticClient {
  constructor(people = [person()]) {
    this.people = new Map(people.map(row => [row.employeeNo, structuredClone(row)]));
    this.faces = new Set(people.flatMap(row => libraries.map(library => faceKey(library, row.employeeNo))));
    this.calls = [];
    this.progress = "success";
    this.personDeleteMode = "instant";
  }
  async request(request) {
    const body = request.body ? JSON.parse(request.body.toString("utf8")) : undefined;
    this.calls.push({ method: request.method, path: request.path, body });
    if (request.method === "POST" && request.path === "/ISAPI/AccessControl/UserInfo/Search?format=json") {
      if (this.failNextPersonRead) { this.failNextPersonRead = false; throw Object.assign(new Error("Synthetic read timeout"), { code: "HIKVISION_TIMEOUT" }); }
      const condition = body.UserInfoSearchCond;
      const all = [...this.people.values()].filter(row => !condition.EmployeeNoList || condition.EmployeeNoList.some(filter => filter.employeeNo === row.employeeNo));
      const rows = all.slice(condition.searchResultPosition, condition.searchResultPosition + condition.maxResults);
      if (!all.length && this.emptyPersonResponse) return reply({ UserInfoSearch: structuredClone(this.emptyPersonResponse) });
      return reply({ UserInfoSearch: { totalMatches: all.length, numOfMatches: rows.length, responseStatusStrg: !all.length ? "NO MATCH" : condition.searchResultPosition + rows.length < all.length ? "MORE" : "OK", UserInfo: rows } });
    }
    if (request.method === "POST" && request.path === "/ISAPI/Intelligent/FDLib/FDSearch?format=json") {
      if (this.failFaceSearch === "transport") throw Object.assign(new Error("Synthetic face search failure"), { code: "HIKVISION_TIMEOUT" });
      if (this.failFaceSearch === "device-rejection") return reply({ statusCode: 4, statusString: "Invalid Operation", subStatusCode: "notSupport" }, 400);
      const exists = this.faces.has(faceKey(body, body.FPID));
      if (!exists && this.emptyFaceResponse) return reply(this.emptyFaceResponse(body));
      const row = { FPID: body.FPID, isInLibrary: exists && this.notModeledFaceType !== body.faceLibType ? "yes" : "no", faceURL: "https://private-device.invalid/face.jpg" };
      if (this.unknownFaceType === body.faceLibType || this.unknownFaceFDID === body.FDID) delete row.isInLibrary;
      return reply({ totalMatches: exists ? 1 : 0, numOfMatches: exists ? 1 : 0, MatchList: exists ? [row] : [] });
    }
    if (request.method === "GET" && request.path === "/ISAPI/AccessControl/UserInfoDetail/DeleteProcess?format=json") {
      return reply({ UserInfoDetailDeleteProcess: { status: this.progress } });
    }
    if (request.method === "PUT" && request.path.startsWith("/ISAPI/Intelligent/FDLib/FDSearch/Delete?")) {
      const url = new URL("https://synthetic.invalid" + request.path);
      const library = { FDID: url.searchParams.get("FDID"), faceLibType: url.searchParams.get("faceLibType") };
      assert.deepEqual(Object.keys(body), ["FPID"]);
      assert.equal(body.FPID.length, 1);
      assert.deepEqual(Object.keys(body.FPID[0]), ["value"]);
      if (this.faceDeleteResponse) return reply(structuredClone(this.faceDeleteResponse));
      if (this.rejectFaceType === library.faceLibType) return reply({ statusCode: 4, statusString: "Invalid Operation", subStatusCode: "badParameters" }, 400);
      if (this.keepFaceAfterDelete !== library.faceLibType) this.faces.delete(faceKey(library, body.FPID[0].value));
      this.afterFaceDelete?.(library, body.FPID[0].value);
      return reply(this.unknownFaceAck === library.faceLibType ? {} : { statusCode: 1, statusString: "OK" });
    }
    if (request.method === "PUT" && request.path === "/ISAPI/AccessControl/UserInfoDetail/Delete?format=json") {
      assert.deepEqual(Object.keys(body), ["UserInfoDetail"]);
      assert.equal(body.UserInfoDetail.mode, "byEmployeeNo");
      assert.equal(body.UserInfoDetail.EmployeeNoList.length, 1);
      const id = body.UserInfoDetail.EmployeeNoList[0].employeeNo;
      this.pendingPerson = id;
      if (this.personDeleteMode === "instant") this.people.delete(id);
      else this.progress = "processing";
      this.afterPersonDelete?.(id);
      return reply({ statusCode: 1, statusString: "OK" });
    }
    throw Object.assign(new Error("Unexpected synthetic endpoint"), { code: "SYNTHETIC_UNEXPECTED_REQUEST" });
  }
  finish() { this.people.delete(this.pendingPerson); this.progress = "success"; }
  close() { this.closed = true; }
}
function configuredProvider(client) {
  const provider = new HikvisionFaceProvider(client);
  provider.describe = async () => {
    const description = await new SimulatedFaceProvider().describe();
    description.device.origin = "https://SENSITIVE_ORIGIN.invalid";
    description.capabilities.libraries = structuredClone(libraries);
    return description;
  };
  return provider;
}
async function connected(people = [person()], options = {}) {
  const client = new SyntheticClient(people), provider = configuredProvider(client);
  const service = new FaceEnrollmentService({ providerFactory: () => provider, ...options });
  await service.connect({ mode: "device", origin: "https://SENSITIVE_ORIGIN.invalid", username: "SENSITIVE_USERNAME", password: "SENSITIVE_PASSWORD" });
  return { service, provider, client };
}
const puts = client => client.calls.filter(call => call.method === "PUT");
const confirmation = prepared => ({ employeeNo: prepared.employeeNo, confirmationToken: prepared.confirmationToken, confirmationText: "DELETE " + prepared.employeeNo });

test("management requires a connected device and never returns connection materials", async () => {
  const empty = new FaceEnrollmentService();
  await assert.rejects(empty.list(), /先连接/);
  await assert.rejects(empty.prepareDelete({ employeeNo: "EMP1" }), /先连接/);
  empty.close();
  const { service } = await connected();
  const state = JSON.stringify(service.state());
  assert(!state.includes("SENSITIVE_ORIGIN"));
  assert(!state.includes("SENSITIVE_USERNAME"));
  assert(!state.includes("SENSITIVE_PASSWORD"));
  assert.equal(service.state().device.origin, undefined);
  service.close();
});

test("all people are paged exactly and every visible/infrared library is checked without returning images or credentials", async () => {
  const { service, client } = await connected([person("EMP1"), person("EMP2", "另一合成人员")]);
  const list = await service.list();
  assert.equal(list.complete, true);
  assert.equal(list.total, 2);
  assert.deepEqual(list.people.map(row => row.employeeNo), ["EMP1", "EMP2"]);
  for (const row of list.people) {
    assert.equal(row.faces.blackFD.status, "present");
    assert.equal(row.faces.infraredFD.status, "present");
    assert.equal(row.deleteAllowed, true);
    assert.equal(row.Valid.enable, false);
  }
  const searches = client.calls.filter(call => call.path.startsWith("/ISAPI/AccessControl/UserInfo/Search"));
  assert.deepEqual(searches.map(call => call.body.UserInfoSearchCond.searchResultPosition), [0, 1]);
  assert.equal(client.calls.filter(call => call.path.includes("FDSearch?")).length, 4);
  const serialized = JSON.stringify(list);
  for (const forbidden of ["SENSITIVE_PASSWORD", "SENSITIVE_CARD", "faceURL", "private-device", "password", "cardNo"]) assert(!serialized.includes(forbidden));
  assert.equal(puts(client).length, 0);
  service.close();
});

for (const legacyCapability of [undefined, false]) test("explicit management FDSearch is observed with legacy capability " + String(legacyCapability), async () => {
  const client = new SyntheticClient(), provider = configuredProvider(client);
  const description = await provider.describe();
  if (legacyCapability === undefined) delete description.capabilities.faceSearchSupported;
  else description.capabilities.faceSearchSupported = legacyCapability;
  provider.describe = async () => structuredClone(description);
  client.people.get("EMP1").numOfFace = 0;
  client.faces.delete(faceKey(libraries[1], "EMP1"));
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  try {
    await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
    const list = await service.list();
    assert.equal(service.state().capabilities.faceSearchSupported, legacyCapability);
    assert.equal(Object.hasOwn(service.state().capabilities, "faceSearchSupported"), legacyCapability !== undefined);
    assert.equal(list.managementSearchObserved, true);
    assert.equal(list.people[0].managementSearchObserved, true);
    assert.equal(list.people[0].faces.blackFD.status, "present");
    assert.equal(list.people[0].faces.blackFD.libraries[0].recordStatus, "present");
    assert.equal(list.people[0].faces.infraredFD.status, "absent");
    assert.equal(list.people[0].faces.infraredFD.libraries[0].recordStatus, "absent");
    assert.equal(list.people[0].deleteAllowed, true);
    const searches = client.calls.filter(call => call.path === "/ISAPI/Intelligent/FDLib/FDSearch?format=json");
    assert.deepEqual(searches.map(call => call.body), libraries.map(library => ({ searchResultPosition: 0, maxResults: 1, ...library, FPID: "EMP1" })));
    assert.equal(searches.every(call => call.method === "POST"), true);
    assert.equal(puts(client).length, 0);
  } finally { service.close(); }
});

for (const legacyCapability of [undefined, false]) for (const failure of ["transport", "device-rejection"]) test("failed management FDSearch cannot authorize prepare or confirmation with legacy capability " + String(legacyCapability) + ": " + failure, async () => {
  const client = new SyntheticClient(), provider = configuredProvider(client);
  const description = await provider.describe();
  if (legacyCapability === undefined) delete description.capabilities.faceSearchSupported;
  else description.capabilities.faceSearchSupported = legacyCapability;
  provider.describe = async () => structuredClone(description);
  client.people.get("EMP1").numOfFace = 99;
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  try {
    await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
    client.failFaceSearch = failure;
    const list = await service.list();
    assert.equal(list.managementSearchObserved, false);
    assert.equal(list.people[0].deleteAllowed, false);
    for (const type of ["blackFD", "infraredFD"]) {
      assert.equal(list.people[0].faces[type].status, "unknown");
      assert.equal(list.people[0].faces[type].libraries[0].recordStatus, "unknown");
    }
    await assert.rejects(service.prepareDelete({ employeeNo: "EMP1" }), /人脸状态尚未确认/);
    assert.equal(puts(client).length, 0);
    delete client.failFaceSearch;
    const prepared = await service.prepareDelete({ employeeNo: "EMP1" });
    assert.match(prepared.confirmationToken, /^[A-Za-z0-9_-]{43}$/);
    client.failFaceSearch = failure;
    const confirmed = await service.delete(confirmation(prepared));
    assert.equal(confirmed.status, "failed");
    assert(confirmed.steps.some(step => step.errorCode === "FACE_STATE_UNKNOWN"));
    assert.equal(puts(client).length, 0);
    assert(client.calls.some(call => call.path === "/ISAPI/Intelligent/FDLib/FDSearch?format=json"));
    assert.equal(service.state().capabilities.faceSearchSupported, legacyCapability);
    assert(client.people.has("EMP1"));
  } finally { service.close(); }
});

test("unknown face modeling remains unknown and prevents preparation", async () => {
  const { service, client } = await connected();
  client.unknownFaceType = "infraredFD";
  const list = await service.list();
  assert.equal(list.people[0].faces.infraredFD.status, "unknown");
  assert.equal(list.people[0].deleteAllowed, false);
  await assert.rejects(service.prepareDelete({ employeeNo: "EMP1" }), /人脸状态尚未确认/);
  assert.equal(puts(client).length, 0);
  service.close();
});

test("a present face never hides an unknown sibling library from any deletion gate", async () => {
  const client = new SyntheticClient(), provider = configuredProvider(client);
  const third = { FDID: "3", faceLibType: "blackFD" };
  const selected = [...libraries, third];
  client.faces.add(faceKey(third, "EMP1"));
  client.unknownFaceFDID = "3";
  const description = await provider.describe();
  description.capabilities.libraries = structuredClone(selected);
  provider.describe = async () => structuredClone(description);
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
  const list = await service.list();
  assert.equal(list.people[0].faces.blackFD.status, "present");
  assert.deepEqual(list.people[0].faces.blackFD.libraries.map(library => library.status), ["present", "unknown"]);
  assert.equal(list.people[0].deleteAllowed, false);
  await assert.rejects(service.prepareDelete({ employeeNo: "EMP1" }), /人脸状态尚未确认/);
  assert.equal(puts(client).length, 0);
  const direct = await provider.deletePerson({ employeeNo: "EMP1", libraries: selected });
  assert.equal(direct.status, "failed");
  assert(direct.steps.some(step => step.errorCode === "FACE_STATE_UNKNOWN"));
  assert.equal(puts(client).length, 0);
  assert(client.people.has("EMP1"));
  service.close();
});

test("one confirmed person is deleted face libraries first, then exact employee filter, followed by an empty refreshed list", async () => {
  const { service, client } = await connected();
  const prepared = await service.prepareDelete({ employeeNo: "EMP1" });
  assert.equal(prepared.name, "合成人员");
  assert.equal(puts(client).length, 0);
  const result = await service.delete(confirmation(prepared));
  assert.equal(result.status, "success");
  assert.deepEqual(result.summary, { total: 1, success: 1, failed: 0, notFound: 0, pending: 0 });
  assert.equal(result.list.total, 0);
  assert.equal(result.list.complete, true);
  const writes = puts(client);
  assert.equal(writes.length, 3);
  assert(writes[0].path.includes("FDSearch/Delete"));
  assert(writes[1].path.includes("FDSearch/Delete"));
  assert.equal(writes[2].path, "/ISAPI/AccessControl/UserInfoDetail/Delete?format=json");
  assert.deepEqual(writes[0].body, { FPID: [{ value: "EMP1" }] });
  assert.deepEqual(writes[2].body, { UserInfoDetail: { mode: "byEmployeeNo", EmployeeNoList: [{ employeeNo: "EMP1" }] } });
  assert(!writes.some(call => /FDDelete|UserInfo\/Delete/.test(call.path)));
  assert.equal(result.steps.filter(step => step.kind === "face").length, 2);
  assert(result.steps.every(step => step.status === "success"));
  service.close();
});

test("a missing employee is reported without sending any delete request", async () => {
  const { service, client } = await connected([]);
  const result = await service.prepareDelete({ employeeNo: "MISSING1" });
  assert.equal(result.status, "not-found");
  assert.equal(result.confirmationToken, undefined);
  assert.deepEqual(result.summary, { total: 1, success: 0, failed: 0, notFound: 1, pending: 0 });
  assert.equal(result.list.total, 0);
  assert.equal(puts(client).length, 0);
  service.close();
});

test("already absent faces are not deleted again while the exact remaining person is removed", async () => {
  const { service, client } = await connected();
  client.faces.clear();
  const result = await service.delete(confirmation(await service.prepareDelete({ employeeNo: "EMP1" })));
  assert.equal(result.status, "success");
  assert.equal(puts(client).length, 1);
  assert(result.steps.filter(step => step.kind === "face").every(step => step.status === "already-absent"));
  service.close();
});

for (const [label, response] of [
  ["missing both counters", { MatchList: [] }],
  ["missing total", { numOfMatches: 0, MatchList: [] }],
  ["missing numOfMatches", { totalMatches: 0, MatchList: [] }],
  ["string total", { numOfMatches: 0, totalMatches: "0", MatchList: [] }],
  ["string numOfMatches", { numOfMatches: "0", totalMatches: 0, MatchList: [] }],
  ["negative count", { numOfMatches: -1, totalMatches: 0, MatchList: [] }],
  ["conflicting counts", { numOfMatches: 0, totalMatches: 1, MatchList: [] }],
  ["object MatchList", { numOfMatches: 0, totalMatches: 0, MatchList: {} }],
  ["MORE status", { numOfMatches: 0, totalMatches: 0, MatchList: [], responseStatusStrg: "MORE" }],
  ["unfinished progress", { numOfMatches: 0, totalMatches: 0, MatchList: [], progress: 50 }],
  ["explicit response failure", { numOfMatches: 0, totalMatches: 0, MatchList: [], responseStatus: false }],
  ["wrong-type responseStatus", { numOfMatches: 0, totalMatches: 0, MatchList: [], responseStatus: "true" }],
]) test("empty face results are unknown and cause zero PUTs: " + label, async () => {
  const { service, provider, client } = await connected();
  client.faces.clear();
  client.emptyFaceResponse = () => structuredClone(response);
  if (response.responseStatus === false) await assert.rejects(provider.findFaceForManagement({ ...libraries[0], employeeNo: "EMP1" }), /设备拒绝查询/);
  else assert.equal(await provider.findFaceForManagement({ ...libraries[0], employeeNo: "EMP1" }), null);
  const list = await service.list();
  assert.equal(list.people[0].faces.blackFD.status, "unknown");
  assert.equal(list.people[0].faces.blackFD.libraries[0].recordStatus, "unknown");
  assert.equal(list.people[0].deleteAllowed, false);
  await assert.rejects(service.prepareDelete({ employeeNo: "EMP1" }), /人脸状态尚未确认/);
  const direct = await provider.deletePerson({ employeeNo: "EMP1", libraries });
  assert.equal(direct.status, "failed");
  assert.equal(puts(client).length, 0);
  assert(client.people.has("EMP1"));
  service.close();
});

test("only explicit numeric zero counters with an empty or omitted optional MatchList prove record absence", async () => {
  for (const response of [
    { numOfMatches: 0, totalMatches: 0, MatchList: [] },
    { numOfMatches: 0, totalMatches: 0 },
    { numOfMatches: 0, totalMatches: 0, MatchList: null },
  ]) {
    const client = new SyntheticClient(); client.faces.clear(); client.emptyFaceResponse = () => response;
    const provider = configuredProvider(client);
    assert.deepEqual(await provider.readFaceForManagement({ ...libraries[0], employeeNo: "EMP1" }), { status: "absent", recordStatus: "absent" });
    assert.equal(puts(client).length, 0);
    provider.close();
  }
});

test("a matching not-modeled face record is deleted rather than mistaken for an absent record", async () => {
  const { service, provider, client } = await connected();
  client.notModeledFaceType = "blackFD";
  assert.deepEqual(await provider.readFaceForManagement({ ...libraries[0], employeeNo: "EMP1" }), { status: "absent", recordStatus: "present" });
  const list = await service.list();
  assert.equal(list.people[0].faces.blackFD.status, "absent");
  assert.equal(list.people[0].faces.blackFD.libraries[0].recordStatus, "present");
  const result = await service.delete(confirmation(await service.prepareDelete({ employeeNo: "EMP1" })));
  assert.equal(result.status, "success");
  assert.equal(puts(client).length, 3);
  assert(puts(client)[0].path.includes("FDID=1"));
  service.close();
});

test("a face record still returned as not-modeled after deletion blocks all subsequent writes", async () => {
  const { service, client } = await connected();
  client.notModeledFaceType = "blackFD";
  client.keepFaceAfterDelete = "blackFD";
  const result = await service.delete(confirmation(await service.prepareDelete({ employeeNo: "EMP1" })));
  assert.equal(result.status, "pending");
  assert.equal(puts(client).length, 1);
  const followed = await service.followDelete({ id: result.operationId });
  assert.equal(followed.status, "pending");
  assert.equal(puts(client).length, 1);
  assert(client.people.has("EMP1"));
  assert(!puts(client).some(call => call.path.includes("UserInfoDetail/Delete")));
  service.close();
});

test("missing absence counters in post-face-delete readback cannot continue to another face or person delete", async () => {
  const { service, client } = await connected();
  client.emptyFaceResponse = body => body.faceLibType === "blackFD" ? { MatchList: [] } : { numOfMatches: 0, totalMatches: 0, MatchList: [] };
  const pending = await service.delete(confirmation(await service.prepareDelete({ employeeNo: "EMP1" })));
  assert.equal(pending.status, "pending");
  assert.equal(puts(client).length, 1);
  const followed = await service.followDelete({ id: pending.operationId });
  assert.equal(followed.status, "pending");
  assert.equal(puts(client).length, 1);
  assert(!puts(client).some(call => call.path.includes("UserInfoDetail/Delete")));
  service.close();
});

test("a failed face delete reports device status and prevents deleting the person", async () => {
  const { service, client } = await connected();
  client.rejectFaceType = "infraredFD";
  const result = await service.delete(confirmation(await service.prepareDelete({ employeeNo: "EMP1" })));
  assert.equal(result.status, "failed");
  assert.equal(result.summary.failed, 1);
  assert(client.people.has("EMP1"));
  assert(!puts(client).some(call => call.path.includes("UserInfoDetail/Delete")));
  const failed = result.steps.find(step => step.status === "failed");
  assert.equal(failed.statusCode, 4);
  assert.equal(failed.statusString, "Invalid Operation");
  assert.equal(failed.httpStatus, 400);
  assert.equal(result.list.people[0].faces.blackFD.status, "absent");
  assert.equal(result.list.people[0].faces.infraredFD.status, "present");
  service.close();
});

test("missing or incorrect secondary confirmation causes zero device writes", async () => {
  const { service, client } = await connected();
  await assert.rejects(service.delete({ employeeNo: "EMP1" }), /二次确认/);
  const prepared = await service.prepareDelete({ employeeNo: "EMP1" });
  await assert.rejects(service.delete({ ...confirmation(prepared), confirmationText: "DELETE OTHER" }), /二次确认/);
  await assert.rejects(service.delete(confirmation(prepared)), /二次确认/);
  assert.equal(puts(client).length, 0);
  service.close();
});

test("confirmation expires, is session scoped, and cannot be replayed", async () => {
  let clock = 1000;
  const { service, client } = await connected(undefined, { now: () => clock, confirmationTtlMs: 100 });
  const expired = await service.prepareDelete({ employeeNo: "EMP1" });
  clock = 1100;
  await assert.rejects(service.delete(confirmation(expired)), /二次确认/);
  assert.equal(puts(client).length, 0);
  const other = await connected();
  const token = await service.prepareDelete({ employeeNo: "EMP1" });
  await assert.rejects(other.service.delete(confirmation(token)), /二次确认/);
  const result = await service.delete(confirmation(token));
  assert.equal(result.status, "success");
  const before = puts(client).length;
  await assert.rejects(service.delete(confirmation(token)), /二次确认/);
  assert.equal(puts(client).length, before);
  service.close(); other.service.close();
});

test("refreshing the list invalidates a previously prepared confirmation", async () => {
  const { service, client } = await connected();
  const token = await service.prepareDelete({ employeeNo: "EMP1" });
  await service.list();
  await assert.rejects(service.delete(confirmation(token)), /二次确认/);
  assert.equal(puts(client).length, 0);
  service.close();
});

test("changing the employee record after confirmation stops before writes", async () => {
  const { service, client } = await connected();
  const token = await service.prepareDelete({ employeeNo: "EMP1" });
  client.people.get("EMP1").name = "已变化的人员";
  await assert.rejects(service.delete(confirmation(token)), /人员信息已变化/);
  assert.equal(puts(client).length, 0);
  service.close();
});

for (const value of ["", undefined, null, 1, "EMP_1", "EMP-1", "../EMP1", "EMP1\n", "A".repeat(33)]) test("invalid employee ID rejected without requests: " + JSON.stringify(value), async () => {
  const client = new SyntheticClient(), provider = new HikvisionFaceProvider(client);
  await assert.rejects(provider.deletePerson({ employeeNo: value, libraries }));
  await assert.rejects(provider.findFaceForManagement({ employeeNo: value, ...libraries[0] }));
  assert.equal(client.calls.length, 0);
});

for (const value of [[{ employeeNo: "EMP1" }], { employeeNo: ["EMP1", "EMP2"] }, { employeeNo: "EMP1", employeeNos: ["EMP2"] }]) test("batch or extra deletion selectors are rejected", async () => {
  const { service, client } = await connected();
  await assert.rejects(service.prepareDelete(value));
  await assert.rejects(service.delete(value));
  assert.equal(puts(client).length, 0);
  service.close();
});

test("malformed or inconsistent personnel pages never become a complete empty list", async () => {
  for (const search of [
    { totalMatches: 0, numOfMatches: 0, UserInfo: { employeeNo: "EMP1" } },
    { totalMatches: 0, numOfMatches: 0, UserInfo: [], responseStatusStrg: "MORE" },
    { totalMatches: 1, numOfMatches: 0, UserInfo: [] },
    { totalMatches: "0", numOfMatches: 0, UserInfo: [] },
    { totalMatches: 1, numOfMatches: 1, UserInfo: [person("EMP_1")] },
  ]) {
    const provider = new HikvisionFaceProvider({ request: async () => reply({ UserInfoSearch: search }), close() {} });
    await assert.rejects(provider.list({ libraries, faceSearchSupported: true }));
  }
});

test("duplicate or changed totals during pagination are rejected before face queries", async () => {
  for (const mode of ["duplicate", "changed-total"]) {
    let calls = 0;
    const provider = new HikvisionFaceProvider({ request: async request => {
      assert(request.path.includes("UserInfo/Search"));
      calls++;
      return reply({ UserInfoSearch: { totalMatches: mode === "changed-total" && calls > 1 ? 3 : 2, numOfMatches: 1, UserInfo: [person(mode === "duplicate" ? "EMP1" : "EMP" + calls)] } });
    }, close() {} });
    await assert.rejects(provider.list({ libraries, faceSearchSupported: true }));
    assert.equal(calls, 2);
  }
});

test("asynchronous deletion is followed using reads only and blocks overlapping mutations", async () => {
  const { service, client } = await connected();
  client.personDeleteMode = "processing";
  const result = await service.delete(confirmation(await service.prepareDelete({ employeeNo: "EMP1" })));
  assert.equal(result.status, "pending");
  assert.match(result.operationId, /^[0-9a-f-]{36}$/);
  assert.equal(result.summary.pending, 1);
  assert.equal(service.state().pendingDelete.operationId, result.operationId);
  const before = puts(client).length;
  await assert.rejects(service.prepareDelete({ employeeNo: "EMP1" }), /等待确认结果/);
  await assert.rejects(service.enroll({}), /等待确认结果/);
  await assert.rejects(service.retry({ id: "unused" }), /等待确认结果/);
  const pending = await service.followDelete({ id: result.operationId });
  assert.equal(pending.status, "pending");
  assert.equal(puts(client).length, before);
  client.finish();
  const finished = await service.followDelete({ id: result.operationId });
  assert.equal(finished.status, "success");
  assert.equal(finished.list.total, 0);
  assert.equal(service.state().pendingDelete, undefined);
  const again = await service.followDelete({ id: result.operationId });
  assert.equal(again.status, "success");
  assert.equal(puts(client).length, before);
  service.close();
});

test("ambiguous face acknowledgement is not retried and follow-up does not continue personnel deletion", async () => {
  const { service, client } = await connected();
  client.unknownFaceAck = "infraredFD";
  const pending = await service.delete(confirmation(await service.prepareDelete({ employeeNo: "EMP1" })));
  assert.equal(pending.status, "pending");
  const before = puts(client).length;
  const followed = await service.followDelete({ id: pending.operationId });
  assert.equal(followed.status, "failed");
  assert(followed.steps.some(step => step.errorCode === "PERSON_DELETE_REQUIRES_NEW_CONFIRMATION"));
  assert.equal(puts(client).length, before);
  assert(!puts(client).some(call => call.path.includes("UserInfoDetail/Delete")));
  assert(client.people.has("EMP1"));
  service.close();
});

test("global device deletion busy state stops before any face write", async () => {
  const { service, client } = await connected();
  const prepared = await service.prepareDelete({ employeeNo: "EMP1" });
  client.progress = "processing";
  const result = await service.delete(confirmation(prepared));
  assert.equal(result.status, "failed");
  assert(result.steps.some(step => step.errorCode === "DEVICE_DELETE_BUSY"));
  assert.equal(puts(client).length, 0);
  service.close();
});

test("a read failure after face writes preserves pending evidence and follow-up never submits the person delete", async () => {
  const { service, client } = await connected();
  client.afterFaceDelete = () => { client.failNextPersonRead = true; };
  const pending = await service.delete(confirmation(await service.prepareDelete({ employeeNo: "EMP1" })));
  assert.equal(pending.status, "pending");
  assert.match(pending.operationId, /^[0-9a-f-]{36}$/);
  assert.equal(pending.steps.filter(step => step.kind === "face" && step.status === "success").length, 2);
  assert(pending.steps.some(step => step.errorCode === "HIKVISION_TIMEOUT"));
  const before = puts(client).length;
  const followed = await service.followDelete({ id: pending.operationId });
  assert.equal(followed.status, "failed");
  assert(followed.steps.some(step => step.errorCode === "PERSON_DELETE_REQUIRES_NEW_CONFIRMATION"));
  assert.equal(puts(client).length, before);
  assert(!puts(client).some(call => call.path.includes("UserInfoDetail/Delete")));
  assert(client.people.has("EMP1"));
  service.close();
});

test("a changed identity between face deletion and person deletion stops further writes", async () => {
  const { service, client } = await connected();
  client.afterFaceDelete = () => { client.people.get("EMP1").name = "替换后的人员"; };
  const result = await service.delete(confirmation(await service.prepareDelete({ employeeNo: "EMP1" })));
  assert.equal(result.status, "failed");
  assert(result.steps.some(step => step.errorCode === "PERSON_CHANGED_BEFORE_DELETE"));
  assert(!puts(client).some(call => call.path.includes("UserInfoDetail/Delete")));
  service.close();
});

test("disconnect, follow expiry, and another session cannot reuse an operation", async () => {
  let clock = 0;
  const { service, client } = await connected(undefined, { now: () => clock, deleteFollowTtlMs: 100 });
  client.personDeleteMode = "processing";
  const pending = await service.delete(confirmation(await service.prepareDelete({ employeeNo: "EMP1" })));
  clock = 100;
  await assert.rejects(service.followDelete({ id: pending.operationId }), /跟进已失效/);
  assert(service.state().pendingDelete);
  await service.disconnect();
  await assert.rejects(service.followDelete({ id: pending.operationId }), /先连接/);
  assert.equal(service.state().pendingDelete, undefined);
  service.close();
});


test("exact person absence rejects MORE, NO MATCH contradictions and unknown statuses", async () => {
  for (const search of [
    { totalMatches: 0, numOfMatches: 0, UserInfo: [], responseStatusStrg: "MORE" },
    { totalMatches: 1, numOfMatches: 1, UserInfo: [person()], responseStatusStrg: "NO MATCH" },
    { totalMatches: 0, numOfMatches: 0, UserInfo: [], responseStatusStrg: "unexpected" },
  ]) {
    let writes = 0;
    const provider = new HikvisionFaceProvider({ request: async request => {
      if (request.method === "PUT") writes++;
      return reply({ UserInfoSearch: search });
    }, close() {} });
    await assert.rejects(provider.findManagementPerson("EMP1"), /精确查询状态矛盾/);
    assert.equal(writes, 0);
  }
});

test("a contradictory zero person readback stays pending until a later pure-read confirmation", async () => {
  const { service, client } = await connected();
  client.afterPersonDelete = () => {
    client.emptyPersonResponse = { totalMatches: 0, numOfMatches: 0, UserInfo: [], responseStatusStrg: "MORE" };
  };
  const pending = await service.delete(confirmation(await service.prepareDelete({ employeeNo: "EMP1" })));
  assert.equal(pending.status, "pending");
  const before = puts(client).length;
  assert.equal((await service.followDelete({ id: pending.operationId })).status, "pending");
  assert.equal(puts(client).length, before);
  delete client.emptyPersonResponse;
  const confirmed = await service.followDelete({ id: pending.operationId });
  assert.equal(confirmed.status, "success");
  assert.equal(puts(client).length, before);
  service.close();
});

for (const recreated of [false, true]) test("an externally absent person still requires final per-library readback, recreated face=" + recreated, async () => {
  const { service, client } = await connected();
  client.afterFaceDelete = library => {
    if (library.faceLibType !== "infraredFD") return;
    client.people.delete("EMP1");
    if (recreated) client.faces.add(faceKey(libraries[0], "EMP1"));
  };
  const result = await service.delete(confirmation(await service.prepareDelete({ employeeNo: "EMP1" })));
  assert.equal(result.status, recreated ? "pending" : "success");
  assert.equal(puts(client).length, 2);
  assert(!puts(client).some(call => call.path.includes("UserInfoDetail/Delete")));
  assert.equal(client.calls.filter(call => call.path === "/ISAPI/Intelligent/FDLib/FDSearch?format=json").length, 8);
  if (recreated) {
    const followed = await service.followDelete({ id: result.operationId });
    assert.equal(followed.status, "pending");
    assert.equal(puts(client).length, 2);
  }
  service.close();
});

for (const [label, response, expectedCode] of [
  ["outer failure overrides nested success", { statusCode: 4, statusString: "Invalid Operation", ResponseStatus: { statusCode: 1, statusString: "OK" } }, 4],
  ["nested failure overrides outer success", { statusCode: 1, statusString: "OK", ResponseStatus: { statusCode: 4, statusString: "Invalid Operation" } }, 4],
  ["explicit failure string overrides code one", { statusCode: 1, statusString: "Invalid Operation" }, 1],
  ["explicit response false overrides code one", { statusCode: 1, statusString: "OK", responseStatus: false }, 1],
]) test("deletion never continues after contradictory acknowledgement: " + label, async () => {
  const { service, client } = await connected();
  client.faceDeleteResponse = response;
  const result = await service.delete(confirmation(await service.prepareDelete({ employeeNo: "EMP1" })));
  assert.equal(result.status, "failed");
  assert.equal(result.steps[0].statusCode, expectedCode);
  assert.equal(result.steps[0].errorCode, "DEVICE_DELETE_REJECTED");
  assert.equal(puts(client).length, 1);
  assert(!puts(client).some(call => call.path.includes("UserInfoDetail/Delete")));
  service.close();
});

test("explicit read failures cannot hide behind a successful nested or outer status", async () => {
  for (const response of [
    { statusCode: 4, statusString: "Invalid Operation", ResponseStatus: { statusCode: 1, statusString: "OK" } },
    { statusCode: 1, statusString: "OK", ResponseStatus: { statusCode: 4, statusString: "Invalid Operation" } },
  ]) {
    const provider = new HikvisionFaceProvider({ request: async () => reply({
      ...response, numOfMatches: 0, totalMatches: 0, MatchList: [],
      UserInfoSearch: { numOfMatches: 0, totalMatches: 0, UserInfo: [] },
    }), close() {} });
    await assert.rejects(provider.findFaceForManagement({ ...libraries[0], employeeNo: "EMP1" }), /设备拒绝查询/);
    await assert.rejects(provider.findManagementPerson("EMP1"), /设备拒绝查询/);
  }
});

test("unrecognized delete status text is redacted, remains pending and never sends a second write", async () => {
  const { service, client } = await connected();
  client.faceDeleteResponse = { statusCode: 1, statusString: "https://SENSITIVE_ORIGIN.invalid/password=SENSITIVE_PASSWORD" };
  const result = await service.delete(confirmation(await service.prepareDelete({ employeeNo: "EMP1" })));
  assert.equal(result.status, "pending");
  assert.equal(result.steps[0].statusString, "设备返回状态（已脱敏）");
  assert(!JSON.stringify(result).includes("SENSITIVE_ORIGIN"));
  assert(!JSON.stringify(result).includes("SENSITIVE_PASSWORD"));
  assert.equal((await service.followDelete({ id: result.operationId })).status, "pending");
  assert.equal(puts(client).length, 1);
  service.close();
});

for (const state of ["processing", "failed", "unrecognized"]) test("person deletion progress cannot be replaced by an absent-record PASS: " + state, async () => {
  const { service, client } = await connected();
  client.afterPersonDelete = () => { client.progress = state; };
  const result = await service.delete(confirmation(await service.prepareDelete({ employeeNo: "EMP1" })));
  assert.equal(result.status, state === "failed" ? "failed" : "pending");
  assert.equal(puts(client).length, 3);
  if (state === "failed") assert(result.steps.some(step => step.errorCode === "DEVICE_DELETE_FAILED"));
  else {
    const followed = await service.followDelete({ id: result.operationId });
    assert.equal(followed.status, "pending");
    assert.equal(puts(client).length, 3);
  }
  service.close();
});

test("a terminal failed operation is not overwritten by a later unrelated success progress", async () => {
  const { service, client } = await connected();
  client.personDeleteMode = "processing";
  const pending = await service.delete(confirmation(await service.prepareDelete({ employeeNo: "EMP1" })));
  assert.equal(pending.status, "pending");
  client.progress = "failed";
  const failed = await service.followDelete({ id: pending.operationId });
  assert.equal(failed.status, "failed");
  assert(failed.steps.some(step => step.errorCode === "DEVICE_DELETE_FAILED"));
  const requestCount = client.calls.length;
  client.finish();
  const retained = await service.followDelete({ id: pending.operationId });
  assert.equal(retained.status, "failed");
  assert.deepEqual(retained.steps, failed.steps);
  assert.equal(client.calls.length, requestCount);
  service.close();
});

test("the simulated provider implements the same controlled management flow", async () => {
  const provider = new SimulatedFaceProvider();
  provider.people.set("EMP1", person());
  provider.faces.add("EMP1");
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
  const list = await service.list();
  assert.equal(list.people[0].faces.blackFD.status, "present");
  assert.equal(list.people[0].faces.infraredFD.status, "unsupported");
  const result = await service.delete(confirmation(await service.prepareDelete({ employeeNo: "EMP1" })));
  assert.equal(result.status, "success");
  assert.equal(result.list.total, 0);
  service.close();
});
