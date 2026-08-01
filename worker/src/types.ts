export type Provider = "google_places" | "hunter" | "gemini" | "openai" | "anthropic";

// The three "smart layer" providers a user picks ONE of — for query
// understanding and (later) AI-drafted outreach email copy. This is
// separate from google_places, which stays the required, dedicated data
// source because it's what actually returns real business data reliably.
export type LlmProvider = "gemini" | "openai" | "anthropic";

export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  AI: Ai; // Workers AI — free, no external key needed; powers the support chatbot

  ADMIN_EMAIL: string;
  FREE_TRIAL_RUNS: string;

  // Secrets — set with `wrangler secret put <NAME>`, never in wrangler.jsonc
  ENCRYPTION_KEY: string; // base64, 32 bytes, for AES-GCM
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string; // one-time OAuth grant for support@sayadbayezid.com
  SUPPORT_CHATBOT_API_KEY?: string; // your own Anthropic key — powers the public support chatbot only
}

export interface AuthedUser {
  id: string;
  email: string;
  is_admin: number;
  free_trial_used: number;
  plan: string;
}

export interface PlaceResult {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  googleMapsUri?: string;
}

export interface EnrichmentResult {
  email: string | null;
  socials: Record<string, string>;
}

export interface LeadRow {
  id: string;
  job_id: string;
  user_id: string;
  dedup_key: string;
  business_name: string;
  sector: string;
  address: string;
  phone: string;
  website: string;
  email: string;
  facebook: string;
  instagram: string;
  linkedin: string;
  rating: number | null;
  review_count: number | null;
  lead_score: string;
  maps_link: string;
  collected_at: string;
}

export const LEAD_HEADER_ROW = [
  "Business Name", "Sector/Category", "Address", "Phone", "Website",
  "Email", "Facebook", "Instagram", "LinkedIn", "Rating", "Reviews",
  "Lead Score", "Google Maps Link", "Date Collected",
];
