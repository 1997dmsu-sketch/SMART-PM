const api = require('../../services/api');
const EMPTY_PROFILE = { nickname: '未登录', avatar: '/assets/profile-avatar.png', propertyId: '—', community: '', house: '', points: '—', coupons: '—', orders: '—' };

Page({
  data: {
    statusBarHeight: 20, demo: false, loading: false, error: '', authenticated: false,
    profile: EMPTY_PROFILE, loggingIn: false,
    services: [
      { id: 'pending', name: '待处理', icon: 'pending' },
      { id: 'processing', name: '处理中', icon: 'processing' },
      { id: 'finished', name: '已办结', icon: 'finished' },
      { id: 'visitors', name: '访客记录', icon: 'visitors' },
    ],
    menus: [
      { id: 'house', name: '我的房子' }, { id: 'family', name: '家庭成员' },
      { id: 'access', name: '门禁管理' }, { id: 'coupon', name: '优惠券' },
      { id: 'favorite', name: '我的收藏' }, { id: 'about', name: '关于我们' },
    ],
    showFavorites: false, favorites: [],
  },
  onLoad() {
    this.setData({ statusBarHeight: getApp().globalData.statusBarHeight || 20, demo: api.isDemo() });
  },
  onShow() {
    if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ selected: 'profile' });
    return this.loadProfile();
  },
  async onPullDownRefresh() { await this.loadProfile(); wx.stopPullDownRefresh(); },
  async loadProfile() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const data = await api.getProfile();
      const authenticated = Boolean(data && data.authenticated !== false);
      this.setData({ profile: data ? { ...EMPTY_PROFILE, ...data, avatar: data.avatar || EMPTY_PROFILE.avatar } : EMPTY_PROFILE, authenticated });
    } catch (err) { this.setData({ error: err.message || '资料加载失败，请重试' }); }
    finally { this.setData({ loading: false }); }
  },
  async login(event) {
    if (this.data.loggingIn) return;
    if (this.data.demo) { wx.showToast({ title: '演示模式无需真实授权', icon: 'none' }); return; }
    const code = event.detail && event.detail.code;
    if (!code) { wx.showToast({ title: '未获取手机号授权', icon: 'none' }); return; }
    this.setData({ loggingIn: true });
    try { await api.loginWithPhone(code); await this.loadProfile(); }
    catch (err) { wx.showToast({ title: err.message || '登录失败，请重试', icon: 'none' }); }
    finally { this.setData({ loggingIn: false }); }
  },
  unavailable(title) {
    wx.showModal({ title, content: '该服务尚未完成接口对接，当前不会提交或修改真实数据。', showCancel: false, confirmColor: '#ff2450' });
  },
  editProfile() { this.unavailable('编辑资料'); },
  openService(event) { this.unavailable(event.currentTarget.dataset.name || '物业服务'); },
  openMenu(event) {
    const id = event.currentTarget.dataset.id;
    if (id === 'house') { wx.navigateTo({ url: '/pages/property/index' }); return; }
    if (id === 'family' || id === 'access') {
      getApp().globalData.openFamily = id === 'family';
      wx.switchTab({ url: '/pages/unlock/index' }); return;
    }
    if (id === 'favorite') {
      const stored = wx.getStorageSync('favorites') || [];
      const favorites = (Array.isArray(stored) ? stored : []).map(item => typeof item === 'object' ? { ...item, id: item.id || item._id, title: item.title || item.name || '已收藏房源' } : { id: item, title: `房源 ${item}` });
      this.setData({ showFavorites: true, favorites }); return;
    }
    if (id === 'about') {
      wx.showModal({ title: '宇宙物业智联', content: '连接社区生活与物业服务。\n当前版本按新设计搭建，演示内容不代表真实房源、账户或设备状态。', showCancel: false, confirmColor: '#ff2450' }); return;
    }
    this.unavailable('优惠券');
  },
  closeFavorites() { this.setData({ showFavorites: false }); },
  stopTap() {},
  openFavorite(event) {
    this.closeFavorites();
    wx.navigateTo({ url: `/pages/rental/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },
  settings() {
    if (this.data.demo || !this.data.authenticated) {
      wx.showModal({ title: '账号设置', content: this.data.demo ? '当前为设计演示模式，没有登录真实账号。' : '请先通过手机号授权登录。', showCancel: false, confirmColor: '#ff2450' }); return;
    }
    wx.showActionSheet({ itemList: ['退出当前账号'], success: result => {
      if (result.tapIndex !== 0) return;
      wx.showModal({ title: '退出登录', content: '确定退出当前账号？', confirmColor: '#ff2450', success: async answer => {
        if (!answer.confirm) return;
        try { await api.logout(); await this.loadProfile(); }
        catch (err) { wx.showToast({ title: err.message || '退出失败', icon: 'none' }); }
      } });
    } });
  },
});
