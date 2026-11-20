"use strict";
const {
  createHash,
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} = require("node:crypto");
const C = {
  settings: "rental_settings",
  appointments: "rental_appointments",
  orders: "rental_preleases",
  holds: "rental_room_holds",
  identity: "rental_identity_documents",
};
const ref = (collection, id) => ({ collection, id });
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const fail = (message, status = 400) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
const text = (v, label, max = 100) => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    fail(`${label}格式不正确`);
  return v.trim();
};
const id = (v) => {
  if (typeof v !== "string" || !/^[\w.-]{1,128}$/.test(v))
    fail("记录编号不正确");
  return v;
};
const money = (v, label = "金额") => {
  if (!Number.isSafeInteger(v) || v < 0 || v > 100000000)
    fail(`${label}需为有效整数分`);
  return v;
};
const safe = (r) => Boolean(r && r.isPublic !== true);
// S1 persistent single-flight states. `none` is not a stored status: only a
// wholly missing paymentRequest means the legacy "none" state (contract §4.1).
const PAYMENT_STATUSES = ["preparing", "ready", "reconciling", "failed"];
const PAYMENT_LEASE_MS = 60000;
const PAYMENT_UNAVAILABLE = "租赁服务暂不可用，请稍后重试";
const PAYMENT_QUERY_PENDING = "支付请求状态待核对，请稍后刷新";
const PAYMENT_IN_PROGRESS = "支付请求正在处理，请稍后重试";
const paymentFail = (code, message, status) => {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  throw e;
};
const queryUnavailable = () =>
  paymentFail("PAYMENT_QUERY_UNAVAILABLE", PAYMENT_QUERY_PENDING, 503);
const inProgress = () =>
  paymentFail("PAYMENT_PARAMS_IN_PROGRESS", PAYMENT_IN_PROGRESS, 409);
const read = (s, c, i) => s[`${c}/${i}`];
const write = (collection, id, data) => ({ collection, id, data });
const sum = (rent, cfg) =>
  money(Math.round(rent * cfg.depositMonths) + cfg.fixedDepositCents, "押金");
const defaults = {
  depositMonths: 2,
  fixedDepositCents: 0,
  holdHours: 72,
  paymentMinutes: 15,
  expiryPolicy: "non_refundable",
  templateVersion: 0,
  templateText: "",
  enabled: false,
};
const publicSettings = (c) => ({
  depositMonths: c.depositMonths,
  fixedDepositCents: c.fixedDepositCents,
  holdHours: c.holdHours,
  paymentMinutes: c.paymentMinutes,
  expiryPolicy: c.expiryPolicy,
  templateVersion: c.templateVersion,
  enabled: c.enabled,
  templateReady: Boolean(c.templateText),
  privacyText: c.privacyText || "",
});
function render(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!Object.hasOwn(values, k)) fail(`合同存在未支持的变量：${k}`);
    return String(values[k]);
  });
}
function imageBytes(encoded) {
  if (
    typeof encoded !== "string" ||
    encoded.length > 750000 ||
    !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  )
    fail("证件图片格式或大小不正确");
  const b = Buffer.from(encoded, "base64");
  const png = b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  const jpeg =
    b[0] === 255 &&
    b[1] === 216 &&
    b[2] === 255 &&
    b.at(-2) === 255 &&
    b.at(-1) === 217;
  if (b.length < 64 || b.length > 500 * 1024 || (!png && !jpeg))
    fail("请上传不超过 500KB 的 JPG 或 PNG 图片");
  let width = 0,
    height = 0;
  if (png) {
    width = b.readUInt32BE(16);
    height = b.readUInt32BE(20);
  } else {
    let pos = 2;
    while (pos + 4 < b.length) {
      if (b[pos] !== 255) break;
      const marker = b[pos + 1];
      pos += 2;
      if (marker === 0xda || marker === 0xd9) break;
      const length = b.readUInt16BE(pos);
      if (length < 2 || pos + length > b.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 7) {
        height = b.readUInt16BE(pos + 3);
        width = b.readUInt16BE(pos + 5);
        break;
      }
      pos += length;
    }
  }
  if (
    !width ||
    !height ||
    width > 4096 ||
    height > 4096 ||
    width * height > 16000000
  )
    fail("证件图片尺寸不正确，请重新拍摄或压缩");
  return { bytes: b, mime: png ? "image/png" : "image/jpeg" };
}
class LeasingService {
  constructor({
    store,
    actor,
    payment = null,
    identityKey = "",
    now = Date.now,
  }) {
    this.store = store;
    this.actor = actor;
    this.payment = payment;
    this.identityKey = identityKey;
    this.now = now;
  }
  audit(action) {
    return { actor: this.actor.id, action: "租赁预约：" + action };
  }
  user() {
    if (!this.actor?.id || this.actor.type !== "user")
      fail("请先授权手机号登录", 401);
  }
  admin() {
    if (!this.actor?.id || this.actor.type !== "admin")
      fail("无租赁管理权限", 403);
  }
  async rows(c) {
    return this.store.list(c);
  }
  async get(c, i) {
    if (this.store.get) return this.store.get(c, i);
    return (await this.rows(c)).find((r) => r._id === i) || null;
  }
  async config() {
    return { ...defaults, ...(await this.get(C.settings, "global")) };
  }
  key() {
    const b = Buffer.from(this.identityKey, "base64");
    if (b.length !== 32 || b.toString("base64") !== this.identityKey)
      fail("证件加密服务尚未配置", 503);
    return b;
  }
  async settings() {
    this.admin();
    return {
      ...(await this.config()),
      paymentReady: Boolean(this.payment),
      identityReady: (() => {
        try {
          this.key();
          return true;
        } catch {
          return false;
        }
      })(),
    };
  }
  async saveSettings(input) {
    this.admin();
    const c = { ...defaults };
    if (
      !Number.isFinite(input.depositMonths) ||
      input.depositMonths < 0 ||
      input.depositMonths > 12 ||
      !Number.isInteger(input.depositMonths * 10)
    )
      fail("押金月数需为 0–12，最多一位小数");
    c.depositMonths = input.depositMonths;
    c.fixedDepositCents = money(input.fixedDepositCents);
    if (
      !Number.isInteger(input.holdHours) ||
      input.holdHours < 1 ||
      input.holdHours > 720
    )
      fail("留房时长需为 1–720 小时");
    c.holdHours = input.holdHours;
    c.expiryPolicy = input.expiryPolicy;
    if (!["non_refundable", "manual_review"].includes(c.expiryPolicy))
      fail("超时处理规则不正确");
    c.templateText =
      typeof input.templateText === "string" ? input.templateText.trim() : "";
    if (c.templateText.length > 40000) fail("合同模板不能超过 40000 字");
    c.privacyText =
      typeof input.privacyText === "string" ? input.privacyText.trim() : "";
    if (c.privacyText.length > 2000) fail("证件收集说明过长");
    c.enabled = input.enabled === true;
    if (c.enabled && (!c.templateText || !c.privacyText))
      fail("启用前请填写自有合同模板和证件收集说明");
    // Never silently omit the financial terms from the contract.
    if (c.enabled)
      for (const k of [
        "tenantName",
        "roomLabel",
        "deposit",
        "holdHours",
        "expiryPolicy",
      ])
        if (!c.templateText.includes("{{" + k + "}}"))
          fail(`合同模板缺少变量 {{${k}}}`);
    render(c.templateText, {
      tenantName: "租客",
      roomLabel: "房号",
      monthlyRent: "0.00",
      deposit: "0.00",
      holdHours: c.holdHours,
      expiryPolicy: "规则",
      appointmentId: "预约编号",
    });
    await this.store.transact(
      [ref(C.settings, "global")],
      (s) => {
        const old = read(s, C.settings, "global");
        if (input.revision !== (old?.revision || 0))
          fail("配置已更新，请刷新", 409);
        return [
          write(C.settings, "global", {
            ...c,
            revision: (old?.revision || 0) + 1,
            templateVersion: (old?.templateVersion || 0) + 1,
          }),
        ];
      },
      this.audit("更新规则与模板"),
    );
    return this.settings();
  }
  async catalog(houseId) {
    const [houses, rooms, layouts, holds, cfg] = await Promise.all([
      this.rows("houses"),
      this.rows("rooms"),
      this.rows("property_catalog"),
      this.rows(C.holds),
      this.config(),
    ]);
    const anchor = houseId
      ? houses.find((h) => h._id === houseId && h.status === "在租" && safe(h))
      : null;
    const anchorRoom =
      anchor && rooms.find((r) => r._id === anchor.propertyRoomId);
    const choices = [];
    for (const h of houses) {
      const r = rooms.find((r) => r._id === h.propertyRoomId),
        layout =
          r && layouts.find((l) => l._id === r.layoutId && l.kind === "layout");
      if (
        h.status !== "在租" ||
        !safe(h) ||
        !safe(r) ||
        !layout ||
        !safe(layout) ||
        layout.parentId !== r.buildingId
      )
        continue;
      if (
        houseId &&
        (!anchor || !anchorRoom || r.buildingId !== anchorRoom.buildingId)
      )
        continue;
      const hold = holds.find((x) => x._id === r._id);
      const held = hold && hold.until > this.now();
      choices.push({
        houseId: h._id,
        roomId: r._id,
        roomNumber: r.number || r.name || h.address,
        layoutId: layout._id,
        layoutName: layout.name,
        community: r.community || h.community,
        buildingName: r.buildingName || "",
        priceCents: money(Math.round(Number(h.price) * 100), "租金"),
        available: !held,
      });
    }
    return {
      rooms: choices,
      settings: publicSettings(cfg),
      paymentReady: Boolean(this.payment),
      identityReady: (() => {
        try {
          this.key();
          return true;
        } catch {
          return false;
        }
      })(),
    };
  }
  async appointment(input) {
    this.user();
    const roomId = id(input.roomId),
      houseId = id(input.houseId),
      key = id(input.requestId);
    const at = Number(input.visitAt),
      name = text(input.name, "联系人", 40);
    if (
      !Number.isSafeInteger(at) ||
      at < this.now() + 60000 ||
      at > this.now() + 90 * 86400000
    )
      fail("请选择未来 90 天内的看房时间");
    if (!/^1\d{10}$/.test(this.actor.phone || "")) fail("请先绑定手机号", 401);
    const aid = "appt-" + hash([this.actor.id, key]).slice(0, 32),
      digest = hash([houseId, roomId, at, name]);
    let result;
    const initial = await this.get("rooms", roomId);
    if (!initial) fail("房间不存在", 404);
    await this.store.transact(
      [
        ref(C.appointments, aid),
        ref("houses", houseId),
        ref("rooms", roomId),
        ref("property_catalog", initial.layoutId),
        ref(C.holds, roomId),
      ],
      (s) => {
        const existing = read(s, C.appointments, aid);
        if (existing) {
          if (existing.requestDigest !== digest) fail("请勿复用提交编号", 409);
          result = existing;
          return [];
        }
        const h = read(s, "houses", houseId),
          r = read(s, "rooms", roomId),
          l = read(s, "property_catalog", initial.layoutId),
          hold = read(s, C.holds, roomId);
        if (
          !h ||
          h.status !== "在租" ||
          !safe(h) ||
          !safe(r) ||
          !l ||
          l.kind !== "layout" ||
          !safe(l) ||
          h.propertyRoomId !== roomId ||
          r.layoutId !== l._id ||
          l.parentId !== r.buildingId
        )
          fail("房源或户型已变更，请重新选择", 409);
        if (hold && hold.until > this.now())
          fail("该房间已被留房，请选择其他房号", 409);
        result = {
          ownerId: this.actor.id,
          phone: this.actor.phone,
          name,
          houseId,
          roomId,
          layoutId: l._id,
          roomLabel: [r.community, r.buildingName, r.number || r.name]
            .filter(Boolean)
            .join(" "),
          visitAt: at,
          status: "submitted",
          identityStatus: "missing",
          identityFrontId: null,
          identityBackId: null,
          createdAt: this.now(),
          revision: 1,
          requestDigest: digest,
        };
        return [write(C.appointments, aid, result)];
      },
      this.audit("提交看房预约"),
    );
    return this.appointmentDTO({ ...result, _id: aid });
  }
  appointmentDTO(a) {
    return {
      id: a._id,
      name: a.name,
      roomLabel: a.roomLabel,
      visitAt: a.visitAt,
      status: a.status,
      identityStatus: a.identityStatus,
      revision: a.revision,
      identityFrontId: a.identityFrontId,
      identityBackId: a.identityBackId,
    };
  }
  orderDTO(o) {
    return {
      id: o._id,
      appointmentId: o.appointmentId,
      roomLabel: o.roomLabel,
      status:
        o.status === "paid_held" && o.holdUntil <= this.now()
          ? o.expiryPolicy === "non_refundable"
            ? "expired_forfeited"
            : "expired_review"
          : o.status === "awaiting_payment" && o.paymentDeadline <= this.now()
            ? "payment_expired"
            : o.status,
      depositCents: o.depositCents,
      monthlyRentCents: o.monthlyRentCents,
      paymentDeadline: o.paymentDeadline,
      holdUntil: o.holdUntil || null,
      holdHours: o.holdHours,
      expiryPolicy: o.expiryPolicy,
      templateVersion: o.templateVersion,
      contractText: o.contractText,
      createdAt: o.createdAt,
    };
  }
  async mine() {
    this.user();
    const [a, o] = await Promise.all([
      this.store.list(C.appointments, { where: { ownerId: this.actor.id } }),
      this.store.list(C.orders, { where: { ownerId: this.actor.id } }),
    ]);
    return {
      appointments: a
        .filter((x) => x.ownerId === this.actor.id)
        .map((x) => this.appointmentDTO(x))
        .sort((a, b) => b.visitAt - a.visitAt),
      orders: o
        .filter((x) => x.ownerId === this.actor.id)
        .map((x) => this.orderDTO(x))
        .sort((a, b) => b.createdAt - a.createdAt),
    };
  }
  async uploadIdentity(input) {
    this.user();
    const cfg = await this.config();
    if (!cfg.enabled || !cfg.privacyText) fail("预签约及证件收集尚未启用", 503);
    if (input.consent !== true) fail("请先阅读并同意证件收集说明");
    if (input.privacyVersion !== cfg.templateVersion)
      fail("证件收集说明已更新，请刷新后重新同意", 409);
    const aid = id(input.appointmentId),
      side = input.side;
    if (!["front", "back"].includes(side)) fail("请选择身份证正面或反面");
    const appointment = await this.get(C.appointments, aid);
    if (!appointment || appointment.ownerId !== this.actor.id)
      fail("预约不存在", 404);
    const priorHold = await this.get(C.holds, appointment.roomId);
    const orderRef = priorHold?.orderId
      ? ref(C.orders, priorHold.orderId)
      : null;
    const key = this.key(),
      { bytes, mime } = imageBytes(input.base64),
      did = "identity-" + randomUUID(),
      iv = randomBytes(12),
      aad = Buffer.from(JSON.stringify([did, this.actor.id, aid, side]));
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad);
    const content = Buffer.concat([cipher.update(bytes), cipher.final()]);
    await this.store.transact(
      [
        ref(C.appointments, aid),
        ref(C.identity, did),
        ref(C.settings, "global"),
        ref(C.holds, appointment.roomId),
        ...(orderRef ? [orderRef] : []),
      ],
      (s) => {
        const settings = read(s, C.settings, "global");
        if (
          !settings?.enabled ||
          settings.templateVersion !== input.privacyVersion
        )
          fail("证件收集说明已更新，请刷新", 409);
        const a = read(s, C.appointments, aid);
        if (!a || a.ownerId !== this.actor.id) fail("预约不存在", 404);
        if (!["submitted", "confirmed"].includes(a.status))
          fail("预约当前不可提交证件", 409);
        const hold = read(s, C.holds, appointment.roomId);
        if (
          a.roomId !== appointment.roomId ||
          (hold?.orderId || null) !== (priorHold?.orderId || null)
        )
          fail("房间占位已变化，请刷新后重新提交材料", 409);
        const order = orderRef ? read(s, C.orders, orderRef.id) : null;
        const ownOrder =
          order?.ownerId === this.actor.id && order.appointmentId === aid;
        if (
          ownOrder &&
          ["paid_held", "signed"].includes(order.status) &&
          hold.until > this.now()
        )
          fail("已有已付款预签约订单，请联系物业处理材料变更", 409);
        const invalidate = ownOrder && order.status === "awaiting_payment";
        return [
          ...(invalidate
            ? [
                write(C.orders, order._id, {
                  ...order,
                  status: "identity_changed",
                  identityChangedAt: this.now(),
                  revision: order.revision + 1,
                }),
                write(C.holds, appointment.roomId, {
                  ...hold,
                  until: 0,
                  status: "released",
                }),
              ]
            : []),
          write(C.identity, did, {
            ownerId: this.actor.id,
            appointmentId: aid,
            side,
            mime,
            ciphertext: content.toString("base64"),
            iv: iv.toString("base64"),
            tag: cipher.getAuthTag().toString("base64"),
            consentVersion: cfg.templateVersion,
            createdAt: this.now(),
            expiresAt: this.now() + 30 * 86400000,
          }),
          write(C.appointments, aid, {
            ...a,
            [side === "front" ? "identityFrontId" : "identityBackId"]: did,
            identityStatus: "pending",
            revision: a.revision + 1,
          }),
        ];
      },
      this.audit("提交加密证件"),
    );
    return { id: did, side };
  }
  async identityFile(did) {
    this.admin();
    const d = await this.get(C.identity, id(did));
    if (!d || !d.ciphertext || d.expiresAt <= this.now())
      fail("证件已过期或不存在", 404);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key(),
      Buffer.from(d.iv, "base64"),
    );
    decipher.setAAD(
      Buffer.from(JSON.stringify([d._id, d.ownerId, d.appointmentId, d.side])),
    );
    decipher.setAuthTag(Buffer.from(d.tag, "base64"));
    let bytes;
    try {
      bytes = Buffer.concat([
        decipher.update(Buffer.from(d.ciphertext, "base64")),
        decipher.final(),
      ]);
    } catch {
      fail("证件校验失败", 409);
    }
    // An audit event contains the document ID only, never its image or decrypted bytes.
    await this.store.transact(
      [ref(C.identity, d._id)],
      () => [],
      this.audit("查阅证件 " + d._id),
    );
    return { bytes, mime: d.mime };
  }
  async reviewAppointment(input) {
    this.admin();
    const aid = id(input.id),
      a = await this.get(C.appointments, aid);
    if (!a) fail("预约不存在", 404);
    const refs = [ref(C.appointments, aid)];
    for (const x of [a.identityFrontId, a.identityBackId])
      if (x) refs.push(ref(C.identity, x));
    if (
      ![
        "confirmed",
        "rejected",
        "identity_approved",
        "identity_rejected",
      ].includes(input.decision)
    )
      fail("处理动作不正确");
    await this.store.transact(
      refs,
      (s) => {
        const current = read(s, C.appointments, aid);
        if (!current || current.revision !== input.revision)
          fail("预约已变化，请刷新", 409);
        if (!["submitted", "confirmed"].includes(current.status))
          fail("预约已结束", 409);
        const patch = { ...current, revision: current.revision + 1 };
        if (input.decision.startsWith("identity_")) {
          for (const side of ["Front", "Back"]) {
            const d = read(s, C.identity, current["identity" + side + "Id"]);
            if (
              !d ||
              !d.ciphertext ||
              d.expiresAt <= this.now() ||
              d.ownerId !== current.ownerId ||
              d.appointmentId !== aid
            )
              fail("证件不完整或已失效", 409);
          }
          patch.identityStatus =
            input.decision === "identity_approved" ? "approved" : "rejected";
          patch.identityReviewer = this.actor.id;
        } else patch.status = input.decision;
        return [write(C.appointments, aid, patch)];
      },
      this.audit("处理预约 " + input.decision),
    );
    return { ok: true };
  }
  async quote(aid) {
    this.user();
    const a = await this.get(C.appointments, id(aid));
    if (!a || a.ownerId !== this.actor.id) fail("预约不存在", 404);
    const [cfg, h] = await Promise.all([
      this.config(),
      this.get("houses", a.houseId),
    ]);
    if (!cfg.enabled || !cfg.templateText) fail("物业尚未启用合同模板", 503);
    if (a.status !== "confirmed" || a.identityStatus !== "approved")
      fail("请等待看房预约确认及身份证审核", 409);
    if (!h || !safe(h) || h.status !== "在租") fail("房源不可预签约", 409);
    const rent = money(Math.round(Number(h.price) * 100), "月租"),
      deposit = sum(rent, cfg);
    if (deposit <= 0) fail("押金金额尚未配置", 503);
    const values = {
      tenantName: a.name,
      roomLabel: a.roomLabel,
      monthlyRent: (rent / 100).toFixed(2),
      deposit: (deposit / 100).toFixed(2),
      holdHours: cfg.holdHours,
      expiryPolicy:
        cfg.expiryPolicy === "non_refundable"
          ? "留房期限届满未完成正式签约，押金不退"
          : "留房到期后由物业审核处理",
      appointmentId: aid,
    };
    const contractText = render(cfg.templateText, values),
      quoteHash = hash([
        aid,
        a.revision,
        cfg.templateVersion,
        rent,
        deposit,
        contractText,
      ]);
    return {
      appointmentId: aid,
      contractText,
      quoteHash,
      templateVersion: cfg.templateVersion,
      monthlyRentCents: rent,
      depositCents: deposit,
      holdHours: cfg.holdHours,
      expiryPolicy: cfg.expiryPolicy,
      paymentReady: Boolean(this.payment),
    };
  }
  async createOrder(input) {
    this.user();
    if (!this.payment) fail("微信支付商户尚未配置，暂不能交押金留房", 503);
    if (input.accepted !== true) fail("请先阅读并同意预签约合同和押金规则");
    const aid = id(input.appointmentId),
      oid = "lease-" + hash([this.actor.id, id(input.requestId)]).slice(0, 31);
    const previous = await this.get(C.orders, oid);
    if (previous) {
      if (
        previous.ownerId !== this.actor.id ||
        previous.appointmentId !== aid ||
        previous.quoteHash !== input.quoteHash
      )
        fail("提交编号已被使用", 409);
      return this.orderDTO(previous);
    }
    const q = await this.quote(aid),
      a = await this.get(C.appointments, aid);
    if (q.quoteHash !== input.quoteHash)
      fail("合同或押金已更新，请重新阅读确认", 409);
    const now = this.now();
    let result;
    const refs = [
      ref(C.orders, oid),
      ref(C.appointments, aid),
      ref(C.settings, "global"),
      ref("houses", a.houseId),
      ref("rooms", a.roomId),
      ref("property_catalog", a.layoutId),
      ref(C.holds, a.roomId),
      ref(C.identity, a.identityFrontId),
      ref(C.identity, a.identityBackId),
    ];
    await this.store.transact(
      refs,
      (s) => {
        const existing = read(s, C.orders, oid);
        if (existing) {
          if (
            existing.appointmentId !== aid ||
            existing.quoteHash !== input.quoteHash
          )
            fail("提交编号已被使用", 409);
          result = existing;
          return [];
        }
        const current = read(s, C.appointments, aid),
          cfg = read(s, C.settings, "global"),
          h = read(s, "houses", a.houseId),
          r = read(s, "rooms", a.roomId),
          l = read(s, "property_catalog", a.layoutId),
          hold = read(s, C.holds, a.roomId);
        if (
          !current ||
          current.ownerId !== this.actor.id ||
          current.revision !== a.revision ||
          current.status !== "confirmed" ||
          current.identityStatus !== "approved" ||
          !cfg?.enabled ||
          cfg.templateVersion !== q.templateVersion ||
          !h ||
          h.status !== "在租" ||
          !safe(h) ||
          !safe(r) ||
          !safe(l) ||
          l?.kind !== "layout" ||
          h.propertyRoomId !== r?._id ||
          r?.layoutId !== l?._id ||
          l?.parentId !== r?.buildingId ||
          Math.round(Number(h.price) * 100) !== q.monthlyRentCents
        )
          fail("房源、材料或合同已变化，请刷新", 409);
        for (const d of [
          read(s, C.identity, a.identityFrontId),
          read(s, C.identity, a.identityBackId),
        ])
          if (
            !d ||
            !d.ciphertext ||
            d.expiresAt <= now ||
            d.ownerId !== this.actor.id
          )
            fail("身份证材料已失效，请重新提交", 409);
        if (hold && hold.until > now) fail("该房间已被留房", 409);
        const paymentDeadline = now + cfg.paymentMinutes * 60000;
        result = {
          ownerId: this.actor.id,
          payerOpenid: this.actor.openid,
          appointmentId: aid,
          roomId: a.roomId,
          houseId: a.houseId,
          roomLabel: a.roomLabel,
          identityFrontId: a.identityFrontId,
          identityBackId: a.identityBackId,
          ...q,
          status: "awaiting_payment",
          paymentDeadline,
          createdAt: now,
          acceptedAt: now,
          revision: 1,
        };
        delete result.paymentReady;
        return [
          write(C.orders, oid, result),
          write(C.holds, a.roomId, {
            orderId: oid,
            until: paymentDeadline,
            status: "payment_pending",
          }),
        ];
      },
      this.audit("确认合同并创建支付订单"),
    );
    return this.orderDTO({ ...result, _id: oid });
  }
  paymentIdentityMatches(state, order, now) {
    const a = read(state, C.appointments, order.appointmentId);
    if (
      !a ||
      a.ownerId !== order.ownerId ||
      a.status !== "confirmed" ||
      a.identityStatus !== "approved" ||
      a.identityFrontId !== order.identityFrontId ||
      a.identityBackId !== order.identityBackId
    )
      return false;
    return [
      ["front", order.identityFrontId],
      ["back", order.identityBackId],
    ].every(([side, docId]) => {
      const d = read(state, C.identity, docId);
      return Boolean(
        d &&
        d._id === docId &&
        d.ownerId === order.ownerId &&
        d.appointmentId === order.appointmentId &&
        d.side === side &&
        d.ciphertext &&
        d.expiresAt > now,
      );
    });
  }
  paymentIdentityRefs(o) {
    return [
      ref(C.appointments, o.appointmentId),
      ref(C.identity, o.identityFrontId),
      ref(C.identity, o.identityBackId),
    ];
  }
  async validatePayableOrder(oid) {
    const o = await this.get(C.orders, id(oid));
    if (!o || o.ownerId !== this.actor.id) fail("订单不存在", 404);
    let checked;
    await this.store.transact(
      [
        ref(C.orders, o._id),
        ref(C.holds, o.roomId),
        ...this.paymentIdentityRefs(o),
      ],
      (state) => {
        const cur = read(state, C.orders, o._id),
          hold = read(state, C.holds, o.roomId);
        if (!cur || cur.ownerId !== this.actor.id) fail("订单不存在", 404);
        if (
          cur.status !== "awaiting_payment" ||
          cur.paymentDeadline <= this.now() ||
          hold?.orderId !== o._id ||
          hold.until <= this.now()
        )
          fail("订单不在可支付时间内，请刷新状态", 409);
        if (!this.paymentIdentityMatches(state, cur, this.now()))
          fail("身份证材料或审核状态已变化，请重新审核并确认合同", 409);
        checked = cur;
        return [];
      },
      null,
      { writeAudit: false },
    );
    return checked;
  }
  // Only a wholly missing paymentRequest is the legacy `none`/epoch 0 state.
  // `null`, non-objects, unknown statuses and unsafe epochs are corrupt/unknown
  // records and must never be treated as a fresh `none` (contract §4.1/§6).
  paymentRequestState(order) {
    if (
      !order ||
      !Object.hasOwn(order, "paymentRequest") ||
      order.paymentRequest === undefined
    )
      return { kind: "none", epoch: 0 };
    const pr = order.paymentRequest;
    if (!pr || typeof pr !== "object" || Array.isArray(pr))
      return { kind: "corrupt" };
    if (!PAYMENT_STATUSES.includes(pr.status)) return { kind: "corrupt" };
    if (!Number.isSafeInteger(pr.epoch) || pr.epoch < 0)
      return { kind: "epoch" };
    return { kind: "state", request: pr };
  }
  // Local validation, CAS, lease and externalRequestSentAt are committed by this
  // one transaction. A failure before commit aborts with zero writes; there is
  // no persisted intermediate state that a later transaction has to restore.
  async claimPaymentRequest(o) {
    const now = this.now();
    let claim = null;
    await this.store.transact(
      [
        ref(C.orders, o._id),
        ref(C.holds, o.roomId),
        ...this.paymentIdentityRefs(o),
        ref(C.settings, "global"),
      ],
      (state) => {
        const cur = read(state, C.orders, o._id),
          hold = read(state, C.holds, o.roomId);
        if (!cur || cur.ownerId !== this.actor.id) fail("订单不存在", 404);
        const seen = this.paymentRequestState(cur);
        if (seen.kind === "corrupt" || seen.kind === "epoch")
          queryUnavailable();
        let takeover = false,
          base = null;
        if (seen.kind === "state") {
          base = seen.request;
          if (base.status === "failed")
            fail("订单不在可支付时间内，请刷新状态", 409);
          if (base.status === "ready") queryUnavailable();
          if (Number.isSafeInteger(base.leaseUntil) && base.leaseUntil > now)
            inProgress();
          // `preparing` without a recorded external request cannot come from this
          // transaction; it is a damaged fixture and is never replayed as `none`.
          if (!base.externalRequestSentAt) queryUnavailable();
          if (base.epoch >= Number.MAX_SAFE_INTEGER) queryUnavailable();
          takeover = true;
        }
        if (
          cur.status !== "awaiting_payment" ||
          cur.paymentDeadline <= now ||
          hold?.orderId !== cur._id ||
          !(hold.until > now)
        )
          fail("订单不在可支付时间内，请刷新状态", 409);
        if (!this.paymentIdentityMatches(state, cur, now))
          fail("身份证材料或审核状态已变化，请重新审核并确认合同", 409);
        const attemptId = "attempt-" + randomUUID(),
          epoch = takeover ? base.epoch + 1 : 1,
          leaseUntil = now + PAYMENT_LEASE_MS,
          paymentRequest = {
            status: takeover ? "reconciling" : "preparing",
            attemptId,
            epoch,
            leaseUntil,
            startedAt: now,
            // The single place that ever writes externalRequestSentAt. It is
            // committed before the merchant create call and kept forever after.
            externalRequestSentAt: takeover ? base.externalRequestSentAt : now,
            lastQueryAt: takeover ? base.lastQueryAt || null : null,
            failedAt: takeover ? base.failedAt || null : null,
            queryEvidence: takeover ? base.queryEvidence || null : null,
            prepay: takeover ? base.prepay || null : null,
            clientParams: takeover ? base.clientParams || null : null,
          };
        claim = { attemptId, epoch, takeover, order: { ...cur, paymentRequest } };
        return [write(C.orders, cur._id, { ...cur, paymentRequest })];
      },
      null,
      { writeAudit: false },
    );
    return claim;
  }
  // Complete/reconcile writes only land when attemptId+epoch still own the
  // request; a stale attempt is rejected with zero writes and never overwrites
  // the newer epoch. `params === null` records an unconfirmed external result.
  paymentCompletionVerdict(state, { orderId, attemptId, epoch, params, now }) {
    const cur = read(state, C.orders, orderId);
    const seen = this.paymentRequestState(cur);
    if (seen.kind !== "state") return { kind: "lost" };
    const pr = seen.request;
    if (pr.attemptId !== attemptId || pr.epoch !== epoch)
      return { kind: "lost" };
    if (!["preparing", "reconciling"].includes(pr.status))
      return { kind: "lost" };
    if (!params) return { kind: "reconcile", cur, request: pr };
    if (pr.status !== "preparing") return { kind: "lost" };
    const hold = read(state, C.holds, cur.roomId);
    const binding =
      cur.status === "awaiting_payment" &&
      cur.paymentDeadline > now &&
      hold?.orderId === cur._id &&
      hold.until > now &&
      this.paymentIdentityMatches(state, cur, now);
    const prepayId =
      typeof params.package === "string"
        ? /prepay_id=([^&\s]+)/.exec(params.package)?.[1] || ""
        : "";
    if (!binding || !prepayId) return { kind: "reconcile", cur, request: pr };
    return { kind: "ready", cur, request: pr, prepayId };
  }
  async paymentVerdict(o, attemptId, epoch, params) {
    const refs = [
      ref(C.orders, o._id),
      ref(C.holds, o.roomId),
      ...this.paymentIdentityRefs(o),
    ];
    const now = this.now();
    let verdict = null;
    await this.store.transact(
      refs,
      (state) => {
        verdict = this.paymentCompletionVerdict(state, {
          orderId: o._id,
          attemptId,
          epoch,
          params,
          now,
        });
        return [];
      },
      null,
      { writeAudit: false },
    );
    return verdict;
  }
  async completePaymentRequest({ orderId, attemptId, epoch, params }) {
    const o = await this.get(C.orders, id(orderId));
    if (!o || o.ownerId !== this.actor.id) fail("订单不存在", 404);
    const refs = [
      ref(C.orders, o._id),
      ref(C.holds, o.roomId),
      ...this.paymentIdentityRefs(o),
    ];
    const now = this.now();
    let verdict = await this.paymentVerdict(o, attemptId, epoch, params);
    if (verdict.kind === "ready") {
      let wrote = false;
      try {
        // `ready` and its single success audit are committed together, so a
        // failure path can never leave a success audit behind.
        await this.store.transact(
          refs,
          (state) => {
            const again = this.paymentCompletionVerdict(state, {
              orderId: o._id,
              attemptId,
              epoch,
              params,
              now,
            });
            if (again.kind !== "ready") {
              const abort = new Error("payment-complete-retry");
              abort.paymentAbort = true;
              throw abort;
            }
            wrote = true;
            return [
              write(C.orders, again.cur._id, {
                ...again.cur,
                paymentRequest: {
                  ...again.request,
                  status: "ready",
                  leaseUntil: null,
                  prepay: { prepayId: again.prepayId, createdAt: now },
                  clientParams: params,
                },
              }),
            ];
          },
          this.audit("核对支付资格"),
        );
      } catch (e) {
        if (!e.paymentAbort) throw e;
      }
      if (wrote) return true;
      verdict = await this.paymentVerdict(o, attemptId, epoch, params);
    }
    if (verdict.kind !== "reconcile") return false;
    await this.store.transact(
      refs,
      (state) => {
        const again = this.paymentCompletionVerdict(state, {
          orderId: o._id,
          attemptId,
          epoch,
          params,
          now,
        });
        if (again.kind !== "reconcile") return [];
        return [
          write(C.orders, again.cur._id, {
            ...again.cur,
            paymentRequest: { ...again.request, status: "reconciling" },
          }),
        ];
      },
      null,
      { writeAudit: false },
    );
    return false;
  }
  async paymentParams(oid) {
    this.user();
    if (!this.payment) fail("微信支付商户尚未配置", 503);
    const orderId = id(oid);
    const o = await this.get(C.orders, orderId);
    if (!o || o.ownerId !== this.actor.id) fail("订单不存在", 404);
    const seen = this.paymentRequestState(o);
    if (seen.kind === "corrupt" || seen.kind === "epoch") queryUnavailable();
    if (seen.kind === "state") {
      const pr = seen.request;
      // `failed` is a terminal request state, not a retry entry: reuse the
      // existing order-not-payable 409 without touching any fact field.
      if (pr.status === "failed")
        fail("订单不在可支付时间内，请刷新状态", 409);
      // S1 has no prepay/signature TTL, so a stored `ready` cannot be proven
      // valid and must not be returned as a cache (contract §4.1-1 / ruling 3).
      if (pr.status === "ready") queryUnavailable();
      if (Number.isSafeInteger(pr.leaseUntil) && pr.leaseUntil > this.now())
        inProgress();
    }
    const claim = await this.claimPaymentRequest(o);
    // Taking over a request that may already have reached the merchant needs an
    // authoritative query, which S1 cannot run: fixed 503, create 0, query 0.
    if (claim.takeover) queryUnavailable();
    let params;
    try {
      params = await this.payment.create({
        order: claim.order,
        tradeNo: claim.order._id.replace("lease-", "L").slice(0, 32),
        openid: claim.order.payerOpenid,
      });
    } catch {
      // The external request may have been issued: keep the reconciling fact,
      // never roll back to `none`, never retry, never leak adapter details.
      await this.completePaymentRequest({
        orderId,
        attemptId: claim.attemptId,
        epoch: claim.epoch,
        params: null,
      });
      fail(PAYMENT_UNAVAILABLE, 503);
    }
    // A document/hold change can commit while the merchant request is in
    // flight; an unconfirmed result stays `reconciling` and returns no params.
    const ready = await this.completePaymentRequest({
      orderId,
      attemptId: claim.attemptId,
      epoch: claim.epoch,
      params,
    });
    if (!ready) queryUnavailable();
    return params;
  }
  async refreshPayment(oid) {
    this.user();
    if (!this.payment) fail("微信支付商户尚未配置", 503);
    const o = await this.get(C.orders, id(oid));
    if (!o || o.ownerId !== this.actor.id) fail("订单不存在", 404);
    if (
      !["awaiting_payment", "identity_changed", "paid_held"].includes(o.status)
    )
      return this.orderDTO(o);
    const p = await this.payment.query(
      o._id.replace("lease-", "L").slice(0, 32),
    );
    if (p.trade_state === "SUCCESS") await this.applyPayment(p);
    else if (["CLOSED", "REVOKED", "PAYERROR"].includes(p.trade_state))
      await this.closeUnpaid(o);
    return this.orderDTO(await this.get(C.orders, o._id));
  }
  async closeUnpaid(o) {
    await this.store.transact(
      [ref(C.orders, o._id), ref(C.holds, o.roomId)],
      (s) => {
        const cur = read(s, C.orders, o._id),
          hold = read(s, C.holds, o.roomId);
        if (cur.status !== "awaiting_payment") return [];
        return [
          write(C.orders, o._id, {
            ...cur,
            status: "payment_closed",
            revision: cur.revision + 1,
          }),
          ...(hold?.orderId === o._id
            ? [
                write(C.holds, o.roomId, {
                  ...hold,
                  until: 0,
                  status: "released",
                }),
              ]
            : []),
        ];
      },
      this.audit("核对未付款关闭"),
    );
  }
  async applyPayment(p) {
    // Only called with a verified WeChat response/notification, never a client success flag.
    if (p.trade_state !== "SUCCESS") return { ok: true };
    if (!/^L[a-f0-9]{31}$/.test(p.out_trade_no || ""))
      fail("支付订单编号不正确", 409);
    const o = await this.get(C.orders, "lease-" + p.out_trade_no.slice(1));
    if (!o) fail("支付订单不存在", 404);
    if (
      p.appid !== this.payment?.appid ||
      p.mchid !== this.payment?.mchid ||
      p.amount?.total !== o.depositCents ||
      p.amount?.currency !== "CNY" ||
      p.payer?.openid !== o.payerOpenid ||
      typeof p.transaction_id !== "string"
    )
      fail("支付核验不一致", 409);
    const paidAt = Date.parse(p.success_time);
    if (
      !Number.isSafeInteger(paidAt) ||
      paidAt < o.createdAt ||
      paidAt > this.now() + 60000
    )
      fail("支付时间不正确", 409);
    await this.store.transact(
      [
        ref(C.orders, o._id),
        ref(C.holds, o.roomId),
        ...this.paymentIdentityRefs(o),
      ],
      (s) => {
        const cur = read(s, C.orders, o._id),
          hold = read(s, C.holds, o.roomId);
        if (cur.transactionId) {
          if (cur.transactionId !== p.transaction_id) fail("支付流水冲突", 409);
          return [];
        }
        const eligible =
          cur.status === "awaiting_payment" &&
          paidAt <= cur.paymentDeadline &&
          hold?.orderId === o._id &&
          this.paymentIdentityMatches(s, cur, this.now());
        const until = paidAt + cur.holdHours * 3600000;
        const status = !eligible
          ? "refund_required"
          : until <= this.now()
            ? cur.expiryPolicy === "non_refundable"
              ? "expired_forfeited"
              : "expired_review"
            : "paid_held";
        return [
          write(C.orders, o._id, {
            ...cur,
            status,
            transactionId: p.transaction_id,
            paidAt,
            holdUntil: eligible ? until : null,
            revision: cur.revision + 1,
          }),
          ...(eligible
            ? [write(C.holds, o.roomId, { orderId: o._id, until, status })]
            : []),
        ];
      },
      this.audit("核验微信支付"),
    );
    return { ok: true };
  }
  async adminList() {
    this.admin();
    const [a, o] = await Promise.all([
      this.rows(C.appointments),
      this.rows(C.orders),
    ]);
    return {
      appointments: a
        .map((x) => ({ ...this.appointmentDTO(x), phone: x.phone }))
        .sort((a, b) => b.visitAt - a.visitAt),
      orders: o
        .map((x) => this.orderDTO(x))
        .sort((a, b) => b.createdAt - a.createdAt),
    };
  }
  async finishOrder(input) {
    this.admin();
    const oid = id(input.id),
      o = await this.get(C.orders, oid);
    if (!o) fail("订单不存在", 404);
    await this.store.transact(
      [
        ref(C.orders, oid),
        ref(C.holds, o.roomId),
        ref("houses", o.houseId),
        ...this.paymentIdentityRefs(o),
      ],
      (s) => {
        const cur = read(s, C.orders, oid),
          hold = read(s, C.holds, o.roomId);
        if (
          cur.status !== "paid_held" ||
          cur.holdUntil <= this.now() ||
          hold?.orderId !== oid
        )
          fail("订单不在有效留房期内", 409);
        // A revoked/returned appointment or changed/rejected/expired identity
        // must never be promoted to the completed state.
        if (!this.paymentIdentityMatches(s, cur, this.now()))
          fail("预约或身份证审核已变化，不能完成正式签约", 409);
        return [
          write("houses", o.houseId, {
            ...read(s, "houses", o.houseId),
            status: "已租",
          }),
          write(C.orders, oid, {
            ...cur,
            status: "signed",
            signedAt: this.now(),
            revision: cur.revision + 1,
          }),
          write(C.holds, o.roomId, {
            ...hold,
            until: 8640000000000000,
            status: "signed",
          }),
        ];
      },
      this.audit("确认已完成正式签约"),
    );
    return { ok: true };
  }
  async purgeIdentity() {
    this.admin();
    const docs = (
      await this.store.list(C.identity, {
        fields: ["_id", "expiresAt", "purgedAt"],
      })
    ).filter((d) => !d.purgedAt && d.expiresAt <= this.now());
    for (const d of docs)
      await this.store.transact(
        [ref(C.identity, d._id)],
        (s) => {
          const cur = read(s, C.identity, d._id);
          return cur && cur.expiresAt <= this.now()
            ? [
                write(C.identity, d._id, {
                  ...cur,
                  ciphertext: "",
                  iv: "",
                  tag: "",
                  purgedAt: this.now(),
                }),
              ]
            : [];
        },
        this.audit("清理到期证件"),
      );
    return { purged: docs.length };
  }
  async dispatch(action, input = {}) {
    const handlers = {
      catalog: () => this.catalog(input.houseId),
      appointment: () => this.appointment(input),
      mine: () => this.mine(),
      uploadIdentity: () => this.uploadIdentity(input),
      quote: () => this.quote(input.appointmentId),
      createOrder: () => this.createOrder(input),
      paymentParams: () => this.paymentParams(input.id),
      refreshPayment: () => this.refreshPayment(input.id),
      adminList: () => this.adminList(),
      settings: () => this.settings(),
      saveSettings: () => this.saveSettings(input),
      reviewAppointment: () => this.reviewAppointment(input),
      finishOrder: () => this.finishOrder(input),
      purgeIdentity: () => this.purgeIdentity(),
    };
    if (!Object.hasOwn(handlers, action)) fail("不支持的租赁操作");
    return handlers[action]();
  }
}
module.exports = { LeasingService, C, defaults, render, hash };
