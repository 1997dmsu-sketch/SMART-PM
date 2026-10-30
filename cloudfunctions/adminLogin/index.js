/**
 * 管理员登录云函数（账号密码 + 改密）
 *
 * 入参：
 *   { action:'login',          username, password }       —— 校验账号密码，成功 upsert 当前 OPENID 的 role='admin'
 *   { action:'changePassword', oldPassword, newPassword }  —— 已登录管理员改密（写回新 hash）
 *
 * 密码存储：sys_config 的 admin_password_hash，格式 pbkdf2_sha512$<iter>$<saltHex>$<hashHex>
 * 账号/初始密码由 dbInit 环境变量 ADMIN_USERNAME / ADMIN_INITIAL_PASSWORD 种子写入，不落代码库。
 */
const crypto = require('crypto');
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ITER = 100000; // pbkdf2 迭代次数

// 生成 pbkdf2_sha512$<iter>$<saltHex>$<hashHex>（不传 saltHex 时用随机盐）
function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, ITER, 64, 'sha512');
  return `pbkdf2_sha512$${ITER}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha512') return false;
  const iter = parseInt(parts[1], 10);
  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  const actual = crypto.pbkdf2Sync(password, salt, iter, expected.length, 'sha512');
  return crypto.timingSafeEqual(actual, expected);
}

// 常量时间字符串比较（用户名等）
function safeEqual(a, b) {
  const ba = Buffer.from(String(a == null ? '' : a));
  const bb = Buffer.from(String(b == null ? '' : b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function getConfig(key) {
  const res = await db.collection('sys_config').where({ key }).limit(1).get();
  return res.data.length > 0 ? res.data[0].value : null;
}

async function isAdmin(openid) {
  try {
    const res = await db.collection('users').where({ _openid: openid, role: 'admin' }).count();
    return res.total > 0;
  } catch (e) {
    return false;
  }
}

async function upsertAdminUser(OPENID, UNIONID) {
  const users = await db.collection('users').where({ _openid: OPENID }).get();
  if (users.data.length > 0) {
    const updateData = { role: 'admin', lastLoginAt: db.serverDate() };
    if (UNIONID) updateData.unionid = UNIONID;
    await db.collection('users').doc(users.data[0]._id).update({ data: updateData });
    return Object.assign({}, users.data[0], { role: 'admin' });
  }
  const newUser = {
    _openid: OPENID,
    unionid: UNIONID || null,
    role: 'admin',
    houses: [],
    points: 0,
    createdAt: db.serverDate(),
    lastLoginAt: db.serverDate(),
  };
  await db.collection('users').add({ data: newUser });
  return newUser;
}

// 幂等写 sys_config 单字段
async function setConfig(key, value, description) {
  const cfg = await db.collection('sys_config').where({ key }).get();
  if (cfg.data.length > 0) {
    await db.collection('sys_config').doc(cfg.data[0]._id).update({ data: { value } });
  } else {
    await db.collection('sys_config').add({ data: { key, value, description } });
  }
}

exports.main = async (event) => {
  const { OPENID, UNIONID } = cloud.getWXContext();
  const { action } = event || {};

  if (!OPENID) return { code: 403, msg: '无法识别身份' };

  try {
    if (action === 'login') {
      const { username, password } = event;
      if (!username || !password) return { code: 400, msg: '请输入账号和密码' };

      const storedUser = await getConfig('admin_username');
      const storedHash = await getConfig('admin_password_hash');
      const mustChange = await getConfig('admin_must_change');

      const okUser = safeEqual(username, storedUser);
      const okPass = verifyPassword(password, storedHash);
      if (!okUser || !okPass) return { code: 401, msg: '账号或密码错误' };

      const userInfo = await upsertAdminUser(OPENID, UNIONID);
      return { code: 0, userInfo, mustChangePassword: mustChange === 'true' };
    }

    if (action === 'changePassword') {
      const { oldPassword, newPassword } = event;
      if (!(await isAdmin(OPENID))) return { code: 403, msg: '无管理权限' };
      if (!oldPassword || !newPassword) return { code: 400, msg: '请输入旧密码和新密码' };
      if (String(newPassword).length < 6) return { code: 400, msg: '新密码至少 6 位' };

      const storedHash = await getConfig('admin_password_hash');
      if (!verifyPassword(oldPassword, storedHash)) return { code: 401, msg: '旧密码错误' };

      await setConfig('admin_password_hash', hashPassword(String(newPassword)), '管理员密码 hash');
      await setConfig('admin_must_change', 'false', '是否需要修改初始密码');

      return { code: 0, msg: '密码已修改' };
    }

    return { code: 400, msg: '未知 action: ' + action };
  } catch (err) {
    console.error('adminLogin error:', err);
    return { code: 500, msg: err.message };
  }
};
