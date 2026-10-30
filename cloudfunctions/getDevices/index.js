/**
 * 获取用户可用的门禁设备列表
 * 同时查询 TTLock 在线状态（如有网关）
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();

  try {
    // 获取用户信息（含绑定房产）—— 容错：users 集合不存在时不报错
    let userHouses = [];
    let isAdmin = false;
    try {
      const userRes = await db.collection('users')
        .where({ _openid: OPENID })
        .get();
      userHouses = userRes.data.length ? (userRes.data[0].houses || []) : [];
      isAdmin = userRes.data.length && userRes.data[0].role === 'admin';
    } catch (e) {
      console.warn('users 集合查询失败（可能未初始化），按普通用户处理', e.message);
    }

    // 查询设备：公共门禁 + 用户绑定的房产门禁（管理员可看全部）
    let query = {};
    if (!isAdmin) {
      query = {
        $or: [
          { houseId: 'public' },
          { houseId: db.command.in(userHouses) },
        ]
      };
    }

    let devicesRes;
    try {
      devicesRes = await db.collection('devices')
        .where(query)
        .orderBy('sortOrder', 'asc')
        .get();
    } catch (e) {
      console.error('devices 集合查询失败', e.message);
      return { code: 0, data: { devices: [], isAdmin, totalCount: 0, onlineCount: 0 } };
    }

    // 格式化设备列表
    const devices = devicesRes.data.map(dev => ({
      deviceId: dev.deviceId,
      name: dev.deviceName,
      location: dev.location || '',
      type: dev.type || 'unit',
      status: dev.status || 'online',
      lockId: dev.lockId,
      macAddress: dev.macAddress || '',
      gatewayId: dev.gatewayId || null,
      houseId: dev.houseId,
      distance: dev.distance || '',
      lastUnlockTime: dev.lastUnlockTime || null,
      // 蓝牙开门需要 macAddress
      supportBluetooth: !!dev.macAddress,
      supportRemote: !!dev.gatewayId,
    }));

    return {
      code: 0,
      data: {
        devices,
        isAdmin,
        totalCount: devices.length,
        onlineCount: devices.filter(d => d.status === 'online').length,
      }
    };

  } catch (err) {
    console.error('getDevices error:', err);
    return { code: 500, msg: err.message || '获取设备列表失败' };
  }
};
