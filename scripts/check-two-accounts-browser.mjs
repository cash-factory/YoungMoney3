import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { installDashboardFixtures } from './test-dashboard-browser.mjs';

export async function checkTwoAccounts(browser, base, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const { account } = await installDashboardFixtures(page);
  const first = { ...account, name: 'Dollar demo' };
  const second = { ...account, id: 'second-account', name: 'Euro demo', base_currency: 'EUR' };
  const entries = [],
    imports = [],
    errors = [],
    replayRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/data', async (route) => {
    const query = route.request().postDataJSON();
    if (query.table === 'trading_accounts')
      return route.fulfill({ json: { data: [first, second], count: 2 } });
    if (query.table !== 'journal_entries') return route.fallback();
    if (query.action === 'select')
      return route.fulfill({ json: { data: entries, count: entries.length } });
    assert.equal(query.action, 'insert');
    const record = {
      ...query.payload,
      id: 'pass-' + entries.length,
      created_at: new Date().toISOString(),
    };
    entries.push(record);
    return route.fulfill({ json: { data: [record], count: 1 } });
  });

  await page.route('**/api/decision/context', (route) => {
    replayRequests.push(route.request().postDataJSON().reference);
    return route.fulfill({
      json: {
        strategy: null,
        model: null,
        modelVersion: null,
        plan: null,
        earliest: null,
        requireStop: false,
        riskLimit: null,
        criteria: null,
        checklist: [],
      },
    });
  });
  const positions = [
    [first, 'dollar-link', '16'],
    [second, 'euro-link', '-7'],
  ].map(([a, link, net]) => ({
    link,
    account_id: a.id,
    version: 1,
    lifecycle_id: '789:0',
    recorded_at: '2026-01-01T11:00:00Z',
    summary: {
      lifecycle_id: '789:0',
      position_id: '789',
      broker: 'Shared-Demo',
      symbol: 'EURUSD',
      direction: 'long',
      status: 'closed',
      first_entry_at: '2026-01-01T09:00:00Z',
      final_exit_at: '2026-01-01T10:00:00Z',
      initial_entry_price: '1.2',
      net_realized_profit: net,
      settlement_currency: a.base_currency,
      entries: [],
      exits: [],
      sessions: { status: 'unconfirmed' },
      capital_at_entry: { source: 'unavailable' },
      capture_completeness: { session_status: 'unconfirmed', original_risk: 'unknown' },
    },
  }));
  let latestEuroScan = 'scan-euro';
  const paused = new Set();
  const publicKey = generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({format:'der',type:'spki'}).toString('base64');
  let newLogin;
  let firstSync = false;
  const dollarStarted = Promise.withResolvers();
  const allowDollar = Promise.withResolvers();
  const dollarFinished = Promise.withResolvers();
  await page.route('**/api/mt5/*', async (route) => {
    const action = new URL(route.request().url()).pathname.split('/').pop();
    const input = route.request().postDataJSON();
    if (action === 'positions')
      return route.fulfill({
        json: { rows: new URL(page.url()).hash === '#trades' ? positions : [], more: false },
      });
    if (action === 'position-evidence') return route.fulfill({ json: { rows: [], more: false } });
    if (action === 'set-monitoring') {
      if (input.paused) paused.add(input.link); else paused.delete(input.link);
      return route.fulfill({json:{ok:true}});
    }
    if (action === 'connect') {
      assert.equal(input.device, 'pc');
      assert.ok(input.envelope.wrapped && input.envelope.iv && input.envelope.data);
      assert.ok(!JSON.stringify(input).includes('fixture-password'));
      newLogin = {id:'new-demo', device:'pc', status:'connected', server:input.server, company:'Test broker', login:'700'};
      return route.fulfill({json:{id:newLogin.id}});
    }
    if (action === 'status') {
      const common = {
        status: 'connected',
        device: 'pc',
        server: 'Shared-Demo',
        trade_mode: 0,
        history_status: 'ready',
      };
      return route.fulfill({
        json: {
          accounts: [first, second],
          demoOnly: true,
          devices: [{ id: 'pc', last_seen: Date.now(), setup_state:'ready', public_key:publicKey }],
          links: [
            {
              ...common,
              id: 'dollar-link',
              account_id: first.id,
              login: '42',
              history_id: 'scan-dollar',
            },
            {
              ...common,
              id: 'euro-link',
              account_id: second.id,
              monitoring_paused: Number(paused.has('euro-link')),
              login: '43',
              history_id: latestEuroScan,
            },
            ...(newLogin ? [{...newLogin,last_sync:firstSync?new Date().toISOString():null}] : []),
          ],
        },
      });
    }
    if (action === 'history-preview') {
      const dollar = input.link === 'dollar-link';
      if (dollar) {
        dollarStarted.resolve();
        await allowDollar.promise;
      }
      try {
        await route.fulfill({
          json: {
            link: input.link,
            request: dollar ? 'scan-dollar' : latestEuroScan,
            status: 'ready',
            more: false,
            nextOffset: 1,
            rows: [
              {
                pair: dollar ? 'DOLLAR-FILL' : 'EURO-FILL',
                broker_details: { position_id: '789', deal_ticket: '781' },
              },
            ],
          },
        });
      } finally {
        if (dollar) dollarFinished.resolve();
      }
      return;
    }
    if (action === 'history-import') {
      imports.push(input);
      return route.fulfill({ json: { added: 1, more: false } });
    }
    if (action === 'retry-session') return route.fulfill({ json: { ok: true } });
    return route.fallback();
  });

  try {
    await page.goto(base + '#dashboard');
    const chooseAccount = async (name) => {
      await page.getByRole('combobox', { name: 'Trading account', exact: true }).click();
      await page.getByRole('option', { name: new RegExp(name) }).click();
    };
    const capture = page.getByRole('dialog', { name: 'Quick Capture' });
    await chooseAccount(second.name);
    await page.getByRole('button', { name: 'I passed', exact: true }).click();
    await capture.getByText('Recording for Euro demo').waitFor();
    await capture.getByRole('button', { name: 'My trigger never fired' }).click();
    await capture.getByRole('button', { name: 'Save draft & close' }).click();
    await chooseAccount(first.name);
    await page.getByRole('button', { name: 'I passed', exact: true }).click();
    await capture.getByText('Recording for Dollar demo').waitFor();
    assert.equal(
      await capture.getByRole('button', { name: 'My trigger never fired' }).getAttribute('aria-pressed'),
      'false'
    );
    await capture.getByRole('button', { name: 'Timing was off' }).click();
    await capture.getByRole('button', { name: 'Save capture' }).click();
    await capture.waitFor({ state: 'hidden' });
    await chooseAccount(second.name);
    await page.getByRole('button', { name: 'I passed', exact: true }).click();
    await capture.getByText('Draft resumed on this device.').waitFor();
    assert.equal(
      await capture.getByRole('button', { name: 'My trigger never fired' }).getAttribute('aria-pressed'),
      'true'
    );
    await capture.getByRole('button', { name: 'Save capture' }).click();
    await capture.waitFor({ state: 'hidden' });
    assert.deepEqual(
      entries.map((row) => [row.account_id, row.notes]),
      [
        [first.id, 'Timing was off'],
        [second.id, 'My trigger never fired'],
      ]
    );
    await page
      .getByRole('button', { name: width < 1024 ? 'Quick capture' : 'Quick Add', exact: true })
      .click();
    await capture.getByText('Recording for Euro demo').waitFor();
    await capture.getByRole('button', { name: 'Discard draft' }).click();

    await page.getByRole('button', { name: 'Add trade', exact: true }).click();
    const tradeForm = page.getByRole('dialog', { name: 'Add New Trade' });
    await tradeForm.getByRole('button', { name: 'Context', exact: true }).click();
    await tradeForm
      .getByRole('combobox', { name: 'Trading account', exact: true })
      .getByText('Euro demo · EUR')
      .waitFor();
    await tradeForm.getByRole('button', { name: 'Close dialog' }).click();

    const monitor=page.getByRole('region',{name:'Broker account monitor'});
    await monitor.getByRole('button',{name:'Pause monitoring'}).click();
    await monitor.getByText('Monitoring paused').waitFor();
    assert.deepEqual([...paused],['euro-link']);
    await monitor.getByRole('button',{name:'Resume monitoring'}).click();
    await monitor.getByRole('button',{name:'Pause monitoring'}).waitFor();
    await monitor.getByRole('link',{name:'Add account'}).click();
    const login=page.frameLocator('iframe[title="MT5 broker account login"]');
    await login.locator('#server').fill('Shared-Demo');
    await login.locator('#login').fill('700');
    await login.locator('#password').fill('fixture-password');
    await login.getByRole('button',{name:'Add account',exact:true}).click();
    await login.getByText(/Waiting for the first journal sync/).waitFor();
    firstSync=true;
    await login.getByText(/first sync was received/).waitFor();
    await login.getByRole('button',{name:'View accounts'}).click();
    await page.getByRole('dialog',{name:'Connect MT5 account'}).waitFor({state:'hidden'});
    const accountList = page.getByRole('list', { name: 'Select a broker account' });
    const dollar = accountList.getByRole('listitem').filter({ hasText: first.name });
    const euro = accountList.getByRole('listitem').filter({ hasText: second.name });
    const openAccount = async (entry, name) => {
      await entry.getByRole('button', { name: new RegExp(name) }).click();
      await entry.getByRole('tab', { name: 'Trade history' }).click();
    };
    await openAccount(dollar, first.name);
    await dollar.getByRole('button', { name: 'Review earlier trades' }).click();
    await dollarStarted.promise;
    await openAccount(euro, second.name);
    await euro.getByRole('button', { name: 'Review earlier trades' }).click();
    const current = page.getByRole('region', { name: 'Earlier trades for Euro demo' });
    await current.getByText('EURO-FILL').waitFor();
    allowDollar.resolve();
    await dollarFinished.promise;
    assert.equal(await current.getByText('DOLLAR-FILL').count(), 0);
    await current.getByRole('button', { name: 'Import 1 reviewed fill', exact: true }).click();
    await current.waitFor({ state: 'hidden' });
    assert.deepEqual(imports, [{ link: 'euro-link', request: 'scan-euro', expected_count: 1 }]);

    await euro.getByRole('button', { name: 'Review earlier trades' }).click();
    await current.getByText('EURO-FILL').waitFor();
    latestEuroScan = 'new-scan-with-one-fill';
    await euro.getByRole('tab', { name: 'Overview' }).click();
    await euro.getByRole('button', { name: 'Retry account' }).click();
    await current.getByText(/scan is no longer current/).waitFor();
    assert.equal(await current.getByRole('button', { name: /Import.*reviewed/ }).count(), 0);
    await page.goto(base + '#trades');
    const ledger = page.getByRole('region', { name: 'Broker position lifecycles' });
    for (const [a, link, amount] of [
      [first, 'dollar-link', '16.00'],
      [second, 'euro-link', '7.00'],
    ]) {
      const position = ledger.locator('details').filter({ hasText: a.name });
      await position.locator('summary').click();
      await position.getByRole('button', { name: 'Decision replay' }).click();
      const replay = page.getByRole('dialog', { name: 'Decision replay' });
      await replay.getByText(new RegExp(a.name)).waitFor();
      assert.equal(await replay.getByText(/Net result/).count(), 0);
      await replay.getByRole('button', { name: 'Reveal outcome and evidence' }).click();
      await replay.getByRole('heading', { name: 'Still unclear' }).waitFor();
      const outcome = await replay.getByText(/Net result/).innerText();
      assert.ok(outcome.includes(a.base_currency) && outcome.includes(amount), outcome);
      assert.equal(replayRequests.at(-1), 'position/' + link + '/789:0');
      await replay.getByRole('button', { name: 'Close dialog' }).click();
    }
    assert.deepEqual(errors, []);
    console.log(
      'Two-account capture, draft isolation, history switching and broker replays passed at ' +
        width +
        'px.'
    );
  } finally {
    allowDollar.resolve();
    await page.close();
  }
}
