# SmartLeadGen API (Cloudflare Workers) — Phase 1

This replaces the Streamlit `app.py` + `backend/` folder with a Cloudflare
Worker + D1 backend. It is a **direct logic port**, not a rewrite from
scratch — same Places API search → website enrichment → validation →
scoring pipeline, same reasoning about why no browser is involved.

## What changed vs. the Streamlit version

- **One correction to how this was scoped initially:** the very first plan
  for this migration assumed the live app still scraped Google Maps with
  Playwright, which would have needed Cloudflare's Browser Rendering
  product. Reading the actual repo showed that had already been fixed —
  `backend/places_api.py` uses Google's official **Places API (New)**,
  a plain HTTPS JSON call. No browser anywhere, on either the old or new
  hosting, which makes this migration considerably simpler than a
  browser-automation one would have been.
- **Multi-tenant from the start** — every table is scoped by `user_id`
  (see `schema.sql`), so this is no longer "one deployment = one user."
- **BYOK key storage moves from a Streamlit admin panel into encrypted D1
  rows** (`src/lib/crypto.ts` — AES-GCM, key never stored in plaintext).
- **Google Sheets moves from a per-user service-account-JSON upload to a
  single connected account** (`support@sayadbayezid.com`) — see setup
  section below. This is the fix for the original "keno service account
  submit korte bole" friction: a user now just shares their own Sheet
  with that one email as Editor, nothing to create or upload.
- **One clarification worth flagging:** "any one of Gemini / OpenAI /
  Anthropic" is wired here as the *optional smart layer* (free-form-goal
  parsing today, AI-drafted outreach copy once the email module is
  built) — not as a replacement for Google Places API, which stays the
  required, dedicated data source. An LLM alone isn't a reliable way to
  "find real businesses matching X"; Places API already does that well.
  See `src/lib/llmProviders.ts` for the reasoning in place.

## What's already provisioned (done for you)

| Resource | Value |
|---|---|
| D1 database `smartleadgen` | `44e4b038-2a5c-4162-8c3e-2ad9203a6550` — 5 tables already created live (see `schema.sql`) |
| KV namespace `SMARTLEADGEN_SESSIONS` | `d0a494bc52c645718b64703e02426645` |
| R2 bucket | **Not created** — R2 isn't enabled on the account yet (enable it in the dashboard under R2 first, if you want it later for storing exports; not required for Phase 1, CSV streams directly in the response) |

Both IDs are already wired into `wrangler.jsonc`.

## Setup

```bash
npm install
npx wrangler login          # if this machine isn't already authenticated
```

### 1. Secrets (never go in wrangler.jsonc, never get committed)

```bash
# 32 random bytes, base64 — used to encrypt every stored API key
openssl rand -base64 32 | npx wrangler secret put ENCRYPTION_KEY
```

### 2. Connecting support@sayadbayezid.com for Sheets (one-time, not per-user)

1. In [Google Cloud Console](https://console.cloud.google.com/), same or a
   new project → enable **Google Sheets API**.
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   → type **Desktop app**. Note the client ID and secret.
3. Run the OAuth consent flow **once**, signed in as `support@sayadbayezid.com`,
   with scope `https://www.googleapis.com/auth/spreadsheets` — the
   [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)
   is the fastest way: gear icon → use your own client ID/secret → authorize
   the Sheets scope → exchange for tokens → copy the **refresh token**.
4. Store all three as Worker secrets:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put GOOGLE_REFRESH_TOKEN
   ```
Until this is done, Sheets push returns a clear error and CSV export still
works — nothing else is blocked by skipping this step for now.

### 3. Deploy

```bash
npx wrangler deploy
```

### 4. First account

Sign up once with `support@sayadbayezid.com` as the email — `ADMIN_EMAIL`
in `wrangler.jsonc` automatically makes that specific signup an admin
account (`is_admin = 1`), which is what unlocks `/api/admin/*` later.

## API surface (Phase 1 — no UI yet, see "Not in this phase" below)

```
POST /api/auth/signup          { email, password }
POST /api/auth/login           { email, password } → { token }
GET  /api/me                                       (auth) — who's logged in (for the dashboard header)

POST /api/keys                 { provider, key }   (auth) — encrypt + store one BYOK key
GET  /api/keys                                     (auth) — which providers are configured

POST /api/jobs                 { keyword, location, maxResults, runEnrichment,
                                  llmProvider?, freeformGoal? }  (auth) → { jobId }
GET  /api/jobs/:id                                 (auth) — status, progress, leads so far
GET  /api/jobs/:id/export.csv                       (auth) — CSV download

POST /api/sheet-connection      { sheetUrl }        (auth)
POST /api/jobs/:id/push-to-sheet                    (auth)

GET  /api/admin/users                               (admin only)
GET  /api/admin/jobs                                (admin only)
```

Every `(auth)` route expects `Authorization: Bearer <token>` from login/signup.

## Not in this phase

Per the phased roadmap — these are Phase 2+, not missing-by-accident:
- Frontend (public site, user dashboard, admin dashboard, animation/motion)
- Email-marketing automation module
- PDF export (CSV is the Phase 1 export path)
- Cloudflare Queues (only needed once real job volume makes the current
  single-invocation `runJob` loop bump into execution-time limits)

## Security note

Real secrets (API tokens, refresh tokens, the encryption key) only ever go
in via `wrangler secret put` or the Cloudflare dashboard — never in
`wrangler.jsonc`, never committed to GitHub, never pasted into a chat
with an assistant, including this one. Anything typed into a chat should
be treated as already exposed and rotated.
