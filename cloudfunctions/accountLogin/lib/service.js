'use strict';
const { randomBytes, randomUUID } = require('node:crypto');
const identity = require('./identity-core');
const credentials = require('./credentials');
const { fail, sha256, closedInput, validId, validateContext, identityIdFor,
  nowMs, readDoc, putDoc, withTransaction, withIdentity, publicUser } = identity;

const COLLECTIONS = Object.freeze({ USERS: 'users', IDENTITIES: 'tenant_auth_identities',
  ENROLLMENTS: 'tenant_auth_enrollments', ACCOUNTS: 'tenant_auth_accounts',
  RATE_LIMITS: 'tenant_auth_rate_limits', AUDIT: 'tenant_auth_audit' });
const AUTH_FAILURE = Object.freeze({ code: 'AUTH_FAILED', msg: '账号或密码错误，或账号暂不可用' });
const SERVICE_FAILURE = Object.freeze({ code: 'SERVICE_UNAVAILABLE', msg: '登录服务暂不可用' });
const CODE_TTL = 10 * 60 * 1000;

function requireAdmin(value) {
  let actor;
  try { actor = closedInput(value, ['id', 'name', 'role']); } catch { fail('ADMIN_REQUIRED', 403); }
  if (!validId(actor.id) || actor.role !== 'admin') fail('ADMIN_REQUIRED', 403);
  if (actor.name !== undefined && (typeof actor.name !== 'string' || actor.name.length > 128 || /[\x00-\x1f\x7f]/.test(actor.name))) fail('ADMIN_REQUIRED', 403);
  return actor;
}
function requestHash(value) {
  if (typeof value !== 'string' || !/^[A-Z2-7]{16}$/.test(value.trim().toUpperCase())) fail('REQUEST_INVALID', 409);
  return sha256(value.trim().toUpperCase());
}
function requestCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = randomBytes(10);
  let bits = 0; let bitCount = 0; let result = '';
  for (const byte of bytes) {
    bits = (bits << 8) | byte; bitCount += 8;
    while (bitCount >= 5) { bitCount -= 5; result += alphabet[(bits >>> bitCount) & 31]; }
  }
  return result;
}
function accountIdFor(username) { return `acct_${sha256(username)}`; }
function publicAccount(value) {
  return { id: value._id, username: value.username, userId: value.userId,
    status: value.status, revision: value.revision, credentialVersion: value.credentialVersion,
    createdAt: value.createdAt, updatedAt: value.updatedAt };
}
function validAccount(value) {
  return !!value && validId(value._id) && validId(value.identityId) && validId(value.userId)
    && typeof value.username === 'string' && /^[a-z0-9][a-z0-9._-]{3,31}$/.test(value.username)
    && value._id === accountIdFor(value.username)
    && typeof value.openid === 'string' && ['active', 'disabled'].includes(value.status)
    && Number.isSafeInteger(value.revision) && value.revision > 0
    && Number.isSafeInteger(value.credentialVersion) && value.credentialVersion > 0
    && credentials.validPasswordHash(value.password);
}
function nextRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) fail();
  return value + 1;
}
function adminInput(value, allowed) { return closedInput(value, allowed); }

class TenantAccountService {
  constructor({ db, now = Date.now } = {}) { this.db = db; this.now = now; }

  async _audit(tx, actor, action, account) {
    const id = `audit_${randomUUID()}`;
    await putDoc(tx, COLLECTIONS.AUDIT, id, { action, actorId: actor.id,
      accountId: account._id, targetUserId: account.userId,
      revision: account.revision, createdAt: nowMs(this.now) });
  }

  async _reserveRate(context, operation) {
    const id = `rate_${sha256(`${operation}\0${identityIdFor(context)}`)}`;
    const duration = operation === 'prepare' ? 60 * 1000 : 15 * 60 * 1000;
    const limit = operation === 'prepare' ? 3 : 10;
    return withTransaction(this.db, async (tx) => {
      const now = nowMs(this.now);
      const current = await readDoc(tx, COLLECTIONS.RATE_LIMITS, id);
      if (current && (!Number.isSafeInteger(current.windowStartedAt) || now < current.windowStartedAt
        || !Number.isSafeInteger(current.attempts) || current.attempts < 0)) fail();
      const expired = !current || now - current.windowStartedAt >= duration;
      if (!expired && current.attempts >= limit) fail('AUTH_FAILED', 401);
      await putDoc(tx, COLLECTIONS.RATE_LIMITS, id, { operation,
        windowStartedAt: expired ? now : current.windowStartedAt,
        attempts: expired ? 1 : current.attempts + 1,
        revision: current ? nextRevision(current.revision) : 1 });
    });
  }

  async prepare(context, input = {}) {
    try {
      closedInput(input, []);
      validateContext(context);
      await this._reserveRate(context, 'prepare');
      const code = requestCode();
      const codeHash = sha256(code);
      return await withIdentity({ db: this.db, context, now: this.now }, async ({ tx, identity: binding, user, timestamp }) => {
        if (binding.accountId) fail('AUTH_FAILED', 401);
        const id = `enroll_${codeHash}`;
        if (await readDoc(tx, COLLECTIONS.ENROLLMENTS, id)) fail();
        const expiresAt = timestamp + CODE_TTL;
        await putDoc(tx, COLLECTIONS.ENROLLMENTS, id, { schemaVersion: 1, identityId: binding._id,
          userId: user._id, codeHash, status: 'pending', createdAt: timestamp, expiresAt, revision: 1 });
        await putDoc(tx, COLLECTIONS.IDENTITIES, binding._id, { ...binding,
          pendingEnrollmentHash: codeHash, revision: nextRevision(binding.revision), updatedAt: timestamp });
        return { code: 0, requestCode: code, expiresAt };
      });
    } catch (error) {
      return error && ['AUTH_FAILED', 'INVALID_INPUT'].includes(error.code) ? { ...AUTH_FAILURE } : { ...SERVICE_FAILURE };
    }
  }

  async login(context, input = {}) {
    try {
      const data = closedInput(input, ['username', 'password']);
      const trusted = validateContext(context);
      const username = credentials.normalizeUsername(data.username);
      const password = credentials.validatePassword(data.password);
      await this._reserveRate(context, 'login');
      const id = accountIdFor(username);
      const account = await readDoc(this.db, COLLECTIONS.ACCOUNTS, id);
      const bindingId = identityIdFor(context);
      const eligible = validAccount(account) && account.status === 'active'
        && account.identityId === bindingId && account.openid === trusted.openid;
      const matches = await credentials.verifyPassword(password, eligible ? account.password : null);
      if (!eligible || !matches) return { ...AUTH_FAILURE };
      // Outside-query preflight only detects historical duplicates; no first-row selection.
      const users = await this.db.collection(COLLECTIONS.USERS).where({ _openid: trusted.openid }).limit(2).get();
      if (!users || !Array.isArray(users.data) || users.data.length !== 1 || users.data[0]._id !== account.userId) fail('IDENTITY_UNVERIFIED');
      return await withTransaction(this.db, async (tx) => {
        const current = await readDoc(tx, COLLECTIONS.ACCOUNTS, id);
        const binding = await readDoc(tx, COLLECTIONS.IDENTITIES, bindingId);
        const user = await readDoc(tx, COLLECTIONS.USERS, account.userId);
        if (!validAccount(current) || current.status !== 'active' || current.revision !== account.revision
          || current.credentialVersion !== account.credentialVersion
          || current.password.saltHex !== account.password.saltHex || current.password.hashHex !== account.password.hashHex
          || current.identityId !== bindingId || current.userId !== account.userId || current.openid !== trusted.openid
          || !binding || binding.appId !== trusted.appId || binding.openid !== trusted.openid
          || binding.userId !== account.userId || binding.accountId !== id
          || !user || user._openid !== trusted.openid || user.wechatAppId !== trusted.appId) fail('AUTH_FAILED', 401);
        const patch = { ...user, lastLoginAt: nowMs(this.now) };
        if (trusted.unionid) patch.unionid = trusted.unionid;
        await putDoc(tx, COLLECTIONS.USERS, user._id, patch);
        return { code: 0, userInfo: publicUser(patch) };
      });
    } catch (error) {
      return error && ['AUTH_FAILED', 'INVALID_INPUT'].includes(error.code) ? { ...AUTH_FAILURE } : { ...SERVICE_FAILURE };
    }
  }

  async listAccounts(actor) {
    requireAdmin(actor);
    try {
      const accounts = [];
      for (let offset = 0; offset <= 10000; offset += 100) {
        const result = await this.db.collection(COLLECTIONS.ACCOUNTS)
          .orderBy('_id', 'asc').skip(offset).limit(100).get();
        if (!result || !Array.isArray(result.data)) fail();
        if (result.data.some((account) => !validAccount(account))) fail('ACCOUNT_DATA_UNVERIFIED', 503);
        let lastId = accounts.length ? accounts[accounts.length - 1].id : '';
        for (const account of result.data) {
          if (account._id <= lastId) fail();
          lastId = account._id;
        }
        if (accounts.length + result.data.length > 10000) fail('ACCOUNT_LIST_LIMIT', 503);
        accounts.push(...result.data.map(publicAccount));
        if (result.data.length < 100) return accounts;
      }
      fail('ACCOUNT_LIST_LIMIT', 503);
    } catch (error) { if (error instanceof identity.TenantAuthError) throw error; fail(); }
  }

  async createAccount(actorInput, input = {}) {
    const actor = requireAdmin(actorInput);
    const data = adminInput(input, ['requestCode', 'username', 'password']);
    const codeHash = requestHash(data.requestCode);
    const username = credentials.normalizeUsername(data.username);
    const password = await credentials.hashPassword(data.password);
    try {
      return await withTransaction(this.db, async (tx) => {
        const timestamp = nowMs(this.now);
        const request = await readDoc(tx, COLLECTIONS.ENROLLMENTS, `enroll_${codeHash}`);
        if (!request || request.status !== 'pending' || request.codeHash !== codeHash
          || !Number.isSafeInteger(request.expiresAt) || timestamp >= request.expiresAt
          || !Number.isSafeInteger(request.createdAt) || timestamp < request.createdAt) fail('REQUEST_INVALID', 409);
        const binding = await readDoc(tx, COLLECTIONS.IDENTITIES, request.identityId);
        const user = await readDoc(tx, COLLECTIONS.USERS, request.userId);
        if (!binding || binding.userId !== request.userId || binding.pendingEnrollmentHash !== codeHash
          || !user || user._openid !== binding.openid || user.wechatAppId !== binding.appId) fail('REQUEST_INVALID', 409);
        const id = accountIdFor(username);
        const existing = await readDoc(tx, COLLECTIONS.ACCOUNTS, id);
        if (existing || binding.accountId) fail('ACCOUNT_EXISTS', 409);
        const account = { _id: id, schemaVersion: 1, username, identityId: binding._id,
          userId: user._id, openid: binding.openid, status: 'active', revision: 1,
          credentialVersion: 1, password, createdAt: timestamp, updatedAt: timestamp };
        await putDoc(tx, COLLECTIONS.ACCOUNTS, id, account);
        await putDoc(tx, COLLECTIONS.ENROLLMENTS, request._id, { ...request, status: 'consumed',
          revision: nextRevision(request.revision), consumedAt: timestamp });
        await putDoc(tx, COLLECTIONS.IDENTITIES, binding._id, { ...binding, accountId: id,
          pendingEnrollmentHash: null, revision: nextRevision(binding.revision), updatedAt: timestamp });
        await this._audit(tx, actor, 'TENANT_ACCOUNT_CREATE', account);
        return publicAccount(account);
      });
    } catch (error) { if (error instanceof identity.TenantAuthError) throw error; fail(); }
  }

  async resetPassword(actorInput, input = {}) {
    const actor = requireAdmin(actorInput);
    const data = adminInput(input, ['accountId', 'newPassword', 'expectedRevision']);
    this._validateRevisionInput(data);
    const password = await credentials.hashPassword(data.newPassword);
    return this._updateAccount(actor, data, 'TENANT_ACCOUNT_RESET', (current) => ({
      ...current, password, credentialVersion: nextRevision(current.credentialVersion) }));
  }

  async setStatus(actorInput, input = {}) {
    const actor = requireAdmin(actorInput);
    const data = adminInput(input, ['accountId', 'status', 'expectedRevision']);
    this._validateRevisionInput(data);
    if (!['active', 'disabled'].includes(data.status)) fail('INVALID_INPUT', 400);
    return this._updateAccount(actor, data, 'TENANT_ACCOUNT_STATUS', (current) => ({ ...current, status: data.status }));
  }

  _validateRevisionInput(data) {
    if (typeof data.accountId !== 'string' || !/^acct_[a-f0-9]{64}$/.test(data.accountId)
      || !Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 1) fail('INVALID_INPUT', 400);
  }

  async _updateAccount(actor, data, action, patch) {
    try {
      return await withTransaction(this.db, async (tx) => {
        const current = await readDoc(tx, COLLECTIONS.ACCOUNTS, data.accountId);
        if (!current) fail('ACCOUNT_NOT_FOUND', 404);
        if (!validAccount(current)) fail();
        if (current.revision !== data.expectedRevision) fail('REVISION_CONFLICT', 409);
        const next = { ...patch(current), revision: nextRevision(current.revision), updatedAt: nowMs(this.now) };
        await putDoc(tx, COLLECTIONS.ACCOUNTS, current._id, next);
        await this._audit(tx, actor, action, next);
        return publicAccount(next);
      });
    } catch (error) { if (error instanceof identity.TenantAuthError) throw error; fail(); }
  }
}

module.exports = { TenantAccountService, COLLECTIONS, publicAccount, accountIdFor };
