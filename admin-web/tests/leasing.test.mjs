import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  randomBytes,
  generateKeyPairSync,
  createSign,
  createCipheriv,
} from "node:crypto";
// The guard must be installed before any subject module is loaded; the guard
// module installs itself on load and the subject modules are imported below.
import guard from "../../tests/rental-network-guard.cjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DOMAIN_FILE = join(ROOT, "cloudfunctions/leasing/domain.js");
const INDEX_FILE = join(ROOT, "cloudfunctions/leasing/index.js");
const STORE_FILE = join(ROOT, "cloudfunctions/leasing/store.js");
const PAY_FILE = join(ROOT, "cloudfunctions/leasing/wechat-pay.js");
const WEB_STORE_FILE = join(ROOT, "admin-web/lib/store.mjs");
const GUARD_FILE = join(ROOT, "tests/rental-network-guard.cjs");
const LOCAL_TEST_FILE = join(ROOT, "admin-web/tests/leasing.test.mjs");
const CLOUD_TEST_FILE = join(ROOT, "tests/leasing.test.cjs");
const NON_LISTENING_FILES = [
  DOMAIN_FILE,
  INDEX_FILE,
  STORE_FILE,
  PAY_FILE,
  WEB_STORE_FILE,
  LOCAL_TEST_FILE,
  CLOUD_TEST_FILE,
  GUARD_FILE,
];
const SUBJECT_FILES = [
  DOMAIN_FILE,
  INDEX_FILE,
  STORE_FILE,
  PAY_FILE,
  WEB_STORE_FILE,
  LOCAL_TEST_FILE,
  CLOUD_TEST_FILE,
];

guard.assertInstalled();
const domainNs = await import("../../cloudfunctions/leasing/domain.js");
const payNs = await import("../../cloudfunctions/leasing/wechat-pay.js");
const webStoreNs = await import("../lib/store.mjs");
guard.assertNoLoadTimeViolation();
const { LeasingService, C } = domainNs.default;
const payModule = payNs.default;
const { LocalStore } = webStoreNs;

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=";
const template =
  "{{tenantName}} 预签约 {{roomLabel}}，月租 {{monthlyRent}}，押金 {{deposit}}，留房 {{holdHours}} 小时。{{expiryPolicy}}。预约 {{appointmentId}}";
// Baseline orderDTO key set (S1-16): the DTO must not grow payment fields.
const DTO_KEYS = [
  "appointmentId",
  "contractText",
  "createdAt",
  "depositCents",
  "expiryPolicy",
  "holdHours",
  "holdUntil",
  "id",
  "monthlyRentCents",
  "paymentDeadline",
  "roomLabel",
  "status",
  "templateVersion",
];

async function rejectsWithStatus(promise, status, code) {
  const error = await promise.then(
    () => {
      throw new Error("expected the request to be rejected with " + status);
    },
    (e) => e,
  );
  assert.equal(error.status, status, "status");
  if (code === undefined) assert.equal(error.code, undefined, "code");
  else assert.equal(error.code, code, "code");
  return error;
}

// W0 write set (S1 §5): the whole store, including admin_audit, is unchanged.
function assertWriteSet(before, after) {
  assert.deepEqual(after, before);
}

function assertPaymentRequestWrite(before, after, orderId, audit = 0) {
  for (const key of Object.keys(after)) {
    if (key === "rental_preleases" || key === "admin_audit") continue;
    assert.deepEqual(after[key], before[key], "collection wrote: " + key);
  }
  const beforeRows = new Map(before.rental_preleases.map((r) => [r._id, r]));
  const afterRows = new Map(after.rental_preleases.map((r) => [r._id, r]));
  assert.deepEqual(
    [...afterRows.keys()].sort(),
    [...beforeRows.keys()].sort(),
    "order set changed",
  );
  for (const [orderKey, row] of beforeRows) {
    const next = afterRows.get(orderKey);
    if (orderKey !== orderId) {
      assert.deepEqual(next, row, "unrelated order wrote: " + orderKey);
      continue;
    }
    const a = { ...next },
      b = { ...row };
    delete a.paymentRequest;
    delete b.paymentRequest;
    delete a.updatedAt;
    delete b.updatedAt;
    assert.deepEqual(a, b, "order fields other than paymentRequest changed");
    assert.notDeepEqual(
      next.paymentRequest,
      row.paymentRequest,
      "paymentRequest was not written",
    );
  }
  if (audit === 0) {
    assert.deepEqual(after.admin_audit, before.admin_audit, "audit wrote");
    return;
  }
  assert.equal(
    after.admin_audit.length,
    before.admin_audit.length + 1,
    "audit must grow by exactly one",
  );
  assert.deepEqual(
    after.admin_audit.slice(1),
    before.admin_audit,
    "existing audit entries changed",
  );
  const entry = after.admin_audit[0];
  assert.equal(entry.action, "租赁预约：核对支付资格");
  assert.equal(entry.actor, "tenant");
  assert.equal(entry.target, "rental_preleases/" + orderId);
}

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
  const calls = { create: 0, query: 0 };
  let createImpl = async () => ({ package: "prepay_id=test" });
  let queryImpl = async () => ({ trade_state: "NOTPAY" });
  const payment = {
    appid: "wx-test",
    mchid: "merchant",
    create: async (input) => {
      calls.create += 1;
      return createImpl(input);
    },
    query: async (tradeNo) => {
      calls.query += 1;
      return queryImpl(tradeNo);
    },
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
    calls,
    onCreate: (fn) => {
      createImpl = fn;
    },
    onQuery: (fn) => {
      queryImpl = fn;
    },
    row: (id) => store.data[C.orders].find((r) => r._id === id),
    hold: () => store.data[C.holds][0],
  };
}

function paymentRequestFixture(now, patch = {}) {
  return {
    status: "preparing",
    attemptId: "attempt-fixture",
    epoch: 1,
    leaseUntil: now + 30000,
    startedAt: now - 1000,
    externalRequestSentAt: now - 1000,
    lastQueryAt: null,
    failedAt: null,
    queryEvidence: null,
    prepay: null,
    clientParams: null,
    ...patch,
  };
}

// Models a store-level transaction retry: the build runs once, the clock moves
// on, and the SDK runs the same build again before committing the retried
// result. Any clock/lease decision must therefore be revalidated per attempt.
function retryTransactionAfterClock(x, { call, advanceMs }) {
  const real = x.store.transact.bind(x.store);
  let calls = 0;
  x.store.transact = async (refs, build, audit, options) => {
    const index = (calls += 1);
    return real(
      refs,
      async (state) => {
        const writes = await build(state);
        if (index === call) {
          x.advance(advanceMs);
          return await build(state);
        }
        return writes;
      },
      audit,
      options,
    );
  };
  return () => calls;
}

test("network guard: installed before subject modules, every entry blocked, child inherits", async () => {
  assert.equal(guard.isInstalled(), true);
  const names = guard.entryNames();
  const evidence = await guard.runNetworkGuardSelfCheck();
  assert.equal(evidence.loadViolations, 0);
  assert.equal(evidence.negatives.passed, evidence.negatives.total);
  assert.equal(evidence.esm.synced, true);
  assert.equal(evidence.esm.passed, evidence.esm.total);
  assert.equal(evidence.positives.passed, evidence.positives.total);
  assert.equal(evidence.subprocess.passed, 1);
  assert.equal(evidence.subprocess.violations >= 5, true);
  assert.equal(evidence.subprocess.preload, "verified-before-require");
  assert.equal(evidence.subprocess.negative.status, 42);
  assert.equal(evidence.subprocess.negative.markerMissing, true);
  assert.equal(evidence.forwarded, 0);
  console.log("[guard-evidence] " + JSON.stringify(evidence));
  assert.equal(guard.activeNetworkResources().length, 0);
  const reset = guard.resetRuntimeViolations();
  assert.equal(reset.loadViolations, 0);
  assert.equal(guard.runtimeViolationCount(), 0);
  const scanned = guard.assertNonListeningFiles(NON_LISTENING_FILES);
  assert.equal(scanned.length, NON_LISTENING_FILES.length);
  assert.equal(guard.assertNoUncontrolledChildProcess(SUBJECT_FILES), SUBJECT_FILES.length);
  assert.equal(names.length >= 50, true);
});

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
    x.store.data.admin_audit[0].action,
    "租赁预约：确认已完成正式签约",
  );
  assert.equal(
    x.store.data[C.orders].find((r) => r._id === o.id).status,
    "signed",
  );
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
  const { readDocument } = await import("../../cloudfunctions/leasing/store.js");
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

// S1-14: an identity replacement while create is in flight must not return
// params; the unconfirmed result is recorded as reconciling with zero audit.
test("identity replacement during prepay creation cannot return payment params", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a);
  let entered, release;
  const called = new Promise((r) => (entered = r)),
    wait = new Promise((r) => (release = r));
  x.onCreate(async () => {
    entered();
    await wait;
    return { package: "prepay_id=stale" };
  });
  const pending = x.user.paymentParams(o.id);
  await called;
  await x.user.uploadIdentity({
    appointmentId: a.id,
    side: "front",
    base64: png,
    consent: true,
    privacyVersion: 1,
  });
  const before = structuredClone(x.store.data);
  release();
  await rejectsWithStatus(pending, 503, "PAYMENT_QUERY_UNAVAILABLE");
  assert.equal(x.calls.create, 1);
  assert.equal(x.calls.query, 0);
  assert.equal(x.row(o.id).status, "identity_changed");
  const pr = x.row(o.id).paymentRequest;
  assert.equal(pr.status, "reconciling");
  assert.equal(pr.epoch, 1);
  assert.equal(pr.externalRequestSentAt > 0, true);
  assert.equal(
    x.store.data.admin_audit.some(
      (a) => a.action === "租赁预约：核对支付资格",
    ),
    false,
  );
  // Limited WP: only paymentRequest changed after the upload, and audit is equal.
  assertPaymentRequestWrite(before, structuredClone(x.store.data), o.id, 0);
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

test("formal signing revalidates appointment, review and bound documents", async (t) => {
  for (const mode of ["identity_rejected", "rejected", "expired"]) {
    const x = await setup(t),
      a = await x.prepared(),
      o = await x.order(a);
    await x.user.applyPayment(x.paid(o));
    if (mode === "expired")
      for (const d of x.store.data[C.identity]) d.expiresAt = x.now() - 1;
    else {
      const current = (await x.user.mine()).appointments[0];
      await x.admin.reviewAppointment({
        id: a.id,
        revision: current.revision,
        decision: mode,
      });
    }
    const before = structuredClone(x.store.data);
    await assert.rejects(
      x.admin.finishOrder({ id: o.id }),
      (e) => e.status === 409,
    );
    assert.deepEqual(x.store.data, before, mode);
    assert.equal(
      x.store.data[C.orders].find((r) => r._id === o.id).status,
      "paid_held",
      mode,
    );
    assert.equal(x.store.data[C.holds][0].status, "paid_held", mode);
    assert.equal(
      x.store.data.houses.find((h) => h._id === "listing").status,
      "在租",
      mode,
    );
  }
});

// S1-8 / S1-11: adapter failure keeps a reconciling fact and never leaks the
// adapter error, never terminates the order and never releases a valid hold.
test("payment params adapter failure keeps a reconciling fact with no audit", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a);
  x.onCreate(async () => {
    throw new Error("synthetic adapter outage");
  });
  const before = structuredClone(x.store.data);
  const error = await rejectsWithStatus(x.user.paymentParams(o.id), 503);
  assert.equal(error.code, undefined);
  assert.equal(/synthetic|adapter/i.test(error.message), false);
  assert.equal(x.calls.create, 1);
  assert.equal(x.calls.query, 0);
  assert.equal(x.row(o.id).status, "awaiting_payment");
  const pr = x.row(o.id).paymentRequest;
  assert.equal(pr.status, "reconciling");
  assert.equal(pr.epoch, 1);
  assert.equal(pr.externalRequestSentAt > 0, true);
  assert.equal(x.hold().until, before.rental_room_holds[0].until);
  assert.equal(x.hold().orderId, o.id);
  assertPaymentRequestWrite(before, structuredClone(x.store.data), o.id, 0);
});

// S1-3: a first successful create writes ready plus exactly one success audit.
test("successful payment params writes one audit and calls adapter once", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a);
  const before = structuredClone(x.store.data);
  const params = await x.user.paymentParams(o.id);
  assert.equal(x.calls.create, 1);
  assert.equal(x.calls.query, 0);
  assert.deepEqual(params, { package: "prepay_id=test" });
  assert.equal(x.row(o.id).status, "awaiting_payment");
  const pr = x.row(o.id).paymentRequest;
  assert.equal(pr.status, "ready");
  assert.equal(pr.leaseUntil, null);
  assert.equal(pr.queryEvidence, null);
  assert.equal(pr.prepay.prepayId, "test");
  assert.equal(pr.prepay.createdAt, x.now());
  assert.deepEqual(pr.clientParams, params);
  assert.equal(
    /prepay_id=([^&\s]+)/.exec(pr.clientParams.package)[1],
    pr.prepay.prepayId,
  );
  assert.deepEqual(
    Object.keys(pr).sort(),
    [
      "attemptId",
      "clientParams",
      "epoch",
      "externalRequestSentAt",
      "failedAt",
      "lastQueryAt",
      "leaseUntil",
      "prepay",
      "queryEvidence",
      "startedAt",
      "status",
    ],
    "paymentRequest shape",
  );
  assertPaymentRequestWrite(before, structuredClone(x.store.data), o.id, 1);
});

// S1-1: two concurrent first requests - exactly one create, one ready, one audit.
test("S1-1 concurrent first payment requests: one create, loser 409 PAYMENT_PARAMS_IN_PROGRESS", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a);
  let entered, release;
  const called = new Promise((r) => (entered = r)),
    wait = new Promise((r) => (release = r));
  x.onCreate(async () => {
    entered();
    await wait;
    return { package: "prepay_id=winner" };
  });
  const before = structuredClone(x.store.data);
  const winner = x.user.paymentParams(o.id);
  await called;
  const beforeLoser = structuredClone(x.store.data);
  const loser = rejectsWithStatus(
    x.user.paymentParams(o.id),
    409,
    "PAYMENT_PARAMS_IN_PROGRESS",
  );
  await loser;
  // The loser is a full W0 write set (claim lease is still held by the winner).
  assertWriteSet(beforeLoser, structuredClone(x.store.data));
  release();
  const params = await winner;
  assert.deepEqual(params, { package: "prepay_id=winner" });
  assert.equal(x.calls.create, 1);
  assert.equal(x.calls.query, 0);
  const after = structuredClone(x.store.data);
  assertPaymentRequestWrite(before, after, o.id, 1);
  const pr = x.row(o.id).paymentRequest;
  assert.equal(pr.status, "ready");
  assert.equal(pr.epoch, 1);
  assert.match(pr.attemptId, /^attempt-/);
  assert.equal(pr.leaseUntil, null);
  assert.equal(pr.externalRequestSentAt > 0, true);
  assert.deepEqual(pr.clientParams, { package: "prepay_id=winner" });
  assert.equal(pr.prepay.prepayId, "winner");
  assert.equal(
    after.admin_audit.filter((e) => e.action === "租赁预约：核对支付资格").length,
    1,
  );
});

// S1-2: a second party inside a valid lease is rejected for both live states.
test("S1-2 valid lease rejects the second party for preparing and reconciling", async (t) => {
  for (const status of ["preparing", "reconciling"]) {
    const x = await setup(t),
      a = await x.prepared(),
      o = await x.order(a),
      now = x.now();
    x.row(o.id).paymentRequest = paymentRequestFixture(now, {
      status,
      attemptId: "attempt-fixture-" + status,
      epoch: 3,
      leaseUntil: now + 30000,
    });
    const before = structuredClone(x.store.data);
    await rejectsWithStatus(
      x.user.paymentParams(o.id),
      409,
      "PAYMENT_PARAMS_IN_PROGRESS",
    );
    assertWriteSet(before, structuredClone(x.store.data));
    assert.equal(x.calls.create, 0, status);
    assert.equal(x.calls.query, 0, status);
  }
});

// S1-4 (non-HTTP internal complete helper): a stale epoch returns `false` with zero writes.
test("S1-4 stale epoch complete returns false and writes nothing", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a),
    now = x.now();
  x.row(o.id).paymentRequest = paymentRequestFixture(now, {
    status: "ready",
    attemptId: "attempt-2",
    epoch: 2,
    leaseUntil: null,
    prepay: { prepayId: "keep", createdAt: now - 5000 },
    clientParams: { package: "prepay_id=keep" },
  });
  const before = structuredClone(x.store.data);
  const result = await x.user.completePaymentRequest({
    orderId: o.id,
    attemptId: "attempt-1",
    epoch: 1,
    params: { package: "prepay_id=old" },
  });
  assert.equal(result, false);
  assert.deepEqual(x.store.data, before);
  assert.equal(x.row(o.id).paymentRequest.epoch, 2);
  assert.equal(x.row(o.id).paymentRequest.attemptId, "attempt-2");
  assert.deepEqual(x.row(o.id).paymentRequest.prepay, {
    prepayId: "keep",
    createdAt: now - 5000,
  });
  assert.equal(x.calls.create, 0);
  assert.equal(x.calls.query, 0);
});

// S1-5: order/hold/material preconditions keep the existing 409 messages and W0.
test("S1-5 expired order, foreign hold, released hold and changed materials are 409 with zero writes", async (t) => {
  const cases = [
    {
      name: "expired-order",
      message: "订单不在可支付时间内，请刷新状态",
      mutate: (x) => x.advance(16 * 60000),
    },
    {
      name: "foreign-hold",
      message: "订单不在可支付时间内，请刷新状态",
      mutate: (x, o) => {
        x.hold().orderId = "lease-someone-else";
      },
    },
    {
      name: "released-hold",
      message: "订单不在可支付时间内，请刷新状态",
      mutate: (x) => {
        x.hold().until = 0;
        x.hold().status = "released";
      },
    },
    {
      name: "changed-materials",
      message: "身份证材料或审核状态已变化，请重新审核并确认合同",
      mutate: (x, o, a) => {
        x.store.data[C.appointments].find((r) => r._id === a.id).identityStatus =
          "pending";
      },
    },
  ];
  for (const item of cases) {
    const x = await setup(t),
      a = await x.prepared(),
      o = await x.order(a);
    item.mutate(x, o, a);
    const before = structuredClone(x.store.data);
    const error = await rejectsWithStatus(x.user.paymentParams(o.id), 409);
    assert.equal(error.message, item.message, item.name);
    assertWriteSet(before, structuredClone(x.store.data));
    assert.equal(x.calls.create, 0, item.name);
    assert.equal(x.calls.query, 0, item.name);
    assert.equal(x.hold().status, before.rental_room_holds[0].status, item.name);
    assert.equal(Object.hasOwn(x.row(o.id), "paymentRequest"), false, item.name);
  }
});

// S1-6a: a local validation failure inside T1 aborts with no paymentRequest key.
test("S1-6a local validation failure inside T1 aborts with no paymentRequest residue", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a);
  x.store.data[C.appointments].find((r) => r._id === a.id).status = "rejected";
  const before = structuredClone(x.store.data);
  const error = await rejectsWithStatus(x.user.paymentParams(o.id), 409);
  assert.equal(error.message, "身份证材料或审核状态已变化，请重新审核并确认合同");
  assertWriteSet(before, structuredClone(x.store.data));
  assert.equal(Object.hasOwn(x.row(o.id), "paymentRequest"), false);
  assert.equal(x.calls.create, 0);
  assert.equal(x.calls.query, 0);
});

// S1-6b (non-HTTP abort evidence): a failure inside the T1 build aborts the whole transaction.
test("S1-6b failure inside the claim build aborts before commit with zero writes", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a);
  x.hold().until = 0;
  x.hold().status = "released";
  const real = x.store.transact.bind(x.store);
  let builds = 0,
    buildFailures = 0;
  x.store.transact = async (refs, build, audit, options) =>
    real(
      refs,
      async (state) => {
        builds += 1;
        try {
          return await build(state);
        } catch (e) {
          buildFailures += 1;
          throw e;
        }
      },
      audit,
      options,
    );
  const before = structuredClone(x.store.data);
  const error = await rejectsWithStatus(x.user.paymentParams(o.id), 409);
  assert.equal(error.message, "订单不在可支付时间内，请刷新状态");
  assert.equal(builds, 1);
  assert.equal(buildFailures, 1);
  assertWriteSet(before, structuredClone(x.store.data));
  assert.equal(Object.hasOwn(x.row(o.id), "paymentRequest"), false);
  assert.equal(x.calls.create, 0);
});

// S1-7 (static/non-HTTP): sent is written once, never cleared, and create runs once.
test("S1-7 static invariants: single sent write, no clearing, one create call site", async () => {
  const source = await readFile(DOMAIN_FILE, "utf8");
  assert.equal((source.match(/externalRequestSentAt:/g) || []).length, 1);
  assert.equal(/externalRequestSentAt\s*:\s*(null|undefined)/.test(source), false);
  assert.equal(/externalRequestSentAt\s*=\s*(null|undefined)/.test(source), false);
  assert.equal(/delete\s+[\w.$]*externalRequestSentAt/.test(source), false);
  assert.equal((source.match(/this\.payment\.create\(/g) || []).length, 1);
  assert.equal((source.match(/this\.payment\.query\(/g) || []).length, 1);
  // No new merchant order number generator: the two baseline derivations only.
  assert.equal((source.match(/replace\("lease-", "L"\)/g) || []).length, 2);
});

// S1-9: complete loses the CAS because a takeover already bumped epoch; the old
// owner writes nothing and never overwrites the new reconciling state.
test("S1-9 complete CAS loss after takeover writes nothing for the old owner", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a);
  let entered, release;
  const called = new Promise((r) => (entered = r)),
    wait = new Promise((r) => (release = r));
  x.onCreate(async () => {
    entered();
    await wait;
    return { package: "prepay_id=old-owner" };
  });
  const oldOwner = x.user.paymentParams(o.id);
  await called;
  const afterClaim = structuredClone(x.store.data);
  x.advance(61 * 1000);
  const takeoverError = await rejectsWithStatus(
    x.user.paymentParams(o.id),
    503,
    "PAYMENT_QUERY_UNAVAILABLE",
  );
  assert.equal(takeoverError.message.length > 0, true);
  const takenOver = structuredClone(x.store.data);
  assertPaymentRequestWrite(afterClaim, takenOver, o.id, 0);
  const claimedRequest = afterClaim.rental_preleases.find(
    (r) => r._id === o.id,
  ).paymentRequest;
  const pr = x.row(o.id).paymentRequest;
  assert.equal(pr.status, "reconciling");
  assert.equal(pr.epoch, claimedRequest.epoch + 1);
  assert.notEqual(pr.attemptId, claimedRequest.attemptId);
  assert.equal(pr.externalRequestSentAt, claimedRequest.externalRequestSentAt);
  assert.equal(x.calls.create, 1);
  assert.equal(x.calls.query, 0);
  release();
  await rejectsWithStatus(oldOwner, 503, "PAYMENT_QUERY_UNAVAILABLE");
  // The old owner must not overwrite the newer epoch or write anything else.
  assert.deepEqual(structuredClone(x.store.data), takenOver);
  assert.equal(x.row(o.id).paymentRequest.epoch, 2);
  assert.equal(x.row(o.id).paymentRequest.status, "reconciling");
  assert.equal(
    x.store.data.admin_audit.filter((e) => e.action === "租赁预约：核对支付资格")
      .length,
    0,
  );
});

// S1-10: failed is terminal - existing 409, zero writes, all facts preserved.
test("S1-10 failed paymentRequest is rejected with the existing 409 and preserves facts", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a),
    now = x.now(),
    tradeNo = o.id.replace("lease-", "L").slice(0, 32);
  const record = paymentRequestFixture(now, {
    status: "failed",
    attemptId: "attempt-failed",
    epoch: 4,
    leaseUntil: null,
    startedAt: now - 90000,
    externalRequestSentAt: now - 90000,
    lastQueryAt: now - 1000,
    failedAt: now - 1000,
    queryEvidence: {
      at: now - 1000,
      tradeState: "CLOSED",
      outTradeNo: tradeNo,
      appid: "wx-test",
      mchid: "merchant",
      responseDigest: "digest",
    },
  });
  x.row(o.id).paymentRequest = record;
  const before = structuredClone(x.store.data);
  const error = await rejectsWithStatus(x.user.paymentParams(o.id), 409);
  assert.equal(error.message, "订单不在可支付时间内，请刷新状态");
  assertWriteSet(before, structuredClone(x.store.data));
  assert.deepEqual(x.row(o.id).paymentRequest, record);
  assert.equal(x.row(o.id).status, "awaiting_payment");
  assert.equal(x.hold().orderId, o.id);
  assert.equal(x.calls.create, 0);
  assert.equal(x.calls.query, 0);
});

// S1-12: taking over a sent request needs a query, so S1 fails closed with 503.
test("S1-12 expired lease takeover of a sent request is 503 PAYMENT_QUERY_UNAVAILABLE with epoch+1", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a),
    now = x.now();
  const record = paymentRequestFixture(now, {
    status: "preparing",
    attemptId: "attempt-abandoned",
    epoch: 5,
    startedAt: now - 120000,
    externalRequestSentAt: now - 120000,
    leaseUntil: now - 1,
  });
  x.row(o.id).paymentRequest = record;
  const before = structuredClone(x.store.data);
  await rejectsWithStatus(
    x.user.paymentParams(o.id),
    503,
    "PAYMENT_QUERY_UNAVAILABLE",
  );
  const after = structuredClone(x.store.data);
  assertPaymentRequestWrite(before, after, o.id, 0);
  const pr = x.row(o.id).paymentRequest;
  assert.equal(pr.status, "reconciling");
  assert.equal(pr.epoch, 6);
  assert.notEqual(pr.attemptId, record.attemptId);
  assert.equal(pr.externalRequestSentAt, record.externalRequestSentAt);
  assert.equal(pr.lastQueryAt, null);
  assert.equal(x.calls.create, 0);
  assert.equal(x.calls.query, 0);
  assert.equal(x.hold().orderId, o.id);
  assert.equal(x.hold().until, before.rental_room_holds[0].until);
});

// S1-13: preparing without a recorded external request is a damaged state: no
// resend, no create, no write and no fallback to `none`.
test("S1-13 preparing with empty externalRequestSentAt is 503 with zero writes", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a),
    now = x.now();
  const record = paymentRequestFixture(now, {
    status: "preparing",
    attemptId: "attempt-damaged",
    epoch: 2,
    leaseUntil: now - 1,
    externalRequestSentAt: null,
  });
  x.row(o.id).paymentRequest = record;
  const before = structuredClone(x.store.data);
  const error = await rejectsWithStatus(
    x.user.paymentParams(o.id),
    503,
    "PAYMENT_QUERY_UNAVAILABLE",
  );
  assert.equal(error.code, "PAYMENT_QUERY_UNAVAILABLE");
  assertWriteSet(before, structuredClone(x.store.data));
  assert.deepEqual(x.row(o.id).paymentRequest, record);
  assert.equal(x.calls.create, 0);
  assert.equal(x.calls.query, 0);
  // This state cannot be produced by the claim transaction: sent is written
  // unconditionally (to `now`) or preserved from an earlier sent request.
  const source = await readFile(DOMAIN_FILE, "utf8");
  assert.equal(
    /externalRequestSentAt:\s*takeover\s*\?\s*base\.externalRequestSentAt\s*:\s*now/.test(
      source,
    ),
    true,
  );
});

// S1-15: a stored ready cannot be proven valid in S1, so it is never returned.
test("S1-15 ready hit is 503 PAYMENT_QUERY_UNAVAILABLE with zero writes and no cache return", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a);
  const first = await x.user.paymentParams(o.id);
  assert.deepEqual(first, { package: "prepay_id=test" });
  const before = structuredClone(x.store.data);
  await rejectsWithStatus(
    x.user.paymentParams(o.id),
    503,
    "PAYMENT_QUERY_UNAVAILABLE",
  );
  assertWriteSet(before, structuredClone(x.store.data));
  assert.equal(x.calls.create, 1);
  assert.equal(x.calls.query, 0);
  assert.equal(x.row(o.id).paymentRequest.leaseUntil, null);
  assert.equal(x.row(o.id).paymentRequest.status, "ready");
});

// S1-16 (non-HTTP read paths): DTOs expose no payment internals and never write.
test("S1-16 read paths and orderDTO neither leak paymentRequest nor write", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a);
  await x.user.paymentParams(o.id);
  const before = structuredClone(x.store.data);
  await x.user.mine();
  await x.admin.adminList();
  const checked = await x.user.validatePayableOrder(o.id);
  assert.deepEqual(structuredClone(x.store.data), before);
  assert.equal(checked._id, o.id);
  const dto = x.user.orderDTO(x.row(o.id));
  assert.deepEqual(Object.keys(dto).sort(), DTO_KEYS);
  assert.equal("paymentRequest" in dto, false);
  assert.equal("prepay" in dto, false);
  assert.equal("clientParams" in dto, false);
  assert.deepEqual(
    Object.keys((await x.user.mine()).orders[0]).sort(),
    DTO_KEYS,
  );
});

// S1-17 (static/non-HTTP): the remaining S1 invariants.
test("S1-17 static invariants: no timers, no new codes/actions, create outside the claim build", async () => {
  const source = await readFile(DOMAIN_FILE, "utf8");
  const index = await readFile(INDEX_FILE, "utf8");
  assert.equal(/setTimeout|setInterval|setImmediate/.test(source), false);
  assert.equal(/status:\s*"none"/.test(source), false);
  assert.equal(/delete\s+[\w.$]*paymentRequest/.test(source), false);
  assert.equal(/PAYMENT_QUERY_UNAVAILABLE/.test(source), true);
  assert.equal(/PAYMENT_PARAMS_IN_PROGRESS/.test(source), true);
  const claimStart = source.indexOf("async claimPaymentRequest(o) {");
  const claimEnd = source.indexOf("paymentCompletionVerdict(state,");
  assert.equal(claimStart > 0, true);
  assert.equal(claimEnd > claimStart, true);
  assert.equal(
    /payment\.create/.test(source.slice(claimStart, claimEnd)),
    false,
    "create must not run inside the claim transaction",
  );
  const claimCall = source.indexOf("const claim = await this.claimPaymentRequest(o);");
  const createCall = source.indexOf("this.payment.create(");
  assert.equal(claimCall > 0, true);
  assert.equal(createCall > claimCall, true);
  const actions = [
    ...source.matchAll(/^ {6}(\w+): \(\) =>/gm),
  ].map((m) => m[1]);
  assert.deepEqual(actions, [
    "catalog",
    "appointment",
    "mine",
    "uploadIdentity",
    "quote",
    "createOrder",
    "paymentParams",
    "refreshPayment",
    "adminList",
    "settings",
    "saveSettings",
    "reviewAppointment",
    "finishOrder",
    "purgeIdentity",
  ]);
  // The cloud wrapper mapping is unchanged (index.js zero diff, ruling 5/T6).
  assert.equal(/code:\s*e\.status \|\| 503/.test(index), true);
  assert.equal(/msg:\s*e\.status \? e\.message/.test(index), true);
  assert.equal(/code: 0, data/.test(index), true);
});

// S1-18: corrupt/unknown records must never be treated as a fresh `none`.
test("S1-18 corrupt or unknown paymentRequest is 503 with zero writes", async (t) => {
  const fixtures = [
    ["null", null],
    ["string", "payment-broken"],
    ["number", 42],
    ["array", []],
    ["unknown-status", { status: "unknown", attemptId: "a", epoch: 1 }],
    ["missing-epoch", { status: "preparing" }],
  ];
  for (const [name, value] of fixtures) {
    const x = await setup(t),
      a = await x.prepared(),
      o = await x.order(a);
    x.row(o.id).paymentRequest = value;
    const before = structuredClone(x.store.data);
    await rejectsWithStatus(
      x.user.paymentParams(o.id),
      503,
      "PAYMENT_QUERY_UNAVAILABLE",
    );
    assertWriteSet(before, structuredClone(x.store.data));
    assert.deepEqual(x.row(o.id).paymentRequest, value, name);
    assert.equal(x.calls.create, 0, name);
    assert.equal(x.calls.query, 0, name);
  }
});

// S1-18b: a present-but-undefined value is NOT the legacy missing field, so it
// must fail closed as a corrupt record and must never be replayed as `none`.
test("S1-18b present-but-undefined paymentRequest is corrupt, not legacy none", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a);
  x.row(o.id).paymentRequest = undefined;
  assert.equal(
    Object.hasOwn(x.row(o.id), "paymentRequest"),
    true,
    "fixture must keep the own property",
  );
  const before = structuredClone(x.store.data);
  await rejectsWithStatus(
    x.user.paymentParams(o.id),
    503,
    "PAYMENT_QUERY_UNAVAILABLE",
  );
  assert.equal(x.calls.create, 0);
  assert.equal(x.calls.query, 0);
  assert.equal(Object.hasOwn(x.row(o.id), "paymentRequest"), true);
  assert.equal(x.row(o.id).paymentRequest, undefined);
  assertWriteSet(before, structuredClone(x.store.data));
});

// S1-19: unsafe epoch values and an overflowing takeover are refused.
test("S1-19 unsafe or overflowing epoch is 503 and refused without writes", async (t) => {
  const now = () => Date.now();
  const fixtures = [
    ["fractional", () => paymentRequestFixture(now(), { epoch: 1.5 })],
    ["string", () => paymentRequestFixture(now(), { epoch: "2" })],
    [
      "overflow",
      (current) =>
        paymentRequestFixture(current, {
          status: "preparing",
          attemptId: "attempt-max",
          epoch: Number.MAX_SAFE_INTEGER,
          leaseUntil: current - 1,
          externalRequestSentAt: current - 1000,
        }),
    ],
  ];
  for (const [name, build] of fixtures) {
    const x = await setup(t),
      a = await x.prepared(),
      o = await x.order(a);
    const record = build(x.now());
    x.row(o.id).paymentRequest = record;
    const before = structuredClone(x.store.data);
    await rejectsWithStatus(
      x.user.paymentParams(o.id),
      503,
      "PAYMENT_QUERY_UNAVAILABLE",
    );
    assertWriteSet(before, structuredClone(x.store.data));
    assert.deepEqual(x.row(o.id).paymentRequest, record, name);
    assert.equal(x.calls.create, 0, name);
    assert.equal(x.calls.query, 0, name);
  }
});

// S1-20: a create that returns after its own lease expired must not become
// ready or return params, even without a takeover: keep sent, close with 503.
test("S1-20 create returning after its lease expired cannot complete ready and closes with 503", async (t) => {
  const x = await setup(t),
    a = await x.prepared(),
    o = await x.order(a);
  let entered, release;
  const called = new Promise((r) => (entered = r)),
    wait = new Promise((r) => (release = r));
  x.onCreate(async () => {
    entered();
    await wait;
    return { package: "prepay_id=late-lease" };
  });
  const pending = x.user.paymentParams(o.id);
  await called;
  x.advance(61 * 1000); // the claim lease expired and nobody took over
  const before = structuredClone(x.store.data);
  const claimed = before.rental_preleases.find(
    (r) => r._id === o.id,
  ).paymentRequest;
  release();
  await rejectsWithStatus(pending, 503, "PAYMENT_QUERY_UNAVAILABLE");
  assert.equal(x.calls.create, 1);
  assert.equal(x.calls.query, 0);
  const pr = x.row(o.id).paymentRequest;
  assert.notEqual(pr.status, "ready");
  assert.equal(pr.status, "reconciling");
  assert.equal(pr.attemptId, claimed.attemptId);
  assert.equal(pr.epoch, claimed.epoch);
  assert.equal(pr.externalRequestSentAt, claimed.externalRequestSentAt);
  assert.equal(
    x.store.data.admin_audit.filter(
      (e) => e.action === "租赁预约：核对支付资格",
    ).length,
    0,
  );
  assertPaymentRequestWrite(before, structuredClone(x.store.data), o.id, 0);
});

// S1-21: a retried transaction build must re-read the clock instead of reusing a
// `now` captured before the transaction started.
test("S1-21 transaction retry re-reads now for claim and complete", async (t) => {
  // Claim retry: the payment deadline passes between the two build attempts.
  {
    const x = await setup(t),
      a = await x.prepared(),
      o = await x.order(a);
    const callCount = retryTransactionAfterClock(x, {
      call: 1,
      advanceMs: 16 * 60000,
    });
    const before = structuredClone(x.store.data);
    const error = await rejectsWithStatus(x.user.paymentParams(o.id), 409);
    assert.equal(error.message, "订单不在可支付时间内，请刷新状态");
    assert.equal(callCount(), 1);
    assert.equal(x.calls.create, 0);
    assert.equal(x.calls.query, 0);
    assertWriteSet(before, structuredClone(x.store.data));
    assert.equal(Object.hasOwn(x.row(o.id), "paymentRequest"), false);
  }
  // Complete retry: the attempt lease expires between the two build attempts.
  {
    const x = await setup(t),
      a = await x.prepared(),
      o = await x.order(a);
    x.onCreate(async () => ({ package: "prepay_id=retry-lease" }));
    const callCount = retryTransactionAfterClock(x, {
      call: 3,
      advanceMs: 61 * 1000,
    });
    await rejectsWithStatus(
      x.user.paymentParams(o.id),
      503,
      "PAYMENT_QUERY_UNAVAILABLE",
    );
    assert.equal(callCount() >= 3, true);
    assert.equal(x.calls.create, 1);
    assert.equal(x.calls.query, 0);
    const pr = x.row(o.id).paymentRequest;
    assert.notEqual(pr.status, "ready");
    assert.equal(pr.status, "reconciling");
    assert.equal(pr.externalRequestSentAt > 0, true);
    assert.equal(
      x.store.data.admin_audit.filter(
        (e) => e.action === "租赁预约：核对支付资格",
      ).length,
      0,
      "a discarded retry attempt must not leave an audit entry",
    );
  }
});

test("network guard: subject suites performed zero network calls", () => {
  assert.equal(guard.loadViolationCount(), 0);
  assert.equal(guard.runtimeViolationCount(), 0);
  assert.equal(guard.activeNetworkResources().length, 0);
});
