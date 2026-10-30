/**
 * 一键开门云函数 — 双平台支持
 *
 *   TTLock（通通锁）: OAuth Password → cnapi.ttlock.com / api.sciener.com
 *   Tuya（涂鸦）:     HMAC-SHA256 签名 → openapi.tuyacn.com
 *
 * 根据设备的 platform 字段自动路由到正确的 API。
 */
const cloud = require('wx-server-sdk');
const fetch = require('node-fetch');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// ─── 常量 ───
const TTLOCK_AUTH = 'https://cnapi.ttlock.com';
const TTLOCK_API  = 'https://api.sciener.com';
const TUYA_API    = 'https://openapi.tuyacn.com';

// ─── 缓存 ───
let ttlCache = null;
let tuyaCache = null;

// ═══════════════════════════════════════
// 通通锁 (TTLock)
// ═══════════════════════════════════════

async function ttlockGetToken() {
  const now = Date.now();
  if (ttlCache && ttlCache.expireTime > now) return ttlCache;

  const res = await db.collection('sys_config')
    .where({ key: _.in(['ttlock_client_id','ttlock_client_secret','ttlock_username','ttlock_password_md5','ttlock_token']) })
    .get();
  const cfg = {};
  res.data.forEach(i => { cfg[i.key] = i.value; });

  // 检查缓存
  if (cfg.ttlock_token) {
    try {
      const c = JSON.parse(cfg.ttlock_token);
      if (c.expireTime > now) {
        ttlCache = { accessToken: c.access_token, expireTime: c.expireTime, clientId: cfg.ttlock_client_id };
        return ttlCache;
      }
    } catch (_) {}
  }

  // 重新获取
  const body = new URLSearchParams();
  body.append('clientId',     cfg.ttlock_client_id);
  body.append('clientSecret', cfg.ttlock_client_secret);
  body.append('username',     cfg.ttlock_username);
  body.append('password',     cfg.ttlock_password_md5);

  const r = await fetch(`${TTLOCK_AUTH}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`TTLock 鉴权失败: ${JSON.stringify(d)}`);

  const expireTime = now + (d.expires_in - 86400) * 1000;

  // 缓存
  const record = res.data.find(i => i.key === 'ttlock_token');
  const val = JSON.stringify({ access_token: d.access_token, expireTime });
  if (record) {
    await db.collection('sys_config').doc(record._id).update({ data: { value: val } });
  } else {
    await db.collection('sys_config').add({ data: { key: 'ttlock_token', value: val } });
  }

  ttlCache = { accessToken: d.access_token, expireTime, clientId: cfg.ttlock_client_id };
  return ttlCache;
}

async function ttlockUnlock(device) {
  const cfg = await ttlockGetToken();
  const body = new URLSearchParams();
  body.append('clientId',    cfg.clientId);
  body.append('accessToken', cfg.accessToken);
  body.append('lockId',      String(device.lockId));
  body.append('date',        String(Date.now()));

  const r = await fetch(`${TTLOCK_API}/v3/lock/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const d = await r.json();
  if (d.errcode && d.errcode !== 0) {
    if (d.errcode === 10004) { ttlCache = null; throw new Error('Token 过期，请重试'); }
    if (d.errcode === -4043)  throw new Error('未开启远程开锁，请在通通锁 App 中打开开关');
    throw new Error(`TTLock 开门失败 [${d.errcode}]: ${d.errmsg || '未知'}`);
  }
  return d;
}

// ═══════════════════════════════════════
// 涂鸦 (Tuya) — 完整 Content-SHA256 签名
// 参考: https://developer.tuya.com/en/docs/iot/singnature
// ═══════════════════════════════════════

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(data, key) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex').toUpperCase();
}

// 空字符串的 SHA256
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

async function tuyaRequest(method, path, body, accessId, accessToken, secret) {
  const t = String(Date.now());
  const bodyStr = body ? JSON.stringify(body) : '';
  const contentSha256 = bodyStr ? sha256Hex(bodyStr) : EMPTY_SHA256;

  // StringToSign = HTTPMethod + "\n" + Content-SHA256 + "\n" + "" + "\n" + path
  const stringToSign = method + '\n' + contentSha256 + '\n' + '\n' + path;

  const sign = hmacSha256(stringToSign, secret);

  const headers = {
    'client_id': accessId,
    'sign': sign,
    'sign_method': 'HMAC-SHA256',
    't': t,
  };
  if (accessToken) headers['access_token'] = accessToken;
  if (bodyStr) headers['Content-Type'] = 'application/json';

  const r = await fetch(`${TUYA_API}${path}`, {
    method,
    headers,
    body: bodyStr || undefined,
  });
  return r.json();
}

async function tuyaGetToken() {
  const now = Date.now();
  if (tuyaCache && tuyaCache.expireTime > now) return tuyaCache;

  const res = await db.collection('sys_config')
    .where({ key: _.in(['tuya_access_id','tuya_access_secret','tuya_token']) }).get();
  const cfg = {};
  res.data.forEach(i => { cfg[i.key] = i.value; });

  if (cfg.tuya_token) {
    try {
      const c = JSON.parse(cfg.tuya_token);
      if (c.expireTime > now) {
        tuyaCache = { token: c.access_token, expire: c.expireTime, id: cfg.tuya_access_id, secret: cfg.tuya_access_secret };
        return tuyaCache;
      }
    } catch (_) {}
  }

  const d = await tuyaRequest('GET', '/v1.0/token?grant_type=1', null, cfg.tuya_access_id, null, cfg.tuya_access_secret);

  if (!d || !d.result || !d.result.access_token) {
    throw new Error(`涂鸦鉴权失败: ${JSON.stringify(d)}`);
  }

  const expireTime = now + (d.result.expire_time - 3600) * 1000;
  const rec = res.data.find(i => i.key === 'tuya_token');
  const val = JSON.stringify({ access_token: d.result.access_token, expireTime });
  if (rec) {
    await db.collection('sys_config').doc(rec._id).update({ data: { value: val } });
  } else {
    await db.collection('sys_config').add({ data: { key: 'tuya_token', value: val } });
  }

  tuyaCache = { token: d.result.access_token, expire: expireTime, id: cfg.tuya_access_id, secret: cfg.tuya_access_secret };
  return tuyaCache;
}

async function tuyaUnlock(device) {
  const cfg = await tuyaGetToken();
  const d = await tuyaRequest('POST',
    `/v1.0/devices/${device.platformDeviceId}/door-lock/password-free/open-door`,
    {},  // empty JSON body
    cfg.id,
    cfg.token,
    cfg.secret
  );
  if (!d.success) {
    throw new Error(`涂鸦开门失败 [${d.code}]: ${d.msg || '未知'}`);
  }
  return d;
}

// ═══════════════════════════════════════
// 权限校验
// ═══════════════════════════════════════

async function checkPermission(openid, deviceId) {
  const dev = await db.collection('devices').where({ deviceId }).get();
  if (!dev.data.length) return { allowed: false, reason: '门禁设备不存在', device: null };

  const device = dev.data[0];
  if (!openid) return { allowed: true, device }; // 测试模式

  const user = await db.collection('users').where({ _openid: openid }).get();
  if (user.data.length && user.data[0].role === 'admin') return { allowed: true, device };

  const houses = user.data.length ? (user.data[0].houses || []) : [];
  if (houses.includes(device.houseId) || device.houseId === 'public') return { allowed: true, device };

  return { allowed: false, reason: '您未绑定该门禁对应的房产', device };
}

// ═══════════════════════════════════════
// 主函数
// ═══════════════════════════════════════

exports.main = async (event) => {
  const { deviceId, method = 'remote' } = event;
  const { OPENID } = cloud.getWXContext();
  const uid = OPENID || 'test_user';

  if (!deviceId) return { code: 400, msg: '缺少 deviceId 参数' };

  try {
    // 1. 权限
    const { allowed, reason, device } = await checkPermission(uid, deviceId);
    if (!allowed) return { code: 403, msg: reason };

    // 2. 根据平台路由开门
    let result;
    const startTime = Date.now();
    const platform = device.platform || 'ttlock';

    if (platform === 'tuya') {
      result = await tuyaUnlock(device);
    } else {
      result = await ttlockUnlock(device);
    }

    const duration = Date.now() - startTime;

    // 3. 记录日志
    await db.collection('unlockRecords').add({
      data: {
        _openid: uid,
        deviceId,
        deviceName: device.deviceName,
        platform,
        method,
        success: true,
        duration,
        createdAt: db.serverDate(),
      }
    });

    await db.collection('devices').doc(device._id).update({
      data: { lastUnlockTime: db.serverDate(), lastUnlockBy: uid }
    });

    return { code: 0, msg: '开门成功', data: { deviceName: device.deviceName, platform, method, duration } };

  } catch (err) {
    console.error('unlock:', err);
    try {
      await db.collection('unlockRecords').add({
        data: { _openid: uid, deviceId, method, success: false, error: err.message, createdAt: db.serverDate() }
      });
    } catch (_) {}
    return { code: 500, msg: err.message };
  }
};
