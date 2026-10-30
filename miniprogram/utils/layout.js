// Native navigation dimensions are pixels, independent of rpx scaling.
function getNavigationLayout() {
  let info = {};
  let capsule;
  try { info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (_) {}
  try { capsule = wx.getMenuButtonBoundingClientRect(); } catch (_) {}
  const width = Number(info.windowWidth) > 0 ? info.windowWidth : 375;
  const statusBarHeight = Number.isFinite(info.statusBarHeight) ? Math.max(0, info.statusBarHeight) : 20;
  const validCapsule = capsule && capsule.width > 0 && capsule.height > 0 && capsule.left > width / 2 && capsule.right <= width && capsule.top >= statusBarHeight;
  const navHeight = validCapsule ? Math.max(44, capsule.height + 2 * (capsule.top - statusBarHeight)) : 44;
  const navSideWidth = validCapsule ? width - capsule.left + 8 : Math.min(104, width * 0.28);
  return { statusBarHeight, navHeight, navSideWidth };
}
module.exports = { getNavigationLayout };
