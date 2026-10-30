/**
 * 内容初始化云函数
 *
 * 把全站运营内容（房源/改造分享/活动/生活服务/轮播/公告）迁移到统一的
 * content 集合，供前端内容页读取、小程序内管理页增删改。
 *
 * 幂等：content 集合已有数据则跳过，避免重复插入。
 * 调用：部署后运行一次即可；后续内容由「我的 → 内容管理」维护。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// ─── 全量种子数据 ───
// 通用字段：type / title / icon / bg / tags / sortOrder / enabled
// 各类型专属字段见下注释。
const SEED = [
  // ============ 房源 house ============
  // 专属：rooms / area / floor / price / rentType / community / distance / isNew / isUrgent
  { type: 'house', sortOrder: 1, title: '幸福花园 精装三室两厅 南北通透 拎包入住', rooms: '3室2厅', area: 128, floor: '15/32层', price: 4200, rentType: '整租', community: '幸福花园', distance: '距市民中心站500m', isNew: true, isUrgent: false, icon: '🏠', bg: '#FFF0F2', tags: ['近地铁', '精装修', '有电梯', '拎包入住'] },
  { type: 'house', sortOrder: 2, title: '阳光新村 温馨两居室 阳光充足 交通便利', rooms: '2室1厅', area: 85, floor: '8/18层', price: 2800, rentType: '整租', community: '阳光新村', distance: '距文体中心站800m', isNew: false, isUrgent: true, icon: '🏡', bg: '#e6f9e6', tags: ['阳光房', '交通便利', '家电齐全'] },
  { type: 'house', sortOrder: 3, title: '翠岗花园 朝南主卧带阳台 限女生 可短租', rooms: '3室1厅', area: 25, floor: '12/26层', price: 1500, rentType: '合租', community: '翠岗花园', distance: '距市民中心站300m', isNew: true, isUrgent: false, icon: '🛏️', bg: '#FFF0F2', tags: ['主卧', '带阳台', '可短租', '限女生'] },
  { type: 'house', sortOrder: 4, title: '云城花苑 豪华四居室 花园洋房 品质生活', rooms: '4室2厅', area: 165, floor: '3/6层', price: 6500, rentType: '整租', community: '云城花苑', distance: '距机场东站1.2km', isNew: false, isUrgent: false, icon: '🏘️', bg: '#f3e8ff', tags: ['花园洋房', '豪华装修', '带车位', '品质小区'] },
  { type: 'house', sortOrder: 5, title: '机场小区 精装一居室 独立厨卫 适合白领', rooms: '1室1厅', area: 48, floor: '20/30层', price: 2200, rentType: '整租', community: '机场小区', distance: '距机场东站600m', isNew: true, isUrgent: false, icon: '🏢', bg: '#fce7f3', tags: ['独立厨卫', '精装修', '首次出租'] },
  { type: 'house', sortOrder: 6, title: '幸福花园 温馨次卧 室友友善 包物业网络', rooms: '2室1厅', area: 18, floor: '10/32层', price: 1200, rentType: '合租', community: '幸福花园', distance: '距市民中心站500m', isNew: false, isUrgent: true, icon: '🛋️', bg: '#FFF0F2', tags: ['包物业', '包网络', '室友友善'] },
  { type: 'house', sortOrder: 7, title: '碳嘻公寓 LOFT精装一居 年轻社群 拎包入住', rooms: '1室1厅', area: 38, floor: '5/8层', price: 1800, rentType: '整租', community: '碳嘻公寓', distance: '距市民中心站400m', isNew: true, isUrgent: false, icon: '🏙️', bg: '#1A1A1A', tags: ['LOFT', '年轻社群', '拎包入住', '网红公寓'] },
  { type: 'house', sortOrder: 8, title: '碳嘻公寓 朝南大单间 独立卫浴 采光好', rooms: '1室0厅', area: 25, floor: '3/8层', price: 1200, rentType: '整租', community: '碳嘻公寓', distance: '距市民中心站400m', isNew: true, isUrgent: false, icon: '🌇', bg: '#FFF0F2', tags: ['独立卫浴', '采光好', '电梯房'] },
  { type: 'house', sortOrder: 9, title: '碳嘻公寓 精装Loft 上下两层 适合情侣', rooms: '2室1厅', area: 55, floor: '6/8层', price: 2500, rentType: '整租', community: '碳嘻公寓', distance: '距市民中心站400m', isNew: false, isUrgent: true, icon: '🏗️', bg: '#e6f9e6', tags: ['双层Loft', '精装修', '适合情侣', '有阳台'] },
  { type: 'house', sortOrder: 10, title: '圆点公寓 简约一居 日式原木风 安静舒适', rooms: '1室1厅', area: 42, floor: '9/12层', price: 2000, rentType: '整租', community: '圆点公寓', distance: '距文体中心站600m', isNew: true, isUrgent: false, icon: '🟡', bg: '#FFF0F2', tags: ['日式原木', '安静', '品牌公寓'] },
  { type: 'house', sortOrder: 11, title: '圆点公寓 朝南主卧 带独立阳台 限女生', rooms: '3室1厅', area: 22, floor: '7/12层', price: 1300, rentType: '合租', community: '圆点公寓', distance: '距文体中心站600m', isNew: false, isUrgent: false, icon: '🌸', bg: '#fce7f3', tags: ['主卧阳台', '限女生', '精装修'] },
  { type: 'house', sortOrder: 12, title: '圆点公寓 顶楼复式 全景落地窗 视野绝佳', rooms: '2室2厅', area: 68, floor: '12/12层', price: 3200, rentType: '整租', community: '圆点公寓', distance: '距文体中心站600m', isNew: true, isUrgent: true, icon: '🏡', bg: '#1A1A1A', tags: ['顶楼复式', '落地窗', '视野好', '首次出租'] },
  { type: 'house', sortOrder: 13, title: '福海花园 精装两居 地铁口 拎包入住', rooms: '2室1厅', area: 82, floor: '11/25层', price: 3200, rentType: '整租', community: '福海花园', distance: '距文体中心站300m', isNew: true, isUrgent: false, icon: '🏠', bg: '#e6f9e6', tags: ['近地铁', '精装修', '拎包入住'] },
  { type: 'house', sortOrder: 14, title: '中央公园站 品牌一居 智能门锁 白领首选', rooms: '1室1厅', area: 45, floor: '18/33层', price: 2600, rentType: '整租', community: '云城片区', distance: '距中央公园站200m', isNew: true, isUrgent: false, icon: '🔑', bg: '#FFF0F2', tags: ['智能门锁', '近地铁', '品牌公寓'] },
  { type: 'house', sortOrder: 15, title: '汇金大厦 商务LOFT 复式 办公居住两用', rooms: '1室1厅', area: 50, floor: '22/28层', price: 3000, rentType: '整租', community: '汇金大厦', distance: '距市民中心站350m', isNew: false, isUrgent: true, icon: '🏙️', bg: '#1A1A1A', tags: ['LOFT', '复式', '商住两用'] },
  { type: 'house', sortOrder: 16, title: '桥头社区 三房两厅 采光好 带学位 适合家庭', rooms: '3室2厅', area: 105, floor: '6/16层', price: 4500, rentType: '整租', community: '桥头社区', distance: '距桥头地铁站500m', isNew: false, isUrgent: false, icon: '🏡', bg: '#f3e8ff', tags: ['带学位', '采光好', '适合家庭'] },
  { type: 'house', sortOrder: 17, title: '云城桥头 朝南主卧 家电齐全 限男生', rooms: '3室1厅', area: 20, floor: '14/22层', price: 1100, rentType: '合租', community: '云城桥头', distance: '距桥头地铁站400m', isNew: true, isUrgent: false, icon: '🛏️', bg: '#e6f0f0', tags: ['主卧', '家电齐全', '限男生'] },
  { type: 'house', sortOrder: 18, title: '兴围村 独立小院 一房一厅 带小花园', rooms: '1室1厅', area: 40, floor: '1/2层', price: 1900, rentType: '整租', community: '兴围村', distance: '距机场东站800m', isNew: false, isUrgent: true, icon: '🌻', bg: '#e6f9e6', tags: ['独立小院', '带花园', '安静'] },

  // ============ 改造分享 share ============
  // 专属：author / likes
  { type: 'share', sortOrder: 1, title: '💰 39 元日落灯，10㎡ 出租屋氛围感直接拉满', icon: '🌇', bg: '#FFF0F2', author: '社区小管家', likes: 3280, tags: ['氛围小物', '免安装', '租房好物'] },
  { type: 'share', sortOrder: 2, title: '3 块香薰灯 + 香片，回家推门就是高级酒店味', icon: '🕯️', bg: '#fce7f3', author: '宝藏改造师', likes: 2100, tags: ['氛围小物', '一键安装'] },
  { type: 'share', sortOrder: 3, title: '出租屋门锁爆改智能锁，钥匙说拜拜，物业都来抄作业', icon: '🔐', bg: '#1A1A1A', author: '社区小管家', likes: 5600, tags: ['爆改', '智能门锁', '免动手'] },
  { type: 'share', sortOrder: 4, title: '旧茶几 0 元爆改边几，全网最简教程，新手闭眼冲', icon: '🪑', bg: '#e6f9e6', author: '出租屋研究所', likes: 1840, tags: ['爆改', '旧物改造', '免动手'] },
  { type: 'share', sortOrder: 5, title: '免打孔置物架，一键安装不伤墙，房东押金稳稳的', icon: '🧰', bg: '#FFF0F2', author: '社区小管家', likes: 4210, tags: ['一键安装', '免打孔', '收纳'] },
  { type: 'share', sortOrder: 6, title: '磁吸感应灯条，无需接线 30 秒装好，深夜起夜神器', icon: '💡', bg: '#e6f9e6', author: '宝藏改造师', likes: 2980, tags: ['一键安装', '免接线', '氛围小物'] },
  { type: 'share', sortOrder: 7, title: '几十块的地毯 + 抱枕，客厅档次蹭蹭涨', icon: '🛋️', bg: '#f3e8ff', author: '出租屋研究所', likes: 1560, tags: ['氛围小物', '软装'] },
  { type: 'share', sortOrder: 8, title: '1㎡ 飘窗爆改书桌，出租屋也能有自己的办公角', icon: '🖥️', bg: '#e0f2fe', author: '宝藏改造师', likes: 3420, tags: ['爆改', '飘窗改造', '免打孔'] },
  { type: 'share', sortOrder: 9, title: '免胶静电墙贴，撕下不留痕，房东看了都夸', icon: '🖼️', bg: '#fce7f3', author: '社区小管家', likes: 1230, tags: ['一键安装', '免胶', '装饰'] },
  { type: 'share', sortOrder: 10, title: '智能香薰机 APP 定时，进门就有家的味道', icon: '🌿', bg: '#e6f9e6', author: '智慧物业优选', likes: 1980, tags: ['氛围小物', '智能家居', '一键安装'] },
  { type: 'share', sortOrder: 11, title: '落日投影灯，出租屋氛围神器，一键开灯告别单调', icon: '🌅', bg: '#FFF0F2', author: '宝藏改造师', likes: 2450, tags: ['氛围小物', '一键安装', '租房好物'] },
  { type: 'share', sortOrder: 12, title: '窗帘爆改：遮光+纱帘双层，免打孔搞定出租屋采光', icon: '🪟', bg: '#f3e8ff', author: '出租屋研究所', likes: 1730, tags: ['爆改', '免打孔', '氛围小物'] },
  { type: 'share', sortOrder: 13, title: '免打孔门后挂钩，3 秒安装，玄关收纳翻倍', icon: '🪝', bg: '#e6f9e6', author: '社区小管家', likes: 3020, tags: ['一键安装', '免打孔', '收纳'] },
  { type: 'share', sortOrder: 14, title: '桌面感应小夜灯，磁吸安装，起夜不再摸黑', icon: '💡', bg: '#e0f2fe', author: '宝藏改造师', likes: 1870, tags: ['氛围小物', '一键安装', '磁吸'] },
  { type: 'share', sortOrder: 15, title: '智能插座 APP 远程控制，忘关电器不再焦虑', icon: '🔌', bg: '#1A1A1A', author: '智慧物业优选', likes: 2640, tags: ['智能家居', '一键安装', '安全'] },
  { type: 'share', sortOrder: 16, title: '门后收纳架，免打孔挂包包雨伞，小空间大利用', icon: '🧺', bg: '#FFF0F2', author: '社区小管家', likes: 1290, tags: ['收纳', '一键安装', '免打孔'] },

  // ============ 生活服务 service ============
  // 专属：desc / price（有则为推荐卡，无则为服务入口）
  { type: 'service', sortOrder: 1, title: '在线看房', icon: '🏠', bg: '#FFF0F2', desc: '', price: '' },
  { type: 'service', sortOrder: 2, title: '智联商城', icon: '🛒', bg: '#FFF0F2', desc: '', price: '' },
  { type: 'service', sortOrder: 3, title: '家政保洁', icon: '🧹', bg: '#e6f9e6', desc: '', price: '' },
  { type: 'service', sortOrder: 4, title: '邻里互助', icon: '🤝', bg: '#e6f0f0', desc: '', price: '' },
  { type: 'service', sortOrder: 5, title: '快递代收', icon: '📦', bg: '#FFF0F2', desc: '', price: '' },
  { type: 'service', sortOrder: 6, title: '便民维修', icon: '🔧', bg: '#fde8e8', desc: '', price: '' },
  { type: 'service', sortOrder: 7, title: '社区圈子', icon: '💬', bg: '#ede9fe', desc: '', price: '' },
  { type: 'service', sortOrder: 8, title: '二手闲置', icon: '♻️', bg: '#FFF0F2', desc: '', price: '' },
  { type: 'service', sortOrder: 9, title: '宠物服务', icon: '🐾', bg: '#FFF0F2', desc: '', price: '' },
  { type: 'service', sortOrder: 10, title: '空调深度清洗 专业服务', desc: '高温蒸汽杀菌，深度清洁，让您清凉一夏', price: '88', icon: '❄️', bg: '#FFF0F2' },
  { type: 'service', sortOrder: 11, title: '暑期少儿游泳班', desc: '幸福花园泳池教学，专业教练，6-12岁小班', price: '599', icon: '🏊', bg: '#e6f9e6' },
  { type: 'service', sortOrder: 12, title: '全屋家电清洗套餐', desc: '空调+洗衣机+冰箱三件套，高温蒸汽深度除菌', price: '199', icon: '🧽', bg: '#e6f9e6' },
  { type: 'service', sortOrder: 13, title: '专业开锁换锁 上门服务', desc: '24小时响应，本片区30分钟达，持证上岗', price: '60起', icon: '🔐', bg: '#FFF0F2' },
  { type: 'service', sortOrder: 14, title: '家庭宽带安装 千兆光纤', desc: '当天装机，工程师上门，含路由器调试', price: '免费安装', icon: '📶', bg: '#e0f2fe' },

  // ============ 轮播 banner ============
  { type: 'banner', sortOrder: 2, title: '🧹 家政保洁 首单立减20', bg: '#FC2545' },
  { type: 'banner', sortOrder: 3, title: '🎓 暑期托管班 火热报名', bg: '#333333' },
  { type: 'banner', sortOrder: 4, title: '🏮 中秋游园会 9月15日 猜灯谜赢好礼', bg: '#C0392B' },

  // ============ 公告 notice ============
  // 专属：date / important / category(notice|report|activity|tips)
  { type: 'notice', sortOrder: 1, title: '关于幸福花园门禁系统升级的通知', date: '2024-06-10', category: 'notice', important: true },
  { type: 'notice', sortOrder: 2, title: '幸福花园2024年第二季度物业服务报告', date: '2024-06-05', category: 'report', important: false },
  { type: 'notice', sortOrder: 3, title: '本片区电梯年度检修时间安排', date: '2024-05-28', category: 'notice', important: true },
  { type: 'notice', sortOrder: 4, title: '关于夏季安全用电的温馨提示', date: '2024-05-20', category: 'tips', important: false },
  { type: 'notice', sortOrder: 5, title: '关于幸福花园停水检修的通知', date: '2026-09-10', category: 'notice', important: true },
  { type: 'notice', sortOrder: 6, title: '本片区消防演练通知', date: '2026-09-05', category: 'notice', important: false },
  { type: 'notice', sortOrder: 7, title: '关于调整地下停车场收费标准的通知', date: '2026-08-28', category: 'notice', important: true },
];

exports.main = async () => {
  const results = [];

  // 1. 创建 content 集合（容错）
  try {
    await db.createCollection('content');
    results.push({ action: 'collection:content', status: 'created' });
  } catch (e) {
    results.push({ action: 'collection:content', status: 'exists_or_error', err: e.errCode });
  }

  // 2. 增量追加：按 title 查重，只插入不存在的，重复运行安全（幂等）
  let inserted = 0;
  let skipped = 0;
  for (const doc of SEED) {
    const dup = await db.collection('content').where({ title: doc.title }).count();
    if (dup.total > 0) { skipped++; continue; }
    const data = Object.assign({ enabled: true, updatedAt: Date.now() }, doc);
    await db.collection('content').add({ data });
    inserted++;
  }

  return {
    code: 0,
    msg: `内容初始化完成：新增 ${inserted} 条，跳过已存在 ${skipped} 条`,
    count: inserted,
    results,
    nextSteps: [
      '1. 小程序编译后，发现页应显示「房源 + 改造分享」双列瀑布流',
      '2. 「我的 → 内容管理」可增删改、上下架全站内容',
      '3. 正式上线前：在 users 集合把管理员 openid 对应文档的 role 改为 "admin" 收紧权限',
    ],
  };
};
