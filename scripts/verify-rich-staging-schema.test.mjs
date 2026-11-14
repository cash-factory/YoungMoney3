import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertRichSchema } from './verify-rich-staging-schema.mjs';

test('rich staging schema must contain all immutable evidence tables and timezone columns',()=>{
  const good=[{success:true,results:[{rich_tables:4,timezone_columns:4,new_migration:1}]}];
  assert.equal(assertRichSchema(good),true);
  for(const fields of [{rich_tables:3},{timezone_columns:3},{new_migration:0}]) {
    assert.throws(()=>assertRichSchema([{success:true,results:[{...good[0].results[0],...fields}]}]));
  }
  assert.throws(()=>assertRichSchema([{success:false,results:good[0].results}]));
});
