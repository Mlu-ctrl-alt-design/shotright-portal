# Sho't Right — Partner Portal

Decoupled **React SPA** where restaurant and bar owners list their venue on the
Sho't Right (Bloop) app. Talks to the Frappe/ERPNext backend at
`shotright.thedaystar.co.za` over cookie-authenticated JSON.

This repo is one of three surfaces:

| Surface | Where it lives |
|---|---|
| **Partner Portal (this repo)** | `Mlu-ctrl-alt-design/shotright-portal` |
| Customer app (Flutter) | `Mlu-ctrl-alt-design/shotright` |
| Admin | Frappe Desk at `shotright.thedaystar.co.za/app` — deliberately not rebuilt in React |

## Status

All five wizard steps are built and verified end to end in a browser: a partner
can go from login through moods, venue details, operating hours and menu to a
submitted venue.

| Step | State |
|---|---|
| 1. Setup Mood | ✅ Free text resolved onto canonical moods, with suggestions for anything new (conflict C1) |
| 2. Your venue's details | ✅ Includes a rich-text description (TipTap, lazy-loaded) |
| 3. Your operating hours | ✅ Weekday / weekend / public holiday, per the designs |
| 4. Your menu options | ✅ Categories, items with photos, per-category Excel import (conflict C4) |
| 5. Almost done | ✅ Read-only review, then SUBMIT |

**The backend is live** at `shotright.thedaystar.co.za` and the portal is wired
to it — token auth, real method names, real payload shapes. It still ships with
`VITE_USE_MOCKS=true`, because several things a partner can enter have nowhere
to be stored yet: partner-authored moods, menu photos, and
most of the venue detail fields. The portal warns the partner about each drop on
submit rather than failing silently, but the gaps need closing before the flag
flips. See [`docs/BACKEND-INTEGRATION.md`](docs/BACKEND-INTEGRATION.md) §2.

Two things the backend must enforce, since the client cannot: sanitising the
rich-text HTML before the customer app renders it, and the image type and size
limits on uploads.

Still to design (see the PRD §7.5): the Settings screen, and the path back for a
partner whose venue is declined.

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
