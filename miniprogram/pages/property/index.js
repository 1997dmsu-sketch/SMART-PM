const api = require('../../services/api');
const { requireLogin, hasLogin, canActNow } = require('../../utils/require-login');

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
    this._destroyed = false;
    const app = getApp();
    this.setData({ statusBarHeight: (app.globalData || {}).statusBarHeight || 20, demo: api.isDemo() });
    return this.loadAll();
  },
  onShow() { this._destroyed = false; this.clearPrivate(); return this.loadAll(); },
  onHide() { this._viewVersion = (this._viewVersion || 0) + 1; },
  onUnload() { this._deviceRequest = (this._deviceRequest || 0) + 1; this._viewVersion = (this._viewVersion || 0) + 1; this._destroyed = true; },
  clearPrivate() {
    this._viewVersion = (this._viewVersion || 0) + 1;
    this._deviceRequest = (this._deviceRequest || 0) + 1;
    this._noteKey = null;
    this.setData({ property: null, devices: [], noteDraft: '', noteSaved: false, noteExpanded: false,
      propertyLoading: false, loading: false, propertyError: '', error: '' });
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
  onPullDownRefresh() { this.loadAll().finally(() => wx.stopPullDownRefresh()); },
  async loadAll() { await Promise.all([this.loadProperty(), this.loadDevices()]); },
  async loadProperty() {
    const version = this._viewVersion || 0;
    this.setData({ propertyLoading: true, propertyError: '' });
    try {
      if (!await this.requirePrivate('查看我的房屋') || !this.canUsePrivate()) return;
      if (this._destroyed || version !== (this._viewVersion || 0)) return;
      const property = await api.getProperty();
      if (this._destroyed || version !== (this._viewVersion || 0)) return;
      if (!await this.requirePrivate('查看我的房屋') || !this.canUsePrivate()) return;
      if (this._destroyed || version !== (this._viewVersion || 0)) return;
      const propertyId = property && (property.id || property._id);
      const key = propertyId ? `property-note-draft:${api.isDemo() ? 'demo' : 'live'}:${propertyId}` : null;
      this._noteKey = key;
      this.setData({ property: property || null, noteDraft: key ? wx.getStorageSync(key) || '' : '', noteSaved: false });
    } catch (error) {
      if (!this._destroyed && version === (this._viewVersion || 0)) this.setData({ propertyError: error.message || '房源信息加载失败，请稍后重试', property: null });
    } finally { if (!this._destroyed && version === (this._viewVersion || 0)) this.setData({ propertyLoading: false }); }
  },
  async loadDevices() {
    const request = this._deviceRequest = (this._deviceRequest || 0) + 1;
    const version = this._viewVersion || 0;
    const type = this.data.deviceType;
    this.setData({ loading: true, error: '', devices: [] });
    try {
      if (!await this.requirePrivate('查看房屋设备') || !this.canUsePrivate()) return;
      if (request !== this._deviceRequest || this._destroyed || version !== (this._viewVersion || 0)) return;
      const result = type === 'locks' ? await api.listLocks() : await api.listMeters(type);
      if (request !== this._deviceRequest || this._destroyed || version !== (this._viewVersion || 0)) return;
      if (!await this.requirePrivate('查看房屋设备') || !this.canUsePrivate()) return;
      if (request !== this._deviceRequest || this._destroyed || version !== (this._viewVersion || 0)) return;
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
      if (request === this._deviceRequest && !this._destroyed && version === (this._viewVersion || 0)) this.setData({ error: error.message || '设备加载失败，请重试' });
    } finally { if (request === this._deviceRequest && !this._destroyed && version === (this._viewVersion || 0)) this.setData({ loading: false }); }
  },
  changeSection(event) { this.setData({ section: event.currentTarget.dataset.section }); },
  changeDeviceType(event) {
    const type = event.currentTarget.dataset.type;
    if (type === this.data.deviceType) return;
    this.setData({ deviceType: type });
    return this.loadDevices();
  },
  async toggleNote() { if (await this.requirePrivate('查看房屋备注') && this.canUsePrivate()) this.setData({ noteExpanded: !this.data.noteExpanded }); },
  editNote(event) { this.setData({ noteDraft: event.detail.value, noteSaved: false }); },
  async saveNoteDraft() {
    if (!await this.requirePrivate('保存房屋备注') || !this.canUsePrivate()) return;
    if (!this._noteKey) { this.explainUnavailable(); return; }
    try {
      wx.setStorageSync(this._noteKey, this.data.noteDraft.trim());
      this.setData({ noteSaved: true });
    } catch (_) { wx.showToast({ title: '本地草稿保存失败', icon: 'none' }); }
  },
  async openAction(event) {
    if (!await this.requirePrivate('查看房屋服务') || !this.canUsePrivate()) return;
    if (event.currentTarget.dataset.id === 'unlock') { wx.switchTab({ url: '/pages/unlock/index' }); return; }
    wx.showModal({ title: event.currentTarget.dataset.label, content: '当前后端尚未提供此记录接口，接入后可在此查看。', showCancel: false });
  },
  async explainUnavailable(event) {
    if (!await this.requirePrivate('房源管理') || !this.canUsePrivate()) return;
    const title = event && event.currentTarget && event.currentTarget.dataset.title || '房源管理';
    wx.showModal({ title, content: '此操作需由物业管理端维护，当前页面尚未接入相应管理接口，不会修改房源或设备。', showCancel: false });
  },
  back() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/profile/index' }) }); }
});
