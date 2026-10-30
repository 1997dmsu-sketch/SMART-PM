const api = require('../../services/api');

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
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      demo: api.isDemo(),
      community: api.isDemo() ? '幸福花园 · A栋2单元' : '我的房屋',
    });
    this.load();
    if (options && options.family === '1') this.openFamily();
  },
  onShow() {
    const tab = this.getTabBar && this.getTabBar();
    if (tab) tab.setData({ selected: 'unlock' });
    const app = getApp();
    if (app.globalData.openFamily) {
      app.globalData.openFamily = false;
      this.openFamily();
    }
  },
  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '', recordsError: '' });
    await Promise.all([
      api.listLocks().then(locks => {
        this.setData({ locks: locks || [], address: (locks && locks[0] && locks[0].address) || '' });
      }).catch(err => this.setData({ locks: [], error: err.message || '门锁加载失败，请重试' })),
      api.listUnlockRecords().then(records => this.setData({
        records: (records || []).map(record => ({
          ...record,
          successful: record.status === '成功' || record.status === 'success',
        })),
      })).catch(err => this.setData({ records: [], recordsError: err.message || '记录暂时无法读取' })),
    ]);
    this.setData({ loading: false });
    wx.stopPullDownRefresh();
  },
  onPullDownRefresh() { this.load(); },
  refresh() { this.load(); },
  showRecords() { this.setData({ showAllRecords: !this.data.showAllRecords }); },
  primaryUnlock() {
    if (!this.data.locks.length) {
      wx.showToast({ title: '暂无可操作门锁', icon: 'none' });
      return;
    }
    if (this.data.locks.length === 1) {
      this.requestUnlock(this.data.locks[0]);
      return;
    }
    wx.showActionSheet({
      itemList: this.data.locks.slice(0, 6).map(lock => lock.name),
      success: result => this.requestUnlock(this.data.locks[result.tapIndex]),
    });
  },
  onUnlock(event) {
    const lock = this.data.locks.find(item => String(item.id) === String(event.currentTarget.dataset.id));
    if (lock) this.requestUnlock(lock);
  },
  requestUnlock(lock) {
    if (this.data.pendingId || this.data.confirming) return;
    if (api.isDemo()) {
      wx.showModal({ title: '当前为设计演示', content: '演示门锁不会发出开门指令。连接云环境并完成住户授权后，才能操作真实设备。', showCancel: false });
      return;
    }
    this.setData({ confirming: true });
    wx.showModal({
      title: '确认远程开门',
      content: `确认打开“${lock.name}”吗？请确认门前情况。`,
      confirmText: '确认开门',
      confirmColor: '#ff2148',
      success: async result => {
        this.setData({ confirming: false });
        if (!result.confirm) return;
        this.setData({ pendingId: String(lock.id) });
        try {
          const response = await api.unlockDevice(lock);
          wx.showModal({ title: '指令已提交', content: (response && response.message) || '请确认门锁实际响应。', showCancel: false });
          await this.load();
        } catch (err) {
          wx.showModal({ title: '开门未完成', content: err.message || '设备未响应，请重试或联系物业。', showCancel: false });
        } finally {
          this.setData({ pendingId: '' });
        }
      },
      fail: () => this.setData({ confirming: false }),
    });
  },
  async openFamily() {
    this.setData({ familyOpen: true, familyLoading: true, familyError: '' });
    const tab = this.getTabBar && this.getTabBar();
    if (tab) tab.setData({ modalOpen: true });
    try {
      const family = await api.listFamily();
      this.setData({ family: family || [] });
    } catch (err) {
      this.setData({ family: [], familyError: err.message || '暂时无法读取家庭成员' });
    } finally {
      this.setData({ familyLoading: false });
    }
  },
  closeFamily() {
    this.setData({ familyOpen: false });
    const tab = this.getTabBar && this.getTabBar();
    if (tab) tab.setData({ modalOpen: false });
  },
  onHide() { this.closeFamily(); },
  stopBubble() {},
  addFamily() {
    wx.showModal({
      title: '家庭成员授权',
      content: '现有后端尚未提供家庭成员添加接口。请联系物业办理，当前页面不会创建成员或授予门锁权限。',
      showCancel: false,
    });
  },
});
