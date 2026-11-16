import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  randomBytes,
  generateKeyPairSync,
  createSign,
  createCipheriv,
} from "node:crypto";
import { LocalStore } from "../lib/store.mjs";
import domain from "../../cloudfunctions/leasing/domain.js";
import payModule from "../../cloudfunctions/leasing/wechat-pay.js";
const { LeasingService, C } = domain;
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=";
const template =
  "{{tenantName}} 预签约 {{roomLabel}}，月租 {{monthlyRent}}，押金 {{deposit}}，留房 {{holdHours}} 小时。{{expiryPolicy}}。预约 {{appointmentId}}";
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "smartpm-leasing-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await new LocalStore(dir).init();
  let now = Date.now();
  const key = randomBytes(32).toString("base64"),
    actor = {
      id: "tenant",
      type: "user",
      phone: "13800000000",
      openid: "wx-tenant",
    };
  const payment = {
    appid: "wx-test",
    mchid: "merchant",
    create: async () => ({ package: "prepay_id=test" }),
    query: async () => ({ trade_state: "NOTPAY" }),
  };
  const user = new LeasingService({
    store,
    actor,
    payment,
    identityKey: key,
    now: () => now,
  });
  const admin = new LeasingService({
    store,
    actor: { id: "staff", type: "admin" },
    payment,
    identityKey: key,
    now: () => now,
  });
  await store.transact(
    [
      { collection: "houses", id: "listing" },
      { collection: "rooms", id: "room" },
      { collection: "property_catalog", id: "layout" },
    ],
    () => [
      {
        collection: "houses",
        id: "listing",
        data: {
          propertyRoomId: "room",
          price: 2600,
          status: "在租",
          isPublic: false,
        },
      },
      {
        collection: "rooms",
        id: "room",
        data: {
          number: "101",
          buildingId: "building",
          layoutId: "layout",
          community: "小区",
          buildingName: "1栋",
          isPublic: false,
        },
      },
      {
        collection: "property_catalog",
        id: "layout",
        data: {
          kind: "layout",
          name: "两室一厅",
          parentId: "building",
          isPublic: false,
        },
      },
    ],
    { action: "fixture" },
  );
  await admin.saveSettings({
    revision: 0,
    depositMonths: 2,
    fixedDepositCents: 10000,
    holdHours: 72,
    expiryPolicy: "non_refundable",
    privacyText: "仅用于租赁核验，加密保存30天；联系物业申请删除。",
    templateText: template,
    enabled: true,
  });
  const appointment = async (requestId = "appointment") =>
    user.appointment({
      roomId: "room",
      houseId: "listing",
      requestId,
      name: "测试租客",
      visitAt: now + 3600000,
    });
  const prepared = async () => {
    let a = await appointment();
    await user.uploadIdentity({
      appointmentId: a.id,
      side: "front",
      base64: png,
      consent: true,
      privacyVersion: 1,
    });
    await user.uploadIdentity({
      appointmentId: a.id,
      side: "back",
      base64: png,
      consent: true,
      privacyVersion: 1,
    });
    a = (await user.mine()).appointments[0];
    await admin.reviewAppointment({
      id: a.id,
      revision: a.revision,
      decision: "confirmed",
    });
    a = (await user.mine()).appointments[0];
    await admin.reviewAppointment({
      id: a.id,
      revision: a.revision,
      decision: "identity_approved",
    });
    return (await user.mine()).appointments[0];
  };
  const order = async (a, requestId = "order") => {
    const q = await user.quote(a.id);
    return user.createOrder({
      appointmentId: a.id,
      quoteHash: q.quoteHash,
      accepted: true,
      requestId,
    });
  };
  const paid = (o, patch = {}) => ({
    trade_state: "SUCCESS",
    appid: payment.appid,
    mchid: payment.mchid,
    out_trade_no: o.id.replace("lease-", "L").slice(0, 32),
    amount: { total: o.depositCents, currency: "CNY" },
    payer: { openid: actor.openid },
    transaction_id: "wx-transaction",
    success_time: new Date(now).toISOString(),
    ...patch,
  });
  return {
    user,
    admin,
    store,
    payment,
    actor,
    key,
    appointment,
    prepared,
    order,
    paid,
    now: () => now,
    advance: (n) => {
      now += n;
    },
  };
}
test("catalog selects published room/layout pairs and revalidates public-room status", async (t) => {
  const x = await setup(t);
  let catalog = await x.user.catalog("listing");
  assert.equal(catalog.rooms.length, 1);
  assert.equal(catalog.rooms[0].roomNumber, "101");
  x.store.data.property_catalog.find((r) => r._id === "layout").isPublic = true;
  assert.equal((await x.user.catalog("listing")).rooms.length, 0);
  const before = structuredClone(x.store.data);
  await assert.rejects(x.appointment(), /房源或户型/);
  assert.deepEqual(x.store.data, before);
});
test("appointment persists, is idempotent and is visible only to its owner/admin", async (t) => {
  const x = await setup(t);
  const first = await x.appointment();
  assert.equal(first.status, "submitted");
  assert.equal((await x.appointment()).id, first.id);
  const stranger = new LeasingService({
    store: x.store,
    actor: { ...x.actor, id: "other" },
    identityKey: x.key,
  });
  assert.equal((await stranger.mine()).appointments.length, 0);
  await assert.rejects(stranger.quote(first.id), /不存在/);
  await assert.rejects(stranger.adminList(), /权限/);
  await assert.rejects(
    x.user.dispatch("applyPayment", { trade_state: "SUCCESS" }),
    /不支持/,
  );
});
test("identity consent, encryption, ownership, expiry and audited admin access", async (t) => {
  const x = await setup(t),
    a = await x.appointment();
  await assert.rejects(
    x.user.uploadIdentity({ appointmentId: a.id, side: "front", base64: png }),
    /同意/,
  );
  const d = await x.user.uploadIdentity({
    appointmentId: a.id,
    side: "front",
    base64: png,
    consent: true,
    privacyVersion: 1,
  });
  const record = x.store.data[C.identity][0];
  assert.notEqual(record.ciphertext, png);
  assert.equal(JSON.stringify(x.store.data.admin_audit).includes(png), false);
  await assert.rejects(x.user.identityFile(d.id), /权限/);
  assert.deepEqual(
    (await x.admin.identityFile(d.id)).bytes,
    Buffer.from(png, "base64"),
  );
  const stranger = new LeasingService({
    store: x.store,
    actor: { ...x.actor, id: "other" },
    identityKey: x.key,
  });
  await assert.rejects(
    stranger.uploadIdentity({
      appointmentId: a.id,
      side: "back",
      base64: png,
      consent: true,
      privacyVersion: 1,
    }),
    /不存在/,
  );
  x.advance(31 * 86400000);
  await assert.rejects(x.admin.identityFile(d.id), /过期/);
  assert.equal((await x.admin.purgeIdentity()).purged, 1);
  assert.equal(x.store.data[C.identity][0].ciphertext, "");
});
test("identity review requires both sides and a confirmed/reviewed appointment before quoting", async (t) => {
  const x = await setup(t),
    a = await x.appointment();
  await assert.rejects(x.user.quote(a.id), /等待/);
  await assert.rejects(
    x.admin.reviewAppointment({
      id: a.id,
      revision: 1,
      decision: "identity_approved",
    }),
    /不完整/,
  );
  const ready = await x.prepared();
  const q = await x.user.quote(ready.id);
  assert.equal(q.depositCents, 530000);
  assert.match(q.contractText, /5300.00/);
  assert.match(q.contractText, /押金不退/);
});
test("missing payment merchant never produces a payable order or a room hold", async (t) => {
  const x = await setup(t),
    a = await x.prepared();
  x.user.payment = null;
  const q = await x.user.quote(a.id),
    before = structuredClone(x.store.data);
  await assert.rejects(
    x.user.createOrder({
      appointmentId: a.id,
      quoteHash: q.quoteHash,
      requestId: "order",
      accepted: true,
    }),
    /商户尚未配置/,
  );
  assert.deepEqual(x.store.data, before);
});
test("room hold serializes competing orders, fee is server derived, and contract changes invalidate acceptance", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    q = await x.user.quote(a.id);
  const request = {
    appointmentId: a.id,
    quoteHash: q.quoteHash,
    requestId: "one",
    accepted: true,
    depositCents: 1,
  };
  const results = await Promise.allSettled([
    x.user.createOrder(request),
    x.user.createOrder({ ...request, requestId: "two" }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(x.store.data[C.orders].length, 1);
  assert.equal(x.store.data[C.orders][0].depositCents, 530000);
  const config = await x.admin.settings();
  await x.admin.saveSettings({ ...config, depositMonths: 3 });
  await assert.rejects(
    x.user.createOrder({ ...request, requestId: "three" }),
    /更新/,
  );
});
test("verified payment alone holds the room for 72h; duplicate callback and replay cannot extend it", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a),
    p = x.paid(o);
  await assert.rejects(
    x.user.applyPayment({ ...p, amount: { total: 1, currency: "CNY" } }),
    /不一致/,
  );
  await x.user.applyPayment(p);
  const first = x.store.data[C.orders][0];
  assert.equal(first.status, "paid_held");
  assert.equal(first.holdUntil, x.now() + 72 * 3600000);
  x.advance(60000);
  await x.user.applyPayment(p);
  assert.equal(x.store.data[C.orders][0].holdUntil, first.holdUntil);
  await assert.rejects(
    x.user.applyPayment({ ...p, transaction_id: "different" }),
    /冲突/,
  );
  x.advance(73 * 3600000);
  assert.equal((await x.user.mine()).orders[0].status, "expired_forfeited");
  await assert.rejects(x.admin.finishOrder({ id: o.id }), /有效留房/);
});
test("late payment after a replacement hold is refund-required and never steals the room", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    old = await x.order(a, "old");
  x.advance(16 * 60000);
  const replacement = await x.order(a, "new");
  await x.user.applyPayment(x.paid(old));
  assert.equal(
    x.store.data[C.orders].find((o) => o._id === old.id).status,
    "refund_required",
  );
  assert.equal(x.store.data[C.holds][0].orderId, replacement.id);
  assert.equal(
    x.store.data[C.orders].find((o) => o._id === replacement.id).status,
    "awaiting_payment",
  );
});
test("reviewed image replacement and changed listing prevent old quote from being used", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    q = await x.user.quote(a.id);
  await x.user.uploadIdentity({
    appointmentId: a.id,
    side: "front",
    base64: png,
    consent: true,
    privacyVersion: 1,
  });
  const before = structuredClone(x.store.data);
  await assert.rejects(
    x.user.createOrder({
      appointmentId: a.id,
      quoteHash: q.quoteHash,
      requestId: "order",
      accepted: true,
    }),
    /审核/,
  );
  assert.deepEqual(x.store.data, before);
});
test("formal signing closes listing and holds it beyond expiry; ordinary users cannot confirm", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a);
  await x.user.applyPayment(x.paid(o));
  await assert.rejects(x.user.finishOrder({ id: o.id }), /权限/);
  await x.admin.finishOrder({ id: o.id });
  assert.equal(
    x.store.data.houses.find((h) => h._id === "listing").status,
    "已租",
  );
  assert.equal((await x.user.catalog("listing")).rooms.length, 0);
});
test("payment notifications require RSA signature, timestamp, serial and authenticated ciphertext", () => {
  assert.equal(payModule.createWechatPay({}), null);
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    }),
    apiKey = randomBytes(32).toString("hex").slice(0, 32);
  const env = {
    WX_PAY_APPID: "wx1234567890abcdef",
    WX_PAY_MCHID: "1234567890",
    WX_PAY_SERIAL: "merchant",
    WX_PAY_PRIVATE_KEY: privateKey,
    WX_PAY_PLATFORM_SERIAL: "platform",
    WX_PAY_PLATFORM_PUBLIC_KEY: publicKey,
    WX_PAY_API_V3_KEY: apiKey,
    WX_PAY_NOTIFY_URL: "https://example.invalid/notify",
  };
  const pay = payModule.createWechatPay(env),
    nonce = "123456789012",
    aad = "transaction",
    cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(apiKey),
      Buffer.from(nonce),
    );
  cipher.setAAD(Buffer.from(aad));
  const expected = { trade_state: "SUCCESS", out_trade_no: "test" };
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(expected)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const body = JSON.stringify({
      event_type: "TRANSACTION.SUCCESS",
      resource: {
        algorithm: "AEAD_AES_256_GCM",
        nonce,
        associated_data: aad,
        ciphertext: encrypted.toString("base64"),
      },
    }),
    stamp = String(Math.floor(Date.now() / 1000)),
    s = createSign("RSA-SHA256");
  s.update(`${stamp}\nnonce\n${body}\n`);
  const headers = {
    "wechatpay-timestamp": stamp,
    "wechatpay-nonce": "nonce",
    "wechatpay-serial": "platform",
    "wechatpay-signature": s.sign(privateKey, "base64"),
  };
  assert.deepEqual(pay.notification(headers, body), expected);
  assert.throws(() => pay.notification(headers, body + " "));
  assert.throws(() =>
    pay.notification({ ...headers, "wechatpay-serial": "wrong" }, body),
  );
  assert.throws(() =>
    pay.notification({ ...headers, "wechatpay-timestamp": "1" }, body),
  );
});

test("cloud repository treats only explicit missing-document errors as absence", async () => {
  const { readDocument } =
    await import("../../cloudfunctions/leasing/store.js");
  assert.equal(await readDocument({ get: async () => ({ data: [] }) }), null);
  assert.equal(
    await readDocument({
      get: async () => {
        throw new Error("document does not exist");
      },
    }),
    null,
  );
  await assert.rejects(
    readDocument({
      get: async () => {
        throw new Error("collection does not exist");
      },
    }),
    /collection/,
  );
  await assert.rejects(
    readDocument({
      get: async () => {
        throw new Error("permission denied");
      },
    }),
    /permission/,
  );
});
test("quote acceptance is recoverable after a lost response and later changes", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    q = await x.user.quote(a.id),
    req = {
      appointmentId: a.id,
      quoteHash: q.quoteHash,
      accepted: true,
      requestId: "stable",
    };
  const first = await x.user.createOrder(req);
  await x.user.applyPayment(x.paid(first));
  const config = await x.admin.settings();
  await x.admin.saveSettings({ ...config, depositMonths: 3 });
  const replay = await x.user.createOrder(req);
  assert.equal(replay.id, first.id);
  assert.equal(replay.depositCents, first.depositCents);
  assert.equal(x.store.data[C.orders].length, 1);
  await assert.rejects(
    x.user.createOrder({ ...req, quoteHash: "different" }),
    /编号/,
  );
});

test("private queries use owner filters; retention scans metadata and payment lookup uses an exact ID", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a);
  const original = x.store.list.bind(x.store),
    calls = [];
  x.store.list = async (name, options) => {
    calls.push({ name, options });
    return original(name, options);
  };
  await x.user.mine();
  for (const call of calls)
    assert.equal(call.options.where.ownerId, x.actor.id);
  calls.length = 0;
  await x.user.applyPayment(x.paid(o));
  assert.equal(calls.length, 0, "verified payment must not scan all orders");
  x.advance(31 * 86400000);
  await x.admin.purgeIdentity();
  assert.deepEqual(calls[0].options.fields, ["_id", "expiresAt", "purgedAt"]);
  assert.equal(calls[0].options.fields.includes("ciphertext"), false);
});

test("replacing reviewed identity invalidates the pending order and blocks the provider before reapproval", async (t) => {
  for (const side of ["front", "back"]) {
    const x = await setup(t),
      a = await x.prepared(),
      o = await x.order(a);
    let calls = 0;
    x.payment.create = async () => {
      calls++;
      return { package: "prepay_id=test" };
    };
    const upload = await x.user.uploadIdentity({
      appointmentId: a.id,
      side,
      base64: png,
      consent: true,
      privacyVersion: 1,
    });
    const stored = x.store.data[C.orders].find((row) => row._id === o.id);
    assert.equal(stored.status, "identity_changed");
    assert.equal(x.store.data[C.holds][0].until, 0);
    let before = structuredClone(x.store.data);
    await assert.rejects(x.user.paymentParams(o.id), (e) => e.status === 409);
    let after = structuredClone(x.store.data);
    assert.deepEqual(after, before);
    assert.equal(calls, 0);
    const current = (await x.user.mine()).appointments[0];
    assert.equal(current.identityStatus, "pending");
    await x.admin.reviewAppointment({
      id: a.id,
      revision: current.revision,
      decision: "identity_approved",
    });
    before = structuredClone(x.store.data);
    await assert.rejects(x.user.paymentParams(o.id), (e) => e.status === 409);
    after = structuredClone(x.store.data);
    assert.deepEqual(after, before);
    assert.equal(calls, 0);
    const fresh = await x.order(
      (await x.user.mine()).appointments[0],
      "fresh-" + side,
    );
    assert.notEqual(fresh.id, o.id);
    assert.equal(
      x.store.data[C.orders].find((row) => row._id === fresh.id)[
        side === "front" ? "identityFrontId" : "identityBackId"
      ],
      upload.id,
    );
    await x.user.paymentParams(fresh.id);
    assert.equal(calls, 1);
  }
});

test("payment guard rejects legacy pending orders with changed bindings, rejected status or expired materials", async (t) => {
  const cases = [
    "changed-front",
    "changed-back",
    "pending",
    "rejected",
    "appointment-rejected",
    "expired",
    "purged",
  ];
  for (const name of cases) {
    const x = await setup(t),
      a = await x.prepared(),
      o = await x.order(a);
    let calls = 0;
    x.payment.create = async () => {
      calls++;
      return {};
    };
    const appointment = x.store.data[C.appointments].find(
        (r) => r._id === a.id,
      ),
      doc = x.store.data[C.identity][0];
    if (name === "changed-front")
      appointment.identityFrontId = "identity-other";
    if (name === "changed-back") appointment.identityBackId = "identity-other";
    if (name === "pending" || name === "rejected")
      appointment.identityStatus = name;
    if (name === "appointment-rejected") appointment.status = "rejected";
    if (name === "expired") doc.expiresAt = x.now();
    if (name === "purged") doc.ciphertext = "";
    const before = structuredClone(x.store.data);
    await assert.rejects(x.user.paymentParams(o.id), (e) => e.status === 409);
    const after = structuredClone(x.store.data);
    assert.deepEqual(after, before);
    assert.equal(calls, 0, name);
  }
});

test("identity replacement during prepay creation cannot return payment params", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a);
  let entered, release;
  const called = new Promise((r) => (entered = r)),
    wait = new Promise((r) => (release = r));
  x.payment.create = async () => {
    entered();
    await wait;
    return { package: "prepay_id=stale" };
  };
  const pending = x.user.paymentParams(o.id);
  await called;
  await x.user.uploadIdentity({
    appointmentId: a.id,
    side: "front",
    base64: png,
    consent: true,
    privacyVersion: 1,
  });
  release();
  await assert.rejects(pending, (e) => e.status === 409);
  assert.equal(x.store.data[C.orders][0].status, "identity_changed");
});

test("cached prepay after identity replacement is reconciled as refund-required and never takes a newer hold", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    old = await x.order(a, "old");
  await x.user.paymentParams(old.id); // The client may retain these already-issued params.
  await x.user.uploadIdentity({
    appointmentId: a.id,
    side: "back",
    base64: png,
    consent: true,
    privacyVersion: 1,
  });
  const current = (await x.user.mine()).appointments[0];
  await x.admin.reviewAppointment({
    id: a.id,
    revision: current.revision,
    decision: "identity_approved",
  });
  const fresh = await x.order((await x.user.mine()).appointments[0], "fresh");
  await x.user.applyPayment(x.paid(old));
  const records = x.store.data[C.orders];
  assert.equal(records.find((o) => o._id === old.id).status, "refund_required");
  assert.equal(
    records.find((o) => o._id === fresh.id).status,
    "awaiting_payment",
  );
  assert.equal(x.store.data[C.holds][0].orderId, fresh.id);
  const before = structuredClone(x.store.data[C.holds]);
  await x.user.applyPayment(x.paid(old));
  assert.deepEqual(x.store.data[C.holds], before);
});

test("payment first prevents identity replacement from mutating an already-paid contract", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a);
  await x.user.applyPayment(x.paid(o));
  const before = structuredClone(x.store.data);
  await assert.rejects(
    x.user.uploadIdentity({
      appointmentId: a.id,
      side: "front",
      base64: png,
      consent: true,
      privacyVersion: 1,
    }),
    (e) => e.status === 409,
  );
  const after = structuredClone(x.store.data);
  assert.deepEqual(after, before);
});
