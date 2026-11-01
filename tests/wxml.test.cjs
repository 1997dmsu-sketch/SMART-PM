const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateWxml}=require('../scripts/validate-wxml.cjs');

test('rejects the reported wx:else/wx:for combination',()=>{
 assert.throws(()=>validateWxml('<view wx:if="{{loading}}"></view><block wx:else wx:for="{{records}}"></block>'),/separate/);
});
test('accepts separate conditional and loop blocks for record rendering',()=>{
 validateWxml('<view wx:if="{{loading}}"></view><view wx:elif="{{!records.length}}"></view><block wx:else><block wx:for="{{records}}"><view wx:if="{{index < 4}}"></view></block></block>');
});
test('rejects the reported entity-escaped filter expression',()=>{
 assert.throws(()=>validateWxml('<view class="{{!draft.community &amp;&amp; item === \'不限\' ? \'active\' : \'\'}}"></view>'),/HTML entity/);
});
test('accepts literal operators inside bindings and entities in ordinary text',()=>{
 validateWxml('<view class="{{!draft.community && item === \'不限\' ? \'active\' : \'\'}}">A &amp; B</view>');
});
test('rejects orphaned branches and malformed binding syntax',()=>{
 assert.throws(()=>validateWxml('<view><view wx:if="{{a}}"></view></view><view wx:else></view>'),/preceding/);
 assert.throws(()=>validateWxml('<view>{{a ? }}</view>'),/invalid expression/);
});
test('else branches cannot cross loop scope',()=>{
 assert.throws(()=>validateWxml('<view wx:if="{{a}}" wx:for="{{rows}}"></view><view wx:else></view>'),/preceding/);
});
