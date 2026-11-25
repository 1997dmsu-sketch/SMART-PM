const api = require('../../services/api');
const { getNavigationLayout } = require('../../utils/layout');
const { hasLogin, requireLogin, canActNow } = require('../../utils/require-login');

// 六态文案映射（严格按方案 §2.3 / §6）。
// ready 与 pending-site 一律显示「待现场刷脸验证」，绝不呈现任何现场识别结论。
// FAILED_REVIEW 与 UNKNOWN_RESULT 分开呈现：失败待核 vs 结果待核，二者都不自动重发。
const STATUS_VIEW = {
  NO_TASK: { key: 'no-task', label: '尚未上传照片', tone: 'neutral', hint: '请先确认照片用途，再上传本人照片。' },
  // 云函数 getMyTask 对尚无任务返回 NOT_FOUND；与 NO_TASK 等价，必须允许上传。
  NOT_FOUND: { key: 'no-task', label: '尚未上传照片', tone: 'neutral', hint: '请先确认照片用途，再上传本人照片。' },
  PHOTO_RECEIVED: { key: 'photo-received', label: '照片收件', tone: 'neutral', hint: '照片已上传并由平台收件；此时并未下发给设备。' },
  QUEUED_FOR_DISPATCH: { key: 'queued', label: '等待下发', tone: 'neutral', hint: '登记任务已入队，等待本地受控执行器领取。' },
  CLAIMED: { key: 'processing', label: '设备处理中', tone: 'progress', hint: '执行器已领取任务，正在设备侧办理。' },
  DEVICE_PROCESSING: { key: 'processing', label: '设备处理中', tone: 'progress', hint: '设备侧正在办理，结果尚未确认。' },
  DEVICE_CONFIRMED: { key: 'confirmed', label: '设备查询已确认', tone: 'progress', hint: '设备侧关联已确认，仍需本人到现场刷脸验证。', showSite: true },
  PENDING_SITE_VERIFICATION: { key: 'site', label: '待现场刷脸验证', tone: 'site', hint: '设备登记已完成，等待本人现场刷脸；本页不显示识别结果。', showSite: true },
  FAILED_REVIEW: { key: 'failed', label: '失败，待人工核查', tone: 'fail', hint: '设备登记未成功，任务与人员记录保留，不会自动重发。' },
  UNKNOWN_RESULT: { key: 'unknown', label: '结果待核', tone: 'review', hint: '设备执行结果未知，保留已有事实，不换人员号、不重发。' },
  INVALIDATED: { key: 'invalidated', label: '已失效，待人工核查', tone: 'review', hint: '配置或租期在派发前后发生变化，任务已失效，不会自动重发。' }
};

const SITE_VIEW = {
  key: 'site',
  label: '待现场刷脸验证',
  tone: 'site',
  hint: '设备查询已确认（ready 或 pending-site），仍须本人到现场门禁刷脸；本页不呈现现场识别结论。',
  showSite: true
};

const UNRECOGNIZED_VIEW = {
  key: 'unknown',
  label: '结果待核',
  tone: 'review',
  hint: '服务端返回的状态暂未识别，按结果待核处理，不会自动重发。'
};

function resolveTaskView(task) {
  if (!task || !task.status) return Object.assign({}, STATUS_VIEW.NO_TASK);
  const siteVerification = String(task.siteVerification || '').toLowerCase().replace(/_/g, '-');
  if (siteVerification === 'ready' || siteVerification === 'pending-site') return Object.assign({}, SITE_VIEW);
  const status = String(task.status).toUpperCase();
  return Object.assign({}, STATUS_VIEW[status] || UNRECOGNIZED_VIEW);
}

function choosePhoto() {
  return new Promise((resolve, reject) => {
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: resolve,
        fail: reject
      });
      return;
    }
    wx.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'], success: resolve, fail: reject });
  });
}

function extractFilePath(response) {
  if (!response) return '';
  if (Array.isArray(response.tempFilePaths) && response.tempFilePaths[0]) return response.tempFilePaths[0];
  if (Array.isArray(response.tempFiles) && response.tempFiles[0]) {
    const first = response.tempFiles[0];
    if (typeof first === 'string') return first;
    return first.tempFilePath || first.path || '';
  }
  return '';
}

// 归一化照片：转 JPEG 并压到 ≤200KiB（云端/下游设备仅接受该规格）。
// 已是合规小 JPEG 时直接用原文件，避免无谓重编码；压缩失败退回原文件，由服务端如实拒绝。
const PHOTO_LIMIT_BYTES = 200 * 1024;
function fileSize(filePath) {
  return new Promise((resolve) => {
    if (!wx.getFileInfo) return resolve(-1);
    wx.getFileInfo({ filePath, success: (r) => resolve(r.size), fail: () => resolve(-1) });
  });
}
function compressPhoto(filePath, quality) {
  return new Promise((resolve) => {
    if (!wx.compressImage) return resolve(filePath);
    wx.compressImage({ src: filePath, quality, success: (r) => resolve(r.tempFilePath), fail: () => resolve(filePath) });
  });
}
async function normalizePhoto(filePath) {
  if (!filePath) return '';
  const size = await fileSize(filePath);
  if (size >= 0 && size <= PHOTO_LIMIT_BYTES) return filePath;
  for (const quality of [60, 40, 20]) {
    const next = await compressPhoto(filePath, quality);
    const nextSize = await fileSize(next);
    if (nextSize >= 0 && nextSize <= PHOTO_LIMIT_BYTES) return next;
    filePath = next;
  }
  return filePath;
}

// 任务不存在/尚未创建的云端码；其余错误按审核渠道码分类走既有审核渠道或明确错误。
const TASK_NOT_FOUND_CODES = ['TASK_NOT_FOUND', 'NO_TASK'];

function hasCurrentEligibility(gate) {
  return !!gate && gate.enabled === true && gate.configured === true
    && gate.accountEligible === true && gate.storageNamespaceConfigured !== false;
}

function unavailableReviewReason(gate) {
  return gate && gate.accountEligible === false
    ? '当前账号不在测试名单，请走既有审核流程。'
    : '测试自动通过当前不可用，请走既有审核流程。';
}

Page({
  data: {
    statusBarHeight: 20,
    navHeight: 44,
    navSideWidth: 104,
    loading: true,
    error: '',
    // task 完全来自服务端 getFaceTask / createFaceTask 的返回，只读展示。
    task: { room: {}, lease: {} },
    taskView: STATUS_VIEW.NO_TASK,
    projectBuilding: '—',
    leaseText: '待配置',
    consentConfirmed: false,
    uploading: false,
    cloudPathReady: false,
    showUpload: true,
    canUpload: false,
    // reviewRequired：申请/账号不在自动通过路径（含页面加载后被撤销），
    // 展示既有审核渠道且关闭上传卡片；绝不显示成功或人脸入口。
    reviewRequired: false,
    reviewReason: ''
  },

  async onLoad(options) {
    this.setData(getNavigationLayout());
    this._destroyed = false;
    this._fetching = false;
    this._timer = null;
    this._applicationId = '';
    const session = await this.loginGate('查看人脸登记');
    if (!session || !this.canContinue(session)) return;
    const app = getApp();
    // 微信 navigateTo 不自动解码查询参数：checkin 页用 encodeURIComponent 传递 applicationId，
    // 这里需 decodeURIComponent 还原（含 | 的编码值），否则校验失败。
    let applicationId = (options && options.applicationId) || (app && app.globalData && app.globalData.checkinApplicationId) || '';
    try { applicationId = decodeURIComponent(applicationId); } catch (_) { /* 非编码值保持原样 */ }
    this._applicationId = String(applicationId);
    if (!this._applicationId) {
      this.setData({ loading: false, error: '缺少入住申请标识，请先完成测试入住。' });
      return;
    }
    await this.refreshTask();
    if (!(await this.loginGate('查看人脸登记', session)) || !this.canContinue(session)) return;
    // 轮询只读 getFaceTask，绝不自动重发 createFaceTask。
    this._timer = setInterval(() => this.refreshTask(), 5000);
  },

  onShow() {
    if (this._applicationId) return this.refreshTask();
  },

  clearLoginState() {
    this._loginEpoch = (this._loginEpoch || 0) + 1;
    this._loginIdentity = '';
    this._applicationId = '';
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (!this._destroyed) this.setData({
      loading: false, error: '请先登录后再查看人脸登记。',
      task: { room: {}, lease: {} }, taskView: STATUS_VIEW.NO_TASK,
      projectBuilding: '—', leaseText: '待配置', consentConfirmed: false,
      uploading: false, cloudPathReady: false, showUpload: false, canUpload: false,
      reviewRequired: false, reviewReason: ''
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
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  onPullDownRefresh() {
    this.refreshTask().finally(() => wx.stopPullDownRefresh());
  },

  toReviewRequired(message) {
    if (!canActNow(api)) { this.clearLoginState(); return; }
    this.setData({
      reviewRequired: true,
      reviewReason: String(message || '当前申请未通过测试自动审批，请走既有审核流程。'),
      showUpload: false,
      cloudPathReady: false,
      error: '',
      loading: false
    }, () => this.refreshCanUpload());
  },

  async refreshTask() {
    if (this._destroyed || this._fetching) return;
    this._fetching = true;
    let session;
    try {
      session = await this.loginGate('查询人脸登记状态');
      if (!session || !this.canContinue(session)) return;
      if (!this._applicationId) { this.setData({ loading: false, error: '缺少入住申请标识，请先完成测试入住。' }); return; }
      const response = await api.getFaceTask(this._applicationId);
      if (!(await this.loginGate('查询人脸登记状态', session)) || !this.canContinue(session)) return;
      const result = response && typeof response === 'object' ? response : {};
      const task = result.task && typeof result.task === 'object' ? result.task : result;
      if (this._destroyed) return;
      // 查询旧申请/任务不等于重新取得自动审批资格。审核态保持锁存，只有当前申请
      // 的服务端查询通过，并重新确认当前配置/名单资格，才可恢复上传入口。
      if (this.data.reviewRequired) {
        if (task.uploadEligible !== true) {
          this.toReviewRequired('当前申请的登记资格尚未确认，请重新查询或走既有审核流程。');
          this.applyTask(task);
          return;
        }
        const gate = await api.getCheckinFaceConfig();
        if (this._destroyed || !(await this.loginGate('查询人脸登记状态', session)) || !this.canContinue(session)) return;
        if (!hasCurrentEligibility(gate)) {
          this.toReviewRequired(unavailableReviewReason(gate));
          this.applyTask(task);
          return;
        }
        this.setData({ reviewRequired: false, reviewReason: '' });
      }
      if (!this._destroyed) this.applyTask(task);
    } catch (err) {
      if (this._destroyed || !session || !(await this.loginGate('查询人脸登记状态', session)) || !this.canContinue(session)) return;
      const message = String((err && err.message) || '');
      const code = String((err && err.code) || '');
      // 按错误码精确分类，不再用文案猜状态（APPLICATION_FORBIDDEN 的文案同样含「未找到」）。
      if (api.isReviewChannelCode(err && err.code)) {
        this.toReviewRequired(message);
      } else if (TASK_NOT_FOUND_CODES.indexOf(code) !== -1 || /TASK_NOT_FOUND|NO_TASK|尚未创建|暂无任务/.test(message)) {
        // 首次进入尚无任务属于正常状态，仍展示服务端下发的 cloudPath 供上传。
        this.applyTask(null);
      } else {
        this.setData({ error: message || '状态查询失败，请重试', loading: false });
      }
    } finally {
      this._fetching = false;
    }
  },

  applyTask(task) {
    if (!canActNow(api)) { this.clearLoginState(); return; }
    const safe = task && typeof task === 'object' ? task : {};
    const room = safe.room && typeof safe.room === 'object' ? safe.room : {};
    const lease = safe.lease && typeof safe.lease === 'object' ? safe.lease : {};
    const projectName = room.projectName || room.project || room.projectId || '';
    const buildingName = room.buildingName || room.building || room.buildingId || '';
    const projectBuilding = [projectName, buildingName].filter(Boolean).join(' / ') || '—';
    const leaseText = lease.startDate && lease.endDate ? `${lease.startDate} 至 ${lease.endDate}` : '待配置';
    const view = resolveTaskView(safe);
    // 缺字段不兼容放行：该标记只能由服务端当前申请资格复核产生，旧 cloudPath
    // 或可查询的历史记录不能替代。终态仍可显示事实，但不产生上传资格。
    if (view.key === 'no-task' && safe.uploadEligible !== true && !this.data.reviewRequired) {
      this.toReviewRequired('当前申请的登记资格尚未确认，请重新查询或走既有审核流程。');
    }
    const reviewRequired = this.data.reviewRequired === true;
    const showUpload = view.key === 'no-task' && safe.uploadEligible === true && !reviewRequired;
    this.setData({
      task: Object.assign({ room: {}, lease: {} }, safe, { room, lease }),
      taskView: view,
      projectBuilding,
      leaseText,
      cloudPathReady: Boolean(safe.cloudPath) && !reviewRequired,
      showUpload,
      // 这里只更新显示数据；不得以旧 NOT_FOUND/cloudPath 清除审核态。
      loading: false
    }, () => this.refreshCanUpload());
  },

  refreshCanUpload() {
    if (!canActNow(api)) { this.clearLoginState(); return; }
    const canUpload = this.data.showUpload && this.data.consentConfirmed && this.data.cloudPathReady
      && !this.data.uploading && !this.data.reviewRequired;
    if (this.data.canUpload !== canUpload) this.setData({ canUpload });
  },

  // checkbox-group bindchange 的真实事件：detail.value 为勾选值的数组。
  onConsentChange(event) {
    const checked = event && event.detail && Array.isArray(event.detail.value) && event.detail.value.length > 0;
    this.setData({ consentConfirmed: Boolean(checked) }, () => this.refreshCanUpload());
  },

  async chooseAndUpload() {
    if (this._uploadChecking) return;
    this._uploadChecking = true;
    let session;
    try { session = await this.loginGate('选择照片并上传人脸'); }
    finally { this._uploadChecking = false; }
    if (!session || !this.canContinue(session)) return;
    if (this.data.uploading) return;
    if (this.data.reviewRequired) {
      wx.showToast({ title: '当前申请未通过测试自动审批，请走既有审核流程', icon: 'none' });
      return;
    }
    if (!this.data.consentConfirmed) {
      wx.showToast({ title: '请先确认照片用途', icon: 'none' });
      return;
    }
    if (!this.data.showUpload) {
      wx.showToast({ title: '该申请已提交照片，不会重复建立登记任务', icon: 'none' });
      return;
    }
    // 上传路径必须由服务端下发，页面不拼接、不猜测。
    const cloudPath = this.data.task.cloudPath;
    if (!cloudPath) {
      wx.showToast({ title: '上传路径待服务端下发，请稍后重试', icon: 'none' });
      return;
    }
    this.setData({ uploading: true, error: '' }, () => this.refreshCanUpload());
    try {
      // 上传前资格复核：名单可能在页面加载后被撤销。以服务端最新 getConfig 为准，
      // 未通过者在此处被拦下——零照片上传、零 createFaceTask、零可用人脸入口。
      // 按 A 路接口清单（INTERFACES.md §1.2）：storageNamespaceConfigured 为服务端
      // 新下发字段；setSwitch(true) 前置要求命名空间已配置，此处显式失败关闭
      // （仅 false 阻断，旧服务端缺字段不误伤）。
      const gate = await api.getCheckinFaceConfig();
      if (!(await this.loginGate('选择照片并上传人脸', session)) || !this.canContinue(session)) return;
      if (!hasCurrentEligibility(gate)) {
        if (!this._destroyed) this.toReviewRequired(unavailableReviewReason(gate));
        return;
      }
      if (!this.canContinue(session)) return;
      const picked = await choosePhoto();
      if (!(await this.loginGate('上传人脸照片', session)) || !this.canContinue(session)) return;
      const filePath = await normalizePhoto(extractFilePath(picked));
      if (!filePath) throw new Error('未选择有效照片');
      if (!this.canContinue(session)) return;
      const fileId = await api.uploadTestFace({
        applicationId: this._applicationId,
        cloudPath,
        filePath
      });
      if (!(await this.loginGate('提交人脸登记任务', session)) || !this.canContinue(session)) return;
      if (!fileId) throw new Error('上传未返回文件标识');
      try {
        // 仅在本人勾选 + 主动选图成功后建任务一次；上传成功不代表现场验证完成。
        if (!this.canContinue(session)) return;
        await api.createFaceTask({
          applicationId: this._applicationId,
          fileId,
          consent: true
        });
        if (!(await this.loginGate('查询人脸登记状态', session)) || !this.canContinue(session)) return;
      } catch (taskErr) {
        if (!(await this.loginGate('提交人脸登记任务', session)) || !this.canContinue(session)) return;
        // 服务端在创建任务时复核名单/开关/租期：拒绝即转入审核渠道态，不显示成功。
        if (api.isReviewChannelCode(taskErr && taskErr.code)) {
          if (!this._destroyed) {
            this.toReviewRequired(String((taskErr && taskErr.message) || '当前申请未通过测试自动审批，请走既有审核流程。'));
          }
          return;
        }
        throw taskErr;
      }
      await this.refreshTask();
    } catch (err) {
      if (!(await this.loginGate('上传人脸照片', session)) || !this.canContinue(session)) return;
      const message = String((err && err.message) || '');
      if (!/cancel|取消/i.test(message) && !this._destroyed) {
        this.setData({ error: message || '上传失败，请重试' });
      }
    } finally {
      if (!this._destroyed) this.setData({ uploading: false }, () => this.refreshCanUpload());
    }
  },

  retry() {
    this.setData({ error: '' });
    return this.refreshTask();
  },

  back() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/profile/index' }) });
  }
});
