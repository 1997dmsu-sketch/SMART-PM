'use strict';
const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { fail } = require('./identity-core');
const derive = promisify(scrypt);
const PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const KEY_LENGTH = 64;
const DUMMY = Object.freeze({ algorithm: 'scrypt-v1', saltHex: '01'.repeat(32), hashHex: '02'.repeat(KEY_LENGTH) });

function normalizeUsername(value) {
  if (typeof value !== 'string') fail('INVALID_INPUT', 400);
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{3,31}$/.test(username)) fail('INVALID_INPUT', 400);
  return username;
}
function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128 || Buffer.byteLength(value, 'utf8') > 256) fail('INVALID_INPUT', 400);
  return value; // Preserve spaces, case and Unicode exactly; no trim/normalize.
}
function validPasswordHash(value) {
  return !!value && value.algorithm === 'scrypt-v1' && typeof value.saltHex === 'string'
    && /^[a-f0-9]{64}$/.test(value.saltHex) && typeof value.hashHex === 'string'
    && /^[a-f0-9]{128}$/.test(value.hashHex);
}
async function hashPassword(value) {
  const password = validatePassword(value);
  const salt = randomBytes(32);
  const hash = await derive(password, salt, KEY_LENGTH, PARAMS);
  return { algorithm: 'scrypt-v1', saltHex: salt.toString('hex'), hashHex: hash.toString('hex') };
}
async function verifyPassword(value, stored) {
  const password = validatePassword(value);
  const valid = validPasswordHash(stored);
  const target = valid ? stored : DUMMY;
  const actual = await derive(password, Buffer.from(target.saltHex, 'hex'), KEY_LENGTH, PARAMS);
  const matches = timingSafeEqual(actual, Buffer.from(target.hashHex, 'hex'));
  return valid && matches;
}
module.exports = { normalizeUsername, validatePassword, validPasswordHash, hashPassword, verifyPassword };
