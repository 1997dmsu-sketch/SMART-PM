"use strict";
const https = require("node:https");
const {
  createSign,
  createVerify,
  randomBytes,
  createDecipheriv,
} = require("node:crypto");
const failure = () => {
  const e = new Error("微信支付暂不可用，请稍后查询订单状态");
  e.status = 503;
  throw e;
};
function createWechatPay(env = process.env) {
  const vars = [
    "WX_PAY_APPID",
    "WX_PAY_MCHID",
    "WX_PAY_SERIAL",
    "WX_PAY_PRIVATE_KEY",
    "WX_PAY_PLATFORM_SERIAL",
    "WX_PAY_PLATFORM_PUBLIC_KEY",
    "WX_PAY_API_V3_KEY",
    "WX_PAY_NOTIFY_URL",
  ];
  if (vars.some((k) => !env[k])) return null;
  const appid = env.WX_PAY_APPID,
    mchid = env.WX_PAY_MCHID;
  if (
    !/^wx[0-9a-f]{16}$/.test(appid) ||
    !/^\d{6,20}$/.test(mchid) ||
    Buffer.byteLength(env.WX_PAY_API_V3_KEY) !== 32 ||
    !/^https:\/\//.test(env.WX_PAY_NOTIFY_URL)
  )
    return null;
  const sign = (message) => {
    const s = createSign("RSA-SHA256");
    s.update(message);
    return s.sign(env.WX_PAY_PRIVATE_KEY, "base64");
  };
  function verify(headers, body) {
    const serial = headers["wechatpay-serial"],
      stamp = headers["wechatpay-timestamp"],
      nonce = headers["wechatpay-nonce"],
      signature = headers["wechatpay-signature"];
    if (
      serial !== env.WX_PAY_PLATFORM_SERIAL ||
      !/^\d{10}$/.test(stamp || "") ||
      Math.abs(Date.now() / 1000 - Number(stamp)) > 300 ||
      typeof nonce !== "string" ||
      !nonce ||
      typeof signature !== "string"
    )
      failure();
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${stamp}\n${nonce}\n${body}\n`);
    if (!verifier.verify(env.WX_PAY_PLATFORM_PUBLIC_KEY, signature, "base64"))
      failure();
  }
  async function request(method, path, data) {
    const body = data ? JSON.stringify(data) : "",
      nonce = randomBytes(16).toString("hex"),
      timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(
      `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`,
    );
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.mch.weixin.qq.com",
          path,
          method,
          timeout: 15000,
          headers: {
            Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${env.WX_PAY_SERIAL}",signature="${signature}"`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "SMART-PM/leasing",
          },
        },
        (res) => {
          let body = "",
            tooLarge = false;
          res.on("data", (chunk) => {
            body += chunk;
            if (Buffer.byteLength(body) > 1000000) {
              tooLarge = true;
              res.destroy();
            }
          });
          res.on("error", () => reject(new Error("支付响应读取失败")));
          res.on("end", () => {
            try {
              if (tooLarge) failure();
              verify(res.headers, body);
              if (res.statusCode < 200 || res.statusCode >= 300) failure();
              resolve(JSON.parse(body));
            } catch {
              const e = new Error("微信支付响应未通过核验，请查询订单状态");
              e.status = 503;
              reject(e);
            }
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", () => {
        const e = new Error("微信支付连接失败，请稍后查询订单");
        e.status = 503;
        reject(e);
      });
      if (body) req.write(body);
      req.end();
    });
  }
  return {
    appid,
    mchid,
    verify,
    async create({ order, tradeNo, openid }) {
      const p = await request("POST", "/v3/pay/transactions/jsapi", {
        appid,
        mchid,
        description: "租赁预签约押金",
        out_trade_no: tradeNo,
        time_expire: new Date(order.paymentDeadline).toISOString(),
        notify_url: env.WX_PAY_NOTIFY_URL,
        amount: { total: order.depositCents, currency: "CNY" },
        payer: { openid },
      });
      if (typeof p.prepay_id !== "string") failure();
      const timeStamp = String(Math.floor(Date.now() / 1000)),
        nonceStr = randomBytes(16).toString("hex"),
        pkg = "prepay_id=" + p.prepay_id;
      return {
        timeStamp,
        nonceStr,
        package: pkg,
        signType: "RSA",
        paySign: sign(`${appid}\n${timeStamp}\n${nonceStr}\n${pkg}\n`),
      };
    },
    query: (tradeNo) =>
      request(
        "GET",
        `/v3/pay/transactions/out-trade-no/${encodeURIComponent(tradeNo)}?mchid=${encodeURIComponent(mchid)}`,
      ),
    notification(headers, raw) {
      verify(headers, raw);
      const event = JSON.parse(raw);
      if (event.event_type !== "TRANSACTION.SUCCESS") failure();
      const r = event.resource;
      if (r?.algorithm !== "AEAD_AES_256_GCM") failure();
      const encrypted = Buffer.from(r.ciphertext, "base64"),
        decipher = createDecipheriv(
          "aes-256-gcm",
          Buffer.from(env.WX_PAY_API_V3_KEY),
          Buffer.from(r.nonce),
        );
      decipher.setAAD(Buffer.from(r.associated_data || ""));
      decipher.setAuthTag(encrypted.subarray(-16));
      return JSON.parse(
        Buffer.concat([
          decipher.update(encrypted.subarray(0, -16)),
          decipher.final(),
        ]).toString("utf8"),
      );
    },
  };
}
module.exports = { createWechatPay };
