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
 * 「本组织成员」是**逐条按记录锚定**的：仅当调用者是「该条 content.orgId
 * 所属组织」的 active 成员时，这一条才可能返回 vrFile；A 组织成员拿不到
 * B 组织 content 的 vrFile，legacy 无 orgId 的内容一律按非成员处理。
 * 不是「只要有任意一条 active 成员关系就对全部行放行」的全局成员态。
 *
 * 失败关闭：成员关系判定或 file_assets 查询任一步异常/集合缺失，一律降级为
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
// store.list('file_assets') 同构。
// limit(100) 是**有意设定的上限**，不是遗漏分页：DB-07 落地初期登记量小，
// 超过 100 条时多出的按「未登记」处理 —— 方向是失败关闭（宁可少返回
// vrFile，绝不会多返回），可接受。后续登记量上来再改为分页拉全量。
// 集合不存在 / 查询失败由调用方 catch 兜底为剔除。
async function loadAssets() {
  const res = await db.collection('file_assets').limit(100).get();
  return (res && res.data) || [];
}

// 三态判定（§5.1）：返回该调用者是 active 成员的组织 orgId 集合，供逐条
// 按 content.orgId 锚定，而不是一个全局的「是/否成员」标志。
//   - null：匿名（无 OPENID，含服务侧调用）→ 字段集 A
//   - []  ：有 OPENID 但 users 无记录 / 无 active 成员关系（outsider）→ 字段集 A
//   - ['org-a', …]：active 成员关系的 orgId 去重数组（成员态，逐条比对）
// OPENID→users 沿用 phoneLogin/index.js:44 既有约定
// （users.where({ _openid: OPENID })），不引入新的身份字段。
// users→org_memberships 的 principalId 用 users._id，与 org.mjs:118-134
// organizationsFor('user', principalId) 及 bootstrap 用 account._id 同构
// （team-lead 裁定采纳；DB-03 若改走 auth_identities 再同步改这一行）。
async function resolveMemberOrgs() {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return null;
    const users = await db.collection('users').where({ _openid: OPENID }).get();
    const user = users.data && users.data[0];
    if (!user) return [];
    const mem = await db.collection('org_memberships').where({
      principalType: 'user',
      principalId: user._id,
      status: 'active',
    }).get();
    if (!mem.data || mem.data.length === 0) return [];
    // 只收字符串 orgId 并去重；空/非字符串 orgId 不能作为锚点，否则
    // legacy 无 orgId 的记录可能被错误放行（失败关闭）。
    return [...new Set(
      mem.data
        .map((m) => m.orgId)
        .filter((id) => typeof id === 'string' && id),
    )];
  } catch (err) {
    // users / org_memberships 集合可能尚未初始化（DB-07/DB-03 之前），
    // 失败关闭到「非成员」态，vrFile 一律剔除。
    console.warn('contentList membership check failed (fail-closed):', err && err.message);
    return [];
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

    const memberOrgs = await resolveMemberOrgs();
    // 没有任何 active 成员组织时无需读 file_assets（匿名 / outsider 恒为
    // 字段集 A）；有成员组织时读一次供逐条 public 判定。
    let assets = [];
    if (memberOrgs && memberOrgs.length > 0) {
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
      // 成员态是「该条内容所属组织的成员」，不是「任意组织的成员」：
      // 只有 row.orgId 命中该调用者的 active 组织集合，这一条才附带 vrFile。
      // row.orgId 缺失 / 非字符串（legacy 内容）一律按非成员处理，不含 vrFile。
      const isMemberOfThisRow =
        memberOrgs &&
        memberOrgs.length > 0 &&
        typeof row.orgId === 'string' &&
        row.orgId &&
        memberOrgs.includes(row.orgId);
      if (isMemberOfThisRow) {
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
