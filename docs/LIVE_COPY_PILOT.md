# Copy Fleet — real-money pilot acceptance and operating contract

**Status:** Implementation branch only. No real broker account was logged in and
no actual orders have been transmitted in development or automated testing.

## Release switches and ownership

Copy Fleet supports two explicit modes, `demo` and `live`, on separate
fleets. A LIVE fleet can use a verified DEMO or LIVE source, but every enabled
follower must be a verified LIVE trading-enabled account owned by the same
workspace. There is no automatic mode upgrade from a demo fleet.

The Worker can verify/sync live account history only when the deployment
operator explicitly configures `MT5_ALLOW_LIVE_COPY=true` (or the existing
`MT5_ALLOW_LIVE=true`). **Neither flag arms a fleet, grants broker execution
permission, or submits an order**. Leave these flags unset in environments
where live-account capture has not been approved.

To submit live copied orders, all of the following must be true:
1. The Windows connector is paired, online, and attached to the exact
   linked broker login/server in its own dedicated MT5 portable profile.
2. The follower account has confirmed MT5 real mode (2), trading permissions,
   expert/algorithmic trade permission, and a live-capable broker connection.
3. The local Windows app operator selects that exact account and authorizes
   LIVE copying by confirming `LIVE <account-number>`. The permission is stored
   in the local account-scoped SQLite database. Revocation is immediate for new
   tasks and never requires a website connection.
4. The server receives recent authenticated account-specific consent with the
   same trade mode, login and server. The consent expires without check-ins.
5. The owner saves a LIVE fleet and separately confirms
   `ARM LIVE <fleet-id-prefix>` on the website. Each follower is explicitly
   selected, enabled, online, and locally authorized.
6. A source event is fresh, not an old reconnect replay. A task has a unique
   idempotency key, a short expiration, a matching live mode, and a current
   fleet state. A revoked/paused account receives no new task.
7. The local follower validates broker account identity, current quote,
   symbol mapping, SL distance, stop risk using `order_calc_profit`,
   volume increment, free margin, daily downside allowance and `order_check`
   immediately before a one-time `order_send`.

A newly received broker task without an explicit `executionMode` is rejected.
An unknown broker response is **not retried automatically**. Dispatched orders
can complete even after emergency pause; reconciliation against actual
broker positions/deals is required.

## Risk and cross-broker execution

For the initial live-money pilot, configured daily loss policy may not exceed
5% of follower equity, and newly opened or pending orders with a predicted
stop loss above 2% of follower equity are refused. These are upper preflight
limits, **not guaranteed maximum losses**: gaps, commission, spread changes,
broker outages, negative balance rules and slippage can exceed modeled stops.

Allocation modes are follower equity percentage, a fixed risk amount in the
follower's native account currency, equity ratio (same currency only without
verified FX conversion), and a lot multiplier. All use follower broker contract
specifications and round lots DOWN. Below-minimum requests are rejected rather
than rounded UP. Broker-specific symbol suffixes require explicit mappings.

Pending orders, stop-limit orders, TP/SL changes, partial closes and cancellations
may differ across brokers; an accepted order is not necessarily a filled position.
Hedging/netting and FIFO restrictions, partial fills and broker modification
rules must be tested on each intended account. Copying other people's accounts
may trigger broker, prop firm, licensing or financial-services obligations.

## Minimum validation before a real-money release

- All unit, TypeScript, Miniflare+D1, UI and Windows CI checks pass at the
  exact candidate commit.
- Windows tests verify independent terminal identities, account switches,
  denied investor-only access, local consent/revoke, live-mode rejection,
  stale-quote rejection, broker order preflight and idempotent unknown outcomes.
- For at least two brokers on DEMO, verify one source and three followers with
  unequal balances, a cross-currency fixed risk follower, mapped symbols,
  entry+SL+TP, buy/sell limit and stop-limit, edit/cancel, partial/final close,
  disconnect/reconnect, duplicate commands, terminal restart and kill switch.
- Reconcile every attempted command against actual MT5 order/deal/position
  tickets and statements. Inspect mismatches rather than blind retrying.
- Only after those checks and a separate deployment/release approval, begin a
  **supervised, single-follower real-money acceptance** with deliberately small
  exposure that the account owner has explicitly authorized, confirming exact
  broker account, risk sizing and resulting orders. Increase coverage only
  after no unresolved orders or reconciliation gaps remain.

No developer command, code merge, branch update or CI test should independently
activate real-copy execution on a user's accounts.
