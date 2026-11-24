const api = require('../../services/api');
const { getNavigationLayout } = require('../../utils/layout');

// 页面只渲染服务端 getConfig 返回的受信任数据，不持有、不构造房号/日期/审批字段。
const EMPTY_CONFIG = {
  enabled: false,
  configured: false,
  accountEligible: false,
  applicationVersion: '',
  room: {},
  lease: {}
};

Page({
  data: {
    statusBarHeight: 20,
    navHeight: 44,
    navSideWidth: 104,
    loading: true,
    error: '',
    config: EMPTY_CONFIG,
    // 仅 enabled && configured && accountEligible 全真时，才展示「自动通过」能力。
    eligible: false,
    // 租期由负责人手填并下发；缺失/未激活即为待配置，不填默认日期。
    leaseConfigured: false,
    ineligibleReason: '正在读取服务端配置',
    primaryConfirmed: false,
    submitting: false,
    applied: false,
    result: null
  },

  onLoad() {
    this.setData(getNavigationLayout());
    this._destroyed = false;
    // 重入锁用独立实例标志，不复用渲染用的 data.loading。
    this._configLoading = false;
    this.loadConfig();
  },

  onResize() {
    this.setData(getNavigationLayout());
  },

  onUnload() {
    this._destroyed = true;
  },

  onPullDownRefresh() {
    this.loadConfig().finally(() => wx.stopPullDownRefresh());
  },

  async loadConfig() {
    if (this._configLoading) return;
    this._configLoading = true;
    this.setData({ loading: true, error: '' });
    try {
      const response = await api.getCheckinFaceConfig();
      const data = response && typeof response === 'object' ? response : {};
      const room = data.room && typeof data.room === 'object' ? data.room : {};
      const lease = data.lease && typeof data.lease === 'object' ? data.lease : {};
      const eligible = data.enabled === true && data.configured === true && data.accountEligible === true;
      const leaseConfigured = lease.status === 'active' && Boolean(lease.startDate && lease.endDate);
      const ineligibleReason = this.buildIneligibleReason(data, lease, leaseConfigured);
      if (!this._destroyed) {
        this.setData({
          config: { ...data, room, lease },
          eligible,
          leaseConfigured,
          ineligibleReason,
          loading: false
        });
      }
    } catch (err) {
      if (!this._destroyed) {
        this.setData({
          error: (err && err.message) || '配置加载失败，请重试',
          eligible: false,
          leaseConfigured: false,
          loading: false
        });
      }
    } finally {
      this._configLoading = false;
    }
  },

  buildIneligibleReason(data, lease, leaseConfigured) {
    if (!leaseConfigured) return '租期待配置：负责人填写起止后才会启用，本页不会自行选择日期。';
    if (data.enabled !== true) return '测试开关未开启，当前不提供自动通过。';
    if (data.configured !== true) return '测试配置尚未完成，当前不提供自动通过。';
    if (data.accountEligible !== true) return '当前账号不在测试名单，请走既有审核流程。';
    return '暂不满足自动通过条件。';
  },

  onPrimaryChange(event) {
    const checked = event && event.detail && Array.isArray(event.detail.value) && event.detail.value.length > 0;
    this.setData({ primaryConfirmed: Boolean(checked) });
  },

  async submit() {
    // 本地 busy 锁：重复点击、并发提交都被拒绝。
    if (this.data.submitting || this.data.applied) return;
    if (!this.data.eligible) {
      wx.showToast({ title: '当前未开放测试入住自动通过', icon: 'none' });
      return;
    }
    if (!this.data.leaseConfigured) {
      wx.showToast({ title: '租期待配置，暂不能提交', icon: 'none' });
      return;
    }
    if (!this.data.primaryConfirmed) {
      wx.showToast({ title: '请先确认主入住人信息', icon: 'none' });
      return;
    }
    const applicationVersion = this.data.config.applicationVersion;
    if (!applicationVersion) {
      wx.showToast({ title: '配置版本缺失，请重新加载', icon: 'none' });
      return;
    }
    this.setData({ submitting: true, error: '' });
    try {
      // 唯一允许客户端提交的业务字段，值来自服务端 getConfig。
      const result = await api.applyTestCheckin({ applicationVersion });
      if (!this._destroyed) this.setData({ result: result || {}, applied: true });
    } catch (err) {
      if (!this._destroyed) this.setData({ error: (err && err.message) || '提交失败，请重试' });
    } finally {
      if (!this._destroyed) this.setData({ submitting: false });
    }
  },

  goFaceEnroll() {
    const applicationId = this.data.result && this.data.result.applicationId;
    if (!applicationId) {
      wx.showToast({ title: '缺少入住申请标识，请重新提交', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/face-enroll/index?applicationId=${encodeURIComponent(applicationId)}` });
  },

  back() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/profile/index' }) });
  }
});
