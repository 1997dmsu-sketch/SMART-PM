const api = require('../../services/api');
const { getNavigationLayout } = require('../../utils/layout');
const { hasLogin, requireLogin, canActNow } = require('../../utils/require-login');

// 页面只渲染服务端 getConfig 返回的受信任数据，不持有、不构造房号/日期/审批字段。
const EMPTY_CONFIG = {
  enabled: false,
  configured: false,
  accountEligible: false,
  applicationVersion: '',
  room: {},
  lease: {}
};

// R11 / C2：applyCheckin 返回分类。
// 仅 result === 'auto_approved' 且 applicationId 有效非空才视为「已受理」并可进入人脸登记；
// pending_review / 空 ID / 畸形返回 / 未知状态一律展示既有审核渠道或明确错误，绝不视为成功，
// 也不声称人工审核申请已提交。
const APPLICATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9|._:-]{0,255}$/;

function classifyApplyResult(data) {
  const safe = data && typeof data === 'object' ? data : {};
  if (safe.result === 'auto_approved') {
    const id = safe.applicationId;
    const validId = typeof id === 'string' && id.length > 0 && APPLICATION_ID_PATTERN.test(id);
    if (validId) return { applied: true, reviewRequired: false, reason: '' };
    return { applied: false, reviewRequired: true, reason: '服务返回的入住申请标识无效，未受理自动通过；请走既有审核流程。' };
  }
  if (safe.result === 'pending_review' || safe.reviewRequired === true) {
    return { applied: false, reviewRequired: true, reason: safe.reason || '未自动通过，请走既有审核流程。' };
  }
  return { applied: false, reviewRequired: true, reason: '服务返回异常，未完成测试入住自动通过；请走既有审核流程或稍后重试。' };
}

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
    // applied 只表示「服务端确认 auto_approved 且申请标识有效」，与现场验证无关。
    applied: false,
    // reviewRequired 表示未自动通过，须走既有审核渠道；与 applied 互斥，不显示人脸入口。
    reviewRequired: false,
    reviewReason: '',
    result: null
  },

  onLoad() {
    this.setData(getNavigationLayout());
    this._destroyed = false;
    // 重入锁用独立实例标志，不复用渲染用的 data.loading。
    this._configLoading = false;
    this.loadConfig();
  },

  onShow() {
    return this.loadConfig();
  },

  clearLoginState() {
    this._loginEpoch = (this._loginEpoch || 0) + 1;
    this._loginIdentity = '';
    if (!this._destroyed) this.setData({
      loading: false, error: '请先登录后再查看测试入住。',
      config: { ...EMPTY_CONFIG, room: {}, lease: {} }, eligible: false,
      leaseConfigured: false, ineligibleReason: '请先登录', primaryConfirmed: false,
      submitting: false, applied: false, reviewRequired: false, reviewReason: '', result: null
    });
  },

  async loginGate(action, expected) {
    if (this._destroyed) return null;
    try {
      const requestEpoch = expected ? expected.authEpoch : (typeof api.getLoginEpoch === 'function' ? api.getLoginEpoch() : null);
      const allowed = await hasLogin(api);
      if (this._destroyed) return null;
      if (!allowed) {
        // Clear private snapshots before waiting for a login modal/navigation.
        this.clearLoginState();
        await requireLogin(api, action);
        return null;
      }
      const profile = await api.getProfile();
      if (this._destroyed) return null;
      if (!profile || profile.authenticated !== true) { this.clearLoginState(); return null; }
      const validId = typeof profile._id === 'string' && profile._id.length > 0 && profile._id.length <= 256 && !/[\x00-\x20\x7f/\\]/.test(profile._id);
      const identity = validId ? profile._id : (typeof api.isDemo === 'function' && api.isDemo() === true ? 'explicit-demo-profile' : '');
      if (!identity) { this.clearLoginState(); return null; }
      const epoch = this._loginEpoch || 0;
      if (expected && expected.epoch !== epoch) return null;
      if (expected && expected.identity !== identity) { this.clearLoginState(); return null; }
      if (this._loginIdentity && this._loginIdentity !== identity) this.clearLoginState();
      if (!canActNow(api, requestEpoch)) { this.clearLoginState(); return null; }
      this._loginIdentity = identity;
      return { identity, epoch: this._loginEpoch || 0, authEpoch: requestEpoch };
    } catch (_) { this.clearLoginState(); return null; }
  },

  canContinue(session) {
    if (this._destroyed || !session || session.epoch !== (this._loginEpoch || 0)) return false;
    // No await may separate this final check from the sensitive operation.
    if (!canActNow(api, session.authEpoch)) { this.clearLoginState(); return false; }
    return true;
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
    let session;
    try {
      session = await this.loginGate('查看测试入住');
      if (!session || !this.canContinue(session)) return;
      const response = await api.getCheckinFaceConfig();
      if (!(await this.loginGate('查看测试入住', session)) || !this.canContinue(session)) return;
      const data = response && typeof response === 'object' ? response : {};
      const room = data.room && typeof data.room === 'object' ? data.room : {};
      const lease = data.lease && typeof data.lease === 'object' ? data.lease : {};
      const eligible = data.enabled === true && data.configured === true && data.accountEligible === true;
      const leaseConfigured = lease.status === 'active' && Boolean(lease.startDate && lease.endDate);
      const ineligibleReason = this.buildIneligibleReason(data, lease, leaseConfigured);
      if (this.canContinue(session)) {
        this.setData({
          config: { ...data, room, lease },
          eligible,
          leaseConfigured,
          ineligibleReason,
          loading: false,
          // 重新加载以服务端最新配置为准：撤销的审核结论随新配置作废，用户可重新提交；
          // 服务端会再次独立判定，不会因此放行未通过者。
          reviewRequired: false,
          reviewReason: ''
        });
      }
    } catch (err) {
      if (!session || !(await this.loginGate('查看测试入住', session)) || !this.canContinue(session)) return;
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

  // checkbox-group bindchange 的真实事件：detail.value 为勾选值的数组。
  onPrimaryChange(event) {
    const checked = event && event.detail && Array.isArray(event.detail.value) && event.detail.value.length > 0;
    this.setData({ primaryConfirmed: Boolean(checked) });
  },

  async submit() {
    if (this._submitChecking) return;
    this._submitChecking = true;
    let session;
    try { session = await this.loginGate('提交测试入住申请'); }
    finally { this._submitChecking = false; }
    if (!session || !this.canContinue(session)) return;
    // 本地 busy 锁：重复点击、并发提交都被拒绝；未自动通过或已受理后同样不再提交。
    if (this.data.submitting || this.data.applied || this.data.reviewRequired) return;
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
      if (this._destroyed || !(await this.loginGate('提交测试入住申请', session)) || !this.canContinue(session)) return;
      const decision = classifyApplyResult(result);
      if (decision.applied) {
        this.setData({
          result: result && typeof result === 'object' ? result : {},
          applied: true,
          reviewRequired: false,
          reviewReason: ''
        });
      } else {
        this.setData({
          result: result && typeof result === 'object' ? result : {},
          applied: false,
          reviewRequired: true,
          reviewReason: decision.reason
        });
      }
    } catch (err) {
      if (this._destroyed || !(await this.loginGate('提交测试入住申请', session)) || !this.canContinue(session)) return;
      if (api.isReviewChannelCode(err && err.code)) {
        this.setData({
          applied: false,
          reviewRequired: true,
          reviewReason: (err && err.message) || '未自动通过，请走既有审核流程。'
        });
      } else {
        this.setData({ error: (err && err.message) || '提交失败，请重试' });
      }
    } finally {
      if (!this._destroyed) this.setData({ submitting: false });
    }
  },

  async goFaceEnroll() {
    const session = await this.loginGate('进入人脸登记');
    if (!session || !this.canContinue(session)) return;
    if (this.data.applied !== true) {
      wx.showToast({ title: '测试入住未自动通过，请走既有审核流程', icon: 'none' });
      return;
    }
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
