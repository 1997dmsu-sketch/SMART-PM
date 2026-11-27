import { performance } from "node:perf_hooks";
import { HikvisionClient } from "./hikvision-client.mjs";
import { FaceEnrollmentService, HikvisionFaceProvider } from "./face-enrollment.mjs";
import { FaceReadonlyPolicy, READONLY_POLICY_CODES } from "./face-readonly-policy.mjs";

const hostCodes = ["READONLY_INPUT", "READONLY_OPTIONS", "READONLY_OPERATION_DENIED", "READONLY_LIFECYCLE", "READONLY_BUSY", "READONLY_CLOSED", "READONLY_FAILURE", "READONLY_SESSION_TIMEOUT", "READONLY_REQUEST_TIMEOUT", "READONLY_MODEL", "READONLY_OUTPUT"];
const sdkCodes = ["HIKVISION_CONFIGURATION", "HIKVISION_TLS_PIN", "HIKVISION_AUTH_CHALLENGE", "HIKVISION_TIMEOUT", "HIKVISION_TRANSPORT", "HIKVISION_REDIRECT", "HIKVISION_CLOSED", "HIKVISION_REQUEST", "HIKVISION_RESPONSE_SIZE"];
const safeCodes = new Set([...hostCodes, ...sdkCodes, ...READONLY_POLICY_CODES]);
function fault(code) {
  const error = new Error("只读复验已停止，请核对错误类别");
  error.name = "ReadonlyFaceError";
  error.code = safeCodes.has(code) ? code : "READONLY_FAILURE";
  error.status = 409;
  return error;
}
function fields(value, allowed, code = "READONLY_INPUT") {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw fault(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !allowed.includes(key) || !Object.hasOwn(descriptors[key], "value"))) throw fault(code);
    return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
  } catch { throw fault(code); }
}
const empty = value => fields(value === undefined ? {} : value, []);
const bounded = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const cleanText = (value, maximum) => typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
function safeOutput(value) {
  const denied = new Set(["origin", "username", "password", "certificate", "certificatepath", "certificatebase64", "authorization", "photobase64", "photobytes", "faceurl", "photourl", "modeldata", "cardno"]);
  function visit(node) {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (denied.has(key.toLowerCase())) throw fault("READONLY_OUTPUT");
      visit(child);
    }
  }
  visit(value);
}

/** Inert until connect(). One read-only verification session; no file/env reads. */
export class FaceReadonlyHost {
  #options;
  #policy;
  #client;
  #service;
  #status = "NEW";
  #errorCode;
  #closed = false;
  #busy = false;
  #requestBusy = false;
  #requests = 0;
  #deadline;
  #timer;
  #cancelPending;
  #device = {};
  #capabilities = { libraries: [], doorNumbers: [] };

  constructor(options = {}) {
    const data = fields(options, ["planTemplateNo", "expectedModel", "maxRequests", "totalTimeoutMs", "requestTimeoutMs"], "READONLY_OPTIONS");
    const selected = { planTemplateNo: "1", expectedModel: "DS-K1T671BM", maxRequests: 256, totalTimeoutMs: 120000, requestTimeoutMs: 5000, ...data };
    if (typeof selected.planTemplateNo !== "string" || !/^[1-9]\d*$/.test(selected.planTemplateNo) || !Number.isSafeInteger(Number(selected.planTemplateNo))
      || !cleanText(selected.expectedModel, 128) || !bounded(selected.maxRequests, 1, 256)
      || !bounded(selected.totalTimeoutMs, 1, 120000) || !bounded(selected.requestTimeoutMs, 1, 5000)) throw fault("READONLY_OPTIONS");
    this.#options = Object.freeze(selected);
    this.#policy = new FaceReadonlyPolicy({ planTemplateNo: selected.planTemplateNo, maxRequests: selected.maxRequests });
  }

  #dispose() {
    clearTimeout(this.#timer); this.#timer = undefined;
    const cancel = this.#cancelPending; this.#cancelPending = undefined;
    cancel?.(fault(this.#errorCode || "READONLY_CLOSED"));
    const service = this.#service, client = this.#client;
    this.#service = undefined; this.#client = undefined;
    try { service?.close(); } catch { /* Never replace the first fault. */ }
    try { client?.close(); } catch { /* Idempotent fail-closed disposal. */ }
  }
  #trip(error) {
    let code;
    try { code = error?.code; } catch { /* Untrusted accessors cannot prevent disposal. */ }
    if (!this.#errorCode) this.#errorCode = typeof code === "string" && safeCodes.has(code) ? code : "READONLY_FAILURE";
    this.#status = "BLOCKED";
    this.#dispose();
    return fault(this.#errorCode);
  }
  #ensure() {
    if (this.#errorCode) throw fault(this.#errorCode);
    if (this.#closed) throw fault("READONLY_CLOSED");
    if (this.#deadline !== undefined && performance.now() >= this.#deadline) throw fault("READONLY_SESSION_TIMEOUT");
  }
  async #run(expectedStatus, nextStatus, action) {
    try {
      this.#ensure();
      if (this.#busy) throw fault("READONLY_BUSY");
      if (this.#status !== expectedStatus) throw fault("READONLY_LIFECYCLE");
    } catch (error) { throw this.#trip(error); }
    this.#busy = true; this.#status = nextStatus;
    try {
      const result = await action();
      this.#ensure();
      safeOutput(result);
      if (this.#status === "COMPLETE") this.#dispose();
      return result;
    } catch (error) { throw this.#trip(error); }
    finally { this.#busy = false; }
  }
  async #request(raw, input) {
    let response, timer, cancel, abandoned = false;
    try {
      this.#ensure();
      if (this.#requestBusy) throw fault("READONLY_BUSY");
      this.#requestBusy = true;
      const prepared = this.#policy.prepare(input);
      const remaining = this.#deadline - performance.now();
      if (remaining <= 0) throw fault("READONLY_SESSION_TIMEOUT");
      const timeout = Math.min(this.#options.requestTimeoutMs, remaining);
      const cancellation = new Promise((_, reject) => { cancel = reject; this.#cancelPending = reject; });
      const pending = Promise.resolve().then(() => {
        this.#ensure(); this.#requests += 1;
        return raw.request(prepared);
      }).then(value => {
        if (abandoned || this.#errorCode || this.#closed) {
          if (Buffer.isBuffer(value?.body)) value.body.fill(0);
          throw fault(this.#errorCode || "READONLY_CLOSED");
        }
        return value;
      });
      response = await Promise.race([pending, cancellation, new Promise((_, reject) => {
        timer = setTimeout(() => { abandoned = true; reject(this.#trip(fault("READONLY_REQUEST_TIMEOUT"))); }, timeout);
      })]);
      this.#ensure();
      this.#policy.observe(prepared, response);
      this.#ensure();
      return response;
    } catch (error) {
      abandoned = true;
      if (Buffer.isBuffer(response?.body)) response.body.fill(0);
      throw this.#trip(error);
    } finally {
      clearTimeout(timer); this.#requestBusy = false;
      if (this.#cancelPending === cancel) this.#cancelPending = undefined;
    }
  }

  async connect(config, ...extra) {
    return this.#run("NEW", "CONNECTING", async () => {
      if (extra.length) throw fault("READONLY_INPUT");
      const data = fields(config, ["mode", "origin", "username", "password", "certificate", "certificateBase64", "developmentTls", "planTemplateNo"]);
      if (data.mode !== "device" || !cleanText(data.origin, 512) || !cleanText(data.username, 1024)
        || typeof data.password !== "string" || data.password.length > 4096
        || data.planTemplateNo !== undefined && data.planTemplateNo !== this.#options.planTemplateNo
        || data.developmentTls !== undefined && typeof data.developmentTls !== "boolean"
        || data.certificate !== undefined && (!Buffer.isBuffer(data.certificate) || data.certificate.length > 524288)
        || data.certificateBase64 !== undefined && (typeof data.certificateBase64 !== "string" || data.certificateBase64.length > 699052)) throw fault("READONLY_INPUT");
      const sdkConfig = { origin: data.origin, username: data.username, password: data.password, developmentTls: data.developmentTls ?? false, timeoutMs: this.#options.requestTimeoutMs };
      if (data.certificate !== undefined) sdkConfig.certificate = Buffer.from(data.certificate);
      if (data.certificateBase64 !== undefined) sdkConfig.certificateBase64 = data.certificateBase64;
      let raw;
      try { raw = new HikvisionClient(sdkConfig); }
      finally { sdkConfig.certificate?.fill(0); }
      this.#client = raw;
      this.#deadline = performance.now() + this.#options.totalTimeoutMs;
      this.#timer = setTimeout(() => { this.#trip(fault("READONLY_SESSION_TIMEOUT")); }, this.#options.totalTimeoutMs);
      this.#timer.unref?.();
      const transport = Object.freeze({ request: input => this.#request(raw, input), close: () => raw.close() });
      const provider = new HikvisionFaceProvider(transport, { planTemplateNo: this.#options.planTemplateNo });
      const readProvider = Object.freeze({ describe: () => provider.describe(), list: input => provider.list(input), close: () => provider.close() });
      this.#service = new FaceEnrollmentService({ providerFactory: () => readProvider });
      const state = await this.#service.connect({ mode: "device" });
      this.#ensure();
      if (state.device.model !== this.#options.expectedModel) throw fault("READONLY_MODEL");
      this.#device = { model: this.#options.expectedModel, firmware: typeof state.device.firmware === "string" && /^[A-Za-z0-9 ._-]{0,64}$/.test(state.device.firmware) ? state.device.firmware : "" };
      const caps = state.capabilities;
      this.#capabilities = {
        libraries: caps.libraries.filter(row => ["blackFD", "infraredFD"].includes(row.faceLibType)).map(row => ({ FDID: row.FDID, faceLibType: row.faceLibType })),
        doorNumbers: caps.doorNumbers.filter(value => Number.isSafeInteger(value) && value >= 1 && value <= 65535),
        allDayPlan: { templateNo: caps.allDayPlan.templateNo, fingerprint: caps.allDayPlan.fingerprint, name: "每天24小时", weekPlanNo: caps.allDayPlan.weekPlanNo, holidayGroupNos: [...caps.allDayPlan.holidayGroupNos] },
      };
      this.#status = "READY";
      return { ...this.state(), busy: false };
    });
  }
  async list(input = {}, ...extra) {
    return this.#run("READY", "LISTING", async () => {
      if (extra.length) throw fault("READONLY_INPUT");
      empty(input);
      this.#policy.beginList();
      const result = await this.#service.list();
      this.#ensure(); // The provider catches face-query failures; the fuse must dominate its DTO.
      this.#policy.finishList();
      this.#status = "COMPLETE";
      return { ...result, people: result.people.map(person => ({ ...person, deleteAllowed: false })) };
    });
  }
  state(...extra) {
    if (extra.length) throw this.#trip(fault("READONLY_INPUT"));
    return structuredClone({ mode: "device", connected: !this.#errorCode && !this.#closed && ["READY", "LISTING"].includes(this.#status), device: this.#device, capabilities: this.#capabilities, busy: this.#busy, enrollments: [], readonly: { status: this.#status, blocked: Boolean(this.#errorCode), errorCode: this.#errorCode ?? null, logicalRequests: this.#requests } });
  }
  close(...extra) {
    if (extra.length) throw this.#trip(fault("READONLY_INPUT"));
    this.#closed = true;
    if (this.#busy) { this.#trip(fault("READONLY_CLOSED")); return; }
    if (!this.#errorCode) this.#status = "CLOSED";
    this.#dispose();
  }
  async disconnect(input, ...extra) {
    try { if (extra.length) throw fault("READONLY_INPUT"); empty(input); this.close(); return this.state(); }
    catch (error) { throw this.#trip(error); }
  }
  async dispatch(action, input, ...extra) {
    try {
      if (extra.length) throw fault("READONLY_INPUT");
      switch (action) {
        case "connect": return await this.connect(input);
        case "list": return await this.list(input);
        case "state": empty(input); return this.state();
        case "disconnect": return await this.disconnect(input);
        default: throw fault("READONLY_OPERATION_DENIED");
      }
    } catch (error) { throw this.#trip(error); }
  }
  async enroll() { throw this.#trip(fault("READONLY_OPERATION_DENIED")); }
  async retry() { throw this.#trip(fault("READONLY_OPERATION_DENIED")); }
  async verify() { throw this.#trip(fault("READONLY_OPERATION_DENIED")); }
  async prepareDelete() { throw this.#trip(fault("READONLY_OPERATION_DENIED")); }
  async delete() { throw this.#trip(fault("READONLY_OPERATION_DENIED")); }
  async followDelete() { throw this.#trip(fault("READONLY_OPERATION_DENIED")); }
}
