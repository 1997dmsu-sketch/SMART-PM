'use strict';
const { TenantAccountService } = require('./lib/service');
const { closedInput } = require('./lib/identity-core');

function createMain({ cloud, db, now = Date.now } = {}) {
  let sdk = cloud;
  return async (event = {}) => {
    try {
      const input = closedInput(event, ['action', 'username', 'password']);
      if (input.action !== 'login') return { code: 'AUTH_FAILED', msg: '账号或密码错误，或账号暂不可用' };
      if (!sdk) { sdk = require('wx-server-sdk'); sdk.init({ env: sdk.DYNAMIC_CURRENT_ENV }); }
      const service = new TenantAccountService({ db: db || sdk.database(), now });
      const context = sdk.getWXContext();
      return service.login(context, { username: input.username, password: input.password });
    } catch (error) {
      return error && ['AUTH_FAILED', 'INVALID_INPUT'].includes(error.code)
        ? { code: 'AUTH_FAILED', msg: '账号或密码错误，或账号暂不可用' }
        : { code: 'SERVICE_UNAVAILABLE', msg: '登录服务暂不可用' };
    }
  };
}
exports.createMain = createMain;
exports.main = createMain();
