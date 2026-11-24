const api = require('../../services/api');
const { getNavigationLayout } = require('../../utils/layout');
const { requireLogin, hasLogin, canActNow } = require('../../utils/require-login');

const roleAvatars = { property: 0, support: 1, repair: 2, security: 3 };
function normalizeConversation(row, index) {
  const roleIndex = roleAvatars[row.role];
  const fallback = roleIndex === undefined ? '/assets/profile-avatar.png' : `/assets/message-staff-${roleIndex}.png`;
  return {
    ...row,
    id: row.id || row._id || '',
    name: row.name || row.title || '物业会话',
    avatar: row.avatar || fallback,
    lastMessage: typeof row.lastMessage === 'string' ? row.lastMessage : (row.lastMessage && row.lastMessage.content) || '暂无消息',
    unread: Math.max(0, Number(row.unread) || 0),
    time: row.time || '',
    key: row.id || row._id || `conversation-${index}`,
  };
}

Page({
  data: {
    statusBarHeight: 20, navHeight: 44, navSideWidth: 104, demo: false, loading: false, error: '',
    conversations: [], markingRead: false,
    categories: ['物业通知', '工单提醒', '缴费提醒', '访客申请'],
  },
  onLoad() {
    this.setData({ ...getNavigationLayout(), demo: api.isDemo() });
  },
  onResize() { this.setData(getNavigationLayout()); },
  onShow() {
    this._destroyed = false;
    this.clearPrivate();
    this.setData(getNavigationLayout());
    if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ selected: 'messages' });
    return this.loadConversations();
  },
  onHide() { this._viewVersion = (this._viewVersion || 0) + 1; },
  onUnload() { this._destroyed = true; this._viewVersion = (this._viewVersion || 0) + 1; },
  clearPrivate() {
    this._viewVersion = (this._viewVersion || 0) + 1;
    this.setData({ conversations: [], loading: false, markingRead: false, error: '' });
    this.syncUnread();
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
  async onPullDownRefresh() {
    await this.loadConversations();
    wx.stopPullDownRefresh();
  },
  async loadConversations() {
    if (this.data.loading) return;
    const version = this._viewVersion || 0;
    this.setData({ loading: true, error: '' });
    try {
      if (!await this.requirePrivate('查看消息') || !this.canUsePrivate()) return;
      if (version !== (this._viewVersion || 0) || this._destroyed) return;
      const rows = await api.listConversations();
      if (version !== (this._viewVersion || 0) || this._destroyed) return;
      if (!await this.requirePrivate('查看消息') || !this.canUsePrivate()) return;
      if (version !== (this._viewVersion || 0) || this._destroyed) return;
      this.setData({ conversations: (Array.isArray(rows) ? rows : []).map(normalizeConversation) });
      this.syncUnread();
    } catch (err) {
      if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ error: err.message || '消息加载失败，请重试' });
    } finally { if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ loading: false }); }
  },
  syncUnread() {
    const unread = this.data.conversations.reduce((sum, row) => sum + row.unread, 0);
    if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ unread });
  },
  async markAllRead() {
    if (this.data.markingRead || this.data.loading) return;
    if (!await this.requirePrivate('标记消息已读') || !this.canUsePrivate()) return;
    if (this.data.markingRead || this.data.loading) return;
    const version = this._viewVersion || 0;
    if (!this.data.conversations.some(row => row.unread > 0)) {
      wx.showToast({ title: '暂无未读消息', icon: 'none' }); return;
    }
    this.setData({ markingRead: true });
    try {
      await api.markRead();
      if (version !== (this._viewVersion || 0) || this._destroyed) return;
      if (!await this.requirePrivate('查看消息') || !this.canUsePrivate()) return;
      if (version !== (this._viewVersion || 0) || this._destroyed) return;
      this.setData({ conversations: this.data.conversations.map(row => ({ ...row, unread: 0 })) });
      this.syncUnread();
      wx.showToast({ title: this.data.demo ? '演示消息已读' : '已全部标记为已读', icon: 'none' });
    } catch (err) { if (version === (this._viewVersion || 0) && !this._destroyed) wx.showToast({ title: err.message || '标记失败，请重试', icon: 'none' }); }
    finally { if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ markingRead: false }); }
  },
  async openConversation(event) {
    if (!await this.requirePrivate('查看会话') || !this.canUsePrivate()) return;
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(id)}` });
  },
  async openCategory(event) {
    if (!await this.requirePrivate('查看通知分类') || !this.canUsePrivate()) return;
    wx.showModal({ title: event.currentTarget.dataset.title, content: '该分类的独立通知接口尚未接入。下方会话列表可查看物业消息。', showCancel: false, confirmColor: '#ff2450' });
  },
  async selectCommunity() {
    if (!await this.requirePrivate('查看关联物业') || !this.canUsePrivate()) return;
    wx.showModal({ title: '当前物业', content: this.data.demo ? '当前展示设计演示社区，未绑定真实物业。' : '当前为账号关联的物业，暂不支持切换。', showCancel: false, confirmColor: '#ff2450' });
  },
});
