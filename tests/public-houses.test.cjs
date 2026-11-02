const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function harness(rows) {
 const db={command:{neq:value=>({neq:value})},collection(){
  let filters=[],offset=0,limit=20;
  const matches=()=>rows.filter(row=>filters.every(f=>Object.entries(f).every(([k,v])=>v && typeof v==='object' && 'neq' in v ? row[k]!==v.neq : row[k]===v)));
  return {where(f){filters.push(f);return this;},skip(n){offset=n;return this;},limit(n){limit=n;return this;},async count(){return {total:matches().length};},async get(){return {data:matches().slice(offset,offset+limit)};}};}};
 const cloud={init(){},database:()=>db};const exports={};
 vm.runInNewContext(fs.readFileSync(require.resolve('../cloudfunctions/getHouses/index.js'),'utf8'),{exports,require:()=>cloud,console});
 return exports.main;
}
test('customer rental query excludes public rooms before pagination and count, preserving legacy rooms',async()=>{
 const run=harness([{_id:'public',status:'在租',isPublic:true},{_id:'legacy',status:'在租'},{_id:'normal',status:'在租',isPublic:false},{_id:'offline',status:'已租',isPublic:false}]);
 const r=await run({pageSize:1});assert.equal(r.data.total,2);assert.equal(r.data.houses[0]._id,'legacy');assert.equal(r.data.totalPages,2);
 assert.equal((await run({id:'public'})).data.total,0);
 assert.equal((await run({id:'normal'})).data.houses[0]._id,'normal');
});
