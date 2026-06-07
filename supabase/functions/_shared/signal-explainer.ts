// ============================================================================
// SIGNAL EXPLAINER — generates a short retail-friendly natural-language
// explanation for a fired signal using Lovable AI Gateway (gemini-flash-lite).
//
// Pure helper. Non-blocking: callers should race this with a short timeout
// and write empty string on any failure. NEVER blocks signal persistence.
// ============================================================================

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash-lite";
const DEFAULT_TIMEOUT_MS = 8000;

export interface ExplainerInput {
  ticker: string;
  side: "long" | "short";
  conviction: number;
  strategy: string;
  profile: string;
  regime: string;
  weeklyBias: string;
  factors: Record<string, unknown>;
}

function getKey(): string | null {
  return Deno.env.get("LOVABLE_API_KEY") ?? null;
}

export function isExplainerConfigured(): boolean {
  return getKey() !== null;
}

/**
 * Generate a 2-3 sentence retail-friendly explanation of why the signal fired.
 * Returns "" on any failure / missing key. Bounded by DEFAULT_TIMEOUT_MS.
 */
export async function explainSignal(
  input: ExplainerInput,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const key = getKey();
  if (!key) return "";

  const sys = `You are a quantitative trading assistant. In 2-3 short sentences, explain to a retail trader why this signal fired. Reference the strongest 2-3 contributing factors in plain English. No emojis, no greetings, no disclaimers, no recommendations — just the rationale. Under 280 chars total.`;

  const user = JSON.stringify({
    ticker: input.ticker,
    side: input.side,
    conviction: input.conviction,
    strategy: input.strategy,
    profile: input.profile,
    regime: input.regime,
    weeklyBias: input.weeklyBias,
    factors: input.factors,
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        temperature: 0.3,
        max_tokens: 160,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) {
      if (r.status !== 429 && r.status !== 402) {
        console.warn(`explainer ${input.ticker} → HTTP ${r.status}`);
      }
      return "";
    }
    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content;
    if (typeof text === "string") return text.trim().slice(0, 400);
    return "";
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof Error && e.name !== "AbortError") {
      console.warn(`explainer ${input.ticker} failed:`, e.message);
    }
    return "";
  }
}
