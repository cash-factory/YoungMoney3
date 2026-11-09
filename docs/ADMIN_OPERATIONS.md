# Administrator Operations and recovery

The **Admin Operations** page is a separate route (visible only to active administrators). The Worker checks the admin role on every operation, not just when displaying the menu. It provides member status management, audit history, one-time recovery code issuance/revocation, session invalidation, a registration pause switch, and aggregate account/connector health.

## Member recovery
1. Confirm the member's identity **out of band** before issuing a reset code. A recovery code is equivalent to password-reset authority and must not be posted publicly.
2. In Admin Operations, provide your own current administrator password, choose **Issue recovery code** beside the active member, and copy the one-time code securely.
3. The member opens Login → **Have a recovery code?**, enters their registered email, the code and a new password of at least 12 characters. Codes expire after 15 minutes and are consumed only once.
4. Successful recovery invalidates existing sessions and creates an audit record. A suspended member must be restored by an admin before recovery. Issue/revoke events are logged but code plaintext is never stored in D1.
5. Email-based self-service recovery is **not yet installed**. Codes are given through a secure channel by the authorized admin; verify identity first. This is for a controlled pilot, not general public launch.

## Owner/admin lockout
There is deliberately no anonymous reset path for an administrator and no UI action to reset another administrator. An operator with **actual Cloudflare account access** can recover the existing owner without changing member roles or accessing their trades.

Run `npm ci`; confirm a fresh encrypted provider-level backup, intended Cloudflare account and production D1 identity. Set `OWNER_RECOVERY_EMAIL`, `OWNER_RECOVERY_PASSWORD` (16–256 characters) and the deliberate confirmation variables `OWNER_RECOVERY_TARGET=production` and `OWNER_RECOVERY_CONFIRM=RESET_PRODUCTION_OWNER_PASSWORD` in a private operator shell, then run:

```sh
node scripts/recover-cloudflare-admin.mjs
```

The script looks up exactly one existing admin, updates only that account's password hash/salt, revokes sessions, invalidates codes, writes an audit record and verifies the result. It cannot create a new administrator. Never put the new password in a command argument, source control, or screenshots; clear the environment variables after use. Only an authenticated Wrangler operator can run it; this ChatGPT coding session has not executed the script against Cloudflare.

## Safeguards
An admin can view user email, username, status and aggregate counts, **not** read another user's private trade journal, broker login secret, or private media. Destructive actions have user confirmation and server-side role checks. Automated off-site backups, Cloudflare secret rotation, MFA, security alerts and email delivery remain provider-level work, not invisible powers granted to the UI.
