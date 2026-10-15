# PWA and caching strategy

- Project: yoga_studio
- Document ID: YS-TECH-003
- Version: 0.1
- Status: Draft — not formally approved
- Author: Arena project assistant (code-derived draft)
- Proposed accountable owner: Technical maintainer — assignment pending
- Reviewer / approver: Not assigned
- Created / last updated: 2026-10-15 (Asia/Calcutta)
- Classification: Internal
- Baseline: application commit `92f42e3`; repository `rajeshlande/yoga_studio`

## 1. Current manifest and installation
`public/manifest.webmanifest` defines name/short name `yoga_studio`, scope/id/start URL `/`, standalone display, 192/512px PNG icons, theme `#8263bc`, and background `#f8f9fb`. The 512px icon declares maskable purpose; verify actual safe-area appearance on devices. Manifest copy still references removed classes (known issue). App is designed for domain-root deployment, not a repository subdirectory.

The `beforeinstallprompt` event is captured when available; Settings calls it or shows instructions. `appinstalled` and standalone media query inform the installed state; device behavior can vary. On iOS, installation is manual from Safari Share. HTTPS or localhost and browser support are required. This is a PWA, not a native app-store package.

## 2. Cache lifecycle
- Registration: production only, after window load.
- Current cache name: `yoga-studio-v2`.
- Install: fetch `/`, parse `/assets/` script/style references, precache root, manifest, 192/512px icons, and discovered assets. Installation can fail if any required resource is unavailable.
- Activation: remove caches with other names and claim clients. Deletion is not limited to yoga_studio-prefixed caches; dedicated-origin use is recommended until scoped deletion is implemented.
- Navigation: network-first; update cached `/` on successful response; offline fallback to `/`.
- Other same-origin GETs: cache-first with `ignoreVary:true`; successful network misses cached.
- Cross-origin requests and non-GET requests: not intercepted by this handler. Supabase credentials/API responses are not deliberately cached by it. Google Fonts requests are outside this cache strategy.

## 3. Offline boundary
The cached shell can display auth forms and a pre-existing demo/local session. Offline does not mean a new real user can authenticate, receive a recovery email, or save a server profile. There is no offline mutation queue, reconciliation, push notification, background sync, or multi-device synchronization. Never advertise offline account creation. System fonts are the fallback if external fonts are unavailable.

## 4. Update / rollback controls
Every shell change should bump the service-worker cache version. Deploy HTML/assets/SW atomically and retain the previous artifact. Serve `sw.js` and HTML with revalidation-friendly cache headers; hashed assets can have long immutable caching. Headers are recommendations, not configured in this repo. Test new install, existing worker update, offline revisit, stale tab, and rollback before release. The worker uses `skipWaiting`, so a new worker can activate while a previous page is open; inspect mixed-version behavior.

## 5. Verification
A prior baseline production offline check passed; the documentation run repeats it and records evidence separately. A desktop Chromium offline shell check does not certify iOS/Android installation, upgrades, device eviction behavior, or every offline auth edge case. Browser Clear site data / unregister service worker is a recovery tool, with a warning that it also removes local demo data and sessions.

## Document control

Source of truth: current code, `.env.example`, `package-lock.json`, and automated evidence where cited. Proposed controls are not statements of implementation. Approval and owner assignment are pending.

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-10-15 | Arena project assistant | Initial code-derived draft; review pending |
