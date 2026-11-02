/**
 * 内容读取云函数
 *
 * 供前端内容页读取已上架（enabled=true）的内容，按 sortOrder 升序返回。
 * 入参：{ type? } —— 字符串或字符串数组（如 ['house','share']）。
 *
 * DB-07 §5.1：三态鉴权 + 字段白名单收敛。改造前向未登录调用返回完整
 * content 文档（含 vrFile.url），是对象定位泄露路径。
 *   - 未登录（无 OPENID，含服务侧调用）/ 非本组织成员 → 字段集 A（不含任何文件引用）
 *   - 本组织成员 → 字段集 A + vrFile（仅当其 url 命中 file_assets 且 public）
 * 返回结构恒为 {code:0,data,total}（miniprogram/services/api.js:47 依赖 data）。
 *
 * 失败关闭：成员态判定或 file_assets 查询任一步异常/集合缺失，一律降级为
 * 「非成员」并剔除 vrFile，绝不因鉴权异常放大暴露面或破坏主返回结构。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// 字段集 A（§5.1 白名单）：覆盖 home/vr 两页实际读取的全部字段
// （home/index.js:26-38、home/index.wxml:17-23、vr/index.js:6-9）。
// 用白名单投影而非黑名单删除：orgId / 实名字段 / assetIds / fileIds /
// file_links / vrFile 及未来新增的敏感字段一律自动剔除。
const FIELDS_A = [
  '_id', 'type', 'title', 'name', 'description', 'content', 'summary',
  'image', 'cover', 'coverImage', 'images', 'author', 'avatar',
  'likes', 'likeCount', 'tags', 'sortOrder', 'enabled', 'houseId', 'vrUrl',
];

function projectA(row) {
  const out = {};
  for (const k of FIELDS_A)
    if (Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k];
  return out;
}

// 命中集合（§11.6）= objectKey ∪ legacyUrls ∪ cloudFileId，与
// admin-web/server.mjs:60-66 的 assetLocators 同构。漏掉 cloudFileId 会让
// live 下按 cloud:// fileID 查询的已登记记录被误判「未登记」而剔除 vrFile。
function assetLocators(asset) {
  return [
    asset.objectKey,
    asset.cloudFileId,
    ...(Array.isArray(asset.legacyUrls) ? asset.legacyUrls : []),
  ].filter((v) => typeof v === 'string' && v);
}

// objectKey 对 cloud 是 cloudPath（无 cloud:// 前缀），对 local 是无前导
// 斜杠的相对路径；legacyUrls / cloudFileId 可能存 cloud:// 全串。三种候选
// 都纳入，避免不同登记来源的 url 形态漏判（§11.1 前缀按 storage 分叉）。
function urlCandidates(url) {
  const m = String(url).match(/^cloud:\/\/[^/]+\/(.+)$/);
  const raw = String(url);
  return [raw, raw.replace(/^\//, ''), m ? m[1] : raw].filter(
    (v, i, a) => v && a.indexOf(v) === i,
  );
}

// vrFile 仅在成员态返回，且 url 必须命中 file_assets 的 public 记录。
// 指向 private 或未登记 → 剔除；命中集合里任意一条 private 也剔除（失败关闭）。
// 只回投 vr.mjs:44 的 {url,name,size} 三字段：contentAdmin 存在绕过
// validate() 的写入旁路（§9-8），避免夹带任意额外字段。
function publicVrFile(vrFile, assets) {
  if (!vrFile || typeof vrFile !== 'object' || Array.isArray(vrFile)) return null;
  const url = typeof vrFile.url === 'string' ? vrFile.url : '';
  if (!url) return null;
  const candidates = urlCandidates(url);
  const hits = assets.filter((a) => {
    const locators = assetLocators(a);
    return candidates.some((c) => locators.includes(c));
  });
  if (hits.length === 0 || !hits.every((h) => h.visibility === 'public')) return null;
  const out = { url };
  if (typeof vrFile.name === 'string') out.name = vrFile.name;
  if (typeof vrFile.size === 'number') out.size = vrFile.size;
  return out;
}

// 一次读回 file_assets 在内存里做命中集合匹配，与 admin-web/server.mjs 的
// store.list('file_assets') 同构。limit(100)：DB-07 落地初期登记量小；超出
// 部分按「未登记」处理（失败关闭方向：宁可少返回 vrFile，不会多返回）。
// 集合不存在 / 查询失败由 loadPublicVrAssets 的调用方 catch 兜底为剔除。
async function loadAssets() {
  const res = await db.collection('file_assets').limit(100).get();
  return (res && res.data) || [];
}

// 三态判定（§5.1）。OPENID→users 沿用 phoneLogin/index.js:44 既有约定
// （users.where({ _openid: OPENID })），不引入新的身份字段。
// users→org_memberships 的 principalId 用 users._id，与 org.mjs:118-134
// organizationsFor('user', principalId) 及 bootstrap 用 account._id 同构。
// 说明：方案 §5.1 判定式为「有任意 status=active 成员关系」，云函数环境
// 无组织 orgId 配置来源，故不做逐条 content.orgId 匹配（见回报缺口）。
async function resolveMemberState() {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return 'anonymous';
    const users = await db.collection('users').where({ _openid: OPENID }).get();
    const user = users.data && users.data[0];
    if (!user) return 'outsider';
    const mem = await db.collection('org_memberships').where({
      principalType: 'user',
      principalId: user._id,
      status: 'active',
    }).get();
    if (!mem.data || mem.data.length === 0) return 'outsider';
    return 'member';
  } catch (err) {
    // users / org_memberships 集合可能尚未初始化（DB-07/DB-03 之前），
    // 失败关闭到「非成员」态，vrFile 一律剔除。
    console.warn('contentList membership check failed (fail-closed):', err && err.message);
    return 'outsider';
  }
}

exports.main = async (event) => {
  const { type } = event || {};
  try {
    let query = db.collection('content').where({ enabled: true });

    if (type) {
      const types = Array.isArray(type) ? type : [type];
      query = query.where({ type: _.in(types) });
    }

    const res = await query.orderBy('sortOrder', 'asc').limit(100).get();

    const state = await resolveMemberState();
    let assets = [];
    if (state === 'member') {
      try {
        assets = await loadAssets();
      } catch (err) {
        // file_assets 未建 / 查询失败 → 无可用 public 依据，剔除全部 vrFile。
        console.warn('contentList file_assets check failed (fail-closed):', err && err.message);
        assets = [];
      }
    }

    const data = res.data.map((row) => {
      const item = projectA(row);
      if (state === 'member') {
        const vrFile = publicVrFile(row.vrFile, assets);
        if (vrFile) item.vrFile = vrFile;
      }
      return item;
    });

    return { code: 0, data, total: data.length };
  } catch (err) {
    console.error('contentList error:', err);
    return { code: 500, msg: err.message };
  }
};
