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
  submitReview, getApprovedReviews, adminListReviews, setReviewApproved,
} from "./lib/db";
import { runJob } from "./lib/job";
import { appendLeadsToSheet } from "./lib/sheets";
import { parseFreeformGoal, callLlm } from "./lib/llmProviders";

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

// ---------------------------------------------------------------------------
// Public support chatbot — answers ONLY SmartLeadGen product questions.
// Uses YOUR OWN key (a Worker secret), not any user's BYOK key, since
// visitors asking this haven't signed up yet. Rate-limited per IP so one
// visitor can't run up the API bill.
// ---------------------------------------------------------------------------

const SUPPORT_SYSTEM_PROMPT = `You are the SmartLeadGen support assistant, embedded on the SmartLeadGen marketing site. Answer ONLY questions about the SmartLeadGen product — what it does, how it works, pricing, signing up, API keys, Google Sheets/CSV export, troubleshooting, and account basics. Keep answers to a few short sentences.

Facts about SmartLeadGen:
- Finds potential digital-marketing clients by searching Google's Places API (New) for real businesses, then checks each business's own website for a contact email and social links.
- Requires the user's own Google Places API key (their own Google Cloud project — enable "Places API (New)", their own cost/quota).
- Optionally uses one AI provider key the user supplies (Gemini, OpenAI, or Claude) to turn a plain-English goal into a search, and — soon — to draft outreach emails. This key is separate from the required Places key and never replaces it.
- One free search is included per account; paid pricing is still being finalized (not live yet).
- Leads can be exported as CSV, or pushed to the user's own Google Sheet (they share their Sheet with sayadmdbayezidhosan@gmail.com as Editor first).
- Every user's API keys are encrypted before storage, and each user's data is isolated from other users' — nobody can see another user's leads or keys.
- Built by Sayad Md Bayezid Hosan (sayadbayezid.com).

If a question is unrelated to SmartLeadGen (general knowledge, other products, personal advice, anything else), say briefly that you can only help with SmartLeadGen questions and point to support@sayadbayezid.com or the Help Center for anything else. Never make up a feature, price, or policy that isn't listed above — say it's not finalized yet instead.`;

app.post("/api/support-chat", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  const rateLimitKey = `chatrate:${ip}`;
  const countStr = await c.env.SESSIONS.get(rateLimitKey);
  const count = countStr ? parseInt(countStr, 10) : 0;
  if (count >= 20) {
    return c.json(
      { error: "Too many questions from this connection for now — try again in an hour, or email support@sayadbayezid.com." },
      429
    );
  }

  const { message, history } = await c.req.json<{
    message?: string;
    history?: Array<{ role: string; content: string }>;
  }>();
  if (!message?.trim()) return c.json({ error: "Message is required." }, 400);
  if (message.length > 500) return c.json({ error: "Keep questions under 500 characters." }, 400);

  await c.env.SESSIONS.put(rateLimitKey, String(count + 1), { expirationTtl: 3600 });

  const chatHistory = (history ?? [])
    .slice(-6)
    .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }));

  try {
    // Default: Workers AI (Llama) — free, no external account or key needed,
    // which is why this is the default rather than a paid BYOK provider.
    if (!c.env.SUPPORT_CHATBOT_API_KEY) {
      const result: any = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          { role: "system", content: SUPPORT_SYSTEM_PROMPT },
          ...chatHistory,
          { role: "user", content: message.trim() },
        ],
        max_tokens: 300,
      });
      return c.json({ reply: (result.response ?? "").trim() });
    }

    // Optional override: if you later set SUPPORT_CHATBOT_API_KEY, a paid
    // provider is used instead (e.g. for higher quality than Llama gives).
    const prompt = chatHistory.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
    const fullPrompt = prompt ? `${prompt}\nUser: ${message.trim()}` : message.trim();
    const reply = await callLlm("anthropic", c.env.SUPPORT_CHATBOT_API_KEY, fullPrompt, {
      maxTokens: 300,
      system: SUPPORT_SYSTEM_PROMPT,
    });
    return c.json({ reply: reply.trim() });
  } catch {
    return c.json({ error: "Couldn't reach the AI model right now — try again shortly." }, 502);
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
    reminder: "Make sure sayadmdbayezidhosan@gmail.com has Editor access on this sheet, or pushes will fail.",
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

app.get("/api/admin/reviews", requireAuth, requireAdmin, async (c) => {
  return c.json({ reviews: await adminListReviews(c.env.DB) });
});

app.post("/api/admin/reviews/:id/approve", requireAuth, requireAdmin, async (c) => {
  const { approved } = await c.req.json<{ approved?: boolean }>();
  await setReviewApproved(c.env.DB, c.req.param("id") ?? "", approved !== false);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Reviews — only registered (logged-in) users can submit one; shown on the
// public homepage only after admin approval, to keep the public list honest.
// ---------------------------------------------------------------------------

app.post("/api/reviews", requireAuth, async (c) => {
  const user = c.get("user");
  const { rating, comment } = await c.req.json<{ rating?: number; comment?: string }>();
  if (!rating || rating < 1 || rating > 5) return c.json({ error: "Rating must be 1–5." }, 400);
  if (!comment?.trim()) return c.json({ error: "Please add a short comment with your rating." }, 400);
  await submitReview(c.env.DB, user.id, user.email, rating, comment.trim().slice(0, 500));
  return c.json({ ok: true, note: "Thanks — your review will show publicly once approved." });
});

app.get("/api/reviews", async (c) => {
  return c.json({ reviews: await getApprovedReviews(c.env.DB) });
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
