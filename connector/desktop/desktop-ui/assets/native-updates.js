/* Signed Signal Desk updater. Real broker capture and copier safety take priority. */
(() => {
  'use strict';
  const KEY = 'ymfx:signaldesk:auto-updates';
  const PERIOD = 4 * 60 * 60 * 1000;
  const state = {
    configured: null, checking: false, version: '', notes: [],
    installing: false, detail: 'Check for updates to see the newest version.',
    auto: (() => {try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }})(),
  };
  let deps = null;
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function canInstall() {
    if (!deps) return false;
    const model = deps.getModel();
    // Missing evidence is NOT proof the account is idle.
    return model.source === 'local-connector' && model.demo === false &&
      model.capture_active === false && model.copying_armed === false &&
      model.copy_permission_available === false && model.queued_updates === 0 &&
      !deps.isBusy() && !model.sessions.some(s => s.status === 'monitoring');
  }
  function panel(icon) {
    const release = state.version;
    const notes = state.notes.length
      ? state.notes.map(note => '<li>' + safe(note) + '</li>').join('')
      : '<li>Release notes are brief and contain no private account details.</li>';
    const controls = '<div class="native-update-actions">' +
      '<button type="button" class="btn" data-native-update="check" ' +
      (state.checking || state.installing ? 'disabled' : '') + '>Check for updates</button>' +
      (release ? '<button type="button" class="btn red" data-native-update="install" ' +
      (state.installing || !canInstall() ? 'disabled' : '') + '>Install & restart</button>' : '') +
      '</div>';
    return '<section class="native-card native-update-panel" aria-label="Software updates">' +
      '<div class="native-card-head"><h2>' + icon('refresh') + ' Software updates</h2></div>' +
      '<div class="native-pad"><p class="native-update-message" role="status">' + safe(state.detail) + '</p>' +
      (release ? '<strong class="native-update-version">Version ' + safe(release) +
         ' available</strong><ul class="native-update-notes">' + notes + '</ul>' : '') +
      controls +
      (release && !canInstall() ? '<p class="native-update-warning">Installation waits until monitoring is stopped, queued uploads have finished and copying is disabled.</p>' : '') +
      '<label class="native-update-toggle"><input type="checkbox" data-native-update-auto ' +
       (state.auto ? 'checked' : '') + '> Install automatically when verified as idle</label>' +
      '<small>Signed update packages are verified before installation. Your broker credentials and journal records stay local.</small>' +
      '</div></section>';
  }
  function topbar() {
    return '<button type="button" class="native-update-toolbar" data-native-update="check">' +
       (state.version ? 'Update ' + safe(state.version) : 'Check updates') + '</button>';
  }
  async function check(manual = false) {
    if (!deps || state.checking || state.installing) return;
    const invoke = window.__TAURI__?.core?.invoke;
    if (typeof invoke !== 'function') {
      state.detail = 'The signed update service is unavailable in this preview.';
      deps.refreshView();
      return;
    }
    state.checking = true;
    if (manual) state.detail = 'Checking the signed update channel…';
    deps.refreshView();
    try {
      const response = await invoke('check_connector_update');
      state.configured = response?.configured === true;
      if (!state.configured) {
        state.version = '';
        state.notes = [];
        state.detail = 'Signed updates have not been enabled for this preview build.';
      } else if (response.available === true &&
                 /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.]+)?$/.test(response.version)) {
        state.version = response.version;
        state.notes = Array.isArray(response.notes)
          ? response.notes.slice(0,4).filter(x => typeof x === 'string' && x.length <= 130)
          : [];
        state.detail = 'A verified update is available. It can install when this connector is idle.';
      } else {
        state.version = '';
        state.notes = [];
        state.detail = 'You are using the latest version on this channel.';
      }
    } catch {
      state.detail = 'Could not check for updates. The connector can continue operating.';
    } finally {
      state.checking = false;
      deps.refreshView();
      if (!manual && state.auto && state.version && canInstall()) void install();
    }
  }
  async function install() {
    if (!deps || !state.version || state.installing) return;
    if (!canInstall()) {
      state.detail = 'Stop monitoring, finish pending uploads and disable copying before installing.';
      deps.refreshView();
      return;
    }
    const invoke = window.__TAURI__?.core?.invoke;
    if (typeof invoke !== 'function') return;
    state.installing = true;
    state.detail = 'Preparing the signed update. Windows will restart the connector after installation.';
    deps.refreshView();
    try {
      // We require a verified idle snapshot. Shut down only our bundled local
      // sidecar, then let Tauri check/signature-verify the update again.
      if (deps.hasBridge()) {
        try { await deps.request('shutdown'); } catch { /* May exit before replying. */ }
        await deps.waitForBridgeStop(15000);
      }
      await invoke('install_connector_update', { expectedVersion: state.version });
    } catch {
      state.installing = false;
      state.detail = 'The update could not start. Reopen the app and check again.';
      deps.refreshView();
    }
  }
  function handleClick(event) {
    const btn = event.target.closest('[data-native-update]');
    if (!btn) return false;
    if (btn.dataset.nativeUpdate === 'check') void check(true);
    if (btn.dataset.nativeUpdate === 'install') void install();
    return true;
  }
  function handleChange(event) {
    if (!event.target.matches('[data-native-update-auto]')) return;
    state.auto = !!event.target.checked;
    try { localStorage.setItem(KEY, state.auto ? 'on' : 'off'); } catch {}
    deps?.refreshView();
  }
  function onSnapshot() {
    if (state.auto && state.version && !state.checking && !state.installing && canInstall()) {
      void install();
    }
  }
  function attach(api) {
    deps = api;
    document.addEventListener('change', handleChange, true);
    window.setTimeout(() => check(false), 9500);
    window.setInterval(() => {
      if (!document.hidden) void check(false);
    }, PERIOD);
  }
  window.YMFXUpdates = {attach, panel, topbar, handleClick, onSnapshot,
    isInstalling: () => state.installing,
    debug: () => ({...state,canInstall:canInstall()})};
})();
