import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptBackup, decryptBackup, isEncryptedBackup } from './backupEncryption.ts';
test('encrypted backup round-trips and rejects a wrong password',async()=>{
  const original=JSON.stringify({format:'trade-journal-pro-backup',notes:'Very private trading notes'});
  const payload=await encryptBackup(original,'correct horse battery staple');
  assert.ok(isEncryptedBackup(payload));
  assert.ok(!JSON.stringify(payload).includes('Very private trading notes'));
  assert.equal(await decryptBackup(payload,'correct horse battery staple'),original);
  await assert.rejects(()=>decryptBackup(payload,'wrong passphrase'),/Could not unlock/);
  assert.equal(isEncryptedBackup({...payload,iterations:1}),false);
});
