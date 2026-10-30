/**
 * 获取通通锁账号下所有门锁列表
 * 直接运行测试即可，无需传参
 */
const cloud = require('wx-server-sdk');
const fetch = require('node-fetch');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const TTLOCK_AUTH_URL = 'https://cnapi.ttlock.com';
const TTLOCK_API_URL  = 'https://api.sciener.com';

exports.main = async () => {
  try {
    // 1. 读取配置
    const res = await db.collection('sys_config')
      .where({
        key: _.in([
          'ttlock_client_id',
          'ttlock_client_secret',
          'ttlock_username',
          'ttlock_password_md5',
          'ttlock_token'
        ])
      }).get();

    const cfg = {};
    res.data.forEach(item => { cfg[item.key] = item.value; });

    // 2. 获取 access_token
    let accessToken = null;
    if (cfg.ttlock_token) {
      try {
        const cached = JSON.parse(cfg.ttlock_token);
        if (cached.expireTime > Date.now()) {
          accessToken = cached.access_token;
        }
      } catch (_) {}
    }

    if (!accessToken) {
      const body = new URLSearchParams();
      body.append('clientId', cfg.ttlock_client_id);
      body.append('clientSecret', cfg.ttlock_client_secret);
      body.append('username', cfg.ttlock_username);
      body.append('password', cfg.ttlock_password_md5);

      const tokenRes = await fetch(`${TTLOCK_AUTH_URL}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        return { code: 500, msg: '获取 token 失败', detail: tokenData };
      }
      accessToken = tokenData.access_token;
    }

    // 3. 获取锁列表
    const body = new URLSearchParams();
    body.append('clientId', cfg.ttlock_client_id);
    body.append('accessToken', accessToken);
    body.append('date', String(Date.now()));
    body.append('pageNo', '1');
    body.append('pageSize', '50');

    const listRes = await fetch(`${TTLOCK_API_URL}/v3/lock/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const listData = await listRes.json();

    return {
      code: 0,
      msg: '获取成功',
      total: listData.total || (listData.list ? listData.list.length : 0),
      locks: (listData.list || []).map(lock => ({
        lockId: lock.lockId,
        lockName: lock.lockName || lock.lockAlias || '未命名',
        lockMac:  lock.lockMac,
        lockData: lock.lockData,
        electricQuantity: lock.electricQuantity,
        hasGateway: lock.hasGateway || false,
        groupId: lock.groupId,
        // 返回原始字段供参考
        _raw: lock,
      })),
    };

  } catch (err) {
    return { code: 500, msg: err.message };
  }
};
