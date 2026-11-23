import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const worker = 'https://ym-fx-staging.ethical-hacker263.workers.dev';
if (process.env.YM3_STAGING_WORKER_NAME !== 'ym-fx-staging') throw Error('Refusing diagnostic outside staging.');
const config = 'wrangler.staging.jsonc';
const suffix = randomBytes(8).toString('hex');
const id = randomUUID();
const email = 'ym-login-probe-' + suffix + '@example.invalid';
const username = 'ym_probe_' + suffix;
const password = randomBytes(32).toString('base64url');
const salt = randomBytes(16).toString('base64');
// Run both paths: existing 600k hashes and pre-migration 100k hashes
// that are upgraded to 600k during their first successful login.
const legacy = process.env.YM3_PROBE_LEGACY === '1';
const iterations = legacy ? 100000 : 600000;
const encoded = pbkdf2Sync(password, Buffer.from(salt, 'base64'), iterations, 32, 'sha256').toString('base64');
const passwordHash = legacy ? encoded : 'pbkdf2-sha256$600000
const sql = (statement) => {
  const result = spawnSync('npx', ['wrangler','d1','execute','DB','--remote','--config',config,'--json','--command',statement],
    { encoding: 'utf8', maxBuffer: 1048576, timeout: 45000 });
  if (result.error || result.status !== 0) {
    throw Error('Staging diagnostic D1 operation failed with exit status ' + result.status + ': ' +
      String(result.stderr).slice(-450).replace(/ym-login-probe-[a-f0-9]+/g,'[probe]'));
  }
  let output;
  try { output = JSON.parse(result.stdout); } catch { throw Error('Staging D1 returned invalid JSON.'); }
  if (!Array.isArray(output) || output.some(entry => entry.success === false)) throw Error('Staging diagnostic D1 query was not successful.');
  return output;
};
let inserted = false;
try {
  sql("INSERT INTO users (id,email,username,display_name,password_hash,password_salt,created_at,updated_at) VALUES ('" +
    id + "','" + email + "','" + username + "','Temporary auth probe','" + passwordHash + "','" + salt +
    "','" + new Date().toISOString() + "','" + new Date().toISOString() + "')");
  inserted = true;
  const started = performance.now();
  const response = await fetch(worker + '/api/auth/signin', {
    method: 'POST',
    headers: { 'content-type':'application/json', 'accept':'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  const elapsed = Math.round(performance.now() - started);
  const type = response.headers.get('content-type') || '[missing]';
  const cfRay = response.headers.get('cf-ray') || '[missing]';
  console.log('Staging ' + (legacy ? 'legacy 100k upgrade' : 'existing 600k') + ' password sign-in: HTTP ' + response.status +
    '; content-type: ' + type + '; elapsed: ' + elapsed + 'ms; cf-ray: ' + cfRay);
  if (response.status !== 200) {
    const errorKind = /Worker exceeded resource limits|error 1102|Error 1102/i.test(text) ? 'cloudflare-resource-limit-1102'
      : /(?:DOCTYPE|html)/i.test(type + text.slice(0,200)) ? 'non-json-edge-response'
      : 'json-or-other';
    console.error('Staging sign-in failure kind: ' + errorKind + '. Response prefix: ' +
      text.slice(0,350).replace(/<[^>]*>/g,' ').replace(/[\r\n]+/g,' '));
    process.exitCode = 1;
  } else {
    let body;
    try { body = JSON.parse(text); } catch { throw Error('Successful response was not JSON.'); }
    if (!body?.user?.id || body.user.id !== id) throw Error('Sign-in succeeded but returned another user.');
    console.log('Validated successful ' + (legacy ? 'legacy 100k to 600k upgrade' : '600k password') + ' login against deployed staging Worker.');
  }
} finally {
  if (inserted) {
    sql("DELETE FROM sessions WHERE user_id='" + id + "'");
    sql("DELETE FROM users WHERE id='" + id + "' AND email='" + email + "'");
    console.log('Deleted isolated staging diagnostic user and session.');
  }
}
 + encoded;
const sql = (statement) => {
  const result = spawnSync('npx', ['wrangler','d1','execute','DB','--remote','--config',config,'--json','--command',statement],
    { encoding: 'utf8', maxBuffer: 1048576, timeout: 45000 });
  if (result.error || result.status !== 0) {
    throw Error('Staging diagnostic D1 operation failed with exit status ' + result.status + ': ' +
      String(result.stderr).slice(-450).replace(/ym-login-probe-[a-f0-9]+/g,'[probe]'));
  }
  let output;
  try { output = JSON.parse(result.stdout); } catch { throw Error('Staging D1 returned invalid JSON.'); }
  if (!Array.isArray(output) || output.some(entry => entry.success === false)) throw Error('Staging diagnostic D1 query was not successful.');
  return output;
};
let inserted = false;
try {
  sql("INSERT INTO users (id,email,username,display_name,password_hash,password_salt,created_at,updated_at) VALUES ('" +
    id + "','" + email + "','" + username + "','Temporary auth probe','" + passwordHash + "','" + salt +
    "','" + new Date().toISOString() + "','" + new Date().toISOString() + "')");
  inserted = true;
  const started = performance.now();
  const response = await fetch(worker + '/api/auth/signin', {
    method: 'POST',
    headers: { 'content-type':'application/json', 'accept':'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  const elapsed = Math.round(performance.now() - started);
  const type = response.headers.get('content-type') || '[missing]';
  const cfRay = response.headers.get('cf-ray') || '[missing]';
  console.log('Existing-format 600k PBKDF2 staging sign-in: HTTP ' + response.status +
    '; content-type: ' + type + '; elapsed: ' + elapsed + 'ms; cf-ray: ' + cfRay);
  if (response.status !== 200) {
    const errorKind = /Worker exceeded resource limits|error 1102|Error 1102/i.test(text) ? 'cloudflare-resource-limit-1102'
      : /(?:DOCTYPE|html)/i.test(type + text.slice(0,200)) ? 'non-json-edge-response'
      : 'json-or-other';
    console.error('Staging sign-in failure kind: ' + errorKind + '. Response prefix: ' +
      text.slice(0,350).replace(/<[^>]*>/g,' ').replace(/[\r\n]+/g,' '));
    process.exitCode = 1;
  } else {
    let body;
    try { body = JSON.parse(text); } catch { throw Error('Successful response was not JSON.'); }
    if (!body?.user?.id || body.user.id !== id) throw Error('Sign-in succeeded but returned another user.');
    console.log('Validated a true 600k PBKDF2 login against deployed staging Worker.');
  }
} finally {
  if (inserted) {
    sql("DELETE FROM sessions WHERE user_id='" + id + "'");
    sql("DELETE FROM users WHERE id='" + id + "' AND email='" + email + "'");
    console.log('Deleted isolated staging diagnostic user and session.');
  }
}
