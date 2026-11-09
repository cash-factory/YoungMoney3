# Repository governance and release approval

The tracked code includes `.github/CODEOWNERS` and a mandatory `Validate` workflow. **Neither automatically enables branch protection.** The GitHub repository owner must configure protection in Settings → Rules → Rulesets (or Settings → Branches if available).

Recommended rule targeting `main`:
- Require changes through a pull request, with passing checks **checks** and **mt5-terminal** from `Validate`; require branches to be up to date.
- Disallow force pushes and deletion; require resolution of review threads; require review of changes to Workers, security, migrations and connector sources.
- Enable code owner review with at least one separate trusted collaborator. GitHub does not count an author's own approval; a solo-owner repository can deadlock if approval is mandated without another reviewer. Decide the governance setup deliberately and document any owner bypass.
- Limit bypass to trusted owner/break-glass situations, and log the reason. Never auto-deploy a merge to production just because CI passes.
- Protect the production Cloudflare Worker with separate deployment approval, migration checks, backup confirmation and actual MT5 demo reconciliation.

Until the GitHub ruleset is configured, `main` remains unprotected even though CODEOWNERS and CI exist. This cannot be fixed by adding files alone. The repository owner should verify GitHub's branch/ruleset status after enabling it.

## Operator readiness

Confirm the latest PR checks, validate migration `0006`, `0007`, `0008` in isolated staging, complete real/demo MT5 reconciliation, restore an encrypted D1/media backup, and record approval before deploying. Admin Operations can pause invited registrations but cannot turn on broker trading, edit another user's private journal or modify Cloudflare billing or secrets.
