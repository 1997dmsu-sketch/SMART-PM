import { createRequire } from "node:module";
import { createHash } from "node:crypto";

// Reuse the cloud function's deterministic ids and date rules so the admin
// configuration and the server gates can never disagree.
const require = createRequire(import.meta.url);
const { COLLECTIONS, ids, ENVIRONMENT } = require("../../cloudfunctions/checkinFaceTest/lib/store.js");
const dates = require("../../cloudfunctions/checkinFaceTest/lib/dates.js");

// Must stay identical to the authoritative cloud validator in
// cloudfunctions/checkinFaceTest/lib/validate.js (validateApplicationVersion).
const APPLICATION_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const SECRET_KEYS = new Set([
  "workerTokenHash", "workerToken", "password", "origin", "certificatePath",
  "privateKey", "pin", "clientSecret", "accessToken",
]);

const ROOM_FIELDS = [
  "displayNo", "projectId", "buildingId", "roomId", "houseId", "doorNo",
  "deviceKey", "accessPlanFingerprint", "projectName", "buildingName",
];

class AdminConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AdminConfigError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AdminConfigError(code, message);
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertFields(value, allowed, label) {
  if (!isPlainObject(value)) fail("INVALID_INPUT", `${label}格式无效`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail("INVALID_FIELD", `${label}不允许字段 ${key}`);
  }
  return value;
}

function text(value, code, maxLength = 128) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || /[\x00-\x1f\x7f]/.test(value)) {
    fail(code, "参数格式不正确");
  }
  return value.trim();
}

function publicDoc(doc) {
  if (!doc) return null;
  return Object.fromEntries(Object.entries(doc).filter(([key]) => !SECRET_KEYS.has(key)));
}

function isNotFound(error) {
  const code = error && (error.errCode ?? error.code);
  return code === -1 || code === "DOCUMENT_NOT_EXISTS" || /not\s*found|not\s*exist|不存在/i.test(String(error?.message || ""));
}

/**
 * Admin-only configuration service for the isolated check-in / face test
 * namespace. It writes only the new test collections and an audit record;
 * it never touches device connection material or existing import functions.
 */
export class AdminCheckinFaceTestConfig {
  constructor(app, options = {}) {
    const database = options.database || (app && typeof app.database === "function" ? app.database() : app);
    if (!database || typeof database.collection !== "function") fail("INVALID_DATABASE", "数据库未正确注入");
    this.db = database;
    this.environment = options.environment || ENVIRONMENT;
    this.now = typeof options.now === "function" ? options.now : () => new Date();
    this.time = () => {
      const value = this.now();
      if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
      return Number.isFinite(Number(value)) ? Number(value) : 0;
    };
    this.operator = options.operator || "admin";
  }

  async #get(collection, id) {
    try {
      const result = await this.db.collection(collection).doc(id).get();
      return result && result.data ? result.data : null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async #set(collection, id, value) {
    const data = { ...value, _id: id, environment: this.environment, updatedAt: this.time() };
    await this.db.collection(collection).doc(id).set({ data });
    return data;
  }

  async #audit(action, targetId, before, after, reason, revision, operator = this.operator) {
    const data = {
      _id: `admin-audit-${this.environment}-${action}-${revision}-${Date.now()}`,
      action,
      operator: operator || this.operator,
      targetId,
      before: publicDoc(before),
      after: publicDoc(after),
      reason: typeof reason === "string" ? reason.slice(0, 500) : "",
      revision,
      createdAt: this.time(),
      environment: this.environment,
    };
    await this.db.collection(COLLECTIONS.AUDIT).add({ data });
    return data;
  }

  async #defaultConfig() {
    return {
      _id: ids.configId(this.environment),
      environment: this.environment,
      enabled: false,
      dispatchEnabled: false,
      applicationVersion: "",
      workerTokenHash: "",
      revision: 0,
    };
  }

  async #config() {
    const doc = await this.#get(COLLECTIONS.CONFIG, ids.configId(this.environment));
    if (!doc) return this.#defaultConfig();
    return { ...(await this.#defaultConfig()), ...doc };
  }

  /** Bump the config revision so queued tasks become INVALIDATED on changes. */
  async #bumpConfigRevision(action, reason) {
    const config = await this.#config();
    const next = { ...config, revision: (Number(config.revision) || 0) + 1 };
    await this.#set(COLLECTIONS.CONFIG, next._id, next);
    await this.#audit(action, next._id, config, { revision: next.revision }, reason, next.revision);
    return next.revision;
  }

  /** Read the complete visible configuration; no token or device secret is returned. */
  async getConfig() {
    const [config, room, lease] = await Promise.all([
      this.#config(),
      this.#get(COLLECTIONS.ROOM, ids.roomBindingId(this.environment)),
      this.#get(COLLECTIONS.LEASE, ids.leaseId(this.environment)),
    ]);
    let allowlist = [];
    if (typeof this.db.collection(COLLECTIONS.ALLOWLIST).where === "function") {
      const result = await this.db.collection(COLLECTIONS.ALLOWLIST).where({ environment: this.environment }).get();
      allowlist = (result?.data || []).map(publicDoc);
    }
    // Expose only a non-secret presence flag; the hash and any plain token are
    // never returned to the configuration page or its API responses.
    return {
      config: {
        ...publicDoc(config),
        workerTokenConfigured: Boolean(config.workerTokenHash),
      },
      room: publicDoc(room),
      lease: publicDoc(lease),
      allowlist,
      revision: config.revision,
    };
  }

  /**
   * Set the worker credential. Only its SHA-256 digest is persisted; the
   * plaintext is never written, returned or logged. A revision bump invalidates
   * already queued tasks so they cannot be claimed with an old credential.
   *
   * @param {string} plainToken at least 32 characters of random credential.
   * @param {{operator?:string, reason?:string}} options caller identity/reason.
   * @returns {Promise<{workerTokenConfigured:boolean, revision:number}>}
   */
  async setWorkerToken(plainToken, options = {}) {
    if (typeof plainToken !== "string" || plainToken.length < 32 || plainToken.length > 256
      || /[\x00-\x1f\x7f]/.test(plainToken)) {
      fail("INVALID_WORKER_TOKEN", "worker 凭据必须是至少 32 字符的随机字符串");
    }
    const operator = typeof options?.operator === "string" && options.operator.trim()
      ? options.operator.trim() : this.operator;
    const reason = typeof options?.reason === "string" ? options.reason.slice(0, 500) : "";
    const digest = createHash("sha256").update(plainToken, "utf8").digest("hex");
    const current = await this.#config();
    const next = {
      ...current,
      workerTokenHash: digest,
      revision: (Number(current.revision) || 0) + 1,
    };
    await this.#set(COLLECTIONS.CONFIG, next._id, next);
    await this.#audit(
      "WORKER_TOKEN_SET", next._id, null,
      { workerTokenPrefix: digest.slice(0, 8), revision: next.revision },
      reason, next.revision, operator,
    );
    return { workerTokenConfigured: true, revision: next.revision };
  }

  /**
   * Persist the application version that the mini-program must present.
   * The pattern is intentionally identical to the authoritative cloud
   * validator, so a version accepted here is never rejected by applyCheckin
   * with INVALID_VERSION. An empty version is rejected before any write.
   *
   * @param {string} version 1–64 chars: alphanumeric first, then A-Za-z0-9._-
   * @param {{operator?:string, reason?:string}} options caller identity/reason.
   * @returns {Promise<{applicationVersion:string, revision:number, leaseVersionSynced:boolean}>}
   */
  async setApplicationVersion(version, options = {}) {
    if (typeof version !== "string") fail("INVALID_APPLICATION_VERSION", "申请版本必须是字符串");
    const normalized = version.trim();
    if (!APPLICATION_VERSION_PATTERN.test(normalized)) {
      fail("INVALID_APPLICATION_VERSION", "申请版本须为 1–64 位字母/数字开头，可含 . _ -");
    }
    const operator = typeof options?.operator === "string" && options.operator.trim()
      ? options.operator.trim() : this.operator;
    const reason = typeof options?.reason === "string" ? options.reason.slice(0, 500) : "";
    const current = await this.#config();
    // Keep an already configured lease pinned to the current program version.
    // Otherwise a later version change would leave lease.applicationVersion
    // stale and permanently fail applyCheckin with LEASE_EXPIRED.
    const leaseId = ids.leaseId(this.environment);
    const lease = await this.#get(COLLECTIONS.LEASE, leaseId);
    let leaseVersionSynced = false;
    if (lease && lease.applicationVersion !== normalized) {
      await this.#set(COLLECTIONS.LEASE, leaseId, {
        ...lease,
        applicationVersion: normalized,
        revision: (Number(lease.revision) || 0) + 1,
      });
      leaseVersionSynced = true;
    }
    const next = {
      ...current,
      applicationVersion: normalized,
      revision: (Number(current.revision) || 0) + 1,
    };
    await this.#set(COLLECTIONS.CONFIG, next._id, next);
    await this.#audit(
      "APPLICATION_VERSION_SET", next._id, null,
      { applicationVersion: normalized, revision: next.revision, leaseVersionSynced },
      reason, next.revision, operator,
    );
    return { applicationVersion: normalized, revision: next.revision, leaseVersionSynced };
  }

  /**
   * Enable worker dispatch. Defaults to false; only an explicit `true` opens
   * claimTask. Claim still requires enabled === true and a fresh revalidation.
   *
   * @param {boolean} enabled strict boolean.
   * @param {{operator?:string, reason?:string}} options caller identity/reason.
   * @returns {Promise<{dispatchEnabled:boolean, revision:number}>}
   */
  async setDispatchEnabled(enabled, options = {}) {
    if (typeof enabled !== "boolean") fail("INVALID_INPUT", "派发开关必须是布尔值");
    const operator = typeof options?.operator === "string" && options.operator.trim()
      ? options.operator.trim() : this.operator;
    const reason = typeof options?.reason === "string" ? options.reason.slice(0, 500) : "";
    const current = await this.#config();
    const next = {
      ...current,
      dispatchEnabled: enabled,
      revision: (Number(current.revision) || 0) + 1,
    };
    await this.#set(COLLECTIONS.CONFIG, next._id, next);
    await this.#audit(
      "DISPATCH_SET", next._id, null,
      { dispatchEnabled: enabled, revision: next.revision },
      reason, next.revision, operator,
    );
    return { dispatchEnabled: next.dispatchEnabled, revision: next.revision };
  }

  /**
   * Enable automatic approval only for a fully configured test program:
   * version, worker credential, unique 102 binding and an active fixed lease.
   * Any missing prerequisite fails closed before writing.
   */
  async setSwitch(enabled, reason = "", options = {}) {
    if (typeof enabled !== "boolean") fail("INVALID_INPUT", "开关必须是布尔值");
    const current = await this.#config();
    if (enabled) {
      if (typeof current.applicationVersion !== "string" || !current.applicationVersion.trim()) {
        fail("VERSION_UNCONFIGURED", "请先配置申请版本");
      }
      if (typeof current.workerTokenHash !== "string"
        || !/^[a-f0-9]{64}$/i.test(current.workerTokenHash)) {
        fail("WORKER_TOKEN_UNCONFIGURED", "请先设置 worker 凭据");
      }
      const room = await this.#get(COLLECTIONS.ROOM, ids.roomBindingId(this.environment));
      const lease = await this.#get(COLLECTIONS.LEASE, ids.leaseId(this.environment));
      if (!room || room.displayNo !== "102") fail("ROOM_UNCONFIGURED", "请先唯一绑定 102");
      if (!lease || lease.status !== "active" || !dates.isValidWindowSnapshot(lease)) {
        fail("LEASE_UNCONFIGURED", "请由负责人手填有效租期后再开启");
      }
      if (lease.applicationVersion !== current.applicationVersion) {
        fail("LEASE_VERSION_MISMATCH", "申请版本已变更，请重新保存租期");
      }
    }
    const operator = typeof options?.operator === "string" && options.operator.trim()
      ? options.operator.trim() : this.operator;
    const next = { ...current, enabled, revision: (Number(current.revision) || 0) + 1 };
    await this.#set(COLLECTIONS.CONFIG, next._id, next);
    await this.#audit(
      "setSwitch", next._id, current, { enabled, revision: next.revision },
      options.reason || reason, next.revision, operator,
    );
    return { enabled: next.enabled, revision: next.revision };
  }

  /** Bind display number 102 to exactly one project/room/device reference. */
  async upsertRoomBinding(input, options = {}) {
    assertFields(input, ROOM_FIELDS, "102 绑定");
    if (input.displayNo !== "102") fail("INVALID_ROOM", "展示房号必须是 102");
    const value = {
      displayNo: "102",
      projectId: text(input.projectId, "INVALID_PROJECT_ID"),
      buildingId: text(input.buildingId, "INVALID_BUILDING_ID"),
      roomId: text(input.roomId, "INVALID_ROOM_ID"),
      houseId: text(input.houseId, "INVALID_HOUSE_ID"),
      doorNo: input.doorNo,
      deviceKey: text(input.deviceKey, "INVALID_DEVICE_KEY", 128),
    };
    // Human-readable names are optional administrator input only. The server
    // view falls back to the stable ids, so no name is ever guessed.
    if (input.projectName !== undefined) value.projectName = text(input.projectName, "INVALID_PROJECT_NAME");
    if (input.buildingName !== undefined) value.buildingName = text(input.buildingName, "INVALID_BUILDING_NAME");
    if (!Number.isSafeInteger(value.doorNo) || value.doorNo < 1 || value.doorNo > 65535) {
      fail("INVALID_DOOR", "门编号必须是 1–65535 的整数");
    }
    if (input.accessPlanFingerprint !== undefined) {
      if (typeof input.accessPlanFingerprint !== "string" || !/^[a-f0-9]{64}$/i.test(input.accessPlanFingerprint)) {
        fail("INVALID_PLAN_FINGERPRINT", "全天计划指纹格式不正确");
      }
      value.accessPlanFingerprint = input.accessPlanFingerprint.toLowerCase();
    }
    const id = ids.roomBindingId(this.environment);
    const query = this.db.collection(COLLECTIONS.ROOM).where({ environment: this.environment, displayNo: "102" });
    if (typeof query.count === "function") {
      const result = await query.count();
      if (Number(result?.total || 0) > 1) fail("ROOM_NOT_UNIQUE", "102 已有多条绑定，未选择任何一条");
    }
    const before = await this.#get(COLLECTIONS.ROOM, id);
    const next = await this.#set(COLLECTIONS.ROOM, id, { ...value, revision: (Number(before?.revision) || 0) + 1 });
    const revision = await this.#bumpConfigRevision("upsertRoomBinding", options.reason || "更新 102 唯一绑定");
    await this.#audit("upsertRoomBinding", id, before, { displayNo: "102", roomId: value.roomId, doorNo: value.doorNo, revision: next.revision }, options.reason || "", revision);
    return { ...publicDoc(next), configRevision: revision };
  }

  /** Persist a manually entered lease window; never infer or extend dates. */
  async upsertLease(input, options = {}) {
    assertFields(input, ["startDate", "endDate", "status"], "租期");
    const window = dates.buildLeaseWindow(input.startDate, input.endDate);
    const status = input.status === undefined ? "active" : input.status;
    if (!["active", "cancelled"].includes(status)) fail("INVALID_LEASE_STATUS", "租期状态无效");
    const room = await this.#get(COLLECTIONS.ROOM, ids.roomBindingId(this.environment));
    if (!room) fail("ROOM_UNCONFIGURED", "请先绑定 102");
    const config = await this.#config();
    // A lease saved before any version was configured would pin an empty
    // version into its snapshot, making every applyCheckin fail later.
    if (typeof config.applicationVersion !== "string" || !config.applicationVersion.trim()) {
      fail("VERSION_UNCONFIGURED", "请先配置申请版本再保存租期");
    }
    const id = ids.leaseId(this.environment);
    const before = await this.#get(COLLECTIONS.LEASE, id);
    const next = await this.#set(COLLECTIONS.LEASE, id, {
      ...window,
      status,
      roomBindingId: room._id,
      doorNo: room.doorNo,
      applicationVersion: config.applicationVersion,
      configuredBy: this.operator,
      revision: (Number(before?.revision) || 0) + 1,
    });
    const revision = await this.#bumpConfigRevision("upsertLease", options.reason || "更新手填租期");
    await this.#audit("upsertLease", id, before, { startDate: window.startDate, endDate: window.endDate, validFrom: window.validFrom, validTo: window.validTo, status, revision: next.revision }, options.reason || "", revision);
    return { ...publicDoc(next), configRevision: revision };
  }

  /** Replace the active allowlist; removed accounts are deactivated, never deleted. */
  async setAllowlist(openids, options = {}) {
    if (!Array.isArray(openids)) fail("INVALID_ALLOWLIST", "名单必须是数组");
    const entries = openids.map((item) => {
      const raw = typeof item === "string" ? { openid: item } : item;
      assertFields(raw, ["openid", "displayLabel", "status"], "测试账号");
      const openid = text(raw.openid, "INVALID_OPENID", 128);
      if (!/^[A-Za-z0-9_-]{6,128}$/.test(openid)) fail("INVALID_OPENID", "openid 格式不正确");
      const status = raw.status === undefined ? "active" : raw.status;
      if (!["active", "inactive"].includes(status)) fail("INVALID_ACCOUNT_STATUS", "账号状态无效");
      return { openid, displayLabel: raw.displayLabel === undefined ? "" : text(raw.displayLabel, "INVALID_LABEL", 64), status };
    });
    const seen = new Set(entries.map((entry) => entry.openid));
    if (seen.size !== entries.length) fail("DUPLICATE_OPENID", "名单不能包含重复账号");

    const collection = COLLECTIONS.ALLOWLIST;
    const previous = typeof this.db.collection(collection).where === "function"
      ? (await this.db.collection(collection).where({ environment: this.environment }).get()).data || []
      : [];
    for (const row of previous) {
      if (!seen.has(row.openid)) {
        await this.#set(collection, row._id, { ...row, status: "inactive", revision: (Number(row.revision) || 0) + 1 });
      }
    }
    for (const entry of entries) {
      const id = ids.allowlistId(this.environment, entry.openid);
      const before = await this.#get(collection, id);
      await this.#set(collection, id, { ...entry, _id: id, revision: (Number(before?.revision) || 0) + 1 });
    }
    const revision = await this.#bumpConfigRevision("setAllowlist", options.reason || "更新测试账号名单");
    await this.#audit("setAllowlist", ids.configId(this.environment), null, { count: entries.length }, options.reason || "", revision);
    return { count: entries.length, revision };
  }
}

export default AdminCheckinFaceTestConfig;
