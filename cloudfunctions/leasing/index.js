"use strict";
const cloud = require("wx-server-sdk");
const { LeasingService } = require("./domain");
const { createWechatPay } = require("./wechat-pay");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const store = require("./store").createStore(db);
exports.main = async (event = {}) => {
  const payment = createWechatPay(),
    headers = Object.fromEntries(
      Object.entries(event?.headers || {}).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
  if (event?.httpMethod) {
    try {
      if (event.httpMethod !== "POST" || !payment)
        throw new Error("Unavailable");
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body;
      if (typeof raw !== "string" || Buffer.byteLength(raw) > 100000)
        throw new Error("Invalid notification");
      const p = payment.notification(headers, raw);
      await new LeasingService({
        store,
        payment,
        actor: { id: "wechat-pay", type: "system" },
      }).applyPayment(p);
      return {
        statusCode: 200,
        body: JSON.stringify({ code: "SUCCESS", message: "成功" }),
      };
    } catch {
      return {
        statusCode: 500,
        body: JSON.stringify({ code: "FAIL", message: "支付通知未完成核验" }),
      };
    }
  }
  try {
    const { OPENID, SOURCE } = cloud.getWXContext();
    if (SOURCE === "wx_trigger" && event.Type === "Timer") {
      const service = new LeasingService({
        store,
        actor: { id: "rental-retention-job", type: "admin" },
      });
      return { code: 0, data: await service.purgeIdentity() };
    }
    const users = OPENID
      ? (await db.collection("users").where({ _openid: OPENID }).limit(2).get())
          .data
      : [];
    if (users.length !== 1 || !users[0].phone)
      return { code: 401, msg: "请先授权手机号登录" };
    const user = users[0];
    // Client event fields never determine the user, amount, permissions or payment state.
    const actor = {
      id: user._id,
      openid: OPENID,
      phone: user.phone,
      type: "user",
    };
    const service = new LeasingService({
      store,
      actor,
      payment,
      identityKey: process.env.RENTAL_IDENTITY_KEY_B64 || "",
    });
    if (event.action === "catalog")
      return { code: 0, data: await service.catalog(event.input?.houseId) };
    const data = await service.dispatch(event.action, event.input || {});
    return { code: 0, data };
  } catch (e) {
    return {
      code: e.status || 503,
      msg: e.status ? e.message : "租赁服务暂不可用，请稍后重试",
    };
  }
};
