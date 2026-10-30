const {test}=require('node:test');
const assert=require('node:assert/strict');
const {getNavigationLayout}=require('../miniprogram/utils/layout');
for(const [width,status,gap,height] of [[320,20,4,32],[375,44,4,32],[393,59,8,32],[430,59,8,32],[768,24,6,32]]){
 test(`navigation stays clear of capsule at ${width}px`,()=>{
  const left=width-95;
  global.wx={getWindowInfo:()=>({windowWidth:width,statusBarHeight:status}),getMenuButtonBoundingClientRect:()=>({left,right:width-7,width:88,top:status+gap,height})};
  const r=getNavigationLayout();
  assert.equal(r.statusBarHeight,status);assert(r.navHeight>=height+gap*2);assert(width-r.navSideWidth<left);assert(width-r.navSideWidth*2>90);
 });
}
test('invalid capsule falls back and zero status bar remains zero',()=>{
 global.wx={getWindowInfo:()=>({windowWidth:375,statusBarHeight:0}),getMenuButtonBoundingClientRect:()=>({width:0,height:0,top:0,left:0,right:0})};
 const r=getNavigationLayout();assert.equal(r.statusBarHeight,0);assert.equal(r.navHeight,44);assert(r.navSideWidth>80);
});
test('older SDK and unavailable capsule do not break pages',()=>{
 global.wx={getSystemInfoSync:()=>({windowWidth:320,statusBarHeight:24}),getMenuButtonBoundingClientRect:()=>{throw Error('not available');}};
 assert.equal(getNavigationLayout().statusBarHeight,24);
 global.wx={};assert.equal(getNavigationLayout().navHeight,44);
});
