# yoga_studio

A minimal, responsive yoga-studio PWA built with React, Vite, Lucide icons, and Supabase Authentication.

## Included screens

**Before sign-in:** Login, sign-up, forgot password, and password update from a Supabase recovery link.

**After sign-in:** A simple welcome dashboard, editable profile, and settings (account details, password-reset email, app installation, and sign-out).

The previous class board, class creation/booking, filters, search, summary statistics, notifications, and extra navigation have been removed. Dashboard, profile, and settings do not render before a session is established. A clearly labeled **Sign in to demo** button is available only when Supabase is not configured.

## Run

```sh
npm ci
cp .env.example .env.local
npm run dev
```

## Supabase setup

Project URL: `<SUPABASE_PROJECT_URL>`

1. Copy your **publishable / anon public** key from the Supabase project settings.
2. Set `VITE_SUPABASE_ANON_KEY` in `.env.local`.
3. Enable Email authentication in Supabase.
4. Set the Site URL and allowed redirect URLs to your application origins (including your local development URL).
5. Restart Vite, or rebuild and redeploy after changing environment variables.

**Never use a secret/service-role key, database password, or GitHub token in client environment variables or committed files.** `.env.local` is ignored by Git.

### Authentication behavior

- Supabase provides email/password login, sign-up, confirmation emails (when enabled in project settings), persisted sessions, reset-password emails, recovery-link password updates, and logout.
- Signed-in profile name and bio are saved in Supabase user metadata. Email is read-only in the profile.
- When confirmation is disabled in Supabase, successful sign-up may immediately establish a session.
- Without the public key, real account actions show an explicit setup message. No passwords are stored. A separate demo sign-in stores a demo session flag in sessionStorage; the demo profile is stored locally in localStorage.
- Demo sign-out clears the demo session. A new independent browser session must sign in again.
- Frontend session gating is not a replacement for backend authorization. If adding database tables, protect them with row-level security and per-user policies.
- Real authentication and email delivery require a configured Supabase project and an internet connection. Real email flows have not been integration-tested without the project's public key.

## Mobile, desktop, and PWA

- Desktop sidebar; mobile drawer with Dashboard, Profile, and Settings.
- Compact, single-column authentication forms on mobile and a two-column pastel layout on desktop.
- Web app manifest, icons, install instructions, and production service worker.
- The service worker precaches the app shell and JavaScript/CSS. Offline revisits can open the login screen or an existing local session; authentication and server-side profile changes need internet.
- Installation requires HTTPS (or localhost) and a supported browser. iOS users install through Safari's Share menu.
- External fonts gracefully fall back to system fonts while offline.
- Production service-worker caches are automatically versioned from built assets, worker and manifest contents, and scoped to the deployed app path.

## Production

```sh
npm run build
npm run preview
```

For GitHub Pages, use `npm run build:pages` and the included `.github/workflows/pages.yml`. Set **Settings → Pages → Source → GitHub Actions**. The deployment URL is `https://rajeshlande.github.io/yoga_studio/` after a successful workflow. Set public Supabase configuration in repository Actions Variables before building. Auth Site URL and redirects must include `/yoga_studio/`. See [the Pages deployment guide](docs/08-devops-deployment/github-pages.md) for exact steps. `npm run build` remains available for a domain-root host. Generated `dist/` and dependencies are not committed.

## Tests

```sh
npx playwright install --with-deps chromium
npm test
```

Four browser tests verify the sign-in gate, signup/forgot-password forms in unconfigured mode, demo sign-in, profile persistence, settings, installation guidance, sign-out, and mobile overflow/navigation down to 320px. Production offline app-shell loading is also manually checked with Playwright.

## Files

```text
src/App.jsx                  Auth, dashboard, profile, settings
src/style.css                Desktop/mobile pastel UI
src/main.jsx                 Entry point and production SW registration
public/manifest.webmanifest   PWA metadata
public/sw.js                 Offline app-shell caching
public/icon*                 App icons
.env.example                 Public environment-variable template
tests/app.spec.js            Browser tests
```

## Project documentation

See [the essential documentation index](docs/README.md) for scope, requirements, UI/UX, architecture, data/Auth APIs, test evidence and RTM, security, deployment/rollback, user/support guides, and pending approvals. Documents are drafts; real Supabase integration and production readiness remain unverified.

### Runtime

Use Node 22 (the GitHub Actions runtime); Node 22.23.3 was used for local release verification. No new product features are included in this deployment update.
