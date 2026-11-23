# YM-FX Copy Studio — Multi-account broker execution contract

**Status (23 November 2026):** The codebase contains a paused one-to-many
control plane, deterministic per-follower risk planner and an isolated,
demo-only opt-in MT5 order executor. The read-only capture connector does not
invoke it. **No website or device-side automated command dispatch is enabled.**
These components must not be marketed or treated as a functioning trade copier
until the acceptance gates below pass in actual MT5 broker demo accounts.

## 1. Account-aware connector

Every dedicated MT5 terminal is attached to a verified broker login/server.
The selected account panel displays its broker name, login, trading mode,
balance, equity, free margin, open positions, pending orders, floating P/L,
account trade permission, external algorithmic trade permission and last
acknowledged sync. These are non-secret local observations, not authority for
executing orders. They are scoped by the assigned terminal and linked account
identity; switching the terminal to another broker login invalidates the
execution grant.

## 2. Fan-out model

One source account can have 1–20 individually owned, verified demo followers.
Each follower has its own policy, order state, source-to-target symbol mapping,
tick precision, lot step, trading sessions, margin, maximum exposure and
broker result. A failed follower MUST NOT prevent unrelated followers from
being acknowledged, but its failure must be visible and independently
retriable only when safe. The source is not implicitly a follower, and
cross-user routes are forbidden.

A single Windows installation can host independently managed MT5 portable
terminals, one active broker account per terminal/worker. Never send an order
to a terminal selected by fuzzy name; require exact bound login, server,
local terminal data path and verified active session before every command.

## 3. Broker observation -> intent -> broker order

1. The read-only source captures raw position/order/deal evidence.
2. Only fresh, server-acknowledged source evidence creates a normalized
   intent. Each intent has stable ID, owner, source link, order ticket or
   position lifecycle, exact broker action and monotonic source revision.
3. The desired state can include market buy/sell, buy/sell limit,
   buy/sell stop, buy/sell stop-limit, cancel/replace pending, stop/TP update,
   partial close, final close, source cancellation and expiration.
4. An authenticated, separately permissioned execution agent claims an
   intent for a particular bound follower; a durable unique event record
   exists *before* order transmission.
5. It validates group state, owner's **explicit demo opt-in**, currency
   and risk policy, source/follower identity, fresh quotes and symbol mapping,
   broker lot min/max/step, market stop/freeze levels, trade modes, order
   filling modes, expiration, margin, per-trade/daily exposure and available
   funds. Any unproved condition is a rejection, never a guessed fallback.
6. The execution agent calls MT5 `order_check`, then at most one
   `order_send` for that unique event. `order_check` is not a guarantee
   of acceptance; actual placement and fills require confirmation.
7. The order result is only **provisional** until the follower's own MT5
   order/deal/position evidence proves broker state. Persist the target
   order/deal ticket and unique source->target mapping, not only the magic
   number or broker comment. Broker comments may be truncated or modified.
8. Compare the follower's observed state with desired state on reconnect.
   If send outcome was ambiguous, mark `unknown`, inspect broker history
   and open orders, and reconcile. **Never blind-retry a possibly executed
   order.**
9. When a follower is disconnected, show `lagging` / `missed` /
   `requires_review`. Do not replay a stale market entry after reconnect.
   An unfilled pending order requires validity-window and current-price
   revalidation and owner policy; never duplicate a pending order.
10. Record source and target prices, slippage, reject codes, execution
    timings, gross/net P/L, copied SL/TP and protective updates in a
    per-follower ledger with immutable audit events.

## 4. Independent sizing

- **Equity percentage:** requested risk = follower equity × risk%.
- **Balance percentage:** requested risk = follower balance × risk%.
- **Fixed currency risk:** requested risk in the **follower's account currency**;
  do not treat USD, ZAR and EUR as interchangeable.
- **Balance ratio:** requested lots = source lots ×
  (follower balance / source balance) × chosen scale, subject to stop-risk
  limits.
- **Lot multiplier:** requested lots = source lots × chosen multiplier,
  again subject to follower risk ceilings.

For each follower, use that **follower's MT5** `order_calc_profit` with its
exact broker symbol, buy/sell side, intended entry, SL and 1.00 lot to
calculate monetary stop loss per lot. The result can incorporate broker
contract size and account-currency conversion; do not derive FX pip value
from symbol spelling. Compute risk target/loss_per_lot and ROUND DOWN to the
broker's volume step. Reject sizes below broker minimum instead of rounding
UP. Independently enforce hard max lots, max risk% of equity, margin% of equity
and available margin. Use `order_calc_margin` and `order_check` again
immediately before execution.

Market price and spread, pending trigger/limit prices and tick sizes must be
validated at send time. Planned R multiple and monetary TP estimate can be
shown but never guaranteed. Risk at SL may be exceeded by slippage, gaps,
commission and swaps; a broker can reject or delay requests.

## 5. Order state machine

`observed` → `validated` → `reserved` → `sent` →
`acknowledged` → `broker_confirmed`, or
`rejected`, `expired`, `unknown`, `requires_review`.

`unknown` is never automatically retried. A source order fill can precede
the source's pending-order polling; reconcile source order history and deals
before deciding whether an action needs copying. For hedging versus netting,
explicitly detect the follower account margin mode; account for partial
fills and per-position SL/TP targeting. Distinguish a pending order's SL/TP
from the protection for an already-filled position. All modifications and
cancellations are scoped to verified, copier-owned follower tickets.

## 6. Safety and release

Required before allowing live-money followers:
- Verified read-only source capture and multiple simultaneous dedicated MT5
  terminal sessions on real Windows hardware.
- Two or more independent broker demos tested, with at least three followers,
  different balances, symbols with suffixes, different deposit currencies,
  minimum/step and margin regimes, partial fills and pending stop-limit orders.
- End-to-end tests for lost acknowledgements, 409 conflict, reconnection,
  duplicate commands, paused group, owner revocation, inconsistent server
  timezones and duplicate market order after process crash.
- Exact broker result code handling; no automatic retries on ambiguous order
  outcomes.
- Hard user-visible pause/kill switch, per-source/follower opt-in and
  emergency disable on the device; verify the switch persists offline.
- Prop-firm and broker permission review, copy-trading terms, and applicable
  local financial/regulatory obligations, especially if copying other users'
  accounts or offering copy service commercially.

**Current milestone:** the Python order planner and isolated demo executor
`connector/copy_engine.py` and `connector/copy_execution.py` are
implemented and unit-tested against mocked MetaTrader5 semantics, but
**are not wired to a remote command queue**. The dashboard group planner is
a scenario calculator with explicitly user-assumed per-lot losses; only an
authenticated, demo-opted local execution agent may use broker-calculated
values to transmit an order. Existing Copy Studio drafts remain paused and
cannot send broker orders.
