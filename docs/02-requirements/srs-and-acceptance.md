# Software requirements and acceptance criteria

- Project: yoga_studio
- Document ID: YS-REQ-001
- Version: 0.1
- Status: Draft — not formally approved
- Author: Arena project assistant (code-derived draft)
- Proposed accountable owner: Product owner — assignment pending
- Reviewer / approver: Not assigned
- Created / last updated: 2026-10-15 (Asia/Calcutta)
- Classification: Internal
- Baseline: application commit `92f42e3`; repository `rajeshlande/yoga_studio`

## 1. Actors, boundaries, and assumptions
Actors: visitor, authenticated member, explicitly signed-in demo visitor, and Supabase project administrator (external console only). There is no in-app administrator or role-management feature. A valid publishable/anon public key, email provider, allowed redirect origins, and internet access are required for real account actions.

## 2. Functional requirements
| ID | User story / requirement | Acceptance criteria | Implementation / validation |
|---|---|---|---|
| FR-01 | As a visitor, see authentication before private pages | Fresh session and `/#dashboard` show Login; private navigation is absent | Implemented; local browser test passed |
| FR-02 | As a member, sign in with email/password | Valid account creates session and shows dashboard; invalid credentials show feedback; duplicate submit disabled | SDK path implemented; real acceptance untested |
| FR-03 | As a new visitor, create an account | Name/email/password required; email-shaped value; password at least 6 characters; confirmation instructions when required by provider | Form tested without key; real signup untested |
| FR-04 | As a visitor, request a reset email | Required email; success avoids confirming whether an account exists; provider failures visible | Missing-config case tested; real email untested |
| FR-05 | As recovery-link holder, update password | Recovery session opens reset screen; matching passwords, minimum 6; SDK updates password; success exits reset view | Implemented; end-to-end untested |
| FR-06 | As a signed-in user, see a simple dashboard | Welcome name, Profile and Settings shortcuts; no class/booking/search/notification features | Demo acceptance passed |
| FR-07 | As a member, edit profile | Nonblank trimmed name up to 80; bio up to 250; email read-only; saved metadata survives session reload | Demo save/reload passed; server save untested |
| FR-08 | As a member, access settings | Read account email, request reset email, install help/action, and sign out | Demo checks passed; real reset untested |
| FR-09 | As a user, sign out | Successful logout returns to Login; private UI absent after reload; failure must not falsely report logout | Demo test passed; real session invalidation untested |
| FR-10 | As a previewer, explicitly sign into a demo | Demo button only when key absent; sessionStorage flag; no password collected by demo button; clear demo badge | Tested locally |
| FR-11 | As a mobile user, navigate comfortably | Mobile drawer opens/closes; accessible labels; no page horizontal overflow at 320/390px tested widths | Chromium checks passed |
| FR-12 | As a user, install/revisit the PWA | Valid manifest/icons; install prompt or browser instructions; production shell usable offline after online installation | Offline shell checked; native install acceptance pending |

## 3. Business rules and validations
- Authentication UI is not a security boundary for future data APIs. Only the backend may authorize data access.
- Minimum password validation is 6 characters in UI; Supabase can enforce stricter settings. Final security policy needs review, not an assumption that 6 is adequate.
- Signup name is required but currently not trimmed-and-rejected for whitespace-only input; profile save does reject a blank trimmed name. Align signup validation before formal acceptance.
- Confirmation depends on provider configuration; auto-confirm may establish a session immediately instead of displaying confirmation instructions.
- Demo mode is a local preview, not a real identity and not permission to call privileged APIs.
- The demo profile persists after logout; the demo sign-in flag does not persist as a durable user account. Browser session restore behavior may preserve sessionStorage.
- Settings password reset is disabled in demo mode. No email-change, account deletion, consent, MFA, or administrator workflows exist.

## 4. Non-functional requirements (proposed release targets)
| ID | Target | Evidence / gap |
|---|---|---|
| NFR-01 | Responsive 320px through desktop; test at 320, 390, 768, 1440px | 320/390 checked; full matrix pending |
| NFR-02 | WCAG 2.2 AA target, keyboard operation and visible focus | Some labels/focus/reduced-motion styles exist; conformance not established |
| NFR-03 | HTTPS; public keys only; no credentials in app logs or documents | Templates use public key; hosting configuration/review pending |
| NFR-04 | Production build reproducible with lockfile, tests passing | Build and 3 tests pass at baseline |
| NFR-05 | Offline shell after first successful online load; network actions fail intelligibly | Login shell checked; broader failure testing pending |
| NFR-06 | Proposed mobile p75 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 | Not measured; device/network cohort and owner acceptance pending |
| NFR-07 | No uptime/SLA, capacity, RTO/RPO commitment without approved operating plan | Targets unassigned |
| NFR-08 | Current Chrome/Edge/Firefox/Safari plus iOS Safari and Android Chrome | Chromium automated only; others pending |

## 5. Scope-change and approval
Use requirement IDs in issues, PRs, tests, and the RTM. Feature changes require revised acceptance criteria and owner approval. All requirements remain draft until explicit product-owner sign-off; implementation does not equal business acceptance.

## Document control

Source of truth: current code, `.env.example`, `package-lock.json`, and automated evidence where cited. Proposed controls are not statements of implementation. Approval and owner assignment are pending.

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-10-15 | Arena project assistant | Initial code-derived draft; review pending |
