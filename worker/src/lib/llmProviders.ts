/**
 * The "any one of Gemini / OpenAI / Anthropic" BYOK key the user picks in
 * the UI powers THIS layer — query understanding today (turning a
 * free-form goal into a keyword + location), and AI-drafted outreach
 * copy once the email-automation module (Phase 4) is built.
 *
 * It is deliberately NOT the core lead-finding data source — Google
 * Places API stays required and separate for that, because it returns
 * real, structured business data reliably; an LLM alone is the wrong
 * tool for "find real businesses matching X" (see README).
 *
 * Model names below are reasonable current defaults, not guarantees —
 * check each provider's docs before relying on one long-term, since
 * these change over time:
 *   https://ai.google.dev/gemini-api/docs/models
 *   https://platform.openai.com/docs/models
 *   https://docs.claude.com/en/docs/about-claude/models
 */
import type { LlmProvider } from "../types";

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  gemini: "gemini-2.0-flash",
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
};

export class LlmProviderError extends Error {}

/** One-shot text completion — provider-agnostic. `apiKey` is the user's
 *  own decrypted key; it is used for this single call and never logged. */
export async function callLlm(
  provider: LlmProvider,
  apiKey: string,
  prompt: string,
  opts: { model?: string; maxTokens?: number } = {}
): Promise<string> {
  const maxTokens = opts.maxTokens ?? 512;

  if (provider === "openai") {
    const model = opts.model ?? DEFAULT_MODELS.openai;
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) throw new LlmProviderError(`OpenAI error (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
    const data = (await resp.json()) as any;
    return data.choices?.[0]?.message?.content ?? "";
  }

  if (provider === "gemini") {
    const model = opts.model ?? DEFAULT_MODELS.gemini;
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    if (!resp.ok) throw new LlmProviderError(`Gemini error (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
    const data = (await resp.json()) as any;
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  if (provider === "anthropic") {
    const model = opts.model ?? DEFAULT_MODELS.anthropic;
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) throw new LlmProviderError(`Anthropic error (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
    const data = (await resp.json()) as any;
    return data.content?.[0]?.text ?? "";
  }

  throw new LlmProviderError(`Unsupported provider: ${provider}`);
}

/** "Smart prompt" mode: turn a free-form goal into {keyword, location}. */
export async function parseFreeformGoal(
  provider: LlmProvider,
  apiKey: string,
  goal: string
): Promise<{ keyword: string; location: string }> {
  const prompt =
    `Extract a business-type keyword and a location from this lead-generation goal. ` +
    `Reply with ONLY compact JSON like {"keyword":"...","location":"..."} and nothing else.\n\nGoal: ${goal}`;
  const raw = await callLlm(provider, apiKey, prompt, { maxTokens: 100 });
  try {
    const cleaned = raw.trim().replace(/^```json\s*|\s*```$/g, "");
    const parsed = JSON.parse(cleaned);
    return { keyword: parsed.keyword ?? "", location: parsed.location ?? "" };
  } catch {
    throw new LlmProviderError("Couldn't parse a keyword/location from that goal — try phrasing it more directly.");
  }
}
