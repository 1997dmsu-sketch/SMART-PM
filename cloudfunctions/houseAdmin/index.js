/**
 * 门锁授权管理云函数（管理员）
 *
 * 入参：
 *   { action:'listRooms' }                     —— 物业房产列表 + 每房已绑定住户数
 *   { action:'listUsers', phone? }             —— 住户列表（phone 模糊搜）
 *   { action:'listDevices' }                   —— 门禁设备列表（含 houseId）
 *   { action:'bind',   userId, houseId }       —— 把住户绑定到房产（houseId 加入 users.houses）
 *   { action:'unbind', userId, houseId }       —— 移除绑定
 *
 * 权限：复用 users.role === 'admin'（与 contentAdmin 一致）。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// 校验管理员（复用 users.role === 'admin'）
async function isAdmin(openid) {
  try {
    const res = await db.collection('users').where({ _openid: openid, role: 'admin' }).count();
    return res.total > 0;
  } catch (e) {
    return false;
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { action, userId, houseId, phone } = event || {};

  if (!OPENID) return { code: 403, msg: '无法识别身份' };
  if (!(await isAdmin(OPENID))) return { code: 403, msg: '无管理权限' };

  try {
    switch (action) {
      case 'listRooms': {
        const rooms = await db.collection('rooms').orderBy('sortOrder', 'asc').limit(100).get();
        const list = [];
        for (const room of rooms.data) {
          const cnt = await db.collection('users').where({ houses: room.houseId }).count();
          list.push(Object.assign({}, room, { boundCount: cnt.total }));
        }
        return { code: 0, data: list, total: list.length };
      }

      case 'listUsers': {
        let q = db.collection('users');
        if (phone) {
          q = q.where({ phone: db.RegExp({ regexp: phone, options: 'i' }) });
        }
        const res = await q.field({ name: true, phone: true, role: true, houses: true }).limit(50).get();
        return { code: 0, data: res.data, total: res.data.length };
      }

      case 'listDevices': {
        const res = await db.collection('devices')
          .field({ deviceId: true, deviceName: true, houseId: true, platform: true, lockId: true, platformDeviceId: true, status: true })
          .limit(100).get();
        return { code: 0, data: res.data, total: res.data.length };
      }

      case 'bind': {
        if (!userId || !houseId) return { code: 400, msg: '缺少 userId 或 houseId' };
        const user = await db.collection('users').doc(userId).get();
        if (!user.data) return { code: 404, msg: '用户不存在' };
        const houses = Array.isArray(user.data.houses) ? user.data.houses.slice() : [];
        if (houses.includes(houseId)) return { code: 0, msg: '已绑定，无需重复绑定', houses };
        houses.push(houseId);
        await db.collection('users').doc(userId).update({ data: { houses } });
        return { code: 0, msg: '已绑定', houses };
      }

      case 'unbind': {
        if (!userId || !houseId) return { code: 400, msg: '缺少 userId 或 houseId' };
        const user = await db.collection('users').doc(userId).get();
        if (!user.data) return { code: 404, msg: '用户不存在' };
        const houses = Array.isArray(user.data.houses) ? user.data.houses.filter(h => h !== houseId) : [];
        await db.collection('users').doc(userId).update({ data: { houses } });
        return { code: 0, msg: '已解绑', houses };
      }

      default:
        return { code: 400, msg: '未知 action: ' + action };
    }
  } catch (err) {
    console.error('houseAdmin error:', err);
    return { code: 500, msg: err.message };
  }
};
