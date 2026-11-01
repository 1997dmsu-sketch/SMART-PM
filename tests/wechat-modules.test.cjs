const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createWechatLoader}=require('../scripts/wechat-module-loader.cjs');
const root=path.resolve(__dirname,'../miniprogram');
const app=JSON.parse(fs.readFileSync(path.join(root,'app.json')));
for(const page of app.pages){
 test(`WeChat JS-only loader registers ${page}`,()=>{
  let definition;
  createWechatLoader(root,{Page:d=>definition=d}).load(page);
  assert.equal(typeof definition,'object');assert.equal(typeof definition.onLoad,'function');
  if(page==='pages/profile/index')assert.equal(definition.data.release.version,require('../package.json').version);
 });
}
test('WeChat JS-only loader registers app and custom tab bar',()=>{
 let app,tab;const loader=createWechatLoader(root,{App:d=>app=d,Component:d=>tab=d});
 loader.load('app');loader.load('custom-tab-bar/index');
 assert.equal(typeof app.onLaunch,'function');assert.equal(typeof tab.methods.switchTab,'function');
});
test('Node-compatible JSON import reproduces the reported WeChat incompatibility',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smart-pm-modules-'));
 try{
  fs.writeFileSync(path.join(dir,'version.json'),'{"version":"test"}');
  fs.writeFileSync(path.join(dir,'index.js'),"module.exports=require('./version.json')");
  assert.throws(()=>createWechatLoader(dir).load('index'),/cannot load JSON/);
  fs.writeFileSync(path.join(dir,'version.js'),"module.exports={version:'test'}");
  fs.writeFileSync(path.join(dir,'index.js'),"module.exports=require('./version')");
  assert.equal(createWechatLoader(dir).load('index').version,'test');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
