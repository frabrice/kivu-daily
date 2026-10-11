import Anthropic from "npm:@anthropic-ai/sdk";
import { cached, Ctx, rows } from "./core.ts";
import { loadDrivers } from "./drivers.ts";
import { buildMask, Mask } from "./mask.ts";

export type { Mask };

// Short AI-written text (the "Your day" focus line) from any of three
// providers, tried in order: Gemini, Groq, Claude. Each is used only when
// its key is set as a function secret (GEMINI_API_KEY, GROQ_API_KEY,
// ANTHROPIC_API_KEY); AI_PROVIDERS="groq,gemini" changes the order.
// GEMINI_MODEL / GROQ_MODEL override the default models.
//
// Privacy: before anything leaves Kivu Daily, every staff, driver and
// partner-driver name becomes a code ("Person A", "Driver B"), phone
// numbers are removed and plates become "Car C". The codes are swapped
// back in our own code afterwards, so providers never see who anyone is.

const SECRET = (k: string) => Deno.env.get(k)?.trim() || null;

type Provider = "gemini" | "groq" | "claude";
const KEY: Record<Provider, string> = { gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY", claude: "ANTHROPIC_API_KEY" };

export function aiConfigured(): boolean {
  return (["gemini", "groq", "claude"] as Provider[]).some((p) => SECRET(KEY[p]));
}

async function knownNames(ctx: Ctx): Promise<{ name: string; kind: "Person" | "Driver" }[]> {
  const partner = await cached(ctx, "platform_driver_names", () => rows<{ full_name: string }>(ctx.db.from("platform_drivers").select("full_name")));
  const drivers = await loadDrivers(ctx);
  return [
    ...ctx.profiles.map((p) => ({ name: p.full_name, kind: "Person" as const })),
    ...drivers.map((d) => ({ name: d.full_name, kind: "Driver" as const })),
    ...partner.map((d) => ({ name: d.full_name, kind: "Driver" as const })),
  ].filter((x) => x.name?.trim());
}

export async function makeMask(ctx: Ctx): Promise<Mask> {
  return buildMask(await knownNames(ctx));
}

// ------------------------------------------------------------ providers
async function gemini(key: string, system: string, user: string): Promise<string | null> {
  const model = SECRET("GEMINI_MODEL") ?? "gemini-flash-latest";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.4 },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json() as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  return body.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join(" ").trim() || null;
}

async function groq(key: string, system: string, user: string): Promise<string | null> {
  const model = SECRET("GROQ_MODEL") ?? "openai/gpt-oss-120b";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, max_tokens: 2048, temperature: 0.4, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json() as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content?.trim() || null;
}

async function claude(key: string, system: string, user: string): Promise<string | null> {
  const client = new Anthropic({ apiKey: key, timeout: 25_000, maxRetries: 1 });
  const res = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 2000,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: user }],
  } as unknown as Parameters<typeof client.beta.messages.create>[0]) as Anthropic.Beta.BetaMessage;
  if (res.stop_reason === "refusal") return null;
  return res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join(" ").trim() || null;
}

const CALL: Record<Provider, (key: string, system: string, user: string) => Promise<string | null>> = { gemini, groq, claude };

// Returns { text, provider } from the first provider that answers and
// passes `accept` (checked on the masked text), or null.
export async function writeText(system: string, user: string, accept: (text: string) => boolean): Promise<{ text: string; provider: Provider } | null> {
  const order = (SECRET("AI_PROVIDERS") ?? "gemini,groq,claude").split(",").map((s) => s.trim().toLowerCase()).filter((s): s is Provider => s in KEY);
  for (const provider of order) {
    const key = SECRET(KEY[provider]);
    if (!key) continue;
    try {
      const text = (await CALL[provider](key, system, user))?.replace(/\s+/g, " ").replace(/[*_#`]/g, "").trim();
      if (text && accept(text)) return { text, provider };
      console.warn(`ai text: ${provider} answer rejected`);
    } catch (err) {
      console.error(`ai text: ${provider} failed`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}
