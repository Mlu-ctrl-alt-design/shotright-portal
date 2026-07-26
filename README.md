# Sho't Right — Partner Portal

Decoupled **React SPA** where restaurant and bar owners list their venue on the
Sho't Right (Bloop) app. Talks to the Frappe/ERPNext backend at
`bloop.thedaystar.co.za` over cookie-authenticated JSON.

This repo is one of three surfaces:

| Surface | Where it lives |
|---|---|
| **Partner Portal (this repo)** | `Mlu-ctrl-alt-design/shotright-portal` |
| Customer app (Flutter) | `Mlu-ctrl-alt-design/shotright` |
| Admin | Frappe Desk at `bloop.thedaystar.co.za/app` — deliberately not rebuilt in React |

## Status

The design system, app shell and the five-step venue setup wizard are built and
verified in a browser. Three of the five wizard steps are complete; the
remaining two are blocked on the decisions tracked in
[`docs/PRD-shot-right-partner-portal.md`](docs/PRD-shot-right-partner-portal.md)
§7.5, and render an on-screen note naming their blocker rather than failing
silently.

| Step | State |
|---|---|
| 1. Setup Mood | ✅ Built — free text with canonical resolution + suggestions (conflict C1) |
| 2. Your venue's details | ⏳ Needs a rich-text editor chosen |
| 3. Your operating hours | ✅ Built — weekday / weekend / public holiday |
| 4. Your menu options | ⏳ Blocked on C4 (item images + rich text) |
| 5. Almost done | ⏳ Built last, reflects the steps above |

**The backend does not exist yet.** None of the Sho't Right doctypes are on the
bench, so the portal ships with `VITE_USE_MOCKS=true` and runs end-to-end on
in-memory fixtures. Every Frappe integration point is isolated in
`src/services/vendor.js`, which picks between the real endpoint and the mock per
call — flipping the flag is the only change needed once the app is installed.

## Running

```bash
npm install
cp .env.example .env
npm run dev      # http://localhost:5173
npm run build
```

Demo credentials are pre-filled on the login screen. In demo mode any non-empty
credentials sign you in.

## Architecture

```
src/
  assets/          brand mark
  components/
    layout/        Shell (yellow sidebar), AuthLayout, Logo
    ui/            design-system primitives — Button, Input, MoodPill, DayChip …
    wizard/        WizardLayout + StepRail (chrome shared by all five steps)
  hooks/           TanStack Query hooks
  routes/          GuestRoute / ProtectedRoute
  services/        api.js (axios) · vendor.js (real ⇄ mock) · mockBackend.js
  store/           Zustand auth store
  views/
    guest/         Login, Register
    vendor/        Dashboard, VenueList, Profile, …
      wizard/      VenueWizard + steps/
```

Stack: React 19 · Vite 6 · Tailwind CSS v4 · TanStack Query v5 · Zustand ·
React Router 7.

## Design

The UI follows 29 approved design frames. Tokens are sampled from those files
rather than eyeballed — `#FEC32D` primary, `#FBAB29` deep, `#F7F7F7` canvas,
`#FFF3E0` review tint — and the specifics are recorded in the PRD, §7.1.1.

## Deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Short version: import this repo
into Vercel, leave Root Directory at the repo root, set `VITE_USE_MOCKS=true`
and leave `VITE_API_BASE` empty — `vercel.json` proxies `/api` to the bench so
the browser never makes a cross-origin call.
