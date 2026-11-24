const config = require('../config/runtime');
const demo = require('./demo');
const clone = value => JSON.parse(JSON.stringify(value));
const isDemo = () => config.mode === 'demo';
let profile = null;
const pendingUnlocks = new Set();
let demoConversations = clone(demo.conversations);
function unsupported(message) { return Promise.reject(new Error(message)); }
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
  if (!result || result.code !== 0) throw new Error(result && result.msg || '服务返回异常');
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
  const result = await call('checkinFaceTest', data);
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
async function listHouses(filters = {}) {
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
  const r=await call('getDevices');
  return (r.data.devices||[]).map(d=>Object.assign({},d,{id:d.deviceId,address:d.location,status:d.status}));
}
async function unlockDevice(device) {
  if(isDemo())throw new Error('当前为设计演示，不会操作真实门锁');
  if(!config.allowDeviceOperations)throw new Error('真实开门尚未启用，请完成设备联调后开启');
  if(!profile)throw new Error('请先登录后操作门锁');
  const id=device&&device.deviceId;
  if(!id||String(id).startsWith('demo-'))throw new Error('无效门锁');
  if(pendingUnlocks.has(id))throw new Error('正在开门，请勿重复操作');
  pendingUnlocks.add(id);
  try {return await call('unlock',{deviceId:id,method:'remote'});} finally {pendingUnlocks.delete(id);}
}
async function listUnlockRecords() {
  if(isDemo())return clone(demo.records);
  const r=await call('unlockRecords',{limit:20});
  return (r.data.records||[]).map(x=>({id:x.id,name:x.doorName,time:x.time,status:x.success?'成功':'失败'}));
}
async function listConversations() {
  if(isDemo())return clone(demoConversations);
  const r=await call('messageList',{action:'conversations'});
  return (r.data||[]).map(c=>({id:c._id,name:c.peerName,avatar:c.peerAvatar,lastMessage:c.lastMsg,time:c.lastTimeText,unread:c.unread}));
}
async function markRead(conversationId) {
  if(isDemo()){demoConversations.forEach(c=>{if(!conversationId||c.id===conversationId)c.unread=0;});return;}
  return call('messageRead',conversationId?{conversationId}:{});
}
async function getMessages(conversationId,before) {
  if(!conversationId)throw new Error('缺少会话标识');
  if(isDemo())return {data:[{_id:'demo-msg',from:'peer',content:'您好，这里是本地设计演示。真实消息需连接微信云开发后查看。',timeText:'10:55',createdAt:1}],hasMore:false};
  return call('messageList',{action:'messages',conversationId,...(before?{before}:{}),limit:30});
}
async function sendMessage(conversationId,content) {
  if(!content||!content.trim())throw new Error('请输入消息内容');
  if(content.trim().length>500)throw new Error('消息不能超过500字');
  if(isDemo())throw new Error('演示模式不会发送真实消息');
  return call('messageSend',{conversationId,content:content.trim(),type:'text'});
}
function mapProfile(user) {
  return Object.assign({},user,{nickname:user.nickname||user.nickName||user.name||'业主用户',avatar:user.avatar||user.avatarUrl||'',propertyId:user.propertyId||'',community:user.community||'',house:user.house||((user.houses||[]).join('、')),points:user.points||0,coupons:user.couponsCount||0,orders:user.ordersCount||0,authenticated:true});
}
async function getProfile() { if(isDemo())return clone(demo.profile);return profile&&clone(profile); }
async function loginWithPhone(code) {
  if(isDemo())throw new Error('演示模式无需授权手机号');
  if(!code)throw new Error('未获得手机号授权');
  const r=await call('phoneLogin',{code});profile=mapProfile(r.userInfo||{});return clone(profile);
}
function logout(){profile=null;}
function listFamily(){return isDemo()?Promise.resolve(clone(demo.family)):unsupported('旧后端尚未提供家庭成员查询接口');}
function addFamily(){return unsupported('家庭成员添加接口尚未接入，未保存成员');}
function getProperty(){return isDemo()?Promise.resolve(clone(demo.property)):unsupported('旧后端尚未提供住户房产详情接口');}
function listMeters(type){
 if(isDemo())return Promise.resolve(type==='water'?[]:[clone(demo.meter)]);
 return unsupported('旧水电表接口尚未按住户房产过滤，完成权限对接后开放');
}
module.exports={isDemo,listContent,listHouses,getHouse,listLocks,unlockDevice,listUnlockRecords,listConversations,markRead,getMessages,sendMessage,getProfile,loginWithPhone,logout,listFamily,addFamily,getProperty,listMeters,getCheckinFaceConfig,applyTestCheckin,uploadTestFace,createFaceTask,getFaceTask};
