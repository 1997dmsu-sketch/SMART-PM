const api = require('../../services/api');

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
    statusBarHeight: 20, demo: false, loading: false, error: '',
    conversations: [], markingRead: false,
    categories: ['物业通知', '工单提醒', '缴费提醒', '访客申请'],
  },
  onLoad() {
    const app = getApp();
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20, demo: api.isDemo() });
  },
  onShow() {
    if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ selected: 'messages' });
    return this.loadConversations();
  },
  async onPullDownRefresh() {
    await this.loadConversations();
    wx.stopPullDownRefresh();
  },
  async loadConversations() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const rows = await api.listConversations();
      this.setData({ conversations: (Array.isArray(rows) ? rows : []).map(normalizeConversation) });
      this.syncUnread();
    } catch (err) {
      this.setData({ error: err.message || '消息加载失败，请重试' });
    } finally { this.setData({ loading: false }); }
  },
  syncUnread() {
    const unread = this.data.conversations.reduce((sum, row) => sum + row.unread, 0);
    if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ unread });
  },
  async markAllRead() {
    if (this.data.markingRead || this.data.loading) return;
    if (!this.data.conversations.some(row => row.unread > 0)) {
      wx.showToast({ title: '暂无未读消息', icon: 'none' }); return;
    }
    this.setData({ markingRead: true });
    try {
      await api.markRead();
      this.setData({ conversations: this.data.conversations.map(row => ({ ...row, unread: 0 })) });
      this.syncUnread();
      wx.showToast({ title: this.data.demo ? '演示消息已读' : '已全部标记为已读', icon: 'none' });
    } catch (err) { wx.showToast({ title: err.message || '标记失败，请重试', icon: 'none' }); }
    finally { this.setData({ markingRead: false }); }
  },
  openConversation(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(id)}` });
  },
  openCategory(event) {
    wx.showModal({ title: event.currentTarget.dataset.title, content: '该分类的独立通知接口尚未接入。下方会话列表可查看物业消息。', showCancel: false, confirmColor: '#ff2450' });
  },
  selectCommunity() {
    wx.showModal({ title: '当前物业', content: this.data.demo ? '当前展示设计演示社区，未绑定真实物业。' : '当前为账号关联的物业，暂不支持切换。', showCancel: false, confirmColor: '#ff2450' });
  },
});
