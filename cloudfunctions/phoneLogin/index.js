/** Verified phone login, preserving the same canonical WeChat user. */
'use strict';
const { withIdentity, putDoc, publicUser, validId } = require('./lib/identity-core');

function createMain({ cloud, db, now = Date.now } = {}) {
  let sdk = cloud;
  return async (event = {}) => {
    if (!event || typeof event.code !== 'string' || !event.code) return { code: 400, msg: '缺少 code' };
    try {
      if (!sdk) { sdk = require('wx-server-sdk'); sdk.init({ env: sdk.DYNAMIC_CURRENT_ENV }); }
      const context = sdk.getWXContext();
      if (!context || !context.OPENID) return { code: 403, msg: '无法识别身份' };
      const database = db || sdk.database();
      let phone;
      try {
        const result = await sdk.openapi.phonenumber.getPhoneNumber({ code: event.code });
        phone = result && result.phoneInfo && result.phoneInfo.purePhoneNumber;
        if (typeof phone !== 'string' || !phone || phone.length > 32 || /[\x00-\x1f\x7f]/.test(phone)) {
          return { code: 500, msg: '未获取到手机号' };
        }
      } catch (error) {
        return { code: 500, msg: error && (error.errno === 1400001 || error.errCode === 1400001)
          ? '手机号验证额度已用完，请联系管理员充值' : '获取手机号失败' };
      }
      // Optional compatibility lookup; ambiguous/unavailable owners do not grant houses.
      let owner = null;
      try {
        const result = await database.collection('owners').where({ phone }).limit(2).get();
        if (result && Array.isArray(result.data) && result.data.length === 1) owner = result.data[0];
      } catch { /* Existing owner binding survives an unavailable legacy collection. */ }
      return await withIdentity({ db: database, context, now }, async ({ tx, trusted, user, timestamp }) => {
        const next = { ...user, phone, phoneBoundAt: timestamp, lastLoginAt: timestamp };
        if (trusted.unionid) next.unionid = trusted.unionid;
        // Re-check the current transactional value, not the earlier profile.
        if (owner && user.housesManaged !== true) {
          next.houses = Array.isArray(owner.houses) ? owner.houses.map((house) => house && house.houseId).filter(validId) : [];
          if (typeof owner.name === 'string' && owner.name.length <= 128 && !/[\x00-\x1f\x7f]/.test(owner.name)) next.name = owner.name;
        }
        await putDoc(tx, 'users', user._id, next);
        const userInfo = publicUser(next);
        return { code: 0, phone, bound: userInfo.houses.length > 0, userInfo };
      });
    } catch { return { code: 'SERVICE_UNAVAILABLE', msg: '登录服务暂不可用' }; }
  };
}
exports.createMain = createMain;
exports.main = createMain();
