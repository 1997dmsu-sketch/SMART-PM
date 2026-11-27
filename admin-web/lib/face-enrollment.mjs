import { createHash, randomBytes, randomUUID } from "node:crypto";
import { HttpError } from "./model.mjs";
import { HikvisionClient } from "./hikvision-client.mjs";
import { loadAllDayPlan } from "./face-access-plan.mjs";

export const FACE_PHOTO_LIMIT = 200 * 1024;
const stepNames = [["person", "建人"], ["face", "上传人脸"], ["access", "授权门"], ["verify", "查询确认"]];
const invalid = (message, status = 400) => { throw new HttpError(status, message); };
const copy = (value) => structuredClone(value);
const opt = (value) => {
  const raw = value?.["@opt"] ?? value;
  return (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : []).map(String);
};
const xmlValue = (text, key) => new RegExp(`<(?:(?:[\\w-]+):)?${key}(?:\\s[^>]*)?>([^<]*)<`, "i").exec(text)?.[1]?.trim();
function jsonResponse(response) {
  if (response.status < 200 || response.status >= 300) invalid(`设备请求失败（HTTP ${response.status}）`, 502);
  let value;
  try { value = JSON.parse(response.body.toString("utf8")); } catch { invalid("设备未返回有效 JSON", 502); }
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("设备未返回有效 JSON 对象", 502);
  if (value.statusCode !== undefined && ![1, "1"].includes(value.statusCode)) {
    const code = /^[a-zA-Z0-9_-]{1,64}$/.test(value.subStatusCode || "") ? `：${value.subStatusCode}` : "";
    invalid(`设备拒绝操作${code}`, 502);
  }
  return value;
}
function normalizeLibraries(value) {
  const found = new Map();
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (!Array.isArray(node)) {
      const id = node.FDID ?? node.id;
      const type = node.faceLibType;
      if (["string", "number"].includes(typeof id) && typeof type === "string" && String(id) && type) {
        found.set(`${id}\0${type}`, { FDID: String(id), faceLibType: type });
      }
    }
    for (const child of Object.values(node)) visit(child);
  }
  visit(value);
  return [...found.values()];
}
const managementEmployeePattern = /^[A-Za-z0-9]{1,32}$/;
const managementTypes = ["blackFD", "infraredFD"];
function managementEmployeeNo(value) {
  if (typeof value !== "string" || !managementEmployeePattern.test(value)) invalid("人员编号需为1至32位字母或数字");
  return value;
}
function managementInput(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid("仅支持单个人员操作，参数无效");
  return value;
}
const managementText = (value, max = 128) => typeof value === "string" && value.length <= max && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
function managementLibraries(libraries) {
  if (!Array.isArray(libraries) || libraries.length > 16) invalid("设备人脸库信息无效", 502);
  const seen = new Set();
  return libraries.filter(library => managementTypes.includes(library?.faceLibType)).map(library => {
    if (typeof library.FDID !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(library.FDID)) invalid("设备人脸库编号无效", 502);
    const key = `${library.faceLibType}\0${library.FDID}`;
    if (seen.has(key)) invalid("设备返回重复的人脸库", 502);
    seen.add(key);
    return { FDID: library.FDID, faceLibType: library.faceLibType };
  });
}
function managementPerson(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) invalid("设备人员记录无效", 502);
  if (typeof row.employeeNo !== "string" || !managementEmployeePattern.test(row.employeeNo)) invalid("设备返回非法人员编号，未继续查询人脸", 502);
  const plans = Array.isArray(row.RightPlan) ? row.RightPlan.map(plan => ({
    doorNo: Number.isInteger(Number(plan?.doorNo)) && Number(plan.doorNo) >= 1 && Number(plan.doorNo) <= 65535 ? Number(plan.doorNo) : null,
    planTemplateNo: managementText(plan?.planTemplateNo, 128),
  })) : [];
  const validity = row.Valid && typeof row.Valid === "object" && !Array.isArray(row.Valid) ? row.Valid : {};
  return { employeeNo: row.employeeNo, name: managementText(row.name) ?? "", doorRight: managementText(row.doorRight, 256), RightPlan: plans,
    Valid: { enable: typeof validity.enable === "boolean" ? validity.enable : null, beginTime: managementText(validity.beginTime, 64), endTime: managementText(validity.endTime, 64) } };
}
function managementIdentity(row) {
  const safe = managementPerson(row);
  return createHash("sha256").update(JSON.stringify(safe)).digest("hex");
}
async function managementFaceGroups(provider, employeeNo, libraries) {
  const faces = {};
  for (const faceLibType of managementTypes) {
    const matches = libraries.filter(library => library.faceLibType === faceLibType);
    const results = [];
    for (const library of matches) {
      let status = "unknown", recordStatus = "unknown";
      // Management is an explicitly requested read: observe the exact endpoint instead
      // of treating an absent legacy enrollment capability flag as a failed query.
      try {
          if (typeof provider.readFaceForManagement === "function") {
            const found = await provider.readFaceForManagement({ ...library, employeeNo });
            if (["present", "absent", "unknown"].includes(found?.status)) status = found.status;
            if (["present", "absent", "unknown"].includes(found?.recordStatus)) recordStatus = found.recordStatus;
          } else {
            const found = await provider.findFaceForManagement({ ...library, employeeNo });
            status = found === true ? "present" : found === false ? "absent" : "unknown";
            // A legacy modeling boolean cannot prove that an unmodeled record is absent.
            recordStatus = found === true ? "present" : "unknown";
          }
      } catch { /* Unknown must never be represented as absent. */ }
      results.push({ FDID: library.FDID, status, recordStatus });
    }
    faces[faceLibType] = { status: !results.length ? "unsupported" : results.some(row => row.status === "present") ? "present" : results.every(row => row.status === "absent") ? "absent" : "unknown", libraries: results };
  }
  return faces;
}
function managementFacesKnown(faces) {
  return Object.values(faces).every(group => group.libraries.every(library => ["present", "absent"].includes(library.status) && ["present", "absent"].includes(library.recordStatus)));
}
async function managementListRows(provider, rows, libraries) {
  const people = [];
  for (const row of rows) {
    const person = managementPerson(row);
    const faces = await managementFaceGroups(provider, person.employeeNo, libraries);
    // This marker describes strict observed management results, not an enrollment capability.
    const managementSearchObserved = Boolean(libraries.length && managementFacesKnown(faces));
    people.push({ ...person, faces, managementSearchObserved, deleteAllowed: Boolean(person.name && managementSearchObserved) });
  }
  return { total: people.length, complete: true, people, managementSearchObserved: people.length > 0 && people.every(person => person.managementSearchObserved), queriedAt: new Date().toISOString() };
}
const safeManagementCode = error => /^[A-Z][A-Z0-9_]{1,79}$/.test(error?.code || "") ? error.code : "DEVICE_OPERATION_UNCONFIRMED";
function deletionResult(employeeNo, name, status, steps = [], extra = {}) { return { employeeNo, name, status, steps, ...extra }; }
const managementFailureStrings = ["invalid operation", "invalid xml content", "invalid xml format", "device error", "device busy", "invalid command", "reboot required", "unauthorized", "forbidden"];
function managementFailureNode(value) {
  return [value, value?.ResponseStatus, value?.UserInfoSearch].find(node => node && typeof node === "object" && !Array.isArray(node)
    && (Object.hasOwn(node, "statusCode") && ![1, "1"].includes(node.statusCode)
      || node.responseStatus === false
      || typeof node.statusString === "string" && managementFailureStrings.includes(node.statusString.toLowerCase())));
}
function safeDeviceResult(response, value) {
  const root = value?.ResponseStatus || value || {};
  const statusCode = Number.isSafeInteger(root.statusCode) || typeof root.statusCode === "string" && /^\d{1,8}$/.test(root.statusCode) ? root.statusCode : null;
  const knownStatusStrings = ["ok", "invalid operation", "invalid xml content", "invalid xml format", "device error", "device busy", "unknown", "no error", "not found", "invalid command", "reboot required", "unauthorized", "forbidden", "no match"];
  const statusString = typeof root.statusString === "string" && knownStatusStrings.includes(root.statusString.toLowerCase()) ? root.statusString : root.statusString === undefined ? null : "设备返回状态（已脱敏）";
  return { httpStatus: response.status, statusCode, statusString, ...(typeof root.subStatusCode === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(root.subStatusCode) ? { subStatusCode: root.subStatusCode } : {}) };
}
function normalizeLocalTime(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) invalid(`${label}格式错误`);
  const normalized = value.length === 16 ? value + ":00" : value;
  const [year, month, day, hour, minute, second] = normalized.split(/\D/).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) invalid(`${label}无效`);
  return normalized;
}
const canonicalUnlimitedTime = "1970-01-01T00:00:00";
function matchesValidity(actual, expected, allowObservedCanonicalization = false) {
  if (actual?.enable !== (expected.validityMode !== "unlimited") || (actual.timeType !== undefined && actual.timeType !== "local")) return false;
  if (actual.beginTime === expected.validFrom && actual.endTime === expected.validTo) return true;
  return allowObservedCanonicalization && expected.validityMode === "unlimited" && actual.enable === false
    && actual.beginTime === canonicalUnlimitedTime && actual.endTime === canonicalUnlimitedTime;
}
function allDayPlanProof(plan) {
  if (!plan || typeof plan.templateNo !== "string" || !/^[1-9]\d*$/.test(plan.templateNo)
    || typeof plan.fingerprint !== "string" || !/^[a-f0-9]{64}$/i.test(plan.fingerprint)
    || typeof plan.name !== "string" || !plan.name.trim()) invalid("设备未确认每天24小时权限计划，请重新连接", 409);
  return plan;
}
function matchesPlanProof(person, plan) {
  return person.accessPlanTemplateNo === plan.templateNo && person.accessPlanFingerprint === plan.fingerprint;
}
function matchesAccessPlan(actual, expected) {
  if (!Array.isArray(actual.RightPlan)) return false;
  const bindings = actual.RightPlan.filter(plan => plan && String(plan.doorNo) === String(expected.doorNo));
  if (bindings.length !== 1 || typeof bindings[0].planTemplateNo !== "string") return false;
  const templates = bindings[0].planTemplateNo.split(",").map(value => value.trim());
  return templates.length === 1 && templates[0] === expected.accessPlanTemplateNo;
}
const simulatedAllDayPlan = {
  templateNo: "1", fingerprint: createHash("sha256").update("smartpm-synthetic-all-day-plan-v1").digest("hex"),
  name: "每天24小时", weekPlanNo: 1, holidayGroupNos: [],
};
export function decodeFacePhoto(value, limit = FACE_PHOTO_LIMIT) {
  if (typeof value !== "string" || value.length > Math.ceil(limit / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) invalid("请选择有效的 JPEG 照片");
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > limit || bytes.toString("base64") !== value) invalid(`照片需为 JPEG，且不超过 ${Math.floor(limit / 1024)} KB`);
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) invalid("照片内容不是 JPEG");
  return bytes;
}
export function faceMultipart(person, photo) {
  const boundary = "smartpm-face-" + randomBytes(18).toString("hex");
  const metadata = { FDID: person.FDID, faceLibType: person.faceLibType, FPID: person.employeeNo };
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="faceURL"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="img"; filename="faceImage.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      photo,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

export class HikvisionFaceProvider {
  #planTemplateNo;
  #managementLibraries = [];
  #managementPageSize = 1;
  constructor(client, { planTemplateNo = "1" } = {}) { this.client = client; this.#planTemplateNo = planTemplateNo; }
  async json(method, path, data) {
    return jsonResponse(await this.client.request({ method, path, body: data === undefined ? undefined : Buffer.from(JSON.stringify(data)), contentType: data === undefined ? undefined : "application/json" }));
  }
  async describe() {
    const device = await this.client.request({ method: "GET", path: "/ISAPI/System/deviceInfo" });
    if (device.status !== 200) invalid(`读取设备信息失败（HTTP ${device.status}）`, 502);
    const text = device.body.toString("utf8");
    const user = (await this.json("GET", "/ISAPI/AccessControl/UserInfo/capabilities?format=json")).UserInfo;
    if (!user || typeof user !== "object") invalid("设备没有返回人员能力", 502);
    const faceResponse = await this.json("GET", "/ISAPI/Intelligent/FDLib/capabilities?format=json");
    const face = faceResponse.FDLibCap ?? faceResponse;
    const faceFunctions = opt(face.supportFDFunction ?? face.supportFunction);
    if (!faceFunctions.map((value) => value.toLowerCase()).includes("get") || !faceFunctions.map((value) => value.toLowerCase()).includes("setup")) invalid("设备未确认人脸查询或设置能力", 502);
    let libraries = normalizeLibraries(await this.json("GET", "/ISAPI/Intelligent/FDLib?format=json"));
    if (!libraries.length) libraries = normalizeLibraries(await this.json("GET", "/ISAPI/Intelligent/FDLib/Count?format=json"));
    if (!libraries.length) invalid("设备未返回可用的人脸库编号和类型", 502);
    let minDoor = Number(user.RightPlan?.doorNo?.["@min"]);
    let maxDoor = Number(user.RightPlan?.doorNo?.["@max"]);
    if (!Number.isInteger(minDoor) || !Number.isInteger(maxDoor)) {
      const response = await this.client.request({ method: "GET", path: "/ISAPI/AccessControl/RemoteControl/door/capabilities" });
      if (response.status !== 200) invalid("设备未返回可确认的门编号范围", 502);
      const node = /<(?:[\w-]+:)?doorNo\b([^>]*)>/i.exec(response.body.toString("utf8"))?.[1] || "";
      minDoor = Number(/\bmin=["'](\d+)["']/.exec(node)?.[1]);
      maxDoor = Number(/\bmax=["'](\d+)["']/.exec(node)?.[1]);
    }
    if (!Number.isInteger(minDoor) || !Number.isInteger(maxDoor) || minDoor < 1 || maxDoor < minDoor) invalid("设备门编号能力无效", 502);
    const functions = opt(user.supportFunction);
    if (functions.length && !["get", "post", "put"].every((method) => functions.includes(method))) invalid("设备人员能力缺少查询、新增或修改", 502);
    const allDayPlan = await loadAllDayPlan(path => this.json("GET", path), this.#planTemplateNo);
    this.#managementLibraries = managementLibraries(libraries);
    const pageMaximum = Number(user.UserInfoSearchCond?.maxResults?.["@max"]);
    this.#managementPageSize = Number.isSafeInteger(pageMaximum) && pageMaximum > 0 ? Math.min(30, pageMaximum) : 1;
    return {
      device: { model: xmlValue(text, "model") || "未返回型号", firmware: xmlValue(text, "firmwareVersion") || "" },
      capabilities: {
        allDayPlan,
        libraries, doorNumbers: Array.from({ length: Math.min(maxDoor - minDoor + 1, 64) }, (_, index) => minDoor + index),
        maxPhotoBytes: FACE_PHOTO_LIMIT, photoLimitSource: "guide-default",
        employeeNoMaxLength: Math.min(Number(user.employeeNo?.["@max"]) || 32, 64),
        employeeNoPattern: "^[A-Za-z0-9]+$",
        nameMaxBytes: Math.min(Number(user.name?.["@max"]) || 128, 256),
        timeRangeBegin: user.Valid?.timeRangeBegin || "1970-01-01T00:00:00", timeRangeEnd: user.Valid?.timeRangeEnd || "2037-12-31T23:59:59",
        longTermValiditySupported: opt(user.Valid?.enable).includes("false"),
        userTypes: opt(user.userType), timeTypes: opt(user.Valid?.timeType),
        faceFunctions,
        faceSearchSupported: (face.isSuportFDSearch ?? face.isSupportFDSearch) === true,
        personFaceCountSupported: user.UserInfoSearchCond?.isSupportNumOfFace === true,
      },
    };
  }
  async findPerson(employeeNo) {
    const value = await this.json("POST", "/ISAPI/AccessControl/UserInfo/Search?format=json", { UserInfoSearchCond: { searchID: randomUUID(), searchResultPosition: 0, maxResults: 1, EmployeeNoList: [{ employeeNo }] } });
    const rows = value.UserInfoSearch?.UserInfo || [];
    return rows.find((row) => row.employeeNo === employeeNo) || null;
  }
  async createPerson(person) {
    await this.json("POST", "/ISAPI/AccessControl/UserInfo/Record?format=json", { UserInfo: {
      employeeNo: person.employeeNo, name: person.name, userType: "normal", onlyVerify: false,
      Valid: { enable: person.validityMode !== "unlimited", beginTime: person.validFrom, endTime: person.validTo, timeType: "local" }, doorRight: "",
    } });
  }
  async putFace(person, photo) {
    const multipart = faceMultipart(person, photo);
    try { jsonResponse(await this.client.request({ method: "PUT", path: "/ISAPI/Intelligent/FDLib/FDSetUp?format=json", ...multipart })); }
    finally { multipart.body.fill(0); }
  }
  async grantAccess(person) {
    allDayPlanProof({ templateNo: person.accessPlanTemplateNo, fingerprint: person.accessPlanFingerprint, name: "每天24小时" });
    const plan = await loadAllDayPlan(path => this.json("GET", path), person.accessPlanTemplateNo);
    if (!matchesPlanProof(person, plan)) invalid("每天24小时权限计划已变更，请断开后重新连接确认", 409);
    await this.json("PUT", "/ISAPI/AccessControl/UserInfo/Modify?format=json", { UserInfo: {
      employeeNo: person.employeeNo, doorRight: String(person.doorNo),
      RightPlan: [{ doorNo: Number(person.doorNo), planTemplateNo: person.accessPlanTemplateNo }],
    } });
  }
  async findFace(person) {
    const value = await this.json("POST", "/ISAPI/Intelligent/FDLib/FDSearch?format=json", { searchResultPosition: 0, maxResults: 1, faceLibType: person.faceLibType, FDID: person.FDID, FPID: person.employeeNo });
    const match = (value.MatchList || []).find((row) => row.FPID === person.employeeNo);
    return !match ? false : match.isInLibrary === "yes" ? true : match.isInLibrary === "no" ? false : null;
  }
  async #managementJson(method, path, data) {
    const response = await this.client.request({ method, path, body: data === undefined ? undefined : Buffer.from(JSON.stringify(data)), contentType: data === undefined ? undefined : "application/json" });
    try {
      if (response.status < 200 || response.status >= 300) invalid(`设备查询失败（HTTP ${response.status}）`, 502);
      let value;
      try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body)); } catch { invalid("设备未返回有效 UTF-8 JSON", 502); }
      if (!value || typeof value !== "object" || Array.isArray(value)) invalid("设备查询响应无效", 502);
      if (managementFailureNode(value)) invalid("设备拒绝查询", 502);
      return value;
    } finally { response.body.fill(0); }
  }
  async findManagementPerson(employeeNo) {
    managementEmployeeNo(employeeNo);
    const value = await this.#managementJson("POST", "/ISAPI/AccessControl/UserInfo/Search?format=json", { UserInfoSearchCond: { searchID: randomUUID(), searchResultPosition: 0, maxResults: 1, EmployeeNoList: [{ employeeNo }] } });
    const search = value.UserInfoSearch;
    const rows = Array.isArray(search?.UserInfo) ? search.UserInfo : search?.numOfMatches === 0 && search.UserInfo == null ? [] : null;
    if (!rows || !Number.isSafeInteger(search?.numOfMatches) || search.numOfMatches !== rows.length || rows.length > 1 || !Number.isSafeInteger(search.totalMatches) || search.totalMatches !== rows.length) invalid("设备人员精确查询未确认", 502);
    if (search.responseStatusStrg !== undefined && !["OK", "NO MATCH"].includes(search.responseStatusStrg) || search.responseStatusStrg === "NO MATCH" && rows.length) invalid("设备人员精确查询状态矛盾", 502);
    if (rows.some(row => row?.employeeNo !== employeeNo)) invalid("设备返回了其他人员，已停止操作", 502);
    if (rows.length) managementPerson(rows[0]);
    return rows[0] || null;
  }
  async readFaceForManagement(person) {
    managementEmployeeNo(person?.employeeNo);
    const [library] = managementLibraries([person]);
    if (!library) invalid("人脸库类型无效");
    const value = await this.#managementJson("POST", "/ISAPI/Intelligent/FDLib/FDSearch?format=json", { searchResultPosition: 0, maxResults: 1, faceLibType: library.faceLibType, FDID: library.FDID, FPID: person.employeeNo });
    const unknown = { status: "unknown", recordStatus: "unknown" };
    if (value.responseStatus !== undefined && typeof value.responseStatus !== "boolean" || value.progress !== undefined && value.progress !== 100 || value.responseStatusStrg !== undefined && !["OK", "NO MATCH"].includes(value.responseStatusStrg)) return unknown;
    if (!Number.isSafeInteger(value.numOfMatches) || value.numOfMatches < 0 || !Number.isSafeInteger(value.totalMatches) || value.totalMatches < 0) return unknown;
    const rows = value.MatchList;
    if (value.numOfMatches === 0 && value.totalMatches === 0 && (rows == null || Array.isArray(rows) && rows.length === 0)) return { status: "absent", recordStatus: "absent" };
    if (!Array.isArray(rows) || rows.length !== 1 || value.numOfMatches !== 1 || value.totalMatches !== 1 || rows[0]?.FPID !== person.employeeNo || value.responseStatusStrg === "NO MATCH") return unknown;
    return { status: rows[0].isInLibrary === "yes" ? "present" : rows[0].isInLibrary === "no" ? "absent" : "unknown", recordStatus: "present" };
  }
  async findFaceForManagement(person) {
    const face = await this.readFaceForManagement(person);
    return face.status === "present" ? true : face.status === "absent" ? false : null;
  }
  async list({ libraries = this.#managementLibraries } = {}) {
    const selected = managementLibraries(libraries);
    const rows = [], seen = new Set();
    const searchID = randomUUID();
    let total;
    for (let page = 0; page < 1000; page++) {
      const value = await this.#managementJson("POST", "/ISAPI/AccessControl/UserInfo/Search?format=json", { UserInfoSearchCond: { searchID, searchResultPosition: rows.length, maxResults: this.#managementPageSize } });
      const search = value.UserInfoSearch;
      const matches = Array.isArray(search?.UserInfo) ? search.UserInfo : search?.numOfMatches === 0 && search.UserInfo == null ? [] : null;
      if (!matches || !Number.isSafeInteger(search?.totalMatches) || search.totalMatches < 0 || search.totalMatches > 1000 || !Number.isSafeInteger(search.numOfMatches) || search.numOfMatches !== matches.length || matches.length > this.#managementPageSize) invalid("设备人员分页计数无效，名单未完整确认", 502);
      if (total === undefined) total = search.totalMatches;
      if (total !== search.totalMatches) invalid("查询期间人员总数已变化，请重新刷新", 409);
      for (const row of matches) {
        const person = managementPerson(row);
        if (seen.has(person.employeeNo)) invalid("设备分页返回重复人员，名单未完整确认", 502);
        seen.add(person.employeeNo); rows.push(row);
      }
      if (rows.length > total || search.responseStatusStrg === "MORE" && rows.length >= total || search.responseStatusStrg === "NO MATCH" && (matches.length || total)) invalid("设备分页状态与计数不一致", 502);
      if (search.responseStatusStrg !== undefined && !["OK", "MORE", "NO MATCH"].includes(search.responseStatusStrg)) invalid("设备分页状态无效", 502);
      if (rows.length === total) return managementListRows(this, rows, selected);
      if (!matches.length) invalid("设备分页提前结束，名单未完整确认", 502);
    }
    invalid("人员分页超过本次上限，名单未完整确认", 502);
  }
  async #deleteWire(path, data) {
    let response;
    try { response = await this.client.request({ method: "PUT", path, body: Buffer.from(JSON.stringify(data)), contentType: "application/json" }); }
    catch (error) { return { ok: false, unknown: true, details: { errorCode: safeManagementCode(error) } }; }
    try {
      let value;
      try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body)); } catch { value = null; }
      const rejected = managementFailureNode(value);
      const details = safeDeviceResult(response, rejected ? { ...rejected, ResponseStatus: undefined } : value);
      const nodes = [value, value?.ResponseStatus].filter(node => node && typeof node === "object" && !Array.isArray(node));
      const acknowledged = !rejected && response.status >= 200 && response.status < 300 && [1, "1"].includes(details.statusCode)
        && nodes.every(node => node.statusString === undefined || typeof node.statusString === "string" && ["ok", "no error"].includes(node.statusString.toLowerCase()))
        && nodes.every(node => node.responseStatus === undefined || node.responseStatus === true);
      if (rejected) details.errorCode = "DEVICE_DELETE_REJECTED";
      else if (!acknowledged) details.errorCode = "DELETE_ACK_UNCONFIRMED";
      return { ok: acknowledged, unknown: !acknowledged && !rejected && ![400, 401, 403, 404, 405].includes(response.status), details };
    } finally { response.body.fill(0); }
  }
  async #deleteProgress() {
    const value = await this.#managementJson("GET", "/ISAPI/AccessControl/UserInfoDetail/DeleteProcess?format=json");
    const status = value.UserInfoDetailDeleteProcess?.status;
    if (!["processing", "success", "failed"].includes(status)) invalid("设备未返回可确认的删除进度", 502);
    return status;
  }
  async deletePerson({ employeeNo, expectedIdentity, libraries = this.#managementLibraries }) {
    managementEmployeeNo(employeeNo);
    const selected = managementLibraries(libraries);
    if (!selected.length || selected.length !== libraries.length) invalid("设备人脸库未完整确认，停止删除", 409);
    const initial = await this.findManagementPerson(employeeNo);
    if (!initial) return deletionResult(employeeNo, "", "not-found");
    const identity = managementIdentity(initial);
    if (expectedIdentity !== undefined && expectedIdentity !== identity) invalid("人员信息已变化，请重新查询并确认", 409);
    const operation = { employeeNo, name: managementPerson(initial).name, expectedIdentity: identity, libraries: selected, phase: "face", steps: [], writeAttempted: false };
    try {
    try { if (await this.#deleteProgress() === "processing") return deletionResult(employeeNo, operation.name, "failed", [{ kind: "progress", status: "failed", errorCode: "DEVICE_DELETE_BUSY" }]); }
    catch { return deletionResult(employeeNo, operation.name, "failed", [{ kind: "progress", status: "failed", errorCode: "DELETE_PROGRESS_UNCONFIRMED" }]); }
    const faces = await managementFaceGroups(this, employeeNo, selected);
    if (!managementFacesKnown(faces)) return deletionResult(employeeNo, operation.name, "failed", [{ kind: "face", status: "failed", errorCode: "FACE_STATE_UNKNOWN" }]);
    for (const library of selected) {
      const current = faces[library.faceLibType].libraries.find(row => row.FDID === library.FDID);
      const step = { kind: "face", ...library, status: "already-absent" };
      operation.steps.push(step);
      if (current.recordStatus === "absent") continue;
      // Official Mingmou protocol: the fixed, single-element FPID filter cannot select a whole library.
      operation.writeAttempted = true;
      const response = await this.#deleteWire(`/ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=${encodeURIComponent(library.FDID)}&faceLibType=${encodeURIComponent(library.faceLibType)}`, { FPID: [{ value: employeeNo }] });
      Object.assign(step, response.details, { status: response.ok || response.unknown ? "pending" : "failed" });
      if (!response.ok) return deletionResult(employeeNo, operation.name, response.unknown ? "pending" : "failed", operation.steps, response.unknown ? { operation } : {});
      let absent = false;
      try { absent = (await this.readFaceForManagement({ ...library, employeeNo })).recordStatus === "absent"; } catch { /* keep pending */ }
      if (!absent) return deletionResult(employeeNo, operation.name, "pending", operation.steps, { operation });
      step.status = "success";
    }
    const latest = await this.findManagementPerson(employeeNo);
    if (!latest) { operation.steps.push({ kind: "person", status: "already-absent" }); return await this.followDelete(operation); }
    if (managementIdentity(latest) !== identity) return deletionResult(employeeNo, operation.name, "failed", [...operation.steps, { kind: "person", status: "failed", errorCode: "PERSON_CHANGED_BEFORE_DELETE" }]);
    try { if (await this.#deleteProgress() === "processing") return deletionResult(employeeNo, operation.name, "failed", [...operation.steps, { kind: "person", status: "failed", errorCode: "DEVICE_DELETE_BUSY" }]); }
    catch { return deletionResult(employeeNo, operation.name, "failed", [...operation.steps, { kind: "person", status: "failed", errorCode: "DELETE_PROGRESS_UNCONFIRMED" }]); }
    operation.phase = "person";
    operation.writeAttempted = true;
    const response = await this.#deleteWire("/ISAPI/AccessControl/UserInfoDetail/Delete?format=json", { UserInfoDetail: { mode: "byEmployeeNo", EmployeeNoList: [{ employeeNo }] } });
    operation.steps.push({ kind: "person", ...response.details, status: response.ok || response.unknown ? "pending" : "failed" });
    if (!response.ok) return deletionResult(employeeNo, operation.name, response.unknown ? "pending" : "failed", operation.steps, response.unknown ? { operation } : {});
    return await this.followDelete(operation);
    } catch (error) {
      operation.steps.push({ kind: "progress", status: "failed", errorCode: safeManagementCode(error) });
      return deletionResult(employeeNo, operation.name, operation.writeAttempted ? "pending" : "failed", operation.steps, operation.writeAttempted ? { operation } : {});
    }
  }
  async followDelete(operation) {
    managementEmployeeNo(operation?.employeeNo);
    const libraries = managementLibraries(operation.libraries);
    let progress;
    if (operation.phase === "person") {
      try { progress = await this.#deleteProgress(); } catch { /* A lost progress response cannot become success. */ }
    }
    if (progress === "failed") {
      operation.steps.push({ kind: "progress", status: "failed", errorCode: "DEVICE_DELETE_FAILED" });
      return deletionResult(operation.employeeNo, operation.name, "failed", operation.steps);
    }
    const person = await this.findManagementPerson(operation.employeeNo);
    const faces = await managementFaceGroups(this, operation.employeeNo, libraries);
    const states = Object.values(faces).flatMap(group => group.libraries);
    const allAbsent = states.length && states.every(row => row.recordStatus === "absent");
    const result = status => deletionResult(operation.employeeNo, operation.name, status, operation.steps, status === "pending" ? { operation } : {});
    for (const step of operation.steps) if (step.kind === "face" && step.status === "pending" && faces[step.faceLibType]?.libraries.some(row => row.FDID === step.FDID && row.recordStatus === "absent")) step.status = "success";
    if (!person && allAbsent && (operation.phase !== "person" || progress === "success")) {
      for (const step of operation.steps) if (step.status === "pending") step.status = "success";
      return result("success");
    }
    if (person && managementIdentity(person) !== operation.expectedIdentity) { operation.steps.push({ kind: "person", status: "failed", errorCode: "PERSON_CHANGED_DURING_DELETE" }); return result("failed"); }
    if (states.some(row => row.recordStatus === "unknown")) return result("pending");
    if (operation.phase === "face") {
      if (person && allAbsent) { operation.steps.push({ kind: "person", status: "failed", errorCode: "PERSON_DELETE_REQUIRES_NEW_CONFIRMATION" }); return result("failed"); }
      return result("pending");
    }
    if (progress === "success" && (person || !allAbsent)) {
      operation.steps.push({ kind: "progress", status: "failed", errorCode: "DELETE_READBACK_MISMATCH" });
      return result("failed");
    }
    return result("pending");
  }
  close() { this.client.close(); }
}

export class SimulatedFaceProvider {
  constructor() { this.people = new Map(); this.faces = new Set(); }
  async describe() { return { device: { model: "模拟门禁设备", firmware: "simulation" }, capabilities: { allDayPlan: copy(simulatedAllDayPlan), libraries: [{ FDID: "SIMULATION_FD_01", faceLibType: "blackFD" }], doorNumbers: [1], maxPhotoBytes: FACE_PHOTO_LIMIT, photoLimitSource: "guide-default", employeeNoMaxLength: 32, employeeNoPattern: "^[A-Za-z0-9_-]+$", nameMaxBytes: 128, faceSearchSupported: true, personFaceCountSupported: true, longTermValiditySupported: true, timeRangeBegin: "1970-01-01T00:00:00", timeRangeEnd: "2037-12-31T23:59:59" } }; }
  async findPerson(id) { return copy(this.people.get(id) || null); }
  async createPerson(person) { if (this.people.has(person.employeeNo)) invalid("人员编号已存在", 409); this.people.set(person.employeeNo, { employeeNo: person.employeeNo, name: person.name, Valid: { enable: person.validityMode !== "unlimited", beginTime: person.validFrom, endTime: person.validTo, timeType: "local" }, doorRight: "", numOfFace: 0 }); }
  async putFace(person) { this.faces.add(person.employeeNo); this.people.get(person.employeeNo).numOfFace = 1; }
  async grantAccess(person) {
    if (!matchesPlanProof(person, simulatedAllDayPlan)) invalid("模拟每天24小时权限计划与连接记录不一致", 409);
    Object.assign(this.people.get(person.employeeNo), { doorRight: String(person.doorNo), RightPlan: [{ doorNo: Number(person.doorNo), planTemplateNo: person.accessPlanTemplateNo }] });
  }
  async findFace(person) { return this.faces.has(person.employeeNo); }
  async findManagementPerson(employeeNo) { managementEmployeeNo(employeeNo); return copy(this.people.get(employeeNo) || null); }
  async findFaceForManagement(person) { managementEmployeeNo(person?.employeeNo); return person.faceLibType === "blackFD" && this.faces.has(person.employeeNo); }
  async readFaceForManagement(person) {
    const found = await this.findFaceForManagement(person);
    return { status: found === true ? "present" : found === false ? "absent" : "unknown", recordStatus: found === true ? "present" : found === false ? "absent" : "unknown" };
  }
  async list({ libraries = [{ FDID: "SIMULATION_FD_01", faceLibType: "blackFD" }] } = {}) {
    return managementListRows(this, [...this.people.values()].map(copy), managementLibraries(libraries));
  }
  async deletePerson({ employeeNo, expectedIdentity, libraries = [{ FDID: "SIMULATION_FD_01", faceLibType: "blackFD" }] }) {
    managementEmployeeNo(employeeNo);
    const selected = managementLibraries(libraries);
    const person = this.people.get(employeeNo);
    if (!person) return deletionResult(employeeNo, "", "not-found");
    if (expectedIdentity !== undefined && managementIdentity(person) !== expectedIdentity) invalid("人员信息已变化，请重新查询并确认", 409);
    const steps = selected.map(library => ({ kind: "face", ...library, status: library.faceLibType === "blackFD" && this.faces.has(employeeNo) ? "success" : "already-absent", statusCode: 1, statusString: "OK" }));
    this.faces.delete(employeeNo);
    this.people.delete(employeeNo);
    steps.push({ kind: "person", status: "success", statusCode: 1, statusString: "OK" });
    return deletionResult(employeeNo, managementPerson(person).name, "success", steps);
  }
  async followDelete(operation) {
    managementEmployeeNo(operation?.employeeNo);
    const absent = !this.people.has(operation.employeeNo) && !this.faces.has(operation.employeeNo);
    return deletionResult(operation.employeeNo, operation.name, absent ? "success" : "pending", operation.steps || [], absent ? {} : { operation });
  }
  close() { this.people.clear(); this.faces.clear(); }
}

export class FaceEnrollmentService {
  #provider;
  #rows = new Map();
  #photos = new Map();
  #busy = false;
  #closed = false;
  #providerFactory;
  #confirmations = new Map();
  #deleteOperations = new Map();
  #pendingDelete;
  #now;
  #confirmationTtlMs;
  #deleteFollowTtlMs;
  #canonicalUnlimitedRows = new WeakSet();
  #observedUnlimitedCanonicalization = false;
  #state = { mode: "simulation", connected: false, device: {}, capabilities: { libraries: [], doorNumbers: [], maxPhotoBytes: FACE_PHOTO_LIMIT } };
  constructor({ providerFactory = (config) => new HikvisionFaceProvider(new HikvisionClient(config), { planTemplateNo: config.planTemplateNo }), now = Date.now, confirmationTtlMs = 120000, deleteFollowTtlMs = 600000 } = {}) {
    this.#providerFactory = providerFactory; this.#now = now; this.#confirmationTtlMs = confirmationTtlMs; this.#deleteFollowTtlMs = deleteFollowTtlMs;
  }
  state() { const pending = this.#pendingDelete && this.#deleteOperations.get(this.#pendingDelete); return copy({ ...this.#state, busy: this.#busy, enrollments: [...this.#rows.values()], ...(pending ? { pendingDelete: { operationId: pending.id, employeeNo: pending.employeeNo, name: pending.name, expiresAt: new Date(pending.expires).toISOString() } } : {}) }); }
  async #exclusive(action, { allowPendingDelete = false } = {}) {
    if (this.#closed) invalid("设备会话已关闭，请重新登录", 409);
    if (this.#busy) invalid("已有设备操作进行中，请等待完成", 409);
    if (this.#pendingDelete && !allowPendingDelete) invalid("已有删除操作等待确认结果，请先查询删除结果", 409);
    this.#busy = true;
    try { return await action(); } finally { this.#busy = false; }
  }
  #clear() { for (const photo of this.#photos.values()) { clearTimeout(photo.timer); photo.bytes.fill(0); } this.#photos.clear(); this.#rows.clear(); this.#confirmations.clear(); this.#deleteOperations.clear(); this.#pendingDelete = undefined; this.#canonicalUnlimitedRows = new WeakSet(); this.#observedUnlimitedCanonicalization = false; }
  async connect(data) {
    await this.#exclusive(async () => {
      if (!data || !["simulation", "device"].includes(data.mode)) invalid("连接模式无效");
      let provider, description;
      try {
        provider = data.mode === "simulation" ? new SimulatedFaceProvider() : this.#providerFactory(data);
        description = await provider.describe();
        if (this.#closed) invalid("设备会话已关闭", 409);
      } catch (error) {
        provider?.close();
        const messages = {
          HIKVISION_CONFIGURATION: "设备连接参数或证书文件无效",
          HIKVISION_TLS_PIN: "所选证书与设备返回的公钥不一致",
          HIKVISION_AUTH_CHALLENGE: "设备认证方式不受当前适配器支持",
          HIKVISION_TIMEOUT: "设备连接超时，请检查网络与设备状态",
          HIKVISION_TRANSPORT: "无法连接设备，请核对地址、证书校验模式和网络",
          HIKVISION_REDIRECT: "设备返回重定向，未继续发送请求",
        };
        if (messages[error.code]) invalid(messages[error.code], error.code === "HIKVISION_CONFIGURATION" ? 400 : 502);
        throw error;
      }
      this.#provider?.close(); this.#clear(); this.#provider = provider;
      this.#state = { mode: data.mode, connected: true, device: { model: managementText(description.device?.model) || "未返回型号", firmware: managementText(description.device?.firmware) || "" }, capabilities: copy(description.capabilities) };
      this.#observedUnlimitedCanonicalization = data.mode === "device" && this.#state.device.model === "DS-K1T671BM" && this.#state.device.firmware === "V3.3.180";
    });
    return this.state();
  }
  async disconnect() {
    await this.#exclusive(async () => { this.#provider?.close(); this.#provider = undefined; this.#clear(); this.#state = { mode: "simulation", connected: false, device: {}, capabilities: { libraries: [], doorNumbers: [], maxPhotoBytes: FACE_PHOTO_LIMIT } }; }, { allowPendingDelete: true });
    return this.state();
  }
  #requireManagement() {
    if (!this.#provider || !this.#state.connected) invalid("请先连接模拟设备或现场设备", 409);
    if (typeof this.#provider.list !== "function") invalid("当前连接未支持登记管理", 409);
  }
  async #managementList() {
    this.#requireManagement(); this.#confirmations.clear();
    return this.#provider.list({ libraries: this.#state.capabilities.libraries });
  }
  async list(data = {}) {
    managementInput(data, []);
    return this.#exclusive(() => this.#managementList(), { allowPendingDelete: true });
  }
  async #managementFind(employeeNo) {
    const row = typeof this.#provider.findManagementPerson === "function" ? await this.#provider.findManagementPerson(employeeNo) : await this.#provider.findPerson(employeeNo);
    if (row && row.employeeNo !== employeeNo) invalid("设备返回了其他人员，已停止操作", 502);
    if (row) managementPerson(row);
    return row;
  }
  async #managementResult(result, operationId) {
    const safe = { employeeNo: result.employeeNo, name: result.name || "", status: result.status, steps: copy(result.steps || []),
      summary: { total: 1, success: Number(result.status === "success"), failed: Number(result.status === "failed"), notFound: Number(result.status === "not-found"), pending: Number(result.status === "pending") }, ...(operationId ? { operationId } : {}) };
    try { safe.list = await this.#managementList(); } catch { safe.refreshError = "设备名单刷新未完成，请手动刷新确认剩余人员"; }
    return safe;
  }
  async prepareDelete(data) {
    managementInput(data, ["employeeNo"]); const employeeNo = managementEmployeeNo(data.employeeNo);
    return this.#exclusive(async () => {
      this.#requireManagement(); this.#confirmations.clear();
      if (typeof this.#provider.deletePerson !== "function" || typeof this.#provider.followDelete !== "function") invalid("当前连接未支持受控删除", 409);
      const libraries = managementLibraries(this.#state.capabilities.libraries);
      if (!libraries.length || libraries.length !== this.#state.capabilities.libraries.length) invalid("设备人脸库未完整确认，停止删除", 409);
      const row = await this.#managementFind(employeeNo);
      if (!row) return this.#managementResult(deletionResult(employeeNo, "", "not-found"));
      const person = managementPerson(row);
      if (!person.name) invalid("设备未返回姓名，请先确认人员记录", 409);
      const faces = await managementFaceGroups(this.#provider, employeeNo, libraries);
      if (!managementFacesKnown(faces)) invalid("人脸状态尚未确认，请重新查询后再删除", 409);
      const token = randomBytes(32).toString("base64url"), expires = this.#now() + this.#confirmationTtlMs;
      this.#confirmations.set(token, { employeeNo, name: person.name, expectedIdentity: managementIdentity(row), libraries, expires, provider: this.#provider });
      return { employeeNo, name: person.name, confirmationToken: token, expiresAt: new Date(expires).toISOString() };
    });
  }
  async delete(data) {
    managementInput(data, ["employeeNo", "confirmationToken", "confirmationText"]); const employeeNo = managementEmployeeNo(data.employeeNo);
    return this.#exclusive(async () => {
      this.#requireManagement();
      const token = typeof data.confirmationToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(data.confirmationToken) ? data.confirmationToken : "";
      const confirmation = this.#confirmations.get(token); this.#confirmations.delete(token);
      if (!confirmation || confirmation.employeeNo !== employeeNo || confirmation.provider !== this.#provider || confirmation.expires <= this.#now() || data.confirmationText !== `DELETE ${employeeNo}`) invalid("删除二次确认无效或已过期，请重新查询并确认", 409);
      const current = await this.#managementFind(employeeNo);
      if (!current) return this.#managementResult(deletionResult(employeeNo, confirmation.name, "not-found"));
      if (managementIdentity(current) !== confirmation.expectedIdentity) invalid("人员信息已变化，请重新查询并确认", 409);
      let result;
      try { result = await this.#provider.deletePerson({ employeeNo, expectedIdentity: confirmation.expectedIdentity, libraries: confirmation.libraries }); }
      catch (error) { result = deletionResult(employeeNo, confirmation.name, "failed", [{ kind: "person", status: "failed", errorCode: safeManagementCode(error) }]); }
      let operationId;
      if (result.status === "pending" && result.operation) {
        operationId = randomUUID(); this.#pendingDelete = operationId;
        this.#deleteOperations.set(operationId, { id: operationId, employeeNo, name: confirmation.name, operation: result.operation, expires: this.#now() + this.#deleteFollowTtlMs });
      }
      return this.#managementResult(result, operationId);
    });
  }
  async followDelete(data) {
    managementInput(data, ["id"]);
    if (typeof data.id !== "string" || !/^[0-9a-f-]{36}$/.test(data.id)) invalid("删除跟进编号无效");
    return this.#exclusive(async () => {
      this.#requireManagement();
      const saved = this.#deleteOperations.get(data.id);
      if (!saved || saved.expires <= this.#now()) invalid("删除跟进已失效，请重新连接并查询名单，勿重复发送删除", 409);
      if (saved.result) return copy(saved.result);
      let result;
      try { result = await this.#provider.followDelete(saved.operation); }
      catch { result = deletionResult(saved.employeeNo, saved.name, "pending", saved.operation.steps || [], { operation: saved.operation }); }
      if (result.status !== "pending") this.#pendingDelete = undefined;
      const answer = await this.#managementResult(result, saved.id);
      if (result.status !== "pending") saved.result = copy(answer);
      return answer;
    }, { allowPendingDelete: true });
  }
  #validate(data) {
    if (!this.#provider || !this.#state.connected) invalid("请先连接模拟设备或现场设备", 409);
    const caps = this.#state.capabilities;
    if (!data || typeof data.employeeNo !== "string" || !(new RegExp(caps.employeeNoPattern || "^[A-Za-z0-9]+$")).test(data.employeeNo) || data.employeeNo.length > caps.employeeNoMaxLength) invalid(`人员编号需为最多 ${caps.employeeNoMaxLength} 位设备支持字符（现场默认仅字母数字）`);
    if (typeof data.name !== "string" || !data.name.trim() || Buffer.byteLength(data.name.trim()) > caps.nameMaxBytes) invalid("姓名为空或超过设备限制");
    if (data.consent !== true) invalid("请确认测试人员及照片已获授权");
    if (!caps.doorNumbers.includes(Number(data.doorNo))) invalid("请选择设备返回的有效门编号");
    const library = caps.libraries.find((entry) => entry.FDID === data.FDID && entry.faceLibType === data.faceLibType);
    if (!library) invalid("请选择设备返回的人脸库");
    const accessPlan = allDayPlanProof(caps.allDayPlan);
    const validityMode = data.validityMode === undefined ? "fixed" : data.validityMode;
    if (!["fixed", "unlimited"].includes(validityMode)) invalid("有效期模式无效");
    if (validityMode === "unlimited" && caps.longTermValiditySupported !== true) invalid("设备未确认支持长期有效");
    const rangeBegin = typeof caps.timeRangeBegin === "string" ? normalizeLocalTime(caps.timeRangeBegin, "设备有效期范围开始时间") : undefined;
    const rangeEnd = typeof caps.timeRangeEnd === "string" ? normalizeLocalTime(caps.timeRangeEnd, "设备有效期范围结束时间") : undefined;
    const validFrom = normalizeLocalTime(validityMode === "unlimited" ? rangeBegin : data.validFrom, "开始时间");
    const validTo = normalizeLocalTime(validityMode === "unlimited" ? rangeEnd : data.validTo, "结束时间");
    if (validFrom >= validTo) invalid("结束时间必须晚于开始时间");
    if ((rangeBegin !== undefined && validFrom < rangeBegin) || (rangeEnd !== undefined && validTo > rangeEnd)) invalid("有效期超出设备能力范围");
    if (caps.userTypes?.length && !caps.userTypes.includes("normal")) invalid("设备不支持普通测试人员");
    if (caps.timeTypes?.length && !caps.timeTypes.includes("local")) invalid("设备不支持本地时间有效期");
    return { employeeNo: data.employeeNo, name: data.name.trim(), doorNo: Number(data.doorNo), ...library, validityMode, validFrom, validTo,
      accessPlanTemplateNo: accessPlan.templateNo, accessPlanFingerprint: accessPlan.fingerprint, accessPlanName: accessPlan.name };
  }
  #savePhoto(id, bytes) {
    const old = this.#photos.get(id); clearTimeout(old?.timer); old?.bytes.fill(0);
    const timer = setTimeout(() => { if (this.#photos.get(id)?.bytes === bytes) { bytes.fill(0); this.#photos.delete(id); } }, 10 * 60 * 1000);
    timer.unref();
    this.#photos.set(id, { bytes, timer, expires: Date.now() + 10 * 60 * 1000 });
  }
  #getPhoto(id) { const photo = this.#photos.get(id); if (!photo || photo.expires < Date.now()) { clearTimeout(photo?.timer); photo?.bytes.fill(0); this.#photos.delete(id); invalid("照片已释放，请重新选择照片后继续同步", 409); } return photo.bytes; }
  #step(row, key, state, message = "") { Object.assign(row.steps.find((step) => step.key === key), { state, message }); row.updatedAt = Date.now(); }
  async enroll(data) {
    return this.#exclusive(async () => {
      const person = this.#validate(data);
      if (this.#rows.size >= 50) invalid("本次会话记录已满，请断开设备后重新连接", 409);
      if ([...this.#rows.values()].some((row) => row.employeeNo === person.employeeNo)) invalid("本次会话已有该人员，请使用继续同步或查询状态", 409);
      const photo = decodeFacePhoto(data.photoBase64, this.#state.capabilities.maxPhotoBytes);
      const row = { id: randomUUID(), ...person, mode: this.#state.mode, status: "pending", steps: stepNames.map(([key, label]) => ({ key, label, state: "pending", message: "" })), createdAt: Date.now() };
      if (this.#observedUnlimitedCanonicalization && row.validityMode === "unlimited") this.#canonicalUnlimitedRows.add(row);
      this.#rows.set(row.id, row); this.#savePhoto(row.id, photo);
      return this.#run(row);
    });
  }
  async #run(row) {
    row.status = "running"; delete row.error;
    let stage = "person";
    try {
      if (this.#closed) invalid("设备会话已关闭", 409);
      if (row.steps[0].state !== "success") {
        this.#step(row, stage, "running");
        const existing = await this.#provider.findPerson(row.employeeNo);
        if (existing && !row.createAttempted) invalid("设备已有此人员编号，未覆盖原人员，请使用新的测试编号", 409);
        if (existing && (existing.name !== row.name || !matchesValidity(existing.Valid, row, this.#canonicalUnlimitedRows.has(row)))) invalid("设备人员与本次测试不一致，已停止继续同步", 409);
        if (!existing) { row.createAttempted = true; await this.#provider.createPerson(row); }
        this.#step(row, stage, "success", "人员记录已建立");
      }
      if (this.#closed) invalid("设备会话已关闭", 409);
      stage = "face";
      if (row.steps[1].state !== "success") {
        this.#step(row, stage, "running");
        const photo = this.#getPhoto(row.id);
        row.faceAttempted = true;
        await this.#provider.putFace(row, photo);
        row.faceSubmitted = true;
        this.#step(row, stage, "success", "照片已提交设备");
      }
      if (this.#closed) invalid("设备会话已关闭", 409);
      stage = "access";
      if (row.steps[2].state !== "success") { this.#step(row, stage, "running"); await this.#provider.grantAccess(row); this.#step(row, stage, "success", `已授予 ${row.doorNo} 号门，${row.accessPlanName}，${row.validityMode === "unlimited" ? "长期有效" : "受人员有效期约束"}`); }
      if (this.#closed) invalid("设备会话已关闭", 409);
      stage = "verify"; this.#step(row, stage, "running");
      await this.#verify(row);
      return copy(row);
    } catch (error) {
      row.status = "failed"; row.error = error instanceof HttpError ? error.message : "设备同步失败，请查询结果后继续";
      this.#step(row, stage, "failed", row.error); return copy(row);
    }
  }
  async #verify(row) {
    const person = await this.#provider.findPerson(row.employeeNo);
    if (!person || person.name !== row.name || !matchesValidity(person.Valid, row, this.#canonicalUnlimitedRows.has(row)) || !String(person.doorRight || "").split(",").includes(String(row.doorNo))) invalid("设备人员、有效期或门权限尚未查询确认", 502);
    if (!matchesAccessPlan(person, row)) invalid("每天24小时权限计划尚未查询确认绑定到所选门", 502);
    if (!row.faceSubmitted) invalid("人脸照片尚未确认提交成功，请先继续同步", 409);
    const searchable = this.#state.capabilities.faceSearchSupported === true;
    if (searchable) {
      const face = await this.#provider.findFace(row);
      if (face !== true) invalid("人脸尚未确认建模入库，请稍后查询状态", 502);
      row.faceModelingVerified = true;
    } else {
      if (!(Number(person.numOfFace) > 0)) invalid("设备尚未查询到该人员关联人脸，请稍后查询状态", 502);
      row.faceModelingVerified = false;
    }
    row.faceAssociationConfirmed = true;
    for (const key of ["person", "face", "access"]) {
      if (row.steps.find((step) => step.key === key).state !== "success") this.#step(row, key, "success", "由设备查询确认");
    }
    this.#step(row, "verify", "success", searchable ? "人员、人脸建模和门权限已查询确认，待现场刷脸" : "人员、门权限和人脸关联数量已确认；设备不支持建模查询，待现场刷脸"); row.status = searchable ? "ready" : "pending-site"; delete row.error;
    const photo = this.#photos.get(row.id); clearTimeout(photo?.timer); photo?.bytes.fill(0); this.#photos.delete(row.id);
  }
  async retry(data) {
    return this.#exclusive(async () => {
      const row = this.#rows.get(data?.id); if (!row) invalid("同步记录不存在", 404);
      if (["ready", "pending-site"].includes(row.status)) return copy(row);
      if (data.photoBase64) this.#savePhoto(row.id, decodeFacePhoto(data.photoBase64, this.#state.capabilities.maxPhotoBytes));
      return this.#run(row);
    });
  }
  async verify(data) {
    return this.#exclusive(async () => {
      const row = this.#rows.get(data?.id); if (!row) invalid("同步记录不存在", 404);
      if (!row.createAttempted) invalid("本次尚未创建该人员，请使用新的测试编号", 409);
      try { await this.#verify(row); } catch (error) { row.status = "failed"; row.error = error instanceof HttpError ? error.message : "查询设备结果失败"; this.#step(row, "verify", "failed", row.error); }
      return copy(row);
    });
  }
  close() { this.#closed = true; this.#provider?.close(); this.#provider = undefined; this.#clear(); this.#state.connected = false; }
}
