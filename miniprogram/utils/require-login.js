// UI login gate only. Server-side WeChat identity / house permissions remain
// authoritative; a modal or demo profile never grants cloud/device access.
let activePrompt = null;

function canActNow(api, expectedEpoch) {
  try {
    if (!api || typeof api.isAuthenticated !== 'function' || api.isAuthenticated() !== true) return false;
    if (arguments.length > 1) return Number.isSafeInteger(expectedEpoch)
      && typeof api.getLoginEpoch === 'function' && api.getLoginEpoch() === expectedEpoch;
    return true;
  }
  catch (_) { return false; }
}

async function hasLogin(api) {
  if (!api || typeof api.getProfile !== 'function') return false;
  try {
    const profile = await api.getProfile();
    if (!profile || profile.authenticated !== true) return false;
    if (typeof api.isAuthenticated === 'function' && api.isAuthenticated() !== true) return false;
    if (typeof api.isDemo === 'function' && api.isDemo() === true) return true;
    return typeof profile._id === 'string' && profile._id.length > 0
      && profile._id.length <= 256 && !/[\x00-\x20\x7f/\\]/.test(profile._id);
  } catch (_) { return false; }
}

async function requireLogin(api, action = '继续操作') {
  if (await hasLogin(api)) return true;
  if (activePrompt) { await activePrompt; return false; }
  let finish;
  const prompt = new Promise(resolve => { finish = resolve; });
  activePrompt = prompt;
  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    if (activePrompt === prompt) activePrompt = null;
    finish();
  };
  try {
    wx.showModal({
      title: '请先登录', content: `登录后才能${action}。`,
      confirmText: '去登录', cancelText: '暂不登录', confirmColor: '#ff2450',
      success(answer) {
        try {
          if (answer && answer.confirm) wx.switchTab({ url: '/pages/profile/index' });
        } finally { done(); }
      },
      fail: done,
      complete: done,
    });
  } catch (_) { done(); }
  await prompt;
  // Never resume a phone call, submission or upload after login navigation.
  // The user explicitly retries the original operation once logged in.
  return false;
}

module.exports = { hasLogin, requireLogin, canActNow };
