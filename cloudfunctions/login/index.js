/** WeChat silent login: canonical server identity, never a client-selected user. */
'use strict';
const { withIdentity, putDoc, publicUser } = require('./lib/identity-core');

function createMain({ cloud, db, now = Date.now } = {}) {
  let sdk = cloud;
  return async () => {
    try {
      if (!sdk) { sdk = require('wx-server-sdk'); sdk.init({ env: sdk.DYNAMIC_CURRENT_ENV }); }
      const context = sdk.getWXContext();
      if (!context || !context.OPENID) return { code: 403, msg: '无法识别身份' };
      return await withIdentity({ db: db || sdk.database(), context, now }, async ({ tx, trusted, user, isNew, timestamp }) => {
        const next = { ...user, lastLoginAt: timestamp };
        if (trusted.unionid) next.unionid = trusted.unionid;
        await putDoc(tx, 'users', user._id, next);
        return { code: 0, isNew, openid: trusted.openid, userInfo: publicUser(next) };
      });
    } catch { return { code: 'SERVICE_UNAVAILABLE', msg: '登录服务暂不可用' }; }
  };
}
exports.createMain = createMain;
exports.main = createMain();
