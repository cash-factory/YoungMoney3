import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMediaLibrary } from './mediaLibrary.ts';

test('library merges storage and entry aliases while retaining cross-record trade references', () => {
  const source = 'private-media://trading-media/owner/chart.png';
  const assets = buildMediaLibrary('owner', {
    trades: [{ id: 'trade-1', user_id: 'owner', pair: 'EUR/USD', screenshot_url: source, entry_screenshot_url: source, entry_time: '2026-11-17' }],
    journal_entries: [{ id: 'journal-1', user_id: 'owner', screenshot_url: source, linked_trade_ids: ['trade-1'], created_at: '2026-11-17' }],
  }, [{ name: 'chart.png' }, { name: 'memo.webm' }]);
  assert.equal(assets.length, 2);
  const chart = assets.find(asset => asset.kind === 'image')!;
  assert.equal(chart.references.length, 2);
  assert.equal(chart.references[0].phase, 'entry');
  assert.deepEqual(chart.references[1].tradeIds, ['trade-1']);
  assert.equal(assets.find(asset => asset.kind === 'audio')?.references.length, 0);
});

test('library excludes other owners, invalid private paths and non-media objects', () => {
  const assets = buildMediaLibrary('owner', { trades: [
    { id: 'other', user_id: 'someone', screenshot_url: 'https://example.com/other.png' },
    { id: 'mine', user_id: 'owner', screenshot_url: 'private-media://trading-media/someone/file.png' },
    { id: 'traversal', user_id: 'owner', screenshot_url: 'private-media://trading-media/owner/../someone/file.png' },
  ] }, [{ name: '../other.png' }, { name: 'unsupported.exe' }, { name: 'folder/chart.jpg' }]);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].source, 'private-media://trading-media/owner/folder/chart.jpg');
});

test('closure attachments keep closure context and sort newest first', () => {
  const assets = buildMediaLibrary('owner', { trades: [{ id: 'a', user_id: 'owner', pair: 'GBP/USD',
    entry_screenshot_url: 'entry.png', closure_voice_note_url: 'close.webm', entry_time: '2026-11-15', exit_time: '2026-11-17' }] });
  assert.equal(assets[0].kind, 'audio');
  assert.equal(assets[0].references[0].phase, 'closure');
  assert.equal(assets[0].references[0].tradeIds[0], 'a');
});

test('documents and study covers link to their owner records', () => {
  const doc = 'private-media://trading-media/owner/playbook.pdf';
  const cover = 'private-media://trading-media/owner/phase.png';
  const assets = buildMediaLibrary('owner', {
    study_materials: [{id:'s',user_id:'owner',title:'Phase drill',url:doc,cover_image_url:cover}],
    trading_plans: [{id:'p',user_id:'owner',title:'Plan',screenshot_url:doc}],
  }, [{name:'playbook.pdf'}]);
  assert.equal(assets.find(a => a.kind === 'document')?.references.length, 2);
  assert.equal(assets.find(a => a.kind === 'image')?.source, cover);
});
