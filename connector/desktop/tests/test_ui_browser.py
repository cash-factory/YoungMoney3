from pathlib import Path
from urllib.parse import quote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'previews';OUT.mkdir(exist_ok=True)
HTML=(ROOT/'desktop-ui'/'index.html').read_text()
CSS=(ROOT/'desktop-ui'/'assets'/'signal-desk.css').read_text() + '\n' + (ROOT/'desktop-ui'/'native.css').read_text() + '\n' + (ROOT/'desktop-ui'/'assets'/'native-updates.css').read_text() + '\n' + (ROOT/'desktop-ui'/'assets'/'native-guide.css').read_text()
NATIVE=(ROOT/'desktop-ui'/'assets'/'native.js').read_text()
UPDATES=(ROOT/'desktop-ui'/'assets'/'native-updates.js').read_text()
GUIDE=(ROOT/'desktop-ui'/'assets'/'native-guide.js').read_text()
APP=(ROOT/'desktop-ui'/'assets'/'signal-desk.js').read_text()
LOGO_DATA="data:image/svg+xml,"+quote((ROOT/'desktop-ui'/'assets'/'ymfx-brand.svg').read_text())

def load_app(page,native=False):
    import re
    page.set_content(re.sub(r'<script[^>]*></script>','',re.sub(r'<link[^>]*>','',HTML)),wait_until='domcontentloaded')
    page.add_style_tag(content=CSS)
    if native:page.evaluate(MOCK)
    page.add_script_tag(content=NATIVE)
    page.add_script_tag(content=UPDATES)
    page.add_script_tag(content=GUIDE)
    page.add_script_tag(content=APP)

MOCK=r'''(() => {
  const snapshot={source:'local-connector',demo:false,paired:false,capture_active:false,
    connection_state:'unpaired',device:'LOCAL-WORKSTATION',user:'Verified Example Trader',copying_armed:false,
    copy_permission_available:false,sessions:[],events:[]};
  const callbacks={};
  const command={
    stdout:{on(name,fn){callbacks.stdout=fn}},
    stderr:{on(name,fn){callbacks.stderr=fn}},
    on(name,fn){callbacks[name]=fn},
    async spawn(){return {pid:1,async write(str){const req=JSON.parse(str);
      let result;if(req.method==='snapshot')result=snapshot;
      else if(req.method==='scan_terminals')result={count:0,terminals:[]};
      else if(req.method==='start_monitoring')result={accepted:false};
      else if(req.method==='shutdown')result={stop_requested:true};
      else if(req.method==='open_dashboard')result={opened:false};
      else if(req.method==='pair_pc')return callbacks.stdout(JSON.stringify({id:req.id,ok:false,error:'Preview-only test'})+'\\n');
      else result={ok:true};
      callbacks.stdout(JSON.stringify({id:req.id,ok:true,result}));
    }}}
  };
  window.__TAURI__={shell:{Command:{sidecar(){return command}}}};
  document.addEventListener('DOMContentLoaded',()=>{
    const badge=document.createElement('div');
    badge.textContent='VISUAL QA · SIMULATED UNPAIRED DEVICE · NO BROKER ACCESS';
    badge.style.cssText='position:fixed;top:2px;left:45%;background:#ffe3e8;color:#a00729;padding:2px 14px;z-index:99999;font-size:10px;border-radius:12px;font-weight:700;pointer-events:none';
    document.body.appendChild(badge);
  });
})();'''

def run_qa():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),args=['--no-sandbox','--disable-dev-shm-usage'])
        errors=[]
        for width,height in [(1600,940),(1366,768),(1024,768),(900,700)]:
            page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
            page.on('pageerror',lambda err:errors.append(str(err)))
            load_app(page,native=True)
            page.wait_for_function("() => window.YMFXNative.debug().modelKey !== null", timeout=10000)
            page.wait_for_timeout(70)
            # set_content() has no filesystem base URL; resolve the real shipped SVG
            # into its data URI solely for the isolated browser QA screenshots.
            page.evaluate("(uri) => document.querySelectorAll('img[src=\"assets/ymfx-brand.svg\"]').forEach(img => img.src = uri)", LOGO_DATA)
            page.wait_for_timeout(50)
            assert page.locator('h1').inner_text()=='Trading Operations Hub', (width,page.locator('body').inner_text()[:300])
            assert 'Copying Ready' not in page.locator('body').inner_text()
            assert '3 sample accounts' not in page.locator('body').inner_text()
            assert 'Not paired' in page.locator('body').inner_text()
            assert 'Verified Example Trader' in (page.evaluate('window.YMFXNative.debug().modelKey') or ''), 'Native IPC snapshot did not populate the dashboard user'
            if width>=1100: assert 'Verified Example Trader' in page.locator('body').inner_text(), 'Desktop owner identity not visible'
            assert 'LOCAL-WORKSTATION' not in page.locator('.sidebar').inner_text(), 'PC identity belongs on dashboard, not connector sidebar'
            assert 'Unable to start the local connector service' not in page.locator('body').inner_text()
            assert 'Could not refresh the connector status' not in page.locator('body').inner_text()
            for id,label in [('home','Trading Operations Hub'),('accounts','My Accounts'),('copy','Trade Copying'),('pair','Connect this PC'),('activity','Recent Activity'),('help','Help & Guides')]:
                page.locator(f'[data-page="{id}"]').first.click()
                page.wait_for_timeout(65)
                assert label in page.locator('h1').first.inner_text(),(width,id,page.locator('h1').first.inner_text())
                horizontal=page.evaluate('document.documentElement.scrollWidth > window.innerWidth + 2')
                assert not horizontal,(width,id,page.evaluate('document.documentElement.scrollWidth'))
                if width in (1600,1024) and id in ('home','accounts','copy'):
                    page.evaluate("(uri) => document.querySelectorAll('img[src=\"assets/ymfx-brand.svg\"]').forEach(img => img.src = uri)", LOGO_DATA)
                    page.wait_for_timeout(35)
                    page.screenshot(path=str(OUT/f'native-{width}-{id}.png'),full_page=True)
            page.close()
        assert not errors,errors
        # Ordinary browser preserves explicitly marked simulated review mode.
        page=browser.new_page(viewport={'width':1440,'height':900})
        load_app(page,native=False)
        assert 'sample' in page.locator('body').inner_text().lower()
        page.screenshot(path=str(OUT/'interactive-design-preview.png'),full_page=True)
        browser.close()
    print('Browser QA complete: 24 native page/size permutations + standalone design preview')


if __name__ == '__main__':
    run_qa()