# YoungMoney3 — Connector identity and trade-copy execution architecture

**Status:** Architecture proposal / non-executing specification. **No live trade execution is implemented or authorized by this document.**  
**Baseline:** The existing Windows connector is read-only. Its MT5 accounts are associated with a paired device and that device's authenticated YoungMoney3 owner.

## Decision

Keep one YoungMoney3 desktop experience, with **separate permission and execution boundaries**:

1. **Capture connector** (existing): discovers MT5 terminals, verifies broker links, journals immutable fills, captures account telemetry, reports presence. Never sends orders.
2. **Identity/control plane** (Cloudflare Worker + D1): authenticates users and devices, stores owner-scoped account metadata, explicit copying grants, risk profiles, audit records, status, and revocations. It never stores raw MT5 passwords or signs in to users' terminals.
3. **Trade Copy Agent** (new, optional process/EA module): consumes verified source execution events and makes controlled, user-authorized orders *only* in an explicitly enabled follower terminal. Keep its signing keys, IPC endpoints, privileges, failure policy and release gate distinct from the read-only connector.
4. **Desktop interface**: one consistent application can manage both modules, but an operator must explicitly enable copying on a per-target-account basis. Read-only monitoring is the default.

Do not implement a standalone **disconnected** app that duplicates MT5 discovery, pairing, account metadata and device health. Nor should the current capture worker gain unguarded `order_send` privileges. A separate execution component within a shared product is the best security/UX compromise.

## Precise identity model

Distinguish four entities:

- **Platform user:** authenticated YoungMoney3 member, primary key `users.id`.
- **Physical PC:** a human label for a computer, not a security principal; multiple Windows profiles on one physical computer must not be silently correlated or fingerprinted.
- **Windows connector installation:** non-secret, stable, locally persisted `installation_id`; not a password, and not proof of hardware ownership.
- **Paired device:** server-generated `mt5_devices.id`, a token/public-key pair bound to exactly one platform user (`owner`). Linked MT5 accounts belong to that user and this paired device.

Current implementation has one owner per paired device, and a single Windows user's credential vault contains its token. If two YoungMoney3 users use the same PC:

- **Immediately supported isolation model:** use separate Windows user profiles, each with independently paired connector/device, account store, credential vault and installation ID. Server and admin inventory treat these as independent owner-bound pairings. Do not advertise them as one shared logical device.
- **Future shared-host model:** require explicit opt-in and a multi-tenant supervisor with isolated per-user worker processes, per-user vault entries and durable owner-scoped outboxes. A host registry may group device records only through *affirmative association*, never through unconsented hardware fingerprinting.
- **Never:** let one owner's bearer token claim, poll, sign orders for, or view another owner's broker account. Device presence never proves a user authorized copying.

The administrator's PC directory is *read-only* and shows owner identity, PC label, last check-in, version, and number of connected accounts. It must never return tokens, encrypted envelopes, broker passwords, fills or private journal entries.

## Trade copying: domain model

Recommended entities:

- `copy_sources(id, owner_user_id, broker_link_id, enabled, execution_mode, created_at)`
- `copy_targets(id, owner_user_id, broker_link_id, execution_agent_id, grant_status, consent_version)`
- `copy_grants(id, source_user_id, target_user_id, source_id, target_id, scope, expires_at, revoked_at, approved_by_target_at)`
- `copy_rules(id, target_id, version, allocation_mode, max_risk_pct, max_lots, max_spread, max_slippage, symbol_allowlist, price_age_ms, allow_existing_positions, allow_partial_closes, allow_modifications)`
- `copy_events(event_id, source_link_id, source_deal_id, position_id, event_type, event_version, occurred_at, observed_at, payload_digest)`
- `copy_intents(intent_id, grant_id, target_id, source_event_id, rules_version, desired_effect, expires_at, status)`
- `copy_executions(id, intent_id, target_order_id, target_deal_id, broker_retcode, filled_volume, price, verified_at, failure_code)`
- `copy_audit(id, actor_user_id, grant_id, event_type, reason, recorded_at)`

Enforce foreign-key ownership, per-tenant query guards and server-generated IDs. Store the explicit identity mapping `(source_event_id,target_id,event_type,event_version)` as a uniqueness key to prevent duplicate copy orders. An append-only execution/audit history must distinguish *requested*, *submitted*, *broker accepted*, *partially filled*, *fully filled*, *rejected*, *expired*, and *reconciled*.

## Execution flow

1. **Enrollment:** operator installs/activates the optional Copy Agent. Show permissions separately from journal capture, including that orders may be placed. Confirm the destination account's broker identity and account type.
2. **Grant:** the target account owner authorizes a specific source→target relationship, maximum exposure, symbols and expiry. Cross-user grants require recipient acceptance; source cannot enroll followers unilaterally. Revocation is immediate for new intents.
3. **Detect:** use MT5's `OnTradeTransaction` / actual deal evidence for low-latency source detection where possible. Periodically reconcile MT5 history for missed/reordered events. Never infer a completed fill from an `OrderSend` success boolean alone.
4. **Normalize:** capture source account/position/order/deal IDs, hedging/netting model, symbol contract specs, side, actual filled quantity, price, SL/TP, timestamp, broker revision and originating trade identity. Exclude trades originated by the copier unless a deliberately allowed, cycle-safe policy says otherwise.
5. **Map:** resolve destination broker symbol only against verified broker metadata; compare contract sizes, tick size/value, volume step, minimum/maximum volume, trading session, filling modes, margin currency and stop distance. Reject unknown mappings.
6. **Risk check:** determine follower sizing using chosen **explicit** mode (fixed lot; proportional equity; capped percentage-of-equity risk based on actual SL distance). Clamp to maximum position/trade/notional/daily loss, total portfolio exposure, free-margin limits, market-spread, slippage and stale price constraints. Reject trades with missing SL when risk mode requires one.
7. **Intent:** persist immutable copy intent with idempotency key and short expiry. Verify source position still exists and the grant/rules are still valid just before submission. An offline queue must **not** blindly open old entries on reconnect.
8. **Execute:** the local target agent, and only that agent, submits its own account's order. Check MT5's trade-server retcode and resulting actual deals. Record partial fills and broker rejections. Do not retry uncertain broker outcomes without reconciliation.
9. **Maintain:** apply authorized partial closes, stop moves and pending-order changes by position lifecycle, preserving the exact source-to-target identity map. Never assume that source and follower volumes/prices are the same. Handle both hedging and netting semantics and manual follower intervention.
10. **Reconcile:** independently poll broker position/deal history and compare intended vs actual result. Surface divergence; allow target owner to pause, detach, or intervene. No silent repair that adds unintended exposure.
11. **Stop:** global emergency stop plus per-target stop. Stopping prevents new intents; existing orders/positions remain unless the user separately opted into a documented close/cancel policy. Disconnections fail closed for new entries.

### Scheduling and latency

- **Same PC:** isolated per-terminal processes with a local authenticated IPC channel, durable event journal and single target executor.
- **Different PCs / VPS:** use an authenticated encrypted relay with per-target offsets, short time-to-live and acknowledgments. Measure end-to-end event→fill latency; avoid guaranteeing execution price or synchronized fills.
- **Multiple followers:** one order decision per target, per event, with independent risk checks. Never use a shared target MT5 session across untrusted users.

### Copy-loop safety

Each generated order carries a stable copy-origin marker. Detect and reject A→B→A cycles, copying a copy recursively, self-targets and duplicate followers linked through different paths. Never trust only a platform-facing label; reconcile actual MT5 source IDs.

## UX boundary

**Account monitor** remains the read-only default, with PC Owner, Device ID, Broker connections, Check-in health and sync status.  
**Copy Studio** is an optional separate workspace with Source, Followers, Rules, Simulation, Execution ledger, Alerts and Emergency stop. Every follower card identifies its owner and its grant (when consent permits). No copying action can be initiated from the journal's ordinary capture or import screens.

Confidence levels should be explicit: **Paired** (device token valid) ≠ **Online** (recent presence) ≠ **Broker verified** (correct MT5 account) ≠ **Copy enabled** (fresh explicit target consent) ≠ **Executed** (broker fills reconciled).

## Regulatory and operational gates

- Start with **same beneficial owner / demo accounts only**, *read-only shadow copy simulation*, then consented demo execution. Do not enable real trades before a separate owner approval and broker/regulatory review.
- Third-party social copying may amount to a regulated investment service depending on jurisdiction and business model. Verify broker/prop-firm terms, permissions, signal/portfolio-management regulation, customer suitability and disclosures before offering cross-user following.
- Keep broker passwords local; use least-privilege signed instructions, TLS, encrypted rest where appropriate, replay protection, audit events, signed releases and privilege separation.
- Do not advertise guaranteed low latency, profit equivalence or loss prevention.

Official technical references:
- https://www.mql5.com/en/docs/event_handlers/ontradetransaction
- https://www.mql5.com/en/docs/trading/ordersend
- https://www.mql5.com/en/docs/trading/ordersendasync
- https://www.esma.europa.eu/press-news/esma-news/esma-provides-guidance-supervision-copy-trading-services

## Acceptance criteria

**Connector identity / read-only release:**
- New pairing claim includes the locally stable installation ID; duplicate active pairings reject before saving new credentials.
- An admin can identify each claimed PC's account owner; a member cannot enumerate another member's devices.
- No secret/token/public key/broker data leaks through admin inventory.
- Revocation and presence ownership checks remain intact.
- Regression tests and real Windows connector pairing/reconnect verified before release.

**Trade copier future release:**
- Source→target grants cannot be created without target user's confirmation; grants are revocable and expire.
- Dry-run and two-account demo replay demonstrate correct fills, partial closes, duplicate suppression, rejections, offline staleness, restart reconciliation and cycle detection.
- Symbol/risk mapping verified against **both** brokers' actual contract specs; mixed netting/hedging account testing.
- Kill switch tested under active orders, disconnection, server restart and stale broker state.
- Independent security review of cross-user boundaries, credentials, signed instructions, intent replay and fail-closed behavior.
- Both an owner-controlled demo environment and a clean Windows installation verified; never equate CI-green with live-trading readiness.

## Explicit non-goals of this change

This proposal does **not** introduce live-trading access to the connector, cross-user broker sharing, automated portfolio management, or any real-money execution capability. No migration, Worker execution endpoint or EA trading command is authorized by this spec.
