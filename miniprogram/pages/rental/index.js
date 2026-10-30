const api = require('../../services/api');
const FACILITIES = [
  { name: '冰箱', key: 'fridge', icon: '/assets/rental-fridge.png' },
  { name: '洗衣机', key: 'washer', icon: '/assets/rental-washer.png' },
  { name: '热水器', key: 'heater', icon: '/assets/rental-heater.png' },
  { name: '空调', key: 'aircon', icon: '/assets/rental-aircon.png' },
  { name: '阳台', key: 'balcony', icon: '/assets/rental-balcony.png' }
];
const validImage = value => typeof value === 'string' && /^(\/|https:\/\/|cloud:\/\/)/.test(value);
const formatPrice = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? String(Number(value)) : '待咨询';

function normalizeHouse(raw) {
  const house = Object.assign({}, raw);
  house.id = String(house.id || house._id || '');
  house.title = house.title || house.name || '房源详情';
  house.priceText = formatPrice(house.price);
  house.payment = house.payment || '待咨询';
  house.rooms = house.rooms || house.roomType || '待补充';
  house.areaText = house.area ? `${house.area}㎡` : '待补充';
  house.orientation = house.orientation || '待补充';
  house.floorText = house.floor ? `${house.floor}${String(house.floor).includes('层') ? '' : '层'}` : '待补充';
  house.tags = Array.isArray(house.tags) ? house.tags : [];
  house.images = (Array.isArray(house.images) ? house.images : [house.cover || house.image]).filter(validImage);
  house.communityImages = (Array.isArray(house.communityImages) ? house.communityImages : []).filter(validImage);
  house.community = house.community || '小区信息待补充';
  house.nearby = house.nearby || house.address || '位置信息待补充';
  house.availableFrom = house.availableFrom || '入住时间待咨询';
  house.leaseTerm = house.leaseTerm || '租期与看房安排请咨询';
  house.agencyFee = house.agencyFee === undefined ? '需咨询' : String(house.agencyFee);
  house.depositText = formatPrice(house.deposit);
  const facilities = Array.isArray(house.facilities) ? house.facilities : [];
  house.facilityItems = FACILITIES.map(item => Object.assign({}, item, { available: facilities.includes(item.name) || facilities.includes(item.key) }));
  return house;
}

Page({
  data: {
    loading: true, error: '', house: null, recommendations: [], demo: false,
    statusBarHeight: 20, navHeight: 64, scrolled: false, galleryMode: 'room', galleryImages: [], imageIndex: 0,
    favorite: false, activeSection: 'overview', appointmentOpen: false,
    appointmentDate: '', appointmentTime: '', minimumDate: '', formError: '',
    tabs: [{ id: 'overview', label: '租房简介' }, { id: 'lease', label: '租住详情' }, { id: 'facilities', label: '房屋简介' }, { id: 'community', label: '小区详情' }],
    questions: ['什么时候可以看房？', '价格还能再优惠一下吗？', '房子靠近商场吗？', '房源的采光怎么样？']
  },
  onLoad(options) {
    this.houseId = options.id || '';
    const app = getApp();
    const statusBarHeight = app.globalData.statusBarHeight || 20;
    const today = new Date();
    const minimumDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    this.setData({ statusBarHeight, navHeight: statusBarHeight + 44, demo: api.isDemo(), minimumDate });
    this.load();
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  onPageScroll(event) {
    const scrolled = event.scrollTop > 220;
    if (scrolled !== this.data.scrolled) this.setData({ scrolled });
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const raw = await api.getHouse(this.houseId);
      if (!raw) { this.setData({ loading: false, house: null }); return; }
      const house = normalizeHouse(raw);
      this.houseId = house.id || this.houseId;
      let favorites = [];
      try { favorites = wx.getStorageSync('favorites') || []; } catch (_) {}
      this.setData({ house, galleryMode: 'room', galleryImages: house.images, imageIndex: 0, favorite: Array.isArray(favorites) && favorites.some(item => item && item.id === this.houseId), loading: false });
      try {
        const result = await api.listHouses({ pageSize: 6 });
        this.setData({ recommendations: (result.houses || []).filter(item => String(item.id || item._id) !== this.houseId).slice(0, 5).map(normalizeHouse) });
      } catch (_) { this.setData({ recommendations: [] }); }
    } catch (error) { this.setData({ loading: false, error: error.message || '房源加载失败，请稍后重试' }); }
  },
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/life/index' });
  },
  changeGallery(event) {
    const mode = event.currentTarget.dataset.mode;
    this.setData({ galleryMode: mode, galleryImages: mode === 'community' ? this.data.house.communityImages : this.data.house.images, imageIndex: 0 });
  },
  imageChanged(event) { this.setData({ imageIndex: event.detail.current }); },
  previewCommunity(event) {
    const urls = this.data.house.communityImages;
    if (urls.length) wx.previewImage({ current: event.currentTarget.dataset.src || urls[0], urls });
  },
  previewImage() {
    if (!this.data.galleryImages.length) return;
    wx.previewImage({ current: this.data.galleryImages[this.data.imageIndex], urls: this.data.galleryImages });
  },
  jumpTo(event) {
    const section = event.currentTarget.dataset.section;
    this.setData({ activeSection: section });
    wx.createSelectorQuery().select(`#section-${section}`).boundingClientRect().selectViewport().scrollOffset().exec(result => {
      if (result[0] && result[1]) wx.pageScrollTo({ scrollTop: Math.max(0, result[0].top + result[1].scrollTop - this.data.navHeight - 52), duration: 250 });
    });
  },
  toggleFavorite() {
    try {
      let favorites = wx.getStorageSync('favorites') || [];
      if (!Array.isArray(favorites)) favorites = [];
      const next = !this.data.favorite;
      favorites = favorites.filter(item => item && item.id !== this.houseId);
      if (next) favorites.push({ id: this.houseId, title: this.data.house.title, cover: this.data.house.images[0] || '' });
      wx.setStorageSync('favorites', favorites);
      this.setData({ favorite: next });
      wx.showToast({ title: next ? '已关注此房源' : '已取消关注', icon: 'none' });
    } catch (_) { wx.showToast({ title: '保存失败，请重试', icon: 'none' }); }
  },
  openAppointment() { this.setData({ appointmentOpen: true, formError: '' }); },
  closeAppointment() { this.setData({ appointmentOpen: false }); },
  stopPropagation() {},
  changeDate(event) { this.setData({ appointmentDate: event.detail.value }); },
  changeTime(event) { this.setData({ appointmentTime: event.detail.value }); },
  saveAppointment(event) {
    const { name, phone, note } = event.detail.value;
    if (!String(name || '').trim()) { this.setData({ formError: '请填写联系人' }); return; }
    if (!/^1\d{10}$/.test(String(phone || '').trim())) { this.setData({ formError: '请填写有效的 11 位手机号' }); return; }
    if (!this.data.appointmentDate || !this.data.appointmentTime) { this.setData({ formError: '请选择看房日期和时间' }); return; }
    const scheduled = new Date(`${this.data.appointmentDate.replace(/-/g, '/')} ${this.data.appointmentTime}`);
    if (!Number.isFinite(scheduled.getTime()) || scheduled.getTime() <= Date.now()) { this.setData({ formError: '请选择未来的看房时间' }); return; }
    try {
      wx.setStorageSync(`smart-pm-appointment-${this.houseId}`, { houseId: this.houseId, name: name.trim(), phone: phone.trim(), date: this.data.appointmentDate, time: this.data.appointmentTime, note: note || '', status: 'local-draft', savedAt: Date.now() });
      this.setData({ appointmentOpen: false });
      wx.showModal({ title: '预约草稿已保存在本机', content: '尚未发送给物业。请通过电话联系或在线咨询，与工作人员确认看房安排。', showCancel: false });
    } catch (_) { this.setData({ formError: '草稿保存失败，请重试' }); }
  },
  contactPhone() {
    if (this.data.demo) { wx.showModal({ title: '设计演示', content: '当前为演示房源，不会拨打电话。接入真实房源后可联系工作人员。', showCancel: false }); return; }
    const phone = String(this.data.house.phone || '').replace(/[\s-]/g, '');
    if (!/^(\+?86)?1\d{10}$|^0\d{9,11}$/.test(phone)) { wx.showToast({ title: '此房源暂未提供联系电话', icon: 'none' }); return; }
    wx.makePhoneCall({ phoneNumber: phone, fail: () => {} });
  },
  consult() { wx.switchTab({ url: '/pages/messages/index' }); },
  seeMore() { wx.switchTab({ url: '/pages/life/index' }); },
  openRecommendation(event) { wx.navigateTo({ url: `/pages/rental/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
  onShareAppMessage() {
    const house = this.data.house;
    return { title: house ? house.title : '宇宙物业智联 · 房源', path: `/pages/rental/index?id=${encodeURIComponent(this.houseId || '')}` };
  }
});
