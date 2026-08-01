/**
 * Runs one full job end to end. Called via `ctx.waitUntil()` right after
 * the job row is created, so the API responds immediately with a job id
 * and the frontend polls GET /api/jobs/:id for live progress — the
 * "start to complete timing / loading" dashboard requirement.
 *
 * Scale note: this processes leads one at a time in a single Worker
 * invocation, which is fine for the free-trial / early-paid volumes this
 * is designed for. If a batch job (60 results, enrichment on) starts
 * bumping into Workers' execution-time limits, the natural next step is
 * moving this same function into a Cloudflare Queues consumer — one
 * message per lead instead of one big loop — without changing the logic
 * itself. Worth revisiting once real usage data exists.
 */
import type { Env } from "../types";
import { buildQuery, searchAllPages, PlacesAPIError } from "./places";
import { enrichWebsite } from "./enrich";
import { isValidBusinessName, makeDedupKey, normalizePhone, pickPrimaryType, scoreLead } from "./validate";
import { insertLeadIfNew, updateJobStatus, getProviderKey } from "./db";
import { decryptSecret } from "./crypto";

export async function runJob(env: Env, jobId: string, userId: string) {
  const job = await env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(jobId).first<any>();
  if (!job) return;

  await updateJobStatus(env.DB, jobId, { status: "running", started_at: new Date().toISOString() });

  try {
    const placesKeyRow = await getProviderKey(env.DB, userId, "google_places");
    if (!placesKeyRow) throw new PlacesAPIError("No Google Places API key configured for this account.");
    let placesApiKey: string;
    try {
      placesApiKey = await decryptSecret(placesKeyRow.encrypted_key, placesKeyRow.iv, env.ENCRYPTION_KEY);
    } catch (e: any) {
      // Most common cause: ENCRYPTION_KEY was set, a key was saved with it,
      // then ENCRYPTION_KEY got set AGAIN (e.g. the setup command re-run) to
      // a different value — old encrypted data no longer decrypts with it.
      throw new PlacesAPIError(
        `${e.message} If ENCRYPTION_KEY is fine, your saved Google Places key may have been ` +
        `encrypted with a since-replaced value — re-enter and save it again, then retry.`
      );
    }

    const query = buildQuery(job.keyword, job.location);
    let processed = 0;

    for await (const place of searchAllPages(placesApiKey, query, job.max_results)) {
      processed += 1;
      await updateJobStatus(env.DB, jobId, { progress_current: processed });

      const name = place.displayName?.text ?? "";
      const dedupKey = makeDedupKey(place);
      if (!dedupKey || !isValidBusinessName(name)) continue;

      const rawPhone = place.nationalPhoneNumber || place.internationalPhoneNumber || "";
      const { e164 } = normalizePhone(rawPhone, "BD");

      const website = place.websiteUri ?? "";
      const enrichment = job.run_enrichment && website
        ? await enrichWebsite(website)
        : { email: null, socials: {} as Record<string, string> };

      const leadScore = scoreLead(place, enrichment);

      await insertLeadIfNew(env.DB, {
        job_id: jobId,
        user_id: userId,
        dedup_key: dedupKey,
        business_name: name,
        sector: pickPrimaryType(place.types).replace(/_/g, " "),
        address: place.formattedAddress ?? "",
        phone: e164 ?? rawPhone,
        website,
        email: enrichment.email ?? "",
        facebook: enrichment.socials.facebook ?? "",
        instagram: enrichment.socials.instagram ?? "",
        linkedin: enrichment.socials.linkedin ?? "",
        rating: place.rating ?? null,
        review_count: place.userRatingCount ?? null,
        lead_score: leadScore,
        maps_link: place.googleMapsUri ?? "",
      });
    }

    await updateJobStatus(env.DB, jobId, { status: "done", completed_at: new Date().toISOString() });
  } catch (err: any) {
    await updateJobStatus(env.DB, jobId, {
      status: "error",
      error_message: err?.message ?? "Unknown error",
      completed_at: new Date().toISOString(),
    });
  }
}
