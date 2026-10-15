# yoga_studio

A responsive, pastel-toned yoga studio PWA built with React, Vite, Lucide icons, and Supabase Authentication. Inspired by the supplied task-board reference.

## Run locally

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open the address printed by Vite. Without a Supabase public key the app starts in **clearly labeled demo mode**. No passwords are stored in demo mode; the sign-in and registration forms explain the setup requirement. Use the top-right avatar to open sign-in / registration.

## Connect Supabase

Project URL: `<SUPABASE_PROJECT_URL>`

1. Get the **publishable / anon public** key from Supabase project settings.
2. Set `VITE_SUPABASE_ANON_KEY` in `.env.local` (or your hosting environment).
3. Enable the Email provider under Supabase Authentication.
4. Set the Site URL and allowed redirect URLs to your deployed origin (include your local development origin for testing).
5. Restart Vite, or rebuild/redeploy for environment-variable changes to take effect.

**Never put service-role keys, secret keys, GitHub tokens, or database passwords into Vite variables or committed files.** `.env.local` is ignored by Git. Anon keys are public by design; authorization must be enforced by backend policies when adding database tables.

With a valid key, registration, email-confirmation flow, session persistence, password sign-in, logout, and profile metadata updates use Supabase Auth. Password reset and social login are not included in this initial release.

### Current data boundaries

- **Supabase:** authentication and signed-in user profile metadata (name, bio, role).
- **This browser/device:** demo profile, class board, bookings, notification preferences, and compact-view preference, persisted in localStorage.
- Classes and preferences are **not yet synchronized to a database or shared across users/devices**. Bookings are local demo interactions, not real reservations.
- Notification toggles save preferences only; email delivery, push notifications, payments, scheduling across dates, and real-time multi-user collaboration are not implemented.
- This is an initial UI/demo release, not a protected production studio-management system. Demo mode is intentionally accessible without authentication. Plan per-user database tables with row-level security before adding shared/private data.

## Features

- Responsive desktop sidebar and mobile drawer.
- Dashboard with pastel class board, status columns, summary cards, and an original yoga illustration.
- Search, practice-type filtering, board/list view, class creation, class details, status updates, local booking and deletion.
- Editable profile and persisted preferences.
- Login / register screens wired to Supabase when configured; explicit demo feedback otherwise.
- PWA manifest, app icons, service worker, and device-specific installation guidance.
- Escape closes dialogs; Cmd/Ctrl+K focuses desktop search.

## Build and deploy

```sh
npm run build
npm run preview
```

Deploy `dist/` to a static host such as Vercel, Netlify, or Cloudflare Pages, with the app served from the domain root. Build command: `npm run build`. Output directory: `dist`. Routes use URL hashes, so no SPA rewrite is required. Configure Supabase environment variables **before building**.

PWA installation requires HTTPS (or localhost), and browser support varies. The service worker registers only in production, caches the app shell and visited same-origin assets, and supports offline revisits after a successful initial online load. Authentication requires internet. Offline fonts fall back to the system font. Increment the cache version in `public/sw.js` when changing the offline shell.

## Tests

```sh
npx playwright install --with-deps chromium
npm test
```

Tests cover dashboard rendering, class creation and status changes, search, local persistence, profile editing, preferences, demo-authentication messaging, and mobile navigation/overflow. Real Supabase authentication must be tested with a configured project and an actual test email; it cannot be verified without the public key.

## Project structure

```text
src/App.jsx               Screens, components, Supabase auth, local demo state
src/style.css             Responsive styles and reference-inspired palette
src/main.jsx              React entry and production SW registration
public/manifest.webmanifest
public/sw.js              App-shell offline caching
public/icon*              PWA icons
.env.example              Public environment variable template
tests/app.spec.js         Playwright browser tests
```

Application name, npm package, document title, manifest name, and project folder are all `yoga_studio`.
