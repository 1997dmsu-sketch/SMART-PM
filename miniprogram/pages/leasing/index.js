const api = require("../../services/api");
const { getNavigationLayout } = require("../../utils/layout");
const names = {
  submitted: "待物业确认",
  confirmed: "看房已确认",
  rejected: "预约未通过",
  awaiting_payment: "待交押金",
  payment_expired: "支付已超时",
  payment_closed: "支付已关闭",
  paid_held: "已交押金·留房中",
  expired_forfeited: "留房已到期·押金不退",
  expired_review: "留房到期·待物业处理",
  refund_required: "异常到账·请联系物业退款",
  signed: "已完成正式签约",
};
const identityNames = {
  missing: "未提交身份证",
  pending: "身份证审核中",
  approved: "身份证已审核",
  rejected: "身份证需重新提交",
};
const money = (v) => (Number(v || 0) / 100).toFixed(2);
const date = (v) => (v ? new Date(v).toLocaleString() : "");
const requestId = () =>
  Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
Page({
  data: {
    navHeight: 44,
    statusBarHeight: 20,
    authenticated: false,
    loading: false,
    busy: false,
    error: "",
    rooms: [],
    layouts: [],
    layoutIndex: 0,
    roomIndex: 0,
    roomOptions: [],
    visitDate: "",
    visitTime: "",
    today: "",
    contactName: "",
    appointments: [],
    orders: [],
    settings: {},
    privacyConsent: false,
    activeQuote: null,
    contractAccepted: false,
    viewContract: "",
    uploading: false,
  },
  onLoad(options) {
    this.houseId = options.houseId || "";
    this.appointmentRequestId = requestId();
    this.orderRequestId = requestId();
    const n = new Date();
    this.setData({
      ...getNavigationLayout(),
      today: `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`,
    });
    this.load();
  },
  onUnload() {
    this.setData({ activeQuote: null, viewContract: "" });
  },
  back() {
    wx.navigateBack();
  },
  async login(event) {
    if (!event.detail?.code) return;
    this.setData({ busy: true, error: "" });
    try {
      await api.loginWithPhone(event.detail.code);
      await this.load();
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ busy: false });
    }
  },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const user = await api.getProfile();
      this.setData({ authenticated: Boolean(user?.authenticated) });
      if (!user?.authenticated) return;
      const [catalog, mine] = await Promise.all([
        api.leasing("catalog", { houseId: this.houseId }),
        api.leasing("mine"),
      ]);
      const layouts = [];
      catalog.rooms.forEach((r) => {
        if (!layouts.some((l) => l.id === r.layoutId))
          layouts.push({
            id: r.layoutId,
            name: [r.community, r.buildingName, r.layoutName]
              .filter(Boolean)
              .join(" / "),
          });
      });
      this.setData({
        rooms: catalog.rooms,
        layouts,
        settings: catalog.settings,
        privacyConsent: false,
        paymentReady: catalog.paymentReady,
        identityReady: catalog.identityReady,
        layoutIndex: 0,
        roomIndex: 0,
        contactName: this.data.contactName || user.name || "",
        appointments: mine.appointments.map((a) => ({
          ...a,
          statusText: names[a.status],
          identityText: identityNames[a.identityStatus],
          visitText: date(a.visitAt),
        })),
        orders: mine.orders.map((o) => ({
          ...o,
          statusText: names[o.status],
          depositText: money(o.depositCents),
          untilText: date(o.holdUntil),
          deadlineText: date(o.paymentDeadline),
        })),
      });
      this.updateRooms();
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ loading: false });
    }
  },
  updateRooms() {
    const layout = this.data.layouts[this.data.layoutIndex];
    const roomOptions = this.data.rooms
      .filter((r) => r.layoutId === layout?.id)
      .map((r) => ({
        ...r,
        label: `${r.roomNumber} · ¥${money(r.priceCents)}/月${r.available ? "" : " · 已留房"}`,
      }));
    this.setData({ roomOptions, roomIndex: 0 });
  },
  layoutChanged(e) {
    this.setData({ layoutIndex: Number(e.detail.value) });
    this.updateRooms();
  },
  roomChanged(e) {
    this.setData({ roomIndex: Number(e.detail.value) });
  },
  dateChanged(e) {
    this.setData({ visitDate: e.detail.value });
  },
  timeChanged(e) {
    this.setData({ visitTime: e.detail.value });
  },
  nameChanged(e) {
    this.setData({ contactName: e.detail.value });
  },
  privacyChanged(e) {
    this.setData({ privacyConsent: e.detail.value.includes("agree") });
  },
  contractChanged(e) {
    this.setData({ contractAccepted: e.detail.value.includes("agree") });
  },
  async submitAppointment() {
    if (this.data.busy) return;
    const room = this.data.roomOptions[this.data.roomIndex];
    if (!room?.available) {
      this.setData({ error: "请选择可预约的房号" });
      return;
    }
    if (
      !this.data.visitDate ||
      !this.data.visitTime ||
      !this.data.contactName.trim()
    ) {
      this.setData({ error: "请填写联系人及看房日期时间" });
      return;
    }
    const visitAt = new Date(
      `${this.data.visitDate.replace(/-/g, "/")} ${this.data.visitTime}:00`,
    ).getTime();
    this.setData({ busy: true, error: "" });
    try {
      await api.leasing("appointment", {
        houseId: room.houseId,
        roomId: room.roomId,
        name: this.data.contactName,
        visitAt,
        requestId: this.appointmentRequestId,
      });
      this.appointmentRequestId = requestId();
      wx.showToast({ title: "预约已提交" });
      await this.load();
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ busy: false });
    }
  },
  async uploadIdentity(e) {
    if (this.data.uploading) return;
    if (!this.data.privacyConsent) {
      this.setData({ error: "请先阅读并同意身份证收集说明" });
      return;
    }
    const { id, side } = e.currentTarget.dataset;
    const tempPaths = [];
    this.setData({ uploading: true, error: "" });
    try {
      if (wx.requirePrivacyAuthorize)
        await new Promise((resolve, reject) =>
          wx.requirePrivacyAuthorize({ success: resolve, fail: reject }),
        );
      const chosen = await new Promise((resolve, reject) =>
        wx.chooseMedia({
          count: 1,
          mediaType: ["image"],
          sourceType: ["camera", "album"],
          sizeType: ["compressed"],
          success: resolve,
          fail: reject,
        }),
      );
      let path = chosen.tempFiles[0].tempFilePath;
      tempPaths.push(path);
      const compressed = await new Promise((resolve, reject) =>
        wx.compressImage({
          src: path,
          quality: 55,
          compressedWidth: 1280,
          success: resolve,
          fail: reject,
        }),
      );
      path = compressed.tempFilePath;
      tempPaths.push(path);
      const stat = await new Promise((resolve, reject) =>
        wx
          .getFileSystemManager()
          .getFileInfo({ filePath: path, success: resolve, fail: reject }),
      );
      if (stat.size > 500 * 1024)
        throw new Error("图片仍超过 500KB，请裁剪后重试");
      const file = await new Promise((resolve, reject) =>
        wx
          .getFileSystemManager()
          .readFile({
            filePath: path,
            encoding: "base64",
            success: resolve,
            fail: reject,
          }),
      );
      try {
        await api.leasing("uploadIdentity", {
          appointmentId: id,
          side,
          base64: file.data,
          consent: true,
          privacyVersion: this.data.settings.templateVersion,
        });
      } finally {
        file.data = "";
        wx.getFileSystemManager().unlink({ filePath: path, fail: () => {} });
      }
      wx.showToast({ title: "材料已提交" });
      await this.load();
    } catch (error) {
      if (!String(error.errMsg || "").includes("cancel"))
        this.setData({ error: error.message || "材料提交未完成，请重试" });
    } finally {
      for (const filePath of new Set(tempPaths))
        wx.getFileSystemManager().unlink({ filePath, fail: () => {} });
      this.setData({ uploading: false });
    }
  },
  async quote(e) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: "" });
    try {
      const q = await api.leasing("quote", {
        appointmentId: e.currentTarget.dataset.id,
      });
      this.orderRequestId = requestId();
      this.setData({
        activeQuote: { ...q, depositText: money(q.depositCents) },
        contractAccepted: false,
      });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ busy: false });
    }
  },
  closeContract() {
    this.setData({
      activeQuote: null,
      viewContract: "",
      contractAccepted: false,
    });
  },
  viewContract(e) {
    const o = this.data.orders.find((o) => o.id === e.currentTarget.dataset.id);
    if (o) this.setData({ viewContract: o.contractText });
  },
  async createOrder() {
    if (this.data.busy) return;
    if (!this.data.contractAccepted) {
      this.setData({ error: "请阅读并同意预签约合同与押金规则" });
      return;
    }
    this.setData({ busy: true, error: "" });
    try {
      const q = this.data.activeQuote;
      await api.leasing("createOrder", {
        appointmentId: q.appointmentId,
        quoteHash: q.quoteHash,
        requestId: this.orderRequestId,
        accepted: true,
      });
      this.setData({ activeQuote: null });
      await this.load();
      wx.showToast({ title: "订单已创建", icon: "none" });
    } catch (e) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ busy: false });
    }
  },
  async pay(e) {
    if (this.data.busy) return;
    const id = e.currentTarget.dataset.id;
    this.setData({ busy: true, error: "" });
    try {
      const params = await api.leasing("paymentParams", { id });
      await new Promise((resolve, reject) =>
        wx.requestPayment({ ...params, success: resolve, fail: reject }),
      );
      await api.leasing("refreshPayment", { id });
      await this.load();
    } catch (error) {
      this.setData({
        error:
          error.message ||
          "支付未完成或结果待确认，请点击“核对支付状态”，不要重复付款",
      });
    } finally {
      this.setData({ busy: false });
    }
  },
  async refreshPayment(e) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: "" });
    try {
      await api.leasing("refreshPayment", { id: e.currentTarget.dataset.id });
      await this.load();
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ busy: false });
    }
  },
});
