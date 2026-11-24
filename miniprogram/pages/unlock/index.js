const api = require('../../services/api');
const { requireLogin, hasLogin, canActNow } = require('../../utils/require-login');

Page({
  data: {
    statusBarHeight: 20,
    demo: true,
    loading: false,
    locks: [],
    records: [],
    error: '',
    recordsError: '',
    pendingId: '',
    confirming: false,
    showAllRecords: false,
    familyOpen: false,
    familyLoading: false,
    family: [],
    familyError: '',
    community: '我的房屋',
    address: '',
  },
  onLoad(options) {
    this._destroyed = false;
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      demo: api.isDemo(),
      community: api.isDemo() ? '幸福花园 · A栋2单元' : '我的房屋',
    });
    const loading = this.load();
    if (options && options.family === '1') this.openFamily();
    return loading;
  },
  onShow() {
    this._destroyed = false;
    this.clearPrivate();
    const tab = this.getTabBar && this.getTabBar();
    if (tab) tab.setData({ selected: 'unlock' });
    const app = getApp();
    if (app.globalData.openFamily) {
      app.globalData.openFamily = false;
      this.openFamily();
    }
    return this.load();
  },
  clearPrivate() {
    this._viewVersion = (this._viewVersion || 0) + 1;
    this.setData({ locks: [], records: [], family: [], address: '', community: '我的房屋',
      loading: false, familyLoading: false, familyError: '', error: '', recordsError: '', pendingId: '', confirming: false, showAllRecords: false });
    this.closeFamily();
  },
  async requirePrivate(action) {
    // 已知未登录先清旧视图，不等待用户关闭登录提示。
    if (!canActNow(api)) this.clearPrivate();
    if (!await hasLogin(api) || !canActNow(api)) this.clearPrivate();
    if (await requireLogin(api, action)) return true;
    this.clearPrivate();
    return false;
  },
  canUsePrivate(expectedEpoch) {
    const allowed = arguments.length ? canActNow(api, expectedEpoch) : canActNow(api);
    if (!allowed) this.clearPrivate();
    return allowed;
  },
  async load() {
    if (this.data.loading) return;
    const version = this._viewVersion || 0;
    this.setData({ loading: true, error: '', recordsError: '' });
    if (!await this.requirePrivate('查看门锁与开门记录') || !this.canUsePrivate()) { wx.stopPullDownRefresh(); return; }
    if (version !== (this._viewVersion || 0) || this._destroyed) return;
    await Promise.all([
      api.listLocks().then(async locks => {
        if (version !== (this._viewVersion || 0) || this._destroyed) return;
        if (!await this.requirePrivate('查看门锁') || !this.canUsePrivate()) return;
        if (version !== (this._viewVersion || 0) || this._destroyed) return;
        this.setData({ locks: locks || [], address: (locks && locks[0] && locks[0].address) || '' });
      }).catch(err => { if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ locks: [], error: err.message || '门锁加载失败，请重试' }); }),
      api.listUnlockRecords().then(async records => {
        if (version !== (this._viewVersion || 0) || this._destroyed) return;
        if (!await this.requirePrivate('查看开门记录') || !this.canUsePrivate()) return;
        if (version !== (this._viewVersion || 0) || this._destroyed) return;
        this.setData({ records: (records || []).map(record => ({
          ...record,
          successful: record.status === '成功' || record.status === 'success',
        })) });
      }).catch(err => { if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ records: [], recordsError: err.message || '记录暂时无法读取' }); }),
    ]);
    if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ loading: false });
    wx.stopPullDownRefresh();
  },
  onPullDownRefresh() { return this.load(); },
  refresh() { return this.load(); },
  async showRecords() { if (await this.requirePrivate('查看开门记录') && this.canUsePrivate()) this.setData({ showAllRecords: !this.data.showAllRecords }); },
  async primaryUnlock() {
    if (!await this.requirePrivate('远程开门') || !this.canUsePrivate()) return;
    const loginEpoch = typeof api.getLoginEpoch === 'function' ? api.getLoginEpoch() : null;
    if (!this.canUsePrivate(loginEpoch)) return;
    if (!this.data.locks.length) {
      wx.showToast({ title: '暂无可操作门锁', icon: 'none' });
      return;
    }
    if (this.data.locks.length === 1) {
      return this.requestUnlock(this.data.locks[0], loginEpoch);
    }
    wx.showActionSheet({
      itemList: this.data.locks.slice(0, 6).map(lock => lock.name),
      success: result => { if (this.canUsePrivate(loginEpoch)) return this.requestUnlock(this.data.locks[result.tapIndex], loginEpoch); },
    });
  },
  async onUnlock(event) {
    if (!await this.requirePrivate('远程开门') || !this.canUsePrivate()) return;
    const loginEpoch = typeof api.getLoginEpoch === 'function' ? api.getLoginEpoch() : null;
    if (!this.canUsePrivate(loginEpoch)) return;
    const lock = this.data.locks.find(item => String(item.id) === String(event.currentTarget.dataset.id));
    if (lock) return this.requestUnlock(lock, loginEpoch);
  },
  async requestUnlock(lock, expectedEpoch) {
    const loginEpoch = expectedEpoch === undefined
      ? (typeof api.getLoginEpoch === 'function' ? api.getLoginEpoch() : null) : expectedEpoch;
    if (this.data.pendingId || this.data.confirming) return;
    if (!await this.requirePrivate('远程开门') || !this.canUsePrivate(loginEpoch)) return;
    if (this.data.pendingId || this.data.confirming) return;
    if (api.isDemo()) {
      wx.showModal({ title: '当前为设计演示', content: '演示门锁不会发出开门指令。连接云环境并完成住户授权后，才能操作真实设备。', showCancel: false });
      return;
    }
    this.setData({ confirming: true });
    const version = this._viewVersion || 0;
    wx.showModal({
      title: '确认远程开门',
      content: `确认打开“${lock.name}”吗？请确认门前情况。`,
      confirmText: '确认开门',
      confirmColor: '#ff2148',
      success: async result => {
        if (version !== (this._viewVersion || 0) || this._destroyed) return;
        this.setData({ confirming: false });
        if (!result.confirm) return;
        if (!await this.requirePrivate('远程开门') || !this.canUsePrivate(loginEpoch)) return;
        if (version !== (this._viewVersion || 0) || this._destroyed) return;
        this.setData({ pendingId: String(lock.id) });
        try {
          const response = await api.unlockDevice(lock);
          if (version !== (this._viewVersion || 0) || this._destroyed) return;
          if (!await this.requirePrivate('查看开门结果') || !this.canUsePrivate(loginEpoch)) return;
          if (version !== (this._viewVersion || 0) || this._destroyed) return;
          wx.showModal({ title: '指令已提交', content: (response && response.message) || '请确认门锁实际响应。', showCancel: false });
          await this.load();
        } catch (err) {
          if (version === (this._viewVersion || 0) && !this._destroyed) wx.showModal({ title: '开门未完成', content: err.message || '设备未响应，请重试或联系物业。', showCancel: false });
        } finally {
          if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ pendingId: '' });
        }
      },
      fail: () => { if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ confirming: false }); },
    });
  },
  async openFamily() {
    if (!await this.requirePrivate('查看家庭成员') || !this.canUsePrivate()) return;
    if (this.data.familyLoading) return;
    const version = this._viewVersion || 0;
    this.setData({ familyOpen: true, familyLoading: true, familyError: '' });
    const tab = this.getTabBar && this.getTabBar();
    if (tab) tab.setData({ modalOpen: true });
    try {
      const family = await api.listFamily();
      if (version !== (this._viewVersion || 0) || this._destroyed) return;
      if (!await this.requirePrivate('查看家庭成员') || !this.canUsePrivate()) return;
      if (version !== (this._viewVersion || 0) || this._destroyed) return;
      this.setData({ family: family || [] });
    } catch (err) {
      if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ family: [], familyError: err.message || '暂时无法读取家庭成员' });
    } finally {
      if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ familyLoading: false });
    }
  },
  closeFamily() {
    this.setData({ familyOpen: false });
    const tab = this.getTabBar && this.getTabBar();
    if (tab) tab.setData({ modalOpen: false });
  },
  onHide() { this._viewVersion = (this._viewVersion || 0) + 1; this.closeFamily(); },
  onUnload() { this._destroyed = true; this._viewVersion = (this._viewVersion || 0) + 1; },
  stopBubble() {},
  async addFamily() {
    if (!await this.requirePrivate('添加家庭成员') || !this.canUsePrivate()) return;
    wx.showModal({
      title: '家庭成员授权',
      content: '现有后端尚未提供家庭成员添加接口。请联系物业办理，当前页面不会创建成员或授予门锁权限。',
      showCancel: false,
    });
  },
});
