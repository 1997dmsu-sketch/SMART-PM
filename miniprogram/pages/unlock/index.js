const api = require('../../services/api');
const { requireLogin, hasLogin, canActNow } = require('../../utils/require-login');
const SIGNED_PENDING = ['requesting', 'queued', 'claimed', 'executing', 'unknown'];
const SIGNED_STATUS = {
  requesting: ['正在提交', '本次只提交一次，请等待结果。'],
  queued: ['指令已排队', '尚未确认设备接收；可手动查询结果，请勿重复开门。'],
  claimed: ['指令待执行', '尚未确认设备接收；可手动查询结果，请勿重复开门。'],
  executing: ['指令执行中', '尚未确认设备接收；可手动查询结果，请勿重复开门。'],
  unknown: ['开门结果未知', '请联系管理员核查，本页不会自动重试或补发开门。'],
  device_confirmed: ['设备已接受指令', '设备回执不代表门锁已释放，请现场确认。'],
  failed: ['指令未完成', '本次请求已结束；没有现场开门成功结论。'],
  expired: ['请求已过期', '本次请求已结束；没有现场开门成功结论。'],
  denied: ['请求未获执行', '请刷新核对合同租期与门禁资格。'],
};
let signedRequestSequence = 0;
function signedView(value) {
  const status = value && Object.prototype.hasOwnProperty.call(SIGNED_STATUS, value.status) ? value.status : 'unknown';
  const hint = status === 'unknown' && value && value.resolved === true
    ? '先前结果仍未知，人工核查已记录；再次操作将发送新指令。' : SIGNED_STATUS[status][1];
  return { ...(value || {}), status, label: SIGNED_STATUS[status][0], hint };
}
function signedBlocked(value) { return value && SIGNED_PENDING.includes(value.status) && !(value.status === 'unknown' && value.resolved === true); }
function signedDoor(lock) { return lock && lock.platform === 'hikvision' && lock.authorizationSource === 'signed_lease'; }

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
    signedRemoteEnabled: false,
    signedOpen: null,
    signedResultLoading: false,
  },
  onLoad(options) {
    this._destroyed = false;
    this._signedVisible = true;
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      demo: api.isDemo(),
      signedRemoteEnabled: typeof api.isSignedLeaseRemoteEnabled === 'function' && api.isSignedLeaseRemoteEnabled(),
      community: api.isDemo() ? '幸福花园 · A栋2单元' : '我的房屋',
    });
    const loading = this.load();
    if (options && options.family === '1') this.openFamily();
    return loading;
  },
  onShow() {
    this._destroyed = false;
    this._signedVisible = true;
    this.clearPrivate();
    const tab = this.getTabBar && this.getTabBar();
    if (tab) tab.setData({ selected: 'unlock' });
    const app = getApp();
    if (app.globalData.openFamily) {
      app.globalData.openFamily = false;
      this.openFamily();
    }
    return this.load();
  },
  clearPrivate() {
    this.releaseUnlockOperation(this._unlockOperation);
    this._viewVersion = (this._viewVersion || 0) + 1;
    const epoch = typeof api.getLoginEpoch === 'function' ? api.getLoginEpoch() : null;
    if (epoch === null || epoch !== this._signedOpenEpoch) this._signedOpenState = null;
    this.setData({ locks: [], records: [], family: [], address: '', community: '我的房屋',
      loading: false, familyLoading: false, familyError: '', error: '', recordsError: '', pendingId: '', confirming: false, showAllRecords: false,
      signedOpen: this._signedOpenState || null, signedResultLoading: false,
      signedRemoteEnabled: typeof api.isSignedLeaseRemoteEnabled === 'function' && api.isSignedLeaseRemoteEnabled() });
    this.closeFamily();
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
  canShowSigned(epoch) {
    return this._signedVisible === true && !this._destroyed && this._signedOpenEpoch === epoch && canActNow(api, epoch);
  },
  syncSignedOpen(epoch) {
    if (this.canShowSigned(epoch)) this.setData({ signedOpen: this._signedOpenState || null });
  },
  isUnlockOperationCurrent(operation) {
    return operation && this._unlockOperation === operation && !this._destroyed
      && operation.version === (this._viewVersion || 0) && canActNow(api, operation.epoch);
  },
  releaseUnlockOperation(operation) {
    if (!operation || this._unlockOperation !== operation) return;
    this._unlockOperation = null;
    if (!this._destroyed) this.setData({ confirming: false, pendingId: '' });
  },
  async load() {
    if (this.data.loading) return;
    const version = this._viewVersion || 0;
    this.setData({ loading: true, error: '', recordsError: '' });
    if (!await this.requirePrivate('查看门锁与开门记录') || !this.canUsePrivate()) { wx.stopPullDownRefresh(); return; }
    if (version !== (this._viewVersion || 0) || this._destroyed) return;
    await Promise.all([
      api.listLocks().then(async locks => {
        if (version !== (this._viewVersion || 0) || this._destroyed) return;
        if (!await this.requirePrivate('查看门锁') || !this.canUsePrivate()) return;
        if (version !== (this._viewVersion || 0) || this._destroyed) return;
        this.setData({ locks: locks || [], address: (locks && locks[0] && locks[0].address) || '' });
      }).catch(err => { if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ locks: [], error: err.message || '门锁加载失败，请重试' }); }),
      api.listUnlockRecords().then(async records => {
        if (version !== (this._viewVersion || 0) || this._destroyed) return;
        if (!await this.requirePrivate('查看开门记录') || !this.canUsePrivate()) return;
        if (version !== (this._viewVersion || 0) || this._destroyed) return;
        this.setData({ records: (records || []).map(record => ({
          ...record,
          successful: record.status === '成功' || record.status === 'success',
        })) });
      }).catch(err => { if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ records: [], recordsError: err.message || '记录暂时无法读取' }); }),
    ]);
    if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ loading: false });
    wx.stopPullDownRefresh();
  },
  onPullDownRefresh() { return this.load(); },
  refresh() { return this.load(); },
  async showRecords() { if (await this.requirePrivate('查看开门记录') && this.canUsePrivate()) this.setData({ showAllRecords: !this.data.showAllRecords }); },
  async primaryUnlock() {
    if (!await this.requirePrivate('远程开门') || !this.canUsePrivate()) return;
    const loginEpoch = typeof api.getLoginEpoch === 'function' ? api.getLoginEpoch() : null;
    if (!this.canUsePrivate(loginEpoch)) return;
    if (!this.data.locks.length) {
      wx.showToast({ title: '暂无可操作门锁', icon: 'none' });
      return;
    }
    if (this.data.locks.length === 1) {
      return this.requestUnlock(this.data.locks[0], loginEpoch);
    }
    wx.showActionSheet({
      itemList: this.data.locks.slice(0, 6).map(lock => lock.name),
      success: result => { if (this.canUsePrivate(loginEpoch)) return this.requestUnlock(this.data.locks[result.tapIndex], loginEpoch); },
    });
  },
  async onUnlock(event) {
    if (!await this.requirePrivate('远程开门') || !this.canUsePrivate()) return;
    const loginEpoch = typeof api.getLoginEpoch === 'function' ? api.getLoginEpoch() : null;
    if (!this.canUsePrivate(loginEpoch)) return;
    const lock = this.data.locks.find(item => String(item.id) === String(event.currentTarget.dataset.id));
    if (lock) return this.requestUnlock(lock, loginEpoch);
  },
  async requestUnlock(lock, expectedEpoch) {
    const loginEpoch = expectedEpoch === undefined
      ? (typeof api.getLoginEpoch === 'function' ? api.getLoginEpoch() : null) : expectedEpoch;
    if (this._unlockOperation || this.data.pendingId || this.data.confirming) return;
    const operation = { epoch: loginEpoch, version: this._viewVersion || 0, callbackStarted: false };
    this._unlockOperation = operation;
    let authenticated;
    try { authenticated = await this.requirePrivate('远程开门'); }
    catch (_) { this.releaseUnlockOperation(operation); return; }
    if (!authenticated || !this.canUsePrivate(loginEpoch) || !this.isUnlockOperationCurrent(operation)
      || this.data.pendingId || this.data.confirming) { this.releaseUnlockOperation(operation); return; }
    if (signedDoor(lock)) {
      if (!lock.canOpen) { this.releaseUnlockOperation(operation); wx.showToast({ title: lock.status || '当前合同门禁不可用', icon: 'none' }); return; }
      if (signedBlocked(this.data.signedOpen)) {
        this.releaseUnlockOperation(operation);
        wx.showToast({ title: '请先核查上次开门结果', icon: 'none' }); return;
      }
    }
    if (api.isDemo()) {
      this.releaseUnlockOperation(operation);
      wx.showModal({ title: '当前为设计演示', content: '演示门锁不会发出开门指令。连接云环境并完成住户授权后，才能操作真实设备。', showCancel: false });
      return;
    }
    this.setData({ confirming: true });
    const version = operation.version;
    try { wx.showModal({
      title: '确认远程开门',
      content: `确认打开“${lock.name}”吗？请确认门前情况。`,
      confirmText: '确认开门',
      confirmColor: '#ff2148',
      success: async result => {
        if (operation.callbackStarted) return;
        if (!this.isUnlockOperationCurrent(operation)) { this.releaseUnlockOperation(operation); return; }
        operation.callbackStarted = true;
        if (!result.confirm) { this.releaseUnlockOperation(operation); return; }
        try {
          if (!await this.requirePrivate('远程开门') || !this.canUsePrivate(loginEpoch)) return;
          if (!this.isUnlockOperationCurrent(operation) || this.data.pendingId
            || (signedDoor(lock) && (!lock.canOpen || signedBlocked(this.data.signedOpen)))) return;
          this.setData({ confirming: false, pendingId: String(lock.id) });
          if (signedDoor(lock)) {
            const requestId = `wx_${Date.now().toString(36)}_${(++signedRequestSequence).toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
            this._signedOpenEpoch = loginEpoch;
            this._signedOpenState = signedView({ contractId: lock.contractId, requestId, status: 'requesting' });
            this.setData({ signedOpen: this._signedOpenState });
            try {
              const receipt = await api.requestOpen({ contractId: lock.contractId, requestId });
              if (!this.canUsePrivate(loginEpoch)) return;
              if (this._signedOpenEpoch !== loginEpoch || !this._signedOpenState || this._signedOpenState.requestId !== requestId) return;
              this._signedOpenState = signedView({ ...this._signedOpenState, ...receipt });
            } catch (error) {
              if (!this.canUsePrivate(loginEpoch)) return;
              if (this._signedOpenEpoch !== loginEpoch || !this._signedOpenState || this._signedOpenState.requestId !== requestId) return;
              const notSubmitted = ['DEVICE_OPERATIONS_DISABLED', 'SIGNED_REMOTE_DISABLED', 'SIGNED_OPEN_PENDING',
                'INVALID_INPUT', 'AUTH_FAILED', 'IDENTITY_UNVERIFIED', 'ACCESS_REVOKED', 'ACCESS_UNVERIFIED',
                'BINDING_DISABLED', 'PROGRAM_DISABLED', 'LEASE_NOT_STARTED', 'LEASE_EXPIRED'].includes(error && error.code);
              this._signedOpenState = signedView({ ...this._signedOpenState, status: notSubmitted ? 'denied' : 'unknown' });
            }
            this.syncSignedOpen(loginEpoch);
            return;
          }
          const response = await api.unlockDevice(lock);
          if (version !== (this._viewVersion || 0) || this._destroyed) return;
          if (!await this.requirePrivate('查看开门结果') || !this.canUsePrivate(loginEpoch)) return;
          if (version !== (this._viewVersion || 0) || this._destroyed) return;
          wx.showModal({ title: '指令已提交', content: (response && response.message) || '请确认门锁实际响应。', showCancel: false });
          await this.load();
        } catch (err) {
          if (version === (this._viewVersion || 0) && !this._destroyed) wx.showModal({ title: '开门未完成', content: err.message || '设备未响应，请重试或联系物业。', showCancel: false });
        } finally {
          this.releaseUnlockOperation(operation);
        }
      },
      fail: () => { if (!operation.callbackStarted) this.releaseUnlockOperation(operation); },
    }); } catch (_) { this.releaseUnlockOperation(operation); }
  },
  async querySignedOpen() {
    if (this.data.signedResultLoading || !this.data.signedOpen || !this.data.signedOpen.taskId) return;
    if (!await this.requirePrivate('查询开门结果') || !this.canUsePrivate(this._signedOpenEpoch)) return;
    if (this.data.signedResultLoading || !this.data.signedOpen || !this.data.signedOpen.taskId) return;
    const epoch = this._signedOpenEpoch;
    const taskId = this.data.signedOpen.taskId;
    const requestId = this._signedOpenState && this._signedOpenState.requestId;
    const query = this._signedQuerySequence = (this._signedQuerySequence || 0) + 1;
    this.setData({ signedResultLoading: true });
    try {
      const receipt = await api.getOpenResult({ taskId });
      if (!this.canUsePrivate(epoch)) return;
      if (query !== this._signedQuerySequence || !this._signedOpenState
        || this._signedOpenState.taskId !== taskId || this._signedOpenState.requestId !== requestId) return;
      this._signedOpenState = signedView({ ...this._signedOpenState, ...receipt });
      this.syncSignedOpen(epoch);
    } catch (error) {
      if (!this.canUsePrivate(epoch)) return;
      if (query !== this._signedQuerySequence || !this._signedOpenState
        || this._signedOpenState.taskId !== taskId || this._signedOpenState.requestId !== requestId) return;
      if (this.canShowSigned(epoch)) wx.showModal({
        title: '结果暂时无法查询', content: '请稍后手动查询或联系管理员核查，请勿重新提交开门。', showCancel: false,
      });
    } finally {
      if (query === this._signedQuerySequence && this.canShowSigned(epoch)) this.setData({ signedResultLoading: false });
    }
  },
  async openFamily() {
    if (!await this.requirePrivate('查看家庭成员') || !this.canUsePrivate()) return;
    if (this.data.familyLoading) return;
    const version = this._viewVersion || 0;
    this.setData({ familyOpen: true, familyLoading: true, familyError: '' });
    const tab = this.getTabBar && this.getTabBar();
    if (tab) tab.setData({ modalOpen: true });
    try {
      const family = await api.listFamily();
      if (version !== (this._viewVersion || 0) || this._destroyed) return;
      if (!await this.requirePrivate('查看家庭成员') || !this.canUsePrivate()) return;
      if (version !== (this._viewVersion || 0) || this._destroyed) return;
      this.setData({ family: family || [] });
    } catch (err) {
      if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ family: [], familyError: err.message || '暂时无法读取家庭成员' });
    } finally {
      if (version === (this._viewVersion || 0) && !this._destroyed) this.setData({ familyLoading: false });
    }
  },
  closeFamily() {
    this.setData({ familyOpen: false });
    const tab = this.getTabBar && this.getTabBar();
    if (tab) tab.setData({ modalOpen: false });
  },
  onHide() { this._signedVisible = false; this.releaseUnlockOperation(this._unlockOperation); this._viewVersion = (this._viewVersion || 0) + 1; this.closeFamily(); },
  onUnload() { this._signedVisible = false; this._destroyed = true; this.releaseUnlockOperation(this._unlockOperation); this._viewVersion = (this._viewVersion || 0) + 1; },
  stopBubble() {},
  async addFamily() {
    if (!await this.requirePrivate('添加家庭成员') || !this.canUsePrivate()) return;
    wx.showModal({
      title: '家庭成员授权',
      content: '现有后端尚未提供家庭成员添加接口。请联系物业办理，当前页面不会创建成员或授予门锁权限。',
      showCancel: false,
    });
  },
});
