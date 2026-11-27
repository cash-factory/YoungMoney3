from pathlib import Path
"""Production UI contract against a fake, isolated local MT5 bridge only."""
from playwright.sync_api import sync_playwright
from test_ui_browser import HTML,CSS,NATIVE,UPDATES,GUIDE,APP,MOCK
import re

mock=MOCK.replace('const snapshot={','window.__testModel={').replace('result=snapshot;','result=window.__testModel;')
mock=mock.replace('result={count:0,terminals:[]};',"result={count:1,terminals:[{id:'opaque-source',name:'MT5 Programme'}]};")
mock=mock.replace("window.__TAURI__={shell", '''window.__ops=[];
  window.__testModel.paired=true;
  window.__testModel.user='Verified Example Trader';
  window.__testModel.capture_active=true;
  window.__testModel.connection_state='connected';
  window.__testModel.sessions=[{id:'abc',name:'London Terminal',login:'1042',server:'Example-Live',status:'monitoring',last_sync:'2026-11-25T15:12:00Z',verified_link:true,terminal_present:true,enabled:true}];
  window.__testModel.events=[{time:'2026-11-25T15:12:00Z',kind:'session-synced',message:'Broker capture cycle completed'}];
  window.__TAURI__={shell''')
mock=mock.replace("else result={ok:true};", '''else if(req.method==='rename_session'){
        window.__testModel.sessions[0].name=req.params.name; result={updated:true};
      }else if(req.method==='retry_session'){result={retry_queued:true};
      }else if(req.method==='set_session_enabled'){
        window.__testModel.sessions[0].enabled=req.params.enabled;result={updated:true};
      }else if(req.method==='stop_monitoring'){
        window.__testModel.capture_active=false;window.__testModel.connection_state='offline';result={stop_requested:true};
      }else if(req.method==='scan_terminals'){result={count:1,terminals:[{id:'opaque-source',name:'MT5 Programme'}]};
      }else if(req.method==='add_account'){result={accepted:true,monitoring_enabled:false,login_method:'MT5 window'};
      }else if(req.method==='remove_session'){
        window.__testModel.sessions=[];result={removed:true,broker_evidence_preserved:true};
      }else result={ok:true};''')
mock=mock.replace('const req=JSON.parse(str);', 'const req=JSON.parse(str);window.__ops.push(req);')
with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path=('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),args=['--no-sandbox','--disable-dev-shm-usage'])
    page=b.new_page(viewport={'width':1366,'height':768})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(re.sub(r'<script[^>]*></script>','',re.sub(r'<link[^>]*>','',HTML)),wait_until='domcontentloaded')
    page.add_style_tag(content=CSS);page.evaluate(mock);page.add_script_tag(content=NATIVE);page.add_script_tag(content=UPDATES);page.add_script_tag(content=GUIDE);page.add_script_tag(content=APP)
    page.wait_for_function("() => window.YMFXNative.debug().modelKey !== null")
    page.locator('[data-page="accounts"]').first.click()
    assert page.locator('.native-account').count()==1
    page.locator('[data-native-action="prepare-account-setup"]').first.click()
    page.wait_for_function("() => !!document.querySelector('#native-source-id')")
    assert page.locator('input#native-account-label').count()==1
    page.locator('#native-account-label').fill('My second account')
    page.locator('[data-native-action="add_account"]').click()
    page.wait_for_function("() => window.__ops.some(x=>x.method==='add_account')")
    assert page.evaluate("window.__ops.find(x=>x.method==='add_account').params.source_id")=='opaque-source'
    assert page.evaluate("window.__ops.find(x=>x.method==='add_account').params.name")=='My second account'
    assert not page.locator('[data-native-action="execute-trade"]').count()
    page.locator('[data-native-action="cancel-add-account"]').first.click()
    assert page.locator('[data-native-action="retry-session"]').is_enabled()
    page.locator('[data-native-action="retry-session"]').click()
    page.wait_for_function("() => window.__ops.some(x=>x.method==='retry_session')")
    page.locator('[data-native-action="edit-session-name"]').click()
    page.locator('#native-session-name').fill('New London Desk')
    page.locator('[data-native-action="save-session-name"]').click()
    page.wait_for_function("() => document.body.textContent.includes('New London Desk')")
    assert page.evaluate("window.__ops.some(x=>x.method==='rename_session' && x.params.name==='New London Desk')")
    page.locator('[data-page="activity"]').first.click()
    page.locator('[data-native-filter="capture"]').click()
    assert page.locator('[data-native-filter="capture"]').get_attribute('aria-pressed')=='true'
    page.locator('[data-page="copy"]').first.click()
    assert page.locator('[data-native-action*="execute"]').count()==0
    assert not page.get_by_text('Copying Ready',exact=True).count()
    # Guide navigates through actual screens without calling MT5 broker commands.
    actions_before = page.evaluate("window.__ops.filter(x=>x.method!=='snapshot').length")
    page.locator('[data-page="help"]').first.click()
    page.get_by_role('heading',name='Learn the system. Keep control.').wait_for()
    assert page.locator('[data-native-guide-topic]').count() == 4
    page.locator('[data-native-guide-topic="recover"]').click()
    assert page.get_by_role('heading',name='Check the PC connection first').count()==1
    page.locator('[data-native-guide-move="next"]').click()
    assert page.get_by_role('heading',name='Inspect the affected MT5 account').count()==1
    page.locator('[data-native-guide-faq="3"]').click()
    assert page.locator('[data-native-guide-faq="3"]').get_attribute('aria-expanded')=='true'
    page.locator('[data-native-guide-search]').fill('broker records')
    assert page.locator('[data-native-guide-faq]').count()==1
    page.locator('[data-native-guide-search]').fill('')
    page.locator('[data-native-guide-open="accounts"]').click()
    assert page.locator('h1').inner_text()=='My Accounts'
    assert page.evaluate("window.__ops.filter(x=>x.method!=='snapshot').length")==actions_before
    page.locator('[data-page="home"]').first.click()
    page.locator('[data-native-action="toggle-capture"]').click()
    page.wait_for_function('() => window.__testModel.capture_active===false')
    page.locator('[data-page="accounts"]').first.click()
    page.locator('[data-native-action="remove-session"]').click()
    page.locator('#native-remove-confirm').fill('REMOVE')
    page.locator('[data-native-action="remove-session-confirmed"]').click()
    page.wait_for_function('() => window.__ops.some(x=>x.method==="remove_session")')
    page.wait_for_timeout(300)
    assert not page.evaluate('window.__testModel.sessions.length'), ('Remove should only erase local shortcut',page.locator('body').inner_text()[-400:])
    assert page.evaluate("window.__ops.some(x=>x.method==='remove_session' && x.params.confirm==='REMOVE')")
    assert not errors,errors
    print('Native workflows browser QA passed: selected account, recheck, rename, filtered events, disarmed copying, confirmed shortcut removal.')
    b.close()