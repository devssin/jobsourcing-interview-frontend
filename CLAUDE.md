# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Dev server at http://localhost:4200 (auto-reloads)
npm run build      # Production build → dist/jopsourcing-interview/
npm run watch      # Continuous dev build (watch mode)
npm test           # Unit tests via Karma + Jasmine (Chrome)
```

No lint script is configured. TypeScript strict mode enforces type safety at compile time.

## Architecture

**Angular 17 SPA** using the modern standalone component API (no NgModules), styled with **Tailwind CSS v3**.

- `src/main.ts` — bootstraps `AppComponent` with `appConfig`
- `src/app/app.config.ts` — providers: router, `provideAnimations()`, service worker
- `src/app/app.routes.ts` — interview flow routes under `LayoutComponent` shell
- `src/app/app.component.ts` — root shell with `<router-outlet />`

### Interview flow & routing

Routes are **linear and guarded** — each step requires the previous one to be complete:

```
/            → redirect to /welcome
/welcome     → WelcomeComponent       (no guard — always accessible)
/permissions → PermissionsComponent   (guard: welcomeCompleted)
/interview   → InterviewComponent     (guard: permissionsGranted)
/complete    → CompleteComponent      (guard: interviewCompleted)
**           → redirect to /welcome
```

All four routes are children of `LayoutComponent` (the shared header shell). `LayoutComponent` is statically imported in `app.routes.ts` (intentional — it's the layout bundle, not a lazy chunk).

**`InterviewProgressService`** (`services/`) is the single source of truth for flow state. It uses private `signal`s with read-only public views. Call its methods from page components to advance the flow:
- `completeWelcome()` → enables `/permissions`
- `grantPermissions()` → enables `/interview`
- `completeInterview()` → enables `/complete`
- `reset()` → sends user back to start

**`interviewFlowGuard`** reads `InterviewProgressService` and redirects to the earliest incomplete step if a user tries to skip ahead. Refreshing the page resets all progress (in-memory signals, no persistence by design).

### Route animations

`LayoutComponent` hosts the `@routeAnimations` trigger. The animation state is `InterviewProgressService.stepIndex()` (0–3):
- Incrementing state → slide in from right
- Decrementing state → slide in from left

Defined inline in `layout.component.ts` using `@angular/animations`. `provideAnimations()` is registered in `app.config.ts`.

### Layout & step indicator

`LayoutComponent` reads both `progress.stepIndex()` (completion level) and `activeStepIndex` (current URL, derived via `toSignal` + `NavigationEnd` events) to render the 4-step progress indicator in the header independently of each other.

### Folder conventions

```
src/app/
  components/
    layout/         # Shared shell: header + step indicator + animated <router-outlet>
    welcome/        # Step 1 — entry, calls completeWelcome()
    permissions/    # Step 2 — getUserMedia check, calls grantPermissions()
    interview/      # Step 3 — mock recording + timer, calls completeInterview()
    complete/       # Step 4 — summary + reset
    theme-toggle/   # Reusable sun/moon toggle button
    home/           # Legacy placeholder (not in the interview flow)
  services/
    theme.service.ts             # Dark/light mode via signals + localStorage
    interview-progress.service.ts
  models/           # TypeScript interfaces only — import from '../models' barrel
  guards/
    interview-flow.guard.ts      # Linear flow enforcement
    auth.guard.ts                # Auth stub (replace with real AuthService)
  shared/index.ts   # Re-exports components, models, services
  theme-demo/       # Dev showcase for Tailwind theme (not in routing)
src/environments/
  environment.ts        # Dev config (committed, placeholder values)
  environment.prod.ts   # Prod config (committed, placeholder values)
  # environment.*.local.ts  ← gitignored; put real secrets here
```

### Key patterns

- **Standalone components**: `standalone: true` with explicit `imports` arrays; no NgModules.
- **Function-based providers**: `provideRouter()`, `provideAnimations()`, `provideHttpClient()` in `app.config.ts`.
- **Angular 17 control flow**: `@for`, `@if`, `@switch` in templates (not `*ngFor`/`*ngIf`).
- **Signals for state**: services expose read-only signals (`.asReadonly()`); templates call them as `signal()`.
- **Barrel imports**: import from `'../models'`, `'../services'`, `'../shared'` — not individual files.
- **Testing**: Jasmine + Karma; `*.spec.ts` beside source. Use `imports: [ComponentUnderTest]` in `TestBed`.

### Environments & secrets

`angular.json` swaps `environment.ts` → `environment.prod.ts` at production build time via `fileReplacements`. Never commit real credentials — use `environment.prod.local.ts` (gitignored) locally or CI/CD env vars at deploy time.

### Tailwind CSS + dark mode

Dark mode uses Tailwind's `class` strategy — toggle by adding/removing the `dark` class on `<html>`:

```ts
document.documentElement.classList.toggle('dark', isDark);
```

Theme preference is persisted in `localStorage` with key `'theme'`, and initialized from `window.matchMedia('(prefers-color-scheme: dark)')` as the fallback.

**CSS variables** in `src/styles.css` (`:root` for light, `.dark` for dark) expose semantic tokens like `--color-primary`, `--color-success`, `--color-error`, `--color-warning`. Use Tailwind `dark:` variants in templates rather than referencing these variables directly.

**Reusable component classes** defined in `@layer components` in `src/styles.css`:
- `.btn-primary` — filled primary action button with dark-mode variant
- `.btn-secondary` — outlined secondary button
- `.card` — rounded bordered card surface
- `.form-input-dark` — input/select/textarea with dark-mode border and background

`@tailwindcss/forms` plugin is active — form elements are reset and styled automatically; override with Tailwind utilities as needed.

### PWA / Service Worker

The app is a PWA. Key files:
- `src/manifest.webmanifest` — app metadata (name, icons, theme color)
- `ngsw-config.json` — caching strategies for the Angular service worker
- `src/assets/icons/` — PNG icons at 72–512 px (solid blue-800 placeholders; replace with real art)

The service worker is **disabled in dev mode** (`isDevMode()` guard in `app.config.ts`) and only activates in production builds. To test PWA installation locally:

```bash
npm run build                          # produces ngsw-worker.js in dist/
npx http-server dist/jopsourcing-interview -p 8080 -c-1
# open http://localhost:8080 in Chrome → DevTools → Application → Service Workers
```

**Caching strategies in `ngsw-config.json`:**
- `app-shell` group — `prefetch` on install (HTML, CSS, JS, manifest)
- `assets` group — `lazy` install, `prefetch` on update (images, fonts)
- `api-freshness` data group — network-first with 10 s timeout for `/api/**`
- `api-performance` data group — cache-first for `/api/static/**`

When the service worker detects a new version it notifies the app. Use `SwUpdate` from `@angular/service-worker` to prompt users to reload.

### Production budget limits

Initial bundle: 500 KB warning / 1 MB error. Component styles: 2 KB warning / 4 KB error.
