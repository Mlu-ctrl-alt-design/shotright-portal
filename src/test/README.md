# UI tests

React Testing Library + vitest + MSW. **80 checks, ~29 seconds**, run with:

```bash
npm test
```

## What these are

Eleven user flows, driven the way a partner drives them: type into the field, click
the button, read the screen. The real `<App />` is mounted at a route with the
real router, query client, auth guard, service layer and axios interceptors. The
only substitution is the Frappe bench itself, at the network boundary.

That costs something — a failure can come from anywhere in the stack. It buys
the only thing worth having: **a passing test means the flow works**, rather than
meaning a component renders when handed data no real screen would produce.
Nearly every bug on this project has lived in the seams between those pieces.

| File | Flow |
|---|---|
| `login.test.jsx` | signing in, wrong passwords, the auth guard |
| `register.test.jsx` | creating an account, email verification |
| `venue-add.test.jsx` | the five-step wizard end to end, and setting a location |
| `venue-edit.test.jsx` | editing, renaming, and a server that refuses fields |
| `menu.test.jsx` | adding, editing and deleting menu items |
| `resume-and-photos.test.jsx` | picking up a saved setup, uploading photos |
| `password-reset.test.jsx` | resetting a password, resending a verification code |

## The rule these follow

**Assert on what reached the server, not on what the screen says.**

```js
await user.type(field, 'Corner Kitchen and Bar')
await save(user)
expect(venueById('VEN-00001').venue_name).toBe('Corner Kitchen and Bar')
```

"The name doesn't persist" was reported from production, and the cause was an
HTTP 200 that stored nothing. A test asserting the form still showed the typed
name would have passed happily through it.

## Bugs these found

**The coordinate fields could not be typed into.** `MapPicker` dropped any
keystroke that didn't parse as a number, and the inputs are controlled — so `-`
and `.` were silently discarded and `-25.7069` became `257069`. Every latitude
in South Africa is negative. Only dragging the pin worked.

**Server-saved drafts restored nothing.** `saveDraft` posts
`JSON.stringify(payload)`; `normalise` never parsed it back. "Continue setup"
opened a blank wizard with no error anywhere. The localStorage path round-tripped
the object fine, which is why nobody saw it.

**Every venue edit crashed the server.** `moods` is a child table on `Venue`, so
`venue.update()` handed a list of ids to Frappe's `_init_child`, which assigns
into each row: `TypeError: 'str' object does not support item assignment`. The
form sent the whole venue back on every save, so every edit went through the one
field the endpoint cannot accept. It now sends only what changed.

**The edit form opened with a blank address.** `get_venue_detail` omits fields
`get_vendor_dashboard` returns. Open, see empty, save — and the address really is
erased.

The first two are the same shape: a fallback worked, so the real path failing was
invisible. The last two are the same shape as each other: two views of one
record that don't agree, and the one we happened to ask was the one missing the
answer.

## Adding one

1. Drive the UI. Never call a service function.
2. Query by **role** — most fields carry a label *and* an aria-label, so a text
   lookup matches twice and throws.
3. Assert on `bench.*` after the interaction.
4. Model a missing endpoint with `bench.deploy.method_name = false`.
5. Write the comment for why the assertion matters, not what it does.

The fake bench is `bench.js` (state) and `server.js` (handlers). If the app
starts calling an endpoint that isn't handled, MSW throws rather than hanging —
that is deliberate, and it means adding an endpoint forces a decision about what
it returns.
