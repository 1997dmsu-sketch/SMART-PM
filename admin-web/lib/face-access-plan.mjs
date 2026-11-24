import { createHash } from "node:crypto";
import { HttpError } from "./model.mjs";

const base = "/ISAPI/AccessControl";
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const fail = (message) => { throw new HttpError(502, message); };
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const owns = (value, key) => Object.hasOwn(value, key);

function id(value, label) {
  if (!["string", "number"].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail(`${label}不是明确的正整数编号`);
  return String(value);
}

function refs(value, label, maximum, allowNone = false) {
  if (typeof value !== "string") fail(`${label}格式无效`);
  if (value === "" && allowNone) return [];
  const values = value.split(",");
  if (values.length > maximum) fail(`${label}超过允许的引用数量`);
  const result = values.map((value) => id(value, label));
  if (new Set(result).size !== result.length) fail(`${label}含重复编号`);
  return result;
}

function enabled(value, label) {
  if (typeof value !== "boolean") fail(`${label}使能状态不是布尔值`);
  if (!value) fail(`${label}尚未启用`);
}

function optionalBoolean(value, key, label) {
  if (owns(value, key) && typeof value[key] !== "boolean") fail(`${label}的${key}不是布尔值`);
}

function date(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${label}日期格式无效`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`${label}日期无效`);
  return value;
}

function slot(value, label) {
  if (!object(value) || !Number.isInteger(value.id) || value.id < 1 || value.id > 8) fail(`${label}时间段编号无效`);
  if (typeof value.enable !== "boolean") fail(`${label}时间段使能状态不是布尔值`);
  optionalBoolean(value, "authenticationTimesEnabled", label);
  if (owns(value, "authenticationTimes") && (!Number.isInteger(value.authenticationTimes) || value.authenticationTimes < 0 || value.authenticationTimes > 255)) fail(`${label}认证次数无效`);
  if (!object(value.TimeSegment)) fail(`${label}缺少时间段`);
  const { beginTime, endTime } = value.TimeSegment;
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
  if (typeof beginTime !== "string" || typeof endTime !== "string" || !time.test(beginTime) || !time.test(endTime)) fail(`${label}时间段格式或全天端点尚未确认`);
  if (value.authenticationTimesEnabled === true) fail(`${label}启用了认证次数限制`);
  if (!value.enable) return false;
  // This is the all-day representation observed on this device. Other ISAPI
  // resources accepting 24:00:00 do not establish support on this resource.
  if (beginTime !== "00:00:00" || endTime !== "23:59:59") fail(`${label}存在非全天的有效时间段`);
  return true;
}

function week(config) {
  enabled(config.enable, "周计划");
  if (!Array.isArray(config.WeekPlanCfg) || config.WeekPlanCfg.length < 1 || config.WeekPlanCfg.length > 56) fail("周计划时间段数量无效");
  const covered = new Set(), slots = new Set();
  for (const value of config.WeekPlanCfg) {
    if (!object(value) || !days.includes(value.week)) fail("周计划包含未知星期");
    const active = slot(value, `${value.week}周计划`);
    const key = `${value.week}/${value.id}`;
    if (slots.has(key)) fail("周计划含重复的星期时间段");
    slots.add(key);
    if (active) covered.add(value.week);
  }
  if (days.some((day) => !covered.has(day))) fail("周计划没有覆盖全部七天全天");
}

function holiday(config) {
  enabled(config.enable, "假日计划");
  optionalBoolean(config, "cycleByYear", "假日计划");
  if (date(config.beginDate, "假日开始") > date(config.endDate, "假日结束")) fail("假日计划日期顺序无效");
  if (!Array.isArray(config.HolidayPlanCfg) || config.HolidayPlanCfg.length < 1 || config.HolidayPlanCfg.length > 8) fail("假日计划时间段数量无效");
  const slots = new Set();
  let covered = false;
  for (const value of config.HolidayPlanCfg) {
    const active = slot(value, "假日计划");
    if (slots.has(value.id)) fail("假日计划含重复时间段");
    slots.add(value.id);
    covered ||= active;
  }
  if (!covered) fail("假日计划没有全天有效时间段");
}

function stable(value) {
  if (value === null || ["boolean", "string"].includes(typeof value) || (typeof value === "number" && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  fail("计划配置包含无效JSON值");
}

function allowedTemplate(config, templateNo) {
  const capability = config.templateNo;
  if (!object(capability)) fail("设备未返回明确的模板编号能力");
  let allowed = false, specified = false;
  if (owns(capability, "@min") || owns(capability, "@max")) {
    const minimum = capability["@min"], maximum = capability["@max"];
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum < 1 || maximum < minimum) fail("设备模板编号能力范围无效");
    specified = true;
    allowed = Number(templateNo) >= minimum && Number(templateNo) <= maximum;
  }
  if (owns(capability, "@opt")) {
    if (!Array.isArray(capability["@opt"])) fail("设备模板编号选项格式无效");
    specified = true;
    allowed ||= capability["@opt"].map((value) => id(value, "设备模板选项")).includes(templateNo);
  }
  if (!specified || !allowed) fail("指定模板编号不在设备能力范围内");
}

/** Read and prove a reusable all-day plan without changing device state. */
export async function loadAllDayPlan(readJson, templateNo = "1") {
  if (typeof readJson !== "function") fail("未提供计划读取器");
  const selected = id(templateNo, "计划模板");
  const configurations = [];
  const read = async (resource, number, root) => {
    const path = `${base}/${resource}/${number}?format=json`;
    const response = await readJson(path);
    if (!object(response) || (response.statusCode !== undefined && ![1, "1"].includes(response.statusCode)) || !object(response[root])) fail("设备未返回有效的权限计划配置");
    const config = response[root];
    // Preserve the complete configuration, including disabled slots and fields
    // not used by the proof, so changes cannot silently reuse an old proof.
    configurations.push({ path, configuration: structuredClone(config) });
    return config;
  };
  allowedTemplate(await read("UserRightPlanTemplate", "capabilities", "UserRightPlanTemplate"), selected);
  const template = await read("UserRightPlanTemplate", selected, "UserRightPlanTemplate");
  enabled(template.enable, "人员权限模板");
  if (typeof template.templateName !== "string") fail("人员权限模板名称格式无效");
  if (!Number.isSafeInteger(template.weekPlanNo)) fail("模板周计划编号无效");
  const weekNo = id(template.weekPlanNo, "模板周计划");
  // Only the entire empty field is the documented no-holiday association.
  // Empty tokens, zero sentinels and empty enabled holiday groups are rejected.
  const groupNos = refs(template.holidayGroupNo, "模板假日组", 4, true);
  week(await read("UserRightWeekPlanCfg", weekNo, "UserRightWeekPlanCfg"));
  const plans = new Set();
  let references = 0;
  for (const groupNo of groupNos) {
    const group = await read("UserRightHolidayGroupCfg", groupNo, "UserRightHolidayGroupCfg");
    enabled(group.enable, "假日组");
    if (typeof group.groupName !== "string") fail("假日组名称格式无效");
    const planNos = refs(group.holidayPlanNo, "假日组计划", 16);
    references += planNos.length;
    if (references > 16) fail("假日计划总引用数量超过16");
    for (const planNo of planNos) {
      if (plans.has(planNo)) continue;
      plans.add(planNo);
      // Past dates still participate: a plan may recur or be changed later.
      holiday(await read("UserRightHolidayPlanCfg", planNo, "UserRightHolidayPlanCfg"));
    }
  }
  return {
    templateNo: selected,
    fingerprint: createHash("sha256").update(stable(configurations)).digest("hex"),
    name: "每天24小时",
    weekPlanNo: template.weekPlanNo,
    holidayGroupNos: groupNos,
  };
}
