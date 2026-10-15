# User guide and troubleshooting

- Project: yoga_studio
- Document ID: YS-USER-001
- Version: 0.1
- Status: Draft — not formally approved
- Author: Arena project assistant (code-derived draft)
- Proposed accountable owner: Support owner — assignment pending
- Reviewer / approver: Not assigned
- Created / last updated: 2026-10-15 (Asia/Calcutta)
- Classification: Internal
- Baseline: application commit `92f42e3`; repository `rajeshlande/yoga_studio`

## 1. Getting started
Open yoga_studio in a supported browser. Before sign-in, only account screens appear. On desktop there is a pastel illustration beside the form; on mobile the form takes the screen. No class booking or class management is included in this release.

## 2. Account journeys
**Create account:** choose Create an account, enter your name, email, and password (at least 6 characters, or more if the provider requires), then submit. If confirmation is enabled, open the email and confirm before signing in. Delivery behavior depends on the connected project.

**Sign in:** enter your account email/password and choose Sign in. The eye button reveals/hides your password locally. Do not reveal it on a shared/public screen.

**Forgot password:** select Forgot password, enter email, request the link, then open the email in a suitable browser. Use the recovery view to enter and confirm a new password. If the link expires, request another. Never forward recovery links or share passwords with support.

**Demo:** if the project is not configured, choose Sign in to demo to preview the app. It does not create a real account, send emails or authenticate with Supabase. Setup errors on real forms are expected until the owner configures the public key.

## 3. After sign-in
Dashboard shows a welcome and shortcuts only. Use the desktop sidebar, or the mobile menu button, to open Profile and Settings.

Profile: update your name and optional bio; email is read-only; choose Save changes. Real accounts store these details with the provider; demo data stays on this browser. Settings shows account info, password reset (real account only), install action, and sign-out. Sign out when leaving a shared device; the demo profile itself is not automatically erased.

## 4. Installing and offline use
Open Settings → Install app. If supported, accept the browser prompt. On iPhone/iPad, use Safari → Share → Add to Home Screen. On desktop/Android use the browser's Install/Add to Home Screen option if offered. Secure HTTPS and browser support are required. Browser prompts may not appear inside embedded previews; open the HTTPS app directly.

After a successful online visit, the app shell can reopen offline. Real login, confirmation/recovery email, and server profile updates still require internet. Offline is not a guarantee of account access or saved server changes.

## 5. Troubleshooting
| Symptom | What to try |
|---|---|
| Account access isn't configured | Ask the project owner to add the public Supabase key and redeploy; demo is not a real account |
| Invalid login | Check email/password and connection; use Forgot password; do not repeatedly guess |
| No confirmation/reset email | Check spam, wait for provider delivery, request a fresh link; ask support to inspect configuration safely |
| Link expired / reset view not shown | Request a new link; open at the correct deployed origin; report browser and time without sharing token |
| Profile save fails | Reconnect and retry; confirm session; note safe error wording |
| Install action only shows instructions | Follow browser-specific steps, use HTTPS, check existing installation and browser support |
| Old UI / blank page after update | Reload online, reopen browser; contact support. Clearing site data is last resort and signs you out/removes local data |
| Can't find classes or notifications | Those features are intentionally outside current scope |

## 6. Privacy and support boundaries
Do not place health details, payment data, credentials or other sensitive information in your bio. There is no account deletion/export UI in this version; the owner must define the support procedure and privacy policy. Support contact and service hours are **not yet assigned**. Provide browser/device, time, action and sanitized error description when reporting issues; never send passwords, session tokens or recovery URLs.

## Document control

Source of truth: current code, `.env.example`, `package-lock.json`, and automated evidence where cited. Proposed controls are not statements of implementation. Approval and owner assignment are pending.

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-10-15 | Arena project assistant | Initial code-derived draft; review pending |
