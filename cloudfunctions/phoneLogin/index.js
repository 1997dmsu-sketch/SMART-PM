/** Verified phone login, preserving the same canonical WeChat user. */
'use strict';
const { closedInput, validateContext, validId, fail, checkedQuery, withIdentity, putDoc, publicUser } = require('./lib/identity-core');
const { validPhone, bindPhone } = require('./lib/phone-proof');

function createMain({ cloud, db, now = Date.now } = {}) {
  let sdk = cloud;
  return async (event = {}) => {
    try {
      const input = closedInput(event, ['code']);
      if (typeof input.code !== 'string' || !input.code || input.code.length > 2048 || /[\s\x00-\x1f\x7f]/.test(input.code)) fail('INVALID_INPUT', 400);
      if (!sdk) { sdk = require('wx-server-sdk'); sdk.init({ env: sdk.DYNAMIC_CURRENT_ENV }); }
      const context = sdk.getWXContext();
      const verifiedContext = validateContext(context);
      const identityContext = { APPID: verifiedContext.appId, OPENID: verifiedContext.openid, UNIONID: verifiedContext.unionid };
      const database = db || sdk.database();
      let phone;
      try {
        const result = await sdk.openapi.phonenumber.getPhoneNumber({ code: input.code });
        if (result && ((result.errCode !== undefined && result.errCode !== 0)
          || (result.errno !== undefined && result.errno !== 0))) return { code: 500, msg: '获取手机号失败' };
        phone = result && result.phoneInfo && result.phoneInfo.purePhoneNumber;
        if (!validPhone(phone)) return { code: 500, msg: '未获取到手机号' };
      } catch (error) {
        return { code: 500, msg: error && (error.errno === 1400001 || error.errCode === 1400001)
          ? '手机号验证额度已用完，请联系管理员充值' : '获取手机号失败' };
      }
      // Historical ambiguity preflight is read-only and fails closed. The point
      // binding below serializes every supported phone writer in the transaction.
      const byPhone = checkedQuery(await database.collection('users').where({ phone }).limit(2).get());
      if (byPhone.data.length > 1) fail('PHONE_CONFLICT', 409);
      const candidate = byPhone.data.length ? byPhone.data[0] : null;
      if (byPhone.data.length && (!candidate || !validId(candidate._id) || candidate.phone !== phone)) fail('IDENTITY_UNVERIFIED');
      // Registration never imports owners or grants houses/door permissions.
      return await withIdentity({ db: database, context: identityContext, now }, async ({ tx, trusted, identity, user, timestamp }) => {
        if (candidate && candidate._id !== user._id) fail('PHONE_CONFLICT', 409);
        await bindPhone(tx, { trusted, identity, user, phone, timestamp });
        const next = { ...user, phone, phoneBoundAt: timestamp, lastLoginAt: timestamp };
        if (trusted.unionid) next.unionid = trusted.unionid;
        await putDoc(tx, 'users', user._id, next);
        const userInfo = publicUser(next);
        return { code: 0, phone, bound: userInfo.houses.length > 0, userInfo };
      });
    } catch (error) {
      if (error && error.code === 'INVALID_INPUT') return { code: 400, msg: '手机号授权参数无效' };
      if (error && error.code === 'AUTH_FAILED') return { code: 403, msg: '无法识别身份' };
      if (error && error.code === 'PHONE_CONFLICT') return { code: 409, msg: '手机号关联存在冲突，请联系管理员' };
      return { code: 'SERVICE_UNAVAILABLE', msg: '登录服务暂不可用' };
    }
  };
}
exports.createMain = createMain;
exports.main = createMain();
