/**
 * 快速添加 608 房门锁到数据库
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const deviceId = 'DEV009';
  const lockData = {
    deviceId,
    deviceName: '608房',
    platform: 'ttlock',
    lockId: 22507329,
    lockName: 'S8503_37a7e0',
    macAddress: '38:C6:7C:E0:A7:37',
    battery: 65,
    houseId: 'HF-A2-1506',
    status: 'online',
    enableRemote: false,
    enableBluetooth: true,
    updatedAt: db.serverDate(),
  };

  const existing = await db.collection('devices').where({ deviceId }).get();

  if (existing.data.length > 0) {
    await db.collection('devices').doc(existing.data[0]._id).update({ data: lockData });
    return { code: 0, msg: '608房 已更新', deviceId, lockId: 22507329, mac: '38:C6:7C:E0:A7:37' };
  } else {
    await db.collection('devices').add({ data: { ...lockData, createdAt: db.serverDate() } });
    return { code: 0, msg: '608房 已创建', deviceId, lockId: 22507329, mac: '38:C6:7C:E0:A7:37' };
  }
};
