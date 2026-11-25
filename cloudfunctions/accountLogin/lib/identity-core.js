'use strict';

// This exact file is copied into each independently deployed login function.
// It never imports a sibling cloud function or accepts a client identity.
const { createHash } = require('node:crypto');
const { types } = require('node:util');
const IDENTITIES = 'tenant_auth_identities';

class TenantAuthError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.name = 'TenantAuthError';
    this.code = code;
    this.status = status;
  }
}
function fail(code = 'SERVICE_UNAVAILABLE', status = 503) { throw new TenantAuthError(code, status); }
function sha256(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
// 微信平台在真机 callFunction 时注入的保留字段：显式放行、忽略其内容、绝不读取。
const PLATFORM_EVENT_FIELDS = Object.freeze(['tcbContext', 'userInfo']);
function closedInput(value, allowed) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) fail('INVALID_INPUT', 400);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const copy = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (typeof key === 'string' && PLATFORM_EVENT_FIELDS.includes(key)) {
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('INVALID_INPUT', 400);
      continue;
    }
    if (typeof key !== 'string' || !allowed.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('INVALID_INPUT', 400);
    copy[key] = descriptor.value;
  }
  return copy;
}
function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x20\x7f/\\]/.test(value);
}
function validateContext(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value)) fail('AUTH_FAILED', 401);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const read = (key) => descriptors[key] && Object.hasOwn(descriptors[key], 'value') ? descriptors[key].value : undefined;
  const appId = read('APPID');
  const openid = read('OPENID');
  if (typeof appId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(appId)
    || typeof openid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(openid)) fail('AUTH_FAILED', 401);
  const unionid = read('UNIONID');
  return { appId, openid, unionid: typeof unionid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(unionid) ? unionid : null };
}
function identityIdFor(context) {
  const value = validateContext(context);
  return `wx_${sha256(`${value.appId}\0${value.openid}`)}`;
}
function userIdFor(context) { return `wxuser_${identityIdFor(context).slice(3)}`; }
function nowMs(now = Date.now) {
  const value = typeof now === 'function' ? now() : now;
  const result = value instanceof Date ? value.getTime() : value;
  if (!Number.isSafeInteger(result) || result <= 0) fail();
  return result;
}
async function readDoc(db, collection, id) {
  try {
    const response = await db.collection(collection).doc(id).get();
    return response && response.data && !Array.isArray(response.data) ? response.data : null;
  } catch (error) {
    const codes = error && [error.code, error.errCode];
    if (codes && codes.some((code) => code === 'DOCUMENT_NOT_EXISTS' || code === 'NOT_FOUND')) return null;
    if (error && error.errCode === -1 && typeof error.message === 'string'
      && /(?:DOCUMENT_NOT_EXISTS|document[^\n]*(?:not exist|not found|does not exist))/i.test(error.message)) return null;
    throw error;
  }
}
async function putDoc(db, collection, id, value) {
  // 真实云端 SDK 禁止在 set 的 data 中携带 _id（-501007 不能更新_id的值），
  // 必须剔除后再写入；_id 由 doc(id) 路径本身决定。
  const { _id, ...data } = value;
  await db.collection(collection).doc(id).set({ data });
  return { ...value, _id: id };
}
async function withTransaction(db, work) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') fail();
  return db.runTransaction(async (tx) => {
    if (!tx || typeof tx.collection !== 'function') fail();
    return work(tx);
  });
}

/**
 * Query only outside the transaction, then bind the unique legacy candidate
 * by point read inside it. Every supported user creator shares this index.
 * Duplicate historical users are not merged or selected by array position.
 */
async function withIdentity({ db, context, now = Date.now, create = true }, work) {
  const trusted = validateContext(context);
  const id = identityIdFor(context);
  const query = db.collection('users').where({ _openid: trusted.openid }).limit(2);
  const response = await query.get();
  if (!response || !Array.isArray(response.data) || response.data.length > 1) fail('IDENTITY_UNVERIFIED');
  const legacy = response.data[0] || null;
  if (legacy && (!validId(legacy._id) || legacy._openid !== trusted.openid)) fail('IDENTITY_UNVERIFIED');
  return withTransaction(db, async (tx) => {
    const timestamp = nowMs(now);
    let identity = await readDoc(tx, IDENTITIES, id);
    let user;
    let isNew = false;
    if (identity) {
      if (identity.appId !== trusted.appId || identity.openid !== trusted.openid || !validId(identity.userId)) fail('IDENTITY_UNVERIFIED');
      user = await readDoc(tx, 'users', identity.userId);
      if (!user || user._openid !== trusted.openid || user.wechatAppId !== trusted.appId
        || (legacy && legacy._id !== user._id)) fail('IDENTITY_UNVERIFIED');
    } else {
      if (!create) return null;
      if (legacy) {
        user = await readDoc(tx, 'users', legacy._id);
        if (!user || user._openid !== trusted.openid || (user.wechatAppId && user.wechatAppId !== trusted.appId)) fail('IDENTITY_UNVERIFIED');
        user = { ...user, wechatAppId: trusted.appId };
        await putDoc(tx, 'users', user._id, user);
      } else {
        const userId = userIdFor(context);
        if (await readDoc(tx, 'users', userId)) fail('IDENTITY_UNVERIFIED');
        user = { _id: userId, _openid: trusted.openid, wechatAppId: trusted.appId, unionid: trusted.unionid,
          role: 'user', houses: [], points: 0, createdAt: timestamp, lastLoginAt: timestamp };
        await putDoc(tx, 'users', userId, user);
        isNew = true;
      }
      identity = { _id: id, schemaVersion: 1, appId: trusted.appId, openid: trusted.openid,
        userId: user._id, revision: 1, createdAt: timestamp, updatedAt: timestamp };
      await putDoc(tx, IDENTITIES, id, identity);
    }
    return work ? work({ tx, trusted, identity, user, isNew, timestamp }) : { identity, user, isNew };
  });
}

function publicUser(user) {
  if (!user || !validId(user._id)) fail('IDENTITY_UNVERIFIED');
  const result = { _id: user._id, role: user.role === 'admin' ? 'admin' : 'user',
    houses: Array.isArray(user.houses) ? user.houses.filter(validId) : [],
    points: Number.isFinite(user.points) && user.points >= 0 ? user.points : 0 };
  for (const key of ['name', 'nickname', 'avatar', 'phone', 'community', 'house', 'propertyId']) {
    if (typeof user[key] === 'string' && user[key].length <= 512 && !/[\x00-\x1f\x7f]/.test(user[key])) result[key] = user[key];
  }
  for (const key of ['couponsCount', 'ordersCount']) {
    if (Number.isSafeInteger(user[key]) && user[key] >= 0) result[key] = user[key];
  }
  return result;
}

module.exports = { IDENTITIES, TenantAuthError, fail, sha256, closedInput, validId,
  validateContext, identityIdFor, userIdFor, nowMs, readDoc, putDoc, withTransaction, withIdentity, publicUser };
