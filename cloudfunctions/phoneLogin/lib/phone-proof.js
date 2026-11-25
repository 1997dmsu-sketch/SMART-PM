'use strict';

// Deployment-local copies must remain byte-identical. This collection is private;
// only a successful server-side WeChat phone exchange may create its proof.
const { fail, sha256, readDoc, putDoc, validIdentityBinding } = require('./identity-core');
const PHONE_BINDINGS = 'tenant_auth_phone_bindings';
function validPhone(phone) { return typeof phone === 'string' && /^[0-9]{6,15}$/.test(phone); }
function phoneBindingIdFor(appId, phone) { return `phone_${sha256(`${appId}\0${phone}`)}`; }
function proofMatches(proof, { trusted, identity, user, phone }) {
  return !!proof && proof._id === phoneBindingIdFor(trusted.appId, phone)
    && proof.schemaVersion === 1 && proof.appId === trusted.appId && proof.phoneHash === sha256(phone)
    && proof.identityId === identity._id && proof.userId === user._id
    && Number.isSafeInteger(proof.verifiedAt) && proof.verifiedAt > 0;
}
async function hasPhoneProof(db, { trusted, identity, user }) {
  if (!validPhone(user && user.phone) || !Number.isSafeInteger(user.phoneBoundAt) || user.phoneBoundAt <= 0
    || !validIdentityBinding(identity, user, trusted)) return false;
  const proof = await readDoc(db, PHONE_BINDINGS, phoneBindingIdFor(trusted.appId, user.phone));
  return proofMatches(proof, { trusted, identity, user, phone: user.phone })
    && proof.verifiedAt === user.phoneBoundAt;
}
async function bindPhone(tx, { trusted, identity, user, phone, timestamp }) {
  if (!validPhone(phone) || !validIdentityBinding(identity, user, trusted)) fail('IDENTITY_UNVERIFIED');
  // Phone changes and account transfers require a separately approved recovery
  // policy. A fresh authorization may only prove this user's current number.
  if (user.phone !== undefined && user.phone !== null && user.phone !== '' && user.phone !== phone) fail('PHONE_CONFLICT', 409);
  const id = phoneBindingIdFor(trusted.appId, phone);
  const proof = await readDoc(tx, PHONE_BINDINGS, id);
  if (proof && (proof.identityId !== identity._id || proof.userId !== user._id)) fail('PHONE_CONFLICT', 409);
  if (proof && (!proofMatches(proof, { trusted, identity, user, phone })
    || user.phone !== phone || user.phoneBoundAt !== proof.verifiedAt)) fail('IDENTITY_UNVERIFIED');
  await putDoc(tx, PHONE_BINDINGS, id, { schemaVersion: 1, appId: trusted.appId,
    phoneHash: sha256(phone), identityId: identity._id, userId: user._id, verifiedAt: timestamp });
}
module.exports = { PHONE_BINDINGS, validPhone, phoneBindingIdFor, hasPhoneProof, bindPhone };
