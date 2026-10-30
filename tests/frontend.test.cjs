const {test,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const config=require('../miniprogram/config/runtime');
let api, calls,storage;
beforeEach(()=>{
 config.mode='demo';config.cloudEnv='';config.allowDeviceOperations=false;
 delete require.cache[require.resolve('../miniprogram/services/api')];api=require('../miniprogram/services/api');
 calls=[];storage=new Map();
 global.wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),showToast:x=>calls.push(['toast',x]),showModal:x=>calls.push(['modal',x]),switchTab:x=>calls.push(['tab',x]),navigateTo:x=>calls.push(['navigate',x]),stopPullDownRefresh(){},cloud:{callFunction:async x=>{calls.push(x);throw Error('unexpected cloud request');}}};
});
function page(name){
 let definition;const file=path.resolve(__dirname,'../miniprogram/pages',name,'index.js');
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{require:createRequire(file),Page:d=>definition=d,wx:global.wx,getApp:()=>({globalData:{statusBarHeight:24}}),getCurrentPages:()=>[{},{}],console,Date,setTimeout,clearTimeout});
 const p={...definition,data:structuredClone(definition.data),setData(values){for(const [key,value]of Object.entries(values)){const keys=key.split('.');let o=this.data;for(const k of keys.slice(0,-1))o=o[k];o[keys.at(-1)]=value;}},getTabBar:()=>({setData(){}})};return p;
}
test('demo read workflows use zero cloud calls and missing house stays missing',async()=>{
 const r=await api.listHouses({priceMin:1500,priceMax:3000,roomType:'1'});assert.equal(r.houses.length,1);assert.equal(r.houses[0].price,1750);
 assert.equal(await api.getHouse('missing'),null);assert.equal((await api.listContent('share')).length,4);assert.equal((await api.listLocks()).length,3);assert.equal((await api.listFamily()).length,4);assert.equal(calls.length,0);
});
test('demo writes cannot unlock, send, log in, or add family',async()=>{
 await assert.rejects(api.unlockDevice({deviceId:'demo-lock-0'}),/演示/);await assert.rejects(api.sendMessage('demo-chat-0','你好'),/演示/);await assert.rejects(api.loginWithPhone('code'),/演示/);await assert.rejects(api.addFamily({name:'x'}),/未接入/);assert.equal(calls.length,0);
});
test('demo markRead is local and does not mutate original fixtures',async()=>{
 await api.markRead('demo-chat-0');assert.equal((await api.listConversations())[0].unread,0);assert.equal(require('../miniprogram/services/demo').conversations[0].unread,3);assert.equal(calls.length,0);
});
test('live cloud failures never silently fall back to demo',async()=>{
 config.mode='live';await assert.rejects(api.listHouses(),/配置/);config.cloudEnv='test-env';await assert.rejects(api.listHouses(),/连接失败/);
 wx.cloud.callFunction=async()=>({result:{code:403,msg:'无权访问'}});await assert.rejects(api.listHouses(),/无权访问/);
});
test('live device list calls permission-filtered getDevices and maps location',async()=>{
 config.mode='live';config.cloudEnv='test-env';wx.cloud.callFunction=async r=>{calls.push(r);return{result:{code:0,data:{devices:[{deviceId:'D1',name:'门',location:'A栋'}]}}};};
 const rows=await api.listLocks();assert.equal(calls[0].name,'getDevices');assert.equal(rows[0].id,'D1');assert.equal(rows[0].address,'A栋');
});
test('unlock requires opt-in and login, sends only deviceId, suppresses duplicates',async()=>{
 config.mode='live';config.cloudEnv='test-env';await assert.rejects(api.unlockDevice({deviceId:'D1'}),/尚未启用/);config.allowDeviceOperations=true;await assert.rejects(api.unlockDevice({deviceId:'D1'}),/登录/);
 wx.cloud.callFunction=async()=>({result:{code:0,userInfo:{name:'测试'}}});await api.loginWithPhone('code');let finish;
 wx.cloud.callFunction=r=>{calls.push(r);return new Promise(resolve=>finish=resolve);};
 const first=api.unlockDevice({deviceId:'D1',lockId:'untrusted'});await assert.rejects(api.unlockDevice({deviceId:'D1'}),/重复/);assert.deepEqual(calls[0].data,{deviceId:'D1',method:'remote'});finish({result:{code:0}});await first;
});
test('missing family/property and unscoped meter operations are explicit',async()=>{
 config.mode='live';await assert.rejects(api.listFamily(),/未提供/);await assert.rejects(api.getProperty(),/未提供/);await assert.rejects(api.listMeters('water'),/过滤/);assert.equal(calls.length,0);
});
test('rental favorite appears in profile favorites and toggles off',async()=>{
 const rental=page('rental');rental.houseId='demo-house-1';await rental.load();rental.toggleFavorite();const profile=page('profile');profile.openMenu({currentTarget:{dataset:{id:'favorite'}}});assert.equal(profile.data.favorites[0].id,'demo-house-1');rental.toggleFavorite();assert.equal(storage.get('favorites').length,0);
});
test('home search produces a meaningful empty result',async()=>{
 const home=page('home');await home.loadContent();assert.equal(home.data.columns.flat().length,4);home.onSearch({detail:{value:'不存在的内容'}});assert.equal(home.data.empty,true);
});
test('life rental filter reaches adapter and only matching houses display',async()=>{
 const life=page('life');life.data.filters={community:'',price:'middle',roomType:'1',rentType:'whole'};await life.loadHouses();assert.equal(life.data.columns.flat().length,1);assert.equal(life.data.columns.flat()[0].price,1750);
});
test('chat preserves draft and displays failed send in demo',async()=>{
 const chat=page('chat');chat.id='demo-chat-0';chat.data.text='你好';await chat.send();assert.equal(chat.data.text,'你好');assert.equal(chat.data.messages.length,0);assert.equal(calls[0][0],'modal');
});
