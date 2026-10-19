<img src="public/icon.svg" width="96" alt="Yoga Studio logo" />

# 🧘 Yoga Studio

**An installable PWA for running yoga studio operations — students, batches, attendance, and payments. Built with React, Vite, and Supabase.**

[![Live App](https://img.shields.io/badge/Live-rajeshlande.github.io%2Fyoga__studio-8664ba?style=flat-square)](https://rajeshlande.github.io/yoga_studio/)
[![Version](https://img.shields.io/badge/version-1.1.1-8664ba?style=flat-square)](package.json)
[![Node](https://img.shields.io/badge/node-%3E%3D22%20%3C25-339933?style=flat-square&logo=node.js&logoColor=white)](package.json)
[![License](https://img.shields.io/badge/license-ISC-blue?style=flat-square)](LICENSE)
[![Build](https://img.shields.io/badge/build-Vite-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)

*Small steps. Meaningful progress.*

---

## Table of Contents

- [About the Project](#about-the-project)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Running Locally](#running-locally)
- [Scripts](#scripts)
- [Testing](#testing)
- [Versioning](#versioning)
- [Build & Deployment](#build--deployment)
  - [Local Production Build](#local-production-build)
  - [GitHub Pages Deployment](#github-pages-deployment)
- [Documentation](#documentation)
- [Roadmap](#roadmap)
- [Security Notes](#security-notes)
- [Contributing](#contributing)
- [License](#license)

---

## About the Project

Yoga Studio is a mobile- and desktop-friendly **Progressive Web App** that helps yoga studio owners and staff run day-to-day operations — managing student records, class batches, attendance, memberships, and payments — from a single calm, responsive interface. It is designed as a multi-role system serving Owners, Co-Owners, Admins, Instructors, and Students, with role-scoped access, auditable changes, and typed server-side data access through Supabase.

**Current release (v1.1.1)** ships the foundational layer — secure authentication, a personalized dashboard, profile, settings, PWA installation, offline shell, and a light/dark/system theme. The operational management modules (students, batches, attendance, billing, payments, and multi-role portals) are specified in the [Consolidated Management Plan](docs/11-management-plan/README.md) and are being rolled out in phased work packages.

The product display and PWA name is **Yoga Studio**. The repository, npm package identifier, and GitHub Pages deployment path remain `yoga_studio` to preserve the live URL.

> 📍 **Live application:** [https://rajeshlande.github.io/yoga_studio/](https://rajeshlande.github.io/yoga_studio/)

> ⚠️ There is **no demo account**, seeded data, or authentication bypass. Private pages require a real Supabase session.

### Status at a glance

| Module | Status |
|---|---|
| Authentication (sign-up, sign-in, password reset) | ✅ Live |
| Dashboard, Profile, Settings, PWA install | ✅ Live |
| Light / Dark / System theme | ✅ Live |
| Responsive layout & offline app shell | ✅ Live |
| Student records & directory | 🛠️ Planned (Phase 2) |
| Batches / class schedules & enrollment | 🛠️ Planned (Phase 2) |
| Attendance marking & corrections | 🛠️ Planned (Phase 3) |
| Membership plans & monthly billing | 🛠️ Planned (Phase 4) |
| Payments, receipts & reports | 🛠️ Planned (Phase 5–6) |
| Multi-role portals (Owner / Admin / Instructor / Student) | 🛠️ Planned (Phase 1+) |

---

## Features

### Available today (foundation)

- 🔐 **Authentication** — Email sign-up, sign-in, forgot-password, and secure password-reset flow via Supabase Auth.
- 🏠 **Dashboard** — Clean welcome workspace with quick access to essentials.
- 👤 **Profile management** — Editable full name and bio; read-only connected email.
- ⚙️ **Settings** — Password reset, PWA installation prompt, appearance, app version, and sign-out.
- 🌓 **Theme toggle** — Light, Dark, and System themes, persisted across sessions and synced to OS preference.
- 📱 **Installable PWA** — Add to home screen on mobile and desktop; offline app shell after first visit.
- 📶 **Offline shell** — Static assets are cached; auth and business-data actions require connectivity (passwords and API responses are never cached).
- 🧭 **Responsive navigation** — Sidebar on desktop, accessible drawer on mobile, keyboard focus handling and focus traps.
- 🏷️ **Visible versioning** — App version surfaced in the auth footer, private footer, and Settings (sourced from `package.json`).
- 🔄 **Auto-updating** — Content-versioned service worker means users receive new releases without clearing storage.

### Planned operations modules

- 👥 **Student & instructor records** — Role-scoped directories with minimum necessary fields and audit trails.
- 🗓️ **Batches & schedules** — Recurring class batches, capacity, and enrollment rules.
- ✅ **Attendance** — Instructor marking window, today's-class auto-selection, audited corrections.
- 💳 **Memberships & billing** — Monthly plans (calendar-month or anniversary), proration, dues tracking.
- 💰 **Payments & receipts** — Manual cash/UPI/card/bank-transfer recording with receipt numbers and reconciliation.
- 📊 **Reports & exports** — Scoped reports for owners/admins and controlled receipt downloads.
- 🔐 **Role-based portals** — Owner, Co-Owner, Admin, Instructor, and Student views with scoped permissions.

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI framework | [React 19](https://react.dev/) |
| Build tool | [Vite 6](https://vitejs.dev/) |
| Authentication | [Supabase Auth](https://supabase.com/auth) (`@supabase/supabase-js`) |
| Icons | [Lucide React](https://lucide.dev/) |
| Testing | [Node.js test runner](https://nodejs.org/api/test.html) + [Playwright](https://playwright.dev/) |
| Deployment | GitHub Pages (via GitHub Actions) |
| PWA | Service worker, manifest, installable — all generated by Vite |

### Engine Requirements

- **Node.js** `>=22 <25`
- **npm** (bundled with Node 22)

---

## Project Structure

```text
yoga_studio/
├── index.html                # App entry; pre-paint theme bootstrap
├── public/                   # Static assets (manifest, icons, SW)
├── src/
│   ├── App.jsx               # Root component (auth, routing, layout, pages)
│   ├── main.jsx              # React mount + service-worker registration
│   ├── style.css             # All styling + dark theme overrides
│   └── lib/
│       ├── auth.js           # Supabase client + auth helpers
│       ├── theme.js          # Light/dark/system theme manager
│       ├── useFocusTrap.js   # Accessibility focus-trap hook
│       └── version.js        # App name + version from package.json
├── scripts/                  # Build/verification helpers
├── tests/                    # Security-config unit tests + Playwright suite
├── docs/                     # Full project documentation (see docs/README.md)
├── .github/workflows/        # CI + GitHub Pages deployment
├── .env.example              # Environment variable template
├── CLAUDE.md                 # Contributor constraints & verification commands
├── CHANGELOG.md              # Release history
└── package.json
```

---

## Getting Started

### Prerequisites

1. **Node.js 22** installed ([download](https://nodejs.org/)).
2. A **Supabase project** with the Email provider enabled.
3. Your Supabase **Project URL** and **anon/public** publishable key (from Project Settings → API).

### Installation

```sh
# 1. Clone the repository
git clone https://github.com/rajeshlande/yoga_studio.git
cd yoga_studio

# 2. Install dependencies (uses package-lock.json for reproducible installs)
npm ci

# 3. Create your local environment file
cp .env.example .env.local
```

### Environment Variables

Edit `.env.local` and fill in your Supabase project credentials:

```env
# Browser-visible configuration only.
# Use a publishable / anon public key — NEVER a service-role or secret key.
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your_public_anon_key
```

> 🔒 `VITE_` variables are compiled into the production bundle and **are visible to end users**. Never put service-role keys, database passwords, or secrets here. `.env.local` is gitignored.

### Supabase Configuration

Before running the app, in your Supabase dashboard:

1. **Authentication → Providers → Email** — enable Email auth.
2. **Authentication → URL Configuration**:
   - **Site URL** (production): `https://rajeshlande.github.io/yoga_studio/`
   - **Redirect URLs** (production): `https://rajeshlande.github.io/yoga_studio/`
   - **Redirect URLs** (development): add your local origin, e.g. `http://localhost:5173/`
3. Configure email confirmation and password-recovery delivery as needed.

### Running Locally

```sh
npm run dev
```

The Vite dev server starts at [http://localhost:5173/](http://localhost:5173/) (bound to `0.0.0.0`). You can now sign up, confirm your email, sign in, and explore the app.

---

## Scripts

All scripts are defined in [`package.json`](package.json). Run them with `npm run <name>`.

| Script | Description |
|---|---|
| `dev` | Start the Vite dev server (binds `0.0.0.0`, port `5173`). |
| `build` | Production build for domain-root hosting (outputs to `dist/`). |
| `build:pages` | Production build for **GitHub Pages** (`base: /yoga_studio/`). |
| `preview` | Serve the built `dist/` folder locally for production preview. |
| `test` | Run security-config unit tests followed by the Playwright browser suite. |
| `test:ui` | Open Playwright's interactive UI runner. |
| `security:check` | Scan tracked files for accidental secrets / unsafe patterns. |
| `version:patch` | Bump patch version (`1.1.0 → 1.1.1`) — no commit, no tag. |
| `version:minor` | Bump minor version (`1.1.0 → 1.2.0`). |
| `version:major` | Bump major version (`1.1.0 → 2.0.0`). |

---

## Testing

```sh
# First time only — install Chromium for Playwright
npx playwright install --with-deps chromium

# Run the full test suite (unit + browser)
npm test

# Optional — Pages production smoke test
npm run build:pages
npm run preview -- --base=/yoga_studio/ --port 4174
node scripts/check-pages.mjs
node scripts/test-pages.mjs
```

- **Unit tests** (`tests/security-config.test.mjs`) validate that only legitimate public Supabase keys are accepted by the client.
- **Browser tests** (Playwright) run against isolated development ports and use mocked network responses — no test account is bundled into the app.
- Mocked API tests are **not** a substitute for real-provider UAT against an actual Supabase project and mailbox.

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/). `package.json` is the single source of truth; Vite injects the version into the app at build time.

```sh
npm run version:patch    # Bug fixes / tweaks            1.1.0 → 1.1.1
npm run version:minor    # Backwards-compatible features 1.1.0 → 1.2.0
npm run version:major    # Breaking changes              1.1.0 → 2.0.0
```

Version bump commands update `package.json` and `package-lock.json` **without creating an automatic commit or tag**. The release workflow is:

1. Bump the version.
2. Update [`CHANGELOG.md`](CHANGELOG.md).
3. Run tests and the build.
4. Review, then commit and push.

Service-worker caches are content-versioned separately, so users automatically receive the new release without clearing storage.

See [`docs/05-development/version-management.md`](docs/05-development/version-management.md) for the full release process.

---

## Build & Deployment

### Local Production Build

```sh
# Standard build (domain root)
npm run build
npm run preview -- --port 4173

# GitHub Pages build (base path = /yoga_studio/)
npm run build:pages
node scripts/check-pages.mjs
npm run preview -- --base=/yoga_studio/ --port 4174
```

### GitHub Pages Deployment

The repository ships with a CI workflow at [`.github/workflows/pages.yml`](.github/workflows/pages.yml) that builds, tests, and deploys successful pushes to `main`.

**One-time setup:**

1. In GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. In **Settings → Secrets and variables → Actions → Secrets**, add two encrypted repository secrets:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Push to `main`. The workflow handles build, tests, and deploy automatically.

Re-run the workflow after any configuration change. The service worker, manifest, icons, and auth redirects are all subpath-aware for the `/yoga_studio/` deployment base.

---

## Documentation

In-depth documentation lives under [`docs/`](docs/README.md). The main entry points:

| Topic | Link |
|---|---|
| Documentation index | [`docs/README.md`](docs/README.md) |
| Version management & release process | [`docs/05-development/version-management.md`](docs/05-development/version-management.md) |
| Changelog / release history | [`CHANGELOG.md`](CHANGELOG.md) |
| GitHub Pages deployment | [`docs/08-devops-deployment/github-pages.md`](docs/08-devops-deployment/github-pages.md) |
| Contributor guide & constraints | [`CLAUDE.md`](CLAUDE.md) ⭐ |
| Future management feature plan | [`docs/11-management-plan/README.md`](docs/11-management-plan/README.md) |

> ⚠️ **Read [`CLAUDE.md`](CLAUDE.md) before any codebase work** — it captures project constraints, the Supabase function-only data-access policy, verification commands, and documentation references. Re-read it at the start of every task, after context resets, and whenever it changes.

---

## Roadmap

The [**Consolidated Management Plan v0.4**](docs/11-management-plan/README.md) defines the full operations-management system — multi-role portals (Owner, Co-Owner, Admin, Instructor, Student), recurring batch schedules, enrollment, attendance marking with corrections, monthly membership billing, audited payment recording, and owner oversight across branches.

These management features are **planned, not yet deployed**. Implementation proceeds in phased work packages (see [`docs/11-management-plan/implementation-backlog.csv`](docs/11-management-plan/implementation-backlog.csv)):

| Phase | Scope | Rough effort |
|---|---|---|
| WP-01 | Owner approval of P0/P1 contracts, policies and blocking decisions | 2–4 days |
| WP-02 | Tenant/security foundation: roles, trusted provisioning, audit, idempotency | 10–15 days |
| WP-03 | Students, instructors, contacts, batches and enrollment via typed RPCs | 10–15 days |
| WP-04 | Actual class sessions, roster, attendance marking & corrections | 10–15 days |
| WP-05 | Membership plans, monthly billing and statements | 10–15 days |
| WP-06 | Payments, refunds, receipts, reports and exports | 10–15 days |
| WP-07 | Security, a11y, performance, UAT, restore and production operations | 10–15 days |

Approval, security review, and operational sign-off are required before each phase deploys. Deferred scope (unless separately approved) includes QR self-check-in, geofencing, online payment gateway, automated reminders/push, payroll, and native apps. See the [readiness register](docs/11-management-plan/readiness-register.csv) (APR-01…APR-12) for open approvals.

---

## Security Notes

- **Never** commit service-role keys, admin keys, repository tokens, or database passwords.
- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the publishable/anon key) belong in browser configuration.
- Passwords and Supabase Auth API responses are **never** cached by the service worker.
- Test fixtures are isolated under `tests/` and are mocked at the network boundary — they are never bundled into application code.
- There is no authentication bypass, demo account, or seeded business data in the app.
- Run `npm run security:check` to scan tracked files for accidental credential leaks.

---

## Contributing

1. Read [`CLAUDE.md`](CLAUDE.md) end-to-end first.
2. Create a feature branch off `main`.
3. Make focused, minimal changes using existing patterns — do not add dependencies or frameworks without task-related need.
4. Add or update tests for any changed behavior.
5. Run the full verification before pushing:
   ```sh
   npm ci
   npm test
   npm run build
   npm run security:check
   ```
6. Update `CHANGELOG.md` if the change is user-visible, and bump the version per the release guide.
7. Open a pull request describing the change, checks run, and any remaining blockers.

---

## License

Released under the [ISC License](LICENSE).

---

*A mindful space, made for you. 🌿*
