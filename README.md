# SmartLeadGen
Read If You want build Beta [README-streamlit.md](README-streamlit.md)

Live Demu [Smart Lead Genarator (Pro)](https://smartleadgen-frontend.sayadmdbayezidhosan.workers.dev)

Live Demu [Smart Lead Genarator (Beta)](https://smartledgen-d2l3wnvtlt4siv2quddtpf.streamlit.app)

Finds real local businesses that could use a website, SEO, or marketing help — searches Google's own Places data, checks each business's own site for a contact email, and scores how strong (or weak) their online presence already is.

Live pieces:
- **API** — Cloudflare Worker, `worker/`
- **Frontend** — static site (public homepage, login, dashboard, admin), Cloudflare Workers Static Assets, `frontend/`
- **CI/CD** — GitHub Actions, `.github/workflows/`, deploys both on push to `main`

---

## Architecture

```
Browser
  │
  ├── frontend (Cloudflare Workers Static Assets)
  │     index.html (public homepage)  login.html  dashboard.html  admin.html
  │     about / contact / help / support / privacy / refund / trust
  │
  └── calls the API over HTTPS ──────────────────────────────┐
                                                               ▼
                                          worker (Cloudflare Worker, Hono)
                                          ├── D1 (users, provider_keys, jobs, leads, reviews)
                                          ├── KV (sessions, chat rate-limit)
                                          ├── Workers AI (free — powers the support chatbot)
                                          └── outbound HTTPS to:
                                                - Google Places API (New)     — user's own key
                                                - Gemini / OpenAI / Claude    — user's own key, optional
                                                - Google Sheets API           — one connected account
```

Nothing here scrapes anything or drives a browser — every external call is a
plain HTTPS API request. Every user's account, keys, and leads are isolated
by `user_id` in every table; API keys are encrypted before storage.

## Repo structure

```
worker/       Cloudflare Worker API — see worker/README.md for full setup
frontend/     Static site — see frontend/README.md
.github/workflows/
  deploy-worker.yml     redeploys worker/ on push
  deploy-frontend.yml   redeploys frontend/ on push
```

---

## Prerequisites — everything this needs to actually work

Nothing below is optional if you want a real search to succeed end to end.
Missing any one of these is the most common reason a search fails or a key
won't save.

| # | What | Where |
|---|---|---|
| 1 | Cloudflare account, with the D1 database + KV namespace already created | Done — see `worker/wrangler.jsonc` for the live IDs |
| 2 | GitHub repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` | GitHub → repo → Settings → Secrets and variables → Actions |
| 3 | Worker secret `ENCRYPTION_KEY` | `npx wrangler secret put ENCRYPTION_KEY` — see below |
| 4 | A Google Cloud project with **billing enabled** and **Places API (New)** enabled | [console.cloud.google.com](https://console.cloud.google.com) |
| 5 | A Places API key created on that project, pasted into the dashboard | Dashboard → API keys → Google Places API key |

**#4 is the one people skip.** Google requires a billing account attached to
the project *even for light, mostly-free usage* — without it, every search
fails with a 403 ("Google rejected this request") regardless of anything
else being correct.

Optional, not required for a first successful search:
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` — only for pushing leads to Google Sheets (CSV export needs none of this)
- `SUPPORT_CHATBOT_API_KEY` — only if you want the chat bubble on Claude instead of the free default (Workers AI / Llama)
- An AI provider key (Gemini/OpenAI/Claude) — only for the "describe your goal in plain words" search mode

## Setup, in order

1. **Worker secrets**
   ```bash
   cd worker
   npm install
   openssl rand -base64 32 | tr -d '\n' | npx wrangler secret put ENCRYPTION_KEY
   ```
2. **GitHub secrets** — add `CLOUDFLARE_API_TOKEN` (Cloudflare dashboard → My Profile → API Tokens → "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID` (Cloudflare dashboard → Workers & Pages → Account Details) as GitHub repository secrets.
3. **Deploy the worker** — push to `main`, or `npx wrangler deploy` from `worker/`. Note the printed `*.workers.dev` URL.
4. **Point the frontend at it** — open `frontend/public/app.js`, set `API_BASE` to that URL. Push (or `npx wrangler deploy` from `frontend/`).
5. **Google Cloud** — enable [Places API (New)](https://console.cloud.google.com/apis/library/places.googleapis.com), attach a billing account to that project, then create a key under [Credentials](https://console.cloud.google.com/apis/credentials).
6. **Sign up** on the deployed frontend, paste that Places API key into the dashboard, save.
7. **Run a search** — a keyword and a location, nothing else required.

## Confirming a real success (not just "no error")

A genuinely successful run looks like:
- The "Live progress" bar moves past `0 / N` within a few seconds of clicking Start.
- The status banner reads "Done — N lead(s) collected" (N ≥ 1 for almost any real place + location).
- Rows appear in the Collected Leads table with a business name and a 🔥/🟡/⚪ score.
- The CSV download button appears once at least one lead exists.

If progress stays at `0 / N` past ~15–20 seconds, or the banner turns red, that's a
config problem, not a code bug at that point — see Troubleshooting.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "ENCRYPTION_KEY isn't set on the worker" | Secret missing on the deployed worker | `npx wrangler secret list` from `worker/` to confirm — if absent, re-run the setup command above |
| Same error, but you've set it before | The key may have been set a *second* time with a *new* random value, silently invalidating keys saved under the old one | Re-enter and re-save your Google Places API key in the dashboard, then retry |
| "Google rejected this request (403)" | Places API (New) not enabled, or no billing on that Google Cloud project | Enable both — see Prerequisites #4 |
| "Rate-limited by Google (429)" | Calling faster than your project's quota | Wait, or raise the quota in Google Cloud |
| Gemini/OpenAI/Claude "quota exceeded" | The AI provider's own account, not this app — Gemini has a free tier with a low per-minute limit; OpenAI/Claude generally need billing added before any call works | Wait a minute (Gemini), or add a payment method on the provider's own site |
| Header/footer look unstyled or invisible | Old cached deploy — this was fixed; make sure `frontend/public/styles.css` is the current version | Redeploy the frontend |
| Chat bubble says "Couldn't reach the server" | Either `API_BASE` in `app.js` is still the placeholder, or the worker hasn't been redeployed with the latest code | Check `app.js`, redeploy `worker/` |
| Free trial says already used, but no leads exist | Trial is marked used as soon as a job is *created*, even if it later errors | This is a known limitation — a failed job still consumes the trial for now |

## Not built yet (by design, not by accident)

- Google OAuth ("Log in with Google") — email/password works now, this is a deliberate next step
- Email-marketing automation module
- PDF export (CSV is the export path today)
- Cloudflare Queues (only needed once search volume outgrows a single Worker invocation)

## More detail

- [`worker/README.md`](worker/README.md) — full API reference, every secret, every endpoint
- [`frontend/README.md`](frontend/README.md) — frontend-specific notes
