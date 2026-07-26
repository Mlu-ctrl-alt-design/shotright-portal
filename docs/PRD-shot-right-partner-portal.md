# PRD — Sho't Right Partner Portal

**Status:** Draft for review · **Date:** 25 July 2026 · **Author:** Product
**Source of truth for UI:** [Partner Portal design folder (29 screens)](https://drive.google.com/drive/folders/1obTZi-Yn-NLlX91JUttVtMJSBZia9ktO)

---

## 1. Summary

The Sho't Right Partner Portal is the web app where restaurant and bar owners
list their venue on the Sho't Right (Bloop) app. A partner signs up, then walks
through a five-step setup wizard — moods, venue details, operating hours, menu,
and a final review — and submits the venue for approval by the Sho't Right team.

This document describes what to build, based on 29 approved design screens. It
also flags six places where those designs disagree with the current backlog, so
we settle them before anyone writes more code.

---

## 2. Contacts

| Name | Role | Comment |
|---|---|---|
| Mlu (mlumanda@gmail.com) | Product owner | Owns the backlog and the designs |
| diiConsultancy | Client | Engagement owner for MLP 1–4 |
| *Unassigned* | Backend engineer | Builds the Frappe app and doctypes |
| *Unassigned* | Frontend engineer | Builds the React portal |
| *Unassigned* | Approvals / ops | Reviews venues in ERPNext Desk; does the 360° tour visit |

> **Action:** fill in the three unassigned roles before build starts.

---

## 3. Background

### What this is about

Sho't Right helps people in South Africa find places to eat and drink based on
the **mood** they are in — "Boys Night Out", "Kiddies Birthday", "Chilled Bar",
"Local Lit". The customer app (Flutter) is already scaffolded. The Frappe/ERPNext
backend runs at `shotright.thedaystar.co.za`.

But the app is empty without venues. Right now there is **no way for a restaurant
owner to add their own venue**. Someone on the Sho't Right team would have to
type every venue in by hand.

### Why now

Three things make this the right moment:

1. **The customer app is ready to consume venues.** All nine customer screens are
   built against mock data and are waiting for real venues to appear.
2. **The designs are done.** All 29 partner-facing screens are approved and sitting
   in the shared Drive folder. This is no longer a guessing exercise.
3. **Venue supply is the bottleneck.** Every week without a partner portal is a
   week where venue listings grow only as fast as staff can type them.

### What has changed since the backlog was written

The backlog (issues #14–#19) was written before these designs existed. The
designs show a meaningfully different product in six places. Section 7.5 lists
every conflict. **These need decisions, not assumptions.**

---

## 4. Objective

### What we want

Let a restaurant owner list their venue on Sho't Right by themselves, in one
sitting, without help from our team.

### Why it matters

- **For the company:** venue supply stops depending on staff typing. The catalogue
  can grow much faster than headcount.
- **For partners:** free exposure to customers who are actively looking for the
  exact mood their venue offers.
- **For customers:** more venues to find, and richer listings (photos, menus,
  prices) when they get there.

### How it fits the strategy

Sho't Right's whole promise is mood-based discovery. That promise only works if
lots of venues have told us their mood. The Partner Portal is the machine that
collects that information at scale.

### Key results

| # | Objective | Measure | Target |
|---|---|---|---|
| KR1 | Partners can self-serve | Venues created via the portal, not by staff | **≥ 80%** of new venues within 2 months of launch |
| KR2 | The wizard is not too long | Partners who start step 1 and reach SUBMIT | **≥ 60%** completion |
| KR3 | Setup is quick | Median time from step 1 to SUBMIT | **≤ 20 minutes** |
| KR4 | Listings are usable | Submitted venues approved without needing edits | **≥ 70%** first-pass approval |
| KR5 | Menus are rich | Submitted venues with ≥ 1 menu category and ≥ 5 items | **≥ 75%** |

> **Assumption to validate:** these targets are estimates. We have no baseline
> because no partner has ever used a portal. Re-baseline after the first 30 real
> signups.

---

## 5. Market segments

We are building for **one** group in version 1.

### Primary: the owner or manager of a single restaurant or bar

Defined by the job they need done: *"I want people who are in the mood for what
my place offers to find my place."*

What we know about them from the designs:

- They are in **South Africa**. The copy uses local language freely — "Chisa!",
  "Mzansi", "Yonkinto", "Hae Wena Bona!", "Masepa". The portal should sound like
  a South African talking to another South African.
- They already have their **menu in a spreadsheet**. Every screen that accepts a
  list also accepts an Excel upload. This is a strong signal about how they work.
- They are **not technical**. The wizard holds their hand, one step at a time,
  with a progress rail always visible.
- They think in **weekday / weekend / public holiday**, not in seven separate
  days (see the operating-hours screens).

### Constraints

- **Desktop-first.** Every design frame is a wide desktop layout. Mobile is not
  designed and is out of scope for V1.
- **English only.** Local slang is used, but there is no second language.
- **Venues are approved by hand.** A person reviews every submission, so volume
  is capped by that person's time.
- **The 360° tour needs a site visit.** The success screen promises "A Bloop
  representative will contact you to setup venue visual tour" — that is a manual,
  offline step.

### Explicitly not in this segment (V1)

Restaurant **groups** with many branches. The designs show one venue at a time
and a dashboard that says "WELCOME, TURN N TENDER" — a single business. Multi-branch
management is a real need but is not designed yet.

---

## 6. Value propositions

### The job partners are hiring us for

> "Get the right customers through my door on a quiet Tuesday."

### What partners gain

| Gain | How the portal delivers it |
|---|---|
| Customers who already want what they offer | Moods are chosen by the partner, in the partner's own words |
| A listing that sells the place | Rich text venue story, dress code, menu with photos and prices |
| Setup in one sitting | A five-step wizard with clear progress, not a form dump |
| No re-typing the menu | Excel upload at both the mood step and per menu category, plus a downloadable template |
| Confidence it worked | A full summary screen before submitting, then a clear confirmation |

### Pains we remove

- **"I don't know what to write."** Every field has plain-language guidance
  ("Here is where you determine the vibe or mood your customers will search
  for...").
- **"I'll lose my work."** The wizard has PREVIOUS on every step and a review
  screen at the end.
- **"Typing 60 menu items is a nightmare."** Excel upload with a template.
- **"Did it save?"** Green confirmation toasts — "Mood successfully added",
  "Menu category successfully created", "Menu items added successfully".

### Where we beat the alternatives

The alternative today is a listing on a generic directory or a delivery app.
Those sort by cuisine, price, or distance. **Nobody else lets a venue market
itself by mood, in local language.** A partner can literally list themselves
under "Boys Night Out" and "Kiddies Birthday" and be found for both. That is the
value curve difference: we compete on *emotional fit*, not on *filter count*.

---

## 7. Solution

### 7.1 UX and prototypes

All 29 approved screens live in the
[design folder](https://drive.google.com/drive/folders/1obTZi-Yn-NLlX91JUttVtMJSBZia9ktO).

#### The main flow

```
Get started  →  Register / Login  →  Dashboard
                                          │
                                          └─ "Add New"
                                                │
   ┌────────────┬───────────────┬────────────────┬──────────────┬────────────┐
   │ 1. Setup   │ 2. Your       │ 3. Your        │ 4. Your      │ 5. Almost  │
   │    Mood    │    venue's    │    operating   │    menu      │    done    │
   │            │    details    │    hours       │    options   │  (review)  │
   └────────────┴───────────────┴────────────────┴──────────────┴────────────┘
                                                                       │
                                                            SUBMIT → Congratulations!
                                                            "A Bloop representative
                                                             will contact you to setup
                                                             venue visual tour"
```

Every wizard step shows the same **vertical progress rail** on the right, with a
green tick against each finished step. Every step has CANCEL, PREVIOUS and NEXT.

#### Screen-by-screen

| Step | Screen | What the partner does |
|---|---|---|
| — | Get started | Welcome splash: "Grow your business with Shot Right!" |
| — | Login | Email, password, "Remember me", link to "Register as a Bloop Partner" |
| — | Register | Name, surname, email, business name, password + confirm, with a strength hint |
| 1 | Setup Mood | Type a mood → **ADD +**. Or **UPLOAD EXCEL**. Moods appear as removable pills. **CLEAR ALL MOODS** resets. |
| 2 | Venue details | Venue name, manager name, manager surname, cellphone, dress code (select), address, and a **rich-text** venue description (bold/italic/underline/strikethrough toolbar) |
| 3 | Operating hours | Pick days SUN–SAT. Toggle "Weekend starts FRIDAY". Then set **three** time ranges: week day, weekend, public holiday |
| 4 | Menu options | Add menu categories (e.g. STARTERS / MAINS / DESERT). Within each: add items with image, name, price, rich-text details. **MENU UPLOAD EXCEL** per category. **DOWNLOAD MENU LIST TEMPLATE +** |
| 5 | Almost done | Full read-only review: mood pills, venue details, the three hour ranges, and each menu category as an expandable section. **SUBMIT** |
| — | Success | "Congratulations! Your business profile has been successfully created." |
| — | Dashboard | Sidebar: **Add New · Declined · Pending · Settings**. Body: venue cards with business name, date and time |

#### 7.1.1 UI fidelity — this is a requirement, not a suggestion

The build must match the designs. These values are sampled directly from the
approved PNGs.

**Colour**

| Token | Hex | Used for |
|---|---|---|
| Brand yellow (primary) | `#FEC32D` | Sidebar fill, primary buttons, day chips, active borders |
| Brand orange (deep) | `#FBAB29` | Login background wash, hover states, mood pills |
| Page background | `#F7F7F7` | App canvas behind the white card |
| Summary panel tint | `#FFF3E0` | The review panel on step 5 |
| Surface | `#FFFFFF` | Cards and inputs |
| Success green | *(as per toast/progress bar)* | Upload progress bar, step ticks |

**Layout and components**

- **Left sidebar** is a solid `#FEC32D` panel, full height, with rounded outer
  corners. Logo at top, a white pill "⊕ Add New" nav item, "⏻ Logout" pinned at
  the bottom. *(Not a white sidebar.)*
- **Main content** sits in a white card with a thin yellow border and generous
  rounding, floating on `#F7F7F7`.
- **Progress rail** is on the **right**, vertical, with a yellow track line.
  Current step is bold; finished steps get a **green tick**; upcoming steps are
  lighter yellow.
- **Inputs** are fully rounded (pill-shaped), white, with a yellow border and
  *italic* placeholder text.
- **Primary buttons** are solid yellow, pill-shaped, uppercase label.
  **Secondary buttons** are white with a yellow border. **CANCEL** is plain
  yellow text, no box.
- **Day chips** (SUN–SAT) are rounded squares, solid yellow when selected.
- **Mood pills** are small, solid orange, rounded-full, with a remove affordance.
- **Login** is a centred card on a blurred warm-orange photographic background —
  *not* a split panel. Logo, title, tagline sit above the card.
- **Upload progress** is a full-width green bar with the label
  `"Name of file" is being uploaded - 50%`.
- **Toasts** are green confirmations prefixed "Chisa!".

> **Fidelity gap in the current scaffold:** the code already pushed to
> `claude/shotright-portal-setup-7zujad` uses an orange palette (`#f96f16`), a
> white sidebar, a horizontal layout with no wizard, a split-panel login, and
> seven-row operating hours. It matches the *backlog*, not these *designs*.
> Treat it as a working skeleton (auth, data layer, build tooling) to be
> re-skinned and re-flowed — not as the finished UI. See 7.5.

### 7.2 Key features

**F1 — Partner account (register + login)**
Register captures name, surname, email, business name and password with a
strength indicator and confirmation. Login has "Remember me". A person may already
be a Sho't Right *customer*; that must not block them registering as a partner,
and the portal must never offer a "switch view" between the two identities.

**F2 — Mood setup (step 1)**
The partner types their own mood names and adds them as pills. Bulk add via
Excel with a live progress bar. Individual pills can be removed; CLEAR ALL MOODS
wipes them. Observed examples: Rooftop, Her Birthday, Special Occasion, Boys
Night Out, Girls Night Out, Masepa, Local Lit, New In Town, Kiddies Birthday,
Outdoor, Chilled Bar, Mothers Day, Levels.

**F3 — Venue details (step 2)**
Venue name, manager name and surname, cellphone, dress code (dropdown), address,
plus a rich-text description with a formatting toolbar. Long-form storytelling is
expected — the sample copy runs several paragraphs.

**F4 — Operating hours (step 3)**
Select operating days. Toggle which day the weekend starts on. Then **three**
time ranges only: week day, weekend, public holiday. This is much simpler than
per-day hours and matches how the segment thinks.

**F5 — Menu (step 4)**
Create named categories. Under each, add items with an **image**, name, price in
ZAR, and rich-text details. Items list in a table: IMAGE · NAME · PRICE · DETAILS
· ACTIONS. Each row can be edited (with a DELETE option) in a detail panel.
**Excel upload works per category**, and a **template is downloadable** so the
partner's spreadsheet matches what we expect.

**F6 — Review and submit (step 5)**
Everything on one read-only screen: mood pills, venue summary block, the three
hour ranges, and each menu category collapsed behind an "Expand" control. Then
SUBMIT.

**F7 — Confirmation**
Congratulations screen that sets the expectation of a follow-up call to arrange
the 360° venue tour.

**F8 — Dashboard**
Landing screen after login. Sidebar navigation: **Add New**, **Declined**,
**Pending**, **Settings**. Body lists the partner's venues as cards with name,
date and time. Declined and Pending are separate destinations — approval status
is a first-class part of the navigation, not a badge on a list.

### 7.3 Technology

- **Frontend:** React SPA, hosted separately from the bench, talking to Frappe
  over cookie-authenticated JSON. (Decision already taken: decoupled React, not a
  Vue web resource on the bench.)
- **Backend:** Frappe / ERPNext at `shotright.thedaystar.co.za`.
- **Approvals:** handled by staff in the ERPNext Desk. We do **not** build an
  admin UI in React.
- **Rich text:** needs an editor component; plain textareas will not satisfy F3 or F5.
- **Images:** menu item images need file storage and a size/type policy.
- **Excel:** real `.xlsx` parsing is required (CSV alone does not satisfy the
  designs, which show a template download and per-category upload).

> **Verified constraint:** none of the Sho't Right doctypes exist on the bench
> today. A check of the connected Frappe instance found stock ERPNext/CRM modules
> and a single unrelated custom doctype. Every doctype in this PRD must be built
> from scratch. Note also that the connected instance resolves to
> `crm-staging.thedaystar.co.za`; confirm which site is the real target.

### 7.4 Assumptions

Flagged so we can test them, not assume them:

1. **Alias matching catches most near-misses.** With C1 resolved, the risk moves
   from "partners fragment the taxonomy" to "our alias list is too thin to catch
   the variants they actually type". Watch the Mood Suggestion queue for the
   first 30 signups: a high share of suggestions that are really duplicates
   means the alias lists need filling out, not that the decision was wrong.
2. **Three time ranges are enough.** A venue with different Monday and Thursday
   hours cannot express that. We assume this is rare enough not to matter.
3. **Desktop is enough for V1.** We assume partners do this sitting at a computer,
   not on a phone behind the bar.
4. **Partners have their menu in a spreadsheet.** Heavy Excel affordances only
   pay off if this is true.
5. **One venue per partner is enough for V1.** The dashboard hints at multiple
   venues but the wizard handles one at a time.
6. **Manual approval scales far enough.** Fine at tens of venues per week;
   breaks at hundreds.
7. **A person is available to do 360° tour visits.** The success screen promises
   this to every partner who signs up.

### 7.5 Conflicts to resolve before building

The designs and the existing backlog disagree. Each needs an owner's decision.

| # | Designs say | Backlog says | Impact |
|---|---|---|---|
| **C1** | Partners **type their own moods** freely, and bulk-upload them via Excel | #15: "Vendor can select from the existing curated Mood list (#20) — **no freeform mood creation from the portal**" | ✅ **RESOLVED — option (c): free text that creates suggestions.** See C1 below. Issue #15's acceptance criteria must be updated to match. |
| **C2** | **Five-step wizard** across separate screens | #15: one flow "**not split across separate screens**" | High. The designs are a wizard; the AC forbids one. The designs should win, but #15's wording must be updated so the AC and the build agree. |
| **C3** | Hours are **weekday / weekend / public holiday** with a movable weekend start | #15: `Venue Operating Hours` child table of `day_of_week, open_time, close_time` | High. Different doctype shape. The design model is simpler and matches partner thinking; the child table is more flexible. Pick one before the doctype is created. |
| **C4** | Menu items have an **image** and **rich-text details** | #17: `Product Item.price` is Currency; no image or rich text mentioned | Medium. Adds file storage, upload limits, and an editor dependency. |
| **C5** | Dashboard nav is **Add New / Declined / Pending / Settings** | #18: "lists the Vendor's own Venues with their current approval status" | Medium. Designs treat Declined and Pending as destinations, not badges. Also, **nothing in the designs shows a "Rejected → fix it → resubmit" journey.** A declined partner needs a path back. |
| **C6** | Terminology is **"Partner"** / "Bloop Partner" | Backlog and code say **"Vendor"** | Low effort, high polish. Partner-facing copy should say Partner. Internal doctypes may stay `Vendor Profile`, but pick one and be consistent. |

#### C1 — resolved: free text that creates suggestions

A partner types any mood they like. The backend then does one of two things:

- **The text resolves to a canonical Mood** — either an exact match on the
  master list or on one of its aliases ("boys night" → **Boys Night Out**). The
  venue is linked to the canonical Mood and is searchable immediately.
- **The text is genuinely new** — a **Mood Suggestion** is recorded with status
  *Pending Review*. The venue is linked to it right away so the partner is never
  blocked, but it does not reach customer search until staff merge or approve it
  from the Desk.

**Doctypes this implies**

| Doctype | Purpose |
|---|---|
| `Mood` (#20) | Canonical, Desk-managed. Gains an **alias** child table — this is what keeps the taxonomy from fragmenting. |
| `Mood Suggestion` | `suggested_name`, `status` (Pending Review / Approved / Merged / Rejected), `vendor_profile`, and a `merged_into` link to a `Mood`. |
| `Venue Mood` | Child table on Venue, linking to **either** a `Mood` or a `Mood Suggestion`. |

**Two things this adds to the designs.** Both are required by the decision
rather than departures from it, and both are built:

1. **A typeahead over the canonical list.** Nudging "boys night" onto the
   existing "Boys Night Out" *before* submission is what actually keeps search
   clean — it is much cheaper than merging duplicates afterwards.
2. **Pills that show their state.** Canonical moods are solid; pending
   suggestions are outlined, with a line explaining that they go live once
   reviewed. Without this a partner reasonably assumes their custom mood is
   already working.

**Still to do on the Desk side:** a review queue for Mood Suggestions, with
merge-into-existing and approve-as-new actions. Nothing in the portal blocks on
it, but suggestions pile up unreviewed until it exists.

**Two gaps the designs do not cover at all:**

- **Profile editing (#19).** There is a "Settings" nav item but no design for it.
  Needs design before build.
- **Declined venue recovery.** "Declined" is a destination with no designed
  screen for *what the partner does next*. Without it, a rejection is a dead end.

---

## 8. Release plan

No fixed dates. Sequenced by dependency — the backend must lead, because no
doctypes exist yet.

### Phase 0 — Decisions and foundations *(short)*

Resolve **C1–C6** above. Design the two missing screens (Settings, Declined
recovery). Confirm the target bench. Scaffold the Frappe app and create the
doctypes. **Nothing else can start until the mood decision (C1) is made** — it
determines the data model.

### V1 — "A partner can list a venue" *(the main build)*

Everything needed for one partner to go from signup to submitted venue:

- Register and login (F1)
- The five-step wizard end to end (F2–F6)
- Confirmation screen (F7)
- Dashboard with Add New, Pending, Declined (F8)
- Excel upload for moods and per menu category, with template download
- Staff approval in ERPNext Desk
- **Full UI fidelity to the designs** — colours, sidebar, wizard rail, pill
  inputs, as specified in 7.1.1

**Definition of done:** a partner who has never seen the portal can list a real
venue without calling us, and that venue appears in the customer app once approved.

### V1.1 — "Fix and follow up" *(soon after)*

- Settings / profile editing (#19) — once designed
- Declined venue recovery: see the reason, fix it, resubmit
- Edit an already-approved venue
- Email notifications on approval and decline

### V2 — "Scale and depth" *(later)*

- Multiple venues or branches per partner
- Mobile-responsive layout
- 360° tour media, once the object-store credentials exist (#7)
- Analytics for partners: how many people found them, and for which mood
- Self-service mood insights ("customers searched 'Rooftop' 400 times near you")

### Out of scope

Payments, partner tiers and packages, customer-facing features, bookings
management, and any React rebuild of the ERPNext admin.

---

## Appendix — Design screen index

| Screen | File |
|---|---|
| Welcome splash | `get started.png` |
| Login | `Login.png` |
| Register | `register.png`, `download.png` |
| Registration success | `login :register success.png` |
| Step 1 — Mood | `setup mood.png`, `add a mood.png`, `mood added.png`, `moods.png`, `setup mood done.png` |
| Step 2 — Venue details | `venue details.png`, `venue details filled.png` |
| Step 3 — Hours | `Operating hours.png`, `operating hours filled.png`, `other operating hours.png`, `final operating hours.png` |
| Step 4 — Menu | `add a menu.png`, `menu type.png`, `menus added.png`, `menu items adding.png`, `menu items list.png`, `menu items loading.png`, `menu items loaded.png`, `menu items listed oo.png`, `menu upload excell loading.png`, `edit a menu item.png` |
| Step 5 — Review | `venue summary screen.png` |
| Success | `venue added success.png` |
| Dashboard | `list of venues.png` |

> Minor design bug to fix: on `venue summary screen.png` the label **"Dress code"**
> appears twice — once for "Formal" and again for "Out door laid back". The second
> is almost certainly **Atmosphere**.
