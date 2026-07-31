# SmartLeadGen Frontend — Phase 2 (login + dashboard)

Plain HTML/CSS/JS, no build step — deployed as static assets on Cloudflare
Workers (same platform as the API, separate deployment). Carries forward
the existing app.py visual identity (teal/amber, Space Grotesk + Inter,
the "ping" mark) rather than starting a new one.

## Before deploying

Open `public/app.js` and set `API_BASE` to your deployed API worker's URL
— you'll get this from the `worker/` deploy (either the `*.workers.dev`
URL Wrangler prints, or your custom domain once attached). It's a
placeholder right now and the site won't work until this is set.

## Local preview

```bash
npm install
npx wrangler dev
```

## Deploy

```bash
npx wrangler deploy
```

Or just push to `frontend/**` on `main` — the `deploy-frontend.yml`
workflow handles it, same as the backend.

## What's here vs. what's next

This covers login/signup and the main working dashboard (API keys,
search, live progress, results, CSV, Sheets push) — enough to fully
exercise the Phase 1 backend end to end. The public marketing homepage
(SEO copy, use cases, reviews, pricing) and the separate admin dashboard
are still queued as later phases.
