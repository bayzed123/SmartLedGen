import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, AuthedUser, Provider } from "./types";
import { LEAD_HEADER_ROW } from "./types";
import { signup, login, requireAuth, requireAdmin } from "./lib/auth";
import { encryptSecret, decryptSecret } from "./lib/crypto";
import {
  upsertProviderKey, listConfiguredProviders, getProviderKey, createJob, getJob,
  getLeadsForJob, markFreeTrialUsed, setSheetConnection, getSheetConnection,
  adminListUsers, adminListJobs,
} from "./lib/db";
import { runJob } from "./lib/job";
import { appendLeadsToSheet } from "./lib/sheets";
import { parseFreeformGoal } from "./lib/llmProviders";

type Vars = { user: AuthedUser };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.use("*", cors()); // frontend is a separate static site — see README on locking this down per-origin later

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

app.post("/api/auth/signup", async (c) => {
  const { email, password } = await c.req.json();
  if (!email || !password) return c.json({ error: "Email and password are required." }, 400);
  try {
    const { user, token } = await signup(c.env, email, password);
    return c.json({ user: { id: user.id, email: user.email, is_admin: user.is_admin }, token });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

app.post("/api/auth/login", async (c) => {
  const { email, password } = await c.req.json();
  if (!email || !password) return c.json({ error: "Email and password are required." }, 400);
  try {
    const { user, token } = await login(c.env, email, password);
    return c.json({ user, token });
  } catch (e: any) {
    return c.json({ error: e.message }, 401);
  }
});

app.get("/api/me", requireAuth, async (c) => {
  const user = c.get("user");
  return c.json({ id: user.id, email: user.email, is_admin: !!user.is_admin, plan: user.plan, free_trial_used: !!user.free_trial_used });
});

// ---------------------------------------------------------------------------
// BYOK provider keys — "Multiple Choice" UI hits this to store whichever
// one the user picked. Required: google_places. Optional smart layer:
// exactly one of gemini / openai / anthropic. Optional extra: hunter.
// ---------------------------------------------------------------------------

const VALID_PROVIDERS: Provider[] = ["google_places", "hunter", "gemini", "openai", "anthropic"];

app.post("/api/keys", requireAuth, async (c) => {
  const user = c.get("user");
  const { provider, key } = await c.req.json<{ provider: Provider; key: string }>();
  if (!VALID_PROVIDERS.includes(provider)) return c.json({ error: "Unknown provider." }, 400);
  if (!key?.trim()) return c.json({ error: "Key is required." }, 400);

  try {
    const { ciphertext, iv } = await encryptSecret(key.trim(), c.env.ENCRYPTION_KEY);
    await upsertProviderKey(c.env.DB, user.id, provider, ciphertext, iv);
    return c.json({ ok: true, provider });
  } catch (e: any) {
    return c.json({ error: e.message ?? "Couldn't save that key — try again." }, 500);
  }
});

app.get("/api/keys", requireAuth, async (c) => {
  const configured = await listConfiguredProviders(c.env.DB, c.get("user").id);
  return c.json({
    configured,
    required: ["google_places"],
    smart_layer_choices: ["gemini", "openai", "anthropic"], // the "multiple choice, any one" set
  });
});

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

app.post("/api/jobs", requireAuth, async (c) => {
  const user = c.get("user");

  if (user.plan === "free" && user.free_trial_used) {
    return c.json({ error: "Free trial already used. Upgrade to run another search.", upgrade_required: true }, 402);
  }

  const body = await c.req.json<{
    keyword?: string; location?: string; maxResults?: number;
    runEnrichment?: boolean; llmProvider?: "gemini" | "openai" | "anthropic";
    freeformGoal?: string; // "smart prompt" mode — needs an llmProvider key configured
  }>();

  let keyword = body.keyword ?? "";
  let location = body.location ?? "";

  if (body.freeformGoal) {
    if (!body.llmProvider) return c.json({ error: "Pick an AI provider to use smart-prompt mode." }, 400);
    const keyRow = await getProviderKeyOrFail(c, body.llmProvider);
    if ("error" in keyRow) return keyRow.error;
    const parsed = await parseFreeformGoal(body.llmProvider, keyRow.key, body.freeformGoal);
    keyword = parsed.keyword;
    location = parsed.location;
  }

  if (!keyword.trim()) return c.json({ error: "A keyword (or a free-form goal) is required." }, 400);

  const jobId = await createJob(c.env.DB, user.id, {
    keyword, location,
    maxResults: Math.min(body.maxResults ?? 20, 60),
    runEnrichment: body.runEnrichment ?? true,
    llmProvider: body.llmProvider,
  });

  if (user.plan === "free") await markFreeTrialUsed(c.env.DB, user.id);

  c.executionCtx.waitUntil(runJob(c.env, jobId, user.id));
  return c.json({ jobId });
});

app.get("/api/jobs/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const job = await getJob(c.env.DB, c.req.param("id") ?? "", user.id);
  if (!job) return c.json({ error: "Job not found." }, 404);
  const leads = await getLeadsForJob(c.env.DB, job.id, user.id);
  return c.json({ job, leads });
});

app.get("/api/jobs/:id/export.csv", requireAuth, async (c) => {
  const user = c.get("user");
  const job = await getJob(c.env.DB, c.req.param("id") ?? "", user.id);
  if (!job) return c.json({ error: "Job not found." }, 404);
  const leads = await getLeadsForJob(c.env.DB, job.id, user.id);

  const rows = leads.map((l) => [
    l.business_name, l.sector, l.address, l.phone, l.website, l.email,
    l.facebook, l.instagram, l.linkedin, l.rating, l.review_count,
    l.lead_score, l.maps_link, l.collected_at,
  ]);
  const csv = [LEAD_HEADER_ROW, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  // Not retained after this response — see README on the CSV/PDF-vs-Sheets choice.
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="smartleadgen_${job.id}.csv"`,
    },
  });
});

// ---------------------------------------------------------------------------
// Google Sheets — single connected account model (see lib/sheets.ts)
// ---------------------------------------------------------------------------

app.post("/api/sheet-connection", requireAuth, async (c) => {
  const { sheetUrl } = await c.req.json<{ sheetUrl: string }>();
  if (!sheetUrl?.trim()) return c.json({ error: "Sheet URL is required." }, 400);
  await setSheetConnection(c.env.DB, c.get("user").id, sheetUrl.trim());
  return c.json({
    ok: true,
    reminder: "Make sure support@sayadbayezid.com has Editor access on this sheet, or pushes will fail.",
  });
});

app.post("/api/jobs/:id/push-to-sheet", requireAuth, async (c) => {
  const user = c.get("user");
  const job = await getJob(c.env.DB, c.req.param("id") ?? "", user.id);
  if (!job) return c.json({ error: "Job not found." }, 404);

  const connection = await getSheetConnection(c.env.DB, user.id);
  if (!connection) return c.json({ error: "Add your Google Sheet URL first (POST /api/sheet-connection)." }, 400);

  const leads = await getLeadsForJob(c.env.DB, job.id, user.id);
  try {
    await appendLeadsToSheet(c.env, connection.sheet_url, leads, connection.worksheet_name);
    return c.json({ ok: true, pushed: leads.length });
  } catch (e: any) {
    return c.json({ error: e.message }, 502);
  }
});

// ---------------------------------------------------------------------------
// Admin — you only. Cross-user visibility lives ONLY here.
// ---------------------------------------------------------------------------

app.get("/api/admin/users", requireAuth, requireAdmin, async (c) => {
  return c.json({ users: await adminListUsers(c.env.DB) });
});

app.get("/api/admin/jobs", requireAuth, requireAdmin, async (c) => {
  return c.json({ jobs: await adminListJobs(c.env.DB) });
});

// ---------------------------------------------------------------------------

async function getProviderKeyOrFail(c: any, provider: "gemini" | "openai" | "anthropic") {
  const row = await getProviderKey(c.env.DB, c.get("user").id, provider);
  if (!row) return { error: c.json({ error: `No ${provider} key configured.` }, 400) };
  const key = await decryptSecret(row.encrypted_key, row.iv, c.env.ENCRYPTION_KEY);
  return { key };
}

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || "Something went wrong on the server." }, 500);
});

export default app;
