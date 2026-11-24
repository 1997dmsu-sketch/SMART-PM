const api = require('../../services/api');
const { getNavigationLayout } = require('../../utils/layout');

Page({
  data: {
    statusBarHeight: 20, navHeight: 44, navSideWidth: 104,
    username: '', password: '', submitting: false,
    error: ''
  },
  onLoad() {
    this._visible = true;
    this._attempt = 0;
    this.setData(getNavigationLayout());
  },
  onShow() { this._visible = true; },
  onResize() { this.setData(getNavigationLayout()); },
  onHide() { this.clearPrivateInput(); },
  onUnload() { this.clearPrivateInput(); },
  clearPrivateInput() {
    this._visible = false;
    this._attempt = (this._attempt || 0) + 1;
    api.cancelPasswordLogin();
    this.setData({ password: '', submitting: false });
  },
  onUsernameInput(event) {
    if (!this.data.submitting) this.setData({ username: String(event.detail.value || '') });
  },
  onPasswordInput(event) {
    if (!this.data.submitting) this.setData({ password: String(event.detail.value || '') });
  },
  async submit() {
    if (this.data.submitting) return;
    const attempt = this._attempt = (this._attempt || 0) + 1;
    const username = this.data.username;
    let password = this.data.password;
    // 网络等待期间也不在页面数据/输入框中保留密码。
    this.setData({ password: '', submitting: true, error: '' });
    try {
      await api.loginWithPassword({ username, password });
      if (this._visible && attempt === this._attempt) wx.switchTab({ url: '/pages/profile/index' });
    } catch (error) {
      if (this._visible && attempt === this._attempt) this.setData({ error: error.message || '登录失败，请重试' });
    } finally {
      password = '';
      if (this._visible && attempt === this._attempt) this.setData({ password: '', submitting: false });
    }
  },
  back() {
    this.clearPrivateInput();
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/profile/index' }) });
  }
});
