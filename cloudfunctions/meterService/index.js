/**
 * 智能水电表云函数 —— 通通锁(TTLock) 水表/电表云 API
 *
 * 水表/电表为 4G 直连表，自带联网直接把状态/读数上报到服务端，无需网关；
 * 本云函数只通过 HTTP 调 api.sciener.com 拉数据，不碰蓝牙/网关。
 * 认证复用门锁的 OAuth（clientId/clientSecret/username/password）。
 *
 * 入参：
 *   { action:'list',    type:'electric'|'water', pageNo?, pageSize? }   —— 列设备
 *   { action:'detail',  type:'electric'|'water', meterId }              —— 当前读数
 *   { action:'records', type:'electric'|'water', meterId, dateType, dateStr } —— 历史用量（按日/月/年查，无分页）
 */
const cloud = require('wx-server-sdk');
const fetch = require('node-fetch');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const AUTH_URL = 'https://cnapi.ttlock.com';
const API_URL = 'https://api.sciener.com';

// 读 TTLock 凭证（与门锁共用 sys_config 里的 ttlock_* 配置）
async function readConfig() {
  const res = await db.collection('sys_config')
    .where({ key: _.in(['ttlock_client_id', 'ttlock_client_secret', 'ttlock_username', 'ttlock_password_md5', 'ttlock_token']) })
    .get();
  const cfg = {};
  res.data.forEach(i => { cfg[i.key] = i.value; });
  return cfg;
}

// 获取访问令牌（带缓存，与 getLockKey 同逻辑）
async function getAccessToken(cfg) {
  if (cfg.ttlock_token) {
    try {
      const c = JSON.parse(cfg.ttlock_token);
      if (c.expireTime > Date.now()) return c.access_token;
    } catch (_) {}
  }
  const body = new URLSearchParams();
  body.append('clientId', cfg.ttlock_client_id);
  body.append('clientSecret', cfg.ttlock_client_secret);
  body.append('username', cfg.ttlock_username);
  body.append('password', cfg.ttlock_password_md5);

  const r = await fetch(`${AUTH_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`获取 token 失败: ${JSON.stringify(d)}`);

  const val = JSON.stringify({ access_token: d.access_token, expireTime: Date.now() + (d.expires_in - 86400) * 1000 });
  const rec = await db.collection('sys_config').where({ key: 'ttlock_token' }).get();
  if (rec.data.length) await db.collection('sys_config').doc(rec.data[0]._id).update({ data: { value: val } });
  else await db.collection('sys_config').add({ data: { key: 'ttlock_token', value: val } });
  return d.access_token;
}

// POST form 到 TTLock 云 API
async function post(path, form) {
  const body = new URLSearchParams();
  Object.keys(form).forEach(k => body.append(k, form[k]));
  const r = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return r.json();
}

exports.main = async (event) => {
  const { action, type, meterId, pageNo = 1, pageSize = 100, dateType = 1, dateStr } = event || {};
  if (!action) return { code: 400, msg: '缺少 action' };
  const isWater = type === 'water';
  const base = isWater ? '/v3/waterMeter' : '/v3/electricMeter';
  const idField = isWater ? 'waterMeterId' : 'electricMeterId';

  try {
    const cfg = await readConfig();
    if (!cfg.ttlock_client_id || !cfg.ttlock_client_secret) {
      return { code: 500, msg: '缺少通通锁凭证，请先在 dbInit 配置 TTLOCK_CLIENT_ID/CLIENT_SECRET' };
    }
    const accessToken = await getAccessToken(cfg);

    const common = { clientId: cfg.ttlock_client_id, accessToken, date: String(Date.now()) };

    if (action === 'list') {
      const d = await post(`${base}/list`, Object.assign({ pageNo, pageSize }, common));
      return { code: 0, data: d.list || [], total: d.total || 0 };
    }

    if (action === 'detail') {
      if (meterId === undefined || meterId === null) return { code: 400, msg: '缺少 meterId' };
      const form = Object.assign({}, common);
      form[idField] = meterId;
      const d = await post(`${base}/detail`, form);
      return { code: 0, data: d };
    }

    if (action === 'records') {
      if (meterId === undefined || meterId === null) return { code: 400, msg: '缺少 meterId' };
      if (dateStr === undefined || dateStr === null) {
        return { code: 400, msg: '缺少 dateStr（dateType=0:2024-09-06 / 1:2024-09 / 2:2024）' };
      }
      const form = Object.assign({ dateType, dateStr }, common);
      form[idField] = meterId;
      const d = await post(`${base}/listRecords`, form);
      return { code: 0, data: d.list || [] };
    }

    return { code: 400, msg: '未知 action: ' + action };
  } catch (err) {
    console.error('meterService error:', err);
    return { code: 500, msg: err.message };
  }
};
