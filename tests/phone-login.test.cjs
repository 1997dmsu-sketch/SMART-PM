const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function harness(options={}) {
 const writes=[], queries=[], phoneCalls=[];
 const db={serverDate:()=> 'server-time',collection(name){return {
  where(query){queries.push({name,query});return {limit(){return this;},async get(){if(options[name+'Error'])throw Error('database unavailable');return {data:options[name]||[]};}};},
  doc(id){return {async update({data}){writes.push({name,id,data});}};},
  async add({data}){writes.push({name,data});return {_id:'new-user'};}
 };}};
 const cloud={init(){},database:()=>db,getWXContext:()=>options.context||{OPENID:'trusted-openid'},openapi:{phonenumber:{async getPhoneNumber(arg){phoneCalls.push(arg);if(options.phoneError)throw options.phoneError;return options.phoneResult||{phoneInfo:{purePhoneNumber:'test-phone'}};}}}};
 const exports={};vm.runInNewContext(fs.readFileSync(require.resolve('../cloudfunctions/phoneLogin/index.js'),'utf8'),{exports,require:()=>cloud,console:{error(){},warn(){}}});
 return {run:exports.main,writes,queries,phoneCalls};
}
test('login rejects missing authorization or identity before cloud calls',async()=>{
 for(const [options,event,code]of [[{}, {},400],[{context:{}},{code:'temporary-code'},403]]){const h=harness(options);assert.equal((await h.run(event)).code,code);assert.equal(h.phoneCalls.length,0);assert.equal(h.writes.length,0);}
});
test('new login uses trusted WeChat identity and creates an unbound user',async()=>{
 const h=harness();const r=await h.run({code:'temporary-code',OPENID:'spoofed'});assert.equal(r.code,0);assert.equal(r.bound,false);assert.equal(h.writes[0].data._openid,'trusted-openid');assert.equal(h.writes[0].data.role,'user');assert.equal(h.phoneCalls[0].code,'temporary-code');
});
test('returning user updates existing account without duplicate creation',async()=>{
 const h=harness({users:[{_id:'existing',houses:[]}]});assert.equal((await h.run({code:'code'})).code,0);assert.equal(h.writes.length,1);assert.equal(h.writes[0].id,'existing');
});
test('matched owner returns bound state and synchronized houses',async()=>{
 const h=harness({owners:[{name:'测试业主',houses:[{houseId:'house-1'},{}]}]});const r=await h.run({code:'code'});assert.equal(r.code,0);assert.equal(r.bound,true);assert.equal(r.userInfo.houses.join(','),'house-1');assert.equal(r.userInfo.name,'测试业主');
});
test('existing house binding survives absent or unavailable owners collection',async()=>{
 for(const ownersError of [false,true]){const h=harness({users:[{_id:'existing',houses:['house-1']}],ownersError});const r=await h.run({code:'code'});assert.equal(r.code,0);assert.equal(r.bound,true);}
});
test('phone exchange errors cannot create an account',async()=>{
 for(const options of [{phoneError:{errMsg:'授权已过期'}},{phoneError:{errno:1400001}},{phoneResult:{}}]){const h=harness(options);assert.equal((await h.run({code:'code'})).code,500);assert.equal(h.writes.length,0);}
});
test('user database failure returns login failure',async()=>{const h=harness({usersError:true});assert.equal((await h.run({code:'code'})).code,500);assert.equal(h.writes.length,0);});
