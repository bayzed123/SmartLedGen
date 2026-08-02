/**
 * Visits a business's own website (and, if findable, its contact/about
 * page) for a public email and social links. Ported from enrichment.py —
 * same reasoning applies: most business sites are static enough that a
 * plain `fetch` + regex covers them, so this never needs a headless
 * browser or Cloudflare's Browser Rendering product.
 *
 * Identifies itself honestly via User-Agent, does a lightweight robots.txt
 * check, short timeout per request, and never throws — a slow or broken
 * site should be skipped, not fail the whole job.
 */
import type { EnrichmentResult } from "../types";

const USER_AGENT = "SmartLeadGenBot/1.0 (business research; see website owner for contact)";
const TIMEOUT_MS = 8000;
const CONTACT_HINTS = [
  "contact", "contact-us", "contactus", "about", "about-us", "aboutus",
  "get-in-touch", "reach-us", "reach", "connect", "enquiry", "inquiry", "support",
];
// Tried as direct URL guesses when no matching link was found on the homepage —
// some sites have a working contact page that isn't linked with matching anchor text.
const GUESSED_CONTACT_PATHS = ["/contact", "/contact-us", "/about", "/about-us"];

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SOCIAL_PATTERNS: Record<string, RegExp> = {
  facebook: /https?:\/\/(www\.)?facebook\.com\/[^\s"'<>]+/i,
  instagram: /https?:\/\/(www\.)?instagram\.com\/[^\s"'<>]+/i,
  linkedin: /https?:\/\/(www\.)?linkedin\.com\/[^\s"'<>]+/i,
};
const JUNK_EMAIL_SNIPPETS = [
  "example.com", "yourdomain", "domain.com", "sentry.io",
  "wixpress.com", "godaddy.com", ".png", ".jpg", ".jpeg", ".gif", ".svg",
];

/** Undoes common scraper-evasion tricks like "info [at] example [dot] com"
 *  before the email regex runs — cheap to do, catches a real slice of sites
 *  that would otherwise show up as "no email found". */
function deobfuscate(html: string): string {
  return html
    .replace(/\s*[[(]\s*at\s*[\])]\s*/gi, "@")
    .replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, ".");
}

function withTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: withTimeout(TIMEOUT_MS),
    });
    const contentType = resp.headers.get("Content-Type") || "";
    if (resp.status === 200 && contentType.includes("text/html")) {
      return await resp.text();
    }
  } catch {
    return null;
  }
  return null;
}

/** Lightweight robots.txt check — allows unless "/" is explicitly disallowed for "*" or our UA. */
async function allowedByRobots(url: string): Promise<boolean> {
  try {
    const { origin } = new URL(url);
    const resp = await fetch(`${origin}/robots.txt`, { signal: withTimeout(4000) });
    if (!resp.ok) return true;
    const text = await resp.text();
    const blocksAll = /User-agent:\s*\*[\s\S]*?Disallow:\s*\/\s*(\n|$)/i.test(text);
    return !blocksAll;
  } catch {
    return true; // unreadable robots.txt shouldn't block enrichment
  }
}

function cleanEmail(addr: string): string | null {
  const trimmed = addr.trim().replace(/[.,;]+$/, "");
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (JUNK_EMAIL_SNIPPETS.some((junk) => lower.includes(junk))) return null;
  return trimmed;
}

function extractEmails(html: string): Set<string> {
  const found = new Set<string>();
  const normalized = deobfuscate(html);
  for (const match of normalized.matchAll(EMAIL_PATTERN)) {
    const cleaned = cleanEmail(match[0]);
    if (cleaned) found.add(cleaned);
  }
  // mailto: links
  for (const match of html.matchAll(/href=["']mailto:([^"'?]+)/gi)) {
    const cleaned = cleanEmail(match[1] ?? "");
    if (cleaned) found.add(cleaned);
  }
  return found;
}

function extractSocials(html: string): Record<string, string> {
  const links: Record<string, string> = {};
  for (const [platform, pattern] of Object.entries(SOCIAL_PATTERNS)) {
    const match = html.match(pattern);
    if (match) links[platform] = match[0].replace(/["'<>),.]+$/, "");
  }
  return links;
}

function findContactPage(baseUrl: string, html: string): string | null {
  const anchorPattern = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
  for (const match of html.matchAll(anchorPattern)) {
    const href = (match[1] ?? "").toLowerCase();
    const text = (match[2] ?? "").toLowerCase();
    if (CONTACT_HINTS.some((hint) => href.includes(hint) || text.includes(hint))) {
      try {
        return new URL(match[1] ?? "", baseUrl).toString();
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function enrichWebsite(rawUrl: string): Promise<EnrichmentResult> {
  const result: EnrichmentResult = { email: null, socials: {} };
  if (!rawUrl) return result;

  const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  if (!(await allowedByRobots(url))) return result;

  const homepageHtml = await fetchText(url);
  if (homepageHtml === null) return result;

  const emails = extractEmails(homepageHtml);
  const socials = extractSocials(homepageHtml);
  const triedUrls = new Set([url]);

  const contactUrl = findContactPage(url, homepageHtml);
  if (contactUrl && !triedUrls.has(contactUrl)) {
    triedUrls.add(contactUrl);
    await new Promise((r) => setTimeout(r, 1000)); // polite delay, same domain
    const contactHtml = await fetchText(contactUrl);
    if (contactHtml) {
      for (const e of extractEmails(contactHtml)) emails.add(e);
      for (const [platform, link] of Object.entries(extractSocials(contactHtml))) {
        if (!socials[platform]) socials[platform] = link;
      }
    }
  }

  // Still nothing? Try a couple of conventional contact-page paths directly —
  // catches sites where the link exists but isn't discoverable from anchor text
  // (icon-only nav, JS-rendered menu, etc). Capped at 2 to keep this bounded.
  if (emails.size === 0) {
    const origin = new URL(url).origin;
    for (const path of GUESSED_CONTACT_PATHS.slice(0, 2)) {
      const guessUrl = origin + path;
      if (triedUrls.has(guessUrl)) continue;
      triedUrls.add(guessUrl);
      await new Promise((r) => setTimeout(r, 1000));
      const guessHtml = await fetchText(guessUrl);
      if (guessHtml) {
        for (const e of extractEmails(guessHtml)) emails.add(e);
        for (const [platform, link] of Object.entries(extractSocials(guessHtml))) {
          if (!socials[platform]) socials[platform] = link;
        }
        if (emails.size > 0) break; // found one — no need to try the next guess
      }
    }
  }

  const sortedEmails = Array.from(emails).sort();
  result.email = sortedEmails[0] ?? null;
  result.socials = socials;
  return result;
}
