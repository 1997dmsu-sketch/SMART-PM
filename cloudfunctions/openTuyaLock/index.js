/**
 * 涂鸦门锁免密开门云函数（标准云 API）
 *
 * 两步：
 *   1. POST /v1.0/devices/{device_id}/door-lock/password-ticket  取 ticket_id
 *   2. POST /v1.0/devices/{device_id}/door-lock/password-free/open-door  开门
 *
 * 签名（新版）：
 *   stringToSign = METHOD + "\n" + SHA256(body) + "\n\n" + URL
 *   sign = HMAC-SHA256(client_id + access_token + t + stringToSign, secret).toUpperCase()
 */
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const API_HOST = 'https://openapi.tuyacn.com';

function sha256(s) {
  return crypto.createHash('sha256').update(s || '', 'utf8').digest('hex');
}

function sign(method, url, bodyStr, t, clientId, secret, accessToken) {
  const stringToSign = `${method}\n${sha256(bodyStr)}\n\n${url}`;
  const str = accessToken
    ? `${clientId}${accessToken}${t}${stringToSign}`
    : `${clientId}${t}${stringToSign}`;
  return crypto.createHmac('sha256', secret).update(str, 'utf8').digest('hex').toUpperCase();
}

async function request(method, url, bodyObj, clientId, secret, accessToken) {
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
  const t = String(Date.now());
  const s = sign(method, url, bodyStr, t, clientId, secret, accessToken);
  const headers = {
    'sign_method': 'HMAC-SHA256',
    'client_id': clientId,
    't': t,
    'mode': 'cors',
    'Content-Type': 'application/json',
    'sign': s,
  };
  if (accessToken) headers['access_token'] = accessToken;

  const target = new URL(API_HOST + url);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: target.hostname,
      path: target.pathname + target.search,
      method,
      headers,
      timeout: 15000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(`响应解析失败: ${body.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function getToken(clientId, secret) {
  const d = await request('GET', '/v1.0/token?grant_type=1', null, clientId, secret, null);
  if (!d.success || !d.result || !d.result.access_token) {
    throw new Error(`获取涂鸦 token 失败 [${d.code}] ${d.msg || ''}`);
  }
  return d.result.access_token;
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
  try {
    const deviceId = (event && event.deviceId) || (event && event.device_id);
    if (!deviceId) {
      return { code: 400, msg: '缺少 deviceId 参数' };
    }
    const { OPENID } = cloud.getWXContext();
    const uid = OPENID || 'test_user';

    // 0. 权限校验：按涂鸦 deviceId 取 houseId
    const devRes = await db.collection('devices')
      .where({ platformDeviceId: String(deviceId), platform: 'tuya' }).get();
    if (!devRes.data.length) return { code: 403, msg: '门禁设备不存在或未授权' };
    const houseId = devRes.data[0].houseId;
    if (!(await checkAccess(uid, houseId))) return { code: 403, msg: '您未绑定该门禁对应的房产' };

    // 1. 读配置
    const res = await db.collection('sys_config')
      .where({ key: _.in(['tuya_access_id', 'tuya_access_secret']) })
      .get();
    const cfg = {};
    res.data.forEach(i => { cfg[i.key] = i.value; });

    if (!cfg.tuya_access_id || !cfg.tuya_access_secret) {
      return { code: 500, msg: '缺少涂鸦凭证，请先运行 dbInit' };
    }

    // 2. 获取 token
    const token = await getToken(cfg.tuya_access_id, cfg.tuya_access_secret);

    // 3. 获取临时密钥
    const ticketRes = await request(
      'POST',
      `/v1.0/devices/${deviceId}/door-lock/password-ticket`,
      {},
      cfg.tuya_access_id,
      cfg.tuya_access_secret,
      token
    );
    if (!ticketRes.success || !ticketRes.result || !ticketRes.result.ticket_id) {
      return { code: 500, msg: `获取临时密钥失败 [${ticketRes.code}] ${ticketRes.msg || ''}`, raw: ticketRes };
    }
    const ticketId = ticketRes.result.ticket_id;

    // 4. 免密开门
    const openRes = await request(
      'POST',
      `/v1.0/devices/${deviceId}/door-lock/password-free/open-door`,
      { ticket_id: ticketId },
      cfg.tuya_access_id,
      cfg.tuya_access_secret,
      token
    );

    if (!openRes.success) {
      return { code: 500, msg: `开门失败 [${openRes.code}] ${openRes.msg || ''}`, raw: openRes };
    }

    return {
      code: 0,
      msg: '开门成功',
      deviceId,
      result: openRes.result,
    };
  } catch (err) {
    return { code: 500, msg: err.message };
  }
};
