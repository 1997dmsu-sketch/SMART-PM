import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { LocalStore, CloudStore } from "../lib/store.mjs";
import { Accounts } from "../lib/auth.mjs";
let app, dir, url, admin, viewer, editor;
async function request(
  path,
  { method = "GET", data, auth = admin, origin = url, csrf = true, raw } = {},
) {
  const headers = { Origin: origin };
  if (auth) {
    headers.Cookie = auth.cookie;
    if (csrf) headers["X-CSRF-Token"] = auth.csrf;
  }
  if (!raw) headers["Content-Type"] = "application/json";
  const r = await fetch(url + "/api/" + path, {
    method,
    headers,
    body: raw || (data === undefined ? undefined : JSON.stringify(data)),
  });
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
async function login(username, password) {
  const r = await request("login", {
    method: "POST",
    data: { username, password },
    auth: null,
  });
  assert.equal(r.status, 200);
  return { ...r.data, cookie: r.cookie };
}
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "smartpm-admin-"));
  app = await createApp({ directory: dir });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${app.server.address().port}`;
  const r = await request("demo-login", {
    method: "POST",
    data: {},
    auth: null,
  });
  admin = { ...r.data, cookie: r.cookie };
  for (const role of ["viewer", "editor"])
    await app.accounts.save({
      username: role,
      name: role,
      role,
      password: "test-only-password-123",
      enabled: true,
    });
  viewer = await login("viewer", "test-only-password-123");
  editor = await login("editor", "test-only-password-123");
});
after(async () => {
  await new Promise((r) => app.server.close(r));
  await rm(dir, { recursive: true, force: true });
});
const house = {
  title: "测试房源",
  community: "测试小区",
  address: "101",
  price: 2000,
  area: 50,
  rooms: "1室1厅",
  rentType: "整租",
  status: "下架",
  cover: "",
  description: "测试",
};
test("anonymous clients cannot read protected data", async () => {
  assert.equal((await request("users", { auth: null })).status, 401);
});
test("origin and CSRF are checked before mutations", async () => {
  assert.equal(
    (
      await request("houses", {
        method: "POST",
        data: house,
        origin: "https://attacker.invalid",
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("houses", { method: "POST", data: house, csrf: false }))
      .status,
    403,
  );
});
test("viewer cannot write or upload; editor cannot bind or manage accounts", async () => {
  for (const [path, auth, data] of [
    ["houses", viewer, house],
    ["uploads", viewer, {}],
    [
      "users/demo-user-1/binding",
      editor,
      { action: "bind", houseId: "ROOM-102" },
    ],
    ["accounts", editor, {}],
  ])
    assert.equal(
      (await request(path, { method: "POST", data, auth })).status,
      403,
    );
  assert.equal((await request("audit", { auth: editor })).status, 403);
});
test("house creation, filtering, publishing, auditing and persistence", async () => {
  const created = await request("houses", {
    method: "POST",
    data: { ...house, role: "admin" },
    auth: editor,
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.role, undefined);
  const id = created.data._id;
  assert.equal(
    (
      await request(`houses/${id}`, {
        method: "PUT",
        data: { ...house, status: "在租" },
      })
    ).status,
    200,
  );
  const list = await request("houses?q=测试房源&status=在租");
  assert.equal(list.data.total, 1);
  assert.equal(list.data.rows[0]._id, id);
  const audit = await request("audit?q=" + id);
  assert.equal(audit.data.total, 2);
  const persisted = await new LocalStore(dir).init();
  assert.equal(
    (await persisted.list("houses")).find((h) => h._id === id).status,
    "在租",
  );
});
test("invalid fields, image schemes and missing records fail without writes", async () => {
  const count = (await app.store.list("houses")).length;
  for (const patch of [
    { price: -1 },
    { area: "5" },
    { status: "伪造" },
    { cover: "javascript:alert(1)" },
  ])
    assert.equal(
      (
        await request("houses", {
          method: "POST",
          data: { ...house, ...patch },
        })
      ).status,
      400,
    );
  assert.equal(
    (await request("houses/missing", { method: "PUT", data: house })).status,
    404,
  );
  assert.equal((await app.store.list("houses")).length, count);
});
test("pagination is bounded and search does not interpret regex", async () => {
  assert.equal((await request("houses?pageSize=101")).status, 400);
  const r = await request("houses?page=2&pageSize=5");
  assert.equal(r.data.rows.length, 5);
  assert.equal((await request("houses?q=%5B")).data.total, 0);
});
test("content saves description compatible with miniprogram and draft status", async () => {
  const r = await request("content", {
    method: "POST",
    data: {
      title: "社区活动",
      type: "share",
      description: "活动正文",
      enabled: false,
      sortOrder: 2,
      image: "",
      author: "服务中心",
    },
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.description, "活动正文");
  assert.equal(r.data.enabled, false);
});
test("room ID cannot change and duplicate IDs are rejected", async () => {
  const data = { houseId: "ROOM-101", name: "已有房产", sortOrder: 0 };
  assert.equal((await request("rooms", { method: "POST", data })).status, 409);
  assert.equal(
    (
      await request("rooms/demo-room-1", {
        method: "PUT",
        data: { ...data, houseId: "OTHER" },
      })
    ).status,
    400,
  );
});
test("binding validates room and maintains explicit binding override, without role editing", async () => {
  const path = "users/demo-user-2/binding";
  assert.equal(
    (
      await request(path, {
        method: "POST",
        data: { action: "bind", houseId: "missing" },
      })
    ).status,
    400,
  );
  for (const action of ["bind", "bind", "unbind"]) {
    const r = await request(path, {
      method: "POST",
      data: { action, houseId: "ROOM-101" },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.housesManaged, true);
    assert.equal(r.data.houses.length, action === "unbind" ? 0 : 1);
  }
  const r = await request("users/demo-user-2", {
    method: "PUT",
    data: {
      name: "更新姓名",
      phone: "spoofed",
      role: "admin",
      houses: ["forged"],
    },
  });
  assert.equal(r.data.phone, "演示号码 002");
  assert.equal(r.data.role, undefined);
  assert.equal(r.data.houses.length, 0);
});
test("image upload rejects SVG and accepts PNG with persistent local URL", async () => {
  assert.equal(
    (await request("uploads", { method: "POST", raw: Buffer.from("<svg/>") }))
      .status,
    400,
  );
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvDkAAAAASUVORK5CYII=",
    "base64",
  );
  const r = await request("uploads", { method: "POST", raw: bytes });
  assert.equal(r.status, 200);
  assert.match(r.data.url, /^\/uploads\//);
  assert.deepEqual(
    Buffer.from(await (await fetch(url + r.data.url)).arrayBuffer()),
    bytes,
  );
});
test("account permissions change revokes sessions and never exposes hashes", async () => {
  const account = app.accounts.rows.find((a) => a.username === "viewer");
  const r = await request("accounts", {
    method: "POST",
    data: { ...account, passwordHash: "untrusted", enabled: false },
  }); // ID is explicit, not mass assigned
  assert.equal(r.status, 409);
  const updated = await request("accounts", {
    method: "POST",
    data: {
      id: account._id,
      username: account.username,
      name: "停用成员",
      role: "viewer",
      enabled: false,
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.passwordHash, undefined);
  assert.equal((await request("houses", { auth: viewer })).status, 401);
  const logs = await request("audit");
  assert.ok(logs.data.rows.some((r) => r.action === "更新管理员账号"));
});
test("logout invalidates the session cookie", async () => {
  const a = await login("editor", "test-only-password-123");
  assert.equal(
    (await request("logout", { method: "POST", data: {}, auth: a })).status,
    200,
  );
  assert.equal((await request("me", { auth: a })).status, 401);
});
test("cloud mode fails closed instead of silently using demo storage", async () => {
  await assert.rejects(
    createApp({
      mode: "live",
      directory: dir,
      origin: "https://admin.example.com",
    }),
    /cloud store/,
  );
});
test("cloud store writes business record and audit within the same transaction", async () => {
  const writes = [];
  let txUsed = false;
  const db = {
    runTransaction: async (fn) => {
      txUsed = true;
      return fn({
        collection: (name) => ({
          doc: (id) => ({
            get: async () => ({
              data: [{ _id: id, title: "old", preserve: "yes" }],
            }),
            set: async (data) => writes.push({ name, id, data }),
          }),
        }),
      });
    },
  };
  const store = new CloudStore({ database: () => db });
  const r = await store.change("houses", "id", () => ({ title: "new" }), {
    actor: "admin",
    action: "编辑",
  });
  assert.equal(txUsed, true);
  assert.equal(writes.length, 2);
  assert.equal(r.preserve, "yes");
  assert.equal(writes[1].name, "admin_audit");
  assert.equal(writes[0].data._id, undefined);
});
test("static responses include CSP and do not serve data or secrets", async () => {
  const r = await fetch(url + "/");
  assert.match(
    r.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal((await fetch(url + "/.data/demo/accounts.json")).status, 404);
  assert.equal((await fetch(url + "/server.mjs")).status, 404);
});
test("concurrent room creation cannot create duplicate property identifiers", async () => {
  const data = { houseId: "ROOM-RACE", name: "并发测试房产", sortOrder: 0 };
  const results = await Promise.all(
    [1, 2].map(() => request("rooms", { method: "POST", data })),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
});
test("password changes require old password and revoke previous sessions", async () => {
  await app.accounts.save({
    username: "password_test",
    name: "改密测试",
    role: "viewer",
    password: "old-test-password-123",
    enabled: true,
  });
  const a = await login("password_test", "old-test-password-123");
  assert.equal(
    (
      await request("password", {
        method: "POST",
        auth: a,
        data: { oldPassword: "wrong", newPassword: "new-test-password-123" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("password", {
        method: "POST",
        auth: a,
        data: {
          oldPassword: "old-test-password-123",
          newPassword: "new-test-password-123",
        },
      })
    ).status,
    200,
  );
  assert.equal((await request("me", { auth: a })).status, 401);
  await login("password_test", "new-test-password-123");
});
test("repeated invalid login requests are throttled", async () => {
  for (let i = 0; i < 8; i++)
    assert.equal(
      (
        await request("login", {
          method: "POST",
          auth: null,
          data: { username: "invalid", password: "invalid" },
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await request("login", {
        method: "POST",
        auth: null,
        data: { username: "invalid", password: "invalid" },
      })
    ).status,
    429,
  );
});
