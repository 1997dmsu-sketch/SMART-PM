const config = require('./config/runtime');
App({
  globalData: { statusBarHeight: 20, openFamily: false },
  onLaunch() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.globalData.statusBarHeight = info.statusBarHeight || 20;
    if (config.mode === 'live' && config.cloudEnv && wx.cloud) {
      wx.cloud.init({ env: config.cloudEnv, traceUser: true });
    }
  }
});
