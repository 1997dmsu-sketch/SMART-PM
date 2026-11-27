import { test } from "node:test";
import assert from "node:assert/strict";
import { FaceReadonlyPolicy, READONLY_POLICY_CODES } from "../lib/face-readonly-policy.mjs";
import { HikvisionFaceProvider } from "../lib/face-enrollment.mjs";

// Synthetic responses only: this test file never opens a device or a local file.
const access = "/ISAPI/AccessControl", face = "/ISAPI/Intelligent/FDLib";
const peoplePath = `${access}/UserInfo/Search?format=json`;
const facePath = `${face}/FDSearch?format=json`;
const plan = (kind, number) => `${access}/${kind}/${number}?format=json`;
const reply = (value, status = 200) => ({ status, body: Buffer.from(JSON.stringify(value)) });
const request = (path, value) => ({ method: "POST", path, body: Buffer.from(JSON.stringify(value)), contentType: "application/json" });
const search = (position = 0, maxResults = 1, searchID = "synthetic-search") => ({ UserInfoSearchCond: { searchID, searchResultPosition: position, maxResults } });
const faceSearch = (FPID = "EMP1", FDID = "1", faceLibType = "blackFD") => ({ searchResultPosition: 0, maxResults: 1, faceLibType, FDID, FPID });
const fullSlot = extra => ({ id: 1, enable: true, TimeSegment: { beginTime: "00:00:00", endTime: "23:59:59" }, ...extra });
function fixture({ pageSize, groups = "", missingDoors = false, emptyLibraries = false, libraries = [{ FDID: "1", faceLibType: "blackFD" }], maxRequests } = {}) {
  const policy = new FaceReadonlyPolicy({ maxRequests });
  const values = new Map([
    ["/ISAPI/System/deviceInfo", { status: 200, body: Buffer.from("<DeviceInfo><model>SYNTHETIC</model></DeviceInfo>") }],
    [`${access}/UserInfo/capabilities?format=json`, reply({ UserInfo: { supportFunction: { "@opt": "get,post,put" }, ...(missingDoors ? {} : { RightPlan: { doorNo: { "@min": 1, "@max": 1 } } }), ...(pageSize === undefined ? {} : { UserInfoSearchCond: { maxResults: { "@max": pageSize } } }) } })],
    [`${face}/capabilities?format=json`, reply({ supportFDFunction: "get,setUp" })],
    [`${face}?format=json`, reply(emptyLibraries ? {} : { FDLib: libraries })],
    [`${face}/Count?format=json`, reply({ FDLib: libraries })],
    [`${access}/RemoteControl/door/capabilities`, { status: 200, body: Buffer.from('<SyntheticDoorCapability><doorNo min="1" max="2"/></SyntheticDoorCapability>') }],
    [plan("UserRightPlanTemplate", "capabilities"), reply({ UserRightPlanTemplate: { templateNo: { "@min": 1, "@max": 128 } } })],
    [plan("UserRightPlanTemplate", 1), reply({ UserRightPlanTemplate: { enable: true, templateName: "Synthetic all-day", weekPlanNo: 3, holidayGroupNo: groups } })],
    [plan("UserRightWeekPlanCfg", 3), reply({ UserRightWeekPlanCfg: { enable: true, WeekPlanCfg: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(week => fullSlot({ week })) } })],
    [plan("UserRightHolidayGroupCfg", 32), reply({ UserRightHolidayGroupCfg: { enable: true, groupName: "Synthetic group", holidayPlanNo: "128" } })],
    [plan("UserRightHolidayPlanCfg", 128), reply({ UserRightHolidayPlanCfg: { enable: true, beginDate: "2000-01-01", endDate: "2000-01-01", HolidayPlanCfg: [fullSlot()] } })],
  ]);
  const reads = ["/ISAPI/System/deviceInfo", `${access}/UserInfo/capabilities?format=json`, `${face}/capabilities?format=json`, `${face}?format=json`, ...(emptyLibraries ? [`${face}/Count?format=json`] : []), ...(missingDoors ? [`${access}/RemoteControl/door/capabilities`] : []), plan("UserRightPlanTemplate", "capabilities"), plan("UserRightPlanTemplate", 1), plan("UserRightWeekPlanCfg", 3), ...(groups ? [plan("UserRightHolidayGroupCfg", 32), plan("UserRightHolidayPlanCfg", 128)] : [])];
  const exchange = (call, response) => { const prepared = policy.prepare(call); policy.observe(prepared, response); return prepared; };
  const describe = () => { for (const path of reads) exchange({ method: "GET", path }, values.get(path)); };
  const ready = () => { describe(); policy.beginList(); return policy; };
  return { policy, values, reads, exchange, describe, ready };
}
function page(value, rows = ["EMP1"], total = rows.length, status) {
  return value.exchange(request(peoplePath, search(value.policy.audit().people, 1)), reply({ UserInfoSearch: { totalMatches: total, numOfMatches: rows.length, UserInfo: rows.map(employeeNo => ({ employeeNo, name: "PRIVATE_NAME_SENTINEL", faceURL: "https://private.invalid/photo", modelData: "PRIVATE_MODEL_SENTINEL" })), ...(status ? { responseStatusStrg: status } : {}) } }));
}
function present(value, id = "EMP1", FDID = "1", faceLibType = "blackFD") {
  return value.exchange(request(facePath, faceSearch(id, FDID, faceLibType)), reply({ numOfMatches: 1, totalMatches: 1, MatchList: [{ FPID: id, isInLibrary: "yes", faceURL: "https://private.invalid/photo", modelData: "PRIVATE_MODEL_SENTINEL" }] }));
}
function rejects(operation, code) {
  assert.throws(operation, error => {
    assert(READONLY_POLICY_CODES.includes(error.code));
    if (code) assert.equal(error.code, code);
    assert.equal(error.cause, undefined);
    assert.equal(error.message, "Readonly device policy rejected the operation.");
    return true;
  });
}

test("the actual provider describe/list passes through the stateful policy without legacy FDSearch flags", async () => {
  const value = fixture({ groups: "32", pageSize: 1, libraries: [{ FDID: "1", faceLibType: "blackFD" }, { FDID: "2", faceLibType: "infraredFD" }] });
  let fakeIO = 0;
  const methods = [];
  const provider = new HikvisionFaceProvider({ async request(call) {
    const prepared = value.policy.prepare(call);
    fakeIO++;
    methods.push(prepared.method);
    const input = prepared.body && JSON.parse(prepared.body.toString("utf8"));
    const response = value.values.get(prepared.path) || (prepared.path === peoplePath
      ? reply({ UserInfoSearch: { totalMatches: 1, numOfMatches: 1, UserInfo: [{ employeeNo: "EMP1", name: "Synthetic" }], responseStatusStrg: "OK" } })
      : reply({ numOfMatches: 1, totalMatches: 1, MatchList: [{ FPID: input.FPID, isInLibrary: "yes" }] }));
    value.policy.observe(prepared, response);
    return response;
  } });
  await provider.describe();
  value.policy.beginList();
  const result = await provider.list();
  value.policy.finishList();
  assert.equal(result.complete, true);
  assert.equal(result.total, 1);
  assert.equal(fakeIO, value.policy.audit().requests);
  assert.equal(methods.filter(method => method === "POST").length, 3);
  assert.equal(value.policy.audit().phase, "done");
  assert(!JSON.stringify(value.policy.audit()).includes("EMP1"));
});

test("the Count fallback and door fallback require their observed prerequisites", () => {
  const value = fixture({ emptyLibraries: true, missingDoors: true });
  value.ready();
  page(value, [], 0, "NO MATCH");
  value.policy.finishList();
  assert.equal(value.policy.audit().phase, "done");
  for (const path of [`${face}/Count?format=json`, `${access}/RemoteControl/door/capabilities`]) {
    const blocked = fixture();
    for (const next of blocked.reads.slice(0, 4)) blocked.exchange({ method: "GET", path: next }, blocked.values.get(next));
    rejects(() => blocked.policy.prepare({ method: "GET", path }), "READONLY_PATH");
  }
});

test("unknown, empty and incompletely described libraries cannot produce a complete list", () => {
  for (const libraries of [[], [{ FDID: "1", faceLibType: "staticFD" }], [{ FDID: "1", faceLibType: "blackFD" }, { FDID: "2", faceLibType: "staticFD" }], [{ FDID: "1", faceLibType: "blackFD" }, { faceLibType: "infraredFD" }]]) {
    const value = fixture({ libraries, emptyLibraries: libraries.length === 0 });
    rejects(value.describe, "READONLY_LIBRARY");
    assert.equal(value.policy.audit().phase, "failed");
  }
});

for (const method of ["PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "get"]) test(`rejects ${method} before fakeIO`, () => {
  let fakeIO = 0;
  const policy = new FaceReadonlyPolicy();
  rejects(() => { policy.prepare({ method, path: "/ISAPI/System/deviceInfo" }); fakeIO++; }, "READONLY_METHOD");
  assert.equal(fakeIO, 0);
});

for (const path of [`${access}/UserInfo/Record?format=json`, `${access}/UserInfo/Modify?format=json`, `${access}/UserInfoDetail/Delete?format=json`, `${face}/FDSearch/Delete?format=json`, `${face}/FDSetUp?format=json`]) test(`rejects mutating POST ${path}`, () => {
  const value = fixture(); value.ready();
  let fakeIO = 0;
  rejects(() => { value.policy.prepare(request(path, {})); fakeIO++; }, "READONLY_PATH");
  assert.equal(fakeIO, 0);
});

for (const path of ["https://synthetic.invalid/ISAPI/System/deviceInfo", "//synthetic.invalid/ISAPI/System/deviceInfo", "/ISAPI/System/../System/deviceInfo", "/ISAPI/System/%64eviceInfo", "/ISAPI/System/deviceInfo?format=json", "/ISAPI/System/deviceInfo?x=1", "/ISAPI/System/deviceInfo#fragment", "/ISAPI/System/deviceInfo\r\nX-Test:yes", "/ISAPI/System\\deviceInfo"]) test(`rejects path substitution ${JSON.stringify(path)}`, () => {
  rejects(() => new FaceReadonlyPolicy().prepare({ method: "GET", path }), "READONLY_PATH");
});

test("request metadata, GET bodies, malformed UTF-8 and JSON cannot reach IO", () => {
  for (const call of [
    { method: "GET", path: "/ISAPI/System/deviceInfo", headers: {} },
    { method: "GET", path: "/ISAPI/System/deviceInfo", body: Buffer.from("{}") },
    { method: "GET", path: "/ISAPI/System/deviceInfo", contentType: "application/json" },
    Object.assign(Object.create({ extra: true }), { method: "GET", path: "/ISAPI/System/deviceInfo" }),
  ]) rejects(() => new FaceReadonlyPolicy().prepare(call));
  for (const body of [Buffer.from([0xc3, 0x28]), Buffer.from("{}{}"), Buffer.from("[]"), Buffer.from('{"UserInfoSearchCond":{"searchID":"x","searchResultPosition":0,"maxResults":1},"__proto__":{}}')]) {
    const value = fixture(); value.ready();
    rejects(() => value.policy.prepare({ method: "POST", path: peoplePath, body, contentType: "application/json" }));
  }
});

test("only the canonical copied JSON is sent after duplicate-key parsing", () => {
  const value = fixture(); value.ready();
  const input = Buffer.from('{"UserInfoSearchCond":{"searchID":"discarded","maxResults":1,"searchID":"synthetic-search","searchResultPosition":0}}');
  const prepared = value.policy.prepare({ method: "POST", path: peoplePath, body: input, contentType: "application/json" });
  input.fill(0);
  assert.equal(prepared.body.toString("utf8"), '{"UserInfoSearchCond":{"maxResults":1,"searchID":"synthetic-search","searchResultPosition":0}}');
  assert(Object.isFrozen(prepared));
  value.policy.observe(prepared, reply({ UserInfoSearch: { totalMatches: 0, numOfMatches: 0 } }));
  value.policy.finishList();
});

test("prepare and observe require one unmodified paired request", () => {
  const value = fixture();
  const prepared = value.policy.prepare({ method: "GET", path: value.reads[0] });
  rejects(() => value.policy.observe({ ...prepared }, value.values.get(prepared.path)), "READONLY_SEQUENCE");
  const mutated = fixture(); mutated.ready();
  const post = mutated.policy.prepare(request(peoplePath, search())); post.body.fill(0);
  rejects(() => mutated.policy.observe(post, reply({})), "READONLY_SEQUENCE");
  const concurrent = fixture(); concurrent.policy.prepare({ method: "GET", path: concurrent.reads[0] });
  rejects(() => concurrent.policy.prepare({ method: "GET", path: concurrent.reads[0] }), "READONLY_PHASE");
});

test("plan references are inaccessible until their exact trusted response binds them", () => {
  for (const path of [plan("UserRightPlanTemplate", 1), plan("UserRightWeekPlanCfg", 3), plan("UserRightHolidayGroupCfg", 32), plan("UserRightHolidayPlanCfg", 128)]) rejects(() => new FaceReadonlyPolicy().prepare({ method: "GET", path }), "READONLY_PATH");
  const value = fixture({ groups: "32" });
  for (const path of value.reads.slice(0, 6)) value.exchange({ method: "GET", path }, value.values.get(path));
  rejects(() => value.policy.prepare({ method: "GET", path: plan("UserRightWeekPlanCfg", 30) }), "READONLY_PATH");
  const outOfRange = fixture();
  outOfRange.values.set(plan("UserRightPlanTemplate", "capabilities"), reply({ UserRightPlanTemplate: { templateNo: { "@min": 2, "@max": 4 } } }));
  rejects(outOfRange.describe, "READONLY_REFERENCE");
});

for (const change of [
  template => { template.weekPlanNo = "3/../../4"; },
  template => { template.weekPlanNo = 0; },
  template => { template.holidayGroupNo = "32,"; },
  template => { template.holidayGroupNo = "32,32"; },
  template => { template.holidayGroupNo = "1,2,3,4,5"; },
]) test("rejects malformed or excessive references without scanning", () => {
  const value = fixture();
  const path = plan("UserRightPlanTemplate", 1);
  const template = JSON.parse(value.values.get(path).body).UserRightPlanTemplate;
  change(template); value.values.set(path, reply({ UserRightPlanTemplate: template }));
  rejects(value.describe, "READONLY_REFERENCE");
});

test("capability bounds page size to thirty and absent capability to one", () => {
  for (const [pageSize, accepted] of [[100, 30], [2, 2], [undefined, 1]]) {
    const value = fixture({ pageSize }); value.ready();
    const prepared = value.policy.prepare(request(peoplePath, search(0, accepted)));
    value.policy.observe(prepared, reply({ UserInfoSearch: { totalMatches: 0, numOfMatches: 0 } }));
    value.policy.finishList();
    const tooMany = fixture({ pageSize }); tooMany.ready();
    rejects(() => tooMany.policy.prepare(request(peoplePath, search(0, accepted + 1))), "READONLY_PAGINATION");
  }
});

test("pagination binds the same searchID, next position and exact keys", () => {
  for (const bad of [search(0), search(1, 1, "other"), { UserInfoSearchCond: { ...search(1).UserInfoSearchCond, EmployeeNoList: [{ employeeNo: "EMP1" }] } }, { UserInfoSearchCond: { ...search(1).UserInfoSearchCond, extra: true } }]) {
    const value = fixture(); value.ready(); page(value, ["EMP1"], 2, "MORE");
    rejects(() => value.policy.prepare(request(peoplePath, bad)));
  }
});

for (const response of [
  { totalMatches: 2, numOfMatches: 0, UserInfo: [] },
  { totalMatches: 0, numOfMatches: 0, UserInfo: [], responseStatusStrg: "MORE" },
  { totalMatches: 1, numOfMatches: 1, UserInfo: [{ employeeNo: "EMP1" }], responseStatusStrg: "NO MATCH" },
  { totalMatches: 1001, numOfMatches: 0, UserInfo: [] },
  { totalMatches: "0", numOfMatches: 0, UserInfo: [] },
  { totalMatches: 1, numOfMatches: 0, UserInfo: [{ employeeNo: "EMP1" }] },
  { totalMatches: 1, numOfMatches: 1, UserInfo: [{ employeeNo: "EMP/1" }] },
  { totalMatches: 0, numOfMatches: 0, searchID: "unbound" },
]) test("ambiguous pagination fails closed", () => {
  const value = fixture(); value.ready();
  rejects(() => value.exchange(request(peoplePath, search()), reply({ UserInfoSearch: response })));
});

test("changed totals, duplicate employees and incomplete lists are rejected", () => {
  for (const [rows, total] of [[["EMP1"], 2], [["EMP2"], 3]]) {
    const value = fixture(); value.ready(); page(value, ["EMP1"], 2, "MORE");
    rejects(() => page(value, rows, total));
  }
  const unfinished = fixture(); unfinished.ready(); page(unfinished, ["EMP1"], 2, "MORE");
  rejects(() => unfinished.policy.finishList(), "READONLY_INCOMPLETE");
  const unqueried = fixture(); unqueried.ready(); page(unqueried);
  rejects(() => unqueried.policy.finishList(), "READONLY_INCOMPLETE");
});

test("all pages must complete before exact face reads and all confirmed libraries must be read", () => {
  const value = fixture(); value.ready(); page(value, ["EMP1"], 2, "MORE");
  rejects(() => value.policy.prepare(request(facePath, faceSearch())), "READONLY_PAGINATION");
  const all = fixture({ libraries: [{ FDID: "1", faceLibType: "blackFD" }, { FDID: "2", faceLibType: "infraredFD" }] }); all.ready();
  page(all, ["EMP1"], 2, "MORE"); page(all, ["EMP2"], 2, "OK");
  for (const id of ["EMP1", "EMP2"]) { present(all, id); present(all, id, "2", "infraredFD"); }
  all.policy.finishList();
  assert.equal(all.policy.audit().faceQueries, 4);
});

for (const payload of [faceSearch("OTHER"), faceSearch("EMP1", "999"), faceSearch("EMP1", "1", "staticFD"), { ...faceSearch(), searchResultPosition: 1 }, { ...faceSearch(), maxResults: 2 }, { ...faceSearch(), faceURL: "https://private.invalid" }]) test("face search cannot escape the observed employees and libraries", () => {
  const value = fixture(); value.ready(); page(value);
  rejects(() => value.policy.prepare(request(facePath, payload)));
});

for (const response of [
  { numOfMatches: 0, totalMatches: 1, MatchList: [] },
  { numOfMatches: 0, MatchList: [] },
  { numOfMatches: 1, totalMatches: 1, MatchList: [{ FPID: "OTHER", isInLibrary: "yes" }] },
  { numOfMatches: 1, totalMatches: 1, MatchList: [{ FPID: "EMP1" }] },
  { numOfMatches: 1, totalMatches: 1, MatchList: [{ FPID: "EMP1", isInLibrary: true }] },
  { numOfMatches: 0, totalMatches: 0, MatchList: [], progress: 50 },
  { numOfMatches: 0, totalMatches: 0, MatchList: [], responseStatusStrg: "MORE" },
]) test("an ambiguous face result throws immediately and closes the policy", () => {
  const value = fixture(); value.ready(); page(value);
  rejects(() => value.exchange(request(facePath, faceSearch()), reply(response)), "READONLY_FACE_UNCONFIRMED");
  assert.equal(value.policy.audit().phase, "failed");
  rejects(() => value.policy.prepare(request(facePath, faceSearch())), "READONLY_PHASE");
});

test("explicit absent and unmodeled face records remain unambiguous", () => {
  for (const response of [{ numOfMatches: 0, totalMatches: 0 }, { numOfMatches: 1, totalMatches: 1, MatchList: [{ FPID: "EMP1", isInLibrary: "no" }] }]) {
    const value = fixture(); value.ready(); page(value);
    value.exchange(request(facePath, faceSearch()), reply(response));
    value.policy.finishList();
    const audit = JSON.stringify(value.policy.audit());
    for (const sensitive of ["EMP1", "PRIVATE_NAME_SENTINEL", "PRIVATE_MODEL_SENTINEL", "https:"]) assert(!audit.includes(sensitive));
  }
});

test("device rejection takes precedence over success-looking counts and references", () => {
  for (const errorNode of [{ statusCode: 4, statusString: "PRIVATE_DEVICE_TEXT" }, { ResponseStatus: { statusCode: "4", statusString: "PRIVATE_DEVICE_TEXT" } }, { responseStatus: false }, { statusString: "Invalid Operation" }]) {
    const value = fixture(); value.ready(); page(value);
    rejects(() => value.exchange(request(facePath, faceSearch()), reply({ numOfMatches: 0, totalMatches: 0, MatchList: [], ...errorNode })), "READONLY_DEVICE_ERROR");
  }
  const nested = fixture(); nested.ready();
  rejects(() => nested.exchange(request(peoplePath, search()), reply({ UserInfoSearch: { totalMatches: 0, numOfMatches: 0, statusCode: 4 } })), "READONLY_DEVICE_ERROR");
});

test("response duplicate keys cannot conceal an earlier error, including escaped equivalent keys", () => {
  for (const body of [
    '{"statusCode":4,"statusCode":1,"UserInfoSearch":{"totalMatches":0,"numOfMatches":0}}',
    '{"statusCode":4,"\\u0073tatusCode":1,"UserInfoSearch":{"totalMatches":0,"numOfMatches":0}}',
    '{"UserInfoSearch":{"totalMatches":1,"totalMatches":0,"numOfMatches":0}}',
    '{"ResponseStatus":{"statusCode":4},"ResponseStatus":{"statusCode":1},"UserInfoSearch":{"totalMatches":0,"numOfMatches":0}}',
  ]) {
    const value = fixture(); value.ready();
    rejects(() => value.exchange(request(peoplePath, search()), { status: 200, body: Buffer.from(body) }), "READONLY_JSON");
  }
});

test("redirects, non-2xx responses, invalid JSON and XML entities are rejected", () => {
  for (const response of [{ status: 302, headers: { location: "https://private.invalid" }, body: Buffer.from("PRIVATE_DEVICE_TEXT") }, { status: 200, headers: { Location: "https://private.invalid" }, body: Buffer.from("<DeviceInfo/>") }, { status: 200, body: Buffer.from('<!DOCTYPE DeviceInfo [<!ENTITY photo SYSTEM "file:///private">]><DeviceInfo/>') }]) {
    const value = fixture();
    rejects(() => value.exchange({ method: "GET", path: value.reads[0] }, response));
  }
  const malformed = fixture(); malformed.ready();
  rejects(() => malformed.exchange(request(peoplePath, search()), { status: 200, body: Buffer.from("PRIVATE_DEVICE_TEXT") }), "READONLY_JSON");
  for (const xml of ['<Synthetic><doorNo min="1" max="2"/><doorNo min="1" max="3"/></Synthetic>', '<Synthetic><doorNo min="0" max="2"/></Synthetic>', '<Synthetic><doorNo min="1" min="2" max="3"/></Synthetic>', '<Synthetic><doorNo min="2" max="1"/></Synthetic>']) {
    const value = fixture({ missingDoors: true });
    value.values.set(`${access}/RemoteControl/door/capabilities`, { status: 200, body: Buffer.from(xml) });
    rejects(value.describe);
  }
});

test("the logical request budget and one-shot phases are enforced", () => {
  for (const maxRequests of [0, -1, 257, "1", NaN]) rejects(() => new FaceReadonlyPolicy({ maxRequests }), "READONLY_CONFIGURATION");
  const limited = fixture({ maxRequests: 1 });
  limited.exchange({ method: "GET", path: limited.reads[0] }, limited.values.get(limited.reads[0]));
  rejects(() => limited.policy.prepare({ method: "GET", path: limited.reads[1] }), "READONLY_BUDGET");
  assert.equal(limited.policy.audit().requests, 1);
  rejects(() => new FaceReadonlyPolicy().beginList(), "READONLY_PHASE");
  const value = fixture(); value.ready();
  rejects(() => value.policy.beginList(), "READONLY_PHASE");
  const done = fixture(); done.ready(); page(done, [], 0); done.policy.finishList();
  rejects(() => done.policy.prepare(request(peoplePath, search())), "READONLY_PHASE");
});
