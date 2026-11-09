# YoungMoney3 — Maintainer Architecture

Updated: 2026-11-09. This document describes the current **Cloudflare Worker pilot architecture**, not the historical Supabase database deployment.

## Request path

```
React + TypeScript / Vite / Tailwind (src/)
  App: Landing → Auth → optional Onboarding → Workspace
  Components/pages → src/hooks/useData.ts (stable re-exports)
  → src/hooks/data/* (domain-specific state, fetches and mutations)
  → src/lib/supabase.ts (same-origin /api compatibility client; not a live DB SDK)
    → worker/index.ts (authentication, data, media, administration)
       ├── Cloudflare D1 (users, sessions, workspace_records, audit, MT5)
       ├── private Supabase Storage (screenshots, audio; R2 legacy fallback)
       └── worker/mt5.ts (paired-device synchronisation)
Windows: connector/connect.py + ledger.py (read-only MetaTrader 5, encrypted pairing, SQLite outbox)
```

## Sources of truth

- `migrations/0001_*.sql` through `0005_*.sql` define the live Cloudflare D1 schema. Do not apply `supabase/migrations` as an alternative live schema without an explicit migration project.
- `src/lib/types.ts` defines the journal and workspace shapes.
- `src/lib/instrumentMath.ts`, `tradeFinance.ts` and `settleManualTrade.ts` provide financial calculations and settlement. The Worker validates and recomputes manual financial writes.
- `src/lib/riskPolicy.ts` resolves account, plan and workspace risk limits; `riskMetrics.ts` calculates account-specific outcomes, close-time daily P&L, exposure and drawdown.
- `src/lib/ai.ts` provides **rule-based**, not predictive-model-generated, insights; only comparable currency cohorts should be summarized.
- `worker/selectRecords.ts` performs owner-scoped queries. `worker/index.ts` performs owner checks for writes and owned relations.
- `worker/mt5.ts` receives read-only, demo-gated connector events; the broker statement, not the UI, is the authority for execution results.

## Feature ownership

| Domain | Primary module | Major views |
| --- | --- | --- |
| Broker/instrument catalog | `hooks/data/catalog.ts`, `instruments.ts` | Trade capture, Broker/Charting |
| Accounts, adjustments | `hooks/data/accounts.ts` | Dashboard, Account settings |
| Trades | `hooks/useTrades.ts` | Trades, Journal, Dashboard, Calendar |
| Journal | `hooks/data/journal.ts` | Journal |
| Strategies and setups | `hooks/data/strategies.ts` | Strategy Library, Setups, Trade Form |
| Plans, rules and risk | `hooks/data/riskPlans.ts` | Risk Management, Trading Plan |
| Tests/simulations | `hooks/data/testing.ts` | Strategy Testing, Dashboard |
| Goals | `hooks/data/goals.ts` | Goals |
| Research/notes/reviews | `hooks/data/knowledge.ts` | Notes, Resources, Weekly Reviews |
| Profiles | `hooks/data/profiles.ts` | Settings |

`hooks/useData.ts` stays as a public compatibility barrel for existing page imports. Avoid adding new domain logic to it.

## Invariants to preserve

1. No record or media path can be read or mutated by an account other than its owner.
2. MT5 fills are broker-owned; manual changes must never masquerade as an MT5 import.
3. Financial changes to a manual trade are validated and settled at the Worker boundary.
4. A trade delete requires the last-seen `updated_at`; stale writes must fail rather than overwrite.
5. Amounts of different currencies must never be silently added together. Risk metrics are account-scoped.
6. Risk warnings are advisory; they do **not** send or block broker orders.
7. Manual journal P&L and MT5 broker-reported balance/equity have separate meanings.
8. Keep the original landing → login → optional onboarding → workspace experience and device-level palettes stable during refactors.

## Tests

Use `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:worker`, and `npm run build`. Test `connector/test_ledger.py` on Python and `connector/test_terminal.py` with the MT5 dependency on Windows. GitHub Actions runs those checks on pull requests.

## Deployment

The Worker/asset deployment is configured by `wrangler.jsonc`. Keep D1 migration order synchronized with backend changes. Use the instructions in `docs/OPERATIONS.md` and the release gates in `docs/PRODUCTION_READINESS.md`. Never use an actual broker password, live trading account or production DB to exercise test cases.
