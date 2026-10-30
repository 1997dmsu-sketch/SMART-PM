/**
 * 内容管理云函数（小程序内管理页使用）
 *
 * 入参：
 *   { action: 'list',   type? }                                  —— 返回全部（含未上架）
 *   { action: 'save',   data, id? }                              —— 有 id 更新，无 id 新增
 *   { action: 'delete', id }                                     —— 删除
 *   { action: 'toggle', id }                                     —— 上下架切换
 *
 * 权限：复用 users 集合的 role 字段（'admin'）。内测阶段暂放行，
 *       正式上线前取消 isAdmin 校验的注释即可收紧。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// 校验管理员（复用 users.role === 'admin'）
async function isAdmin(openid) {
  try {
    const res = await db.collection('users')
      .where({ _openid: openid, role: 'admin' }).count();
    return res.total > 0;
  } catch (e) {
    return false;
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { action, type, data, id } = event || {};

  // 收紧权限：仅管理员可操作
  if (!(await isAdmin(OPENID))) return { code: 403, msg: '无管理权限' };

  try {
    const coll = db.collection('content');

    switch (action) {
      case 'list': {
        let q = coll;
        if (type) {
          const types = Array.isArray(type) ? type : [type];
          q = q.where({ type: _.in(types) });
        }
        const res = await q.orderBy('sortOrder', 'asc').limit(100).get();
        return { code: 0, data: res.data, total: res.data.length };
      }

      case 'save': {
        const payload = Object.assign({}, data);
        delete payload._id;                 // 防止把 _id 写进文档
        payload.updatedAt = Date.now();

        if (id) {
          await coll.doc(id).update({ data: payload });
          return { code: 0, msg: '已更新', id };
        }
        if (!payload.type) return { code: 400, msg: '缺少 type' };
        payload.enabled = payload.enabled !== false;
        const r = await coll.add({ data: payload });
        return { code: 0, msg: '已新增', id: r._id };
      }

      case 'delete': {
        if (!id) return { code: 400, msg: '缺少 id' };
        await coll.doc(id).remove();
        return { code: 0, msg: '已删除' };
      }

      case 'toggle': {
        if (!id) return { code: 400, msg: '缺少 id' };
        const doc = await coll.doc(id).get();
        const cur = doc.data ? doc.data.enabled !== false : false;
        await coll.doc(id).update({ data: { enabled: !cur, updatedAt: Date.now() } });
        return { code: 0, msg: !cur ? '已上架' : '已下架', enabled: !cur };
      }

      default:
        return { code: 400, msg: '未知 action: ' + action };
    }
  } catch (err) {
    console.error('contentAdmin error:', err);
    return { code: 500, msg: err.message };
  }
};
