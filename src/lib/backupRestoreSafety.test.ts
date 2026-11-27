import test from 'node:test';
import assert from 'node:assert/strict';
import {assertExistingBrokerProjections,restorableWorkspaceRows} from './backupRestoreSafety.ts';

test('preflight verifies all 205 server-owned MT5 projections in bounded read-only batches',async()=>{
  const rows=Array.from({length:205},(_,index)=>({
    id:'broker-'+index,trade_source:'mt5',pnl:10
  }));
  const calls:string[][]=[];
  const count=await assertExistingBrokerProjections(rows,async ids=>{
    calls.push(ids);
    return ids.map(id=>({id,trade_source:'mt5'}));
  });
  assert.equal(count,205);
  assert.deepEqual(calls.map(group=>group.length),[100,100,5]);
  assert.equal(restorableWorkspaceRows('trades',rows).length,0);
});

test('missing, altered or duplicate MT5 projection refuses restore before writer callback',async()=>{
  for(const kind of ['missing','manual','duplicate','invalid']){
    const input=[
      {id:'broker-one',trade_source:'mt5'},
      {id:kind==='duplicate'?'broker-one':kind==='invalid'?'':'broker-two',trade_source:'mt5'},
    ];
    const writer=()=>{throw new Error('writer must not be invoked')};
    let checked=0;
    await assert.rejects(async()=>{
      await assertExistingBrokerProjections(input,async ids=>{
        checked++;
        return ids.filter(x=>kind==='missing'?x!=='broker-two':true)
          .map(id=>({id,trade_source:kind==='manual'&&id==='broker-two'?'manual':'mt5'}));
      });
      writer();
    },/Broker-derived trades are missing|invalid or duplicate/);
    assert.ok(checked<=1);
  }
});

test('personal restore preserves manual trades but never upserts MT5 broker projections',()=>{
  const records=[
    {id:'broker',trade_source:'mt5',pnl:99},
    {id:'manual',trade_source:'manual',pnl:-10},
  ];
  assert.deepEqual(restorableWorkspaceRows('trades',records),[records[1]]);
  assert.deepEqual(restorableWorkspaceRows('journal_entries',records),records);
  assert.equal(restorableWorkspaceRows('trades',[]).length,0);
});
