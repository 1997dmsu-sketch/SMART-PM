const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const { mkdtemp, rm, mkdir } = require("node:fs/promises");
  const { tmpdir } = require("node:os");
  const path = require("node:path");
  const { createApp } = await import("../server.mjs");
  const dir = await mkdtemp(path.join(tmpdir(), "admin-browser-"));
  const app = await createApp({ directory: dir });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port;
  const output = path.resolve(__dirname, "../test-results");
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("button", { name: "进入演示工作台" }).click();
  await page.getByRole("heading", { name: "最近维护的房源" }).waitFor();
  await page.screenshot({
    path: path.join(output, "dashboard.png"),
    fullPage: true,
  });
  await page.locator('[data-nav="houses"]').click();
  await page.getByRole("button", { name: "新增房源" }).click();
  await page.locator('[name="title"]').fill("浏览器验证 · 阳光两居");
  await page.locator('[name="community"]').fill("测试社区");
  await page.locator('[name="price"]').fill("3200");
  await page.locator('[name="area"]').fill("85");
  await page
    .locator("#upload")
    .setInputFiles(path.resolve(__dirname, "../public/assets/room-1.jpg"));
  await page.getByText("上传完成，保存后生效", { exact: true }).waitFor();
  await page.getByRole("button", { name: "保存更改" }).click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.locator('[name="q"]').fill("浏览器验证");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByText("浏览器验证 · 阳光两居", { exact: true }).waitFor();
  await page.getByRole("button", { name: "上架", exact: true }).click();
  await page.getByRole("button", { name: "确认操作" }).click();
  await page.getByText("• 在租", { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(output, "houses.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.screenshot({
    path: path.join(output, "editor.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.locator('[data-nav="content"]').click();
  await page.getByRole("button", { name: "新增内容" }).click();
  await page.locator('[name="title"]').fill("浏览器验证内容");
  await page
    .locator('[name="description"]')
    .fill("这是正文，应保持安全文本 <script>bad()</script>");
  await page.getByRole("button", { name: "保存更改" }).click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "预览", exact: true }).first().click();
  await page.getByRole("heading", { name: "内容预览" }).waitFor();
  await page.getByRole("button", { name: "关闭预览" }).click();
  await page.locator('[data-nav="users"]').click();
  await page.getByRole("button", { name: "维护绑定" }).nth(1).click();
  await page.locator('[name="houseId"]').selectOption("ROOM-101");
  await page.getByRole("button", { name: "确认绑定", exact: true }).click();
  await page.getByRole("button", { name: "确认操作" }).click();
  await page.getByRole("button", { name: "解绑", exact: true }).waitFor();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.locator('[data-nav="accounts"]').click();
  await page.getByRole("button", { name: "新增管理员" }).click();
  await page.locator('[name="name"]').fill("浏览器只读账号");
  await page.locator('[name="username"]').fill("browser_viewer");
  await page.locator('[name="password"]').fill("local-test-only-12345");
  await page.getByRole("button", { name: "保存账号" }).click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.locator('[data-nav="rooms"]').click();
  await page.locator("#new-community").click();
  await page.locator('#property-form [name="name"]').fill("星河公寓");
  await page.locator('[form="property-form"]').click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.locator("#new-building").click();
  await page.locator('[name="parentId"]').selectOption({ label: "星河公寓" });
  await page.locator('#property-form [name="name"]').fill("1栋");
  await page.locator('[form="property-form"]').click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.locator("#new-floor").click();
  await page.locator("#manual-fill").click();
  await page
    .locator('[name="parentId"]')
    .selectOption({ label: "星河公寓 / 1栋" });
  await page.locator('#property-form [name="name"]').fill("1层");
  await page.locator('[name="level"]').fill("1");
  await page.locator('[form="property-form"]').click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.locator("#layouts").click();
  await page.locator("#add-layout").click();
  await page
    .locator('[name="parentId"]')
    .selectOption({ label: "星河公寓 / 1栋" });
  await page.locator('#property-form [name="name"]').fill("一房一厅");
  await page.locator('[name="code"]').fill("A1");
  await page.locator('[form="property-form"]').click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.locator("#new-rooms").click();
  await page.locator("#manual-fill").click();
  await page
    .locator('[name="floorId"]')
    .selectOption({ label: "星河公寓 / 1栋 / 1层" });
  await page.locator('[name="numbers"]').fill("101-103");
  await page.locator('[form="property-form"]').click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.locator("#property-community").selectOption({ label: "星河公寓" });
  await page.locator("#property-building").selectOption({ label: "1栋" });
  await page.locator("#select-page").check();
  await page.locator("#batch-layout").click();
  await page
    .locator('[name="layoutId"]')
    .selectOption({ label: "A1 · 一房一厅（1室1厅）" });
  await page.locator('[form="property-form"]').click();
  await page.getByRole("button", { name: "确认操作" }).click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page
    .getByRole("cell", { name: "一房一厅", exact: true })
    .first()
    .waitFor();
  assert.equal(
    await page.getByRole("cell", { name: "A1", exact: true }).count(),
    3,
  );
  await page.screenshot({
    path: path.join(output, "property.png"),
    fullPage: true,
  });
  await page.locator('[data-nav="houses"]').click();
  await page.getByRole("button", { name: "新增房源" }).click();
  await page.locator('[name="propertyRoomId"]').selectOption({ index: 1 });
  assert.equal(await page.locator('[name="rooms"]').inputValue(), "1室1厅");
  assert.equal(
    await page.locator('[name="community"]').inputValue(),
    "星河公寓",
  );
  await page.locator('[name="title"]').fill("已关联的公寓房源");
  await page.locator('[name="price"]').fill("2100");
  await page.locator('[name="area"]').fill("40");
  await page.getByRole("button", { name: "保存更改" }).click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.locator('[data-nav="rooms"]').click();
  await page.locator("#new-floor").click();
  await page.locator('#auto-form [name="end"]').fill("3");
  await page
    .getByText("将新增 2 层，跳过已存在 1 层", { exact: true })
    .waitFor();
  await page.locator("#auto-save").click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.locator("#new-rooms").click();
  await page.locator('#auto-form [name="start"]').fill("2");
  await page.locator('#auto-form [name="end"]').fill("3");
  await page.locator('#auto-form [name="count"]').fill("2");
  await page.locator(".auto-advanced summary").click();
  await page.locator('#auto-form [name="skip"]').fill("202");
  await page.locator(".auto-advanced summary").click();
  await page
    .getByText("将新增 3 间，跳过已存在 0 间", { exact: true })
    .waitFor();
  await page.screenshot({
    path: path.join(output, "auto-fill.png"),
    fullPage: true,
  });
  await page.locator("#auto-save").click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page.getByRole("cell", { name: "3层", exact: false }).first().waitFor();
  for (const width of [1024, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('[data-nav="dashboard"]').click();
    await page.getByRole("heading", { name: "最近维护的房源" }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `overflow at ${width}`,
    );
  }
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.locator('[name="username"]').fill("browser_viewer");
  await page.locator('[name="password"]').fill("local-test-only-12345");
  await page.getByRole("button", { name: "登录工作台", exact: false }).click();
  await page.locator('[data-nav="houses"]').click();
  await page
    .getByRole("button", { name: "查看", exact: true })
    .first()
    .waitFor();
  assert.equal(await page.getByRole("button", { name: "新增房源" }).count(), 0);
  assert.equal(await page.locator('[data-nav="accounts"]').count(), 0);
  await page.locator('[data-nav="rooms"]').click();
  await page.getByRole("heading", { name: "整栋物业 · 房源管理" }).waitFor();
  assert.equal(await page.locator("#new-rooms").count(), 0);
  assert.equal(await page.locator("#batch-layout").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: existing workflows plus community/building/floor/layout creation, batch rooms, batch layout, linked listing and read-only permissions; 1024/1280/1920 widths; no JS errors",
  );
  await browser.close();
  await new Promise((r) => app.server.close(r));
  await rm(dir, { recursive: true, force: true });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
