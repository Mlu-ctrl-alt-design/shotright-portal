# Working on the Sho't Right Partner Portal

## Tests are not optional

**Standing instruction, 28 Jul 2026:**

> Whenever we add new features and functionality you are to run these tests, and
> create new tests for those features.

So, every time:

```bash
npm test          # RTL + vitest — 63 checks, ~18s. Run this on every change.
npm run build && npx vite preview --port 4173 --host 127.0.0.1 &
npm run test:e2e  # 21 Playwright suites against the production bundle
```

New feature → new tests in the same commit. A feature without them is unfinished,
not "to be covered later".

## Two suites, two jobs

| | `src/test/*.test.jsx` | `verification/verify*.mjs` |
|---|---|---|
| Runner | vitest + React Testing Library + MSW | Playwright, real Chromium |
| Under test | the app's components and services | the built bundle |
| Speed | ~18s for all of it | ~30–60s **per suite** |
| Catches | a field that fights the keyboard, a save that stores nothing, copy that lies | a bundle that will not boot, real image decoding, layout |

Neither replaces the other. The RTL suites found two bugs on the day they were
written that a year of the Playwright suites had not, because they drive
individual controls; the Playwright suites catch things jsdom cannot see at all.

**Both drive the UI.** No test calls a service function directly. Type into the
field, click the button, then assert on **what reached the server** —
`bench.venues`, `bench.items`, `bench.calls`. A test that only checks the screen
still shows what was typed passes straight through the bug class this project
actually has: a 200 that stored nothing.

## The fake bench

`src/test/bench.js` + `src/test/server.js` are a stateful Frappe, with Frappe's
habits — because those habits are where the bugs come from:

- **Undeclared kwargs are dropped silently at HTTP 200.** `bench.declared`.
- **A missing METHOD and a missing DOCUMENT are both 404 `DoesNotExistError`.**
  Only the exception text separates them.
- **Messages are HTML.** `frappe.throw` takes markup and it reaches the screen.
- **`update_venue` refuses unknown fields** instead of ignoring them, unlike
  everything else. `bench.venueWritable`.

Model "not deployed yet" with `bench.deploy.some_method = false`. MSW runs with
`onUnhandledRequest: 'error'`, so a new endpoint forces a decision here rather
than hanging on a spinner that passes every assertion.

## Query by role, not by text

Most inputs carry a visible `<label>` **and** an `aria-label` with the same
words, so `getByLabelText(/venue name/i)` matches twice and throws. Use
`getByRole('textbox', { name: /venue name/i })`.

Exceptions found the hard way: the address field is a **combobox** (ARIA
autocomplete); dress code is a **select** in the wizard and a **text input** on
the edit form; latitude/longitude are text inputs labelled by `htmlFor`, so
`getByLabelText(..., { selector: 'input' })`.

## Things that surprised the tests

- The wizard's first step is **moods**, not venue details.
- The details step will not advance without a **location**.
- The OTP field **submits itself on the sixth digit**.
- Draft `payload` and `completed` come back from the bench as **JSON strings**.

## Where the reasoning lives

- `docs/DEV-LOG.md` — one entry per session: what broke, what was decided, what
  is owed to whom. Read the last entry before starting.
- `docs/BACKEND-ASKS.md` — the live list for the backend team. §0 and §14 first.
- `verification/README.md` — what each Playwright suite covers and why.
