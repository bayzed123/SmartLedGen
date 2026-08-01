/**
 * Replaces backend/sheets_writer.py's per-user service-account-JSON model
 * (the exact friction point that was causing the "keno service account
 * submit korte bole" complaint) with a single OAuth-connected account:
 * sayadmdbayezidhosan@gmail.com. A user just shares their own Sheet with
 * that email as Editor — no Google Cloud project, no JSON file, on their end.
 *
 * One-time setup (you only, not per-user) — see README section
 * "Connecting sayadmdbayezidhosan@gmail.com" for the exact console steps
 * to get GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN.
 */
import type { Env, LeadRow } from "../types";
import { LEAD_HEADER_ROW } from "../types";

export class SheetsError extends Error {}

let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getAccessToken(env: Env): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    throw new SheetsError(
      "Google Sheets isn't connected yet — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / " +
        "GOOGLE_REFRESH_TOKEN aren't set. Users can still use CSV export in the meantime."
    );
  }

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
    }),
  });
  if (!resp.ok) throw new SheetsError(`Couldn't refresh Google access token (${resp.status}).`);
  const data = (await resp.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

function extractSpreadsheetId(sheetUrlOrId: string): string {
  const match = sheetUrlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] ?? sheetUrlOrId;
}

function leadToRow(lead: LeadRow): string[] {
  return [
    lead.business_name, lead.sector, lead.address, lead.phone, lead.website,
    lead.email, lead.facebook, lead.instagram, lead.linkedin,
    String(lead.rating ?? ""), String(lead.review_count ?? ""),
    lead.lead_score, lead.maps_link, lead.collected_at,
  ];
}

async function ensureHeaderRow(accessToken: string, spreadsheetId: string, worksheet: string) {
  const readResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${worksheet}!A1:N1`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (readResp.status === 400 || readResp.status === 404) {
    throw new SheetsError(
      `Couldn't find a "${worksheet}" tab in that sheet, or the sheet ID/URL is wrong.`
    );
  }
  if (readResp.status === 403) {
    throw new SheetsError(
      "Access denied. Make sure sayadmdbayezidhosan@gmail.com has been added as an Editor on this sheet."
    );
  }
  const data = (await readResp.json()) as { values?: string[][] };
  if (!data.values || data.values.length === 0) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${worksheet}!A1:append?valueInputOption=USER_ENTERED`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: [LEAD_HEADER_ROW] }),
      }
    );
  }
}

export async function appendLeadsToSheet(
  env: Env,
  sheetUrlOrId: string,
  leads: LeadRow[],
  worksheet = "Leads"
): Promise<void> {
  if (leads.length === 0) return;
  const accessToken = await getAccessToken(env);
  const spreadsheetId = extractSpreadsheetId(sheetUrlOrId);

  await ensureHeaderRow(accessToken, spreadsheetId, worksheet);

  const resp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${worksheet}!A1:append?valueInputOption=USER_ENTERED`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: leads.map(leadToRow) }),
    }
  );
  if (!resp.ok) {
    throw new SheetsError(`Sheets append failed (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
  }
}
