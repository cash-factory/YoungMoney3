import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pnlTone, signedMoney } from './tradingTone.ts';

test('financial outcomes do not depend on long or short direction', () => {
  assert.equal(pnlTone(25), 'positive');
  assert.equal(pnlTone('-25.20'), 'negative');
  assert.equal(pnlTone(0), 'neutral');
  assert.equal(pnlTone('unavailable'), 'neutral');
  assert.equal(pnlTone(null), 'neutral');
  assert.equal(pnlTone(200, true), 'pending');
});
test('a plus sign is applied only to genuine gains', () => {
  assert.equal(signedMoney(20, '$20.00'), '+$20.00');
  assert.equal(signedMoney(-20, '-$20.00'), '-$20.00');
  assert.equal(signedMoney(0, '$0.00'), '$0.00');
});
