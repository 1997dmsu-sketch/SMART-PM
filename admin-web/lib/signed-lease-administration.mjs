import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = () => Object.assign(new Error("Invalid signed lease administration request"), { code: "INVALID_INPUT", status: 400 });
const unavailable = () => Object.assign(new Error("Signed lease service unavailable"), { code: "SERVICE_UNAVAILABLE", status: 503 });
const administratorRequired = () => Object.assign(new Error("Administrator required"), { code: "ADMIN_REQUIRED", status: 403 });
function closedRecord(value, allowed, error = invalid) {
  try {
    if (!object(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw error();
    const result = {};
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== "string" || !allowed.includes(key) || !descriptor?.enumerable
        || !Object.hasOwn(descriptor, "value")) throw error();
      result[key] = descriptor.value;
    }
    return result;
  } catch { throw error(); }
}
const definitions = Object.freeze({
  configureProgram: {
    input: ["expectedRevision", "enabled", "dispatchEnabled"],
    output: ["revision", "enabled", "dispatchEnabled"],
  },
  setDoorBinding: {
    input: ["bindingId", "expectedRevision", "houseId", "displayName", "deviceKey", "doorNo", "expectedModel", "enabled"],
    output: ["bindingId", "revision", "houseId", "displayName", "deviceKey", "doorNo", "expectedModel", "enabled"],
  },
  setWorker: {
    input: ["workerId", "expectedRevision", "deviceKey", "tokenHash", "enabled"],
    output: ["workerId", "revision", "deviceKey", "enabled"],
  },
  confirmSignedLease: {
    input: ["contractId", "expectedRevision", "userId", "houseId", "doorBindingId", "startDate", "endDate", "signedEvidenceRef"],
    output: ["contractId", "revision", "status", "userId", "houseId", "doorBindingId", "startDate", "endDate", "validFrom", "validUntil"],
  },
  revokeLease: {
    input: ["contractId", "expectedRevision", "reason"],
    output: ["contractId", "revision", "status"],
  },
  resolveUnknown: {
    input: ["taskId", "expectedRevision", "reason"],
    output: ["taskId", "revision", "status", "resolved"],
  },
});
const recordFields = Object.freeze({
  contract: definitions.confirmSignedLease.output,
  binding: definitions.setDoorBinding.output,
  worker: definitions.setWorker.output,
  program: definitions.configureProgram.output,
  task: ["taskId", "revision", "status", "resolved", "contractId", "expiresAt", "message"],
});
const taskStatuses = new Set(["queued", "claimed", "executing", "unknown", "device_confirmed", "failed", "expired", "denied"]);
function trustedAdministrator(actor) {
  const trusted = closedRecord(actor, ["kind", "id"], administratorRequired);
  if (trusted.kind !== "admin" || typeof trusted.id !== "string" || !trusted.id || trusted.id.length > 256
    || /[\x00-\x20\x7f/\\]/.test(trusted.id)) throw administratorRequired();
  return { kind: "admin", id: trusted.id };
}
function ownValue(value, key) {
  const descriptor = object(value) && Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw unavailable();
  return descriptor.value;
}
function projectRecord(kind, raw, id) {
  if (!object(raw)) throw unavailable();
  const record = {};
  for (const key of recordFields[kind]) {
    const value = ownValue(raw, key);
    const numeric = ["revision", "doorNo", "validFrom", "validUntil", "expiresAt"].includes(key);
    const boolean = ["enabled", "dispatchEnabled", "resolved"].includes(key);
    if (numeric ? !Number.isSafeInteger(value) || (key === "revision" && value < 1)
      || (key === "doorNo" && (value < 1 || value > 65535))
      : boolean ? typeof value !== "boolean"
        : typeof value !== "string" || !value || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) throw unavailable();
    record[key] = value;
  }
  const idKey = { contract: "contractId", binding: "bindingId", worker: "workerId", task: "taskId" }[kind];
  if ((idKey && record[idKey] !== id)
    || (kind === "contract" && (!["signed", "revoked"].includes(record.status) || record.validUntil <= record.validFrom))
    || (kind === "binding" && (record.doorNo < 1 || record.doorNo > 65535))
    || (kind === "task" && !taskStatuses.has(record.status))) throw unavailable();
  return record;
}

/** Authenticated backend boundary; no SDK initialization or device operation. */
export class AdminSignedLeaseAccess {
  #service;
  constructor({ database, now, serviceFactory } = {}) {
    const createService = serviceFactory || require("../../cloudfunctions/signedLeaseAccess/lib/service.js").createService;
    if (typeof createService !== "function") throw unavailable();
    this.#service = createService({ db: database, ...(now === undefined ? {} : { now }) });
  }

  async #invoke(operation, actor, input) {
    const trusted = trustedAdministrator(actor);
    const definition = definitions[operation];
    const data = closedRecord(input, definition.input);
    if (typeof this.#service?.[operation] !== "function") throw unavailable();
    const result = await this.#service[operation]({ kind: "admin", id: trusted.id }, data);
    if (!object(result)) throw unavailable();
    const output = {};
    for (const key of definition.output) {
      const value = result[key];
      const numeric = ["revision", "doorNo", "validFrom", "validUntil"].includes(key);
      const boolean = ["enabled", "dispatchEnabled", "resolved"].includes(key);
      if (numeric ? !Number.isSafeInteger(value) || (key === "revision" && value < 1)
        || (key === "doorNo" && (value < 1 || value > 65535))
        : boolean ? typeof value !== "boolean"
          : typeof value !== "string" || !value || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) throw unavailable();
      output[key] = value;
    }
    if ((operation === "confirmSignedLease" && (output.status !== "signed" || output.validUntil <= output.validFrom))
      || (operation === "revokeLease" && output.status !== "revoked")
      || (operation === "resolveUnknown" && (output.status !== "unknown" || output.resolved !== true))) throw unavailable();
    return output;
  }

  configureProgram(actor, input) { return this.#invoke("configureProgram", actor, input); }
  setDoorBinding(actor, input) { return this.#invoke("setDoorBinding", actor, input); }
  setWorker(actor, input) { return this.#invoke("setWorker", actor, input); }
  confirmSignedLease(actor, input) { return this.#invoke("confirmSignedLease", actor, input); }
  revokeLease(actor, input) { return this.#invoke("revokeLease", actor, input); }
  resolveUnknown(actor, input) { return this.#invoke("resolveUnknown", actor, input); }

  async getAdminRecord(actor, input) {
    const trusted = trustedAdministrator(actor);
    const data = closedRecord(input, ["kind", "id"]);
    if (typeof data.kind !== "string" || !Object.hasOwn(recordFields, data.kind)
      || (data.kind === "program" ? data.id !== undefined && data.id !== "program"
        : typeof data.id !== "string" || !data.id || data.id.length > 256 || /[\x00-\x20\x7f/\\]/.test(data.id))) throw invalid();
    if (typeof this.#service?.getAdminRecord !== "function") throw unavailable();
    const result = await this.#service.getAdminRecord(trusted, data);
    if (ownValue(result, "kind") !== data.kind) throw unavailable();
    const raw = ownValue(result, "record");
    return { kind: data.kind, record: raw === null ? null : projectRecord(data.kind, raw, data.id) };
  }
}
