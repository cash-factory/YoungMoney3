"""Browser acceptance of stable live IPC redraws; no MT5 or credentials involved."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from test_ui_browser import load_app, MOCK

MOCK_STATE = MOCK.replace('const snapshot={', 'window.__testModel={').replace("result=snapshot;", "result=window.__testModel;")

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path=('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None), args=['--no-sandbox','--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width':1440,'height':820})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    # No real installed sidecar, no broker data and no external network.
    from test_ui_browser import HTML,CSS,NATIVE,APP
    import re
    page.set_content(re.sub(r'<script[^>]*></script>','',re.sub(r'<link[^>]*>','',HTML)),wait_until='domcontentloaded')
    page.add_style_tag(content=CSS)
    page.evaluate(MOCK_STATE)
    page.add_script_tag(content=NATIVE)
    page.add_script_tag(content=APP)
    page.wait_for_function("() => window.YMFXNative.debug().modelKey !== null",timeout=5000)
    before=page.evaluate("""() => {
      window.__artRef=document.querySelector('.native-overview-art svg');
      window.__sideRef=document.querySelector('.sidebar');
      return window.YMFXNative.debug().domRevision;
    }""")
    assert page.locator('h1').inner_text()=='Trading Operations Hub'
    # Check that an identical 3.5-second poll leaves the UI untouched.
    page.wait_for_timeout(3750)
    assert page.evaluate('window.YMFXNative.debug().domRevision')==before, 'An identical poll caused a full layout refresh'
    page.evaluate("""() => {
      window.__testModel.events.push({time:'2026-11-25T17:50:00Z',kind:'running',message:'Broker status updated'});
      window.__testModel.paired=true; window.__testModel.connection_state='recovering';
    }""")
    page.wait_for_timeout(3750)
    assert page.evaluate('window.YMFXNative.debug().domRevision')==before+1, 'A changed broker state should repaint once'
    assert page.evaluate('window.__artRef === document.querySelector(".native-overview-art svg")'), 'SVG motion node was destroyed'
    assert page.evaluate('window.__sideRef === document.querySelector(".sidebar")'), 'Desktop shell was remounted'
    assert page.locator('body').get_by_text('Checking connection and broker history',exact=True).count()>=1
    # Focused pairing code must not be reset by an unrelated background event.
    page.evaluate("window.__testModel.paired=false")
    page.wait_for_timeout(3750)
    page.locator('[data-page="pair"]').first.click(timeout=4000)
    input=page.locator('#native-pair-code')
    input.fill('a1b2c3d4',timeout=4000)
    input.focus()
    page.evaluate("window.__testModel.events.push({time:'2026-11-25T17:50:01Z',kind:'running',message:'Second update'})")
    page.wait_for_timeout(3750)
    assert input.input_value()=='a1b2c3d4'
    assert page.evaluate('document.activeElement?.id')=='native-pair-code'
    assert not errors,errors
    print('Stable DOM acceptance passed: identical polls skipped, live status patched, SVG preserved, focused input preserved.')
    browser.close()