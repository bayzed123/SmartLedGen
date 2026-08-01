import type { AuthedUser, LeadRow, Provider } from "../types";

const uid = () => crypto.randomUUID();

export async function createUser(
  db: D1Database,
  email: string,
  passwordHash: string,
  isAdmin: boolean
): Promise<AuthedUser> {
  const id = uid();
  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, is_admin) VALUES (?, ?, ?, ?)`
    )
    .bind(id, email.toLowerCase().trim(), passwordHash, isAdmin ? 1 : 0)
    .run();
  return { id, email, is_admin: isAdmin ? 1 : 0, free_trial_used: 0, plan: "free" };
}

export async function getUserByEmail(db: D1Database, email: string) {
  return db
    .prepare(`SELECT * FROM users WHERE email = ?`)
    .bind(email.toLowerCase().trim())
    .first<{ id: string; email: string; password_hash: string; is_admin: number; free_trial_used: number; plan: string }>();
}

export async function getUserById(db: D1Database, id: string) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<AuthedUser>();
}

export async function markFreeTrialUsed(db: D1Database, userId: string) {
  await db.prepare(`UPDATE users SET free_trial_used = 1 WHERE id = ?`).bind(userId).run();
}

// ---------------------------------------------------------------------------
// Provider (BYOK) keys — stored encrypted; callers decrypt only in-memory,
// only at the moment a job needs to actually call that provider.
// ---------------------------------------------------------------------------

export async function upsertProviderKey(
  db: D1Database,
  userId: string,
  provider: Provider,
  encryptedKey: string,
  iv: string
) {
  await db
    .prepare(
      `INSERT INTO provider_keys (id, user_id, provider, encrypted_key, iv)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider) DO UPDATE SET encrypted_key = excluded.encrypted_key, iv = excluded.iv`
    )
    .bind(uid(), userId, provider, encryptedKey, iv)
    .run();
}

export async function getProviderKey(db: D1Database, userId: string, provider: Provider) {
  return db
    .prepare(`SELECT encrypted_key, iv FROM provider_keys WHERE user_id = ? AND provider = ?`)
    .bind(userId, provider)
    .first<{ encrypted_key: string; iv: string }>();
}

export async function listConfiguredProviders(db: D1Database, userId: string) {
  const { results } = await db
    .prepare(`SELECT provider FROM provider_keys WHERE user_id = ?`)
    .bind(userId)
    .all<{ provider: string }>();
  return results.map((r) => r.provider);
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function createJob(
  db: D1Database,
  userId: string,
  params: { keyword: string; location: string; maxResults: number; runEnrichment: boolean; llmProvider?: string }
): Promise<string> {
  const id = uid();
  await db
    .prepare(
      `INSERT INTO jobs (id, user_id, keyword, location, max_results, run_enrichment, llm_provider, status, progress_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
    .bind(id, userId, params.keyword, params.location, params.maxResults, params.runEnrichment ? 1 : 0, params.llmProvider ?? null, params.maxResults)
    .run();
  return id;
}

export async function updateJobStatus(
  db: D1Database,
  jobId: string,
  fields: Partial<{ status: string; progress_current: number; error_message: string; started_at: string; completed_at: string }>
) {
  const sets = Object.keys(fields);
  if (sets.length === 0) return;
  const sql = `UPDATE jobs SET ${sets.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`;
  await db.prepare(sql).bind(...sets.map((k) => (fields as any)[k]), jobId).run();
}

export async function getJob(db: D1Database, jobId: string, userId: string) {
  return db
    .prepare(`SELECT * FROM jobs WHERE id = ? AND user_id = ?`)
    .bind(jobId, userId)
    .first<any>();
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export async function insertLeadIfNew(db: D1Database, row: Omit<LeadRow, "id" | "collected_at">): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO leads
        (id, job_id, user_id, dedup_key, business_name, sector, address, phone, website,
         email, facebook, instagram, linkedin, rating, review_count, lead_score, maps_link)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, dedup_key) DO NOTHING`
    )
    .bind(
      uid(), row.job_id, row.user_id, row.dedup_key, row.business_name, row.sector, row.address,
      row.phone, row.website, row.email, row.facebook, row.instagram, row.linkedin,
      row.rating, row.review_count, row.lead_score, row.maps_link
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function getLeadsForJob(db: D1Database, jobId: string, userId: string) {
  const { results } = await db
    .prepare(`SELECT * FROM leads WHERE job_id = ? AND user_id = ? ORDER BY collected_at ASC`)
    .bind(jobId, userId)
    .all<LeadRow>();
  return results;
}

// ---------------------------------------------------------------------------
// Sheet connection (single-account OAuth model — see README)
// ---------------------------------------------------------------------------

export async function setSheetConnection(db: D1Database, userId: string, sheetUrl: string) {
  await db
    .prepare(
      `INSERT INTO sheet_connections (user_id, sheet_url) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET sheet_url = excluded.sheet_url`
    )
    .bind(userId, sheetUrl)
    .run();
}

export async function getSheetConnection(db: D1Database, userId: string) {
  return db.prepare(`SELECT * FROM sheet_connections WHERE user_id = ?`).bind(userId).first<any>();
}

// ---------------------------------------------------------------------------
// Admin — the only queries allowed to see across users
// ---------------------------------------------------------------------------

export async function adminListUsers(db: D1Database) {
  const { results } = await db
    .prepare(`SELECT id, email, plan, free_trial_used, is_admin, created_at FROM users ORDER BY created_at DESC`)
    .all();
  return results;
}

export async function adminListJobs(db: D1Database, limit = 100) {
  const { results } = await db
    .prepare(
      `SELECT jobs.*, users.email FROM jobs JOIN users ON users.id = jobs.user_id
       ORDER BY jobs.created_at DESC LIMIT ?`
    )
    .bind(limit)
    .all();
  return results;
}

// ---------------------------------------------------------------------------
// Reviews — submitted by registered users, shown publicly only once approved.
// ---------------------------------------------------------------------------

export async function submitReview(db: D1Database, userId: string, email: string, rating: number, comment: string) {
  const id = uid();
  await db
    .prepare(`INSERT INTO reviews (id, user_id, email, rating, comment) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, userId, email, rating, comment)
    .run();
  return id;
}

export async function getApprovedReviews(db: D1Database, limit = 20) {
  const { results } = await db
    .prepare(`SELECT rating, comment, email, created_at FROM reviews WHERE approved = 1 ORDER BY created_at DESC LIMIT ?`)
    .bind(limit)
    .all();
  return results;
}

export async function adminListReviews(db: D1Database) {
  const { results } = await db.prepare(`SELECT * FROM reviews ORDER BY created_at DESC`).all();
  return results;
}

export async function setReviewApproved(db: D1Database, reviewId: string, approved: boolean) {
  await db.prepare(`UPDATE reviews SET approved = ? WHERE id = ?`).bind(approved ? 1 : 0, reviewId).run();
}

// ---------------------------------------------------------------------------
// Access codes — a manual paid-access gate ahead of real subscription billing.
// A code redeemed once unlocks unlimited access for that account.
// ---------------------------------------------------------------------------

export async function generateAccessCodes(db: D1Database, count: number): Promise<string[]> {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789#@$";
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(15));
    const suffix = Array.from(bytes, (b) => charset[b % charset.length]).join("");
    const code = `SMARTGENTOOLS-${suffix}`;
    await db.prepare(`INSERT INTO access_codes (code) VALUES (?)`).bind(code).run();
    codes.push(code);
  }
  return codes;
}

export async function redeemAccessCode(db: D1Database, code: string, userId: string): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE access_codes SET status = 'redeemed', redeemed_by_user_id = ?, redeemed_at = datetime('now')
       WHERE code = ? AND status = 'unused'`
    )
    .bind(userId, code.trim())
    .run();
  const ok = (result.meta.changes ?? 0) > 0;
  if (ok) await db.prepare(`UPDATE users SET plan = 'paid' WHERE id = ?`).bind(userId).run();
  return ok;
}

/** Same idea, for the Streamlit app — which has no Cloudflare account/user_id,
 *  just an email typed into the gate. Shares the same code pool. */
export async function redeemAccessCodeByEmail(db: D1Database, code: string, email: string): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE access_codes SET status = 'redeemed', redeemed_by_email = ?, redeemed_at = datetime('now')
       WHERE code = ? AND status = 'unused'`
    )
    .bind(email.trim(), code.trim())
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function adminListAccessCodes(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT access_codes.*, users.email AS user_email FROM access_codes
       LEFT JOIN users ON users.id = access_codes.redeemed_by_user_id
       ORDER BY access_codes.created_at DESC`
    )
    .all();
  return results.map((r: any) => ({ ...r, redeemed_by_email: r.user_email || r.redeemed_by_email }));
}
