import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ProbeError,
  READ_ENDPOINTS,
  assertAllowedHost,
  assertAllowedPort,
  assertAllowedRequest,
  buildRequestPath,
  findEndpoint,
  listEndpoints,
  parseAllowedHosts,
  parseAllowedPorts,
} from "../src/allowlist.mjs";

const HOSTS = ["192.168.1.64"];
const PORTS = [443];

test("白名单恰好是任务卡允许的 6 个只读端点", () => {
  assert.equal(READ_ENDPOINTS.length, 6);
  const paths = READ_ENDPOINTS.map((endpoint) => buildRequestPath(endpoint));
  assert.deepEqual(paths, [
    "/ISAPI/System/deviceInfo",
    "/ISAPI/AccessControl/capabilities",
    "/ISAPI/AccessControl/UserInfo/capabilities?format=json",
    "/ISAPI/Intelligent/FDLib/capabilities?format=json",
    "/ISAPI/Intelligent/FDLib?format=json",
    "/ISAPI/Intelligent/FDLib/Count?format=json",
  ]);
});

test("全部白名单端点可通过校验", () => {
  for (const endpoint of READ_ENDPOINTS) {
    const resolved = assertAllowedRequest({
      method: "GET",
      endpointId: endpoint.id,
      path: endpoint.path,
      query: endpoint.query,
    });
    assert.equal(resolved.id, endpoint.id);
  }
});

test("拒绝非 GET 方法与未知端点", () => {
  assert.throws(
    () => assertAllowedRequest({ method: "POST", endpointId: "deviceInfo", path: "/ISAPI/System/deviceInfo", query: "" }),
    ProbeError,
  );
  assert.throws(
    () => assertAllowedRequest({ method: "GET", endpointId: "reboot", path: "/ISAPI/System/reboot", query: "" }),
    /未知端点/,
  );
});

test("拒绝路径穿越、尾随斜杠与多余查询参数", () => {
  assert.throws(
    () => assertAllowedRequest({ method: "GET", endpointId: "deviceInfo", path: "/ISAPI/System/../System/deviceInfo", query: "" }),
    /路径/,
  );
  assert.throws(
    () => assertAllowedRequest({ method: "GET", endpointId: "deviceInfo", path: "/ISAPI/System/deviceInfo/", query: "" }),
    /路径不在白名单/,
  );
  assert.throws(
    () => assertAllowedRequest({ method: "GET", endpointId: "fdlibCount", path: "/ISAPI/Intelligent/FDLib/Count", query: "format=json&x=1" }),
    /查询串/,
  );
});

test("主机必须在允许列表内", () => {
  assert.equal(assertAllowedHost("192.168.1.64", HOSTS), "192.168.1.64");
  assert.throws(() => assertAllowedHost("10.0.0.1", HOSTS), /不在允许列表/);
  assert.throws(() => assertAllowedHost("", HOSTS), /缺少目标主机/);
});

test("端口必须在允许列表内", () => {
  assert.equal(assertAllowedPort(443, PORTS), 443);
  assert.throws(() => assertAllowedPort(22, PORTS), /端口不在允许列表/);
  assert.throws(() => assertAllowedPort("abc", PORTS), /端口不在允许列表/);
});

test("解析允许列表与端口列表", () => {
  assert.deepEqual(parseAllowedHosts(" 192.168.1.64, 10.1.1.2 ,"), ["192.168.1.64", "10.1.1.2"]);
  assert.deepEqual(parseAllowedPorts(undefined), [443, 8443]);
  assert.deepEqual(parseAllowedPorts("443, 9443"), [443, 9443]);
  assert.throws(() => parseAllowedPorts("abc"), /允许端口列表/);
});

test("findEndpoint / listEndpoints 返回副本", () => {
  assert.equal(findEndpoint("deviceInfo").path, "/ISAPI/System/deviceInfo");
  assert.equal(findEndpoint("nope"), null);
  const copy = listEndpoints();
  copy[0].path = "/hacked";
  assert.equal(READ_ENDPOINTS[0].path, "/ISAPI/System/deviceInfo");
});
