import assert from "node:assert/strict";
import { test, before, beforeEach, afterEach } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, writeFile, mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initializeQishanyuanTestData, qishanyuanTestDirectory } from "../lib/qishanyuan-test-data.mjs";
import { createQishanyuanDemo } from "../qishanyuan-demo.mjs";
import { roomPreview } from "../public/qishanyuan-test.js";

const require = createRequire(import.meta.url);
const guard = require("../../tests/support/d-network-guard.cjs");
let networkBefore;
before(() => guard.assertLoadTimeClean());
beforeEach(() => { networkBefore = guard.snapshot(); });
afterEach(() => guard.assertNoViolations(networkBefore, "qishanyuan isolated data"));

async function root(t) {
  const directory = await mkdtemp(join(tmpdir(), "qsy-data-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function contents(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = {};
  for (const entry of entries) files[entry.name] = entry.isFile() ? await readFile(join(directory, entry.name), "utf8") : "[directory]";
  return files;
}

test("首次只初始化专用242间物业基准，houses为空且金额面积未知", async (t) => {
  const adminDirectory = await root(t);
  const initialized = await initializeQishanyuanTestData({ adminDirectory });
  assert.equal(initialized.created, true);
  assert.equal(initialized.directory, join(adminDirectory, ".data", "qishanyuan-test-v1"));
  assert.equal(qishanyuanTestDirectory(adminDirectory), initialized.directory);
  const rooms = await initialized.store.list("rooms");
  assert.equal(rooms.length, 242);
  assert.equal(rooms.filter((room) => room.listingVisible).length, 232);
  assert.equal(rooms.filter((room) => !room.listingVisible).length, 10);
  assert.ok(rooms.some((room) => room.roomNo === "102" && room.listingVisible === false));
  assert.ok(rooms.every((room) => room.price === null && room.area === null && room.address === null));
  assert.deepEqual(await initialized.store.list("houses"), []);
  assert.equal((await initialized.store.list("property_catalog")).length, 12);
  assert.deepEqual(await readdir(join(adminDirectory, ".data")), ["qishanyuan-test-v1"]);
});

test("合法重启不重复不写文件，允许管理员已改楼名/房名及额外集合", async (t) => {
  const adminDirectory = await root(t);
  const first = await initializeQishanyuanTestData({ adminDirectory });
  const path = join(first.directory, "demo-data.json");
  const edited = JSON.parse(await readFile(path, "utf8"));
  edited.property_catalog.find((row) => row.kind === "building").name = "管理员自定义楼栋";
  edited.rooms[0].name = "管理员维护的房间";
  edited.custom_collection = [{ _id: "keep", value: "不覆盖" }];
  await writeFile(path, JSON.stringify(edited));
  const before = await contents(first.directory);
  const second = await initializeQishanyuanTestData({ adminDirectory });
  const after = await contents(first.directory);
  assert.equal(second.created, false);
  assert.deepEqual(after, before);
  assert.equal((await second.store.list("rooms")).length, 242);
  assert.equal((await second.store.list("rooms"))[0].name, "管理员维护的房间");
  assert.deepEqual(await second.store.list("custom_collection"), edited.custom_collection);
});

test("默认demo/live旧目录不被导入或覆盖", async (t) => {
  const adminDirectory = await root(t);
  for (const mode of ["demo", "live"]) {
    const directory = join(adminDirectory, ".data", mode);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "demo-data.json"), JSON.stringify({ houses: [{ _id: mode }], sentinel: mode }));
  }
  const before = await Promise.all(["demo", "live"].map((mode) => readFile(join(adminDirectory, ".data", mode, "demo-data.json"), "utf8")));
  await initializeQishanyuanTestData({ adminDirectory });
  const after = await Promise.all(["demo", "live"].map((mode) => readFile(join(adminDirectory, ".data", mode, "demo-data.json"), "utf8")));
  assert.deepEqual(after, before);
});

test("并发首建最多一个create-only创建者，拒绝竞争者不会产生重复数据", async (t) => {
  const adminDirectory = await root(t);
  const results = await Promise.allSettled([
    initializeQishanyuanTestData({ adminDirectory }),
    initializeQishanyuanTestData({ adminDirectory }),
  ]);
  const successes = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
  assert.ok(successes.length >= 1);
  assert.equal(successes.filter((result) => result.created).length, 1);
  for (const result of results) {
    if (result.status === "rejected") assert.equal(result.reason.code, "QISHANYUAN_TEST_DATA_CONFLICT");
  }
  const reopened = await initializeQishanyuanTestData({ adminDirectory });
  assert.equal((await reopened.store.list("rooms")).length, 242);
  assert.deepEqual(await reopened.store.list("houses"), []);
});

test("未知/空/半初始化专用目录全部失败关闭且逐场景文件零变化", async (t) => {
  for (const shape of ["empty", "old-data", "data-only", "bad-marker", "bad-data"]) {
    const adminDirectory = await root(t), directory = qishanyuanTestDirectory(adminDirectory);
    if (["bad-marker", "bad-data"].includes(shape)) {
      await initializeQishanyuanTestData({ adminDirectory });
      await writeFile(join(directory, shape === "bad-marker" ? "qishanyuan-test-marker.json" : "demo-data.json"), "{}");
    } else {
      await mkdir(directory, { recursive: true });
      if (shape === "old-data") await writeFile(join(directory, "unknown.txt"), "keep");
      if (shape === "data-only") await writeFile(join(directory, "demo-data.json"), '{"rooms":[{"_id":"legacy"}]}');
    }
    const before = await contents(directory);
    await assert.rejects(initializeQishanyuanTestData({ adminDirectory }), { code: "QISHANYUAN_TEST_DATA_CONFLICT" });
    const after = await contents(directory);
    assert.deepEqual(after, before, shape);
  }
});

test("数据目录不接受符号链接，保留目标内容", async (t) => {
  const adminDirectory = await root(t), outside = await root(t);
  await mkdir(join(adminDirectory, ".data"));
  await writeFile(join(outside, "sentinel.txt"), "outside");
  await symlink(outside, qishanyuanTestDirectory(adminDirectory), process.platform === "win32" ? "junction" : "dir");
  const before = await contents(outside);
  await assert.rejects(initializeQishanyuanTestData({ adminDirectory }), { code: "QISHANYUAN_TEST_DATA_CONFLICT" });
  assert.deepEqual(await contents(outside), before);
});

test("定义式装配传入隔离store，不调用监听；页面未知金额/面积不格式化为零", async (t) => {
  const adminDirectory = await root(t);
  let called = 0, listened = 0;
  const result = await createQishanyuanDemo({ adminDirectory, origin: "http://127.0.0.1:4173", createAppFactory: async (options) => {
    called += 1;
    assert.equal(options.mode, "demo");
    assert.equal(options.directory, qishanyuanTestDirectory(adminDirectory));
    assert.equal((await options.store.list("rooms")).length, 242);
    assert.deepEqual(await options.store.list("houses"), []);
    return { server: { listen() { listened += 1; } }, store: options.store };
  } });
  assert.equal(called, 1);
  assert.equal(listened, 0);
  assert.equal(result.testPreset.created, true);
  assert.deepEqual(roomPreview({ roomNo: "102", floorNumber: 1, listingVisible: false, price: null, area: null, address: null }), {
    roomNo: "102", floor: "1 层", layout: "待配置", visibility: "内部隐藏（不可对外查询）", price: "待配置", area: "待配置", address: "地址待配置",
  });
});
