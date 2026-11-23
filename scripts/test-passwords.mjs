import assert from 'node:assert/strict';
import test from 'node:test';
import { pbkdf2Sync } from 'node:crypto';
import { PASSWORD_ITERATIONS, hashPassword, verifyPassword } from '../worker/passwords.ts';

test('new passwords use explicit PBKDF2-HMAC-SHA256 600k cost and unique random salts', async () => {
  const a = await hashPassword('a long, unique password 🦊');
  const b = await hashPassword('a long, unique password 🦊');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.match(a.hash, new RegExp('^pbkdf2-sha256\\$' + PASSWORD_ITERATIONS + '\\$'));
  assert.deepEqual(await verifyPassword('a long, unique password 🦊', a.salt, a.hash),
    { valid: true, needsUpgrade: false });
  assert.equal((await verifyPassword('incorrect', a.salt, a.hash)).valid, false);
});

test('existing unversioned 100k hashes remain verifiable until they are transparently upgraded', async () => {
  const salt = Buffer.from('this-is-16-bytes').toString('base64');
  const oldHash = pbkdf2Sync('legacy-phrase', Buffer.from(salt, 'base64'), 100000, 32, 'sha256').toString('base64');
  assert.deepEqual(await verifyPassword('legacy-phrase', salt, oldHash),
    { valid: true, needsUpgrade: true });
  assert.deepEqual(await verifyPassword('incorrect', salt, oldHash),
    { valid: false, needsUpgrade: false });
});

test('Cloudflare-compatible derivation retains byte-for-byte existing 600k hashes', async () => {
  const salt = Buffer.from('sixteen-byte-key').toString('base64');
  const phrase = 'preserve the already stored D1 verifier';
  const expected = pbkdf2Sync(phrase, Buffer.from(salt, 'base64'), 600000, 32, 'sha256').toString('base64');
  assert.deepEqual(await verifyPassword(phrase, salt, 'pbkdf2-sha256$600000$' + expected),
    { valid: true, needsUpgrade: false });
  assert.deepEqual(await verifyPassword('incorrect', salt, 'pbkdf2-sha256$600000$' + expected),
    { valid: false, needsUpgrade: false });
  const created = await hashPassword('standards-interoperable-password');
  const saltBytes = Buffer.from(created.salt, 'base64');
  const canonical = pbkdf2Sync('standards-interoperable-password',saltBytes,PASSWORD_ITERATIONS,32,'sha256').toString('base64');
  assert.equal(created.hash,'pbkdf2-sha256$'+PASSWORD_ITERATIONS+'$'+canonical);
});
test('unknown formats, truncated hashes and pathological work factors fail closed', async () => {
  const salt = Buffer.from('this-is-16-bytes').toString('base64');
  for (const hash of [
    '', 'not a hash', 'pbkdf2-sha256$9000000$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    'pbkdf2-sha256$999$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    'pbkdf2-sha512$600000$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    'pbkdf2-sha256$600000$broken',
    'AAAA',
  ]) {
    assert.deepEqual(await verifyPassword('secret', salt, hash),
      { valid: false, needsUpgrade: false }, 'unexpectedly accepted ' + hash);
  }
  assert.deepEqual(await verifyPassword('secret', 'invalid', 'AAAA'),
    { valid: false, needsUpgrade: false });
});
