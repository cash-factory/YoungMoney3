# Authentication upgrade — release and rollback safeguards

Scope: YoungMoney3 staging credential verifier migration. **No production authorization is implied.**

## Version compatibility

- Legacy user records contain an unprefixed base64 PBKDF2-HMAC-SHA256 digest derived with **100,000** iterations and a separate random base64 salt.
- New user records contain \`pbkdf2-sha256$600000$<base64 digest>\` with a new random salt.
- Only a **successful legacy sign-in** triggers a compare-and-swap upgrade. Wrong passwords never rewrite credentials.
- Changing a password or completing recovery directly writes the new version and invalidates existing sessions.
- Existing browser sessions are not invalidated merely because a user successfully upgrades their password during sign-in.
- The API must not expose the digest or salt in user/profile responses.
- Hash formats not explicitly supported, malformed digests or unreasonable encoded work factors must fail closed.

## CRITICAL: rollback compatibility

**Do not roll back to a Worker revision that supports only the old, unprefixed 100k verifier.** It cannot authenticate users who have signed up, changed passwords or signed in using the stronger version.

For recovery from an unrelated Worker regression, use a tested previous release **which retains the dual legacy/versioned verifier**. If no such compatible release exists, prepare and validate a small compatible hotfix on a release branch before rolling traffic back.

Do not restore an earlier \`users\` database snapshot over current credentials merely to revert the authentication code: doing so could resurrect revoked passwords, reset recovered accounts or undo security-sensitive changes.

## Current automated release evidence

- Password cryptography: \`scripts/test-passwords.mjs\`
- End-to-end D1 signup, sign-in, migration, wrong-password rejection, password changes and session revocation: \`scripts/test-worker.mjs\`
- Authenticated workspace, account separation, recovery, safe profile fields and MT5 integration: \`scripts/test-worker.mjs\` and CI checks
- Staging Worker and API health: \`.github/workflows/staging-release.yml\`

A green CI build demonstrates passing fixtures **not** production load or real customer sign-in performance.

## Staging acceptance before production approval

1. Use one consented existing staging test account to verify ordinary sign-in, session persistence, sign-out and sign-in again. Never send account credentials to a developer or add them to logs.
2. Verify account recovery, password rotation, and a login from a second device. Old sessions must be invalid after password change/recovery.
3. Verify a newly registered invite-only test member can sign in (subject to owner approval).
4. Measure auth latency and Worker CPU/1102 resource-limit errors at the actual Cloudflare plan and under realistic concurrent requests; 600k derivation raises processing cost and infrastructure allowances vary.
5. Capture sanitized evidence and an action log. Confirm the corresponding D1 user record upgraded to the supported prefix through a privileged, read-only diagnostic—not by exporting hashes to public artifacts.
6. Exercise rollback to an earlier **dual-verifier-compatible** release in disposable staging, then sign in with both legacy and upgraded fixture records.
7. Securely verify that the session cookie remains HttpOnly, Secure, SameSite=Strict, and that public endpoints never return credential fields.

**Production launch remains blocked until owner authorization and full acceptance checks**, including Windows MT5 field testing and data privacy isolation.
