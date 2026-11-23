import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateExperiment, validStudyDate, validateExperiment, type ImprovementExperiment } from './improvementLab.ts';
import type { DecisionReview } from './decisionReplay.ts';

const study: ImprovementExperiment = {
  id:'study-1',user_id:'a',title:'Wait for the entry confirmation',
  hypothesis:'Waiting for a candle close should help me follow my documented entry rules.',
  single_change:'Wait for the confirmation candle to close before placing an order.',
  strategy_id:'strategy-a',account_id:'account-a',metric:'plan_adherence',
  start_date:'2026-11-01',end_date:'2026-11-30',baseline_days:30,
  minimum_samples:5,status:'active',conclusion:'',created_at:'',updated_at:'',
};
let reviewSequence=0;
const review=(day:string, verdict:DecisionReview['verdict'],extra:Partial<DecisionReview>={}):DecisionReview=>({
  id:'r'+day+'-'+(++reviewSequence),reference:'trade/example-'+reviewSequence,entry_time:day+'T12:30:00Z',
  account_id:'account-a',strategy_id:'strategy-a',entry_model_id:null,
  strategy_name:'',model_name:'',symbol:'EURUSD',
  verdict,trigger:'',note:'',screenshot_url:null,voice_note_url:null,
  updated_at:'2026-11-23T00:00:00Z',
  commitment_id:null,commitment_text:'',commitment_result:null,...extra,
});
test('validates preregistered experiment design and date boundaries',()=>{
  assert.equal(validStudyDate('2026-02-29'),false);
  assert.equal(validStudyDate('2028-02-29'),true);
  assert.equal(validateExperiment(study),null);
  assert.match(validateExperiment({...study,end_date:'2026-10-31'})||'',/dates/);
  assert.match(validateExperiment({...study,minimum_samples:3})||'',/5–500/);
  assert.match(validateExperiment({...study,hypothesis:'vague'})||'',/testable/);
});
test('separates baseline and intervention by original trade date, never review save time',()=>{
  const dates = [
    ...['2026-10-06','2026-10-08','2026-10-10','2026-10-12','2026-10-14'].map(d=>review(d,'changed')),
    ...['2026-11-02','2026-11-04','2026-11-06','2026-11-08','2026-11-10'].map(d=>review(d,'followed',
      {pre_reveal_verdict:'followed',pre_reveal_at:'2026-11-20T00:00:00Z'})),
    review('2026-12-01','changed'),
    review('2026-09-01','followed'),
    review('2026-11-12','followed',{account_id:'some-other-account'}),
    review('2026-11-13','followed',{strategy_id:'other-strategy'}),
    review('2026-11-14','unsure'),
  ];
  const result=evaluateExperiment(study,dates);
  assert.deepEqual([result.baseline.eligible,result.intervention.eligible],[5,5]);
  assert.deepEqual([result.baseline.adherence,result.intervention.adherence,result.percentage_point_change],[0,100,100]);
  assert.deepEqual([result.baseline.retrospective,result.intervention.pre_reveal],[5,5]);
  assert.equal(result.intervention.uncertain,1);
  assert.equal(result.enough_evidence,true);
  assert.ok(result.limitations.some(s=>s.includes('causation')));
});
test('a small or unknown sample never becomes a performance conclusion',()=>{
  const result=evaluateExperiment(study,[review('2026-11-14','unsure'),review('2026-11-18',null)]);
  assert.equal(result.baseline.adherence,null);
  assert.equal(result.intervention.eligible,0);
  assert.equal(result.percentage_point_change,null);
  assert.equal(result.enough_evidence,false);
  assert.ok(result.limitations.some(s=>s.includes('minimum sample')));
});
test('pre-reveal recorded verdict takes priority over editable retrospective verdict',()=>{
  const result=evaluateExperiment({...study,minimum_samples:5},[
    review('2026-10-12','changed',{pre_reveal_verdict:'followed',pre_reveal_at:'2026-10-12T10:00:00Z'}),
    review('2026-11-12','followed',{pre_reveal_verdict:'changed',pre_reveal_at:'2026-11-12T10:00:00Z'}),
  ]);
  assert.equal(result.baseline.followed,1);
  assert.equal(result.intervention.changed,1);
});

test('newly activated studies exclude pre-activation and retrospective interventions',()=>{
  const sealed = (day:string, when:string) => review(day,'followed',{
    pre_reveal_verdict:'followed',pre_reveal_at:when
  });
  const registered: ImprovementExperiment = {
    ...study, activated_at:'2026-11-04T09:00:00Z',
  };
  const outcome=evaluateExperiment(registered,[
    ...['2026-10-06','2026-10-08','2026-10-10','2026-10-12','2026-10-14'].map(d=>review(d,'changed')),
    sealed('2026-11-02','2026-11-02T13:00:00Z'),
    sealed('2026-11-04','2026-11-04T08:00:00Z'),
    review('2026-11-05','followed'),
    ...['2026-11-06','2026-11-08','2026-11-10','2026-11-12','2026-11-14'].map(d=>sealed(d,d+'T13:00:00Z')),
  ]);
  assert.equal(outcome.prospective,true);
  assert.equal(outcome.excluded_intervention,3,
    'Pre-activation entries and unsealed retrospective verdicts must not count.');
  assert.equal(outcome.intervention.eligible,5);
  assert.equal(outcome.intervention.pre_reveal,5);
  assert.equal(outcome.intervention.retrospective,0);
  assert.equal(outcome.enough_evidence,true);
  assert.equal(outcome.percentage_point_change,100);
  assert.ok(outcome.limitations.some(x=>x.includes('excluded')));
});
test('legacy active and draft studies never claim verified prospective evidence',()=>{
  const old=evaluateExperiment(study,[review('2026-11-10','followed')]);
  assert.equal(old.prospective,false);
  assert.equal(old.excluded_intervention,0);
  assert.ok(old.limitations.some(x=>x.includes('No verifiable server activation')));
});
test('duplicate references are a single decision even if later revisions use different row ids',()=>{
  const rows=[
    review('2026-11-10','followed',{id:'version-1',reference:'trade/same'}),
    review('2026-11-10','followed',{id:'version-2',reference:'trade/same'}),
  ];
  const result=evaluateExperiment(study,rows);
  assert.equal(result.intervention.eligible,1);
});

test('restored annotations with forged timestamps cannot become prospective observations',()=>{
  const registered: ImprovementExperiment={...study,activated_at:'2026-11-04T09:00:00Z'};
  const result=evaluateExperiment(registered,[
    review('2026-11-10','changed',{
      imported_unverified:true,
      pre_reveal_verdict:'followed',pre_reveal_at:'2026-11-10T13:00:00Z',
    }),
  ]);
  assert.equal(result.prospective,true);
  assert.equal(result.excluded_intervention,1);
  assert.equal(result.intervention.eligible,0);
  assert.equal(result.percentage_point_change,null);
  assert.ok(result.limitations.some(x=>x.includes('Restored reviews')));
});
test('originating review references must match known trade or position syntax',()=>{
  assert.equal(validateExperiment({...study,source_reference:'trade/fixture-trade-1'}),null);
  assert.equal(validateExperiment({...study,source_reference:'position/link-id/123:0'}),null);
  assert.match(validateExperiment({...study,source_reference:'review/other-user/not-owned'})||'',/valid decision review/);
  assert.match(validateExperiment({...study,source_reference:'trade/fake\\path'})||'',/valid decision review/);
});
