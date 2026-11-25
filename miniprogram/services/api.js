const config = require('../config/runtime');
const demo = require('./demo');
const clone = value => JSON.parse(JSON.stringify(value));
const isDemo = () => config.mode === 'demo';
let profile = null;
let authGeneration = 0;
let activeLogin = null;
const pendingUnlocks = new Set();
let demoConversations = clone(demo.conversations);
function unsupported(message) { return Promise.reject(new Error(message)); }
function loginRequired() {
  const error = new Error('请先登录后再操作');
  error.code = 'AUTH_REQUIRED';
  return error;
}
function isAuthenticated() {
  if (activeLogin) return false;
  if (isDemo()) return demo.profile && demo.profile.authenticated === true;
  return Boolean(profile && profile.authenticated === true && typeof profile._id === 'string'
    && profile._id.length > 0 && profile._id.length <= 256 && !/[\x00-\x20\x7f/\\]/.test(profile._id));
}
function getLoginEpoch() { return isAuthenticated() ? authGeneration : null; }
function requireAuthenticated() {
  if (!isAuthenticated()) throw loginRequired();
  return { generation: authGeneration, demo: isDemo() };
}
function assertSameLogin(stamp) {
  if (!stamp || stamp.generation !== authGeneration || stamp.demo !== isDemo() || !isAuthenticated()) throw loginRequired();
}
async function privateCall(name, data) {
  const stamp = requireAuthenticated();
  const result = await call(name, data);
  assertSameLogin(stamp);
  return result;
}
async function call(name, data = {}) {
  if (isDemo()) throw new Error('演示模式不会调用云端服务');
  if (!config.cloudEnv) throw new Error('请先配置微信云开发环境');
  if (!wx.cloud || !wx.cloud.callFunction) throw new Error('当前环境不支持微信云开发');
  let response;
  try { response = await wx.cloud.callFunction({ name, data, config: {env:config.cloudEnv} }); }
  catch (error) {
    const code = error && (error.errCode || error.code);
    const hint = typeof code === 'number' || (typeof code === 'string' && /^-?\d+$/.test(code)) ? `，错误码 ${code}` : '';
    throw new Error(`[${name}] 服务连接失败${hint}，请检查云环境及该函数是否已部署`);
  }
  const result = response && response.result;
  if (!result || result.code !== 0) {
    const error = new Error((result && result.msg) || '服务返回异常');
    // 保留服务端错误码，页面才能按码区分「走既有审核渠道」与「其他明确错误」，
    // 不再依赖消息文案猜状态。code 只在非零时附加，成功路径不受影响。
    if (result && typeof result.code === 'string') error.code = result.code;
    throw error;
  }
  return result;
}

// ---- 入住＋人脸登记体验版：严格客户端字段白名单 ----
// 以下字段由服务端生成或判定；客户端入参一旦出现即本地抛错，绝不下发云端。
const CHECKIN_FACE_FORBIDDEN_FIELDS = [
  'approved', 'testMode', 'mode', 'validityMode', 'roomNo', 'roomId', 'houseId',
  'doorNo', 'employeeNo', 'validFrom', 'validTo', 'status',
  'openid', 'environment', 'projectId', 'buildingId', 'roomBindingId',
  'leaseSnapshotId', 'leaseRevision', 'configRevision', 'result',
  'decisionReasons', 'claimId', 'revision', 'siteVerification', 'deviceOutcome',
  'deviceKey', 'origin', 'username', 'password', 'pin', 'privateKey', 'cert'
];

// ---- 审核渠道错误码分类（C2）----
// 以下云端错误码表示当前账号/申请不在自动通过路径：页面据此展示既有审核渠道，
// 绝不显示成功、不受理状态或人脸入口。闭式集合，不吞并任务/配置/文件错误码。
// 码表按 A 路唯一接口清单（INTERFACES.md §5 错误码全表）对齐：
// - APPLICATION_FORBIDDEN：getMyTask 返回，申请不存在/不属于本人；
// - APPLICATION_NOT_APPROVED：createFaceTask 返回，申请未 auto_approved；
// - ACCOUNT_NOT_ALLOWED：清单 §5 注明 applyCheckin 路径不对外暴露（转为 code0
//   pending_review），但 createFaceTask 的事务复核仍可能以该码拒绝，防御性保留。
// 清单 §5 中不存在 APPLICATION_NOT_FOUND/APPLICATION_INVALID/APPLICATION_REVOKED/
// ACCOUNT_REVOKED，不得收录；新增码不得自动放行。
const REVIEW_CHANNEL_CODES = Object.freeze([
  'APPLICATION_FORBIDDEN', 'APPLICATION_NOT_APPROVED', 'ACCOUNT_NOT_ALLOWED',
]);

function isReviewChannelCode(code) {
  return typeof code === 'string' && REVIEW_CHANNEL_CODES.indexOf(code) !== -1;
}

function assertCheckinFaceInput(name, input, allowedFields) {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error(`[${name}] 入参必须是对象`);
  const fields = Array.isArray(allowedFields) ? allowedFields : [];
  Object.keys(input).forEach(key => {
    if (CHECKIN_FACE_FORBIDDEN_FIELDS.indexOf(key) !== -1) {
      throw new Error(`[${name}] 字段 ${key} 由服务端决定，客户端禁止提交`);
    }
    if (fields.indexOf(key) === -1) throw new Error(`[${name}] 不支持的字段 ${key}`);
  });
  return input;
}

async function callCheckinFace(data) {
  const stamp = requireAuthenticated();
  const result = await privateCall('checkinFaceTest', data);
  assertSameLogin(stamp);
  return result.data || {};
}

async function getCheckinFaceConfig(input) {
  assertCheckinFaceInput('getCheckinFaceConfig', input, []);
  return callCheckinFace({ action: 'getConfig' });
}

async function applyTestCheckin(input) {
  const payload = assertCheckinFaceInput('applyTestCheckin', input, ['applicationVersion']);
  if (!payload.applicationVersion) throw new Error('[applyTestCheckin] 缺少服务端配置版本');
  return callCheckinFace({ action: 'applyCheckin', applicationVersion: payload.applicationVersion });
}

async function uploadTestFace(input) {
  assertCheckinFaceInput('uploadTestFace', input, ['applicationId', 'cloudPath', 'filePath']);
  if (isDemo()) throw new Error('演示模式不会上传真实人脸照片');
  const authStamp = requireAuthenticated();
  const payload = input || {};
  if (!payload.applicationId) throw new Error('[uploadTestFace] 缺少入住申请标识');
  if (!payload.filePath) throw new Error('[uploadTestFace] 缺少本地照片路径');
  if (typeof payload.cloudPath !== 'string' || payload.cloudPath.indexOf('test-face/') !== 0) {
    throw new Error('[uploadTestFace] 上传路径必须由服务端下发');
  }
  if (!wx.cloud || !wx.cloud.uploadFile) throw new Error('当前环境不支持微信云存储上传');
  const response = await wx.cloud.uploadFile({
    cloudPath: payload.cloudPath,
    filePath: payload.filePath,
    config: { env: config.cloudEnv }
  });
  assertSameLogin(authStamp);
  const fileId = response && (response.fileID || response.fileId);
  if (!fileId) throw new Error('[uploadTestFace] 上传未返回 fileID');
  return fileId;
}

async function createFaceTask(input) {
  const payload = assertCheckinFaceInput('createFaceTask', input, ['applicationId', 'fileId', 'consent']);
  if (!payload.applicationId) throw new Error('[createFaceTask] 缺少入住申请标识');
  if (!payload.fileId) throw new Error('[createFaceTask] 缺少上传文件标识');
  if (payload.consent !== true) throw new Error('[createFaceTask] 需要本人确认照片用途');
  return callCheckinFace({
    action: 'createFaceTask',
    applicationId: payload.applicationId,
    fileId: payload.fileId,
    consent: true
  });
}

async function getFaceTask(input) {
  if (input && typeof input === 'object') assertCheckinFaceInput('getFaceTask', input, ['applicationId']);
  const applicationId = typeof input === 'string' ? input : (input && input.applicationId);
  if (!applicationId) throw new Error('[getFaceTask] 缺少入住申请标识');
  return callCheckinFace({ action: 'getMyTask', applicationId });
}

function normalizeHouse(h) {
  return Object.assign({},h,{id:h.id||h._id,cover:h.cover||h.image||(h.images||[])[0]||'',images:h.images||(h.cover?[h.cover]:[])});
}
function usesQishanyuanPreset() {
  return config.mode === 'live' && config.testPropertyPreset === 'qishanyuan-test-v1';
}
function presetHouse(room) {
  return normalizeHouse(Object.assign({}, room, {
    isTestPreset: true, isPublic: false, canBook: false,
    floor: room.floorNumber, roomType: room.layoutName || '待配置',
    rentType: '待配置', price: room.price, area: room.area,
    priceText: '租金待配置', areaText: '面积待配置',
    cover: '', images: [], tags: ['栖山苑测试预设', '租金待配置']
  }));
}
function positivePage(value, fallback, maximum) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}
function listPresetHouses(filters) {
  // 这是显式测试数据源，绝不在真实云端失败的 catch 中调用。
  const preset = require('../data/qishanyuan-test-preset');
  const options = filters && typeof filters === 'object' ? filters : {};
  let rows;
  if (options.id !== undefined) {
    const room = preset.getPublicRoom(options.id);
    rows = room ? [room] : [];
  } else rows = preset.listPublicRooms();
  rows = rows.map(presetHouse).filter(room => {
    if (options.community && room.community !== options.community) return false;
    if (options.roomType && options.roomType !== 'all') {
      const wanted = String(options.roomType);
      if (!room.rooms.startsWith(wanted) && room.roomType !== wanted && room.layoutCode !== wanted) return false;
    }
    if (options.rentType && options.rentType !== 'all') {
      const wanted = options.rentType === 'whole' ? '整租' : (options.rentType === 'share' ? '合租' : options.rentType);
      if (room.rentType !== wanted) return false;
    }
    if (options.priceMin !== undefined || options.priceMax !== undefined) {
      if (typeof room.price !== 'number' || !Number.isFinite(room.price)) return false;
      if (options.priceMin !== undefined && room.price < options.priceMin) return false;
      if (options.priceMax !== undefined && room.price >= options.priceMax) return false;
    }
    return true;
  });
  const page = positivePage(options.page, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = positivePage(options.pageSize, 20, 500);
  return { houses: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length,
    page, pageSize, isTestPreset: true, presetId: preset.PRESET_ID };
}
async function listHouses(filters = {}) {
  if (usesQishanyuanPreset()) return listPresetHouses(filters);
  let result;
  if (isDemo()) {
    const rows=demo.houses.filter(h => h.isPublic !== true && (!filters.community||h.community===filters.community) && (filters.priceMin===undefined||h.price>=filters.priceMin) && (filters.priceMax===undefined||h.price<filters.priceMax) && (!filters.roomType||h.rooms.startsWith(String(filters.roomType))) && (!filters.rentType||filters.rentType==='all'||h.rentType===(filters.rentType==='whole'?'整租':'合租')));
    const page=filters.page||1,pageSize=filters.pageSize||20;
    result={houses:clone(rows.slice((page-1)*pageSize,page*pageSize)),total:rows.length,page,pageSize};
  } else result=(await call('getHouses',filters)).data;
  if (!result || !Array.isArray(result.houses)) throw new Error('房源数据格式异常');
  result.houses=result.houses.filter(h=>h.isPublic !== true).map(normalizeHouse);
  return result;
}
async function getHouse(id) {
  if (usesQishanyuanPreset()) {
    const room = require('../data/qishanyuan-test-preset').getPublicRoom(id);
    return room ? presetHouse(room) : null;
  }
  if (isDemo()) return clone(demo.houses.find(h=>h.isPublic !== true && (h.id===id || !id)) || null);
  if (!id) return null;
  // Revalidate visibility; a previously viewed rental may now be a public room.
  const result = await listHouses({id:String(id),page:1,pageSize:1});
  return clone(result.houses.find(h=>String(h.id)===String(id)) || null);
}
async function listContent(type) {
  if (isDemo()) return clone(type==='house'?demo.houses:demo.feed);
  const r=await call('contentList',{type});return r.data||[];
}
async function listLocks() {
  if(isDemo())return clone(demo.locks);
  // Use permission-filtered devices, never account-wide listLocks.
  const stamp=requireAuthenticated();
  const r=await privateCall('getDevices');
  assertSameLogin(stamp);
  return (r.data.devices||[]).map(d=>Object.assign({},d,{id:d.deviceId,address:d.location,status:d.status}));
}
async function unlockDevice(device) {
  if(isDemo())throw new Error('当前为设计演示，不会操作真实门锁');
  if(!config.allowDeviceOperations)throw new Error('真实开门尚未启用，请完成设备联调后开启');
  requireAuthenticated();
  const id=device&&device.deviceId;
  if(!id||String(id).startsWith('demo-'))throw new Error('无效门锁');
  if(pendingUnlocks.has(id))throw new Error('正在开门，请勿重复操作');
  pendingUnlocks.add(id);
  try {return await privateCall('unlock',{deviceId:id,method:'remote'});} finally {pendingUnlocks.delete(id);}
}
async function listUnlockRecords() {
  if(isDemo())return clone(demo.records);
  const stamp=requireAuthenticated();
  const r=await privateCall('unlockRecords',{limit:20});
  assertSameLogin(stamp);
  return (r.data.records||[]).map(x=>({id:x.id,name:x.doorName,time:x.time,status:x.success?'成功':'失败'}));
}
async function listConversations() {
  if(isDemo())return clone(demoConversations);
  const stamp=requireAuthenticated();
  const r=await privateCall('messageList',{action:'conversations'});
  assertSameLogin(stamp);
  return (r.data||[]).map(c=>({id:c._id,name:c.peerName,avatar:c.peerAvatar,lastMessage:c.lastMsg,time:c.lastTimeText,unread:c.unread}));
}
async function markRead(conversationId) {
  if(isDemo()){demoConversations.forEach(c=>{if(!conversationId||c.id===conversationId)c.unread=0;});return;}
  return privateCall('messageRead',conversationId?{conversationId}:{});
}
async function getMessages(conversationId,before) {
  if(!conversationId)throw new Error('缺少会话标识');
  if(isDemo())return {data:[{_id:'demo-msg',from:'peer',content:'您好，这里是本地设计演示。真实消息需连接微信云开发后查看。',timeText:'10:55',createdAt:1}],hasMore:false};
  return privateCall('messageList',{action:'messages',conversationId,...(before?{before}:{}),limit:30});
}
async function sendMessage(conversationId,content) {
  if(!content||!content.trim())throw new Error('请输入消息内容');
  if(content.trim().length>500)throw new Error('消息不能超过500字');
  if(isDemo())throw new Error('演示模式不会发送真实消息');
  return privateCall('messageSend',{conversationId,content:content.trim(),type:'text'});
}
function mapProfile(user) {
  return Object.assign({},user,{nickname:user.nickname||user.nickName||user.name||'业主用户',avatar:user.avatar||user.avatarUrl||'',propertyId:user.propertyId||'',community:user.community||'',house:user.house||((user.houses||[]).join('、')),points:user.points||0,coupons:user.couponsCount||0,orders:user.ordersCount||0,authenticated:true});
}
async function getProfile() { if(isDemo())return clone(demo.profile);return profile&&clone(profile); }
async function loginWithPhone(code) {
  if(isDemo())throw new Error('演示模式无需授权手机号');
  if(typeof code !== 'string' || !/^[^\s]{1,2048}$/.test(code))throw new Error('未获得有效手机号授权');
  const generation = ++authGeneration;
  profile = null;
  activeLogin = { generation, kind: 'phone' };
  try {
    const r = await call('phoneLogin', { code });
    if (generation !== authGeneration) throw new Error('登录已取消，请重新操作');
    profile = mapProfile(validateLoginProfile(r.userInfo));
    return clone(profile);
  } catch (error) {
    throw safeLoginError(error, generation);
  } finally {
    if (activeLogin && activeLogin.generation === generation) activeLogin = null;
  }
}
function passwordBytes(value) {
  try { return encodeURIComponent(value).replace(/%[0-9a-f]{2}/gi, 'x').length; }
  catch (_) { return Infinity; }
}
function invalidLoginProfile() {
  return Object.assign(new Error('登录服务返回资料异常，请稍后重试'), { code: 'LOGIN_PROFILE_INVALID' });
}
function validateLoginProfile(user) {
  const required = ['_id', 'role', 'houses', 'points'];
  const optional = ['name', 'nickname', 'avatar', 'phone', 'community', 'house', 'propertyId', 'couponsCount', 'ordersCount'];
  if (!user || typeof user !== 'object' || Array.isArray(user)) throw invalidLoginProfile();
  const clean = {};
  for (const key of Reflect.ownKeys(user)) {
    const descriptor = Object.getOwnPropertyDescriptor(user, key);
    if (typeof key !== 'string' || !required.concat(optional).includes(key)
        || !descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw invalidLoginProfile();
    }
    clean[key] = descriptor.value;
  }
  const safeText = (value, maximum) => typeof value === 'string' && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
  const safeId = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x20\x7f/\\]/.test(value);
  if (!required.every(key => Object.prototype.hasOwnProperty.call(clean, key))
      || !safeId(clean._id)
      || !['user', 'admin'].includes(clean.role)
      || !Array.isArray(clean.houses) || !clean.houses.every(safeId)
      || typeof clean.points !== 'number' || !Number.isFinite(clean.points) || clean.points < 0) {
    throw invalidLoginProfile();
  }
  for (const key of optional) {
    if (!Object.prototype.hasOwnProperty.call(clean, key)) continue;
    if (key === 'couponsCount' || key === 'ordersCount') {
      if (!Number.isSafeInteger(clean[key]) || clean[key] < 0) throw invalidLoginProfile();
    } else if (!safeText(clean[key], 512)) throw invalidLoginProfile();
  }
  clean.houses = clean.houses.slice();
  return clean;
}
function safeLoginError(error, generation) {
  if (generation !== authGeneration) return new Error('登录已取消，请重新操作');
  if (error && error.code === 'LOGIN_PROFILE_INVALID') return invalidLoginProfile();
  const code = error && error.code;
  if (code === 'AUTH_FAILED') return Object.assign(new Error('账号或密码不正确，或当前微信尚未关联该账号'), { code });
  if (code === 'SERVICE_UNAVAILABLE') return Object.assign(new Error('登录服务暂不可用，请稍后重试'), { code });
  return new Error('登录未完成，请稍后重试');
}
async function loginWithPassword(input) {
  if (isDemo()) throw new Error('演示模式不会登录真实账号');
  const username = input && typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
  let password = input && typeof input.password === 'string' ? input.password : '';
  if (!/^[a-z0-9][a-z0-9._-]{3,31}$/.test(username)) throw new Error('账号需为4–32位字母、数字或._-');
  if (password.length < 8 || password.length > 128 || passwordBytes(password) > 256) throw new Error('密码需为8–128个字符，且不超过256字节');
  const generation = ++authGeneration;
  profile = null;
  activeLogin = { generation, kind: 'password' };
  try {
    const r = await call('accountLogin', { action: 'login', username, password });
    if (generation !== authGeneration) throw new Error('登录已取消，请重新操作');
    const user = validateLoginProfile(r.userInfo);
    profile = mapProfile(user);
    return clone(profile);
  } catch (error) {
    throw safeLoginError(error, generation);
  } finally {
    password = '';
    if (activeLogin && activeLogin.generation === generation) activeLogin = null;
  }
}
function cancelPasswordLogin() {
  if (activeLogin && activeLogin.kind === 'password') {
    authGeneration += 1;
    activeLogin = null;
  }
}
function cancelPhoneLogin() {
  if (activeLogin && activeLogin.kind === 'phone') {
    authGeneration += 1;
    activeLogin = null;
  }
}
function logout(){authGeneration+=1;activeLogin=null;profile=null;}
async function listFamily(){requireAuthenticated();return isDemo()?Promise.resolve(clone(demo.family)):unsupported('旧后端尚未提供家庭成员查询接口');}
async function addFamily(){requireAuthenticated();return unsupported('家庭成员添加接口尚未接入，未保存成员');}
async function getProperty(){requireAuthenticated();return isDemo()?Promise.resolve(clone(demo.property)):unsupported('旧后端尚未提供住户房产详情接口');}
async function listMeters(type){
 requireAuthenticated();
 if(isDemo())return Promise.resolve(type==='water'?[]:[clone(demo.meter)]);
 return unsupported('旧水电表接口尚未按住户房产过滤，完成权限对接后开放');
}
module.exports={isDemo,isAuthenticated,getLoginEpoch,listContent,listHouses,getHouse,listLocks,unlockDevice,listUnlockRecords,listConversations,markRead,getMessages,sendMessage,getProfile,loginWithPhone,loginWithPassword,cancelPasswordLogin,cancelPhoneLogin,logout,listFamily,addFamily,getProperty,listMeters,getCheckinFaceConfig,applyTestCheckin,uploadTestFace,createFaceTask,getFaceTask,isReviewChannelCode,REVIEW_CHANNEL_CODES};
