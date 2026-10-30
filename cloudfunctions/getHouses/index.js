/**
 * 房源列表查询云函数
 * 支持多条件筛选：小区 / 价格区间 / 户型 / 整租合租
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { community, priceMin, priceMax, roomType, rentType, page = 1, pageSize = 20 } = event;

  try {
    let query = db.collection('houses').where({ status: '在租' });

    // 按小区筛选
    if (community) {
      query = query.where({ community });
    }

    // 按价格区间
    if (priceMin !== undefined && priceMax !== undefined) {
      query = query.where({ price: _.gte(priceMin).and(_.lt(priceMax)) });
    } else if (priceMin !== undefined) {
      query = query.where({ price: _.gte(priceMin) });
    } else if (priceMax !== undefined) {
      query = query.where({ price: _.lt(priceMax) });
    }

    // 按户型
    if (roomType) {
      query = query.where({ rooms: new RegExp(`^${roomType}`) });
    }

    // 按租赁方式
    if (rentType && rentType !== 'all') {
      const rt = rentType === 'whole' ? '整租' : '合租';
      query = query.where({ rentType: rt });
    }

    // 分页
    const skip = (page - 1) * pageSize;
    const total = await query.count();
    const list = await query.skip(skip).limit(pageSize).get();

    return {
      code: 0,
      data: {
        houses: list.data,
        total: total.total,
        page,
        pageSize,
        totalPages: Math.ceil(total.total / pageSize),
      }
    };
  } catch (err) {
    console.error('getHouses error:', err);
    return { code: 500, msg: '查询失败' };
  }
};
