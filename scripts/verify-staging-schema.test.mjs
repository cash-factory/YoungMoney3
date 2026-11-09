import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertStagingSchema } from './verify-staging-schema.mjs';

const good={success:true,results:[{mt5_columns:4,admin_tables:2,required_migrations:3}]};
test('staging schema accepts complete MT5 and recovery migrations',()=>{
  assert.equal(assertStagingSchema([good]),true);
});
test('staging schema fails closed on missing migrations or query errors',()=>{
  for(const part of [{mt5_columns:3},{admin_tables:1},{required_migrations:2}]){
    const row={...good.results[0],...part};
    assert.throws(()=>assertStagingSchema([{success:true,results:[row]}]),/schema is incomplete/);
  }
  for(const bad of [[],null,[{success:false,results:[good.results[0]]}],[{success:true,results:[]}]]){
    assert.throws(()=>assertStagingSchema(bad));
  }
});
