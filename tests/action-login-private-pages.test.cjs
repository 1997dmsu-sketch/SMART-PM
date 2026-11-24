'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');

function fixture(name, overrides = {}, { afterGate } = {}) {
  const state = { authenticated: false, demo: false, epoch: 1, userId: 'synthetic-user' };
  const calls = { private: {}, storageRead: 0, storageWrite: 0, navigation: [], modals: [] };
  const count = key => { calls.private[key] = (calls.private[key] || 0) + 1; };
  const api = {
    isDemo: () => state.demo,
    isAuthenticated: () => state.authenticated,
    getLoginEpoch: () => state.authenticated ? state.epoch : null,
    getProfile: async () => state.authenticated ? { authenticated: true, _id: state.userId } : null,
    listConversations: async () => { count('listConversations'); return [{ id: 'conversation-1', unread: 1, lastMessage: 'synthetic private message' }]; },
    markRead: async () => { count('markRead'); },
    getMessages: async () => { count('getMessages'); return { data: [{ _id: 'message-1', content: 'synthetic private message', createdAt: 1 }], hasMore: true }; },
    sendMessage: async () => { count('sendMessage'); return { data: { _id: 'message-2', content: 'synthetic sent message' } }; },
    getProperty: async () => { count('getProperty'); return { id: 'property-1', address: 'synthetic-private-address' }; },
    listMeters: async () => { count('listMeters'); return [{ id: 'meter-1', usage: 1 }]; },
    listLocks: async () => { count('listLocks'); return [{ id: 'lock-1', name: 'synthetic lock', address: 'synthetic-private-address' }]; },
    listUnlockRecords: async () => { count('listUnlockRecords'); return [{ id: 'record-1', status: '成功' }]; },
    listFamily: async () => { count('listFamily'); return [{ id: 'member-1' }]; },
    unlockDevice: async () => { count('unlockDevice'); return { message: 'synthetic-only' }; },
    ...overrides,
  };
  const wx = {
    showModal(options) {
      calls.modals.push(options);
      if (options.title === '请先登录') queueMicrotask(() => {
        if (options.success) options.success({ confirm: false });
        if (options.complete) options.complete();
      });
    },
    showToast() {}, stopPullDownRefresh() {},
    getStorageSync() { calls.storageRead++; return 'synthetic-private-note'; },
    setStorageSync() { calls.storageWrite++; },
    navigateTo(options) { calls.navigation.push(options.url); },
    switchTab(options) { calls.navigation.push(options.url); },
    navigateBack() { calls.navigation.push('back'); },
    showActionSheet() {},
  };
  function load(file, requires = {}, globals = {}) {
    const module = { exports: {} };
    const keys = [...Object.keys(globals), 'require', 'module', 'exports', 'wx'];
    const values = [...Object.values(globals), id => {
      if (Object.prototype.hasOwnProperty.call(requires, id)) return requires[id];
      throw new Error('unexpected import ' + id);
    }, module, module.exports, wx];
    vm.runInThisContext(`(function(${keys.join(',')}){${fs.readFileSync(file, 'utf8')}\n})`, { filename: file })(...values);
    return module.exports;
  }
  const gate = load(path.join(ROOT, 'miniprogram/utils/require-login.js'));
  if (afterGate) {
    const original = gate.requireLogin;
    gate.requireLogin = async (...args) => {
      const allowed = await original(...args);
      if (allowed) queueMicrotask(() => afterGate(state));
      return allowed;
    };
  }
  let definition;
  const app = { globalData: { statusBarHeight: 20, openFamily: false } };
  load(path.join(ROOT, `miniprogram/pages/${name}/index.js`), {
    '../../services/api': api,
    '../../utils/require-login': gate,
    '../../utils/layout': { getNavigationLayout: () => ({ statusBarHeight: 20, navHeight: 44 }) },
  }, { Page: value => { definition = value; }, getApp: () => app, getCurrentPages: () => [{}, {}] });
  const page = { ...definition, data: structuredClone(definition.data), setData(values) { Object.assign(this.data, values); }, getTabBar: () => ({ setData() {} }) };
  return { page, api, state, calls, app, count };
}
const total = calls => Object.values(calls.private).reduce((sum, n) => sum + n, 0);

test('guest onShow立即清除四页旧私密数据，并在真实API前拒绝', async () => {
  for (const name of ['messages', 'chat', 'property', 'unlock']) {
    const f = fixture(name);
    f.page.id = 'conversation-1';
    Object.assign(f.page.data, { conversations: [{ unread: 9 }], messages: [{ content: 'old' }], property: { id: 'old' },
      devices: [{ id: 'old' }], locks: [{ id: 'old' }], records: [{ id: 'old' }], family: [{ id: 'old' }], noteDraft: 'old', text: 'old', address: 'old' });
    const pending = f.page.onShow();
    if (name === 'messages') assert.deepEqual(f.page.data.conversations, []);
    if (name === 'chat') { assert.deepEqual(f.page.data.messages, []); assert.equal(f.page.data.text, ''); }
    if (name === 'property') { assert.equal(f.page.data.property, null); assert.equal(f.page.data.noteDraft, ''); }
    if (name === 'unlock') { assert.deepEqual(f.page.data.locks, []); assert.deepEqual(f.page.data.family, []); assert.equal(f.page.data.address, ''); }
    await pending;
    assert.equal(total(f.calls), 0, name + ': guest不得调用私有业务API');
    assert.equal(f.calls.storageRead + f.calls.storageWrite, 0);
    assert.equal(f.calls.modals.filter(m => m.title === '请先登录').length, 1, name + ': 并行加载共用一个真实helper提示');
  }
});

test('直接URL及缺getProfile失败关闭，不把demo标签当真实登录', async () => {
  for (const name of ['chat', 'property', 'unlock']) {
    const f = fixture(name);
    f.state.demo = true;
    delete f.api.getProfile;
    await f.page.onLoad({ id: 'conversation-1', family: '1' });
    assert.equal(total(f.calls), 0);
    assert.equal(f.calls.storageRead + f.calls.storageWrite, 0);
    assert.ok(f.calls.modals.some(m => m.title === '请先登录'));
  }
});

test('guest私有入口、标记、发送、备注和家庭动作均零副作用，普通输入/关闭仍可用', async () => {
  const cases = {
    messages: ['markAllRead', 'openConversation', 'openCategory', 'selectCommunity'],
    chat: ['send', 'more'],
    property: ['toggleNote', 'saveNoteDraft', 'openAction', 'explainUnavailable'],
    unlock: ['showRecords', 'primaryUnlock', 'onUnlock', 'requestUnlock', 'openFamily', 'addFamily'],
  };
  for (const [name, methods] of Object.entries(cases)) {
    for (const method of methods) {
      const f = fixture(name); f.page.id = 'conversation-1';
      Object.assign(f.page.data, { loading: false, hasMore: true, text: 'synthetic draft', conversations: [{ unread: 1 }], locks: [{ id: 'lock-1' }] });
      f.page._noteKey = 'synthetic-private-key';
      await f.page[method](method === 'requestUnlock' ? { id: 'lock-1', name: 'synthetic' } : { currentTarget: { dataset: { id: 'lock-1', title: 'synthetic', label: 'synthetic' } } });
      assert.equal(total(f.calls), 0, name + '.' + method);
      assert.equal(f.calls.storageRead + f.calls.storageWrite, 0, method);
      assert.deepEqual(f.calls.navigation, [], method);
      assert.equal(f.calls.modals.filter(m => m.title === '请先登录').length, 1, method);
    }
  }
  const chat = fixture('chat'); chat.page.input({ detail: { value: 'typed locally' } }); chat.page.back();
  assert.equal(chat.page.data.text, 'typed locally'); assert.equal(chat.calls.modals.length, 0);
  const property = fixture('property'); property.page.changeSection({ currentTarget: { dataset: { section: 'devices' } } }); property.page.editNote({ detail: { value: 'local input' } });
  assert.equal(property.calls.modals.length, 0);
  const unlock = fixture('unlock'); unlock.page.closeFamily(); assert.equal(unlock.calls.modals.length, 0);
});

test('明确登录后真实handler可读消息/标记/导航、读备注并保存一次', async () => {
  const messages = fixture('messages'); messages.state.authenticated = true;
  await messages.page.onShow();
  assert.equal(messages.calls.private.listConversations, 1);
  await Promise.all([messages.page.markAllRead(), messages.page.markAllRead()]);
  assert.equal(messages.calls.private.markRead, 1);
  await messages.page.openConversation({ currentTarget: { dataset: { id: 'conversation-1' } } });
  assert.equal(messages.calls.navigation.length, 1);
  await messages.page.openCategory({ currentTarget: { dataset: { title: 'synthetic category' } } });
  assert.ok(messages.calls.modals.some(m => m.title === 'synthetic category'));
  const property = fixture('property'); property.state.authenticated = true;
  await property.page.onShow();
  assert.equal(property.calls.private.getProperty, 1);
  assert.equal(property.calls.private.listMeters, 1);
  assert.equal(property.calls.storageRead, 1);
  property.page.editNote({ detail: { value: ' synthetic changed note ' } });
  await property.page.saveNoteDraft();
  assert.equal(property.calls.storageWrite, 1);
  assert.equal(property.page.data.noteSaved, true);
  await property.page.openAction({ currentTarget: { dataset: { id: 'unlock' } } });
  assert.deepEqual(property.calls.navigation, ['/pages/unlock/index']);
});

test('聊天实际读/标记/翻页与并行发送只调用一次，随后注销清旧内容', async () => {
  const f = fixture('chat'); f.state.authenticated = true; f.page.id = 'conversation-1';
  await f.page.load();
  assert.equal(f.calls.private.getMessages, 1); assert.equal(f.calls.private.markRead, 1);
  await Promise.all([f.page.more(), f.page.more()]);
  assert.equal(f.calls.private.getMessages, 2, '异步登录复核后的重复翻页仍仅请求一次');
  assert.equal(f.page.data.messages.length, 2, '同一页不会并发prepend两次');
  f.page.input({ detail: { value: 'synthetic new message' } });
  await Promise.all([f.page.send(), f.page.send()]);
  assert.equal(f.calls.private.sendMessage, 1);
  f.state.authenticated = false;
  await f.page.onShow();
  assert.deepEqual(f.page.data.messages, []);
  assert.equal(f.page.data.text, '');
  assert.equal(f.calls.private.getMessages, 2);
});

test('旧聊天请求晚返回不复活注销后私密数据，也不再标记已读', async () => {
  let finish; let started;
  const entered = new Promise(resolve => { started = resolve; });
  const f = fixture('chat', { getMessages: async () => { f.count('getMessages'); started(); return new Promise(resolve => { finish = resolve; }); } });
  f.state.authenticated = true; f.page.id = 'conversation-1';
  const old = f.page.load(); await entered;
  f.state.authenticated = false;
  await f.page.onShow();
  finish({ data: [{ content: 'old private response' }], hasMore: true });
  await old;
  assert.deepEqual(f.page.data.messages, []);
  assert.equal(f.calls.private.getMessages, 1);
  assert.equal(f.calls.private.markRead || 0, 0);
});

test('开门确认期间注销会重新门禁而零设备调用，合法假执行器正例调用一次', async () => {
  const f = fixture('unlock'); f.state.authenticated = true;
  const lock = { id: 'lock-1', name: 'synthetic lock' };
  await f.page.requestUnlock(lock);
  const first = f.calls.modals.find(m => m.title === '确认远程开门');
  assert.ok(first);
  f.state.authenticated = false;
  await first.success({ confirm: true });
  assert.equal(f.calls.private.unlockDevice || 0, 0);
  assert.deepEqual(f.page.data.locks, []);
  f.state.authenticated = true;
  await f.page.requestUnlock(lock);
  const second = f.calls.modals.filter(m => m.title === '确认远程开门')[1];
  await second.success({ confirm: true });
  assert.equal(f.calls.private.unlockDevice, 1, '仅合成假API，证明拒绝计数器也连着可执行正例');
  await f.page.openFamily();
  assert.equal(f.calls.private.listFamily, 1);
  assert.equal(f.page.data.family.length, 1);
});

test('开门确认不能跨账号或同账号的退出重登代次', async () => {
  for (const changeUser of [false, true]) {
    const f = fixture('unlock'); f.state.authenticated = true;
    await f.page.requestUnlock({ id: 'lock-1', name: 'synthetic lock' });
    const confirmation = f.calls.modals.find(m => m.title === '确认远程开门');
    assert.ok(confirmation);
    f.state.epoch += 2;
    if (changeUser) f.state.userId = 'synthetic-other-user';
    await confirmation.success({ confirm: true });
    assert.equal(f.calls.private.unlockDevice || 0, 0);
    assert.equal(f.page.data.pendingId, '');
  }
});

test('真实登录helper通过后微任务退出，最终同步门阻止业务/存储/导航', async () => {
  const cases = [
    ['messages', 'openConversation', { currentTarget: { dataset: { id: 'conversation-1' } } }],
    ['chat', 'send', undefined],
    ['property', 'saveNoteDraft', undefined],
    ['unlock', 'openFamily', undefined],
  ];
  for (const [name, method, arg] of cases) {
    const f = fixture(name, {}, { afterGate: state => { state.authenticated = false; state.epoch++; } });
    f.state.authenticated = true;
    f.page.id = 'conversation-1';
    f.page._noteKey = 'synthetic-note';
    f.page.setData({ text: 'synthetic text', noteDraft: 'synthetic note' });
    await f.page[method](arg);
    assert.equal(total(f.calls), 0, name + '.' + method);
    assert.equal(f.calls.storageWrite, 0);
    assert.deepEqual(f.calls.navigation, []);
  }
});

test('已知guest触发业务时先清旧内容，不等待登录弹框被关闭', async () => {
  const f = fixture('chat');
  f.page.id = 'conversation-1';
  f.page.setData({ messages: [{ content: 'old private' }], text: 'synthetic unsent' });
  const pending = f.page.send();
  assert.deepEqual(f.page.data.messages, []);
  assert.equal(f.page.data.text, '');
  await pending;
  assert.equal(total(f.calls), 0);
});
