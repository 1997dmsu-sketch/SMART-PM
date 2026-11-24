import { test } from "node:test";
import assert from "node:assert/strict";
import { FaceEnrollmentService, SimulatedFaceProvider, HikvisionFaceProvider, faceMultipart, decodeFacePhoto, FACE_PHOTO_LIMIT } from "../lib/face-enrollment.mjs";
import { HttpError } from "../lib/model.mjs";

// Synthetic JPEG framing only: never a face and never sent to a device.
const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x46, 0, 1, 0xff, 0xd9]);
const input = (overrides = {}) => ({ employeeNo: "SYNTHETIC_01", name: "合成测试人员", doorNo: 1, FDID: "SIMULATION_FD_01", faceLibType: "blackFD", validFrom: "2026-11-24T09:00", validTo: "2026-11-24T10:00", photoBase64: photo.toString("base64"), photoName: "synthetic.jpg", consent: true, ...overrides });
async function simulated() { const service = new FaceEnrollmentService(); await service.connect({ mode: "simulation" }); return service; }
const jsonReply = value => ({ status: 200, body: Buffer.from(JSON.stringify(value)) });
function allDayPlanFixtures(templateNo = "1") {
  const fullWeek = () => ({ enable: true, WeekPlanCfg: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(week => ({
    week, id: 1, enable: true, authenticationTimesEnabled: false, TimeSegment: { beginTime: "00:00:00", endTime: "23:59:59" },
  })) });
  return {
    "/ISAPI/AccessControl/UserRightPlanTemplate/capabilities?format=json": { UserRightPlanTemplate: { templateNo: { "@min": 1, "@max": 128 } } },
    [`/ISAPI/AccessControl/UserRightPlanTemplate/${templateNo}?format=json`]: { UserRightPlanTemplate: { enable: true, templateName: "合成全天", weekPlanNo: 1, holidayGroupNo: "" } },
    "/ISAPI/AccessControl/UserRightWeekPlanCfg/1?format=json": { UserRightWeekPlanCfg: fullWeek() },
    "/ISAPI/AccessControl/UserRightWeekPlanCfg/2?format=json": { UserRightWeekPlanCfg: fullWeek() },
  };
}

test("simulation explicitly reports its mode and completes four stages without a real client", async () => {
  const service = await simulated();
  const row = await service.enroll(input());
  assert.equal(row.status, "ready");
  assert.equal(row.mode, "simulation");
  assert.equal(row.validityMode, "fixed");
  assert.equal(row.accessPlanTemplateNo, "1");
  assert.match(row.accessPlanFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(row.accessPlanName, "每天24小时");
  assert.deepEqual(row.steps.map((step) => [step.key, step.state]), [["person", "success"], ["face", "success"], ["access", "success"], ["verify", "success"]]);
  assert.equal(row.validFrom, "2026-11-24T09:00:00");
  assert.equal(service.state().enrollments.length, 1);
  assert(!JSON.stringify(service.state()).includes(photo.toString("base64")));
  service.close();
});

test("a connection is required before submitting any person", async () => {
  await assert.rejects(new FaceEnrollmentService().enroll(input()), /先连接/);
});

for (const [label, overrides] of [
  ["existing library only", { FDID: "1" }],
  ["device door only", { doorNo: 2 }],
  ["explicit consent", { consent: false }],
  ["ordered validity", { validTo: "2026-11-24T08:00" }],
  ["real calendar date", { validFrom: "2026-02-30T09:00" }],
  ["no timezone conversion", { validFrom: "2026-11-24T09:00:00Z" }],
  ["bounded ID", { employeeNo: "a".repeat(33) }],
  ["bounded device time", { validTo: "2040-01-01T10:00" }],
  ["no URL in ID", { employeeNo: "../another" }],
  ["nonempty name", { name: " " }],
  ["JPEG content", { photoBase64: Buffer.from("not-an-image").toString("base64") }],
]) test(`rejects ${label} before writing a row`, async () => {
  const service = await simulated();
  await assert.rejects(service.enroll(input(overrides)));
  assert.equal(service.state().enrollments.length, 0);
  service.close();
});

test("photo decoder rejects oversized and noncanonical base64", () => {
  assert.throws(() => decodeFacePhoto("a".repeat(FACE_PHOTO_LIMIT * 2)));
  assert.throws(() => decodeFacePhoto(photo.toString("base64") + "="));
  assert.deepEqual(decodeFacePhoto(photo.toString("base64")), photo);
});

test("multipart uses official faceURL JSON part and img JPEG part with exact bytes", () => {
  const result = faceMultipart(input(), photo);
  const text = result.body.toString("latin1");
  assert.match(result.contentType, /^multipart\/form-data; boundary=/);
  assert.match(text, /name="faceURL"\r\nContent-Type: application\/json/);
  assert.match(text, /name="img"; filename="faceImage.jpg"\r\nContent-Type: image\/jpeg/);
  assert(text.includes('"FPID":"SYNTHETIC_01"'));
  assert(result.body.includes(photo));
  assert(!text.includes("photoBase64"));
});

test("existing device people are not overwritten or silently adopted", async () => {
  const provider = new SimulatedFaceProvider();
  provider.people.set("SYNTHETIC_01", { employeeNo: "SYNTHETIC_01", name: "原人员", doorRight: "1" });
  let writes = 0;
  provider.putFace = async () => { writes++; };
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
  const row = await service.enroll(input());
  assert.equal(row.status, "failed");
  assert.match(row.error, /已有此人员/);
  assert.equal(writes, 0);
  await assert.rejects(service.verify({ id: row.id }), /尚未创建/);
  service.close();
});

test("a failed face upload stops before access and explicit retry resumes without creating a duplicate", async () => {
  const provider = new SimulatedFaceProvider();
  let creates = 0, faces = 0, grants = 0;
  const create = provider.createPerson.bind(provider), upload = provider.putFace.bind(provider), grant = provider.grantAccess.bind(provider);
  provider.createPerson = async (person) => { creates++; await create(person); };
  provider.putFace = async (person, bytes) => { if (++faces === 1) throw new HttpError(502, "合成上传失败"); await upload(person, bytes); };
  provider.grantAccess = async (person) => { grants++; await grant(person); };
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
  const first = await service.enroll(input());
  assert.equal(first.status, "failed");
  assert.equal(first.steps[1].state, "failed");
  assert.equal(grants, 0);
  const retried = await service.retry({ id: first.id });
  assert.equal(retried.status, "ready");
  assert.equal(creates, 1);
  assert.equal(faces, 2);
  assert.equal(grants, 1);
  service.close();
});

for (const searchable of [true, false]) test(`a timed out face upload cannot be adopted by verification with face search ${searchable ? "supported" : "unsupported"}`, async () => {
  const provider = new SimulatedFaceProvider();
  const describe = provider.describe.bind(provider), upload = provider.putFace.bind(provider), grant = provider.grantAccess.bind(provider), findFace = provider.findFace.bind(provider);
  let uploads = 0, grants = 0, searches = 0;
  provider.describe = async () => { const state = await describe(); state.capabilities.faceSearchSupported = searchable; return state; };
  provider.putFace = async (person, bytes) => { await upload(person, bytes); if (++uploads === 1) throw new HttpError(502, "合成上传超时，结果未知"); };
  provider.grantAccess = async (person) => { grants++; await grant(person); };
  provider.findFace = async (person) => { searches++; return findFace(person); };
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
  const first = await service.enroll(input());
  assert.equal(first.status, "failed");
  assert.equal(first.faceAttempted, true);
  assert.notEqual(first.faceSubmitted, true);
  assert.equal(first.steps[1].state, "failed");
  assert.equal(grants, 0);
  assert.equal(provider.people.get(first.employeeNo).numOfFace, 1);
  // Authorize only the fake person so verification reaches the submission guard.
  await grant(first);
  const queried = await service.verify({ id: first.id });
  assert.equal(queried.status, "failed");
  assert.match(queried.error, /尚未确认提交成功/);
  assert.equal(queried.steps[1].state, "failed");
  assert.notEqual(queried.faceAssociationConfirmed, true);
  assert.notEqual(queried.faceModelingVerified, true);
  assert.equal(searches, 0);
  assert.equal(uploads, 1);
  const retried = await service.retry({ id: first.id });
  assert.equal(retried.status, searchable ? "ready" : "pending-site");
  assert.equal(retried.faceSubmitted, true);
  assert.equal(retried.faceAssociationConfirmed, true);
  assert.equal(retried.faceModelingVerified, searchable);
  assert.equal(uploads, 2);
  assert.equal(grants, 1);
  assert.equal(searches, searchable ? 1 : 0);
  service.close();
});

test("an expired photo is not recorded as an attempted upload", async (context) => {
  let now = Date.now();
  context.mock.method(Date, "now", () => now);
  const provider = new SimulatedFaceProvider();
  const create = provider.createPerson.bind(provider);
  let uploads = 0;
  provider.createPerson = async (person) => { await create(person); now += 10 * 60 * 1000 + 1; };
  provider.putFace = async () => { uploads++; };
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
  const row = await service.enroll(input());
  assert.equal(row.status, "failed");
  assert.match(row.error, /照片已释放/);
  assert.notEqual(row.faceAttempted, true);
  assert.notEqual(row.faceSubmitted, true);
  assert.equal(uploads, 0);
  service.close();
});

test("a successful API upload is not ready until modeling is confirmed", async () => {
  const provider = new SimulatedFaceProvider();
  let modeled = false;
  provider.findFace = async () => modeled;
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
  const first = await service.enroll(input());
  assert.equal(first.status, "failed");
  assert.equal(first.steps[3].state, "failed");
  modeled = true;
  const queried = await service.verify({ id: first.id });
  assert.equal(queried.status, "ready");
  assert(queried.steps.every((step) => step.state === "success"));
  service.close();
});

test("unknown write outcome can be queried and does not cause an automatic duplicate POST", async () => {
  const provider = new SimulatedFaceProvider();
  const create = provider.createPerson.bind(provider);
  let count = 0;
  provider.createPerson = async (person) => { count++; await create(person); throw new Error("synthetic timeout"); };
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
  const first = await service.enroll(input());
  assert.equal(first.status, "failed");
  const retried = await service.retry({ id: first.id });
  assert.equal(retried.status, "ready");
  assert.equal(count, 1);
  service.close();
});

test("an unknown selected-library modeling state is not replaced by a positive face count", async () => {
  const provider = new SimulatedFaceProvider();
  provider.findFace = async () => null;
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
  const row = await service.enroll(input());
  assert.equal(provider.people.get(row.employeeNo).numOfFace, 1);
  assert.equal(row.status, "failed");
  assert.equal(row.faceModelingVerified, undefined);
  service.close();
});

test("a device without face search confirms association only and explicitly waits for a site test", async () => {
  const provider = new SimulatedFaceProvider();
  const describe = provider.describe.bind(provider);
  provider.describe = async () => { const state = await describe(); state.capabilities.faceSearchSupported = false; return state; };
  provider.findFace = async () => { throw Error("unsupported endpoint must not be called"); };
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
  const row = await service.enroll(input());
  assert.equal(row.status, "pending-site");
  assert.equal(row.faceAssociationConfirmed, true);
  assert.equal(row.faceModelingVerified, false);
  assert.match(row.steps[3].message, /不支持建模查询/);
  assert.equal((await service.retry({ id: row.id })).status, "pending-site");
  service.close();
});

test("switching mode clears records and photos; closing blocks later operations", async () => {
  const service = await simulated();
  await service.enroll(input());
  await service.connect({ mode: "simulation" });
  assert.equal(service.state().enrollments.length, 0);
  await service.disconnect();
  assert.equal(service.state().connected, false);
  service.close();
  await assert.rejects(service.connect({ mode: "simulation" }), /已关闭/);
});

test("device payload separates creating a person, binary face upsert and selected-door grant", async () => {
  const calls = [];
  const fixtures = allDayPlanFixtures();
  const proof = (await new HikvisionFaceProvider(describedClient()).describe()).capabilities.allDayPlan;
  const client = { async request(call) {
    calls.push({ ...call, body: call.body === undefined ? undefined : Buffer.from(call.body) });
    return jsonReply(fixtures[call.path] || { statusCode: 1, statusString: "OK" });
  }, close() {} };
  const provider = new HikvisionFaceProvider(client);
  const person = { ...input(), validFrom: "2026-11-24T09:00:00", validTo: "2026-11-24T10:00:00", accessPlanTemplateNo: proof.templateNo, accessPlanFingerprint: proof.fingerprint };
  await provider.createPerson(person);
  await provider.putFace(person, photo);
  await provider.grantAccess(person);
  const writes = calls.filter(call => call.method !== "GET");
  const create = JSON.parse(writes[0].body), grant = JSON.parse(writes[2].body);
  assert.equal(create.UserInfo.employeeNo, person.employeeNo);
  assert.equal(create.UserInfo.Valid.timeType, "local");
  assert.equal(create.UserInfo.Valid.enable, true);
  assert.equal(create.UserInfo.doorRight, "");
  assert.equal(writes[1].method, "PUT");
  assert.equal(writes[1].path, "/ISAPI/Intelligent/FDLib/FDSetUp?format=json");
  assert(writes[1].body.includes(photo));
  assert.deepEqual(grant, { UserInfo: { employeeNo: person.employeeNo, doorRight: "1", RightPlan: [{ doorNo: 1, planTemplateNo: "1" }] } });
  assert.equal(calls.filter(call => call.method === "GET").length, 3, "plan is re-read before the access PUT");
  assert(!JSON.stringify(calls).includes("RemoteControl/door"));
});

function describedClient(overrides = {}) {
  const plans = overrides.plans || allDayPlanFixtures();
  return {
    async request({ path }) {
      let value;
      if (path === "/ISAPI/System/deviceInfo") return { status: 200, body: Buffer.from(`<DeviceInfo><model>${overrides.model || "SYNTHETIC"}</model><firmwareVersion>${overrides.firmware || "V0.0"}</firmwareVersion></DeviceInfo>`) };
      if (path.includes("UserInfo/capabilities")) value = { UserInfo: { supportFunction: { "@opt": "post,put,get" }, employeeNo: { "@max": 32 }, name: { "@max": 128 }, userType: { "@opt": "normal,visitor" }, Valid: { timeType: { "@opt": "local" } }, RightPlan: { doorNo: { "@min": 1, "@max": 1 } }, ...overrides.user } };
      else if (path.includes("FDLib/capabilities")) value = { statusCode: 1, supportFDFunction: "post,delete,get,put,setUp", isSuportFDSearch: false, ...overrides.face };
      else if (path === "/ISAPI/Intelligent/FDLib?format=json") value = { FDLib: [{ FDID: "ACTUAL_SHAPE_A", faceLibType: "blackFD" }, { FDID: "ACTUAL_SHAPE_B", faceLibType: "infraredFD" }] };
      else if (Object.hasOwn(plans, path)) value = plans[path];
      else return { status: 403, body: Buffer.from('{"statusCode":4}') };
      return { status: 200, body: Buffer.from(JSON.stringify(value)) };
    }, close() {},
  };
}

test("discovery normalizes the observed capability shapes without inventing FDID or search support", async () => {
  const state = await new HikvisionFaceProvider(describedClient()).describe();
  assert.deepEqual(state.capabilities.libraries.map((row) => row.FDID), ["ACTUAL_SHAPE_A", "ACTUAL_SHAPE_B"]);
  assert.deepEqual(state.capabilities.doorNumbers, [1]);
  assert.equal(state.capabilities.faceSearchSupported, false);
  assert.equal(state.capabilities.employeeNoPattern, "^[A-Za-z0-9]+$");
  assert.equal(state.capabilities.photoLimitSource, "guide-default");
  assert.equal(state.capabilities.timeRangeEnd, "2037-12-31T23:59:59");
  assert.equal(state.capabilities.longTermValiditySupported, false);
  assert.equal(state.capabilities.allDayPlan.templateNo, "1");
  assert.equal(state.capabilities.allDayPlan.name, "每天24小时");
  assert.match(state.capabilities.allDayPlan.fingerprint, /^[a-f0-9]{64}$/);
});

test("missing door capability is not replaced with an invented door 1", async () => {
  await assert.rejects(new HikvisionFaceProvider(describedClient({ user: { RightPlan: undefined } })).describe(), /未返回可确认的门编号/);
});

test("explicitly unsupported face setup is rejected before an enrollment", async () => {
  await assert.rejects(new HikvisionFaceProvider(describedClient({ face: { supportFDFunction: "get" } })).describe(), /未确认人脸查询或设置能力/);
});

test("face setup status code zero is not silently treated as documented success", async () => {
  const provider = new HikvisionFaceProvider({ async request() { return { status: 200, body: Buffer.from('{"statusCode":0}') }; }, close() {} });
  await assert.rejects(provider.putFace(input(), photo), /设备拒绝操作/);
});

test("long-term support requires an explicit false option in the advertised validity capability", async () => {
  for (const [enable, supported] of [[undefined, false], ["true", false], ["true,false", true], [{ "@opt": [true, false] }, true]]) {
    const state = await new HikvisionFaceProvider(describedClient({ user: { Valid: { enable } } })).describe();
    assert.equal(state.capabilities.longTermValiditySupported, supported);
  }
});

test("unlimited validity uses capability dates and a boolean false instead of a distant fixed expiry", async () => {
  const provider = new SimulatedFaceProvider();
  const describe = provider.describe.bind(provider);
  provider.describe = async () => {
    const state = await describe();
    state.capabilities.timeRangeBegin = "2020-01-01T00:00";
    state.capabilities.timeRangeEnd = "2030-12-31T23:59";
    return state;
  };
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
  const values = input({ validityMode: "unlimited" });
  delete values.validFrom;
  delete values.validTo;
  const row = await service.enroll(values);
  assert.equal(row.status, "ready");
  assert.equal(row.validityMode, "unlimited");
  assert.equal(row.validFrom, "2020-01-01T00:00:00");
  assert.equal(row.validTo, "2030-12-31T23:59:00");
  const stored = provider.people.get(row.employeeNo);
  assert.equal(stored.Valid.enable, false);
  assert.equal(stored.Valid.timeType, "local");
  assert.equal(stored.Valid.beginTime, row.validFrom);
  assert.equal(stored.Valid.endTime, row.validTo);
  assert.match(row.steps[2].message, /长期有效/);
  assert(!row.steps[2].message.includes("2030"));
  service.close();
});

test("unlimited device payload retains legal dates and sends enable as a boolean false", async () => {
  let payload;
  const provider = new HikvisionFaceProvider({
    async request(call) { payload = JSON.parse(call.body); return { status: 200, body: Buffer.from('{"statusCode":1}') }; },
    close() {},
  });
  await provider.createPerson({ ...input(), validityMode: "unlimited", validFrom: "2020-01-01T00:00:00", validTo: "2030-12-31T23:59:59" });
  assert.deepEqual(payload.UserInfo.Valid, { enable: false, beginTime: "2020-01-01T00:00:00", endTime: "2030-12-31T23:59:59", timeType: "local" });
  assert.equal(payload.UserInfo.doorRight, "");
});

test("unlimited validity is rejected before writes when capability is false or missing", async () => {
  for (const supported of [false, undefined]) {
    const provider = new SimulatedFaceProvider();
    const describe = provider.describe.bind(provider);
    let creates = 0;
    provider.describe = async () => { const state = await describe(); state.capabilities.longTermValiditySupported = supported; return state; };
    provider.createPerson = async () => { creates++; };
    const service = new FaceEnrollmentService({ providerFactory: () => provider });
    await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
    await assert.rejects(service.enroll(input({ validityMode: "unlimited", validFrom: undefined, validTo: undefined })), /未确认支持长期有效/);
    assert.equal(creates, 0);
    assert.equal(service.state().enrollments.length, 0);
    service.close();
  }
});

test("only omitted validity mode defaults to fixed and all other invalid values are rejected", async () => {
  const service = await simulated();
  for (const validityMode of [null, "", true, false, 0, {}, [], "permanent", "UNLIMITED"]) {
    await assert.rejects(service.enroll(input({ validityMode })), /有效期模式无效/);
    assert.equal(service.state().enrollments.length, 0);
  }
  const row = await service.enroll(input());
  assert.equal(row.status, "ready");
  assert.equal(row.validityMode, "fixed");
  assert.equal(row.validTo, "2026-11-24T10:00:00");
  service.close();
});

test("unlimited wire dates still require a legal ordered capability range", async () => {
  for (const overrides of [
    { timeRangeBegin: "2026-02-30T00:00:00" },
    { timeRangeBegin: "2030-01-01T00:00:00", timeRangeEnd: "2020-01-01T00:00:00" },
    { timeRangeEnd: undefined },
  ]) {
    const provider = new SimulatedFaceProvider();
    const describe = provider.describe.bind(provider);
    provider.describe = async () => { const state = await describe(); Object.assign(state.capabilities, overrides); return state; };
    const service = new FaceEnrollmentService({ providerFactory: () => provider });
    await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
    await assert.rejects(service.enroll(input({ validityMode: "unlimited" })), /时间/);
    assert.equal(service.state().enrollments.length, 0);
    assert.equal(provider.people.size, 0);
    service.close();
  }
});

for (const validityMode of ["fixed", "unlimited"]) test(`${validityMode} verification binds enable and dates while accepting omitted or local timeType`, async () => {
  const provider = new SimulatedFaceProvider();
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
  const row = await service.enroll(input({ validityMode }));
  assert.equal(row.status, "ready");
  const stored = provider.people.get(row.employeeNo), original = structuredClone(stored.Valid);
  stored.Valid.enable = !original.enable;
  assert.equal((await service.verify({ id: row.id })).status, "failed");
  stored.Valid = { ...original, beginTime: "2025-01-01T00:00:00" };
  assert.equal((await service.verify({ id: row.id })).status, "failed");
  stored.Valid = { ...original, timeType: "UTC" };
  assert.equal((await service.verify({ id: row.id })).status, "failed");
  stored.Valid = { ...original };
  delete stored.Valid.timeType;
  assert.equal((await service.verify({ id: row.id })).status, "ready");
  stored.Valid.timeType = "local";
  assert.equal((await service.verify({ id: row.id })).status, "ready");
  service.close();
});

for (const validityMode of ["fixed", "unlimited"]) test(`${validityMode} retry does not adopt an existing record with the opposite enable`, async () => {
  const provider = new SimulatedFaceProvider();
  const create = provider.createPerson.bind(provider), upload = provider.putFace.bind(provider);
  let creates = 0, uploads = 0;
  provider.createPerson = async (person) => {
    creates++;
    await create(person);
    provider.people.get(person.employeeNo).Valid.enable = validityMode === "unlimited";
    throw Error("synthetic create timeout");
  };
  provider.putFace = async (person, bytes) => { uploads++; await upload(person, bytes); };
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
  const first = await service.enroll(input({ validityMode }));
  assert.equal(first.status, "failed");
  const rejected = await service.retry({ id: first.id, validityMode: validityMode === "fixed" ? "unlimited" : "fixed" });
  assert.equal(rejected.status, "failed");
  assert.equal(rejected.validityMode, validityMode);
  assert.match(rejected.error, /设备人员与本次测试不一致/);
  assert.equal(uploads, 0);
  assert.equal(creates, 1);
  provider.people.get(first.employeeNo).Valid.enable = validityMode !== "unlimited";
  const retried = await service.retry({ id: first.id });
  assert.equal(retried.status, "ready");
  assert.equal(retried.validityMode, validityMode);
  assert.equal(uploads, 1);
  assert.equal(creates, 1);
  service.close();
});

test("default fixed enrollment binds the internal all-day plan and ignores request/state proof forgeries", async t => {
  const provider = new SimulatedFaceProvider();
  const advertised = await provider.describe();
  provider.describe = async () => advertised;
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  t.after(() => service.close());
  const connected = await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
  const expected = structuredClone(connected.capabilities.allDayPlan);
  connected.capabilities.allDayPlan.templateNo = "2";
  advertised.capabilities.allDayPlan.templateNo = "3";
  advertised.capabilities.allDayPlan.fingerprint = "0".repeat(64);
  const row = await service.enroll(input({
    accessPlanTemplateNo: "4", accessPlanFingerprint: "f".repeat(64), accessPlanName: "伪造计划",
    allDayPlan: { templateNo: "5", fingerprint: "e".repeat(64), name: "伪造计划" },
  }));
  assert.equal(row.status, "ready");
  assert.equal(row.validityMode, "fixed");
  assert.equal(row.validTo, "2026-11-24T10:00:00");
  assert.equal(row.accessPlanTemplateNo, expected.templateNo);
  assert.equal(row.accessPlanFingerprint, expected.fingerprint);
  assert.equal(row.accessPlanName, "每天24小时");
  assert.deepEqual(provider.people.get(row.employeeNo).RightPlan, [{ doorNo: 1, planTemplateNo: expected.templateNo }]);
});

test("missing or invalid all-day proof stops before creating a person even when the request supplies a proof", async t => {
  for (const invalidProof of [undefined, { templateNo: "0", name: "每天24小时", fingerprint: "a".repeat(64) }, { templateNo: "1", name: "每天24小时", fingerprint: "" }]) {
    const provider = new SimulatedFaceProvider();
    const describe = provider.describe.bind(provider);
    provider.describe = async () => { const state = await describe(); state.capabilities.allDayPlan = invalidProof; return state; };
    const service = new FaceEnrollmentService({ providerFactory: () => provider });
    t.after(() => service.close());
    await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
    await assert.rejects(service.enroll(input({ accessPlanTemplateNo: "1", accessPlanFingerprint: "a".repeat(64) })), /未确认每天24小时权限计划/);
    assert.equal(provider.people.size, 0);
    assert.deepEqual(service.state().enrollments, []);
  }
});

test("real discovery rejects a partial-day plan and supports an explicitly configured all-day candidate", async () => {
  const partialPlans = allDayPlanFixtures();
  partialPlans["/ISAPI/AccessControl/UserRightWeekPlanCfg/1?format=json"].UserRightWeekPlanCfg.WeekPlanCfg[6].TimeSegment.endTime = "23:00:00";
  await assert.rejects(new HikvisionFaceProvider(describedClient({ plans: partialPlans })).describe());
  const state = await new HikvisionFaceProvider(describedClient({ plans: allDayPlanFixtures("2") }), { planTemplateNo: "2" }).describe();
  assert.equal(state.capabilities.allDayPlan.templateNo, "2");
  assert.match(state.capabilities.allDayPlan.fingerprint, /^[a-f0-9]{64}$/);
});

test("access grant revalidates the plan fingerprint and never PUTs after a changed or invalid plan", async () => {
  const plans = allDayPlanFixtures();
  const base = describedClient({ plans });
  const writes = [];
  const provider = new HikvisionFaceProvider({
    async request(call) {
      if (call.method === "PUT") { writes.push(call); return jsonReply({ statusCode: 1 }); }
      return base.request(call);
    }, close() {},
  });
  const proof = (await provider.describe()).capabilities.allDayPlan;
  const person = { ...input(), accessPlanTemplateNo: proof.templateNo, accessPlanFingerprint: proof.fingerprint };
  plans["/ISAPI/AccessControl/UserRightPlanTemplate/1?format=json"].UserRightPlanTemplate.weekPlanNo = 2;
  await assert.rejects(provider.grantAccess(person), /权限计划已变更/);
  assert.equal(writes.length, 0);
  plans["/ISAPI/AccessControl/UserRightPlanTemplate/1?format=json"].UserRightPlanTemplate.weekPlanNo = 1;
  plans["/ISAPI/AccessControl/UserRightWeekPlanCfg/1?format=json"].UserRightWeekPlanCfg.enable = false;
  await assert.rejects(provider.grantAccess(person));
  assert.equal(writes.length, 0);
});

test("a door number alone is insufficient and verification requires the selected template on that door", async t => {
  const provider = new SimulatedFaceProvider();
  provider.grantAccess = async person => { provider.people.get(person.employeeNo).doorRight = String(person.doorNo); };
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  t.after(() => service.close());
  await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
  const first = await service.enroll(input());
  assert.equal(first.status, "failed");
  assert.equal(first.steps[3].state, "failed");
  assert.match(first.error, /权限计划尚未查询确认/);
  const stored = provider.people.get(first.employeeNo);
  for (const binding of [
    undefined, [], [{ doorNo: 2, planTemplateNo: first.accessPlanTemplateNo }],
    [{ doorNo: 1, planTemplateNo: "2" }], [{ doorNo: 1, planTemplateNo: 1 }],
    [{ doorNo: 1, planTemplateNo: "2,1" }], [{ doorNo: 1, planTemplateNo: "1,1" }],
    [{ doorNo: 1, planTemplateNo: "1," }],
    [{ doorNo: 1, planTemplateNo: "1" }, { doorNo: 1, planTemplateNo: "1" }],
    [{ doorNo: 1, planTemplateNo: "1" }, { doorNo: 1, planTemplateNo: "2" }],
  ]) {
    stored.RightPlan = binding;
    const result = await service.verify({ id: first.id });
    assert.equal(result.status, "failed");
    assert.match(result.error, /权限计划尚未查询确认/);
  }
  stored.RightPlan = [{ doorNo: 1, planTemplateNo: ` ${first.accessPlanTemplateNo} ` }];
  assert.equal((await service.verify({ id: first.id })).status, "ready");
});

async function canonicalizingProvider(t, { model = "DS-K1T671BM", firmware = "V3.3.180", actual = {}, failCreate = false } = {}) {
  const provider = new SimulatedFaceProvider();
  const describe = provider.describe.bind(provider), create = provider.createPerson.bind(provider);
  let creates = 0;
  provider.describe = async () => { const state = await describe(); state.device = { model, firmware }; return state; };
  provider.createPerson = async person => {
    creates += 1;
    await create(person);
    Object.assign(provider.people.get(person.employeeNo).Valid, { beginTime: "1970-01-01T00:00:00", endTime: "1970-01-01T00:00:00", ...actual });
    if (failCreate) throw Error("synthetic unknown create outcome");
  };
  const service = new FaceEnrollmentService({ providerFactory: () => provider });
  t.after(() => service.close());
  await service.connect({ mode: "device", origin: "https://synthetic.invalid" });
  return { service, provider, creates: () => creates };
}

for (const timeType of [undefined, "local"]) test(`observed exact device profile accepts only its unlimited 1970 date pair with ${timeType || "omitted"} timeType`, async t => {
  const { service } = await canonicalizingProvider(t, { actual: { timeType } });
  const row = await service.enroll(input({ validityMode: "unlimited" }));
  assert.equal(row.status, "ready");
  assert.equal(row.validityMode, "unlimited");
  assert.equal(row.validTo, "2037-12-31T23:59:59", "the requested legal range is retained in the enrollment record");
  assert.equal((await service.verify({ id: row.id })).status, "ready");
  assert.ok(!Object.keys(row).some(key => /canonical/i.test(key)), "profile flag stays private");
});

for (const [label, options, validityMode] of [
  ["different model", { model: "DS-K1T671BM-X" }, "unlimited"],
  ["different firmware", { firmware: "V3.3.181" }, "unlimited"],
  ["firmware suffix", { firmware: "V3.3.180 build 1" }, "unlimited"],
  ["fixed validity", {}, "fixed"],
  ["true enable", { actual: { enable: true } }, "unlimited"],
  ["string false enable", { actual: { enable: "false" } }, "unlimited"],
  ["another end date", { actual: { endTime: "1970-01-02T00:00:00" } }, "unlimited"],
  ["another begin date", { actual: { beginTime: "1970-01-02T00:00:00" } }, "unlimited"],
  ["UTC timeType", { actual: { timeType: "UTC" } }, "unlimited"],
]) test(`observed date canonicalization does not relax ${label}`, async t => {
  const { service } = await canonicalizingProvider(t, options);
  const row = await service.enroll(input({ validityMode, observedUnlimitedCanonicalization: true, allowObservedCanonicalization: true }));
  assert.equal(row.status, "failed");
  assert.match(row.error, /人员、有效期或门权限尚未查询确认/);
});

test("request profile claims cannot enable date canonicalization on an unobserved device", async t => {
  const { service } = await canonicalizingProvider(t, { model: "SYNTHETIC", firmware: "V0.0" });
  const row = await service.enroll(input({
    validityMode: "unlimited", model: "DS-K1T671BM", firmware: "V3.3.180",
    observedUnlimitedCanonicalization: true, allowObservedCanonicalization: true,
    device: { model: "DS-K1T671BM", firmware: "V3.3.180" },
  }));
  assert.equal(row.status, "failed");
  assert.match(row.error, /有效期/);
});

test("explicit retry on the observed profile queries its canonicalized person without duplicate creation", async t => {
  const { service, creates } = await canonicalizingProvider(t, { failCreate: true });
  const first = await service.enroll(input({ validityMode: "unlimited" }));
  assert.equal(first.status, "failed");
  assert.equal(first.steps[0].state, "failed");
  assert.equal(creates(), 1);
  const retried = await service.retry({ id: first.id, accessPlanTemplateNo: "2", accessPlanFingerprint: "f".repeat(64), validityMode: "fixed" });
  assert.equal(retried.status, "ready");
  assert.equal(retried.validityMode, "unlimited");
  assert.equal(retried.accessPlanTemplateNo, "1");
  assert.equal(creates(), 1);
});
