/* Interactive help for the real Windows connector. No demo trades or automatic broker actions. */
(() => {
  'use strict';
  const STORAGE_KEY = 'ymfx:native-guide-progress:v1';
  const GUIDES = [
    {
      id: 'start', name: 'Get connected', label: 'Start here',
      summary: 'From your first pairing code to a verified broker account.',
      steps: [
        { title: 'Connect your Windows computer', body: 'Sign in to YoungMoney3 in your browser and create a short-lived pairing code. Enter it under Connect this PC. Pairing identifies the computer; it does not start trading or copying.', tip: 'Treat the pairing code like a password. Do not share it or save it in screenshots.', where: 'pair', button: 'Open pairing screen' },
        { title: 'Add a dedicated MT5 login', body: 'Select Add MT5 account and let the connector locate your installed MetaTrader 5 program. Choose the installation, open the private terminal and sign in with your broker there.', tip: 'Your broker password belongs in the MT5 login window, not in this help guide.', where: 'accounts', button: 'Open My Accounts' },
        { title: 'Choose what gets monitored', body: 'Return to the signed-in dashboard, scan accounts from this paired PC, identify the correct broker login, and explicitly enable monitoring for that account.', tip: 'Each account uses a separate local terminal session. New sessions start with monitoring off.', where: 'dashboard', button: 'Open dashboard' },
        { title: 'Confirm actual trade capture', body: 'Check the account status and recent capture events. A connected PC alone does not mean trade evidence is arriving in your journal.', tip: 'Look for a verified broker login and confirmed scans before relying on journal metrics.', where: 'accounts', button: 'Review account status' },
      ],
    },
    {
      id: 'monitor', name: 'Monitor accounts', label: 'Daily workflow',
      summary: 'Know exactly what is live, paused, or waiting for attention.',
      steps: [
        { title: 'Choose the correct account', body: 'Open My Accounts and inspect the broker server and login number. A friendly account label is not proof of identity.', tip: 'Use the verified login and server to distinguish accounts.', where: 'accounts', button: 'Inspect accounts' },
        { title: 'Start monitoring deliberately', body: 'Use Start monitoring in the operations hub only when your dashboard monitoring choices are correct. The button requests capture; completion must still be confirmed.', tip: 'Monitoring reads broker evidence. It does not grant order-copying permission.', where: 'home', button: 'Open operations hub' },
        { title: 'Check the last confirmed scan', body: 'In My Accounts, review each session’s capture state and last completed scan. An online computer with an unverified session needs further attention.', tip: 'If the account cannot be identified, verify its MT5 login before changing settings.', where: 'accounts', button: 'View capture state' },
        { title: 'Review activity before drawing conclusions', body: 'Recent Activity helps explain reconnections, uploads, and errors. It is an operational log—not a substitute for actual broker fills in your journal.', tip: 'Evaluate trades from immutable broker records, not just connector messages.', where: 'activity', button: 'Open Recent Activity' },
      ],
    },
    {
      id: 'recover', name: 'Fix a disconnection', label: 'Troubleshooting',
      summary: 'Recover missing time without duplicating broker records.',
      steps: [
        { title: 'Check the PC connection first', body: 'Look at Connect this PC. If pairing is lost, restore it with a fresh dashboard code. Do not re-pair merely because one account is paused.', tip: 'Computer connection and account monitoring are different states.', where: 'pair', button: 'Check connection' },
        { title: 'Inspect the affected MT5 account', body: 'Find the account that needs attention. Verify the terminal is present, the broker login is correct, and the account is enabled for capture.', tip: 'Do not remove a session just to clear an error. Removal does not repair broker history.', where: 'accounts', button: 'Inspect session' },
        { title: 'Request a broker-history recheck', body: 'When the session is verified and monitoring is running, choose Recheck broker history for that account. The connector then requests a reconciliation cycle.', tip: 'A recheck request is not a guarantee that every missing fill has already arrived.', where: 'accounts', button: 'Find recheck control' },
        { title: 'Confirm recovery with evidence', body: 'Review account capture status and Recent Activity, then compare the recovered trades in the dashboard. Duplicate or conflicting broker evidence must be reviewed rather than silently overwritten.', tip: 'Original broker fills and first observed risk evidence are preserved for audit.', where: 'activity', button: 'Review recovery events' },
      ],
    },
    {
      id: 'copy', name: 'Understand copying', label: 'Permissions',
      summary: 'Separate read-only capture from live order authorization.',
      steps: [
        { title: 'Know the boundary', body: 'Pairing and monitoring do not authorize any copied orders. Copying is a separate, higher-risk workflow with its own safeguards.', tip: 'The redesigned native shell cannot arm a fleet or submit copied trades.', where: 'copy', button: 'Open Trade Copying' },
        { title: 'Choose master and followers', body: 'Open the dashboard Copy Studio to review which accounts should be sources and followers. Confirm each broker login, account mode, and intended direction.', tip: 'Never assume the account selected for journaling should also receive trades.', where: 'copy', button: 'Review Copy Studio entry' },
        { title: 'Check sizing and protection', body: 'For each follower, review percent-based or fixed-cash risk, contract specifications, entry type, pending orders, stop-loss, take-profit, and partial-close handling.', tip: 'Without a valid stop distance and broker specifications, a safe copied volume cannot be established.', where: 'copy', button: 'Review copying safeguards' },
        { title: 'Require local consent', body: 'Any live copying must pass separate local follower approval and verified safety checks in the established copier. This help experience cannot arm a fleet or place orders.', tip: 'If authorization cannot be verified, execution must remain blocked.', where: 'copy', button: 'Review safety status' },
      ],
    },
  ];
  const FAQ = [
    ['Why does my PC say connected but no trades appear?', 'Pairing confirms the PC connection only. Check the exact MT5 broker login, whether that session is enabled, and the last confirmed capture scan.'],
    ['Will trades taken while disconnected be recovered?', 'The connector is designed to compare broker history when it reconnects. Confirm the resulting fills and account state before assuming recovery succeeded.'],
    ['What happens if broker records disagree?', 'Conflicting broker evidence is retained for review. Existing immutable fills and first observed risk values must not be silently replaced.'],
    ['Does Pair this computer allow copying?', 'No. Pairing identifies this Windows connector. Monitoring and live copying have separate permission paths.'],
    ['Can the new desktop screen arm or place copied trades?', 'No. The redesigned native shell currently shows copying status and opens Copy Studio, but does not arm a fleet or submit orders.'],
    ['Why does each account need its own MT5 terminal?', 'Separate sessions allow accounts with different broker logins and servers to be monitored simultaneously without confusing their histories.'],
    ['How do I know whether a command succeeded?', 'An accepted button press is not proof of broker capture. Confirm each session’s verified state and the last completed scan.'],
    ['Where do I manage the PC name or monitoring choices?', 'Use your authenticated YoungMoney3 dashboard. The Windows app manages local MT5 sessions and shows their capture state.'],
    ['What does a green Monitoring status prove?', 'It means recent account-level capture was confirmed while the paired PC is online. Review the actual broker fills and any evidence conflicts before assuming every execution is present.'],
    ['Why is Arm blocked in Copy Studio?', 'At least one enabled follower, a current source connection, matching broker modes, an eligible follower and unexpired account-bound Windows consent are required. The new Signal Desk does not grant copying consent. Check the readiness details on the Dashboard; do not bypass them.'],
    ['Where do I go when recovery is incomplete?', 'Open the affected account on the Dashboard. Review its broker-history checkpoint, unresolved positions and integrity conflicts. A recheck request is not proof that all missing executions have been recovered.'],
  ];
  const seen = (() => {
    try {
      const items = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return new Set(Array.isArray(items) ? items.filter(x => typeof x === 'string') : []);
    } catch { return new Set(); }
  })();
  let topic = GUIDES[0].id;
  let position = 0;
  let openFaq = -1;
  let faqSearch = '';
  const count = GUIDES.reduce((total, guide) => total + guide.steps.length, 0);
  function markSeen() {
    const key = topic + ':' + position;
    if (seen.has(key)) return;
    seen.add(key);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen])); } catch { /* Optional local progress only. */ }
  }
  const guide = () => GUIDES.find(x => x.id === topic) || GUIDES[0];
  function render({ intro, action, safe, screen, model }) {
    const current = guide();
    const step = current.steps[position] || current.steps[0];
    markSeen();
    const verified = (model.sessions || []).filter(x => x.verified_link).length;
    const monitoring = (model.sessions || []).filter(x => x.status === 'monitoring').length;
    const answers = FAQ.map(([question, answer], index) => ({question, answer, index}))
      .filter(item => !faqSearch || (item.question + ' ' + item.answer).toLowerCase().includes(faqSearch.toLowerCase()));
    const progress = Math.round(seen.size / count * 100);
    return intro('Help & Guides', 'Practical steps for connecting, monitoring, recovering and copying safely.') +
      '<div class="native-guide">' +
        '<header class="native-guide-hero">' +
          '<div class="native-guide-hero-copy">' +
            '<span class="native-guide-eyebrow">SIGNAL DESK / INTERACTIVE MANUAL</span>' +
            '<h2>Learn the system. Keep control.</h2>' +
            '<p>Choose a task, follow short steps, and open the real screen when you are ready. Guides never change a broker setting or place a trade.</p>' +
            '<div class="native-guide-status">' +
              '<span>' + screen.icon(model.paired ? 'check' : 'lock') + (model.paired ? 'PC paired' : 'Pairing required') + '</span>' +
              '<span>' + screen.icon('accounts') + safe(String(verified)) + ' verified account(s)</span>' +
              '<span>' + screen.icon('activity') + safe(String(monitoring)) + ' monitoring</span>' +
            '</div>' +
          '</div><div class="native-guide-hero-media" aria-hidden="true">' + screen.media('pair') + '</div>' +
        '</header>' +
        '<div class="native-guide-progress-summary"><span><strong>' + seen.size + ' of ' + count + '</strong> guide steps explored</span>' +
          '<div role="progressbar" aria-label="Guide exploration progress" aria-valuemin="0" aria-valuemax="' + count + '" aria-valuenow="' + seen.size + '"><span style="width:' + progress + '%"></span></div>' +
          '<small>Saved on this computer only</small></div>' +
        '<div class="native-guide-shell">' +
          '<nav class="native-guide-topics" aria-label="Help topics">' +
            '<span class="native-guide-eyebrow">CHOOSE WHAT YOU WANT TO DO</span>' +
            GUIDES.map((item, i) => '<button type="button" data-native-guide-topic="' + item.id + '" aria-pressed="' + (topic === item.id) + '" class="' + (topic === item.id ? 'selected' : '') + '">' +
              '<span class="native-guide-topic-index">0' + (i + 1) + '</span><span class="native-guide-topic-copy"><strong>' + item.name + '</strong><small>' + item.summary + '</small></span>' +
              screen.icon('chevron-right') + '</button>').join('') +
            '<div class="native-guide-privacy">' + screen.icon('shield-check') + '<p>Your guide progress is local. No broker credentials, login codes, or trades are stored by this manual.</p></div>' +
          '</nav>' +
          '<section class="native-guide-workspace" aria-label="Step-by-step guide">' +
            '<div class="native-guide-current-top"><span class="native-guide-eyebrow">' + safe(current.label.toUpperCase()) + '</span><span>STEP ' + (position + 1) + ' OF ' + current.steps.length + '</span></div>' +
            '<h2>' + safe(current.name) + '</h2>' +
            '<p class="native-guide-current-summary">' + safe(current.summary) + '</p>' +
            '<div class="native-guide-step-tabs" role="group" aria-label="Choose a step">' +
              current.steps.map((item, i) => '<button type="button" data-native-guide-jump="' + i + '" aria-label="Step ' + (i + 1) + ': ' + safe(item.title) + '" aria-pressed="' + (i === position) + '" class="' + (i === position ? 'selected' : '') + '"><span>' + (i + 1) + '</span><small>' + safe(item.title) + '</small></button>').join('') +
            '</div>' +
            '<article class="native-guide-step-frame" data-native-guide-frame="' + topic + ':' + position + '" aria-live="polite">' +
              '<div class="native-guide-step-number">' + String(position + 1).padStart(2, '0') + ' <span>/ ' + String(current.steps.length).padStart(2, '0') + '</span></div>' +
              '<h3>' + safe(step.title) + '</h3>' +
              '<p>' + safe(step.body) + '</p>' +
              '<div class="native-guide-tip">' + screen.icon('shield-check') + '<span>' + safe(step.tip) + '</span></div>' +
              '<button type="button" class="native-guide-open" data-native-guide-open="' + safe(step.where) + '">' + safe(step.button) + screen.icon('arrow-right') + '</button>' +
            '</article>' +
            '<div class="native-guide-controls">' +
              '<button type="button" data-native-guide-move="previous" ' + (position === 0 ? 'disabled' : '') + '>' + screen.icon('chevron-left') + ' Previous</button>' +
              '<span>' + (position + 1) + ' / ' + current.steps.length + '</span>' +
              '<button type="button" data-native-guide-move="next" ' + (position === current.steps.length - 1 ? 'disabled' : '') + '>Next step ' + screen.icon('arrow-right') + '</button>' +
            '</div>' +
          '</section>' +
        '</div>' +
        '<section class="native-guide-faq" aria-label="Frequently asked questions">' +
          '<div class="native-guide-faq-head"><div><span class="native-guide-eyebrow">QUICK ANSWERS</span><h2>Questions traders actually ask</h2></div>' +
            '<label class="native-guide-search"><span class="sr-only">Search help answers</span><input data-native-guide-search aria-label="Search help answers" placeholder="Search answers…" value="' + safe(faqSearch) + '"></label></div>' +
          '<div class="native-guide-faq-list">' + (answers.length ? answers.map(item => '<div class="native-guide-faq-item">' +
            '<button type="button" data-native-guide-faq="' + item.index + '" aria-expanded="' + (openFaq === item.index) + '" aria-controls="native-guide-answer-' + item.index + '"><span>' + safe(item.question) + '</span>' + screen.icon('chevron-down') + '</button>' +
            '<div id="native-guide-answer-' + item.index + '" ' + (openFaq === item.index ? '' : 'hidden') + '><p>' + safe(item.answer) + '</p></div></div>').join('') :
            '<p class="native-guide-empty">No matching answer. Try “pairing”, “recovery” or “copying”.</p>') + '</div>' +
        '</section>' +
      '</div>';
  }
  function handleClick(event, { screen, refreshView, nativeCommand }) {
    const get = attr => event.target.closest('[' + attr + ']');
    const target = get('data-native-guide-topic');
    if (target) { topic = target.dataset.nativeGuideTopic; position = 0; refreshView(); return true; }
    const jump = get('data-native-guide-jump');
    if (jump) { position = Math.max(0, Math.min(guide().steps.length - 1, Number(jump.dataset.nativeGuideJump))); refreshView(); return true; }
    const move = get('data-native-guide-move');
    if (move) { position = Math.max(0, Math.min(guide().steps.length - 1, position + (move.dataset.nativeGuideMove === 'next' ? 1 : -1))); refreshView(); return true; }
    const faq = get('data-native-guide-faq');
    if (faq) { const index = Number(faq.dataset.nativeGuideFaq); openFaq = openFaq === index ? -1 : index; refreshView(); return true; }
    const open = get('data-native-guide-open');
    if (open) {
      const destination = open.dataset.nativeGuideOpen;
      if (destination === 'dashboard') nativeCommand('open_dashboard');
      else if (['home', 'accounts', 'copy', 'pair', 'activity'].includes(destination)) screen.navigate(destination);
      return true;
    }
    return false;
  }
  function handleInput(event, refreshView) {
    if (!event.target.matches('[data-native-guide-search]')) return false;
    faqSearch = event.target.value.slice(0, 120);
    refreshView();
    return true;
  }
  window.YMFXNativeGuide = { render, handleClick, handleInput };
})();
