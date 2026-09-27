# Inkwell

A self-hosted email marketing app: subscriber lists with double opt-in, campaign
sending, open/click tracking, one-click unsubscribe, and bounce handling. Sends
real email through Resend, Amazon SES, or any SMTP provider (Postmark, Mailgun).

## 1. Install

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `FROM_EMAIL` must be on a domain you control and have verified (step 3).
- `ADMIN_API_KEY` — generate one: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
- Pick `EMAIL_PROVIDER` and fill its section (Resend is the fastest to set up).

## 2. Run

```bash
npm start          # http://localhost:3000
```

Open the app, paste your `ADMIN_API_KEY` when prompted, and you're in.
A "Main list" is created automatically.

## 3. Deliverability setup — do this before sending anything real

This is the part that determines whether your mail lands in the inbox or spam.

**a. Verify your sending domain with your provider**
In Resend (or SES/Postmark), add your domain. They'll give you 2–3 DNS records:
- **SPF** (a `TXT` record) — authorizes their servers to send as you
- **DKIM** (one or more `CNAME` or `TXT` records) — signs your outgoing mail
Add these at your domain registrar/DNS host. Propagation can take up to 24h.

**b. Add a DMARC record**
```
_dmarc.yourdomain.com  TXT  "v=DMARC1; p=quarantine; rua=mailto:you@yourdomain.com"
```
Start with `p=none` for a week to monitor, then move to `p=quarantine`.

**c. Send from a subdomain**
Use `mail.yourdomain.com` as `FROM_EMAIL`'s domain rather than your root domain,
so a reputation problem never touches your main domain (website, other email).

**d. Warm up**
Don't blast your full list on day one from a new domain. Send to your most
engaged 100–200 subscribers first, then grow volume over 1–2 weeks.

**e. Point your provider's webhook at this app**
So bounces and spam complaints automatically suppress the subscriber:
```
POST https://yourdomain.com/webhooks/inbound
```
Resend, SES (via SNS), and Postmark each have a webhook config page — set the
bounce/complaint events to fire there. Field names in `src/routes/public.js`
are written for Resend's payload shape; adjust for other providers.

## 4. Add a public signup form

Point any form at:
```
POST /api/public/subscribe
Content-Type: application/json
{ "email": "...", "first_name": "...", "list_id": 1 }
```
This is intentionally unauthenticated — it's meant to be called from your
public website. It triggers a confirmation email (double opt-in) before the
subscriber becomes active and eligible to receive campaigns.

## 6. Compliance — CAN-SPAM and GDPR basics

- **CAN-SPAM footer**: every campaign automatically appends your `COMPANY_NAME`
  and `COMPANY_ADDRESS` from `.env`, plus the unsubscribe link. This isn't
  optional — a missing physical address is itself a violation, independent of
  content. The app warns on startup if you've left the placeholder address in place.
- **Consent proof**: each signup captures the submitting IP (`consent_ip`) and
  the double-opt-in confirmation timestamp (`confirmed_at`) — your evidence
  trail if a complaint or regulator ever asks how someone ended up on your list.
- **Self-service data rights**: every sent email includes a "view or delete
  your data" link (`/my-data/:token`). It returns the subscriber's full record
  as JSON (GDPR Article 15) and lets them permanently delete themselves
  (Article 17) without you lifting a finger.
- **Admin deletes cascade**: deleting a subscriber from the dashboard now also
  removes their campaign-recipient history, so erasure is actually complete.

This covers the essentials for a small list. It does not cover: a public
privacy policy page (write one — a template isn't provided here), CCPA if
you have California subscribers, or a data processing agreement if you use
an EU-based provider. Those are worth a real lawyer's five minutes once you're
sending at any volume.

## 7. Deploy

Any Node host works (Render, Railway, Fly.io, a VPS). Notes:
- The SQLite file (`inkwell.db`) needs a persistent disk — don't deploy to a
  platform that wipes the filesystem on redeploy without a volume mount.
- Set `APP_URL` to your real HTTPS domain — it's used to build confirm,
  unsubscribe, and tracking links, so it must be publicly reachable.
- Put the app behind HTTPS (most hosts do this for you); unsubscribe and
  webhook endpoints should never be plain HTTP in production.

## What's deliberately simple here

- **SQLite**, not Postgres — fine up to tens of thousands of subscribers;
  swap `better-sqlite3` for `pg` if you outgrow it.
- **Plain-text email only** — safer starting point for deliverability than
  HTML (better text-to-image signal), and the personalization/unsubscribe/
  tracking plumbing all carries over if you add an HTML template later.
- **Single admin key**, not multi-user auth — add real auth before giving
  a team access.
- **No queue/worker process** — sends run in-process with batching and
  delay. Fine for lists up to a few tens of thousands; move to a proper job
  queue (BullMQ + Redis) beyond that so a server restart can't drop a
  partially-sent campaign.

## 8. Deliverability toolkit built into the app

Beyond the DNS setup (step 3), the app itself now actively protects your sender reputation:

- **Pre-send content check** (`src/spamCheck.js`) — every draft is scanned for
  spam-trigger phrases, ALL-CAPS subjects, excessive punctuation, URL
  shorteners, and link overload. Warnings show live while you compose;
  nothing is blocked, since these are heuristics, not certainties — use
  judgment on what to fix before sending.
- **Engagement tracking** — every open/click updates `last_engaged_at` on the
  subscriber. This is what mailbox providers actually watch: sending to
  people who never open your mail drags down your domain's reputation for
  every recipient, including the ones who do want it.
- **"Engaged only" sending** — the compose screen has a checkbox to send only
  to subscribers who've engaged in the last 180 days (or subscribed in the
  last 30, so brand-new people aren't unfairly excluded). Recommended once
  your list has any age to it.
- **Deliverability dashboard** (Deliverability tab) — live bounce rate,
  complaint rate, open rate, and click rate, color-coded against the
  thresholds that matter (bounce under 2%, complaint under 0.1%).
- **Cold-subscriber detection** — anyone active but unengaged for 180+ days
  is surfaced with one-click bulk suppression, so you can prune before they
  drag your metrics down rather than after.

None of this replaces the DNS authentication in step 3 — content and
engagement hygiene help at the margins; SPF/DKIM/DMARC are what get you
authenticated in the first place. Do both.
