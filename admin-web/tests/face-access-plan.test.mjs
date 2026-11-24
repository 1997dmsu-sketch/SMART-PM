import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAllDayPlan } from "../lib/face-access-plan.mjs";

// All responses are synthetic JSON objects. No device, credentials or photos.
const base = "/ISAPI/AccessControl";
const path = (resource, number) => `${base}/${resource}/${number}?format=json`;
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const fullSlot = (extra = {}) => ({ id: 1, enable: true, TimeSegment: { beginTime: "00:00:00", endTime: "23:59:59" }, ...extra });
function fixture() {
  const responses = {
    [path("UserRightPlanTemplate", "capabilities")]: { UserRightPlanTemplate: { templateNo: { "@min": 1, "@max": 128 } } },
    [path("UserRightPlanTemplate", 1)]: { UserRightPlanTemplate: { enable: true, templateName: "合成全天模板", weekPlanNo: 1, holidayGroupNo: "32" } },
    [path("UserRightWeekPlanCfg", 1)]: { UserRightWeekPlanCfg: { enable: true, WeekPlanCfg: days.flatMap((week) => [fullSlot({ week }), { week, id: 2, enable: false, TimeSegment: { beginTime: "00:00:00", endTime: "00:00:00" } }]) } },
    [path("UserRightHolidayGroupCfg", 32)]: { UserRightHolidayGroupCfg: { enable: true, groupName: "合成假日组", holidayPlanNo: "128" } },
    [path("UserRightHolidayPlanCfg", 128)]: { UserRightHolidayPlanCfg: { enable: true, beginDate: "2000-01-01", endDate: "2000-01-01", HolidayPlanCfg: [fullSlot()] } },
  };
  const calls = [];
  return {
    responses, calls,
    read: async (requestPath) => { calls.push(requestPath); assert(Object.hasOwn(responses, requestPath), `Unexpected read: ${requestPath}`); return structuredClone(responses[requestPath]); },
    template: responses[path("UserRightPlanTemplate", 1)].UserRightPlanTemplate,
    week: responses[path("UserRightWeekPlanCfg", 1)].UserRightWeekPlanCfg,
    group: responses[path("UserRightHolidayGroupCfg", 32)].UserRightHolidayGroupCfg,
    holiday: responses[path("UserRightHolidayPlanCfg", 128)].UserRightHolidayPlanCfg,
  };
}
const rejected = async (value, expression) => assert.rejects(loadAllDayPlan(value.read), (error) => error.status === 502 && (!expression || expression.test(error.message)));

test("proves seven full days and referenced holidays using only bounded reads", async () => {
  const value = fixture();
  const result = await loadAllDayPlan(value.read);
  assert.deepEqual({ ...result, fingerprint: "hash" }, { templateNo: "1", fingerprint: "hash", name: "每天24小时", weekPlanNo: 1, holidayGroupNos: ["32"] });
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(value.calls, Object.keys(value.responses));
});

test("validates the candidate ID against capability before reading a template", async () => {
  const value = fixture();
  await assert.rejects(loadAllDayPlan(value.read, "129"), /能力范围/);
  assert.deepEqual(value.calls, [path("UserRightPlanTemplate", "capabilities")]);
  for (const candidate of [0, "0", "", "1/2", null, true]) await assert.rejects(loadAllDayPlan(value.read, candidate), /正整数编号/);
});

test("a documented empty holiday association needs no holiday reads", async () => {
  const value = fixture();
  value.template.holidayGroupNo = "";
  const result = await loadAllDayPlan(value.read, 1);
  assert.deepEqual(result.holidayGroupNos, []);
  assert.equal(value.calls.length, 3);
});

for (const [label, mutate] of [
  ["a missing weekday", (value) => { value.week.WeekPlanCfg = value.week.WeekPlanCfg.filter((slot) => slot.week !== "Sunday"); }],
  ["an empty week", (value) => { value.week.WeekPlanCfg = []; }],
  ["a disabled only weekday", (value) => { value.week.WeekPlanCfg.find((slot) => slot.week === "Sunday").enable = false; }],
  ["a partial active weekday", (value) => { value.week.WeekPlanCfg[0].TimeSegment.endTime = "12:00:00"; }],
  ["an unsupported 24:00 endpoint", (value) => { value.week.WeekPlanCfg[0].TimeSegment.endTime = "24:00:00"; }],
  ["a week authentication limit", (value) => { value.week.WeekPlanCfg[0].authenticationTimesEnabled = true; value.week.WeekPlanCfg[0].authenticationTimes = 10; }],
  ["a configured count limit on a disabled slot", (value) => { value.week.WeekPlanCfg[1].authenticationTimesEnabled = true; }],
  ["a past holiday restriction", (value) => { value.holiday.HolidayPlanCfg[0].TimeSegment.beginTime = "08:00:00"; }],
  ["an empty holiday", (value) => { value.holiday.HolidayPlanCfg = []; }],
  ["a holiday authentication limit", (value) => { value.holiday.HolidayPlanCfg[0].authenticationTimesEnabled = true; }],
  ["a disabled template", (value) => { value.template.enable = false; }],
  ["a disabled week", (value) => { value.week.enable = false; }],
  ["a disabled referenced group", (value) => { value.group.enable = false; }],
  ["a disabled referenced holiday", (value) => { value.holiday.enable = false; }],
  ["a numeric template bool", (value) => { value.template.enable = 1; }],
  ["a string slot bool", (value) => { value.week.WeekPlanCfg[1].enable = "false"; }],
  ["a string count-limit bool", (value) => { value.holiday.HolidayPlanCfg[0].authenticationTimesEnabled = "false"; }],
  ["a string recurrence bool", (value) => { value.holiday.cycleByYear = "false"; }],
  ["an invalid holiday date", (value) => { value.holiday.beginDate = "2000-02-30"; }],
  ["a zero week reference", (value) => { value.template.weekPlanNo = 0; }],
  ["a zero group reference", (value) => { value.template.holidayGroupNo = "0"; }],
  ["an embedded empty group reference", (value) => { value.template.holidayGroupNo = "32,"; }],
  ["an empty enabled group", (value) => { value.group.holidayPlanNo = ""; }],
  ["a zero holiday reference", (value) => { value.group.holidayPlanNo = "0"; }],
  ["duplicate group references", (value) => { value.template.holidayGroupNo = "32,32"; }],
]) test(`rejects ${label} instead of declaring it all-day`, async () => {
  const value = fixture();
  mutate(value);
  await rejected(value);
});

test("checks every referenced group and holiday instead of only the first", async () => {
  const value = fixture();
  value.template.holidayGroupNo = "32,33";
  value.responses[path("UserRightHolidayGroupCfg", 33)] = { UserRightHolidayGroupCfg: { enable: true, groupName: "合成第二组", holidayPlanNo: "127" } };
  value.responses[path("UserRightHolidayPlanCfg", 127)] = { UserRightHolidayPlanCfg: { enable: true, beginDate: "2000-01-01", endDate: "2000-01-01", HolidayPlanCfg: [fullSlot({ TimeSegment: { beginTime: "08:00:00", endTime: "17:00:00" } })] } };
  await rejected(value, /非全天/);
  assert(value.calls.includes(path("UserRightHolidayGroupCfg", 33)));
  assert(value.calls.includes(path("UserRightHolidayPlanCfg", 127)));
});

test("bounds group and total holiday references without scanning", async () => {
  const tooManyGroups = fixture();
  tooManyGroups.template.holidayGroupNo = "1,2,3,4,5";
  await rejected(tooManyGroups, /引用数量/);
  assert.equal(tooManyGroups.calls.length, 2);

  const value = fixture();
  value.template.holidayGroupNo = "32,33";
  value.group.holidayPlanNo = Array.from({ length: 16 }, (_, index) => String(index + 1)).join(",");
  for (let number = 1; number <= 16; number++) value.responses[path("UserRightHolidayPlanCfg", number)] = { UserRightHolidayPlanCfg: structuredClone(value.holiday) };
  value.responses[path("UserRightHolidayGroupCfg", 33)] = { UserRightHolidayGroupCfg: { enable: true, groupName: "合成第二组", holidayPlanNo: "128" } };
  await rejected(value, /总引用数量/);
  assert(!value.calls.includes(path("UserRightHolidayPlanCfg", 128)));
  assert.equal(value.calls.filter((entry) => entry.includes("/UserRightHolidayPlanCfg/")).length, 16);
});

test("fingerprint includes disabled slots, dates, names and optional configuration", async () => {
  const original = await loadAllDayPlan(fixture().read);
  for (const mutate of [
    (value) => { value.template.templateName = "合成重命名"; },
    (value) => { value.week.WeekPlanCfg[1].TimeSegment.endTime = "01:00:00"; },
    (value) => { value.holiday.beginDate = "1999-12-31"; },
    (value) => { value.holiday.extraConfig = { reviewed: true }; },
    (value) => { value.responses[path("UserRightPlanTemplate", "capabilities")].UserRightPlanTemplate.templateNo["@max"] = 127; },
  ]) {
    const value = fixture(); mutate(value);
    assert.notEqual((await loadAllDayPlan(value.read)).fingerprint, original.fingerprint);
  }
});

test("fingerprint is stable when every JSON object's keys use a different insertion order", async () => {
  const reverseKeys = (value) => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverseKeys(value[key])])) : value;
  const value = fixture();
  const first = await loadAllDayPlan(value.read);
  const second = await loadAllDayPlan(async (requestPath) => reverseKeys(value.responses[requestPath]));
  assert.equal(first.fingerprint, second.fingerprint);
});
