const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function sign(msg, key) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest('hex').toUpperCase();
}

exports.main = async () => {
  const r = await db.collection('sys_config')
    .where({ key: _.in(['tuya_access_id','tuya_access_secret']) }).get();
  const cfg = {};
  r.data.forEach(i => { cfg[i.key] = (i.value || '').trim(); });
  const id = cfg.tuya_access_id;
  const secret = cfg.tuya_access_secret;

  // 用未来 60 秒的时间戳（给你时间复制打开浏览器）
  const tFuture = Date.now() + 60000;
  const sFuture = sign(id + tFuture, secret);

  const url = `https://openapi.tuyacn.com/v1.0/token?grant_type=1&client_id=${id}&sign=${sFuture}&sign_method=HMAC-SHA256&t=${tFuture}`;

  return {
    code: 0,
    instruction: '复制下面的 url，立刻在浏览器地址栏打开',
    url: url,
    expire_after: '60秒后过期',
    server_time: Date.now()
  };
};
