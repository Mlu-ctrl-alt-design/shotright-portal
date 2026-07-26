# Transactional email

The portal sends five messages: a verification code, a welcome, a venue
submission confirmation, a password reset code, and a password-changed
notice. All five go through `frappe.sendmail`.

---

## 1. About SendGrid — read this first

**I could not confirm a SendGrid account exists on this bench.**

The brief was to reuse SendGrid credentials already configured for another
account on the same bench. The only site reachable from the build environment
is `crm-staging.thedaystar.co.za`, and it has exactly one Email Account:

| Field | Value |
|---|---|
| Name | Sales |
| Email | `sales@thedaystar.co.za` |
| SMTP | `mail.thedaystar.co.za` : `465`, SSL |
| Outgoing | enabled, default |

That is a plain SMTP mailbox, **not** SendGrid. The credentials may live on
`crm.thedaystar.co.za` (production) or on the shotright site itself — the
network policy here blocks both, so this is a gap in what I could verify, not a
conclusion that SendGrid is absent.

**It does not block anything.** Nothing in the code names a provider. Frappe
resolves the outgoing account from the Desk at send time, so choosing between
SendGrid and the existing SMTP mailbox is a five-minute configuration change
with no deploy. Set up whichever you actually have.

Do not `pip install sendgrid` and call their SDK from `otp_and_email.py`. It
would pin the platform to one vendor, and it would bypass Frappe's send queue,
retry handling and Communication log — so a failed OTP would vanish instead of
appearing in the error log where whoever is on call can find it.

---

## 2. Configure the outgoing account

Desk → **Email Account** → New.

### Option A — SendGrid

SendGrid is SMTP, so this is an ordinary Email Account:

| Field | Value |
|---|---|
| Email Address | `noreply@shotright.co.za` |
| Service | Custom (SendGrid is not in Frappe's preset list) |
| SMTP Server | `smtp.sendgrid.net` |
| Port | `587` |
| Use TLS | ✅ (do **not** also tick Use SSL — 587 is STARTTLS; 465 is SSL) |
| Username | `apikey` — the literal string, not your account name |
| Password | the API key, `SG.…` |
| Enable Outgoing | ✅ |
| Default Outgoing | ✅ |
| Always use Account's Email Address as Sender | ✅ |

Two things that bite:

- **The username really is `apikey`.** Every SendGrid SMTP integration uses
  that literal value; the key itself goes in the password field.
- **Verify the sender domain in SendGrid before going live.** An unverified
  sender is accepted by the API and then silently dropped or spam-foldered,
  which looks exactly like the portal being broken.

### Option B — the existing SMTP mailbox

If SendGrid turns out not to exist, `mail.thedaystar.co.za:465` (SSL) already
works for the CRM. Create a `noreply@` or `partners@` mailbox on it and use the
same settings as the `Sales` account above.

Either way: **send a test email before deploying `otp_and_email.py`.** With
verification live and mail broken, every new partner is locked out of the
product with no way through — strictly worse than the junk accounts this is
meant to stop.

### Deliverability

Whichever transport you pick, set SPF, DKIM and DMARC for the sending domain.
Verification codes are the single worst kind of mail to have spam-foldered: the
partner is sitting on the screen waiting, and their next move is to give up.

---

## 3. Email Templates

Desk → **Email Template** → New, one per row. `Use HTML` on, and the response
field takes Jinja.

| Template name | Variables |
|---|---|
| `shotright_otp_registration` | `code`, `first_name`, `minutes` |
| `shotright_otp_password_reset` | `code`, `first_name`, `minutes` |
| `shotright_welcome` | `first_name`, `business_name` |
| `shotright_venue_submitted` | `first_name`, `venue_name`, `status` |
| `shotright_password_changed` | `first_name` |

Names must match `otp_and_email.py` exactly — Frappe fails the send if a
template is missing, and `_send` swallows that into the error log rather than
breaking the request, so a typo shows up as "no email arrived" rather than as
an error on screen.

### `shotright_otp_registration`

```html
<p>Hi {{ first_name }},</p>
<p>Your Sho't Right verification code is:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:8px;font-family:monospace">
  {{ code }}
</p>
<p>It expires in {{ minutes }} minutes.</p>
<p style="color:#6b7280;font-size:13px">
  If you didn't try to create a Sho't Right partner account, you can ignore this
  email — nothing has been set up.
</p>
```

Put the code in the **subject line too** (`Your Sho't Right code: {{ code }}`)
if you want the fastest possible entry — most people can read it from the
notification without opening the mail. The tradeoff is that it is then visible
on a lock screen, so decide deliberately; the code in `otp_and_email.py` keeps
it out of the subject.

### `shotright_otp_password_reset`

```html
<p>Hi {{ first_name }},</p>
<p>Use this code to reset your Sho't Right password:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:8px;font-family:monospace">
  {{ code }}
</p>
<p>It expires in {{ minutes }} minutes.</p>
<p style="color:#6b7280;font-size:13px">
  If you didn't ask to reset your password, ignore this email and your password
  stays as it is. Someone may have mistyped their address.
</p>
```

That last line matters. Because the reset endpoint deliberately does not reveal
whether an account exists, this mail sometimes lands with people who never
asked for it — the wording has to make that unalarming.

### `shotright_welcome`

```html
<p>Hi {{ first_name }},</p>
<p>
  Your Sho't Right partner account is live{% if business_name %} for
  {{ business_name }}{% endif %}. Next step is adding your first venue — the
  moods you pick are how customers searching for a vibe will find you.
</p>
<p><a href="https://shotright-portal.vercel.app/venues/new">Add your venue</a></p>
```

### `shotright_venue_submitted`

```html
<p>Hi {{ first_name }},</p>
<p>
  We've received <strong>{{ venue_name }}</strong> and it's now
  <strong>{{ status }}</strong>. Our team reviews new venues before they go
  live to customers — we'll email you the moment that's done.
</p>
<p style="color:#6b7280;font-size:13px">
  If you added a mood that's new to Sho't Right, it's queued for review
  separately. The rest of your venue isn't waiting on it.
</p>
```

### `shotright_password_changed`

```html
<p>Hi {{ first_name }},</p>
<p>Your Sho't Right password was just changed, and you've been signed in on this device.</p>
<p style="color:#6b7280;font-size:13px">
  If this wasn't you, reply to this email straight away — someone has access to
  your mailbox.
</p>
```

This one is a security notification rather than a courtesy. It is sent even
though the person just performed the change themselves and "knows": if the
reset was *not* theirs, this message is the only way they find out.

---

## 4. Scheduler

Add to `hooks.py` so unverified accounts do not squat real addresses forever:

```python
scheduler_events = {
    "daily": ["shotright.api.otp_and_email.purge_unverified_accounts"],
}
```

Without it, someone who mistypes their email holds the real owner's address
hostage: registration keeps reporting "already registered" while the code goes
somewhere they cannot read.

---

## 5. Order of operations

1. Create the Email Account and **send a test**.
2. Create the five Email Templates.
3. Create the `Vendor OTP` doctype (spec at the bottom of `otp_and_email.py`).
4. Add the scheduler event.
5. Deploy `otp_and_email.py`.

Step 5 last. Deploying the code before mail works is an outage for every new
partner, and there is no way for them to route around it.

The portal needs **no release** for any of this — it detects `otp_required` in
the `register_vendor` response and shows the code screen automatically. Until
then it keeps signing partners in directly, exactly as it does today.
