const api = require('../../services/api');

Page({
  data: {
    statusBarHeight: 20,
    demo: false,
    section: 'basic',
    deviceType: 'electricity',
    property: null,
    propertyLoading: true,
    propertyError: '',
    devices: [],
    loading: true,
    error: '',
    noteExpanded: false,
    noteDraft: '',
    noteSaved: false,
    actions: [
      { id: 'recharge', label: '充值记录' },
      { id: 'fees', label: '费用明细' },
      { id: 'operations', label: '操作记录' },
      { id: 'unlock', label: '开门' }
    ],
    deviceTabs: [
      { id: 'electricity', label: '电表' },
      { id: 'water', label: '水表' },
      { id: 'locks', label: '门锁' }
    ]
  },
  onLoad() {
    const app = getApp();
    this.setData({ statusBarHeight: (app.globalData || {}).statusBarHeight || 20, demo: api.isDemo() });
    this.loadAll();
  },
  onUnload() { this._deviceRequest = (this._deviceRequest || 0) + 1; this._destroyed = true; },
  onPullDownRefresh() { this.loadAll().finally(() => wx.stopPullDownRefresh()); },
  async loadAll() { await Promise.all([this.loadProperty(), this.loadDevices()]); },
  async loadProperty() {
    this.setData({ propertyLoading: true, propertyError: '' });
    try {
      const property = await api.getProperty();
      if (this._destroyed) return;
      const key = `property-note-draft:${api.isDemo() ? 'demo' : 'live'}:${property && property.id || 'default'}`;
      this._noteKey = key;
      this.setData({ property: property || null, noteDraft: wx.getStorageSync(key) || '', noteSaved: false });
    } catch (error) {
      if (!this._destroyed) this.setData({ propertyError: error.message || '房源信息加载失败，请稍后重试', property: null });
    } finally { if (!this._destroyed) this.setData({ propertyLoading: false }); }
  },
  async loadDevices() {
    const request = this._deviceRequest = (this._deviceRequest || 0) + 1;
    const type = this.data.deviceType;
    this.setData({ loading: true, error: '', devices: [] });
    try {
      const result = type === 'locks' ? await api.listLocks() : await api.listMeters(type);
      if (request !== this._deviceRequest || this._destroyed) return;
      const devices = (Array.isArray(result) ? result : []).map((item, index) => {
        const status = item.status;
        const online = ['online', '在线', '已连接', true, 1].includes(status);
        const offline = ['offline', '离线', false, 0].includes(status);
        return {
          ...item,
          id: item.id || item.deviceId || item.lockId || `device-${index}`,
          name: item.name || (type === 'locks' ? '智能门锁' : type === 'water' ? '智能水表' : '智能电表'),
          statusText: online ? '在线' : offline ? '离线' : status || '状态未知',
          statusClass: online ? 'online' : offline ? 'offline' : 'unknown',
          usageText: item.usage === undefined || item.usage === null ? '待获取' : String(item.usage),
          priceText: item.price === undefined || item.price === null ? '待获取' : Number.isFinite(Number(item.price)) ? Number(item.price).toFixed(2) : String(item.price),
          unit: item.unit || (type === 'water' ? 'm³' : 'kW·h')
        };
      });
      this.setData({ devices });
    } catch (error) {
      if (request === this._deviceRequest && !this._destroyed) this.setData({ error: error.message || '设备加载失败，请重试' });
    } finally { if (request === this._deviceRequest && !this._destroyed) this.setData({ loading: false }); }
  },
  changeSection(event) { this.setData({ section: event.currentTarget.dataset.section }); },
  changeDeviceType(event) {
    const type = event.currentTarget.dataset.type;
    if (type === this.data.deviceType) return;
    this.setData({ deviceType: type });
    this.loadDevices();
  },
  toggleNote() { this.setData({ noteExpanded: !this.data.noteExpanded }); },
  editNote(event) { this.setData({ noteDraft: event.detail.value, noteSaved: false }); },
  saveNoteDraft() {
    if (!this._noteKey) { this.explainUnavailable(); return; }
    try {
      wx.setStorageSync(this._noteKey, this.data.noteDraft.trim());
      this.setData({ noteSaved: true });
    } catch (_) { wx.showToast({ title: '本地草稿保存失败', icon: 'none' }); }
  },
  openAction(event) {
    if (event.currentTarget.dataset.id === 'unlock') { wx.switchTab({ url: '/pages/unlock/index' }); return; }
    wx.showModal({ title: event.currentTarget.dataset.label, content: '当前后端尚未提供此记录接口，接入后可在此查看。', showCancel: false });
  },
  explainUnavailable(event) {
    const title = event && event.currentTarget && event.currentTarget.dataset.title || '房源管理';
    wx.showModal({ title, content: '此操作需由物业管理端维护，当前页面尚未接入相应管理接口，不会修改房源或设备。', showCancel: false });
  },
  back() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/profile/index' }) }); }
});
