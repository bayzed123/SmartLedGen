/**
 * Google Places API (New) — ported straight from the working
 * backend/places_api.py. Still no browser anywhere in this chain: it's a
 * plain HTTPS JSON call, which is exactly why it runs cleanly on Workers
 * (unlike the original Playwright-based Maps scraping attempt, which this
 * project had already moved away from before this migration).
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 */
import type { PlaceResult } from "../types";

const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.types",
  "places.googleMapsUri",
].join(",");

const MAX_RESULTS_PER_PAGE = 20;
const MAX_PAGES = 3; // Google's own cap for Text Search (New): ~60 results/query

export class PlacesAPIError extends Error {}

export function buildQuery(keyword: string, location: string): string {
  keyword = (keyword || "").trim();
  location = (location || "").trim();
  return location ? `${keyword} in ${location}` : keyword;
}

async function searchPlaces(
  apiKey: string,
  query: string,
  maxResultCount = 20,
  pageToken?: string
): Promise<{ places: PlaceResult[]; nextPageToken?: string }> {
  if (!apiKey) throw new PlacesAPIError("No Google Places API key configured.");

  const body: Record<string, unknown> = {
    textQuery: query,
    maxResultCount: Math.min(maxResultCount, MAX_RESULTS_PER_PAGE),
  };
  if (pageToken) body.pageToken = pageToken;

  let resp: Response;
  try {
    resp = await fetch(PLACES_TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new PlacesAPIError(`Couldn't reach Google's Places API: ${e}`);
  }

  if (resp.status === 403) {
    throw new PlacesAPIError(
      "Google rejected this request (403). Almost always means Places API (New) isn't " +
        "enabled on the project, billing isn't enabled, or the key is restricted to the wrong APIs."
    );
  }
  if (resp.status === 400) {
    throw new PlacesAPIError(`Google rejected this request as malformed (400): ${(await resp.text()).slice(0, 300)}`);
  }
  if (resp.status === 429) {
    throw new PlacesAPIError("Rate-limited by Google (429) — calling faster than the quota allows.");
  }
  if (resp.status >= 500) {
    throw new PlacesAPIError(`Google's Places API returned a server error (${resp.status}). Try again shortly.`);
  }
  if (!resp.ok) {
    throw new PlacesAPIError(`Places API error: ${resp.status}`);
  }

  const data = (await resp.json()) as { places?: PlaceResult[]; nextPageToken?: string };
  return { places: data.places ?? [], nextPageToken: data.nextPageToken };
}

/** Async generator — yields one place at a time, following nextPageToken up to maxTotal. */
export async function* searchAllPages(apiKey: string, query: string, maxTotal = 60) {
  let collected = 0;
  let pageToken: string | undefined;
  let pageNumber = 0;

  while (collected < maxTotal && pageNumber < MAX_PAGES) {
    if (pageNumber > 0) {
      // Google requires a short delay before a page token becomes valid.
      await new Promise((r) => setTimeout(r, 2000));
    }
    const { places, nextPageToken } = await searchPlaces(apiKey, query, 20, pageToken);
    pageNumber += 1;
    pageToken = nextPageToken;

    for (const place of places) {
      yield place;
      collected += 1;
      if (collected >= maxTotal) return;
    }
    if (!pageToken) return;
  }
}
