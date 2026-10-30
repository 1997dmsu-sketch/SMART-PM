/**
 * 获取涂鸦账号下的门锁设备列表（标准云 API）
 *
 * 路线：标准云 API（不是小程序 SDK FaaS）
 * 签名：新版算法
 *   stringToSign = "GET\n" + SHA256(空body) + "\n\n" + URL路径
 *   sign = HMAC-SHA256(client_id + access_token + t + stringToSign, secret).toUpperCase()
 * token：GET /v1.0/token?grant_type=1
 *   sign = HMAC-SHA256(client_id + t + stringToSign, secret).toUpperCase()  // 无 access_token
 * 列表：GET /v1.0/iot-01/associated-users/devices?uid={tuya_uid}
 */
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const API_HOST = 'https://openapi.tuyacn.com';
// 空 body 的 SHA256（固定值）
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// 计算签名（accessToken 为空时用于取 token 接口，否则用于业务接口）
function sign(method, url, t, clientId, secret, accessToken) {
  const stringToSign = `${method}\n${EMPTY_SHA256}\n\n${url}`;
  const str = accessToken
    ? `${clientId}${accessToken}${t}${stringToSign}`
    : `${clientId}${t}${stringToSign}`;
  return crypto.createHmac('sha256', secret).update(str, 'utf8').digest('hex').toUpperCase();
}

// 发请求（用 https 模块，云函数运行时无全局 fetch）
async function request(method, url, clientId, secret, accessToken) {
  const t = String(Date.now());
  const s = sign(method, url, t, clientId, secret, accessToken);
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
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`响应解析失败: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
    req.end();
  });
}

// 获取 access_token
async function getToken(clientId, secret) {
  const d = await request('GET', '/v1.0/token?grant_type=1', clientId, secret, null);
  if (!d.success || !d.result || !d.result.access_token) {
    throw new Error(`获取涂鸦 token 失败 [${d.code}] ${d.msg || ''}`);
  }
  return d.result.access_token;
}

exports.main = async () => {
  try {
    // 1. 读配置
    const res = await db.collection('sys_config')
      .where({ key: _.in(['tuya_access_id', 'tuya_access_secret', 'tuya_uid']) })
      .get();
    const cfg = {};
    res.data.forEach(i => { cfg[i.key] = i.value; });

    if (!cfg.tuya_access_id || !cfg.tuya_access_secret) {
      return { code: 500, msg: '缺少涂鸦凭证，请先运行 dbInit' };
    }
    if (!cfg.tuya_uid) {
      return { code: 500, msg: '缺少涂鸦 uid，请先运行 dbInit 并配置 TUYA_UID 环境变量' };
    }
    const uid = cfg.tuya_uid;

    // 2. 获取 token
    const token = await getToken(cfg.tuya_access_id, cfg.tuya_access_secret);

    // 3. 获取设备列表
    const url = `/v1.0/iot-01/associated-users/devices?uid=${uid}`;
    const d = await request('GET', url, cfg.tuya_access_id, cfg.tuya_access_secret, token);

    if (!d.success) {
      return { code: 500, msg: `涂鸦设备列表失败 [${d.code}] ${d.msg || ''}`, raw: d };
    }

    const list = (d.result && d.result.devices) || [];
    return {
      code: 0,
      total: list.length,
      devices: list.map(dev => ({
        id: dev.id,
        name: dev.name || '(无名称)',
        category: dev.category_name || dev.category || '',
        online: !!dev.online,
        model: dev.model || '',
        ip: dev.ip || '',
        uuid: dev.uuid || '',
        sub: dev.sub || false,
      })),
    };
  } catch (err) {
    return { code: 500, msg: err.message };
  }
};
