import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFaceEnrollment,
  facePhotoDimensions,
  faceSiteNote,
  faceStatus,
  faceValidityLabel,
  fitFacePhoto,
  renderFaceValidityFields,
  renderFaceSteps,
  validateFacePhoto,
} from "../public/face-ui.js";

const capabilities = {
  libraries: [{ FDID: "7", faceLibType: "blackFD" }, { FDID: "42", faceLibType: "ordinaryFD" }],
  doorNumbers: [2, 4],
  maxPhotoBytes: 204800,
};
const values = {
  employeeNo: "  TEST-200  ", name: "  测试人员  ",
  doorNo: "4", library: "1",
  validFrom: "2026-11-24T08:00", validTo: "2026-11-24T18:00",
  consent: true,
};
const photo = { name: "test.jpg", size: 100, base64: "/9j/" };
const escapeHtml = (text) => String(text).replaceAll("<", "&lt;").replaceAll(">", "&gt;");

test("enrollment uses the selected device library and door without assuming FDID=1", () => {
  assert.deepEqual(buildFaceEnrollment(values, capabilities, photo), {
    employeeNo: "TEST-200", name: "测试人员", doorNo: 4,
    validityMode: "fixed",
    validFrom: values.validFrom, validTo: values.validTo,
    FDID: "42", faceLibType: "ordinaryFD",
    photoBase64: "/9j/", photoName: "test.jpg", consent: true,
  });
});

test("fixed validity remains the default and keeps date ordering checks", () => {
  const original = buildFaceEnrollment(values, capabilities, photo);
  assert.equal(original.validityMode, "fixed");
  assert.deepEqual(buildFaceEnrollment({ ...values, validityMode: "fixed" }, capabilities, photo), original);
  for (const change of [
    { validFrom: values.validTo }, { validTo: values.validFrom },
    { validFrom: "" }, { validTo: undefined }, { validTo: "not-a-date" },
  ]) assert.throws(() => buildFaceEnrollment({ ...values, ...change, validityMode: "fixed" }, capabilities, photo), /开始时间必须早于结束时间/);
});

test("unlimited validity requires explicit capability support and never sends user or placeholder dates", () => {
  const unlimited = { ...values, validityMode: "unlimited", validFrom: "not-a-date", validTo: "2037-12-31T23:59" };
  const supported = { ...capabilities, longTermValiditySupported: true };
  const result = buildFaceEnrollment(unlimited, supported, photo);
  assert.equal(result.validityMode, "unlimited");
  assert.equal(Object.hasOwn(result, "validFrom"), false);
  assert.equal(Object.hasOwn(result, "validTo"), false);
  assert.equal(result.consent, true);
  assert.equal(result.photoBase64, photo.base64);
  for (const capability of [undefined, null, false, "true", 1])
    assert.throws(() => buildFaceEnrollment(unlimited, { ...capabilities, longTermValiditySupported: capability }, photo), /未声明支持长期有效/);
  assert.throws(() => buildFaceEnrollment({ ...unlimited, consent: false }, supported, photo), /确认.*照片/);
  assert.throws(() => buildFaceEnrollment(unlimited, supported, null), /请选择.*照片/);
});

test("explicit invalid validity modes cannot coerce into fixed or unlimited", () => {
  for (const validityMode of [null, "", true, false, "true", "false", "forever", 0, 1, [], {}])
    assert.throws(() => buildFaceEnrollment({ ...values, validityMode }, { ...capabilities, longTermValiditySupported: true }, photo), /固定期限或长期有效/);
});

test("validity fields default to fixed and only expose a date-free unlimited option for supported devices", () => {
  const supported = { ...capabilities, longTermValiditySupported: true };
  const fixed = renderFaceValidityFields(values, supported, escapeHtml);
  assert.match(fixed, /value="fixed" selected/);
  assert.match(fixed, /name="validFrom"/);
  assert.match(fixed, /name="validTo"/);
  const unlimited = renderFaceValidityFields({ ...values, validityMode: "unlimited" }, supported, escapeHtml);
  assert.match(unlimited, /value="unlimited" selected/);
  assert.match(unlimited, /长期有效，无截止日期/);
  assert.doesNotMatch(unlimited, /name="validFrom"|name="validTo"|datetime-local|2037/);
  for (const capability of [undefined, false, "true"] ) {
    const unsupported = renderFaceValidityFields({ ...values, validityMode: "unlimited" }, { ...capabilities, longTermValiditySupported: capability }, escapeHtml);
    assert.doesNotMatch(unsupported, /option value="unlimited"/);
    assert.match(unsupported, /value="fixed" selected/);
    assert.match(unsupported, /name="validFrom"/);
    assert.match(unsupported, /未声明支持长期有效/);
  }
});

test("unlimited records say long-term validity without exposing backend placeholder dates", () => {
  assert.equal(faceValidityLabel({ validityMode: "unlimited", validFrom: "2026-11-24T00:00", validTo: "2037-12-31T23:59" }), "长期有效");
  assert.equal(faceValidityLabel({ validityMode: "fixed", ...values }), `${values.validFrom} 至 ${values.validTo}`);
  assert.equal(faceValidityLabel(values), `${values.validFrom} 至 ${values.validTo}`);
});

test("enrollment requires identity, consent, photo, valid dates and advertised capability choices", () => {
  for (const change of [
    { employeeNo: " " }, { name: "" }, { consent: false }, { consent: "false" },
    { validFrom: values.validTo }, { validTo: "2026-11-24T07:59" },
    { validFrom: "" }, { validTo: "not-a-date" },
    { doorNo: "1" }, { library: "" }, { library: "2" },
  ]) assert.throws(() => buildFaceEnrollment({ ...values, ...change }, capabilities, photo));
  assert.throws(() => buildFaceEnrollment(values, capabilities, null), /照片/);
  assert.throws(() => buildFaceEnrollment(values, capabilities, { ...photo, size: 204801 }), /照片上限/);
  assert.throws(() => buildFaceEnrollment(values, { ...capabilities, maxPhotoBytes: undefined }, photo), /照片上限/);
});

test("JPEG validation checks the actual signature and working limit, allowing large originals only for local processing", () => {
  const valid = { name: "test.jpg", size: 204800, type: "image/jpeg" };
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);
  assert.doesNotThrow(() => validateFacePhoto(valid, 204800, jpeg));
  assert.doesNotThrow(() => validateFacePhoto({ ...valid, type: "", name: "TEST.JPEG" }, 204800, jpeg));
  assert.throws(() => validateFacePhoto({ ...valid, size: 204801 }, 204800, jpeg), /200 KB/);
  assert.throws(() => validateFacePhoto({ ...valid, size: 0 }, 204800, jpeg), /不能为空/);
  assert.throws(() => validateFacePhoto(valid, undefined, jpeg), /照片上限/);
  assert.doesNotThrow(() => validateFacePhoto({ ...valid, size: 5 * 1024 * 1024 }, 204800, jpeg, { allowOversize: true }));
  assert.throws(() => validateFacePhoto(valid, 204800, new Uint8Array([0x89, 0x50, 0x4e])), /JPEG/);
  assert.throws(() => validateFacePhoto({ ...valid, type: "image/png" }, 204800, jpeg), /JPEG/);
  assert.throws(() => validateFacePhoto(null, 204800, jpeg), /请选择/);
});

test("employee number validation follows the advertised rule and permits simulation underscores", () => {
  const deviceCapabilities = { ...capabilities, employeeNoPattern: "[A-Za-z0-9]+" };
  assert.doesNotThrow(() => buildFaceEnrollment({ ...values, employeeNo: "TEST20261124" }, deviceCapabilities, photo));
  assert.throws(() => buildFaceEnrollment({ ...values, employeeNo: "TEST_2026" }, deviceCapabilities, photo), /人员编号/);
  assert.doesNotThrow(() => buildFaceEnrollment({ ...values, employeeNo: "TEST_2026" }, { ...capabilities, employeeNoPattern: "[A-Za-z0-9_-]+" }, photo));
});

test("ready status distinguishes simulation from device provisioning and never claims a face scan passed", () => {
  assert.match(faceStatus({ status: "ready" }, "simulation"), /模拟.*未下发现场设备/);
  assert.equal(faceStatus({ status: "ready" }, "device"), "已下发，待现场刷脸");
  assert.equal(faceStatus({ status: "failed" }, "device"), "同步失败");
  assert.equal(faceStatus({ status: "running" }, "simulation"), "正在同步");
  assert.equal(faceStatus({ status: "unexpected" }, "device"), "待查询确认");
});

test("pending-site confirms provisioning without claiming modeling verification or a completed final step", () => {
  const enrollment = {
    status: "pending-site", faceAssociationConfirmed: true, faceModelingVerified: false,
    steps: [
      { key: "person", state: "success" }, { key: "face", state: "success" },
      { key: "access", state: "success" }, { key: "verify", state: "success" },
    ],
  };
  assert.equal(faceStatus(enrollment, "device"), "已下发，待现场刷脸");
  assert.match(faceSiteNote(enrollment), /关联已确认.*尚未验证.*现场/);
  assert.equal(faceSiteNote({ status: "ready" }), "");
  const markup = renderFaceSteps(enrollment, escapeHtml);
  assert.match(markup, /face-step site/);
  assert.match(markup, /待现场刷脸/);
  assert.equal((markup.match(/face-step success/g) || []).length, 3);
  assert.doesNotMatch(markup, /face-step failed|建模成功|识别成功/);
});

test("local photo dimensions preserve the complete aspect ratio, limit the longest edge and never upscale", () => {
  assert.deepEqual(facePhotoDimensions(4000, 3000), { width: 960, height: 720 });
  assert.deepEqual(facePhotoDimensions(3000, 4000), { width: 720, height: 960 });
  assert.deepEqual(facePhotoDimensions(300, 400), { width: 300, height: 400 });
  assert.throws(() => facePhotoDimensions(0, 400), /照片尺寸/);
});

test("local compression reduces quality and dimensions until the result fits the working byte limit", async () => {
  const attempts = [];
  const result = await fitFacePhoto({
    width: 4000, height: 3000, maxPhotoBytes: 204800,
    encode: async (settings) => {
      attempts.push(settings);
      return { size: Math.ceil(settings.width * settings.height * settings.quality) };
    },
  });
  assert.ok(result.blob.size <= 204800);
  assert.ok(result.width < 960, "the large result must also reduce dimensions when quality alone is insufficient");
  assert.ok(attempts.length > 1);
  for (const attempt of attempts) {
    assert.ok(attempt.width <= 960 && attempt.height <= 960);
    assert.ok(Math.abs(attempt.width / attempt.height - 4 / 3) < 0.01);
    assert.ok(attempt.quality >= 0.42 && attempt.quality <= 0.9);
  }
});

test("local compression reports impossible limits and encoder failures instead of returning an oversized image", async () => {
  await assert.rejects(fitFacePhoto({
    width: 4000, height: 3000, maxPhotoBytes: 100,
    encode: async () => ({ size: 101 }),
  }), /仍超过.*照片上限/);
  await assert.rejects(fitFacePhoto({
    width: 4000, height: 3000, maxPhotoBytes: 204800,
    encode: async () => null,
  }), /处理失败/);
});

test("progress shows the precise failed step, escapes device messages and leaves unknown steps pending", () => {
  const markup = renderFaceSteps({ steps: [
    { key: "person", state: "success" },
    { key: "face", state: "failed", message: "<script>设备照片错误</script>" },
    { key: "access", state: 'bad" onclick="unsafe' },
  ] }, escapeHtml);
  assert.match(markup, /face-step success/);
  assert.match(markup, /face-step failed/);
  assert.match(markup, /&lt;script&gt;设备照片错误&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /<script>|onclick/);
  assert.equal((markup.match(/face-step pending/g) || []).length, 2);
  for (const label of ["建人", "上传人脸", "授权门", "查询确认"])
    assert.ok(markup.includes(label));
});
