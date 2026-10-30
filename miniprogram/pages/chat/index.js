const api=require('../../services/api');
Page({
 data:{statusBarHeight:20,title:'在线咨询',demo:false,loading:false,error:'',messages:[],text:'',sending:false,hasMore:false,loadMoreError:''},
 onLoad(options){this.id=options.id||'';this.setData({statusBarHeight:getApp().globalData.statusBarHeight||20,demo:api.isDemo(),title:options.name||'在线咨询'});this.load();},
 async load(){
  this.setData({loading:true,error:''});
  try{const r=await api.getMessages(this.id);this.setData({messages:r.data.slice().reverse(),hasMore:r.hasMore});await api.markRead(this.id);}
  catch(e){this.setData({error:e.message});}finally{this.setData({loading:false});}
 },
 async more(){
  if(this.data.loading||!this.data.hasMore)return;
  this.setData({loading:true,loadMoreError:''});
  try{const first=this.data.messages[0];const r=await api.getMessages(this.id,first&&first.createdAt);this.setData({messages:r.data.slice().reverse().concat(this.data.messages),hasMore:r.hasMore});}
  catch(e){this.setData({loadMoreError:e.message});}finally{this.setData({loading:false});}
 },
 input(e){this.setData({text:e.detail.value});},
 async send(){
  if(this.data.sending||!this.data.text.trim())return;
  const text=this.data.text;this.setData({sending:true});
  try{
   const r=await api.sendMessage(this.id,text);
   this.setData({messages:this.data.messages.concat({...r.data,from:'owner'}),text:this.data.text===text?'':this.data.text});
  }catch(e){wx.showModal({title:'未发送',content:e.message,showCancel:false});}
  finally{this.setData({sending:false});}
 },
 back(){if(getCurrentPages().length>1)wx.navigateBack();else wx.switchTab({url:'/pages/messages/index'});}
});
