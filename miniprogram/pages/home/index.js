const api = require('../../services/api');
const FOLLOW_KEY = 'smart-pm-followed-posts';
function imageOf(item) {
  return item.cover || item.image || item.coverImage || (item.images && item.images[0]) || '';
}
Page({
  data: {
    statusBarHeight: 20, activeTab: 'discover', searching: false, keyword: '',
    loading: true, error: '', columns: [[], []], isDemo: false, empty: false,
    community: '宇宙智联智慧物业',
  },
  onLoad() {
    this.setData({ statusBarHeight: getApp().globalData.statusBarHeight || 20, isDemo: api.isDemo() });
    this.loadContent();
  },
  onShow() {
    if (this.getTabBar && this.getTabBar()) this.getTabBar().setData({ selected: 'home' });
    if (this.posts) this.applyFilter();
  },
  onPullDownRefresh() { this.loadContent().finally(() => wx.stopPullDownRefresh()); },
  async loadContent() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.listContent('share');
      const list = Array.isArray(result) ? result : (result.data || []);
      this.posts = list.map((item, index) => ({
        id: String(item._id || item.id || `post-${index}`),
        title: item.title || item.name || '社区生活分享',
        cover: imageOf(item),
        author: typeof item.author === 'string' ? item.author : ((item.author && item.author.name) || '社区小管家'),
        avatar: item.avatar || (item.author && item.author.avatar) || '/assets/home-avatar.png',
        likes: Number(item.likes || item.likeCount || 0),
        tags: Array.isArray(item.tags) ? item.tags.slice(0, 3) : [],
        description: item.description || item.content || item.summary || '',
        imageHeight: index % 4 === 1 ? 478 : 398,
        houseId: item.houseId || '',
        vrUrl: typeof item.vrUrl === 'string' && /^https:\/\//.test(item.vrUrl) ? item.vrUrl : '',
      }));
      this.applyFilter();
    } catch (err) {
      this.setData({ error: err.message || '内容加载失败，请稍后重试', columns: [[], []], empty: false });
    } finally { this.setData({ loading: false }); }
  },
  applyFilter() {
    const followed = wx.getStorageSync(FOLLOW_KEY) || [];
    const keyword = this.data.keyword.trim().toLowerCase();
    const posts = (this.posts || []).map(item => ({ ...item, followed: followed.includes(item.id), displayLikes: item.likes + (followed.includes(item.id) ? 1 : 0) }))
      .filter(item => this.data.activeTab !== 'follow' || item.followed)
      .filter(item => !keyword || `${item.title} ${item.author} ${item.tags.join(' ')}`.toLowerCase().includes(keyword));
    this.setData({ columns: [posts.filter((_, i) => i % 2 === 0), posts.filter((_, i) => i % 2 === 1)], empty: !posts.length });
  },
  switchTab(event) { this.setData({ activeTab: event.currentTarget.dataset.tab }); this.applyFilter(); },
  toggleSearch() { this.setData({ searching: !this.data.searching }); if (!this.data.searching) { this.setData({ keyword: '' }); this.applyFilter(); } },
  onSearch(event) { this.setData({ keyword: event.detail.value }); this.applyFilter(); },
  toggleFollow(event) {
    const id = event.currentTarget.dataset.id;
    const followed = wx.getStorageSync(FOLLOW_KEY) || [];
    wx.setStorageSync(FOLLOW_KEY, followed.includes(id) ? followed.filter(item => item !== id) : [...followed, id]);
    this.applyFilter();
  },
  openPost(event) {
    const post = (this.posts || []).find(item => item.id === event.currentTarget.dataset.id);
    if (!post) return;
    if (post.houseId) { wx.navigateTo({ url: `/pages/rental/index?id=${encodeURIComponent(post.houseId)}` }); return; }
    this.setData({ selectedPost: post });
  },
  openVR() {
    const post = this.data.selectedPost;
    if (post && post.vrUrl) wx.navigateTo({url:`/pages/vr/index?id=${encodeURIComponent(post.id)}`});
  },
  closePost() { this.setData({ selectedPost: null }); },
  stopTap() {},
  previewPostImage() {
    const post = this.data.selectedPost;
    if (post && post.cover) wx.previewImage({ current: post.cover, urls: [post.cover] });
  },
  showCommunity() { wx.showModal({ title: this.data.community, content: '社区生活、租房和物业服务，都在这里。', showCancel: false }); },
});
