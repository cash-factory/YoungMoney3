"""Prevent stale release tags, untrusted branches and broken connector download wiring."""
import importlib.util
import re
from pathlib import Path

root=Path(__file__).resolve().parent.parent
version_path=root/"connector/version.py"
spec=importlib.util.spec_from_file_location("ym_connector_version",version_path)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
version=module.VERSION
assert re.fullmatch(r"\d+\.\d+\.\d+-rc\d+",version), version

workflow=(root/".github/workflows/connector-prerelease.yml").read_text(encoding="utf-8")
for required in [
    "workflow_dispatch:",
    "if: "+chr(36)+"{{ false }}",
    "The classic app must never publish publicly again",
]:
    assert required in workflow, "Classic public distribution must be disabled: "+required
assert re.search(r"(?m)^\s*VERSION:\s*'"+re.escape(version)+r"'\s*$",workflow)
assert "workflows: [Validate]" not in workflow, "Classic must not auto-publish after a deployment"
assert workflow.count("if: "+chr(36)+"{{ false }}") >= 2, "Classic build and publish jobs must both be disabled"
presence=(root/"connector/presence.py").read_text(encoding="utf-8")
gui=(root/"connector/connector_gui.py").read_text(encoding="utf-8")
for name,source in [("presence",presence),("GUI",gui)]:
    assert "from version import VERSION" in source, "Version drift in "+name
    assert "0.5.3-rc1" not in source, "Legacy hardcoded connector version in "+name

source_archive=(root/"scripts/build_connector_source_archive.py").read_text(encoding="utf-8")
assert '"version.py": "connector/version.py"' in source_archive
dashboard=(root/"src/components/Mt5Connections.tsx").read_text(encoding="utf-8")
assert 'href="/connector-download.html"' in dashboard
assert "Get Signal Desk" in dashboard
assert "/mt5-connector.zip" not in dashboard
downloads=(root/"public/connector-download.html").read_text(encoding="utf-8")
assert "staging-signaldesk-v" in downloads and "Signal Desk" in downloads
assert "YoungMoney3.Connector.exe" not in downloads
assert "/mt5-connector.zip" not in downloads
build=(root/"package.json").read_text(encoding="utf-8")
assert '"build": "vite build"' in build
worker=(root/"worker/index.ts").read_text(encoding="utf-8")
assert "CLASSIC_OWNER_USER_ID" in worker and "CLASSIC_RELEASES" in worker
assert "private/classic-connector/YoungMoney3.Connector.exe" in worker
print("Signal Desk primary distribution and owner-only classic route contracts passed.")
