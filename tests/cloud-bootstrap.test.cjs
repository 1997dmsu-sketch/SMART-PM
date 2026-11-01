const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const script=fs.readFileSync(require.resolve('../miniprogram/app.js'),'utf8');
function launch(config){
 let app;const calls=[];
 vm.runInNewContext(script,{require:()=>config,App:d=>app=d,wx:{getWindowInfo:()=>({statusBarHeight:59}),cloud:{init:opts=>calls.push(opts)}}});
 app.onLaunch();return {app,calls};
}
test('live bootstrap initializes only the selected cloud environment',()=>{
 const r=launch({mode:'live',cloudEnv:'cloud1-test',allowDeviceOperations:false});
 assert.equal(r.calls.length,1);assert.equal(r.calls[0].env,'cloud1-test');assert.equal(r.app.globalData.statusBarHeight,59);
});
test('demo and incomplete configuration do not initialize a live environment',()=>{
 assert.equal(launch({mode:'demo',cloudEnv:''}).calls.length,0);
 assert.equal(launch({mode:'live',cloudEnv:''}).calls.length,0);
});
