'use strict';
const { randomUUID, timingSafeEqual } = require('node:crypto');
const identity = require('./identity-core');
const { hasPhoneProof } = require('./phone-proof');
const dates = require('./dates');
const { sha256, closedInput, validId, validateContext, identityIdFor, validIdentityBinding, readDoc, checkedQuery } = identity;

const COLLECTIONS = Object.freeze({ CONTRACTS: 'signed_lease_contracts', GRANTS: 'signed_lease_grants',
  USER_ACCESS: 'signed_lease_user_access', BINDINGS: 'remote_door_bindings', PROGRAM: 'remote_unlock_program',
  WORKERS: 'remote_unlock_workers', TASKS: 'remote_unlock_tasks', AUDITS: 'remote_unlock_audits' });
const ids = Object.freeze({ program: 'program', grant: (contractId) => `grant_${sha256(contractId)}`,
  userAccess: (userId) => `access_${sha256(userId)}`,
  task: (userId, requestId) => `open_${sha256(`${userId}\0${requestId}`)}` });
const PENDING = new Set(['queued', 'claimed', 'executing', 'unknown']);
const SAFE_ERROR_CODES = Object.freeze(['SERVICE_UNAVAILABLE', 'INVALID_INPUT', 'ADMIN_REQUIRED', 'AUTH_FAILED',
  'IDENTITY_UNVERIFIED', 'REVISION_CONFLICT', 'ACCESS_REVOKED', 'ACCESS_UNVERIFIED', 'BINDING_DISABLED',
  'PROGRAM_DISABLED', 'LEASE_NOT_STARTED', 'LEASE_EXPIRED', 'WORKER_UNAUTHORIZED', 'HOUSE_UNVERIFIED',
  'CONTRACT_CONFLICT', 'ACCESS_LIMIT', 'CONTRACT_NOT_FOUND', 'REQUEST_CONFLICT', 'REQUEST_IN_FLIGHT',
  'TASK_NOT_FOUND', 'CLAIM_MISMATCH', 'TASK_NOT_CLAIMED', 'TASK_EXPIRED', 'REPORT_CONFLICT', 'TASK_NOT_UNKNOWN']);
const MESSAGES = Object.freeze({ queued: '开门指令已排队，尚未执行', claimed: '执行器已领取，尚未执行',
  executing: '指令执行中，结果待确认', unknown: '设备结果未知，请勿重复开门，需人工核对',
  device_confirmed: '设备已接受指令，不代表现场门锁已释放', failed: '设备指令失败',
  expired: '指令已过期且未执行', denied: '授权已失效，未执行指令' });
function fail(code = 'SERVICE_UNAVAILABLE', status = 503) {
  throw Object.assign(new Error(code), { code, status });
}
function ident(value) { if (!validId(value)) fail('INVALID_INPUT', 400); return value; }
function text(value, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail('INVALID_INPUT', 400);
  return value;
}
function bool(value) { if (typeof value !== 'boolean') fail('INVALID_INPUT', 400); return value; }
function revision(value) { if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) fail('INVALID_INPUT', 400); return value; }
function next(value) { if (!Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) fail(); return value + 1; }
function expected(current, value) {
  revision(value);
  if ((current ? current.revision : 0) !== value) fail('REVISION_CONFLICT', 409);
}
function admin(actor) {
  const data = closedInput(actor, ['kind', 'id']);
  if (data.kind !== 'admin' || !validId(data.id)) fail('ADMIN_REQUIRED', 403);
  return data;
}
function checked(result) {
  if (!result || typeof result !== 'object' || ['code', 'errCode'].some((key) => result[key] !== undefined && result[key] !== 0 && result[key] !== '0')) fail();
  return result;
}
async function put(tx, collection, id, value) {
  checked(await tx.collection(collection).doc(id).set({ data: { ...value, _id: id } }));
  return { ...value, _id: id };
}
function leaseWindow(startDate, endDate) {
  try {
    const window = dates.buildLeaseWindow(startDate, endDate);
    // Resolve real Shanghai midnights, including historical DST; never rely on the host timezone.
    const midnight = (calendar) => {
      const wall = Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth(), calendar.getUTCDate());
      let value = wall - 8 * 3600000;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const part = dates.shanghaiParts(value);
        const represented = Date.UTC(Number(part.year), Number(part.month) - 1, Number(part.day), Number(part.hour), Number(part.minute), Number(part.second));
        value += wall - represented;
      }
      return value;
    };
    const validFrom = midnight(new Date(`${window.startDate}T00:00:00Z`));
    const lastCalendar = new Date(`${window.endDate}T00:00:00Z`);
    lastCalendar.setUTCDate(lastCalendar.getUTCDate() + 1);
    const validUntil = midnight(lastCalendar);
    if (!Number.isSafeInteger(validFrom) || !Number.isSafeInteger(validUntil) || validUntil <= validFrom) fail('INVALID_INPUT', 400);
    return { startDate, endDate, validFrom, validUntil };
  } catch { fail('INVALID_INPUT', 400); }
}
function bindingView(doc) {
  return { bindingId: doc._id, revision: doc.revision, houseId: doc.houseId, displayName: doc.displayName,
    deviceKey: doc.deviceKey, doorNo: doc.doorNo, expectedModel: doc.expectedModel, enabled: doc.enabled };
}
function contractView(doc) {
  return { contractId: doc._id, revision: doc.revision, status: doc.status, userId: doc.userId,
    houseId: doc.houseId, doorBindingId: doc.doorBindingId, startDate: doc.startDate, endDate: doc.endDate,
    validFrom: doc.validFrom, validUntil: doc.validUntil };
}
function taskView(doc) {
  return { taskId: doc._id, claimId: doc.claimId, revision: doc.revision, deviceKey: doc.deviceKey,
    doorNo: doc.doorNo, expectedModel: doc.expectedModel, validFrom: doc.validFrom, validUntil: doc.validUntil,
    expiresAt: doc.expiresAt, contractId: doc.contractId, doorBindingId: doc.doorBindingId };
}
function resultView(doc) {
  if (!Object.hasOwn(MESSAGES, doc.status) || !Number.isSafeInteger(doc.expiresAt)) fail();
  return { taskId: doc._id, status: doc.status, message: MESSAGES[doc.status], expiresAt: doc.expiresAt, resolved: doc.resolved === true };
}
function validContract(doc) {
  const valid = !!doc && doc.schemaVersion === 1 && Number.isSafeInteger(doc.revision) && doc.revision > 0
    && typeof doc.signedEvidenceRef === 'string' && doc.signedEvidenceRef.trim().length > 0 && doc.signedEvidenceRef.length <= 512
    && !/[\x00-\x1f\x7f]/.test(doc.signedEvidenceRef)
    && ['signedAt', 'createdAt', 'updatedAt'].every((key) => Number.isSafeInteger(doc[key]) && doc[key] > 0)
    && doc.signedAt >= doc.createdAt && doc.updatedAt >= doc.signedAt
    && [doc.userId, doc.identityId, doc.houseId, doc.doorBindingId].every(validId);
  if (!valid) return false;
  try { const window = leaseWindow(doc.startDate, doc.endDate); return window.validFrom === doc.validFrom && window.validUntil === doc.validUntil; }
  catch { return false; }
}
function validGrant(grant, contract) {
  return !!grant && grant.schemaVersion === 1 && grant.status === 'active' && grant.contractId === contract._id
    && grant.contractRevision === contract.revision && grant.userId === contract.userId && grant.identityId === contract.identityId
    && grant.houseId === contract.houseId && grant.doorBindingId === contract.doorBindingId
    && Number.isSafeInteger(grant.revision) && grant.revision > 0
    && Number.isSafeInteger(grant.updatedAt) && grant.updatedAt > 0
    && (grant.activeTaskId === null || validId(grant.activeTaskId));
}
function validIndex(index, userId, identityId) {
  return !!index && index.userId === userId && index.identityId === identityId
    && Number.isSafeInteger(index.revision) && index.revision > 0 && Array.isArray(index.contractIds) && index.contractIds.length <= 100
    && index.contractIds.every(validId) && new Set(index.contractIds).size === index.contractIds.length;
}

function createService({ db, now = Date.now } = {}) {
  const time = () => identity.nowMs(now);
  const txRun = (work) => {
    if (!db || typeof db.runTransaction !== 'function' || typeof db.collection !== 'function') fail();
    return db.runTransaction(async (tx) => {
      if (!tx || typeof tx.collection !== 'function') fail();
      return work(tx, time());
    });
  };
  const audit = (tx, actorId, action, targetId, timestamp, details = {}) => put(tx, COLLECTIONS.AUDITS,
    `audit_${randomUUID()}`, { actorId, action, targetId, createdAt: timestamp, ...details });
  async function canonical(tx, userId) {
    const user = await readDoc(tx, 'users', ident(userId));
    if (!user) fail('IDENTITY_UNVERIFIED', 403);
    let trusted;
    try { trusted = validateContext({ APPID: user.wechatAppId, OPENID: user._openid }); }
    catch { fail('IDENTITY_UNVERIFIED', 403); }
    const binding = await readDoc(tx, 'tenant_auth_identities', identityIdFor({ APPID: trusted.appId, OPENID: trusted.openid }));
    if (!validIdentityBinding(binding, user, trusted) || !await hasPhoneProof(tx, { trusted, identity: binding, user })) fail('IDENTITY_UNVERIFIED', 403);
    return { user, identity: binding, trusted };
  }
  async function resident(tx, context) {
    let trusted;
    try { trusted = validateContext(context); } catch { fail('AUTH_FAILED', 403); }
    const binding = await readDoc(tx, 'tenant_auth_identities', identityIdFor(context));
    if (!binding || !validId(binding.userId)) fail('AUTH_FAILED', 403);
    const result = await canonical(tx, binding.userId);
    if (result.trusted.appId !== trusted.appId || result.trusted.openid !== trusted.openid) fail('AUTH_FAILED', 403);
    return result;
  }
  async function room(tx, binding) {
    if (!binding || !validId(binding.roomDocumentId)) fail('ACCESS_UNVERIFIED', 403);
    const doc = await readDoc(tx, 'rooms', binding.roomDocumentId);
    if (!doc || doc.houseId !== binding.houseId) fail('ACCESS_UNVERIFIED', 403);
    return doc;
  }
  async function program(tx) {
    const doc = await readDoc(tx, COLLECTIONS.PROGRAM, ids.program);
    if (doc && (!Number.isSafeInteger(doc.revision) || doc.revision < 1 || typeof doc.enabled !== 'boolean' || typeof doc.dispatchEnabled !== 'boolean')) fail();
    return doc || { enabled: false, dispatchEnabled: false, revision: 0 };
  }
  async function worker(tx, input) {
    const id = ident(input.workerId);
    if (typeof input.token !== 'string' || input.token.length < 32 || input.token.length > 256 || /[\x00-\x20\x7f]/.test(input.token)) fail('WORKER_UNAUTHORIZED', 403);
    const doc = await readDoc(tx, COLLECTIONS.WORKERS, id);
    const actual = sha256(input.token);
    if (!doc || doc.enabled !== true || !/^[a-f0-9]{64}$/.test(doc.tokenHash || '') || !validId(doc.deviceKey)
      || !Number.isSafeInteger(doc.revision) || doc.revision < 1 || !timingSafeEqual(Buffer.from(actual), Buffer.from(doc.tokenHash))) fail('WORKER_UNAUTHORIZED', 403);
    return doc;
  }
  async function gate(tx, contractId, timestamp, { userId, dispatch = false, task } = {}) {
    const contract = await readDoc(tx, COLLECTIONS.CONTRACTS, ident(contractId));
    if (!contract || contract.status !== 'signed' || (userId && contract.userId !== userId)) fail('ACCESS_REVOKED', 403);
    if (!validContract(contract)) fail('ACCESS_UNVERIFIED', 403);
    const person = await canonical(tx, contract.userId);
    if (person.identity._id !== contract.identityId || person.trusted.appId !== contract.appId) fail('ACCESS_UNVERIFIED', 403);
    const window = leaseWindow(contract.startDate, contract.endDate);
    if (window.validFrom !== contract.validFrom || window.validUntil !== contract.validUntil) fail('ACCESS_UNVERIFIED', 403);
    const grant = await readDoc(tx, COLLECTIONS.GRANTS, ids.grant(contract._id));
    if (!validGrant(grant, contract)) fail('ACCESS_UNVERIFIED', 403);
    const binding = await readDoc(tx, COLLECTIONS.BINDINGS, contract.doorBindingId);
    if (!binding || binding.houseId !== contract.houseId || !validId(binding.deviceKey) || !Number.isSafeInteger(binding.doorNo)
      || binding.doorNo < 1 || binding.doorNo > 65535 || typeof binding.expectedModel !== 'string' || !binding.expectedModel
      || !Number.isSafeInteger(binding.revision) || binding.revision < 1) fail('ACCESS_UNVERIFIED', 403);
    await room(tx, binding);
    if (binding.enabled !== true) fail('BINDING_DISABLED', 403);
    const config = await program(tx);
    if (config.enabled !== true || (dispatch && config.dispatchEnabled !== true)) fail('PROGRAM_DISABLED', 403);
    if (timestamp < contract.validFrom) fail('LEASE_NOT_STARTED', 403);
    if (timestamp >= contract.validUntil) fail('LEASE_EXPIRED', 403);
    if (task && (grant.activeTaskId !== task._id || task.userId !== contract.userId || task.identityId !== contract.identityId
      || task.contractRevision !== contract.revision || task.grantRevision !== grant.revision
      || task.bindingRevision !== binding.revision || task.programRevision !== config.revision
      || task.doorBindingId !== binding._id || task.deviceKey !== binding.deviceKey || task.doorNo !== binding.doorNo
      || task.expectedModel !== binding.expectedModel || task.validFrom !== contract.validFrom || task.validUntil !== contract.validUntil
      || !Number.isSafeInteger(task.expiresAt) || !Number.isSafeInteger(task.createdAt)
      || task.expiresAt > contract.validUntil || task.expiresAt > task.createdAt + 30000)) fail('ACCESS_REVOKED', 403);
    return { contract, grant, binding, config, person };
  }
  async function release(tx, task) {
    const grant = await readDoc(tx, COLLECTIONS.GRANTS, task.grantId);
    if (grant && grant.activeTaskId === task._id) await put(tx, COLLECTIONS.GRANTS, grant._id, { ...grant, activeTaskId: null });
  }
  async function expire(tx, task, timestamp) {
    if (!Number.isSafeInteger(task.expiresAt) || !Number.isSafeInteger(task.revision) || task.revision < 1 || !Object.hasOwn(MESSAGES, task.status)) fail();
    if (task.expiresAt > timestamp || !['queued', 'claimed', 'executing'].includes(task.status)) return task;
    const status = task.status === 'executing' ? 'unknown' : 'expired';
    const updated = { ...task, status, revision: next(task.revision), updatedAt: timestamp };
    await put(tx, COLLECTIONS.TASKS, task._id, updated);
    if (status === 'expired') await release(tx, updated);
    await audit(tx, 'clock', 'TASK_EXPIRED', task._id, timestamp, { status });
    return updated;
  }
  async function deny(tx, task, timestamp, code) {
    const updated = { ...task, status: 'denied', revision: next(task.revision), updatedAt: timestamp, denialCode: code };
    await put(tx, COLLECTIONS.TASKS, task._id, updated);
    await release(tx, updated);
    await audit(tx, 'authorization', 'TASK_DENIED', task._id, timestamp, { code });
    return updated;
  }
  function authorizationError(error) { return error && ['ACCESS_REVOKED', 'ACCESS_UNVERIFIED', 'IDENTITY_UNVERIFIED', 'BINDING_DISABLED', 'PROGRAM_DISABLED', 'LEASE_NOT_STARTED', 'LEASE_EXPIRED'].includes(error.code); }

  const service = {
    async getAdminRecord(actor, input) {
      admin(actor); const data = closedInput(input, ['kind', 'id']);
      const collections = { contract: COLLECTIONS.CONTRACTS, binding: COLLECTIONS.BINDINGS,
        worker: COLLECTIONS.WORKERS, program: COLLECTIONS.PROGRAM, task: COLLECTIONS.TASKS };
      if (typeof data.kind !== 'string' || !Object.hasOwn(collections, data.kind)) fail('INVALID_INPUT', 400);
      const id = data.kind === 'program' ? ids.program : ident(data.id);
      if (data.kind === 'program' && data.id !== undefined && data.id !== ids.program) fail('INVALID_INPUT', 400);
      return txRun(async (tx) => {
        const doc = await readDoc(tx, collections[data.kind], id);
        if (!doc) return { kind: data.kind, record: null };
        let record;
        if (data.kind === 'contract') record = contractView(doc);
        else if (data.kind === 'binding') record = bindingView(doc);
        else if (data.kind === 'worker') record = { workerId: doc._id, revision: doc.revision, deviceKey: doc.deviceKey, enabled: doc.enabled };
        else if (data.kind === 'program') record = { revision: doc.revision, enabled: doc.enabled, dispatchEnabled: doc.dispatchEnabled };
        else {
          const result = resultView(doc);
          record = { taskId: doc._id, revision: doc.revision, status: result.status, resolved: result.resolved,
            contractId: doc.contractId, expiresAt: result.expiresAt, message: result.message };
        }
        return { kind: data.kind, record };
      });
    },
    async configureProgram(actor, input) {
      admin(actor); const data = closedInput(input, ['expectedRevision', 'enabled', 'dispatchEnabled']);
      bool(data.enabled); bool(data.dispatchEnabled); revision(data.expectedRevision);
      if (data.dispatchEnabled && !data.enabled) fail('INVALID_INPUT', 400);
      return txRun(async (tx, timestamp) => {
        const old = await readDoc(tx, COLLECTIONS.PROGRAM, ids.program); expected(old, data.expectedRevision);
        const doc = { enabled: data.enabled, dispatchEnabled: data.dispatchEnabled, revision: old ? next(old.revision) : 1, updatedAt: timestamp };
        await put(tx, COLLECTIONS.PROGRAM, ids.program, doc); await audit(tx, actor.id, 'PROGRAM_CONFIGURED', ids.program, timestamp);
        return { revision: doc.revision, enabled: doc.enabled, dispatchEnabled: doc.dispatchEnabled };
      });
    },
    async setDoorBinding(actor, input) {
      admin(actor); const data = closedInput(input, ['bindingId', 'expectedRevision', 'houseId', 'displayName', 'deviceKey', 'doorNo', 'expectedModel', 'enabled']);
      for (const key of ['bindingId', 'houseId', 'deviceKey']) ident(data[key]);
      text(data.displayName, 128); text(data.expectedModel, 128); bool(data.enabled); revision(data.expectedRevision);
      if (!Number.isSafeInteger(data.doorNo) || data.doorNo < 1 || data.doorNo > 65535) fail('INVALID_INPUT', 400);
      // Configuration-time uniqueness evidence; other room writers are not a global unique lock.
      const rows = checkedQuery(await db.collection('rooms').where({ houseId: data.houseId }).limit(2).get()).data;
      if (rows.length !== 1 || !validId(rows[0]._id)) fail('HOUSE_UNVERIFIED', 409);
      const roomDocumentId = rows[0]._id;
      return txRun(async (tx, timestamp) => {
        const realRoom = await readDoc(tx, 'rooms', roomDocumentId);
        if (!realRoom || realRoom.houseId !== data.houseId) fail('HOUSE_UNVERIFIED', 409);
        const old = await readDoc(tx, COLLECTIONS.BINDINGS, data.bindingId); expected(old, data.expectedRevision);
        const doc = { ...data, roomDocumentId, revision: old ? next(old.revision) : 1, updatedAt: timestamp };
        delete doc.expectedRevision; delete doc.bindingId;
        await put(tx, COLLECTIONS.BINDINGS, data.bindingId, doc); await audit(tx, actor.id, 'DOOR_BOUND', data.bindingId, timestamp);
        return bindingView({ ...doc, _id: data.bindingId });
      });
    },
    async setWorker(actor, input) {
      admin(actor); const data = closedInput(input, ['workerId', 'expectedRevision', 'deviceKey', 'tokenHash', 'enabled']);
      ident(data.workerId); ident(data.deviceKey); bool(data.enabled); revision(data.expectedRevision);
      if (typeof data.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.tokenHash)) fail('INVALID_INPUT', 400);
      return txRun(async (tx, timestamp) => {
        const old = await readDoc(tx, COLLECTIONS.WORKERS, data.workerId); expected(old, data.expectedRevision);
        const doc = { deviceKey: data.deviceKey, tokenHash: data.tokenHash, enabled: data.enabled, revision: old ? next(old.revision) : 1, updatedAt: timestamp };
        await put(tx, COLLECTIONS.WORKERS, data.workerId, doc); await audit(tx, actor.id, 'WORKER_CONFIGURED', data.workerId, timestamp);
        return { workerId: data.workerId, revision: doc.revision, deviceKey: doc.deviceKey, enabled: doc.enabled };
      });
    },
    async confirmSignedLease(actor, input) {
      admin(actor); const data = closedInput(input, ['contractId', 'expectedRevision', 'userId', 'houseId', 'doorBindingId', 'startDate', 'endDate', 'signedEvidenceRef']);
      for (const key of ['contractId', 'userId', 'houseId', 'doorBindingId']) ident(data[key]);
      revision(data.expectedRevision); text(data.signedEvidenceRef, 512); const window = leaseWindow(data.startDate, data.endDate);
      return txRun(async (tx, timestamp) => {
        const old = await readDoc(tx, COLLECTIONS.CONTRACTS, data.contractId);
        const person = await canonical(tx, data.userId);
        const binding = await readDoc(tx, COLLECTIONS.BINDINGS, data.doorBindingId);
        if (!binding || binding.houseId !== data.houseId) fail('HOUSE_UNVERIFIED', 409);
        await room(tx, binding);
        if (old && (old.userId !== data.userId || old.houseId !== data.houseId || old.identityId !== person.identity._id || old.doorBindingId !== data.doorBindingId)) fail('CONTRACT_CONFLICT', 409);
        if (old && (!validContract(old) || old.appId !== person.trusted.appId)) fail('ACCESS_UNVERIFIED', 403);
        const identical = old && old.status === 'signed' && ['userId', 'houseId', 'doorBindingId', 'startDate', 'endDate', 'signedEvidenceRef'].every((key) => old[key] === data[key]);
        if (identical && (data.expectedRevision === old.revision || (old.revision === 1 && data.expectedRevision === 0))) {
          const pairedGrant = await readDoc(tx, COLLECTIONS.GRANTS, ids.grant(old._id));
          const pairedIndex = await readDoc(tx, COLLECTIONS.USER_ACCESS, ids.userAccess(data.userId));
          if (!validGrant(pairedGrant, old) || !validIndex(pairedIndex, data.userId, person.identity._id)
            || !pairedIndex.contractIds.includes(old._id)) fail('ACCESS_UNVERIFIED', 403);
          return contractView(old);
        }
        expected(old, data.expectedRevision);
        if (old && old.status !== 'signed') fail('CONTRACT_CONFLICT', 409);
        const rev = old ? next(old.revision) : 1;
        const doc = { schemaVersion: 1, status: 'signed', userId: data.userId, identityId: person.identity._id,
          appId: person.trusted.appId, houseId: data.houseId, doorBindingId: data.doorBindingId,
          ...window, signedEvidenceRef: data.signedEvidenceRef, signedAt: old ? old.signedAt : timestamp,
          revision: rev, createdAt: old ? old.createdAt : timestamp, updatedAt: timestamp };
        const grantId = ids.grant(data.contractId); const oldGrant = await readDoc(tx, COLLECTIONS.GRANTS, grantId);
        if (old && !validGrant(oldGrant, old)) fail('ACCESS_UNVERIFIED', 403);
        if (!old && oldGrant) fail('ACCESS_UNVERIFIED', 403);
        const grant = { schemaVersion: 1, contractId: data.contractId, contractRevision: rev, userId: data.userId, identityId: person.identity._id,
          houseId: data.houseId, doorBindingId: data.doorBindingId, status: 'active', revision: oldGrant ? next(oldGrant.revision) : 1,
          activeTaskId: oldGrant ? oldGrant.activeTaskId || null : null, updatedAt: timestamp };
        const indexId = ids.userAccess(data.userId); const index = await readDoc(tx, COLLECTIONS.USER_ACCESS, indexId);
        if ((index && !validIndex(index, data.userId, person.identity._id)) || (old && (!index || !index.contractIds.includes(old._id)))) fail('ACCESS_UNVERIFIED', 403);
        const contractIds = [...new Set([...(index ? index.contractIds : []), data.contractId])];
        if (contractIds.length > 100) fail('ACCESS_LIMIT', 409);
        await put(tx, COLLECTIONS.CONTRACTS, data.contractId, doc);
        await put(tx, COLLECTIONS.GRANTS, grantId, grant);
        await put(tx, COLLECTIONS.USER_ACCESS, indexId, { userId: data.userId, identityId: person.identity._id, contractIds,
          revision: index ? next(index.revision) : 1, updatedAt: timestamp });
        await audit(tx, actor.id, 'SIGNED_LEASE_CONFIRMED', data.contractId, timestamp, { revision: rev });
        return contractView({ ...doc, _id: data.contractId });
      });
    },
    async revokeLease(actor, input) {
      admin(actor); const data = closedInput(input, ['contractId', 'expectedRevision', 'reason']); ident(data.contractId); text(data.reason, 256); revision(data.expectedRevision);
      return txRun(async (tx, timestamp) => {
        const old = await readDoc(tx, COLLECTIONS.CONTRACTS, data.contractId); if (!old) fail('CONTRACT_NOT_FOUND', 404); expected(old, data.expectedRevision);
        if (old.status !== 'signed') fail('CONTRACT_CONFLICT', 409);
        const grant = await readDoc(tx, COLLECTIONS.GRANTS, ids.grant(old._id)); if (!grant) fail('ACCESS_UNVERIFIED', 403);
        const doc = { ...old, status: 'revoked', revision: next(old.revision), updatedAt: timestamp };
        await put(tx, COLLECTIONS.CONTRACTS, old._id, doc);
        await put(tx, COLLECTIONS.GRANTS, grant._id, { ...grant, status: 'revoked', contractRevision: doc.revision, revision: next(grant.revision), updatedAt: timestamp });
        await audit(tx, actor.id, 'LEASE_REVOKED', old._id, timestamp, { reason: data.reason });
        return { contractId: old._id, revision: doc.revision, status: 'revoked' };
      });
    },
    async listDoors(context, input = {}) {
      closedInput(input, []);
      // Keep each contract below the SDK transaction point-read budget. This list is
      // advisory; request/begin revalidate their complete authoritative facts atomically.
      const snapshot = await txRun(async (tx) => {
        const person = await resident(tx, context); const config = await program(tx);
        const index = await readDoc(tx, COLLECTIONS.USER_ACCESS, ids.userAccess(person.user._id));
        if (index && !validIndex(index, person.user._id, person.identity._id)) fail('ACCESS_UNVERIFIED', 403);
        return { enabled: config.enabled === true, userId: person.user._id, identityId: person.identity._id, contractIds: index ? index.contractIds : [] };
      });
      const doors = [];
      for (const contractId of snapshot.contractIds) {
        const entry = await txRun(async (tx, timestamp) => {
          const person = await resident(tx, context);
          if (person.user._id !== snapshot.userId || person.identity._id !== snapshot.identityId) fail('AUTH_FAILED', 403);
          const contract = await readDoc(tx, COLLECTIONS.CONTRACTS, contractId);
          if (!contract || contract.status !== 'signed' || contract.userId !== person.user._id || contract.identityId !== person.identity._id) return null;
          let reason = 'READY';
          try { await gate(tx, contractId, timestamp, { userId: person.user._id }); }
          catch (error) { if (!authorizationError(error)) throw error; reason = error.code; }
          const binding = await readDoc(tx, COLLECTIONS.BINDINGS, contract.doorBindingId);
          if (!binding || binding.houseId !== contract.houseId) return null;
          return { contractId, doorBindingId: contract.doorBindingId, displayName: binding.displayName,
            houseId: contract.houseId, startDate: contract.startDate, endDate: contract.endDate,
            validFrom: contract.validFrom, validUntil: contract.validUntil, canOpen: reason === 'READY', reason };
        });
        if (entry) doors.push(entry);
      }
      return { enabled: snapshot.enabled, doors };
    },
    async requestOpen(context, input) {
      const data = closedInput(input, ['contractId', 'requestId']); ident(data.contractId);
      if (typeof data.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(data.requestId)) fail('INVALID_INPUT', 400);
      const result = await txRun(async (tx, timestamp) => {
        const person = await resident(tx, context); const taskId = ids.task(person.user._id, data.requestId);
        let existing = await readDoc(tx, COLLECTIONS.TASKS, taskId);
        if (existing) {
          if (existing.userId !== person.user._id || existing.identityId !== person.identity._id || existing.contractId !== data.contractId) fail('REQUEST_CONFLICT', 409);
          existing = await expire(tx, existing, timestamp);
          return { taskId, status: existing.status, expiresAt: existing.expiresAt };
        }
        const facts = await gate(tx, data.contractId, timestamp, { userId: person.user._id });
        if (facts.grant.activeTaskId) {
          let active = await readDoc(tx, COLLECTIONS.TASKS, facts.grant.activeTaskId);
          if (!active || active.grantId !== facts.grant._id) fail('ACCESS_UNVERIFIED', 403);
          active = await expire(tx, active, timestamp);
          if (['queued', 'claimed'].includes(active.status) && (active.contractRevision !== facts.contract.revision || active.grantRevision !== facts.grant.revision
            || active.bindingRevision !== facts.binding.revision || active.programRevision !== facts.config.revision)) active = await deny(tx, active, timestamp, 'ACCESS_REVOKED');
          if (PENDING.has(active.status) && active.resolved !== true) return { error: 'REQUEST_IN_FLIGHT' };
        }
        const doc = { schemaVersion: 1, userId: person.user._id, identityId: person.identity._id, contractId: facts.contract._id,
          grantId: facts.grant._id, contractRevision: facts.contract.revision, grantRevision: facts.grant.revision,
          doorBindingId: facts.binding._id, bindingRevision: facts.binding.revision, programRevision: facts.config.revision,
          deviceKey: facts.binding.deviceKey, doorNo: facts.binding.doorNo, expectedModel: facts.binding.expectedModel,
          validFrom: facts.contract.validFrom, validUntil: facts.contract.validUntil,
          expiresAt: Math.min(timestamp + 30000, facts.contract.validUntil), status: 'queued', revision: 1,
          claimId: '', workerId: '', createdAt: timestamp, updatedAt: timestamp };
        await put(tx, COLLECTIONS.TASKS, taskId, doc);
        await put(tx, COLLECTIONS.GRANTS, facts.grant._id, { ...facts.grant, activeTaskId: taskId });
        await audit(tx, person.user._id, 'OPEN_REQUESTED', taskId, timestamp);
        return { taskId, status: 'queued', expiresAt: doc.expiresAt };
      });
      if (result.error) fail(result.error, 409);
      return result;
    },
    async getOpenResult(context, input) {
      const data = closedInput(input, ['taskId']); ident(data.taskId);
      return txRun(async (tx, timestamp) => {
        const person = await resident(tx, context); let task = await readDoc(tx, COLLECTIONS.TASKS, data.taskId);
        if (!task || task.userId !== person.user._id || task.identityId !== person.identity._id) fail('TASK_NOT_FOUND', 404);
        task = await expire(tx, task, timestamp);
        return resultView(task);
      });
    },
    async claimOpen(input) {
      const data = closedInput(input, ['workerId', 'token']);
      const who = await worker(db, data);
      const candidates = checkedQuery(await db.collection(COLLECTIONS.TASKS).where({ status: 'queued', deviceKey: who.deviceKey }).orderBy('createdAt', 'asc').limit(20).get()).data;
      for (const candidate of candidates) {
        if (!candidate || !validId(candidate._id)) fail();
        const claimed = await txRun(async (tx, timestamp) => {
          const currentWorker = await worker(tx, data); let task = await readDoc(tx, COLLECTIONS.TASKS, candidate._id);
          if (!task || task.status !== 'queued' || task.deviceKey !== currentWorker.deviceKey) return null;
          task = await expire(tx, task, timestamp); if (task.status !== 'queued') return null;
          try { await gate(tx, task.contractId, timestamp, { dispatch: true, task }); }
          catch (error) { if (!authorizationError(error)) throw error; await deny(tx, task, timestamp, error.code); return null; }
          const doc = { ...task, status: 'claimed', revision: next(task.revision), claimId: randomUUID(),
            workerId: currentWorker._id, workerRevision: currentWorker.revision, updatedAt: timestamp };
          await put(tx, COLLECTIONS.TASKS, task._id, doc); await audit(tx, currentWorker._id, 'OPEN_CLAIMED', task._id, timestamp);
          return taskView(doc);
        });
        if (claimed) return { task: claimed };
      }
      return { task: null };
    },
    async beginOpen(input) {
      const data = closedInput(input, ['workerId', 'token', 'taskId', 'claimId', 'revision']);
      ident(data.taskId); ident(data.claimId); revision(data.revision);
      const result = await txRun(async (tx, timestamp) => {
        const who = await worker(tx, data); let task = await readDoc(tx, COLLECTIONS.TASKS, data.taskId);
        if (!task || task.workerId !== who._id || task.claimId !== data.claimId || task.deviceKey !== who.deviceKey) fail('CLAIM_MISMATCH', 409);
        if (task.revision !== data.revision) fail('REVISION_CONFLICT', 409);
        if (task.status !== 'claimed') fail('TASK_NOT_CLAIMED', 409);
        task = await expire(tx, task, timestamp); if (task.status !== 'claimed') return { error: 'TASK_EXPIRED' };
        try {
          if (task.workerRevision !== who.revision) fail('ACCESS_REVOKED', 403);
          await gate(tx, task.contractId, timestamp, { dispatch: true, task });
        } catch (error) { if (!authorizationError(error)) throw error; await deny(tx, task, timestamp, error.code); return { error: error.code }; }
        const rev = next(task.revision); const doc = { ...task, status: 'executing', revision: rev, executionRevision: rev, beganAt: timestamp, updatedAt: timestamp };
        await put(tx, COLLECTIONS.TASKS, task._id, doc); await audit(tx, who._id, 'OPEN_EXECUTION_BEGAN', task._id, timestamp);
        return { task: taskView(doc) };
      });
      if (result.error) fail(result.error, 403);
      return result.task;
    },
    async reportOpen(input) {
      const data = closedInput(input, ['workerId', 'token', 'taskId', 'claimId', 'revision', 'status', 'deviceStatusCode']);
      ident(data.taskId); ident(data.claimId); revision(data.revision);
      if (!['device_confirmed', 'failed', 'unknown'].includes(data.status)
        || (data.status === 'device_confirmed' ? data.deviceStatusCode !== '1'
          : data.status === 'unknown' ? data.deviceStatusCode !== null
            : data.deviceStatusCode !== null && (typeof data.deviceStatusCode !== 'string' || !/^[2-7]$/.test(data.deviceStatusCode)))) fail('INVALID_INPUT', 400);
      return txRun(async (tx, timestamp) => {
        const who = await worker(tx, data); const task = await readDoc(tx, COLLECTIONS.TASKS, data.taskId);
        if (!task || task.workerId !== who._id || task.claimId !== data.claimId || task.deviceKey !== who.deviceKey) fail('CLAIM_MISMATCH', 409);
        const receipt = sha256(JSON.stringify([data.workerId, data.claimId, data.revision, data.status, data.deviceStatusCode]));
        if (task.reportReceipt) {
          if (task.reportReceipt !== receipt) fail('REPORT_CONFLICT', 409);
          return { taskId: task._id, status: task.status, revision: task.revision };
        }
        if (!['executing', 'unknown'].includes(task.status) || task.executionRevision !== data.revision) fail('REPORT_CONFLICT', 409);
        const doc = { ...task, status: data.status, deviceStatusCode: data.deviceStatusCode, reportReceipt: receipt,
          revision: next(task.revision), updatedAt: timestamp, reportedAt: timestamp };
        await put(tx, COLLECTIONS.TASKS, task._id, doc);
        if (data.status !== 'unknown') await release(tx, doc);
        await audit(tx, who._id, 'OPEN_REPORTED', task._id, timestamp, { status: data.status, deviceStatusCode: data.deviceStatusCode });
        return { taskId: task._id, status: doc.status, revision: doc.revision };
      });
    },
    async resolveUnknown(actor, input) {
      admin(actor); const data = closedInput(input, ['taskId', 'expectedRevision', 'reason']); ident(data.taskId); text(data.reason, 256); revision(data.expectedRevision);
      return txRun(async (tx, timestamp) => {
        const task = await readDoc(tx, COLLECTIONS.TASKS, data.taskId); if (!task) fail('TASK_NOT_FOUND', 404); expected(task, data.expectedRevision);
        if (task.resolved === true || (task.status !== 'unknown' && !(task.status === 'executing' && timestamp >= task.expiresAt))) fail('TASK_NOT_UNKNOWN', 409);
        const doc = { ...task, status: 'unknown', resolved: true, revision: next(task.revision), updatedAt: timestamp };
        await put(tx, COLLECTIONS.TASKS, task._id, doc); await release(tx, doc);
        await audit(tx, actor.id, 'UNKNOWN_DISPOSITION', task._id, timestamp, { reason: data.reason });
        return { taskId: task._id, revision: doc.revision, status: 'unknown', resolved: true };
      });
    },
    async verifiedAdmin(context) {
      return txRun(async (tx) => { const person = await resident(tx, context); if (person.user.role !== 'admin') fail('ADMIN_REQUIRED', 403); return { kind: 'admin', id: person.user._id }; });
    },
  };
  // All caller-visible errors are closed codes; never propagate SDK messages or submitted values.
  return Object.fromEntries(Object.entries(service).map(([key, method]) => [key, async (...args) => {
    try { return await method(...args); }
    catch (error) { if (error && SAFE_ERROR_CODES.includes(error.code)
      && Number.isInteger(error.status) && error.status >= 400 && error.status < 600) throw error; fail(); }
  }]));
}
module.exports = { createService, COLLECTIONS, ids, leaseWindow, SAFE_ERROR_CODES };
