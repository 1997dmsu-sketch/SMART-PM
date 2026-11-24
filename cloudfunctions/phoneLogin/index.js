/** Verified phone login, preserving the same canonical WeChat user. */
'use strict';
const { withIdentity, putDoc, publicUser } = require('./lib/identity-core');

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
      // 手机号跨微信身份歧义失败关闭：同一手机号只允许归属一个用户。
      // 查询依赖 users.phone 索引；索引缺失等基础设施错误保持登录可用（fail-open），部署侧需补建索引。
      try {
        const sameWechat = await database.collection('users').where({ _openid: context.OPENID }).limit(2).get();
        const candidateId = sameWechat && Array.isArray(sameWechat.data) && sameWechat.data.length === 1
          ? sameWechat.data[0]._id : null;
        const byPhone = await database.collection('users').where({ phone }).limit(2).get();
        if (byPhone && Array.isArray(byPhone.data)
          && byPhone.data.some((user) => user._id !== candidateId)) {
          return { code: 409, msg: '该手机号已关联其他微信身份，请使用原微信登录' };
        }
      } catch { /* 查询不可用时保持登录可用，不因此阻断注册。 */ }
      // 注册本身不自动新增房屋或门禁权限：不再导入旧 owners 行；合法绑定仅由可信后台维护。
      return await withIdentity({ db: database, context, now }, async ({ tx, trusted, user, timestamp }) => {
        const next = { ...user, phone, phoneBoundAt: timestamp, lastLoginAt: timestamp };
        if (trusted.unionid) next.unionid = trusted.unionid;
        await putDoc(tx, 'users', user._id, next);
        const userInfo = publicUser(next);
        return { code: 0, phone, bound: userInfo.houses.length > 0, userInfo };
      });
    } catch { return { code: 'SERVICE_UNAVAILABLE', msg: '登录服务暂不可用' }; }
  };
}
exports.createMain = createMain;
exports.main = createMain();
