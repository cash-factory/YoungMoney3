import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildOwnerRecoverySql} from './ownerRecoveryPlan.mjs';

test('owner recovery is scoped to one known administrator and revokes sessions',()=>{
 const data=buildOwnerRecoverySql({
  email:"owner@example.test",userId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  hash:'hash-fixture',salt:'salt-fixture',auditId:'audit-fixture',stamp:'2026-11-09T10:00:00Z'
 });
 assert.match(data,/WHERE id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' AND email='owner@example.test' AND role='admin'/);
 assert.match(data,/DELETE FROM sessions WHERE user_id=/);
 assert.match(data,/DELETE FROM recovery_codes WHERE user_id=/);
 assert.match(data,/operator-admin-recovery/);
 assert.doesNotMatch(data,/password123/);
});
test('invalid administrator identifier cannot produce a dangerous blanket update',()=>{
 assert.throws(()=>buildOwnerRecoverySql({email:'x@example.test',userId:'x OR 1=1',hash:'a',salt:'b',auditId:'c',stamp:'now'}));
});
