/**
 * 内容读取云函数
 *
 * 供前端内容页读取已上架（enabled=true）的内容，按 sortOrder 升序返回。
 * 入参：{ type? } —— 字符串或字符串数组（如 ['house','share']）。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { type } = event || {};
  try {
    let query = db.collection('content').where({ enabled: true });

    if (type) {
      const types = Array.isArray(type) ? type : [type];
      query = query.where({ type: _.in(types) });
    }

    const res = await query.orderBy('sortOrder', 'asc').limit(100).get();

    return { code: 0, data: res.data, total: res.data.length };
  } catch (err) {
    console.error('contentList error:', err);
    return { code: 500, msg: err.message };
  }
};
