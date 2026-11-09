# Security and account isolation acceptance

The application runs first-party sessions with `HttpOnly; Secure; SameSite=Strict` cookies; all state-changing browser requests require same-origin fetch context. MT5 device authorization uses separate revocable bearer tokens. User and journal account identifiers are checked against the authenticated owner. Full-access broker credentials are never a reason to enable trade execution in YoungMoney3.

## Still unconfigured externally

Admin-assisted recovery now offers a 15-minute one-time password-reset code after identity verification by an authenticated administrator. A **provider-backed email ownership verification and secure emailed self-service reset flow still do not exist**; members cannot recover anonymously without an admin. Owner lockout recovery requires authenticated Cloudflare provider access and explicit operator confirmation, not a public endpoint. Configure separate least-privilege Supabase media credentials and Cloudflare monitoring/secrets, and consider MFA for administrator sessions. Run a security review (including credential handling in the Windows connector and keyring) after enabling full-access MT5 logins.

## Isolation tests required in staging

- User A creates two different-currency accounts and links one broker account to each.
- User B must not list, read, change, delete or import either user's trades, accounts, screenshots, MT5 links or preview identifiers.
- Stolen session cookie attempt from another site or subdomain must be rejected for mutations.
- Signed-out and suspended users must not access their prior records; revoked connector tokens must stop working.
- A complete source-code scan and Windows test should establish that neither the website nor the connector invokes `order_send`, `order_check`, `TRADE_ACTION_DEAL` or any other broker execution route.
- Test the new `Admin Operations` page: normal members cannot access it, codes are issued only after admin password confirmation, code plaintext is not stored in D1, redeemed codes cannot be replayed, and old member sessions are invalidated.
- Credentials for a full-access MT5 login are processed by the browser's local encryption, delivered through a temporary device envelope, decrypted by the local Windows connector and saved to the current Windows user's credential manager. They must not be logged, included in backups, or exposed by the Worker status API.

## Operational prerequisites

Require production branch protection, trusted-review requirements, staging approval and independently stored encrypted backups. Passing automated tests alone does not certify a public financial platform.
