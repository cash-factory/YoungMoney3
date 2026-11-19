import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertRichSchema } from './verify-rich-staging-schema.mjs';

test('rich staging schema must contain all immutable evidence tables and timezone columns',()=>{
  const good=[{success:true,results:[{rich_tables:4,timezone_columns:4,new_migration:1,history_triggers:3,retry_columns:2,setup_columns:2,monitoring_column:1,extended_history_columns:5,history_migration:1}]}];
  assert.equal(assertRichSchema(good),true);
  for(const fields of [{rich_tables:3},{timezone_columns:3},{new_migration:0},{history_triggers:2},{retry_columns:1},{setup_columns:1},{monitoring_column:0},{extended_history_columns:4},{history_migration:0}]) {
    assert.throws(()=>assertRichSchema([{success:true,results:[{...good[0].results[0],...fields}]}]));
  }
  assert.throws(()=>assertRichSchema([{success:false,results:good[0].results}]));
});
