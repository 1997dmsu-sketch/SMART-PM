Component({
 data: {modalOpen:false,selected:'home', tabs:[{key:'home',label:'首页'},{key:'life',label:'广场'},{key:'unlock',label:'开门'},{key:'messages',label:'消息'},{key:'profile',label:'我的'}]},
 methods: {switchTab(e) { const key=e.currentTarget.dataset.key; if(key===this.data.selected)return; wx.switchTab({url:'/pages/'+key+'/index'}); }}
});
