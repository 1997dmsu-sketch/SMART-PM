// A stateful allow-list for the existing describe/list sequence. This module has
// no transport and retains only references, identifiers and aggregate counters.
const ACCESS = "/ISAPI/AccessControl";
const FACE = "/ISAPI/Intelligent/FDLib";
const paths = Object.freeze({
  device: "/ISAPI/System/deviceInfo",
  user: `${ACCESS}/UserInfo/capabilities?format=json`,
  face: `${FACE}/capabilities?format=json`,
  libraries: `${FACE}?format=json`,
  count: `${FACE}/Count?format=json`,
  door: `${ACCESS}/RemoteControl/door/capabilities`,
  capability: `${ACCESS}/UserRightPlanTemplate/capabilities?format=json`,
  people: `${ACCESS}/UserInfo/Search?format=json`,
  search: `${FACE}/FDSearch?format=json`,
});
const planPath = (resource, id) => `${ACCESS}/${resource}/${id}?format=json`;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const owns = (value, key) => Object.hasOwn(value, key);
const employee = value => typeof value === "string" && /^[A-Za-z0-9]{1,32}$/.test(value);
const identifier = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const positiveId = value => ["string", "number"].includes(typeof value) && /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const knownError = value => typeof value === "string" && ["invalid operation", "invalid xml content", "invalid xml format", "device error", "device busy", "invalid command", "reboot required", "unauthorized", "forbidden", "failed", "error"].includes(value.toLowerCase());
export const READONLY_POLICY_CODES = Object.freeze([
  "READONLY_BUDGET", "READONLY_CONFIGURATION", "READONLY_CONTENT_TYPE", "READONLY_DEVICE_ERROR",
  "READONLY_DUPLICATE", "READONLY_EMPLOYEE", "READONLY_ENCODING", "READONLY_FACE_UNCONFIRMED",
  "READONLY_HTTP", "READONLY_INCOMPLETE", "READONLY_JSON", "READONLY_LIBRARY", "READONLY_METHOD",
  "READONLY_PAGINATION", "READONLY_PATH", "READONLY_PHASE", "READONLY_POLICY", "READONLY_REDIRECT",
  "READONLY_REFERENCE", "READONLY_REQUEST", "READONLY_REQUEST_BODY", "READONLY_RESPONSE_SHAPE",
  "READONLY_SEQUENCE", "READONLY_SIZE",
]);
const policyErrors = new WeakMap();
function failure(code) {
  const error = Object.assign(new Error("Readonly device policy rejected the operation."), { code });
  policyErrors.set(error, code);
  return error;
}
function check(condition, code = "READONLY_RESPONSE_SHAPE") { if (!condition) throw failure(code); }
function exactKeys(value, keys) {
  check(object(value) && Object.keys(value).length === keys.length && keys.every(key => owns(value, key)), "READONLY_REQUEST_BODY");
}
function decode(value, maxBytes) {
  check(Buffer.isBuffer(value) || value instanceof Uint8Array || typeof value === "string", "READONLY_ENCODING");
  const bytes = Buffer.from(value);
  check(bytes.length > 0 && bytes.length <= maxBytes, "READONLY_SIZE");
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw failure("READONLY_ENCODING"); }
}
function uniqueKeys(source) {
  // JSON.parse has already validated grammar. Walk its tokens separately because
  // a reviver cannot see an earlier duplicate error field that JSON.parse lost.
  const tokens = source.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:]+/g) || [];
  check(tokens.length <= 100000, "READONLY_SIZE");
  let cursor = 0;
  const visit = depth => {
    check(depth <= 32, "READONLY_SIZE");
    const token = tokens[cursor++];
    if (token === "{") {
      const keys = new Set();
      if (tokens[cursor] === "}") { cursor++; return; }
      while (cursor < tokens.length) {
        const key = JSON.parse(tokens[cursor++]);
        check(!keys.has(key), "READONLY_JSON");
        keys.add(key);
        cursor++; // colon
        visit(depth + 1);
        if (tokens[cursor++] === "}") return;
      }
    } else if (token === "[") {
      if (tokens[cursor] === "]") { cursor++; return; }
      while (cursor < tokens.length) {
        visit(depth + 1);
        if (tokens[cursor++] === "]") return;
      }
    }
  };
  visit(0);
  check(cursor === tokens.length, "READONLY_JSON");
}
function parse(value, maxBytes, requireUniqueKeys = false) {
  let result;
  try {
    const text = decode(value, maxBytes);
    result = JSON.parse(text);
    if (requireUniqueKeys) uniqueKeys(text);
  }
  catch (error) { if (policyErrors.has(error)) throw error; throw failure("READONLY_JSON"); }
  check(object(result));
  return result;
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function references(value, maximum, allowEmpty = false) {
  check(typeof value === "string", "READONLY_REFERENCE");
  if (allowEmpty && value === "") return [];
  const result = value.split(",");
  check(result.length <= maximum && result.every(positiveId) && new Set(result).size === result.length, "READONLY_REFERENCE");
  return result;
}
function rejectErrors(value) {
  // Check errors before interpreting useful-looking data at any response level.
  let nodes = 0;
  const visit = (node, depth) => {
    check(depth <= 32 && ++nodes <= 20000, "READONLY_SIZE");
    if (!node || typeof node !== "object") return;
    if (!Array.isArray(node)) {
      check(!owns(node, "statusCode") || [1, "1"].includes(node.statusCode), "READONLY_DEVICE_ERROR");
      check(!owns(node, "responseStatus") || node.responseStatus === true, "READONLY_DEVICE_ERROR");
      check(!knownError(node.statusString), "READONLY_DEVICE_ERROR");
      check(!owns(node, "ResponseStatus") || object(node.ResponseStatus), "READONLY_DEVICE_ERROR");
    }
    for (const child of Object.values(node)) if (child && typeof child === "object") visit(child, depth + 1);
  };
  visit(value, 0);
}
function xml(text, root) {
  check(!/<!DOCTYPE|<!ENTITY|&|<\s*(?:[\w-]+:)?ResponseStatus\b/i.test(text), "READONLY_DEVICE_ERROR");
  const source = text.replace(/^\s*<\?xml\s[^?]*\?>/, "").trim();
  const stack = [], doors = [];
  let roots = 0, rootName, cursor = 0;
  const tokens = /<[^>]*>/g;
  for (const token of source.matchAll(tokens)) {
    const between = source.slice(cursor, token.index);
    check(!between.includes("<") && (stack.length > 0 || between.trim() === ""));
    const tag = /^<(\/)?([A-Za-z_][\w.:-]*)(\s[^<>]*?)?\s*(\/?)>$/.exec(token[0]);
    check(tag);
    const [, closing, name, rawAttributes = "", selfClosing] = tag;
    if (closing) {
      check(!rawAttributes.trim() && !selfClosing && stack.pop() === name);
    } else {
      if (!stack.length) { roots++; rootName = name.split(":").at(-1); }
      const attributes = new Map();
      let remaining = rawAttributes;
      while (remaining.trim()) {
        const attribute = /^\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(remaining);
        check(attribute && !attributes.has(attribute[1]));
        attributes.set(attribute[1], attribute[2] ?? attribute[3]);
        remaining = remaining.slice(attribute[0].length);
      }
      if (name.split(":").at(-1) === "doorNo") doors.push(attributes);
      if (!selfClosing) stack.push(name);
    }
    cursor = token.index + token[0].length;
  }
  check(roots === 1 && stack.length === 0 && source.slice(cursor).trim() === "" && (root === undefined || rootName === root));
  for (const match of text.matchAll(/<(?:[\w-]+:)?statusCode\b[^>]*>\s*([^<]*)</gi)) check(match[1].trim() === "1", "READONLY_DEVICE_ERROR");
  for (const match of text.matchAll(/<(?:[\w-]+:)?statusString\b[^>]*>\s*([^<]*)</gi)) check(!knownError(match[1].trim()), "READONLY_DEVICE_ERROR");
  check(!/<(?:[\w-]+:)?responseStatus\b[^>]*>\s*(?:false|0)\s*</i.test(text), "READONLY_DEVICE_ERROR");
  return doors;
}

export class FaceReadonlyPolicy {
  #phase = "describe";
  #stage = "device";
  #template;
  #maxRequests;
  #requests = 0;
  #observed = 0;
  #pending;
  #doorRequired = false;
  #pageSize = 1;
  #libraries = new Set();
  #week;
  #groups = [];
  #groupIndex = 0;
  #holidays = [];
  #holidayIndex = 0;
  #holidayReferences = 0;
  #readHolidays = new Set();
  #searchID;
  #total;
  #people = new Set();
  #pagesComplete = false;
  #faces = new Set();

  constructor(options = {}) {
    try {
      check(object(options), "READONLY_CONFIGURATION");
      const { planTemplateNo = "1", maxRequests = 256 } = options;
      check(positiveId(planTemplateNo), "READONLY_CONFIGURATION");
      check(Number.isSafeInteger(maxRequests) && maxRequests > 0 && maxRequests <= 256, "READONLY_CONFIGURATION");
      this.#template = String(planTemplateNo);
      this.#maxRequests = maxRequests;
    } catch { throw failure("READONLY_CONFIGURATION"); }
  }

  #guard(operation) {
    try { return operation(); }
    catch (error) {
      this.#phase = "failed";
      this.#pending = undefined;
      throw failure(policyErrors.get(error) || "READONLY_POLICY");
    }
  }

  #expectedPath() {
    if (owns(paths, this.#stage)) return paths[this.#stage];
    if (this.#stage === "template") return planPath("UserRightPlanTemplate", this.#template);
    if (this.#stage === "week") return planPath("UserRightWeekPlanCfg", this.#week);
    if (this.#stage === "group") return planPath("UserRightHolidayGroupCfg", this.#groups[this.#groupIndex]);
    if (this.#stage === "holiday") return planPath("UserRightHolidayPlanCfg", this.#holidays[this.#holidayIndex]);
    return undefined;
  }

  prepare(request) {
    return this.#guard(() => {
      check(["describe", "list"].includes(this.#phase) && !this.#pending, "READONLY_PHASE");
      check(object(request) && [Object.prototype, null].includes(Object.getPrototypeOf(request)) && Reflect.ownKeys(request).every(key => ["method", "path", "body", "contentType"].includes(key) && owns(Object.getOwnPropertyDescriptor(request, key), "value")), "READONLY_REQUEST");
      const { method, path, body, contentType } = request;
      check(method === "GET" || method === "POST", "READONLY_METHOD");
      check(typeof path === "string" && path.startsWith("/") && !/[\x00-\x20\x7f-\uffff\\#%]/.test(path), "READONLY_PATH");
      let safe, data;
      if (method === "GET") {
        check(body === undefined && contentType === undefined, "READONLY_REQUEST_BODY");
        check(this.#phase === "describe" && path === this.#expectedPath(), "READONLY_PATH");
        safe = Object.freeze({ method: "GET", path });
      } else {
        check(this.#phase === "list", "READONLY_PHASE");
        check(path === paths.people || path === paths.search, "READONLY_PATH");
        check(contentType === "application/json", "READONLY_CONTENT_TYPE");
        data = parse(body, 16384);
        if (path === paths.people) {
          check(!this.#pagesComplete, "READONLY_PAGINATION");
          exactKeys(data, ["UserInfoSearchCond"]);
          const condition = data.UserInfoSearchCond;
          exactKeys(condition, ["searchID", "searchResultPosition", "maxResults"]);
          check(typeof condition.searchID === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(condition.searchID), "READONLY_PAGINATION");
          check(this.#searchID === undefined || condition.searchID === this.#searchID, "READONLY_PAGINATION");
          check(condition.searchResultPosition === this.#people.size && condition.maxResults === this.#pageSize, "READONLY_PAGINATION");
        } else {
          check(this.#pagesComplete, "READONLY_PAGINATION");
          exactKeys(data, ["searchResultPosition", "maxResults", "faceLibType", "FDID", "FPID"]);
          check(data.searchResultPosition === 0 && data.maxResults === 1, "READONLY_REQUEST_BODY");
          check(["blackFD", "infraredFD"].includes(data.faceLibType) && identifier(data.FDID) && this.#libraries.has(`${data.faceLibType}\0${data.FDID}`), "READONLY_LIBRARY");
          check(employee(data.FPID) && this.#people.has(data.FPID), "READONLY_EMPLOYEE");
          check(!this.#faces.has(`${data.faceLibType}\0${data.FDID}\0${data.FPID}`), "READONLY_DUPLICATE");
        }
        safe = Object.freeze({ method: "POST", path, body: Buffer.from(canonical(data), "utf8"), contentType: "application/json" });
      }
      check(this.#requests < this.#maxRequests, "READONLY_BUDGET");
      this.#requests++;
      this.#pending = { prepared: safe, body: safe.body?.toString("utf8"), data };
      return safe;
    });
  }

  observe(prepared, response) {
    return this.#guard(() => {
      check(this.#pending?.prepared === prepared && prepared.body?.toString("utf8") === this.#pending.body, "READONLY_SEQUENCE");
      check(object(response) && Number.isInteger(response.status) && response.status >= 200 && response.status < 300, "READONLY_HTTP");
      check(!response.redirected && response.location === undefined && !Object.entries(response.headers || {}).some(([key]) => key.toLowerCase() === "location"), "READONLY_REDIRECT");
      if (this.#phase === "describe" && ["device", "door"].includes(this.#stage)) {
        const text = decode(response.body, 1048576);
        const doors = xml(text, this.#stage === "device" ? "DeviceInfo" : undefined);
        if (this.#stage === "door") {
          check(doors.length === 1);
          const minimumValue = doors[0].get("min"), maximumValue = doors[0].get("max");
          check(typeof minimumValue === "string" && /^[1-9]\d*$/.test(minimumValue) && typeof maximumValue === "string" && /^[1-9]\d*$/.test(maximumValue));
          const minimum = Number(minimumValue), maximum = Number(maximumValue);
          check(Number.isInteger(minimum) && Number.isInteger(maximum) && minimum >= 1 && maximum >= minimum && maximum <= 65535);
        }
        this.#stage = this.#stage === "device" ? "user" : "capability";
      } else {
        const value = parse(response.body, 1048576, true);
        rejectErrors(value);
        if (this.#phase === "describe") this.#observeDescription(value);
        else if (prepared.path === paths.people) this.#observePeople(value, this.#pending.data.UserInfoSearchCond);
        else this.#observeFace(value, this.#pending.data);
      }
      this.#pending = undefined;
      this.#observed++;
    });
  }

  #afterLibraries() { this.#stage = this.#doorRequired ? "door" : "capability"; }
  #nextGroup() {
    this.#groupIndex++;
    this.#stage = this.#groupIndex < this.#groups.length ? "group" : "ready";
  }
  #observeDescription(value) {
    switch (this.#stage) {
      case "user": {
        check(object(value.UserInfo));
        const user = value.UserInfo;
        const minimum = Number(user.RightPlan?.doorNo?.["@min"]), maximum = Number(user.RightPlan?.doorNo?.["@max"]);
        this.#doorRequired = !Number.isInteger(minimum) || !Number.isInteger(maximum);
        if (!this.#doorRequired) check(minimum >= 1 && maximum >= minimum && maximum <= 65535);
        const maximumPage = Number(user.UserInfoSearchCond?.maxResults?.["@max"]);
        this.#pageSize = Number.isSafeInteger(maximumPage) && maximumPage > 0 ? Math.min(30, maximumPage) : 1;
        this.#stage = "face";
        break;
      }
      case "face": check(object(value.FDLibCap ?? value)); this.#stage = "libraries"; break;
      case "libraries":
      case "count": {
        const found = new Set();
        const visit = node => {
          if (!node || typeof node !== "object") return;
          if (!Array.isArray(node)) {
            const id = node.FDID ?? node.id;
            if (owns(node, "FDID") || owns(node, "id") || owns(node, "faceLibType")) {
              check(["string", "number"].includes(typeof id) && typeof node.faceLibType === "string", "READONLY_LIBRARY");
              const key = `${node.faceLibType}\0${id}`;
              check(!found.has(key), "READONLY_LIBRARY");
              found.add(key);
              check(["blackFD", "infraredFD"].includes(node.faceLibType) && identifier(String(id)), "READONLY_LIBRARY");
              this.#libraries.add(key);
            }
          }
          for (const child of Object.values(node)) if (child && typeof child === "object") visit(child);
        };
        visit(value);
        check(found.size <= 16, "READONLY_LIBRARY");
        if (found.size) this.#afterLibraries();
        else if (this.#stage === "libraries") this.#stage = "count";
        else throw failure("READONLY_LIBRARY");
        break;
      }
      case "capability": {
        const capability = value.UserRightPlanTemplate?.templateNo;
        check(object(capability), "READONLY_REFERENCE");
        let allowed = false, specified = false;
        if (owns(capability, "@min") || owns(capability, "@max")) {
          const minimum = capability["@min"], maximum = capability["@max"];
          check(Number.isSafeInteger(minimum) && Number.isSafeInteger(maximum) && minimum >= 1 && maximum >= minimum, "READONLY_REFERENCE");
          specified = true;
          allowed = Number(this.#template) >= minimum && Number(this.#template) <= maximum;
        }
        if (owns(capability, "@opt")) {
          check(Array.isArray(capability["@opt"]) && capability["@opt"].length <= 256 && capability["@opt"].every(positiveId), "READONLY_REFERENCE");
          specified = true;
          allowed ||= capability["@opt"].map(String).includes(this.#template);
        }
        check(specified && allowed, "READONLY_REFERENCE");
        this.#stage = "template";
        break;
      }
      case "template": {
        const template = value.UserRightPlanTemplate;
        check(object(template) && template.enable === true && typeof template.templateName === "string");
        check(Number.isSafeInteger(template.weekPlanNo) && positiveId(template.weekPlanNo), "READONLY_REFERENCE");
        this.#week = String(template.weekPlanNo);
        this.#groups = references(template.holidayGroupNo, 4, true);
        this.#stage = "week";
        break;
      }
      case "week": check(object(value.UserRightWeekPlanCfg) && value.UserRightWeekPlanCfg.enable === true && Array.isArray(value.UserRightWeekPlanCfg.WeekPlanCfg)); this.#stage = this.#groups.length ? "group" : "ready"; break;
      case "group": {
        const group = value.UserRightHolidayGroupCfg;
        check(object(group) && group.enable === true && typeof group.groupName === "string");
        const ids = references(group.holidayPlanNo, 16);
        this.#holidayReferences += ids.length;
        check(this.#holidayReferences <= 16, "READONLY_REFERENCE");
        this.#holidays = ids.filter(id => !this.#readHolidays.has(id));
        this.#holidayIndex = 0;
        if (this.#holidays.length) this.#stage = "holiday"; else this.#nextGroup();
        break;
      }
      case "holiday":
        check(object(value.UserRightHolidayPlanCfg) && value.UserRightHolidayPlanCfg.enable === true && Array.isArray(value.UserRightHolidayPlanCfg.HolidayPlanCfg));
        this.#readHolidays.add(this.#holidays[this.#holidayIndex++]);
        if (this.#holidayIndex >= this.#holidays.length) this.#nextGroup();
        break;
      default: throw failure("READONLY_PHASE");
    }
  }

  #observePeople(value, condition) {
    const search = value.UserInfoSearch;
    check(object(search), "READONLY_PAGINATION");
    check(!owns(search, "searchID") || search.searchID === condition.searchID, "READONLY_PAGINATION");
    const rows = Array.isArray(search.UserInfo) ? search.UserInfo : search.numOfMatches === 0 && search.UserInfo == null ? [] : null;
    check(rows && Number.isSafeInteger(search.totalMatches) && search.totalMatches >= 0 && search.totalMatches <= 1000 && Number.isSafeInteger(search.numOfMatches) && search.numOfMatches === rows.length && rows.length <= this.#pageSize, "READONLY_PAGINATION");
    check(this.#total === undefined || this.#total === search.totalMatches, "READONLY_PAGINATION");
    check(search.responseStatusStrg === undefined || ["OK", "MORE", "NO MATCH"].includes(search.responseStatusStrg), "READONLY_PAGINATION");
    const ids = rows.map(row => { check(object(row) && employee(row.employeeNo), "READONLY_EMPLOYEE"); return row.employeeNo; });
    check(new Set(ids).size === ids.length && ids.every(id => !this.#people.has(id)), "READONLY_DUPLICATE");
    const count = this.#people.size + ids.length;
    check(count <= search.totalMatches && !(search.responseStatusStrg === "MORE" && count >= search.totalMatches) && !(search.responseStatusStrg === "NO MATCH" && (ids.length || search.totalMatches)) && !(count < search.totalMatches && ids.length === 0), "READONLY_PAGINATION");
    this.#searchID ??= condition.searchID;
    this.#total ??= search.totalMatches;
    for (const id of ids) this.#people.add(id);
    this.#pagesComplete = count === this.#total;
  }

  #observeFace(value, condition) {
    check(value.progress === undefined || value.progress === 100, "READONLY_FACE_UNCONFIRMED");
    check(value.responseStatusStrg === undefined || ["OK", "NO MATCH"].includes(value.responseStatusStrg), "READONLY_FACE_UNCONFIRMED");
    const { numOfMatches: count, totalMatches: total, MatchList: rows } = value;
    check(Number.isSafeInteger(count) && Number.isSafeInteger(total) && count === total && (count === 0 || count === 1), "READONLY_FACE_UNCONFIRMED");
    if (count === 0) check(rows == null || Array.isArray(rows) && rows.length === 0, "READONLY_FACE_UNCONFIRMED");
    else check(Array.isArray(rows) && rows.length === 1 && object(rows[0]) && rows[0].FPID === condition.FPID && ["yes", "no"].includes(rows[0].isInLibrary) && value.responseStatusStrg !== "NO MATCH", "READONLY_FACE_UNCONFIRMED");
    this.#faces.add(`${condition.faceLibType}\0${condition.FDID}\0${condition.FPID}`);
  }

  beginList() {
    return this.#guard(() => {
      check(this.#phase === "describe" && this.#stage === "ready" && !this.#pending, "READONLY_PHASE");
      check(this.#libraries.size > 0, "READONLY_LIBRARY");
      this.#phase = "list";
    });
  }

  finishList() {
    return this.#guard(() => {
      check(this.#phase === "list" && !this.#pending && this.#pagesComplete && this.#people.size === this.#total && this.#faces.size === this.#people.size * this.#libraries.size, "READONLY_INCOMPLETE");
      this.#phase = "done";
    });
  }

  audit() {
    return Object.freeze({ phase: this.#phase, requests: this.#requests, observed: this.#observed, people: this.#people.size, libraries: this.#libraries.size, faceQueries: this.#faces.size });
  }
}
