# Cloudflare pilot operations

This $0 pilot runs as one Cloudflare Worker (`ym-fx`) serving the Vite app and API, with D1 (`trade-journal-pro`) for account and journal records. The default site URL is `https://ym-fx.ethical-hacker263.workers.dev`; a custom domain can be configured in Cloudflare after adding a domain you own. Cloudflare remains responsible for application data and authentication; Supabase Storage is used only for private image and audio attachments. R2 is optional and used only to read any older media stored there.

## One-time setup

Requirements: a Cloudflare account, Node.js/npm, and Wrangler authenticated to the intended account (`npx wrangler login`).

1. Confirm the D1 database ID in `wrangler.jsonc` belongs to the database named `trade-journal-pro` in your Cloudflare account. If no database exists yet, create one and update the ID in that file before continuing.
2. Apply the D1 schema:

   ```sh
   npm run cf:migrate
   ```

3. Build and deploy the app and API together:

   ```sh
   npm ci
   npm run cf:deploy
   ```

4. Set a private pilot invite code. Use a unique random value and share it only with the invited participants. Wrangler deploys an updated Worker with this secret:

   ```sh
   npx wrangler secret put PILOT_INVITE_CODE
   ```

Do not commit the invite code or any account credentials. New account creation fails closed until `PILOT_INVITE_CODE` is configured. All participants use the deployed site URL; use the same URL for subsequent backups and restores.

## Private media storage

Create a Supabase personal access token from [Supabase account tokens](https://supabase.com/dashboard/account/tokens) with access to create projects and read project API keys. Do not paste the token into chat, a command argument, or a committed file. From a VS Code terminal, enter:

```sh
read -s -p "Supabase personal access token: " SUPABASE_ACCESS_TOKEN; printf '\n'; export SUPABASE_ACCESS_TOKEN; npm run cf:media:create-project; unset SUPABASE_ACCESS_TOKEN
```

The token is hidden while typed and is not saved in shell history. The script lists your Supabase organizations and available project regions, recommends the EMEA grouping, asks before creating the project, and creates/reuses `ym-fx-media`. It then creates or updates the **private** `trading-media` bucket (15 MiB maximum file size and an allowlist of supported image/audio MIME types) and sets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as secrets on the `ym-fx` Worker. It does not print the service-role key. New uploads and reads are proxied through the authenticated Worker; object paths are restricted to the signed-in user's ID. Never make this bucket public.

The project creation request uses the Supabase Free organization plan. If Supabase requires billing information or the organization has reached its free-project limit, stop and resolve that in the Supabase dashboard; do not switch plans without reviewing the cost.

Supabase currently lists 1 GB file storage and 5 GB egress on Free; verify the current quotas before relying on them. Free projects may pause after one week of inactivity, temporarily interrupting media access until resumed. Export using **Data Backup & Restore**, then encrypt the downloaded JSON yourself before storing it; the application does not encrypt the backup file. Monitor Storage usage. The application enforces a 15 MiB maximum per file. Existing external media URLs remain unchanged; legacy Worker/R2 references continue to fall back to R2 only if that binding still exists.

## Administrator account

After deploying and applying the migration, provision the owner account with `scripts/provision-cloudflare-admin.mjs` using secure environment-variable injection for `ADMIN_EMAIL` and `ADMIN_PASSWORD` (do not type credentials into a command saved in shell history). The script seeds the admin's `Young-Money-Fx` and `Young Money 2.0` playbooks idempotently, then verifies sign-in against the deployed Worker. The invite code is only for creating participant accounts; sign in using the admin email and password. Change the initial password immediately after first login. Member administration is in **Account Settings**; deletion removes D1 records and private Supabase/R2 media and cannot be undone.

The app ships with a source-linked provider directory so broker selection works before any catalogue records are seeded into D1. The broker entries are candidates, not regional availability guarantees; verify the provider's legal entity and account type for the trader's location. Prop-firm rule snapshots link to official pages and carry a research date. Unknown or account-specific terms are left unknown, and account snapshots are informational only—not compliance checks or automatic enforcement.

Use `GET /api/health` for a public readiness check; it returns success only while the Worker can query D1.

## Local development

Run `npm run cf:migrate:local` once, then start `npm run cf:dev -- --var PILOT_INVITE_CODE:local-test-invite` in one terminal and `npm run dev` in another. Vite proxies `/api` requests to the local Worker; Wrangler persists test data under the ignored `.wrangler/` directory. Use only synthetic data locally.

## Pilot verification

Before inviting everyone, create two test accounts and verify:

- Each account can sign in, create and edit a trade, and see its own records after signing out and back in.
- One account cannot read or update the other account's records by using the app.
- A downloaded backup can be read, and a restore skips records that already exist.

The app's static instrument catalog is illustrative and does not provide live quotes. Calculator P&L, conversion, fees, position sizing, and risk are estimates based on entered/catalog values; verify contract details and conversion with the broker. Risk warnings are advisory only and do not block or control broker orders. Analytics are account-scoped so currencies are not combined.

## Backup and recovery

Open the profile menu and choose **Data Backup & Restore**. Export a backup at least weekly and before any deployment that changes the data model. The downloaded JSON is plaintext and can contain private notes and trade data; encrypt it yourself, store it outside the hosted app, and do not send it through public channels.

Restore adds missing rows and attachments; it does not replace existing rows or delete records. Restore requires the same account and deployment hostname. Test one restore before depending on this process. This user-operated export is not a substitute for provider-level backup or point-in-time recovery.

## Pilot boundaries

- This is a small-group information-capture pilot, not a production-grade financial or enterprise system.
- Do not store broker passwords, API keys, payment details, or identity documents.
- Keep access limited to invited participants and review D1, Worker, and Supabase Storage usage. Avoid uploading sensitive identity or account credentials as media.
- Cloudflare Free limits apply. Requests can fail once a daily D1 allowance is reached. Monitor usage and export records regularly.
- The application currently has no automated email verification, password-reset flow, or operational alerting. Participants should use unique passwords and contact the workspace owner if they lose access.
- Supabase Auth, Edge Functions, and the provider-source checker are not part of this pilot deployment; Supabase is used for private object storage only.

## Journal and MT5 rollout

Run the unit suite, Worker integration tests (`npm run test:worker`), lint, both typechecks and production build. Apply the new D1 migrations before deploying the corresponding UI and Worker together. Existing browser sessions require a fresh sign-in after the cookie migration.

Start with the default demo-only configuration. In MT5 Connections, download the Windows connector, pair the PC, and open **Connect MT5 account** on desktop or mobile. Choose an existing journal account with the same currency and login or create a new one. The Windows setup and terminal requirements are in [the connector guide](../connector/README.md). Existing journal accounts retain their opening balances and manual entries. Broker-reported cash balance and equity appear separately in Account settings.

For acceptance, use two demo accounts in separate dedicated portable terminal installations. Open a position, change its stop and target, partially close, restart the connector, and close the remainder. Compare each deal ticket, quantity, fee, swap and net result against MT5. Check mobile capture while the PC is online, switch portfolio/source filters, match a manual entry, and verify that replaying the history leaves counts unchanged. Keep live import disabled until the demo broker statement reconciles. Set the Worker variable MT5_ALLOW_LIVE to the string true only after this acceptance test. Revoking a PC disables its device token and retains its journal records.
