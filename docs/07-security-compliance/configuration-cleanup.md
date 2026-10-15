# Yoga Studio 1.1.1 — configuration cleanup and history sanitization

- Date: 2026-10-15
- Status: Implemented changes; remote cleanup/deployment must be verified separately
- Scope: Existing account application only. No backend/proxy or new product feature added.

## Findings and actions

A pattern scan of 90 reachable Git blobs found project identifiers in 15 blobs and no matching access tokens, secret keys, private keys or JWT credentials. This is bounded pattern evidence, not a complete forensic/security audit. A separate deployed-bundle check identified a legacy **anon** key, not an administrative/service-role key. Anon/publishable keys and the API endpoint are designed to be public browser configuration.

Current source, workflow fallbacks, `.env.example` and project documentation have been scrubbed of the real endpoint/reference. The known deployment values were moved from repository Actions variables to encrypted **Actions secrets**; duplicate variables were removed. `.env.example` contains only blank fields. Environment/private-key files are ignored. Do not commit live values again.

The workflow reads only `secrets.VITE_SUPABASE_URL` and `secrets.VITE_SUPABASE_ANON_KEY`. Without the public key, it does not inject an unused endpoint fallback. Never place a service-role/secret key in either field. Build configuration rejects administrative or malformed keys; runtime initializes Auth only with a valid HTTPS URL and public key. Credential pattern checks run on committed files and built assets and print categories/filenames only, not values.

## Important visibility boundary

GitHub Actions secrets keep values out of public source and redact them in workflow logs. They **do not make browser configuration secret**: Vite substitutes `VITE_` values into client assets, and a browser must know the endpoint/key to communicate with Supabase. Users can inspect those public values in network traffic or compiled code when authentication is configured.

Hiding the endpoint or public key from the browser requires a trusted server/BFF or proxy and an approved architecture change. Static GitHub Pages alone cannot hold runtime secrets or perform server-side authentication. No obfuscation or claim of invisible browser credentials is made. Authorization must be enforced by Supabase Auth and RLS/server policies for any future tables.

## Owner-authorized history rewrite

The owner explicitly selected removal from older commits. Replace the historical endpoint and raw project reference, rewrite reachable branches, and force-push with an expected-head lease. Commit IDs change; collaborators must re-clone or carefully reset/rebase. Historical document commit IDs may no longer resolve.

Rewriting branch history does not recall forks, clones, downloads, screenshots, browser caches, PR references or externally retained objects. Old GitHub commits may remain accessible by known IDs or cached views; request GitHub support assistance if necessary. The hardcoded endpoint is not a privileged credential. Any actual exposed credential must still be revoked/rotated at its issuer.

Review and remove obsolete workflow artifacts/logs that retain older configuration. After sanitization, rollback should rebuild a sanitized commit rather than restore an old artifact containing removed identifiers. Original historical test evidence documents stay marked as historical, not new-release approvals.

## Credential incident follow-up

A repository access token was disclosed in chat previously. The pattern scan found no matching token in reachable committed blobs. That does not make a chat-disclosed token safe: the repository owner should revoke it after cleanup and review account/repository activity. This app cannot erase chat history or independently prove revocation. Never repeat the token in documentation, screenshots, issues or code.

## Verification and remaining work

- Run configuration unit tests and the isolated account UI suite.
- Build the Pages artifact, run source/build credential checks, and verify the live login/PWA shell.
- Rescan rewritten reachable Git history for the removed project reference and privileged credentials.
- Verify repository variables were removed and encrypted secrets exist by name only.
- Confirm real account/email flows with an approved account; mocked tests are not real-provider acceptance.
- Security/UAT approval and any formal privacy/operations sign-off remain pending.
