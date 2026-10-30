/**
 * 聊天初始化云函数（chatInit）
 *
 * 职责：
 *   a. 按 staff._id upsert 4 条物业侧账号种子，已存在则跳过
 *   b. 对当前 OPENID，按 (ownerOpenid, peerId) 逐条补建 conversations，unread 初始 0
 *   c. 新建的会话各插入 1 条欢迎语进 messages（from:'peer', read:false）
 *
 * 入参：{}（或 { reset: true }，reset 仅在该 OPENID 的 users.role === 'admin' 时放行）
 * 出参：{ code:0, data:{ staff: 4, conversations: 4 } }
 * 幂等：重复运行只补差量，不会重复插欢迎语。
 *
 * 【数据库索引（部署时必须手动建立）】
 *   conversations: { ownerOpenid: 1, peerId: 1 } 唯一索引；{ ownerOpenid: 1, lastTime: -1 } 普通索引
 *   messages:      { conversationId: 1, createdAt: -1 } 普通索引
 *   staff:         { openid: 1 } 普通索引
 *
 * 【类目与合规】住户 ↔ 物业单聊属社交/即时通讯能力。企业主体已微信认证之外，
 * 还需在小程序后台补充「社交-社区/论坛」或「工具-客服」类目，否则审核驳回。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// ─── 物业侧账号种子（与 H5 DATA.conversations 同一套名字，截图与真机才能对上）───
const STAFF_SEED = [
  { _id: 'staff_1', name: '物业管家 · 小宇', avatar: '💁', bg: '#FFF0F2', title: '管家', openid: '', online: true, sortOrder: 1, enabled: true },
  { _id: 'staff_2', name: '物业客服 · 小优', avatar: '🎧', bg: '#e6f9e6', title: '客服', openid: '', online: true, sortOrder: 2, enabled: true },
  { _id: 'staff_3', name: '维修班组 · 李师傅', avatar: '🔧', bg: '#fde8e8', title: '维修', openid: '', online: false, sortOrder: 3, enabled: true },
  { _id: 'staff_4', name: '安保中心', avatar: '🛡️', bg: '#f3e8ff', title: '安保', openid: '', online: true, sortOrder: 4, enabled: true },
];

// 欢迎语（已过机审的固定文案，不参与 msgSecCheck）
const WELCOME = '您好，我是幸福花园物业服务中心，有什么可以帮您？';

// ─── 时间展示串（统一规则：今天 HH:mm / 昨天 / 周一…周日 / MM-DD / YYYY-MM-DD）───
// 云函数容器时区不保证是 UTC+8，所以显式按 UTC+8 取"墙上时间"，避免跨时区偏移。
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

// 管理员校验（复用 users.role === 'admin'）
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
  if (!OPENID) return { code: 403, msg: '无法识别身份' };
  const { reset } = event || {};

  try {
    // 0. 建集合（容错，已存在则忽略）
    for (const name of ['staff', 'conversations', 'messages']) {
      try { await db.createCollection(name); } catch (e) { /* 已存在 */ }
    }

    // reset 仅在管理员下放行：清空该住户已有的会话与消息
    if (reset === true) {
      if (!(await isAdmin(OPENID))) return { code: 403, msg: '无管理权限' };
      const olds = await db.collection('conversations').where({ ownerOpenid: OPENID }).limit(100).get();
      for (const c of olds.data || []) {
        try { await db.collection('messages').where({ conversationId: c._id }).remove(); } catch (e) {}
      }
      try { await db.collection('conversations').where({ ownerOpenid: OPENID }).remove(); } catch (e) {}
    }

    // a. 播种物业侧账号（按 _id 幂等）
    let staffCount = 0;
    for (const st of STAFF_SEED) {
      const doc = Object.assign({}, st);
      const id = doc._id;
      delete doc._id;
      let exists = false;
      try {
        await db.collection('staff').doc(id).get();
        exists = true;
      } catch (e) {
        exists = false;
      }
      if (!exists) {
        await db.collection('staff').add({ data: Object.assign({ _id: id }, doc) });
      }
      staffCount++;
    }

    // b. 为当前住户补建会话（幂等），新建时插一条欢迎语
    const now = Date.now();
    let convCount = 0;
    for (const st of STAFF_SEED) {
      const dup = await db.collection('conversations')
        .where({ ownerOpenid: OPENID, peerId: st._id }).count();
      if (dup.total > 0) { convCount++; continue; }

      const conv = {
        ownerOpenid: OPENID,
        peerId: st._id,
        peerName: st.name,
        peerAvatar: st.avatar,
        peerBg: st.bg,
        online: st.online,
        lastMsg: WELCOME,
        lastTime: now,
        lastTimeText: timeTextOf(now),
        lastFrom: 'peer',
        unread: 0,           // 初始 0：欢迎语不算未读，红点只在物业侧回消息后出现
        createdAt: now,
        updatedAt: now,
      };
      const added = await db.collection('conversations').add({ data: conv });

      await db.collection('messages').add({
        data: {
          conversationId: added._id,
          ownerOpenid: OPENID,
          peerId: st._id,
          from: 'peer',
          fromOpenid: '',
          type: 'text',
          content: WELCOME,
          createdAt: now,
          read: false,
          deleted: false,
        }
      });
      convCount++;
    }

    return { code: 0, data: { staff: staffCount, conversations: convCount } };
  } catch (err) {
    console.error('chatInit error:', err);
    return { code: 500, msg: err.message };
  }
};
