# Backend contract

The portal calls whitelisted methods on the `shotright` Frappe app. That app
does **not exist on the bench yet** — issues
[#2](https://github.com/Mlu-ctrl-alt-design/shotright/issues/2),
[#14](https://github.com/Mlu-ctrl-alt-design/shotright/issues/14),
[#15](https://github.com/Mlu-ctrl-alt-design/shotright/issues/15) and
[#17](https://github.com/Mlu-ctrl-alt-design/shotright/issues/17) introduce it
and its doctypes.

`api_reference.py` is the exact server surface the frontend is written against.
Drop it into `shotright/api/` when the app is scaffolded, and the portal works
with `VITE_USE_MOCKS=false` and no frontend changes.

## Doctypes this assumes

| DocType | Introduced by | Key fields |
|---|---|---|
| `Vendor Profile` | #14 | `user` (Link → User, optional 1:1), `vendor_name`, `business_name`, `phone` |
| `Venue` | #15 | `venue_name`, `vendor_profile`, `latitude`, `longitude`, `dress_code`, `atmosphere_desc`, `workflow_state` |
| `Venue Operating Hours` | #15 | child table: `day_of_week`, `open_time`, `close_time`, `closed` |
| `Venue Mood` | #15 | child table: `mood` (Link → Mood) |
| `Mood` | #20 | `mood_name` — Desk-managed, curated, read-only from the portal |
| `Product Heading` | #17 | `venue`, `heading`, `idx` |
| `Product Item` | #17 | `product_heading`, `item_name`, `price` (Currency, ZAR), `description` |

## Bench configuration

Two settings the portal depends on, neither of which belongs in `hooks.py`:

**CORS** — only needed if you serve the portal cross-origin. Add to
`sites/common_site_config.json`:

```json
{
  "allow_cors": "https://portal.shotright.co.za",
  "cors_headers": "Authorization,Content-Type,X-Frappe-CSRF-Token"
}
```

In development the Vite proxy makes requests same-origin, so no CORS is
required at all. Prefer that.

**Production reverse proxy** — the Vite proxy is dev-only. Serve the built
`dist/` from nginx and forward the API:

```nginx
location /api {
  proxy_pass http://127.0.0.1:8000;
  proxy_set_header Host $host;
  proxy_set_header X-Frappe-CSRF-Token $http_x_frappe_csrf_token;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location / {
  try_files $uri $uri/ /index.html;   # SPA history fallback
}
```

## Who uses what

Internal staff (venue approvals per #16, Mood Master per #20) use the **ERPNext
Desk** at `/app`. This portal is vendors only — do not rebuild admin screens here.
