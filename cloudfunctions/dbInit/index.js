/**
 * 数据库初始化云函数
 *
 * 首次部署时手动调用一次，自动创建：
 *   1. 6 个核心集合
 *   2. devices 集合（TTLock 门禁设备）
 *   3. sys_config 集合（TTLock API 凭证等）
 *   4. 种子数据（测试门禁、测试房源）
 *
 * 调用方式：开发者工具 → 云函数 → dbInit → 测试运行
 */
const crypto = require('crypto');
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// ─── 核心集合定义 ───
const COLLECTIONS = [
  'users',          // 用户表
  'owners',         // 业主表（手机号 → 房产绑定）
  'houses',         // 房源表
  'orders',         // 工单/订单表
  'coupons',        // 优惠券表
  'devices',        // 门禁设备表（TTLock）
  'activities',     // 活动表
  'unlockRecords',  // 开门记录表
  'bills',          // 账单表
  'sys_config',     // 系统配置表
  'favorites',      // 收藏表
  'rooms',          // 物业房产表（门锁授权绑定）
];

// ─── TTLock 门禁种子数据 ───
const SEED_DEVICES = [
  {
    deviceId: 'DEV001',
    platform: 'ttlock',
    platformDeviceId: '30736593',
    lockId: 30736593,
    macAddress: 'BD:4B:D3:C8:EE:14',
    gatewayId: null,
    deviceName: '幸福花园大门',
    location: '云城区幸福北路1号',
    type: 'main',
    houseId: 'public',
    distance: '50m',
    status: 'online',
    sortOrder: 1,
  },
  {
    deviceId: 'DEV002',
    platform: 'ttlock',
    platformDeviceId: null,
    lockId: null,
    macAddress: null,
    gatewayId: null,
    deviceName: 'A栋单元门',
    location: '幸福花园A栋2单元',
    type: 'unit',
    houseId: 'public',
    distance: '120m',
    status: 'online',
    sortOrder: 2,
  },
  {
    deviceId: 'DEV003',
    platform: 'ttlock',
    platformDeviceId: null,
    lockId: null,
    macAddress: null,
    gatewayId: null,
    deviceName: '地下车库入口',
    location: '幸福花园B1层东入口',
    type: 'garage',
    houseId: 'public',
    distance: '200m',
    status: 'online',
    sortOrder: 3,
  },
  {
    deviceId: 'DEV004',
    platform: 'ttlock',
    platformDeviceId: null,
    lockId: null,
    macAddress: null,
    gatewayId: null,
    deviceName: '幸福花园西门',
    location: '云城区幸福南路侧门',
    type: 'main',
    houseId: 'public',
    distance: '300m',
    status: 'offline',
    sortOrder: 4,
  },
  {
    deviceId: 'DEV009',
    platform: 'ttlock',
    platformDeviceId: '22507329',
    lockId: 22507329,
    macAddress: '38:C6:7C:E0:A7:37',
    gatewayId: null,
    deviceName: '608房',
    location: '幸福花园A栋2单元608',
    type: 'main',
    houseId: 'HF-A2-1506',
    distance: '',
    status: 'online',
    sortOrder: 5,
  },
  {
    deviceId: 'DEV010',
    platform: 'tuya',
    platformDeviceId: '6c0699bf4olxwax5',
    lockId: null,
    macAddress: null,
    gatewayId: null,
    deviceName: '涂鸦智能门锁',
    location: '幸福花园A栋2单元608',
    type: 'main',
    houseId: 'HF-A2-1506',
    distance: '',
    status: 'online',
    sortOrder: 6,
  },
  {
    deviceId: 'DEV011',
    platform: 'tuya',
    platformDeviceId: '6c398a1514cc9f81153fil',
    lockId: null,
    macAddress: null,
    gatewayId: null,
    deviceName: '涂鸦智能门锁',
    location: '幸福花园A栋2单元608',
    type: 'main',
    houseId: 'HF-A2-1506',
    distance: '',
    status: 'online',
    sortOrder: 7,
  },
];

// ─── 系统配置种子 ───
// 敏感凭证一律从环境变量读取（真实值不落代码库，见项目根目录 secrets.local.md）。
// 未配置环境变量时 value 为空，main 会跳过写入（避免空值覆盖已有真实凭证）。
const SEED_CONFIG = [
  {
    key: 'ttlock_client_id',
    value: process.env.TTLOCK_CLIENT_ID || '',
    description: 'TTLock 开放平台应用 Client ID（环境变量 TTLOCK_CLIENT_ID）',
  },
  {
    key: 'ttlock_client_secret',
    value: process.env.TTLOCK_CLIENT_SECRET || '',
    description: 'TTLock 开放平台应用 Client Secret（环境变量 TTLOCK_CLIENT_SECRET，请勿泄露）',
  },
  {
    key: 'ttlock_username',
    value: process.env.TTLOCK_USERNAME || '',
    description: 'TTLock App 账号（环境变量 TTLOCK_USERNAME）',
  },
  {
    key: 'ttlock_password_md5',
    value: process.env.TTLOCK_PASSWORD_MD5 || '',
    description: 'TTLock App 密码的 32 位小写 MD5 值（环境变量 TTLOCK_PASSWORD_MD5）',
  },
  {
    key: 'ttlock_token',
    value: '{}',            // access_token 缓存（自动刷新）
    description: 'TTLock API access_token 缓存（自动维护）',
  },
  {
    key: 'tuya_access_id',
    value: process.env.TUYA_ACCESS_ID || '',
    description: '涂鸦云 API Access ID（环境变量 TUYA_ACCESS_ID）',
  },
  {
    key: 'tuya_access_secret',
    value: process.env.TUYA_ACCESS_SECRET || '',
    description: '涂鸦云 API Access Secret（环境变量 TUYA_ACCESS_SECRET，请勿泄露）',
  },
  {
    key: 'tuya_uid',
    value: process.env.TUYA_UID || '',
    description: '涂鸦用户 UID（环境变量 TUYA_UID）',
  },
  {
    key: 'tuya_token',
    value: '{}',
    description: '涂鸦 API access_token 缓存（自动维护）',
  },
  {
    key: 'app_name',
    value: '宇宙智联智慧物业',
    description: '应用名称',
  },
  {
    key: 'cloud_env',
    value: 'cloud1-d6gs08jbb8aa7a138',
    description: '当前云环境 ID',
  },
];

// ─── 业主种子（手机号 → 房产绑定；中性占位名，演示数据，真实业主后续由物业后台导入）───
const SEED_OWNERS = [
  {
    phone: '13800001506',
    name: '黄先生',
    houses: [
      { houseId: 'HF-A2-1506', communityName: '幸福花园', building: 'A栋', unit: '2单元', room: '1506', role: 'owner' },
    ],
  },
];

// ─── 物业房产种子（rooms；门锁授权绑定，与「租房房源」houses 集合分开）───
const SEED_ROOMS = [
  { houseId: 'HF-A2-1506', communityName: '幸福花园', building: 'A栋', unit: '2单元', room: '1506', displayName: '幸福花园 A栋2单元1506', sortOrder: 1 },
  { houseId: 'HF-A2-1507', communityName: '幸福花园', building: 'A栋', unit: '2单元', room: '1507', displayName: '幸福花园 A栋2单元1507', sortOrder: 2 },
  { houseId: 'HF-A1-803',  communityName: '幸福花园', building: 'A栋', unit: '1单元', room: '803',  displayName: '幸福花园 A栋1单元803',  sortOrder: 3 },
];

// ─── 管理员密码 hash（pbkdf2，与 adminLogin 云函数同算法）───
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const iter = 100000;
  const hash = crypto.pbkdf2Sync(password, salt, iter, 64, 'sha512');
  return `pbkdf2_sha512$${iter}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

exports.main = async () => {
  const results = [];

  // 1. 创建集合
  for (const collName of COLLECTIONS) {
    try {
      await db.createCollection(collName);
      results.push({ collection: collName, action: 'created' });
    } catch (e) {
      if (e.errCode === -502005) {
        results.push({ collection: collName, action: 'already_exists' });
      } else {
        results.push({ collection: collName, action: 'error', error: e.message });
      }
    }
  }

  // 2. 插入种子门禁数据（幂等：先查后插）
  for (const dev of SEED_DEVICES) {
    const exists = await db.collection('devices')
      .where({ deviceId: dev.deviceId }).count();
    if (exists.total === 0) {
      await db.collection('devices').add({ data: dev });
      results.push({ seed: `device:${dev.deviceName}`, action: 'inserted' });
    } else {
      results.push({ seed: `device:${dev.deviceName}`, action: 'skipped' });
    }
  }

  // 3. 插入/更新系统配置（upsert：凭证变更后重跑可刷新）
  //    敏感凭证 value 为空 = 环境变量未配置，跳过写入（避免空值覆盖真实凭证）
  for (const cfg of SEED_CONFIG) {
    if (cfg.value === '') {
      results.push({ seed: `config:${cfg.key}`, action: 'skipped_env_missing' });
      continue;
    }
    const exists = await db.collection('sys_config')
      .where({ key: cfg.key }).get();
    if (exists.data.length === 0) {
      await db.collection('sys_config').add({ data: cfg });
      results.push({ seed: `config:${cfg.key}`, action: 'inserted' });
    } else {
      await db.collection('sys_config').doc(exists.data[0]._id)
        .update({ data: { value: cfg.value, description: cfg.description } });
      results.push({ seed: `config:${cfg.key}`, action: 'updated' });
    }
  }

  // 4. 插入业主种子（幂等：按 phone 查重）
  for (const owner of SEED_OWNERS) {
    const exists = await db.collection('owners').where({ phone: owner.phone }).count();
    if (exists.total === 0) {
      await db.collection('owners').add({ data: owner });
      results.push({ seed: `owner:${owner.name}`, action: 'inserted' });
    } else {
      results.push({ seed: `owner:${owner.name}`, action: 'skipped' });
    }
  }

  // 4.5 插入物业房产种子（幂等：按 houseId 查重）
  for (const room of SEED_ROOMS) {
    const exists = await db.collection('rooms').where({ houseId: room.houseId }).count();
    if (exists.total === 0) {
      await db.collection('rooms').add({ data: room });
      results.push({ seed: `room:${room.displayName}`, action: 'inserted' });
    } else {
      results.push({ seed: `room:${room.displayName}`, action: 'skipped' });
    }
  }

  // 5. 管理员凭证种子（环境变量 ADMIN_USERNAME / ADMIN_INITIAL_PASSWORD；算 hash 后写入 sys_config）
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminInitPwd = process.env.ADMIN_INITIAL_PASSWORD || '';
  if (adminInitPwd) {
    const adminSeeds = [
      { key: 'admin_username', value: adminUser, description: '管理员账号（环境变量 ADMIN_USERNAME）' },
      { key: 'admin_password_hash', value: hashPassword(adminInitPwd), description: '管理员密码 hash（pbkdf2，首登强制改密）' },
      { key: 'admin_must_change', value: 'true', description: '是否需修改初始密码' },
    ];
    for (const cfg of adminSeeds) {
      const exists = await db.collection('sys_config').where({ key: cfg.key }).get();
      if (exists.data.length === 0) {
        await db.collection('sys_config').add({ data: cfg });
        results.push({ seed: `config:${cfg.key}`, action: 'inserted' });
      } else {
        await db.collection('sys_config').doc(exists.data[0]._id)
          .update({ data: { value: cfg.value, description: cfg.description } });
        results.push({ seed: `config:${cfg.key}`, action: 'updated' });
      }
    }
  } else {
    results.push({ seed: 'config:admin_password_hash', action: 'skipped_env_missing' });
  }

  return {
    code: 0,
    msg: '数据库初始化完成',
    results,
    nextSteps: [
      '1. 在云函数「配置 → 环境变量」填入 TTLOCK_CLIENT_ID/CLIENT_SECRET/USERNAME/PASSWORD_MD5、TUYA_ACCESS_ID/ACCESS_SECRET/UID、ADMIN_USERNAME/ADMIN_INITIAL_PASSWORD（真实值见项目根 secrets.local.md）后重跑本函数',
      '2. 打开云开发控制台 → 数据库 → sys_config 确认凭证已写入',
      '3. 将 devices 集合中各设备的 lockId/macAddress/gatewayId 替换为真实值',
      '4. 确认门锁已配网 + WiFi 网关在线',
    ],
  };
};
