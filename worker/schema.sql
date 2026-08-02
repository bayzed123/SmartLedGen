-- Already applied to the live `smartleadgen` D1 database (see README).
-- Kept here as the source of truth for local dev / future migrations —
-- running this again is safe to skip against the remote DB, but useful for
-- `wrangler d1 execute smartleadgen --local` when developing offline.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  free_trial_used INTEGER NOT NULL DEFAULT 0,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per (user, provider). `provider` covers both the required data
-- source (google_places) and the optional "smart layer" keys (gemini /
-- openai / anthropic / hunter). Keys are never stored in plaintext.
CREATE TABLE IF NOT EXISTS provider_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK (provider IN ('google_places','hunter','gemini','openai','anthropic')),
  encrypted_key TEXT NOT NULL,
  iv TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  keyword TEXT NOT NULL,
  location TEXT,
  max_results INTEGER NOT NULL DEFAULT 20,
  run_enrichment INTEGER NOT NULL DEFAULT 1,
  llm_provider TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','error')),
  progress_current INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  dedup_key TEXT NOT NULL,
  business_name TEXT,
  sector TEXT,
  address TEXT,
  phone TEXT,
  website TEXT,
  email TEXT,
  facebook TEXT,
  instagram TEXT,
  linkedin TEXT,
  rating REAL,
  review_count INTEGER,
  lead_score TEXT,
  maps_link TEXT,
  collected_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, dedup_key)
);

-- Records that a user says they've shared their Sheet with the single
-- connected Google account (see README section on Sheets OAuth).
CREATE TABLE IF NOT EXISTS sheet_connections (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  sheet_url TEXT NOT NULL,
  worksheet_name TEXT NOT NULL DEFAULT 'Leads',
  connected_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_job ON leads(job_id);

-- Submitted only by registered (logged-in) users; shown on the public
-- homepage only once an admin approves it.
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  email TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reviews_approved ON reviews(approved);

-- Manual paid-access gate ahead of real subscription billing — a code
-- redeemed once sets that account's plan to 'paid' (unlimited access).
-- redeemed_by_email covers redemptions from the Streamlit app, which has
-- no Cloudflare account/user_id of its own.
CREATE TABLE IF NOT EXISTS access_codes (
  code TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused','redeemed')),
  redeemed_by_user_id TEXT REFERENCES users(id),
  redeemed_by_email TEXT,
  redeemed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
