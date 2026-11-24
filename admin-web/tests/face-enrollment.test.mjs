import { test } from "node:test";
import assert from "node:assert/strict";
import { FaceEnrollmentService, SimulatedFaceProvider, HikvisionFaceProvider, faceMultipart, decodeFacePhoto, FACE_PHOTO_LIMIT } from "../lib/face-enrollment.mjs";
import { HttpError } from "../lib/model.mjs";

// Synthetic JPEG framing only: never a face and never sent to a device.
const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x46, 0, 1, 0xff, 0xd9]);
const input = (overrides = {}) => ({ employeeNo: "SYNTHETIC_01", name: "合成测试人员", doorNo: 1, FDID: "SIMULATION_FD_01", faceLibType: "blackFD", validFrom: "2026-11-24T09:00", validTo: "2026-11-24T10:00", photoBase64: photo.toString("base64"), photoName: "synthetic.jpg", consent: true, ...overrides });
async function simulated() { const service = new FaceEnrollmentService(); await service.connect({ mode: "simulation" }); return service; }

test("simulation explicitly reports its mode and completes four stages without a real client", async () => {
  const service = await simulated();
  const row = await service.enroll(input());
  assert.equal(row.status, "ready");
  assert.equal(row.mode, "simulation");
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
  const client = { async request(call) { calls.push({ ...call, body: Buffer.from(call.body) }); return { status: 200, body: Buffer.from('{"statusCode":1,"statusString":"OK"}') }; }, close() {} };
  const provider = new HikvisionFaceProvider(client);
  const person = { ...input(), validFrom: "2026-11-24T09:00:00", validTo: "2026-11-24T10:00:00" };
  await provider.createPerson(person);
  await provider.putFace(person, photo);
  await provider.grantAccess(person);
  const create = JSON.parse(calls[0].body), grant = JSON.parse(calls[2].body);
  assert.equal(create.UserInfo.employeeNo, person.employeeNo);
  assert.equal(create.UserInfo.Valid.timeType, "local");
  assert.equal(create.UserInfo.doorRight, "");
  assert.equal(calls[1].method, "PUT");
  assert.equal(calls[1].path, "/ISAPI/Intelligent/FDLib/FDSetUp?format=json");
  assert(calls[1].body.includes(photo));
  assert.deepEqual(grant, { UserInfo: { employeeNo: person.employeeNo, doorRight: "1" } });
  assert(!JSON.stringify(calls).includes("RemoteControl/door"));
});

function describedClient(overrides = {}) {
  return {
    async request({ path }) {
      let value;
      if (path === "/ISAPI/System/deviceInfo") return { status: 200, body: Buffer.from("<DeviceInfo><model>SYNTHETIC</model><firmwareVersion>V0.0</firmwareVersion></DeviceInfo>") };
      if (path.includes("UserInfo/capabilities")) value = { UserInfo: { supportFunction: { "@opt": "post,put,get" }, employeeNo: { "@max": 32 }, name: { "@max": 128 }, userType: { "@opt": "normal,visitor" }, Valid: { timeType: { "@opt": "local" } }, RightPlan: { doorNo: { "@min": 1, "@max": 1 } }, ...overrides.user } };
      else if (path.includes("FDLib/capabilities")) value = { statusCode: 1, supportFDFunction: "post,delete,get,put,setUp", isSuportFDSearch: false, ...overrides.face };
      else if (path === "/ISAPI/Intelligent/FDLib?format=json") value = { FDLib: [{ FDID: "ACTUAL_SHAPE_A", faceLibType: "blackFD" }, { FDID: "ACTUAL_SHAPE_B", faceLibType: "infraredFD" }] };
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
