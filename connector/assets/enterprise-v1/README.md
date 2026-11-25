# YoungMoney3 Connector Enterprise visual system · Phase 1

Source: **YoungMoney3 Connector Enterprise Asset Kit v1**, red/black/white/gray.

**Only Windows connector UI/UX.** No dashboard, Worker, broker capture, copier execution, permission, credential or account storage change.

- `enterprise_theme.py` provides safe native Tk design tokens, accessible color choices and a lightweight hero rendition.
- `connector_gui.py` uses the new shell styling, buttons, contrast, typography, navigation and overview hierarchy.
- `assets/enterprise-v1/hero-operations-dark.svg` is the exact source vector from the approved kit.
- `render_enterprise_preview.py` captures genuine Windows Tk screens in an isolated unpaired environment with no network sessions.
- CI validates desktop and compact views. Do not present prototype data as broker data.

The original asset kit has 1,331 files and should remain a source archive, not a runtime dependency. Do not bundle unused large rasters into the frozen .exe.

Next stage: selectable broker account cards with on-demand details, contextual copy permission workflow, semantic notification components, tray assets, populated-state and Windows real-user acceptance.
