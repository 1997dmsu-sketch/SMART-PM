/**
 * 消息读取云函数（messageList）
 *
 * 入参 A：{ action:'conversations' }
 * 出参 A：{ code:0, data:[ { _id, peerId, peerName, peerAvatar, peerBg, online,
 *                            lastMsg, lastTime, lastTimeText, lastFrom, unread } ],
 *                  unreadTotal }
 *          按 lastTime DESC；unreadTotal = sum(unread)，**服务端算**，前端不许自己累加。
 *
 * 入参 B：{ action:'messages', conversationId, before?, limit? (默认 20，上限 50) }
 * 出参 B：{ code:0, data:[ { _id, from, type, content, createdAt, timeText, read } ], hasMore }
 *          必须校验 conversationId 归属当前 OPENID，否则 { code:403, msg:'无权访问该会话' }。
 *
 * 身份一律取 cloud.getWXContext().OPENID，绝不接受前端传入的 openid / ownerOpenid 作为身份依据。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// ─── 时间展示串（统一规则：今天 HH:mm / 昨天 / 周一…周日 / MM-DD / YYYY-MM-DD）───
const TZ_OFFSET = 8 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const WEEK = '日一二三四五六';

function timeTextOf(ts) {
  if (!ts) return '';
  const now = Date.now();
  const d = new Date(ts + TZ_OFFSET);
  const n = new Date(now + TZ_OFFSET);
  const pad = x => (x < 10 ? '0' + x : '' + x);
  const dayStart = x => Math.floor((x + TZ_OFFSET) / DAY_MS) * DAY_MS;
  const today0 = dayStart(now);
  if (ts >= today0) return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  if (ts >= today0 - DAY_MS) return '昨天';
  if (ts >= today0 - 6 * DAY_MS) return '周' + WEEK[d.getUTCDay()];
  if (d.getUTCFullYear() === n.getUTCFullYear()) {
    return pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

async function getConversations(OPENID) {
  const res = await db.collection('conversations')
    .where({ ownerOpenid: OPENID })
    .orderBy('lastTime', 'desc')
    .limit(100)
    .get();
  const data = (res.data || []).map(c => ({
    _id: c._id,
    peerId: c.peerId,
    peerName: c.peerName,
    peerAvatar: c.peerAvatar,
    peerBg: c.peerBg,
    online: !!c.online,
    lastMsg: c.lastMsg || '',
    lastTime: c.lastTime || 0,
    lastTimeText: c.lastTimeText || timeTextOf(c.lastTime),
    lastFrom: c.lastFrom || 'peer',
    unread: c.unread || 0,
  }));
  const unreadTotal = data.reduce((s, c) => s + (c.unread || 0), 0);
  return { code: 0, data, unreadTotal };
}

async function getMessages(OPENID, event) {
  const { conversationId } = event;
  if (!conversationId) return { code: 400, msg: '缺少 conversationId' };

  let limit = Number(event.limit) || 20;
  if (!(limit > 0)) limit = 20;
  if (limit > 50) limit = 50;

  // 归属校验：会话必须属于当前 OPENID
  let conv = null;
  try {
    const r = await db.collection('conversations').doc(conversationId).get();
    conv = r.data;
  } catch (e) {
    conv = null;
  }
  if (!conv || conv.ownerOpenid !== OPENID) return { code: 403, msg: '无权访问该会话' };

  const where = { conversationId, deleted: _.neq(true) };
  if (event.before) where.createdAt = _.lt(Number(event.before));

  const res = await db.collection('messages')
    .where(where)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  const data = (res.data || []).map(m => ({
    _id: m._id,
    from: m.from,
    type: m.type || 'text',
    content: m.content,
    createdAt: m.createdAt,
    timeText: timeTextOf(m.createdAt),
    read: !!m.read,
  }));

  return { code: 0, data, hasMore: res.data.length === limit };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 403, msg: '无法识别身份' };

  const { action } = event || {};
  try {
    if (action === 'conversations') return await getConversations(OPENID);
    if (action === 'messages') return await getMessages(OPENID, event);
    return { code: 400, msg: '未知 action: ' + action };
  } catch (err) {
    console.error('messageList error:', err);
    return { code: 500, msg: err.message };
  }
};
