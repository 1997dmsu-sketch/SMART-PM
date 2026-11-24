import { randomBytes, randomUUID } from "node:crypto";
import { HttpError } from "./model.mjs";
import { HikvisionClient } from "./hikvision-client.mjs";

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
function normalizeLocalTime(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) invalid(`${label}格式错误`);
  const normalized = value.length === 16 ? value + ":00" : value;
  const [year, month, day, hour, minute, second] = normalized.split(/\D/).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) invalid(`${label}无效`);
  return normalized;
}
function matchesValidity(actual, expected) {
  return actual?.enable === (expected.validityMode !== "unlimited")
    && actual.beginTime === expected.validFrom && actual.endTime === expected.validTo
    && (actual.timeType === undefined || actual.timeType === "local");
}
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
  constructor(client) { this.client = client; }
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
    return {
      device: { model: xmlValue(text, "model") || "未返回型号", firmware: xmlValue(text, "firmwareVersion") || "" },
      capabilities: {
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
    await this.json("PUT", "/ISAPI/AccessControl/UserInfo/Modify?format=json", { UserInfo: { employeeNo: person.employeeNo, doorRight: String(person.doorNo) } });
  }
  async findFace(person) {
    const value = await this.json("POST", "/ISAPI/Intelligent/FDLib/FDSearch?format=json", { searchResultPosition: 0, maxResults: 1, faceLibType: person.faceLibType, FDID: person.FDID, FPID: person.employeeNo });
    const match = (value.MatchList || []).find((row) => row.FPID === person.employeeNo);
    return !match ? false : match.isInLibrary === "yes" ? true : match.isInLibrary === "no" ? false : null;
  }
  close() { this.client.close(); }
}

export class SimulatedFaceProvider {
  constructor() { this.people = new Map(); this.faces = new Set(); }
  async describe() { return { device: { model: "模拟门禁设备", firmware: "simulation" }, capabilities: { libraries: [{ FDID: "SIMULATION_FD_01", faceLibType: "blackFD" }], doorNumbers: [1], maxPhotoBytes: FACE_PHOTO_LIMIT, photoLimitSource: "guide-default", employeeNoMaxLength: 32, employeeNoPattern: "^[A-Za-z0-9_-]+$", nameMaxBytes: 128, faceSearchSupported: true, personFaceCountSupported: true, longTermValiditySupported: true, timeRangeBegin: "1970-01-01T00:00:00", timeRangeEnd: "2037-12-31T23:59:59" } }; }
  async findPerson(id) { return copy(this.people.get(id) || null); }
  async createPerson(person) { if (this.people.has(person.employeeNo)) invalid("人员编号已存在", 409); this.people.set(person.employeeNo, { employeeNo: person.employeeNo, name: person.name, Valid: { enable: person.validityMode !== "unlimited", beginTime: person.validFrom, endTime: person.validTo, timeType: "local" }, doorRight: "", numOfFace: 0 }); }
  async putFace(person) { this.faces.add(person.employeeNo); this.people.get(person.employeeNo).numOfFace = 1; }
  async grantAccess(person) { this.people.get(person.employeeNo).doorRight = String(person.doorNo); }
  async findFace(person) { return this.faces.has(person.employeeNo); }
  close() { this.people.clear(); this.faces.clear(); }
}

export class FaceEnrollmentService {
  #provider;
  #rows = new Map();
  #photos = new Map();
  #busy = false;
  #closed = false;
  #providerFactory;
  #state = { mode: "simulation", connected: false, device: {}, capabilities: { libraries: [], doorNumbers: [], maxPhotoBytes: FACE_PHOTO_LIMIT } };
  constructor({ providerFactory = (config) => new HikvisionFaceProvider(new HikvisionClient(config)) } = {}) { this.#providerFactory = providerFactory; }
  state() { return copy({ ...this.#state, busy: this.#busy, enrollments: [...this.#rows.values()] }); }
  async #exclusive(action) {
    if (this.#closed) invalid("设备会话已关闭，请重新登录", 409);
    if (this.#busy) invalid("已有设备操作进行中，请等待完成", 409);
    this.#busy = true;
    try { return await action(); } finally { this.#busy = false; }
  }
  #clear() { for (const photo of this.#photos.values()) { clearTimeout(photo.timer); photo.bytes.fill(0); } this.#photos.clear(); this.#rows.clear(); }
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
      this.#state = { mode: data.mode, connected: true, device: { ...description.device, ...(data.mode === "device" ? { origin: new URL(data.origin).origin } : {}) }, capabilities: description.capabilities };
    });
    return this.state();
  }
  async disconnect() {
    await this.#exclusive(async () => { this.#provider?.close(); this.#provider = undefined; this.#clear(); this.#state = { mode: "simulation", connected: false, device: {}, capabilities: { libraries: [], doorNumbers: [], maxPhotoBytes: FACE_PHOTO_LIMIT } }; });
    return this.state();
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
    return { employeeNo: data.employeeNo, name: data.name.trim(), doorNo: Number(data.doorNo), ...library, validityMode, validFrom, validTo };
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
        if (existing && (existing.name !== row.name || !matchesValidity(existing.Valid, row))) invalid("设备人员与本次测试不一致，已停止继续同步", 409);
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
      if (row.steps[2].state !== "success") { this.#step(row, stage, "running"); await this.#provider.grantAccess(row); this.#step(row, stage, "success", `已授予 ${row.doorNo} 号门，${row.validityMode === "unlimited" ? "长期有效" : "受人员有效期约束"}`); }
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
    if (!person || person.name !== row.name || !matchesValidity(person.Valid, row) || !String(person.doorRight || "").split(",").includes(String(row.doorNo))) invalid("设备人员、有效期或门权限尚未查询确认", 502);
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
