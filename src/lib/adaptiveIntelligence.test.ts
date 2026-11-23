import assert from 'node:assert/strict';
import test from 'node:test';
import { recommendDeskFocus, type DeskSignals } from './adaptiveIntelligence.ts';

const base:DeskSignals={
  hasAccounts:true,hasPlan:true,hasRiskSettings:true,
  pendingReviews:0,reviewed:6,sealedReviews:3,recentChanged:1,recentAssessed:5,
  activeExperiments:0,evidenceAvailable:true,
};
test('prioritizes configuration gaps without suggesting trades',()=>{
  assert.equal(recommendDeskFocus({...base,hasAccounts:false}).mode,'prepare');
  assert.equal(recommendDeskFocus({...base,hasPlan:false}).mode,'prepare');
  assert.equal(recommendDeskFocus({...base,hasRiskSettings:false}).mode,'prepare');
  assert.equal(recommendDeskFocus(base).mode,'capture');
  assert.match(recommendDeskFocus(base).basis,/not a recommendation to trade/i);
});
test('review work outranks retrospective patterns and active experiments',()=>{
  const value=recommendDeskFocus({...base,pendingReviews:2,activeExperiments:1,reviewed:30,sealedReviews:20});
  assert.equal(value.mode,'review');
  assert.match(value.basis,/selected account/);
  assert.match(recommendDeskFocus({...base,recentAssessed:8,recentChanged:4}).basis,/self-reports/);
});
test('active studies and sufficient sealed history route to analysis',()=>{
  assert.equal(recommendDeskFocus({...base,activeExperiments:2}).mode,'analyze');
  const result=recommendDeskFocus({...base,reviewed:15,sealedReviews:6});
  assert.equal(result.mode,'analyze');
  assert.match(result.basis,/15 reviews/);
});
test('missing decision evidence never masquerades as zero activity',()=>{
  const result=recommendDeskFocus({...base,evidenceAvailable:false,reviewed:30,pendingReviews:9});
  assert.equal(result.mode,'prepare');
  assert.match(result.basis,/could not be verified/);
});
