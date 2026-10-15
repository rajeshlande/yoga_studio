# Operations runbook, support, backup, and recovery

- Project: yoga_studio
- Document ID: YS-OPS-002
- Version: 0.1
- Status: Draft — not formally approved
- Author: Arena project assistant (code-derived draft)
- Proposed accountable owner: Operations owner — assignment pending
- Reviewer / approver: Not assigned
- Created / last updated: 2026-10-15 (Asia/Calcutta)
- Classification: Internal
- Baseline: application commit `92f42e3`; repository `rajeshlande/yoga_studio`

## 1. Ownership and escalation
No operational contacts, on-call rota, SLA, retention policy or RTO/RPO are approved. Before go-live assign: product owner, static-host operator, Supabase administrator, security incident lead, support lead and escalation backup. Store actual contacts in an approved restricted directory, not a public repository. Proposed severity levels: S1 security compromise/widespread account outage; S2 broken core journey for many users; S3 isolated failure; S4 question/cosmetic issue. Response targets require agreement.

## 2. Triage procedure
1. Record incident ID, safe description, UTC/local time, affected release/origin/browser, scope and recent changes. Never collect live recovery URLs/tokens/passwords.
2. Distinguish static app failure from Supabase auth/email/network failure and device-specific cached UI.
3. Verify deployed HTML/assets, TLS, console errors, public configuration identifiers and provider status/configuration. Do not expose admin logs to users.
4. Use the following symptom playbooks; escalate security concerns immediately.

| Symptom | Diagnostic/action |
|---|---|
| Blank or old app | Check asset 404/MIME, atomic release integrity, HTML/SW cache headers and worker version; use tested rollback |
| Login failure spike | Confirm correct project public key/build and provider status; inspect rate limits/settings with admin; test synthetic account on staging |
| Recovery emails fail | Check Site URL/redirects, Email provider/SMTP, delivery limits and spam; no real credentials in tickets |
| Recovery link doesn't open reset | Check flow type/hash, exact origin and allowed redirects; reproduce with disposable fresh link in staging; do not bypass recovery checks |
| Profile not saving | Confirm online session and SDK errors; test own metadata update; demo profile isn't server data |
| Suspected credential exposure | Revoke/rotate at issuer, review activity, preserve sanitized evidence, invoke security response |
| Offline or install issue | Confirm secure origin/browser support, existing SW and correct cache; do not promise offline server actions |

## 3. Monitoring and logs (proposed)
No centralized app monitoring, business audit log or alert pipeline is implemented. Establish synthetic shell/login health checks where safe, static-host error/availability monitoring, deployment-change tracking, certificate expiry alerts and provider auth/email metrics subject to plan/permissions. Define thresholds and responsible responders. Avoid personal data/token capture in telemetry. Review errors after releases; do not treat console output as an audit trail.

## 4. Backup, restoration and disaster recovery
| Asset | Current state | Required operating control |
|---|---|---|
| Source and lockfile | Versioned in repository | Protected access, independent repository backup policy |
| Static release | Build reproducible locally; retained-host artifacts not evidenced | Keep approved last-good artifact and deployment/config record |
| Public environment config | Example committed; live setup pending | Version config identifiers securely, document target origin/project |
| Auth users/metadata | Provider managed; plan/backup settings unknown | Admin confirms supported backup/restore scope, retention and recovery procedure |
| Demo profile | Browser localStorage only; no server backup | Explain local loss risk; never imply recoverability |
| Secrets | Should be in approved external store | Rotate and recover according to issuer; never back up in source |

Do not assume Supabase Auth data is covered by any particular plan or a simple SQL dump. Confirm supported recovery with the provider, including session invalidation and email behavior. The app contains no backup/restore automation or successful restore test. Proposed recovery sequence: declare incident → preserve evidence → restore verified static artifact/config → coordinate supported provider recovery if necessary → run auth/recovery/profile and PWA tests → obtain owner approval → resume service. RTO/RPO and acceptable data loss remain **TBD, not commitments**.

## 5. Routine maintenance and handover
Recommended cadence pending agreement: each release—build/tests/security scan, cache bump, rollback artifact, post-deploy smoke; monthly—dependency/license/advisory review and access/config check; quarterly—restore and rollback rehearsal, incident contacts, browser/install/a11y review. Reassess after major dependency/provider changes.

Operational handover must include repo/tag, architecture/config docs, provider/host ownership, secret-store access procedure, runbooks, unresolved risks, test evidence, restore proof, contact directory and explicit acceptance. Current handover is documentation-only and not an approved operations transfer.

## Document control

Source of truth: current code, `.env.example`, `package-lock.json`, and automated evidence where cited. Proposed controls are not statements of implementation. Approval and owner assignment are pending.

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-10-15 | Arena project assistant | Initial code-derived draft; review pending |
