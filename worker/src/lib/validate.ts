import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { PlaceResult, EnrichmentResult } from "../types";

const JUNK_NAME_MARKERS = ["test listing", "sample business", "n/a", "unknown business"];
const GENERIC_PLACE_TYPES = new Set(["point_of_interest", "establishment"]);

/** Same library family as the Python version's `phonenumbers` package
 *  (both wrap Google's libphonenumber), just the JS port. */
export function normalizePhone(rawPhone: string, defaultRegion = "BD"): { valid: boolean; e164: string | null } {
  if (!rawPhone) return { valid: false, e164: null };
  try {
    const parsed = parsePhoneNumberFromString(rawPhone, defaultRegion as any);
    if (parsed?.isValid()) return { valid: true, e164: parsed.number };
  } catch {
    // fall through
  }
  return { valid: false, e164: null };
}

export function isValidBusinessName(name: string): boolean {
  if (!name?.trim()) return false;
  const lowered = name.toLowerCase();
  return !JUNK_NAME_MARKERS.some((marker) => lowered.includes(marker));
}

export function pickPrimaryType(typesList?: string[]): string {
  const types = typesList ?? [];
  for (const t of types) {
    if (!GENERIC_PLACE_TYPES.has(t)) return t;
  }
  return types[0] ?? "";
}

/** The "smart" part of SmartLeadGen: how promising a lead is for a
 *  digital marketing agency specifically. No website is the strongest
 *  signal; weak online presence is next. */
export function scoreLead(place: PlaceResult, enrichment: EnrichmentResult, isFacebookOnly = false): "High" | "Medium" | "Low" {
  const hasWebsite = Boolean(place.websiteUri) && !isFacebookOnly;
  const rating = place.rating;
  const reviewCount = place.userRatingCount ?? 0;

  if (!hasWebsite) return "High";
  if (!enrichment.email && Object.keys(enrichment.socials).length === 0) return "High";
  if (rating != null && rating < 4.0) return "Medium";
  if (reviewCount < 10) return "Medium";
  return "Low";
}

/** Google's Place ID is a stable unique identifier — preferred over
 *  name/phone matching, which can miss duplicates or merge franchises. */
export function makeDedupKey(place: PlaceResult): string {
  return place.id ?? "";
}
