/**
 * Sends server-side conversion events to GA4 via the Measurement Protocol —
 * used when an access code is redeemed (a "paid unlock"), so that event is
 * recorded even though it happens on the backend, not in the browser.
 *
 * GA4_API_SECRET is a Measurement Protocol API secret — this is NOT the
 * public Measurement ID (G-XXXX) that goes in the page's gtag.js snippet.
 * It must stay server-side only: set as a Worker secret, never in any
 * client-side file or committed to the repo.
 */
import type { Env } from "../types";

export async function sendGA4Event(
  env: Env,
  clientId: string,
  eventName: string,
  params: Record<string, unknown> = {}
): Promise<void> {
  if (!env.GA4_MEASUREMENT_ID || !env.GA4_API_SECRET) return; // not configured — skip silently

  try {
    await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${env.GA4_MEASUREMENT_ID}&api_secret=${env.GA4_API_SECRET}`,
      {
        method: "POST",
        body: JSON.stringify({
          client_id: clientId,
          events: [{ name: eventName, params }],
        }),
      }
    );
  } catch {
    // Analytics failures should never break the actual feature (code redemption, etc.)
  }
}
