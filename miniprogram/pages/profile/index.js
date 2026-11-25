const api = require('../../services/api');
const { hasLogin, requireLogin, canActNow } = require('../../utils/require-login');
const { getNavigationLayout } = require('../../utils/layout');
const release = require('../../config/version');
const runtime = require('../../config/runtime');
const EMPTY_PROFILE = { nickname: '未登录', avatar: '/assets/profile-avatar.png', propertyId: '—', community: '', house: '', points: '—', coupons: '—', orders: '—' };

Page({
  data: {
    release, statusBarHeight: 20, navHeight: 44, navSideWidth: 104, demo: false, loading: false, error: '', authenticated: false,
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
    // 纯 UI 显隐开关；不是服务端审批依据，也不改变 mode / allowDeviceOperations。
    checkinFaceEntry: runtime.checkinFaceTestEntry === true,
    checkinTestMenu: { id: 'checkinTest', name: '测试入住' },
    showFavorites: false, favorites: [],
  },
  onLoad() {
    this._visible = true;
    this.setData({ ...getNavigationLayout(), demo: api.isDemo(), checkinFaceEntry: runtime.checkinFaceTestEntry === true });
  },
  onResize() { this.setData(getNavigationLayout()); },
  onShow() {
    this._visible = true;
    this.setData(getNavigationLayout());
    if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ selected: 'profile' });
    return this.loadProfile();
  },
  onHide() { this.cancelPendingLogin(); },
  onUnload() { this.cancelPendingLogin(); },
  cancelPendingLogin() {
    this._visible = false;
    this._loginAttempt = (this._loginAttempt || 0) + 1;
    this._profileAttempt = (this._profileAttempt || 0) + 1;
    if (typeof api.cancelPhoneLogin === 'function') api.cancelPhoneLogin();
    this.setData({ loggingIn: false, loading: false });
  },
  async onPullDownRefresh() { await this.loadProfile(); wx.stopPullDownRefresh(); },
  async loadProfile() {
    if (this._visible === false || this.data.loading) return;
    const attempt = this._profileAttempt = (this._profileAttempt || 0) + 1;
    const epoch = typeof api.getLoginEpoch === 'function' ? api.getLoginEpoch() : undefined;
    const current = () => this._visible !== false && attempt === this._profileAttempt;
    const sameLogin = () => typeof api.getLoginEpoch !== 'function' || epoch === api.getLoginEpoch();
    this.setData({ loading: true, error: '' });
    try {
      const data = await api.getProfile();
      if (!current()) return;
      // Validate the exact snapshot to be displayed with the shared login
      // rules, while retaining the API's current authentication capability.
      const source = { getProfile: async () => data, isDemo: () => typeof api.isDemo === 'function' && api.isDemo() === true };
      if (typeof api.isAuthenticated === 'function') source.isAuthenticated = () => api.isAuthenticated();
      const authenticated = (await hasLogin(source)) && canActNow(api);
      if (!current()) return;
      if (!sameLogin()) {
        this.setData({ profile: EMPTY_PROFILE, authenticated: false, showFavorites: false, favorites: [] });
        return;
      }
      this.setData({ profile: authenticated ? { ...EMPTY_PROFILE, ...data, avatar: data.avatar || EMPTY_PROFILE.avatar } : EMPTY_PROFILE,
        authenticated, ...(!authenticated ? { showFavorites: false, favorites: [] } : {}) });
    } catch (err) { if (current()) this.setData({ profile: EMPTY_PROFILE, authenticated: false, showFavorites: false, favorites: [], error: '资料加载失败，请重试' }); }
    finally { if (current()) this.setData({ loading: false }); }
  },
  async login(event) {
    if (this._visible === false || this.data.loggingIn) return;
    if (this.data.demo) { wx.showToast({ title: '演示模式无需真实授权', icon: 'none' }); return; }
    const code = event.detail && event.detail.code;
    if (!code) { wx.showToast({ title: '已取消授权，未注册或登录', icon: 'none' }); return; }
    const attempt = this._loginAttempt = (this._loginAttempt || 0) + 1;
    this._profileAttempt = (this._profileAttempt || 0) + 1;
    const current = () => this._visible !== false && attempt === this._loginAttempt;
    this.setData({ loggingIn: true, loading: false, error: '' });
    try {
      await api.loginWithPhone(code);
      if (current()) {
        this._profileAttempt = (this._profileAttempt || 0) + 1;
        this.setData({ loading: false });
        await this.loadProfile();
      }
    }
    catch (err) { if (current()) wx.showToast({ title: err.message || '登录失败，请重试', icon: 'none' }); }
    finally { if (current()) this.setData({ loggingIn: false }); }
  },
  openAccountLogin() {
    if (this.data.loggingIn || this.data.authenticated || this.data.demo) return;
    wx.navigateTo({ url: '/pages/account-login/index' });
  },
  async unavailable(title) {
    if (!(await requireLogin(api, title)) || !canActNow(api)) return;
    wx.showModal({ title, content: '该服务尚未完成接口对接，当前不会提交或修改真实数据。', showCancel: false, confirmColor: '#ff2450' });
  },
  editProfile() { return this.unavailable('编辑资料'); },
  openService(event) { return this.unavailable(event.currentTarget.dataset.name || '物业服务'); },
  async openMenu(event) {
    const id = event.currentTarget.dataset.id;
    if (id === 'about') {
      wx.showModal({ title: '宇宙物业智联', content: `版本 v${release.version} · ${release.channel}\n连接社区生活与物业服务。\n演示内容不代表真实房源、账户或设备状态。`, showCancel: false, confirmColor: '#ff2450' }); return;
    }
    if (id === 'coupon') return this.unavailable('优惠券');
    const label = { house: '我的房子', family: '家庭成员', access: '门禁管理', favorite: '我的收藏', checkinTest: '测试入住' }[id];
    if (!label) return this.unavailable('物业服务');
    if (!(await requireLogin(api, label)) || !canActNow(api)) return;
    if (id === 'checkinTest') {
      if (!this.data.checkinFaceEntry) return;
      wx.navigateTo({ url: '/pages/checkin/index' });
      return;
    }
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
  },
  closeFavorites() { this.setData({ showFavorites: false }); },
  stopTap() {},
  openFavorite(event) {
    this.closeFavorites();
    wx.navigateTo({ url: `/pages/rental/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },
  async settings() {
    if (!(await requireLogin(api, '账号设置')) || !canActNow(api)) return;
    if (this.data.demo) {
      wx.showModal({ title: '账号设置', content: '当前为设计演示模式，没有登录真实账号。', showCancel: false, confirmColor: '#ff2450' }); return;
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
