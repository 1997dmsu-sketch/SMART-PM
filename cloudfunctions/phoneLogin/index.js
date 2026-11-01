/**
 * 手机号快捷登录云函数（租户登录）
 *
 * 入参：{ code } —— 来自 <button open-type="getPhoneNumber"> 回调的 e.detail.code
 *
 * 流程：
 *   1. cloud.openapi.phonenumber.getPhoneNumber({ code }) 换取手机号（云调用，无需自管 access_token / 合法域名）
 *   2. 按 OPENID upsert users：存在补 phone，不存在建号
 *   3. 按 phone 查 owners 集合，命中则回填 users.houses 绑定房产
 *
 * 出参：{ code:0, phone, bound, userInfo }
 * 说明：开发者工具虚拟号返回 12066600001~0004（自然查不到 owners → bound=false，验证流程照常走通）；
 *      真机需企业认证 + 额度（0.03 元/次，1000 次免费）。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const { code } = event || {};
  const { OPENID, UNIONID } = cloud.getWXContext();

  if (!code) return { code: 400, msg: '缺少 code' };
  if (!OPENID) return { code: 403, msg: '无法识别身份' };

  try {
    // 1. code 换手机号
    let phone;
    try {
      const res = await cloud.openapi.phonenumber.getPhoneNumber({ code });
      phone = res.phoneInfo && res.phoneInfo.purePhoneNumber;
      if (!phone) return { code: 500, msg: '未获取到手机号' };
    } catch (e) {
      // 额度不足单独提示（errno 1400001）
      if (e && (e.errno === 1400001 || e.errCode === 1400001)) {
        return { code: 500, msg: '手机号验证额度已用完，请联系管理员充值' };
      }
      console.error('getPhoneNumber error:', e);
      return { code: 500, msg: (e && e.errMsg) || '获取手机号失败' };
    }

    // 2. 按 OPENID upsert users
    const users = await db.collection('users').where({ _openid: OPENID }).get();
    let userId;
    let userInfo;

    if (users.data.length > 0) {
      userId = users.data[0]._id;
      const updateData = { phone, phoneBoundAt: db.serverDate(), lastLoginAt: db.serverDate() };
      if (UNIONID) updateData.unionid = UNIONID;
      await db.collection('users').doc(userId).update({ data: updateData });
      userInfo = Object.assign({}, users.data[0], { phone });
    } else {
      const newUser = {
        _openid: OPENID,
        unionid: UNIONID || null,
        role: 'user',
        phone,
        phoneBoundAt: db.serverDate(),
        houses: [],
        points: 0,
        createdAt: db.serverDate(),
        lastLoginAt: db.serverDate(),
      };
      const added = await db.collection('users').add({ data: newUser });
      userId = added._id;
      userInfo = Object.assign({}, newUser, { phone });
    }

    // 3. 按 phone 回填房产（owners 集合）
    let bound = Array.isArray(userInfo.houses) && userInfo.houses.length > 0;
    try {
      const owners = await db.collection('owners').where({ phone }).limit(1).get();
      // 管理后台手动维护的房产优先，不再被旧 owners 记录覆盖。
      if (owners.data.length > 0 && !userInfo.housesManaged) {
        const owner = owners.data[0];
        const houseIds = (owner.houses || []).map(h => h.houseId).filter(Boolean);
        const patch = { houses: houseIds };
        if (owner.name) patch.name = owner.name;
        await db.collection('users').doc(userId).update({ data: patch });
        userInfo = Object.assign({}, userInfo, patch);
        bound = houseIds.length > 0;
      }
    } catch (e) {
      // owners 集合可能尚未初始化，回填失败不影响登录本身
      console.warn('owners 匹配失败（可忽略）:', e.message);
    }

    return { code: 0, phone, bound, userInfo };
  } catch (err) {
    console.error('phoneLogin error:', err);
    return { code: 500, msg: '登录失败' };
  }
};
