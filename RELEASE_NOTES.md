# SmartLeadGen — Release Notes

## Cloudflare (current, active development) — v0.1, 2026-08-01

**Status:** Pre-launch / in testing. Multi-tenant, replaces the Streamlit version below once confirmed stable.

- **Frontend:** `https://smartleadgen-frontend.sayadmdbayezidhosan.workers.dev`
- **API:** `https://smartleadgen-api.sayadmdbayezidhosan.workers.dev`

**What's live:**
- Public homepage — how it works, pricing (TBD), FAQ, real user reviews
- Email/password signup and login, per-account data isolation
- BYOK: required Google Places API key + optional Gemini/OpenAI/Claude key
- Search with live progress, High/Medium/Low lead scoring
- CSV export; Google Sheets export (once the connected-account OAuth is set up)
- One free search per account; paid plans not yet priced
- Admin dashboard (users, jobs, review moderation) — reached via a footer icon
- Support chatbot (free, Workers AI / Llama by default) — product questions only
- Privacy Policy, Refund Policy, Trust Center, About, Contact, Help Center, Support pages

**Known issues / in progress:**
- `ENCRYPTION_KEY` setup is sensitive to *which* Cloudflare account the CLI is authenticated as — see `README.md` Troubleshooting
- Google Sheets OAuth connection is a manual one-time setup, still being completed
- Google OAuth ("Log in with Google") not yet built — email/password only for now
- Email-marketing automation module not started
- PDF export not built (CSV only)

## Streamlit (legacy) — being phased out

**Status:** Still running, kept online deliberately as a working reference while the Cloudflare version is being confirmed. Not where new work happens.

- **URL:** `https://smartledgen-d2l3wnvtlt4siv2quddtpf.streamlit.app`

**What it does:**
- Single-tenant — one Places API key configured in the admin panel, used for everyone
- Search → Google Places API (New) → website check for contact email/socials → scored CSV export
- Google Sheets export via a manually uploaded service-account JSON (the friction point that motivated the Cloudflare migration)
- Sleeps after inactivity (Streamlit Community Cloud's free-tier behavior) — the original reason to move off it

**Plan:** keep it running, untouched, until the Cloudflare version has a confirmed successful end-to-end search of its own. Retire it after that — no changes are planned to this version in the meantime.
