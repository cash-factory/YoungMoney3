import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUsername,validUsername,usernameSuggestions} from './username.ts';
test('usernames normalize and validate the same way on web and Worker',()=>{
  assert.equal(normalizeUsername('  TrAdEr_FX  '),'trader_fx');
  for(const value of ['abc','abc_92','Name', 'a'.repeat(32)])assert.equal(validUsername(value),true,value);
  for(const value of ['ab','-invalid','has space','a'.repeat(33),'abc@example.com'])assert.equal(validUsername(value),false,value);
});
test('available alternatives are formatted, distinct, and are only suggestions',()=>{
  const options=usernameSuggestions('Trader');
  assert.ok(options.length>=3);
  assert.equal(new Set(options).size,options.length);
  assert.ok(options.every(option=>validUsername(option) && option!=='trader'));
  assert.ok(usernameSuggestions('a'.repeat(32)).every(option=>option.length<=32));
});
