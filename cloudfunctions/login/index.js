/**
 * 静默登录云函数
 * 首次登录自动创建用户记录，老用户返回已存资料
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async () => {
  const { OPENID, UNIONID } = cloud.getWXContext();

  try {
    // 查找已有用户
    const users = await db.collection('users')
      .where({ _openid: OPENID })
      .get();

    if (users.data.length > 0) {
      // 老用户：更新 unionid（如有）和最后登录时间
      const updateData = { lastLoginAt: db.serverDate() };
      if (UNIONID) updateData.unionid = UNIONID;
      await db.collection('users').doc(users.data[0]._id).update({ data: updateData });

      return {
        code: 0,
        isNew: false,
        openid: OPENID,
        userInfo: users.data[0],
      };
    }

    // 新用户：创建记录
    const newUser = {
      _openid: OPENID,
      unionid: UNIONID || null,
      role: 'user',
      houses: [],
      points: 0,
      createdAt: db.serverDate(),
      lastLoginAt: db.serverDate(),
    };

    await db.collection('users').add({ data: newUser });

    return {
      code: 0,
      isNew: true,
      openid: OPENID,
      userInfo: newUser,
    };

  } catch (err) {
    console.error('login error:', err);
    return { code: 500, msg: '登录失败' };
  }
};
