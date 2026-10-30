/**
 * 获取指定锁的蓝牙开门钥匙（lockData）
 *
 * 蓝牙开门需要 lockData（管理员电子钥匙数据），
 * 通过 TTLock Cloud API /v3/key/list 获取。
 *
 * 入参：{ lockId }
 * 返回：{ code, data: { lockData, lockId, lockMac, lockName, keyId, serverTime } }
 */
const cloud = require('wx-server-sdk');
const fetch = require('node-fetch');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const TTLOCK_AUTH_URL = 'https://cnapi.ttlock.com';
const TTLOCK_API_URL = 'https://api.sciener.com';

async function getToken(cfg) {
  // 先看缓存
  if (cfg.ttlock_token) {
    try {
      const cached = JSON.parse(cfg.ttlock_token);
      if (cached.expireTime > Date.now()) return cached.access_token;
    } catch (_) {}
  }

  const body = new URLSearchParams();
  body.append('clientId', cfg.ttlock_client_id);
  body.append('clientSecret', cfg.ttlock_client_secret);
  body.append('username', cfg.ttlock_username);
  body.append('password', cfg.ttlock_password_md5);

  const r = await fetch(`${TTLOCK_AUTH_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`获取 token 失败: ${JSON.stringify(d)}`);

  // 回写缓存
  const expireTime = Date.now() + (d.expires_in - 86400) * 1000;
  const val = JSON.stringify({ access_token: d.access_token, expireTime });
  const rec = await db.collection('sys_config').where({ key: 'ttlock_token' }).get();
  if (rec.data.length) {
    await db.collection('sys_config').doc(rec.data[0]._id).update({ data: { value: val } });
  } else {
    await db.collection('sys_config').add({ data: { key: 'ttlock_token', value: val } });
  }
  return d.access_token;
}

// 权限校验：admin / 测试模式 / public / users.houses 含 houseId 任一放行
async function checkAccess(openid, houseId) {
  if (!openid) return true; // 测试模式
  const user = await db.collection('users').where({ _openid: openid }).get();
  if (user.data.length && user.data[0].role === 'admin') return true;
  const houses = user.data.length ? (user.data[0].houses || []) : [];
  return Array.isArray(houses) && (houses.includes(houseId) || houseId === 'public');
}

exports.main = async (event) => {
  const { lockId } = event || {};
  if (!lockId) return { code: 400, msg: '缺少 lockId 参数' };
  const { OPENID } = cloud.getWXContext();
  const uid = OPENID || 'test_user';

  try {
    // 0. 权限校验：按 lockId 取 houseId，未绑定该房产则拒绝
    const devRes = await db.collection('devices').where({ lockId: Number(lockId) }).get();
    if (!devRes.data.length) return { code: 403, msg: '门禁设备不存在' };
    const houseId = devRes.data[0].houseId;
    if (!(await checkAccess(uid, houseId))) return { code: 403, msg: '您未绑定该门禁对应的房产' };

    // 1. 读配置
    const res = await db.collection('sys_config')
      .where({ key: _.in(['ttlock_client_id', 'ttlock_client_secret', 'ttlock_username', 'ttlock_password_md5', 'ttlock_token']) })
      .get();
    const cfg = {};
    res.data.forEach(i => { cfg[i.key] = i.value; });

    // 2. 取 token
    const accessToken = await getToken(cfg);

    // 3. 取钥匙列表，找该锁的管理员钥匙
    const body = new URLSearchParams();
    body.append('clientId', cfg.ttlock_client_id);
    body.append('accessToken', accessToken);
    body.append('pageNo', '1');
    body.append('pageSize', '1000');
    body.append('date', String(Date.now()));

    const r = await fetch(`${TTLOCK_API_URL}/v3/key/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const d = await r.json();

    const key = (d.list || []).find(k => String(k.lockId) === String(lockId));
    if (!key) {
      return { code: 404, msg: `未找到 lockId=${lockId} 的钥匙` };
    }

    return {
      code: 0,
      msg: '获取成功',
      data: {
        keyId: key.keyId,
        lockId: key.lockId,
        lockData: key.lockData,
        lockMac: key.lockMac,
        lockName: key.lockName || key.lockAlias,
        userType: key.userType,
        // 服务器时间，供 controlLock 的 serverTime 参数使用（避免手机时间不准）
        serverTime: Date.now(),
      },
    };

  } catch (err) {
    return { code: 500, msg: err.message };
  }
};
