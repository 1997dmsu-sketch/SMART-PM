// The guard installs itself on load, before any subject module is read or run.
const guard = require("./rental-network-guard.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createRequire } = require("node:module");
// The cloud handler source and its dependency graph are only loaded inside the
// tests, after the guard is installed (never at module evaluation time).
function cloudHandler(user, context = { OPENID: "openid" }) {
  const indexFile = require.resolve("../cloudfunctions/leasing/index.js");
  const leasingSource = fs.readFileSync(indexFile, "utf8");
  const exports = {};
  const sdk = {
    DYNAMIC_CURRENT_ENV: "test",
    init() {},
    getWXContext: () => context,
    database: () => ({
      collection: () => ({
        where: () => ({
          limit: () => ({ get: async () => ({ data: user ? [user] : [] }) }),
        }),
      }),
    }),
  };
  const requireFn = createRequire(indexFile);
  vm.runInNewContext(leasingSource, {
    require: (n) => (n === "wx-server-sdk" ? sdk : requireFn(n)),
    exports,
    process: { env: {} },
    Buffer,
  });
  return exports.main;
}
test("cloud leasing derives actor from OPENID and rejects forged admin/payment actions", async () => {
  const guest = cloudHandler(null, {});
  guard.assertNoLoadTimeViolation();
  assert.equal(guard.loadViolationCount(), 0);
  assert.equal((await guest({ action: "mine" })).code, 401);
  const main = cloudHandler({ _id: "u1", phone: "13800000000", role: "admin" });
  assert.equal(
    (await main({ action: "adminList", actor: { type: "admin" } })).code,
    403,
  );
  assert.equal(
    (
      await main({
        action: "applyPayment",
        input: { trade_state: "SUCCESS", depositCents: 1 },
      })
    ).code,
    400,
  );
  assert.equal(
    (await main({ httpMethod: "POST", body: "{}", headers: {} })).statusCode,
    500,
  );
  assert.equal(
    (await main({ Type: "Timer" })).code,
    400,
    "client cannot impersonate timer",
  );
  assert.equal(guard.runtimeViolationCount(), 0);
});
function page(api) {
  const file = path.resolve(__dirname, "../miniprogram/pages/leasing/index.js");
  let definition;
  vm.runInNewContext(fs.readFileSync(file, "utf8"), {
    require: (n) =>
      n.includes("services/api") ? api : { getNavigationLayout: () => ({}) },
    Page: (d) => (definition = d),
    wx: { showToast() {}, navigateBack() {} },
    Date,
    console,
  });
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(p) {
      Object.assign(this.data, p);
    },
  };
}
test("leasing page groups layouts before room selection and submits the selected authoritative IDs", async () => {
  const calls = [];
  const api = {
    getProfile: async () => ({ authenticated: true, name: "租客" }),
    leasing: async (action, input) => {
      calls.push({ action, input });
      if (action === "catalog")
        return {
          rooms: [
            {
              houseId: "h1",
              roomId: "r1",
              roomNumber: "101",
              layoutId: "l1",
              layoutName: "一室",
              priceCents: 100000,
              available: true,
            },
            {
              houseId: "h2",
              roomId: "r2",
              roomNumber: "201",
              layoutId: "l2",
              layoutName: "两室",
              priceCents: 200000,
              available: true,
            },
          ],
          settings: {},
          paymentReady: false,
        };
      if (action === "mine") return { appointments: [], orders: [] };
      return { id: "appointment" };
    },
  };
  const p = page(api);
  p.houseId = "h1";
  p.appointmentRequestId = "request";
  await p.load();
  assert.equal(p.data.layouts.length, 2);
  p.layoutChanged({ detail: { value: "1" } });
  assert.equal(p.data.roomOptions[0].roomId, "r2");
  p.setData({
    contactName: "租客",
    visitDate: "2099-01-01",
    visitTime: "12:00",
  });
  await p.submitAppointment();
  const call = calls.find((c) => c.action === "appointment");
  assert.equal(call.input.roomId, "r2");
  assert.equal(call.input.houseId, "h2");
  assert.equal(call.input.requestId, "request");
  assert.equal("depositCents" in call.input, false);
});
test("client never marks an order paid from a requestPayment result; confirmation uses the server", async () => {
  const events = [];
  const file = path.resolve(__dirname, "../miniprogram/pages/leasing/index.js");
  let def;
  vm.runInNewContext(fs.readFileSync(file, "utf8"), {
    require: (n) =>
      n.includes("services/api")
        ? {
            leasing: async (action) => {
              events.push(action);
              if (action === "paymentParams")
                return { package: "prepay_id=test" };
            },
          }
        : {},
    Page: (d) => (def = d),
    wx: {
      requestPayment: (args) => {
        events.push("requestPayment");
        args.success({});
      },
    },
    Date,
  });
  const p = {
    ...def,
    data: { busy: false },
    setData(p) {
      Object.assign(this.data, p);
    },
    load: async () => events.push("reload"),
  };
  await p.pay({ currentTarget: { dataset: { id: "order" } } });
  assert.deepEqual(events, [
    "paymentParams",
    "requestPayment",
    "refreshPayment",
    "reload",
  ]);
});
