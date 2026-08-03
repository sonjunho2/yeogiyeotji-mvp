'use strict';

const crypto = require('node:crypto');

function hashPassword(password, optionalSalt) {
  if (typeof password !== 'string') throw new TypeError('password must be a string');
  const salt = optionalSalt === undefined ? crypto.randomBytes(16) : (Buffer.isBuffer(optionalSalt) ? optionalSalt : Buffer.from(optionalSalt, 'hex'));
  const hash = crypto.scryptSync(password, salt, 64);
  return { passwordSalt: salt.toString('hex'), passwordHash: hash.toString('hex') };
}

function verifyPassword(password, user) {
  try {
    if (typeof password !== 'string' || !user || typeof user.passwordHash !== 'string' || typeof user.passwordSalt !== 'string') return false;
    const expected = Buffer.from(user.passwordHash, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(user.passwordSalt, 'hex'), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) { return false; }
}

module.exports = { hashPassword, verifyPassword };
