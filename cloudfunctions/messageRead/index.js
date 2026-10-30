/**
 * 标记已读云函数（messageRead）
 *
 * 入参：{ conversationId? }（省略 = 全部会话）
 * 行为：对应 conversations 行 unread = 0；该会话内 from:'peer' 的 messages.read 置 true
 * 出参：{ code:0, unreadTotal }（返回刷新后的总数，供消息页回填 tabBar 红点）
 *
 * 身份一律取 cloud.getWXContext().OPENID，绝不接受前端传入的 openid / ownerOpenid 作为身份依据。
 * 已读的三个维度不要混淆：
 *   1) conversations.unread —— 住户未读条数，驱动会话行红点 + Tab 红点（本函数清零）
 *   2) messages.read        —— 单条消息的已读标记（本函数置 true）
 *   3) 气泡上的已读回执      —— 本期小程序仅对 from='owner' 的气泡按 read 展示，未读不显示字样
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

async function unreadTotalOf(OPENID) {
  const res = await db.collection('conversations')
    .where({ ownerOpenid: OPENID })
    .limit(100)
    .get();
  return (res.data || []).reduce((s, c) => s + (c.unread || 0), 0);
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 403, msg: '无法识别身份' };

  const { conversationId } = event || {};

  try {
    let targets;
    if (conversationId) {
      // 指定会话：先校验归属
      let conv = null;
      try {
        const r = await db.collection('conversations').doc(conversationId).get();
        conv = r.data;
      } catch (e) {
        conv = null;
      }
      if (!conv || conv.ownerOpenid !== OPENID) return { code: 403, msg: '无权访问该会话' };
      targets = [conv];
    } else {
      // 省略 = 全部会话
      const res = await db.collection('conversations').where({ ownerOpenid: OPENID }).limit(100).get();
      targets = res.data || [];
    }

    for (const c of targets) {
      if ((c.unread || 0) > 0) {
        await db.collection('conversations').doc(c._id).update({
          data: { unread: 0, updatedAt: Date.now() }
        });
      }
      // 该会话里对方发来的消息逐条置为已读
      await db.collection('messages')
        .where({ conversationId: c._id, from: 'peer', read: false })
        .update({ data: { read: true } });
    }

    return { code: 0, unreadTotal: await unreadTotalOf(OPENID) };
  } catch (err) {
    console.error('messageRead error:', err);
    return { code: 500, msg: err.message };
  }
};
