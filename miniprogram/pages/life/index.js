const api = require('../../services/api');
const SERVICES = [
  ['house','在线看房','house'], ['mall','智联商城','mall'], ['clean','家政保洁','clean'],
  ['neighbor','邻里互助','neighbor'], ['parcel','快递代收','parcel'], ['repair','便民维修','repair'], ['community','社区圈子','community'],
].map(([id,label,icon]) => ({ id, label, icon: `/assets/home-service-${icon}.png` }));
const PRICE_OPTIONS = [
  { label:'不限', value:'all' }, { label:'1500元以下', value:'low', priceMax:1500 },
  { label:'1500—3000元', value:'middle', priceMin:1500, priceMax:3000 },
  { label:'3000—5000元', value:'high', priceMin:3000, priceMax:5000 }, { label:'5000元以上', value:'premium', priceMin:5000 },
];
Page({
  data: {
    statusBarHeight:20, community:'宇宙智联智慧物业', services:SERVICES, activeService:'house',
    searching:false, keyword:'', loading:true, error:'', columns:[[],[]], empty:false,
    isDemo:false, total:0, filterOpen:false, filterKind:'all', filters:{ community:'', price:'all', roomType:'', rentType:'all' },
    draft:{ community:'',price:'all',roomType:'',rentType:'all' },
    areas:['不限'], prices:PRICE_OPTIONS,
    rooms:[{ label:'不限',value:'' },{ label:'1室',value:'1' },{ label:'2室',value:'2' },{ label:'3室',value:'3' },{ label:'4室',value:'4' }],
    rents:[{ label:'不限',value:'all' },{ label:'整租',value:'whole' },{ label:'合租',value:'shared' }],
    labels:{ area:'区域',price:'租金',room:'户型' },
  },
  onLoad() {
    this.setData({ statusBarHeight:getApp().globalData.statusBarHeight || 20,isDemo:api.isDemo() });
    this.loadHouses();
  },
  onShow() { if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ selected:'life' }); },
  onPullDownRefresh() { this.loadHouses().finally(() => wx.stopPullDownRefresh()); },
  async loadHouses() {
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    this.setData({ loading:true,error:'' });
    const filter = this.data.filters;
    const price = PRICE_OPTIONS.find(item => item.value === filter.price) || PRICE_OPTIONS[0];
    const query = { page:1,pageSize:100 };
    if (filter.community) query.community = filter.community;
    if (filter.roomType) query.roomType = filter.roomType;
    if (filter.rentType !== 'all') query.rentType = filter.rentType;
    if (price.priceMin !== undefined) query.priceMin = price.priceMin;
    if (price.priceMax !== undefined) query.priceMax = price.priceMax;
    try {
      const result = await api.listHouses(query);
      if (requestId !== this.requestId) return;
      const list = Array.isArray(result) ? result : (result.houses || []);
      this.houses = list.map((item,index) => ({
        id:String(item._id || item.id || `house-${index}`), title:item.title || item.name || '社区房源',
        cover:item.cover || item.image || item.coverImage || (item.images && item.images[0]) || '',
        area:item.area || item.buildingArea || '', rooms:item.rooms || item.layout || '',
        orientation:item.orientation || item.direction || '', rentType:item.rentType || '',
        price:item.price === undefined || item.price === null ? '面议' : item.price,
        address:item.address || '', community:item.community || '',
        tags:Array.isArray(item.tags) ? item.tags.slice(0,3) : [], imageHeight:index%4===1?478:398,
      }));
      const areas = [...new Set([...this.data.areas,...this.houses.map(item=>item.community).filter(Boolean)])];
      this.setData({ total:result.total || list.length,areas });
      this.applySearch();
    } catch(err) {
      if (requestId === this.requestId) this.setData({ error:err.message || '房源加载失败，请稍后重试',columns:[[],[]],empty:false });
    } finally { if (requestId === this.requestId) this.setData({ loading:false }); }
  },
  applySearch() {
    const keyword = this.data.keyword.trim().toLowerCase();
    const houses = (this.houses || []).filter(item => !keyword || `${item.title} ${item.address} ${item.community}`.toLowerCase().includes(keyword));
    this.setData({ columns:[houses.filter((_,i)=>i%2===0),houses.filter((_,i)=>i%2===1)],empty:!houses.length });
  },
  toggleSearch() { this.setData({ searching:!this.data.searching }); if (!this.data.searching) { this.setData({ keyword:'' });this.applySearch(); } },
  onSearch(event) { this.setData({ keyword:event.detail.value }); this.applySearch(); },
  chooseService(event) {
    const service=SERVICES.find(item=>item.id===event.currentTarget.dataset.id);
    if (!service || service.id==='house') return;
    if (service.id==='community') { wx.switchTab({ url:'/pages/home/index' }); return; }
    wx.showModal({ title:service.label,content:'该服务暂未开放，敬请期待。',showCancel:false,confirmColor:'#ff2450' });
  },
  openFilter(event) { this.setData({ filterOpen:true,filterKind:event.currentTarget.dataset.kind || 'all',draft:{ ...this.data.filters } }); },
  closeFilter() { this.setData({ filterOpen:false }); },
  stopTap() {},
  chooseOption(event) {
    const { key,value }=event.currentTarget.dataset;
    this.setData({ [`draft.${key}`]:value === '不限' ? '' : value });
  },
  resetFilter() { this.setData({ draft:{ community:'',price:'all',roomType:'',rentType:'all' } }); },
  applyFilter() {
    const filter={ ...this.data.draft };
    const price=PRICE_OPTIONS.find(item=>item.value===filter.price) || PRICE_OPTIONS[0];
    this.setData({ filters:filter,filterOpen:false,labels:{ area:filter.community || '区域',price:filter.price==='all'?'租金':price.label,room:filter.roomType?`${filter.roomType}室`:'户型' } });
    this.loadHouses();
  },
  clearFilter() {
    this.setData({ filters:{ community:'',price:'all',roomType:'',rentType:'all' },keyword:'',labels:{ area:'区域',price:'租金',room:'户型' } });
    this.loadHouses();
  },
  openHouse(event) { wx.navigateTo({ url:`/pages/rental/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
  showCommunity() { this.setData({ filterOpen:true,filterKind:'area',draft:{ ...this.data.filters } }); },
});
