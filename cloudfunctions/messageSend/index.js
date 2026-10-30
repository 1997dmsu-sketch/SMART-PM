/**
 * 消息发送云函数（messageSend）—— ★内容安全唯一入口★
 *
 * 入参：{ conversationId, type:'text', content }
 * 出参：{ code:0, data:{ _id, createdAt, timeText, content } }
 *
 * 执行顺序（**不可调换，机审必须在落库之前**）：
 *   ① 身份：const { OPENID } = cloud.getWXContext();
 *   ② 会话归属校验：conversations.doc(conversationId).get() 后比对 ownerOpenid === OPENID，
 *      不匹配 → { code:403, msg:'无权访问该会话' }
 *   ③ 入参清洗：空 / 超 500 字 / 非 text → 400
 *   ④ 内容安全 · 必须在云函数内调 msgSecCheck（version:2 + scene:2 + 受信任的 openid）
 *   ⑤ 落库 messages
 *   ⑥ 更新 conversations（只有过审的文本才允许进 lastMsg 预览；unread 不动）
 *   ⑦ 返回
 *
 * 物业侧回消息走**同一个函数**，靠身份自动分流：
 *   先查 staff.where({ openid: OPENID })；命中 → from:'peer'，并把对应住户的 conversations.unread 自增 1。
 *
 * 【四条禁令】
 *   - 禁止把 msgSecCheck 放到小程序端调：前端拿不到受信任的 openid 绑定，且调用凭据会暴露。
 *   - 禁止用本地敏感词数组 / 正则替代机审后放行；本地词表最多用于「发送前给用户一个提示」，
 *     命中与否都不构成放行依据。
 *   - 禁止先落库后送审：先落库意味着违规内容至少有一次可被读到的窗口。
 *   - 禁止把 sec.result 的原始 label 返回给前端（会泄露审核策略），统一返回 87014 + 固定文案。
 *
 * 【类目与合规】住户 ↔ 物业单聊属社交/即时通讯能力。企业主体已微信认证之外，
 * 还需在小程序后台补充「社交-社区/论坛」或「工具-客服」类目，否则审核驳回。
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

function fail(err) {
  if (err && err.errCode === 87014) return { code: 87014, msg: '内容涉嫌违规，发送失败' };
  return { code: 500, msg: '内容安全校验失败，请稍后重试' };   // 其它错误按失败处理，不放行
}

exports.main = async (event) => {
  // ① 身份：只信上下文里的 OPENID
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 403, msg: '无法识别身份' };

  const { conversationId } = event || {};
  if (!conversationId) return { code: 400, msg: '缺少 conversationId' };

  try {
    // ② 会话归属校验（物业侧人员按 staff.openid 命中放行）
    let conv = null;
    try {
      const r = await db.collection('conversations').doc(conversationId).get();
      conv = r.data;
    } catch (e) {
      conv = null;
    }
    if (!conv) return { code: 403, msg: '无权访问该会话' };

    let staff = null;
    try {
      const sr = await db.collection('staff').where({ openid: OPENID }).limit(1).get();
      staff = (sr.data && sr.data[0]) || null;
    } catch (e) {
      staff = null;
    }
    if (!staff && conv.ownerOpenid !== OPENID) return { code: 403, msg: '无权访问该会话' };

    // ③ 入参清洗
    const content = String((event.content === undefined || event.content === null) ? '' : event.content).trim();
    if (!content) return { code: 400, msg: '消息不能为空' };
    if (content.length > 500) return { code: 400, msg: '消息过长' };
    if (event.type !== 'text') return { code: 400, msg: '暂不支持该消息类型' };

    // ④ 内容安全 —— 必须在云函数内调，且必须在落库之前
    let sec;
    try {
      sec = await cloud.openapi.security.msgSecCheck({
        content,
        version: 2,                 // V2 必须传 openid + scene
        scene: 2,                   // 2 = 评论/即时通讯场景
        openid: OPENID,             // 必须是 cloud.getWXContext().OPENID，不能由前端传
      });
    } catch (err) {
      return fail(err);
    }
    const sug = sec && sec.result && sec.result.suggest;   // 'pass' | 'review' | 'risky'
    if (sug !== 'pass') return { code: 87014, msg: '内容涉嫌违规，发送失败' };

    // ⑤ 落库 messages
    const from = staff ? 'peer' : 'owner';
    const now = Date.now();
    const added = await db.collection('messages').add({
      data: {
        conversationId,
        ownerOpenid: conv.ownerOpenid,
        peerId: conv.peerId,
        from,
        fromOpenid: OPENID,
        type: 'text',
        content,
        createdAt: now,
        read: false,
        deleted: false,
      }
    });

    // ⑥ 更新 conversations：lastMsg 只允许写入过审的文本
    const upd = {
      lastMsg: content,
      lastTime: now,
      lastTimeText: timeTextOf(now),
      lastFrom: from,
      updatedAt: now,
    };
    // 物业侧回消息 → 住户未读 +1；住户自己发的消息不动 unread
    if (from === 'peer') upd.unread = _.inc(1);
    await db.collection('conversations').doc(conversationId).update({ data: upd });

    // ⑦ 返回
    return { code: 0, data: { _id: added._id, createdAt: now, timeText: timeTextOf(now), content } };
  } catch (err) {
    console.error('messageSend error:', err);
    return { code: 500, msg: err.message };
  }
};
