/**
 * 查询用户开门历史记录
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { limit = 10 } = event;

  try {
    const res = await db.collection('unlockRecords')
      .where({ _openid: OPENID })
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const records = res.data.map(r => ({
      id: r._id,
      doorName: r.deviceName || '未知',
      method: r.method || 'remote',
      success: r.success,
      time: formatTime(r.createdAt),
      timestamp: r.createdAt,
    }));

    return { code: 0, data: { records } };
  } catch (err) {
    console.error('unlockRecords error:', err);
    return { code: 500, msg: '查询失败' };
  }
};

function formatTime(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';

  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${month}月${day}日 ${hours}:${mins}`;
}
