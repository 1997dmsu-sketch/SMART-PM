import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildReport,
  parseCapabilities,
  parseCount,
  parseDeviceInfo,
  parseFdLibList,
} from "../src/report.mjs";
import { maskIp, maskMac, maskSerial, maskUser, redactText } from "../src/redact.mjs";

const DEVICE_XML = `<?xml version="1.0"?>
<DeviceInfo><deviceName>Gate-608</deviceName><model>DS-K1T671BM</model>
<serialNumber>SN99887766</serialNumber><macAddress>aa-bb-cc-dd-ee-ff</macAddress>
<firmwareVersion>V3.2.1</firmwareVersion><firmwareReleasedDate>240315</firmwareReleasedDate>
<deviceType>AccessControl</deviceType></DeviceInfo>`;

const CAPS_XML = `<AccessControlCapabilities>
<isSupportFaceLibrary>true</isSupportFaceLibrary>
<isSupportFaceData>true</isSupportFaceData>
<isSupportFingerprint>false</isSupportFingerprint>
</AccessControlCapabilities>`;

test("解析 deviceInfo 的型号与固件", () => {
  const info = parseDeviceInfo(DEVICE_XML);
  assert.equal(info.model, "DS-K1T671BM");
  assert.equal(info.firmwareVersion, "V3.2.1");
  assert.equal(info.deviceType, "AccessControl");
  assert.equal(info.serialNumber, "SN99887766");
});

test("能力集 XML 只收录 true 项，并识别人脸相关节点", () => {
  const caps = parseCapabilities(CAPS_XML);
  assert.deepEqual(caps.supported, ["isSupportFaceLibrary", "isSupportFaceData"]);
  assert.equal(caps.faceRelated.length, 2);
  assert.equal(caps.nodeCount, 2);
});

test("能力集 JSON 递归收集布尔真值", () => {
  const caps = parseCapabilities(JSON.stringify({ A: { faceDataRecord: true, card: false }, b: true }));
  assert.ok(caps.supported.includes("A.faceDataRecord"));
  assert.ok(caps.supported.includes("b"));
});

test("空能力集与畸形报文不会抛错", () => {
  assert.equal(parseCapabilities("<AccessControlCapabilities/>").nodeCount, 0);
  assert.equal(parseCapabilities("{broken").nodeCount, 0);
});

test("计数解析兼容 JSON 与 XML", () => {
  assert.equal(parseCount('{"FaceCount": 12}'), 12);
  assert.equal(parseCount("<FaceCount>7</FaceCount>"), 7);
  assert.equal(parseCount("nonsense"), null);
});

test("人脸库列表解析", () => {
  const list = parseFdLibList(JSON.stringify({ FDList: [{ name: "default", faceLibType: "blackFD", count: 12 }] }));
  assert.equal(list[0].name, "default");
  assert.equal(list[0].count, 12);
});

test("报告不包含序列号、MAC、账号等身份信息", () => {
  const report = buildReport({
    target: { host: "192.168.x.x", port: 443 },
    generatedAt: "2026-11-05T00:00:00.000Z",
    results: [
      { id: "deviceInfo", status: 200, headers: {}, body: Buffer.from(DEVICE_XML), parsed: parseDeviceInfo(DEVICE_XML) },
      { id: "acsCapabilities", status: 200, headers: {}, body: Buffer.from(CAPS_XML) },
    ],
  });
  const text = JSON.stringify(report);
  assert.equal(report.device.model, "DS-K1T671BM");
  assert.doesNotMatch(text, /SN99887766/);
  assert.doesNotMatch(text, /aa-bb-cc-dd-ee-ff/);
  assert.doesNotMatch(text, /Gate-608/);
});

test("脱敏工具：IP / MAC / 序列号 / 用户名 / 文本兜底", () => {
  assert.equal(maskIp("192.168.1.64"), "192.168.x.x");
  assert.equal(maskIp("::1"), "ipv6:***");
  assert.equal(maskMac("aa-bb-cc-dd-ee-ff"), "aa:**:**:**:**:**");
  assert.equal(maskSerial("SN99887766"), "********66");
  assert.equal(maskUser("admin"), "a****");
  const cleaned = redactText("nonce=abc realm=\"DS-1\" 192.168.1.64 aa-bb-cc-dd-ee-ff");
  assert.doesNotMatch(cleaned, /192\.168\.1\.64/);
  assert.doesNotMatch(cleaned, /aa-bb-cc-dd-ee-ff/);
  assert.doesNotMatch(cleaned, /nonce=abc/);
});
