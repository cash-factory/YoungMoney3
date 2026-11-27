import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../desktop-ui/assets/native-guide.js', import.meta.url), 'utf8');
const store = new Map();
const context = {
  window: {},
  localStorage: {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  },
};
runInNewContext(source, context, { filename: 'native-guide.js' });
const guide = context.window.YMFXNativeGuide;
assert.ok(guide && typeof guide.render === 'function' && typeof guide.handleClick === 'function');

const screens = [], commands = [];
let revisions = 0;
const controls = {
  screen: {
    icon: name => '<span data-icon="' + name + '"></span>',
    media: () => '<svg aria-hidden="true"></svg>',
    navigate: name => screens.push(name),
  },
  model: { paired: true, sessions: [{ verified_link: true, status: 'monitoring' }] },
  intro: (title, detail) => '<h1>' + title + '</h1><p>' + detail + '</p>',
  safe: input => String(input),
  action: () => '',
};
const deps = {
  screen: controls.screen,
  nativeCommand: name => commands.push(name),
  refreshView: () => { revisions++; },
};
function click(attribute, value) {
  const result = guide.handleClick({ target: {
    closest: selector => selector === '[' + attribute + ']'
      ? { dataset: {
          nativeGuideTopic: value, nativeGuideJump: value, nativeGuideMove: value,
          nativeGuideFaq: value, nativeGuideOpen: value,
        } } : null,
  } }, deps);
  assert.equal(result, true, 'Guide interaction should be handled: ' + attribute);
}
let html = guide.render(controls);
assert.match(html, /Get connected/);
assert.match(html, /Step 1: Connect your Windows computer/);
assert.match(html, /PC paired/);
assert.match(html, /1 of 16/);
assert.match(html, /No broker credentials/);
click('data-native-guide-topic', 'recover');
html = guide.render(controls);
assert.match(html, /Fix a disconnection/);
assert.match(html, /Check the PC connection first/);
click('data-native-guide-move', 'next');
html = guide.render(controls);
assert.match(html, /Inspect the affected MT5 account/);
click('data-native-guide-open', 'accounts');
assert.deepEqual(screens, ['accounts']);
assert.deepEqual(commands, [], 'Guide navigation may not start capture or copying');
click('data-native-guide-topic', 'copy');
html = guide.render(controls);
assert.match(html, /cannot arm a fleet or submit copied trades/);
click('data-native-guide-faq', '3');
html = guide.render(controls);
assert.match(html, /id="native-guide-answer-3"\s*><p>/);
assert.equal(guide.handleInput({target: {matches: selector => selector === '[data-native-guide-search]', value: 'broker records'}}, deps.refreshView), true);
html = guide.render(controls);
assert.match(html, /What happens if broker records disagree/);
assert.doesNotMatch(html, /Why does my PC say connected/);
assert.ok(revisions >= 3);
assert.ok(store.has('ymfx:native-guide-progress:v1'), 'Only local learning progress is stored');
console.log('Native interactive guide: routes, navigation, FAQ search, progress and safe screen navigation passed');
