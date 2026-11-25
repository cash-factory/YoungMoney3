"""Prove the frozen native sidecar starts cleanly without broker capture."""
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile

exe=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else None
if not exe or not exe.is_file():
    raise SystemExit('Pass the built Windows sidecar executable')
with tempfile.TemporaryDirectory(prefix='ymfx-bridge-smoke-') as profile:
    env=os.environ.copy()
    env.update(LOCALAPPDATA=profile,APPDATA=profile,USERPROFILE=profile,HOME=profile)
    proc=subprocess.Popen([str(exe)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL,encoding='utf8',bufsize=1,env=env)
    def request(id,method):
        proc.stdin.write(json.dumps({'id':id,'method':method})+'\n')
        proc.stdin.flush()
        reply=json.loads(proc.stdout.readline())
        assert reply['id']==id and reply['ok'] is True,reply
        return reply['result']
    try:
        assert request(1,'ping')['pong']
        snapshot=request(2,'snapshot')
        assert snapshot['source']=='local-connector'
        assert snapshot['demo'] is False
        assert not snapshot['capture_active']
        assert snapshot['copying_armed'] is False
        assert snapshot['copy_permission_available'] is False
        request(3,'shutdown')
        assert proc.wait(timeout=20)==0
        assert not (Path(profile)/'YMFX').exists(), 'Smoke test unexpectedly wrote user settings'
    finally:
        if proc.poll() is None: proc.kill()
print('Bundled bridge smoke passed: no broker connection and no settings modified')