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
    "workflows: [Validate]",
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_branch == 'main'",
    "github.event.workflow_run.head_repository.full_name == github.repository",
    "ref: "+chr(36)+"{{ env.SOURCE_SHA }}",
    "github.ref == 'refs/heads/main'",
    "inputs.confirmation == 'RELEASE-STAGING-CONNECTOR'",
    "needs: [connector, startup-smoke]",
    "contents: write",
    "--prerelease --latest=false",
    "YoungMoney3.Connector.exe.sha256",
    "build-manifest.json",
    "staging-release/YoungMoney3.Connector.exe",
    "Copy-Item 'dist/YoungMoney3 Connector.exe' 'staging-release/YoungMoney3.Connector.exe'",
    "$exe = Join-Path $dir 'YoungMoney3.Connector.exe'",
    "YoungMoney3.Connector.exe.sha256",
    "Staging did not pass deployment checks for this exact source SHA",
    "Main moved during build; refusing stale release",
    "Desktop version differs from immutable release tag",
]:
    assert required in workflow, "Missing release gate: "+required
assert re.search(r"(?m)^\s*VERSION:\s*'"+re.escape(version)+r"'\s*$",workflow), "Release workflow and binary use different versions."
assert "feat/rich-capture-staging" not in workflow, "Stale feature-branch release restriction."
assert "pull_request:\n" not in workflow, "Release builder cannot build from a PR."
assert re.search(r'\bVERSION = "'+re.escape(version)+r'"',version_path.read_text(encoding="utf-8"))

presence=(root/"connector/presence.py").read_text(encoding="utf-8")
gui=(root/"connector/connector_gui.py").read_text(encoding="utf-8")
for name,source in [("presence",presence),("GUI",gui)]:
    assert "from version import VERSION" in source, "Version drift in "+name
    assert "0.5.3-rc1" not in source, "Legacy hardcoded connector version in "+name

source_archive=(root/"scripts/build_connector_source_archive.py").read_text(encoding="utf-8")
assert '"version.py": "connector/version.py"' in source_archive
dashboard=(root/"src/components/Mt5Connections.tsx").read_text(encoding="utf-8")
assert 'href="/connector-download.html"' in dashboard, "Release details and checksum must be accessible."
# Until the new executable has actually passed the release jobs, the direct
# download remains the last published artifact; never link an unbuilt binary.
published='https://github.com/cash-factory/YoungMoney3/releases/download/staging-connector-v0.5.5-rc1/YoungMoney3.Connector.exe'
assert dashboard.count('href="'+published+'"') >= 2
assert "Download Connector v0.5.5-rc1" in dashboard
downloads=(root/"public/connector-download.html").read_text(encoding="utf-8")
assert "api.github.com/repos/cash-factory/YoungMoney3/releases" in downloads
assert "YoungMoney3.Connector.exe" in downloads
print("Connector release contract passed:",version,"on validated main with immutable assets and latest-download page.")
