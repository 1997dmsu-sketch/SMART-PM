'use strict';

// Actual Page source + actual login helper, with synthetic API/wx only.
// No HTTP listener, cloud SDK, phone call, device action or persistent write.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const HELPER = path.join(ROOT, 'miniprogram/utils/require-login.js');
const USER = { _id: 'synthetic-user', authenticated: true, nickname: '合成住户', houses: [] };
const tap = (id, extra = {}) => ({ currentTarget: { dataset: { id, ...extra } } });
const copy = (value) => value === undefined ? undefined : structuredClone(value);

function fixture(name, { profile = null, confirm = false, demo = false, loginDuringPrompt = false, omitProfileApi = false,
  profileError = false, authoritativeAuth, omitAuthCapability = false } = {}) {
  let currentProfile = copy(profile);
  const calls = { modals: [], navigation: [], storageReads: [], writes: [], sheets: [],
    profile: 0, content: 0, houses: [], phoneLogin: [], logout: 0, preview: [] };
  const storage = new Map([
    ['smart-pm-followed-posts', ['post-one']],
    ['favorites', [{ id: 'house-one', title: '合成收藏' }]],
  ]);
  const app = { globalData: { statusBarHeight: 20, openFamily: false } };
  const api = {
    isDemo: () => demo,
    getProfile: async () => { calls.profile++; if (profileError) throw new Error('synthetic-profile-unavailable'); return copy(currentProfile); },
    listContent: async () => { calls.content++; return [{ _id: 'post-one', title: '公开社区内容', author: '物业',
      cover: 'https://synthetic.invalid/cover.jpg', tags: [], likes: 3, vrUrl: 'https://synthetic.invalid/vr' },
    { _id: 'rental-post', title: '公开房源文章', houseId: 'house-one', tags: [] }]; },
    listHouses: async (query) => { calls.houses.push(copy(query)); return { houses: [{ _id: 'house-one', title: '公开房源',
      price: null, area: null, community: '合成小区', rooms: '单间', tags: [] }], total: 1 }; },
    loginWithPhone: async (code) => { calls.phoneLogin.push(code); currentProfile = copy(USER); },
    logout: async () => { calls.logout++; currentProfile = null; },
  };
  if (omitProfileApi) delete api.getProfile;
  api.isAuthenticated = () => {
    if (authoritativeAuth !== undefined) return authoritativeAuth;
    return Boolean(currentProfile && currentProfile.authenticated === true && (demo
      || (typeof currentProfile._id === 'string' && currentProfile._id.length > 0 && currentProfile._id.length <= 256
        && !/[\x00-\x20\x7f/\\]/.test(currentProfile._id))));
  };
  if (omitAuthCapability) delete api.isAuthenticated;
  const wx = {
    showModal(options) {
      calls.modals.push({ title: options.title, content: options.content, showCancel: options.showCancel });
      if (options.title === '请先登录') {
        if (loginDuringPrompt) currentProfile = copy(USER);
        if (options.success) options.success({ confirm, cancel: !confirm });
        if (options.complete) options.complete();
      }
    },
    navigateTo: ({ url }) => calls.navigation.push({ kind: 'navigateTo', url }),
    switchTab: ({ url }) => calls.navigation.push({ kind: 'switchTab', url }),
    getStorageSync(key) { calls.storageReads.push(key); return copy(storage.get(key)); },
    setStorageSync(key, value) { calls.writes.push({ key, value: copy(value) }); storage.set(key, copy(value)); },
    showActionSheet: (value) => calls.sheets.push(value),
    previewImage: (value) => calls.preview.push(value),
    showToast() {}, stopPullDownRefresh() {},
  };
  // This is the actual shared helper, not a permissive fake requireLogin.
  const helperModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(HELPER, 'utf8'), { module: helperModule, wx }, { filename: HELPER });
  assert.equal(typeof helperModule.exports.requireLogin, 'function');
  assert.equal(typeof helperModule.exports.hasLogin, 'function');
  assert.equal(typeof helperModule.exports.canActNow, 'function');
  const file = path.join(ROOT, 'miniprogram/pages', name, 'index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require(id) {
      if (id === '../../services/api') return api;
      if (id === '../../utils/require-login') return helperModule.exports;
      if (id === '../../utils/layout') return { getNavigationLayout: () => ({ statusBarHeight: 20, navHeight: 44, navSideWidth: 104 }) };
      if (id === '../../config/version') return { version: 'synthetic-review', channel: 'synthetic' };
      if (id === '../../config/runtime') return { checkinFaceTestEntry: true };
      throw new Error('Unexpected page dependency: ' + id);
    },
    Page(value) { definition = value; }, wx, getApp: () => app,
  }, { filename: file });
  const page = { ...definition, data: copy(definition.data), setData(values) {
    for (const [key, value] of Object.entries(values)) {
      const fields = key.split('.');
      let target = this.data;
      for (const field of fields.slice(0, -1)) target = target[field];
      target[fields.at(-1)] = value;
    }
  } };
  return { page, api, calls, storage, app, setProfile(value) { currentProfile = copy(value); } };
}

function assertGuestStopped(f, { loginNavigation = false } = {}) {
  assert.equal(f.calls.modals.length, 1);
  assert.equal(f.calls.modals[0].title, '请先登录');
  assert.deepEqual(f.calls.writes, []);
  assert.deepEqual(f.calls.storageReads, []);
  assert.deepEqual(f.calls.sheets, []);
  assert.deepEqual(f.calls.navigation, loginNavigation ? [{ kind: 'switchTab', url: '/pages/profile/index' }] : []);
  assert.equal(f.app.globalData.openFamily, false);
}

test('游客个人菜单/服务/设置先经过实际helper：取消后无存储访问、业务导航或服务占位提示', async () => {
  const actions = [
    ...['house', 'family', 'access', 'favorite', 'checkinTest', 'coupon'].map((id) => (page) => page.openMenu(tap(id))),
    (page) => page.editProfile(),
    (page) => page.openService(tap('pending', { name: '我的工单' })),
    (page) => page.settings(),
  ];
  for (const action of actions) {
    const f = fixture('profile');
    // Stale page display fields must not replace the authoritative API/helper.
    f.page.data.authenticated = true;
    f.page.data.demo = true;
    await action(f.page);
    assertGuestStopped(f);
    assert.equal(f.page.data.showFavorites, false);
  }
});

test('游客关注写与关注tab先提示登录，取消不读写旧关注缓存或切换个人tab', async () => {
  for (const action of [(page) => page.toggleFollow(tap('post-one')),
    (page) => page.switchTab(tap('', { tab: 'follow' }))]) {
    const f = fixture('home');
    await action(f.page);
    assertGuestStopped(f);
    assert.equal(f.page.data.activeTab, 'discover');
    assert.deepEqual(f.storage.get('smart-pm-followed-posts'), ['post-one']);
  }
});

test('生活非公开服务：未登录先提示，不先展示尚未开通的业务提示', async () => {
  for (const id of ['mall', 'clean', 'neighbor', 'parcel', 'repair']) {
    const f = fixture('life');
    await f.page.chooseService(tap(id));
    assertGuestStopped(f);
  }
});

test('游客确认仅去登录页；即使期间完成登录，也不自动续做原动作', async () => {
  for (const [name, action] of [['profile', (page) => page.openMenu(tap('house'))],
    ['home', (page) => page.toggleFollow(tap('post-one'))],
    ['life', (page) => page.chooseService(tap('repair'))]]) {
    const f = fixture(name, { confirm: true, loginDuringPrompt: true });
    await action(f.page);
    assertGuestStopped(f, { loginNavigation: true });
  }
});

test('已登录个人动作保留原业务：房产/家庭/门禁/测试入住导航、收藏与服务占位、账号设置', async () => {
  for (const [id, expected] of [['house', { kind: 'navigateTo', url: '/pages/property/index' }],
    ['family', { kind: 'switchTab', url: '/pages/unlock/index' }],
    ['access', { kind: 'switchTab', url: '/pages/unlock/index' }],
    ['checkinTest', { kind: 'navigateTo', url: '/pages/checkin/index' }]]) {
    const f = fixture('profile', { profile: USER });
    // The current helper result also handles a stale false display flag.
    f.page.data.authenticated = false;
    await f.page.openMenu(tap(id));
    assert.deepEqual(f.calls.navigation, [expected]);
    assert.equal(f.calls.modals.length, 0);
    assert.equal(f.app.globalData.openFamily, id === 'family');
  }
  const favorite = fixture('profile', { profile: USER });
  await favorite.page.openMenu(tap('favorite'));
  assert.equal(favorite.page.data.showFavorites, true);
  assert.equal(favorite.page.data.favorites[0].id, 'house-one');
  assert.deepEqual(favorite.calls.storageReads, ['favorites']);
  const service = fixture('profile', { profile: USER });
  await service.page.openService(tap('pending', { name: '我的工单' }));
  assert.equal(service.calls.modals[0].title, '我的工单');
  assert.match(service.calls.modals[0].content, /尚未完成接口对接/);
  const settings = fixture('profile', { profile: USER });
  await settings.page.settings();
  assert.equal(settings.calls.sheets.length, 1);
  assert.equal(settings.calls.modals.length, 0);
});

test('登录后主动重试关注可写入；生活服务保持原尚未开放提示', async () => {
  const home = fixture('home', { profile: USER });
  await home.page.loadContent();
  await home.page.toggleFollow(tap('post-one'));
  assert.equal(home.calls.writes.length, 1);
  assert.deepEqual(home.storage.get('smart-pm-followed-posts'), []);
  await home.page.switchTab(tap('', { tab: 'follow' }));
  assert.equal(home.page.data.activeTab, 'follow');
  assert.equal(home.calls.modals.length, 0);
  const life = fixture('life', { profile: USER });
  await life.page.chooseService(tap('repair'));
  assert.equal(life.calls.modals.length, 1);
  assert.equal(life.calls.modals[0].title, '便民维修');
  assert.match(life.calls.modals[0].content, /暂未开放/);
});

test('公开社区内容/房源/搜索/筛选/详情/VR/关于不弹登录提示，也不读取游客旧关注缓存', async () => {
  const home = fixture('home');
  await home.page.loadContent();
  assert.equal(home.page.data.columns.flat().length, 2);
  assert.deepEqual(home.calls.storageReads, []);
  assert.ok(home.page.data.columns.flat().every((post) => post.followed === false));
  await home.page.onSearch({ detail: { value: '公开社区内容' } });
  assert.equal(home.page.data.columns.flat().length, 1);
  home.page.openPost(tap('post-one'));
  home.page.openVR();
  home.page.previewPostImage();
  home.page.openPost(tap('rental-post'));
  assert.deepEqual(home.calls.navigation, [{ kind: 'navigateTo', url: '/pages/vr/index?id=post-one' },
    { kind: 'navigateTo', url: '/pages/rental/index?id=house-one' }]);
  assert.equal(home.calls.modals.length, 0);
  assert.deepEqual(home.calls.storageReads, []);
  const life = fixture('life');
  await life.page.loadHouses();
  life.page.openFilter(tap('', { kind: 'price' }));
  life.page.chooseOption(tap('', { key: 'roomType', value: '1' }));
  life.page.applyFilter();
  await Promise.resolve();
  life.page.openHouse(tap('house-one'));
  await life.page.chooseService(tap('community'));
  assert.equal(life.calls.modals.length, 0);
  assert.equal(life.calls.houses.length, 2);
  assert.deepEqual(life.calls.navigation, [{ kind: 'navigateTo', url: '/pages/rental/index?id=house-one' },
    { kind: 'switchTab', url: '/pages/home/index' }]);
  const profile = fixture('profile');
  await profile.page.openMenu(tap('about'));
  profile.page.openFavorite(tap('house-one'));
  assert.equal(profile.calls.modals[0].title, '宇宙物业智联');
  assert.deepEqual(profile.calls.navigation, [{ kind: 'navigateTo', url: '/pages/rental/index?id=house-one' }]);
  assert.equal(profile.calls.profile, 0, '公开关于和详情不要求个人资料');
});

test('退出后首页忽略旧个人关注缓存，保留公开内容且不弹窗或删除原缓存', async () => {
  const f = fixture('home', { profile: USER });
  await f.page.loadContent();
  assert.equal(f.page.data.columns.flat().find((post) => post.id === 'post-one').followed, true);
  const readsBefore = f.calls.storageReads.length;
  f.setProfile(null);
  await f.page.onShow();
  assert.equal(f.calls.storageReads.length, readsBefore);
  assert.ok(f.page.data.columns.flat().every((post) => post.followed === false));
  assert.equal(f.page.data.columns.flat().length, 2);
  assert.equal(f.calls.modals.length, 0);
  assert.deepEqual(f.calls.writes, []);
  assert.deepEqual(f.storage.get('smart-pm-followed-posts'), ['post-one']);
});

test('退出后个人页清除已打开的收藏视图，不向游客保留前一用户内容或删除存储', async () => {
  const f = fixture('profile', { profile: USER });
  await f.page.openMenu(tap('favorite'));
  assert.equal(f.page.data.showFavorites, true);
  const readsBefore = f.calls.storageReads.length;
  f.setProfile(null);
  await f.page.loadProfile();
  assert.equal(f.page.data.authenticated, false);
  assert.equal(f.page.data.showFavorites, false);
  assert.equal(f.page.data.favorites.length, 0);
  assert.equal(f.calls.storageReads.length, readsBefore);
  assert.deepEqual(f.calls.writes, []);
  assert.deepEqual(f.storage.get('favorites'), [{ id: 'house-one', title: '合成收藏' }]);
});

test('资料页空对象/伪认证/身份失效/异常均清旧身份和收藏，不阻断重新去登录', async () => {
  for (const options of [{ profile: {} }, { profile: { authenticated: true } },
    { profile: USER, authoritativeAuth: false }, { profileError: true }]) {
    const f = fixture('profile', options);
    f.page.setData({ authenticated: true, profile: { nickname: 'private-old-user' }, showFavorites: true,
      favorites: [{ id: 'private-old-house', title: 'private-old-title' }] });
    await f.page.loadProfile();
    assert.equal(f.page.data.authenticated, false);
    assert.equal(f.page.data.profile.nickname, '未登录');
    assert.equal(f.page.data.showFavorites, false);
    assert.equal(f.page.data.favorites.length, 0);
    assert.ok(!JSON.stringify(f.page.data.profile).includes('private-'));
    f.page.openAccountLogin();
    assert.deepEqual(f.calls.navigation, [{ kind: 'navigateTo', url: '/pages/account-login/index' }]);
    assert.deepEqual(f.calls.writes, []);
  }
});

test('资料页合法live用户与明确demo模拟资料保留显示，手机号登录后仍能展示身份', async () => {
  for (const options of [{ profile: USER, authoritativeAuth: true },
    { demo: true, profile: { authenticated: true, nickname: '明确模拟住户' }, authoritativeAuth: true }]) {
    const f = fixture('profile', options);
    await f.page.loadProfile();
    assert.equal(f.page.data.authenticated, true);
    assert.notEqual(f.page.data.profile.nickname, '未登录');
    assert.equal(f.calls.modals.length, 0);
  }
  const phone = fixture('profile');
  await phone.page.login({ detail: { code: 'synthetic-phone-code' } });
  assert.equal(phone.page.data.authenticated, true);
  assert.equal(phone.page.data.profile._id, USER._id);
});

test('登录门等待期间microtask退出，关注和个人菜单最终副作用边界不读写或导航', async () => {
  const actions = [
    ['home', (page) => page.toggleFollow(tap('post-one'))],
    ['home', (page) => page.switchTab(tap('', { tab: 'follow' }))],
    ...['house', 'family', 'access', 'favorite', 'checkinTest'].map((id) => ['profile', (page) => page.openMenu(tap(id))]),
    ['profile', (page) => page.settings()],
    ['profile', (page) => page.editProfile()],
    ['life', (page) => page.chooseService(tap('repair'))],
  ];
  for (const [name, action] of actions) {
    const f = fixture(name, { profile: USER });
    const pending = action(f.page);
    queueMicrotask(() => f.setProfile(null));
    await pending;
    assert.deepEqual(f.calls.writes, []);
    assert.deepEqual(f.calls.storageReads, []);
    assert.deepEqual(f.calls.navigation, []);
    assert.deepEqual(f.calls.sheets, []);
    assert.equal(f.page.data.showFavorites || false, false);
    assert.equal(f.app.globalData.openFamily, false);
    if (name === 'home') assert.equal(f.page.data.activeTab, 'discover');
    assert.equal(f.calls.modals.filter((modal) => modal.title !== '请先登录').length, 0);
  }
});

test('公开筛选hasLogin旧真值遇microtask退出，不读取或显示个人关注缓存', async () => {
  const f = fixture('home', { profile: USER });
  f.page.posts = [{ id: 'post-one', title: '公开内容', author: '物业', tags: [], likes: 3 }];
  const pending = f.page.applyFilter();
  queueMicrotask(() => f.setProfile(null));
  await pending;
  assert.deepEqual(f.calls.storageReads, []);
  assert.deepEqual(f.calls.writes, []);
  assert.equal(f.page.data.columns.flat()[0].followed, false);
  assert.equal(f.calls.modals.length, 0);
});

test('缺少同步认证能力也不能用旧profile真值执行关注/私有导航或展示身份', async () => {
  for (const [name, action] of [['home', (page) => page.toggleFollow(tap('post-one'))],
    ['profile', (page) => page.openMenu(tap('house'))]]) {
    const f = fixture(name, { profile: USER, omitAuthCapability: true });
    await action(f.page);
    assert.deepEqual(f.calls.writes, []);
    assert.deepEqual(f.calls.storageReads, []);
    assert.deepEqual(f.calls.navigation, []);
  }
  const profile = fixture('profile', { profile: USER, omitAuthCapability: true });
  await profile.page.loadProfile();
  assert.equal(profile.page.data.authenticated, false);
  assert.equal(profile.page.data.profile.nickname, '未登录');
});

test('登录入口不受动作门禁阻挡；缺失资料API或伪authenticated不能放行个人动作', async () => {
  const login = fixture('profile');
  login.page.openAccountLogin();
  assert.deepEqual(login.calls.navigation, [{ kind: 'navigateTo', url: '/pages/account-login/index' }]);
  await login.page.login({ detail: { code: 'synthetic-phone-code' } });
  assert.deepEqual(login.calls.phoneLogin, ['synthetic-phone-code']);
  assert.equal(login.page.data.authenticated, true);
  assert.equal(login.calls.modals.length, 0);
  for (const options of [{ omitProfileApi: true }, { profile: { authenticated: true } }]) {
    const f = fixture('profile', options);
    f.page.data.authenticated = true;
    await f.page.openMenu(tap('house'));
    assertGuestStopped(f);
  }
});
