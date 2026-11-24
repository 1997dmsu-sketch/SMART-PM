const api = require('../../services/api');
const { requireLogin, hasLogin, canActNow } = require('../../utils/require-login');

Page({
  data: { statusBarHeight: 20, title: '在线咨询', demo: false, loading: false, error: '', messages: [], text: '', sending: false, hasMore: false, loadMoreError: '' },
  onLoad(options) {
    this.id = options.id || '';
    this._title = options.name || '在线咨询';
    this._destroyed = false;
    this.setData({ statusBarHeight: getApp().globalData.statusBarHeight || 20, demo: api.isDemo() });
    return this.load();
  },
  onShow() { this._destroyed = false; this.clearPrivate(); return this.load(); },
  onHide() { this._viewVersion = (this._viewVersion || 0) + 1; },
  onUnload() { this._destroyed = true; this._viewVersion = (this._viewVersion || 0) + 1; },
  clearPrivate() {
    this._viewVersion = (this._viewVersion || 0) + 1;
    this.setData({ title: '在线咨询', messages: [], text: '', hasMore: false, loading: false, sending: false, error: '', loadMoreError: '' });
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
    this.setData({ loading: true, error: '' });
    try {
      if (!await this.requirePrivate('查看聊天') || !this.canUsePrivate()) return;
      if (version !== (this._viewVersion || 0) || this._destroyed) return;
      const result = await api.getMessages(this.id);
      if (version !== (this._viewVersion || 0) || this._destroyed) return;
      if (!await this.requirePrivate('查看聊天') || !this.canUsePrivate()) return;
      if (version !== (this._viewVersion || 0) || this._destroyed) return;
      this.setData({ title: this._title || '在线咨询', messages: result.data.slice().reverse(), hasMore: result.hasMore });
      await api.markRead(this.id);
    } catch (error) {
      if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ error: error.message });
    } finally { if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ loading: false }); }
  },
  async more() {
    if (this.data.loading || !this.data.hasMore) return;
    if (!await this.requirePrivate('查看聊天记录') || !this.canUsePrivate()) return;
    if (this.data.loading || !this.data.hasMore) return;
    const version = this._viewVersion || 0;
    this.setData({ loading: true, loadMoreError: '' });
    try {
      const first = this.data.messages[0];
      const result = await api.getMessages(this.id, first && first.createdAt);
      if (version !== (this._viewVersion || 0) || this._destroyed) return;
      if (!await this.requirePrivate('查看聊天记录') || !this.canUsePrivate()) return;
      if (version !== (this._viewVersion || 0) || this._destroyed) return;
      this.setData({ messages: result.data.slice().reverse().concat(this.data.messages), hasMore: result.hasMore });
    } catch (error) {
      if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ loadMoreError: error.message });
    } finally { if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ loading: false }); }
  },
  input(event) { this.setData({ text: event.detail.value }); },
  async send() {
    if (this.data.sending || !this.data.text.trim()) return;
    if (!await this.requirePrivate('发送消息') || !this.canUsePrivate()) return;
    if (this.data.sending || !this.data.text.trim()) return;
    const version = this._viewVersion || 0;
    const text = this.data.text;
    this.setData({ sending: true });
    try {
      const result = await api.sendMessage(this.id, text);
      if (version !== (this._viewVersion || 0) || this._destroyed) return;
      if (!await this.requirePrivate('查看聊天') || !this.canUsePrivate()) return;
      if (version !== (this._viewVersion || 0) || this._destroyed) return;
      this.setData({ messages: this.data.messages.concat({ ...result.data, from: 'owner' }), text: this.data.text === text ? '' : this.data.text });
    } catch (error) {
      if (version === (this._viewVersion || 0) && !this._destroyed) wx.showModal({ title: '未发送', content: error.message, showCancel: false });
    } finally { if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ sending: false }); }
  },
  back() { if (getCurrentPages().length > 1) wx.navigateBack(); else wx.switchTab({ url: '/pages/messages/index' }); }
});
