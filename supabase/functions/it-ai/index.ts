import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildMask, Mask } from "../notifications-run/mask.ts";

// AI help for IT & Product (phase 4). Three jobs, each returning JSON:
//   draft_issue    a rough request -> title, description, type, priority,
//                  size, areas and acceptance criteria
//   week_summary   the weekly review numbers -> highlights, risks, focus
//   explain_error  a Sentry error -> plain explanation, likely area, steps
// Uses the same providers and keys as the "Your day" line (GEMINI_API_KEY,
// GROQ_API_KEY, ANTHROPIC_API_KEY; order from AI_PROVIDERS). Names of
// staff and drivers, phone numbers and plates are swapped for codes
// before anything leaves Kivu Daily and swapped back afterwards.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const SECRET = (k: string) => Deno.env.get(k)?.trim() || null;
type Provider = "gemini" | "groq" | "claude";
const KEY: Record<Provider, string> = { gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY", claude: "ANTHROPIC_API_KEY" };
const providers = () => (SECRET("AI_PROVIDERS") ?? "gemini,groq,claude").split(",").map((s) => s.trim().toLowerCase()).filter((s): s is Provider => s in KEY && !!SECRET(KEY[s as Provider]));
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

const PRODUCT = "Kivu Ride is an electric ride-hailing company in Kigali, Rwanda. It has one mobile app with a rider side and a driver side, a backend/API, an admin panel, a website and Kivu Daily (the staff dashboard). The IT team is small: a head of IT (CTO), developers and the MD.";

// ------------------------------------------------------------ providers
async function gemini(key: string, system: string, user: string): Promise<string | null> {
  const model = SECRET("GEMINI_MODEL") ?? "gemini-flash-latest";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { maxOutputTokens: 4096, temperature: 0.3, responseMimeType: "application/json" } }),
    signal: AbortSignal.timeout(40_000),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json() as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  return body.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim() || null;
}
async function groq(key: string, system: string, user: string): Promise<string | null> {
  const model = SECRET("GROQ_MODEL") ?? "openai/gpt-oss-120b";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, max_tokens: 4096, temperature: 0.3, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(40_000),
  });
  if (!res.ok) throw new Error(`groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json() as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content?.trim() || null;
}
async function claude(key: string, system: string, user: string, schema: Json): Promise<string | null> {
  const client = new Anthropic({ apiKey: key, timeout: 40_000, maxRetries: 1 });
  const res = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  } as unknown as Parameters<typeof client.messages.create>[0]) as Anthropic.Message;
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return null;
  return res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim() || null;
}

async function ask(system: string, user: string, schema: Json, check: (x: Json) => boolean): Promise<{ data: Json; provider: Provider } | null> {
  const sys = `${system}\n\nAnswer with one JSON object only, matching this JSON schema:\n${JSON.stringify(schema)}`;
  for (const p of providers()) {
    try {
      const text = p === "claude" ? await claude(SECRET(KEY[p])!, system, user, schema) : await (p === "gemini" ? gemini : groq)(SECRET(KEY[p])!, sys, user);
      if (!text) continue;
      const data = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Json;
      if (check(data)) return { data, provider: p };
      console.warn(`it-ai: ${p} answer did not match`);
    } catch (e) {
      console.error(`it-ai: ${p} failed`, e instanceof Error ? e.message : e);
    }
  }
  return null;
}

const obj = (properties: Json) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const str = { type: "string" };
const strs = { type: "array", items: { type: "string" } };
const deep = (x: unknown, f: (s: string) => string): unknown => typeof x === "string" ? f(x) : Array.isArray(x) ? x.map((v) => deep(v, f)) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, deep(v, f)])) : x;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: member } = await user.rpc("is_it_member");
  if (member !== true) return json({ error: "Only IT can use AI help here" }, 403);
  const body = await req.json().catch(() => ({})) as Json;
  if (body.action === "status") return json({ configured: providers().length > 0, providers: providers() });
  if (!providers().length) return json({ error: "AI help isn't connected yet: add a GEMINI_API_KEY, GROQ_API_KEY or ANTHROPIC_API_KEY function secret." }, 400);

  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const [{ data: profiles }, { data: drivers }, { data: partners }, { data: areas }] = await Promise.all([
    db.from("profiles").select("full_name"), db.from("drivers").select("full_name"), db.from("platform_drivers").select("full_name"), db.from("it_areas").select("key, label, hint").order("sort"),
  ]);
  const mask: Mask = buildMask([
    ...((profiles ?? []) as Json[]).map((p) => ({ name: p.full_name, kind: "Person" })),
    ...((drivers ?? []) as Json[]).map((d) => ({ name: d.full_name, kind: "Driver" })),
    ...((partners ?? []) as Json[]).map((d) => ({ name: d.full_name, kind: "Driver" })),
  ].filter((x) => x.name?.trim()));
  const areaKeys = ((areas ?? []) as Json[]).map((a) => a.key as string);
  const areaList = ((areas ?? []) as Json[]).map((a) => `${a.key}: ${a.label}${a.hint ? ` (${a.hint})` : ""}`).join("\n");
  const hide = (s: unknown) => mask.hide(String(s ?? "").slice(0, 6000));

  let result: { data: Json; provider: Provider } | null = null;
  if (body.action === "draft_issue") {
    const schema = obj({
      title: str, description: str,
      type: { type: "string", enum: ["feature", "bug", "improvement", "tech_debt", "research", "chore"] },
      priority: { type: "string", enum: ["p0", "p1", "p2", "p3"] },
      size: { type: "string", enum: ["xs", "s", "m", "l", "xl"] },
      areas: { type: "array", items: { type: "string", enum: areaKeys } },
      acceptance_criteria: strs,
    });
    result = await ask(
      `${PRODUCT}\n\nYou turn a rough request into a clear issue for the IT board. Title: short, starts with a verb, plain English. Description: what is wrong or needed and why it matters to riders, drivers or staff, in 2-5 sentences; keep any facts given, invent none. Acceptance criteria: 2-6 checkable statements of what is true when it's done. Priority: p0 only if riders, drivers or money are broken right now; p1 needed soon; p2 normal; p3 nice to have. Size: xs hours, s a day, m 2-3 days, l a week, xl more. Areas (pick 1-3 keys):\n${areaList}`,
      `Request:\n${hide(body.text)}${body.context ? `\n\nContext:\n${hide(body.context)}` : ""}`,
      schema, (x) => typeof x.title === "string" && x.title.length > 2 && Array.isArray(x.acceptance_criteria),
    );
    if (result) result.data.areas = (result.data.areas ?? []).filter((a: string) => areaKeys.includes(a));
  } else if (body.action === "week_summary") {
    result = await ask(
      `${PRODUCT}\n\nYou draft the notes for the weekly IT review meeting from the facts given. Write short bullet lines starting with "- ", plain English, no jargon, at most 5 per field. Highlights: what shipped that matters to riders, drivers or the business. Risks: what slowed the team, what may slip, what needs a decision or help (use the numbers: late milestones, blocked or stalled work, bugs reported vs fixed, people with nothing in progress, unanswered check-ins). Next focus: the 2-3 most important things for next week. Only use the facts given.`,
      `Facts for the week:\n${hide(JSON.stringify(body.facts ?? {}))}`,
      obj({ highlights: str, risks: str, next_focus: str }), (x) => typeof x.highlights === "string" && typeof x.risks === "string",
    );
  } else if (body.action === "explain_error") {
    result = await ask(
      `${PRODUCT}\n\nYou explain an error from Sentry to a small IT team in plain English: what probably happens, who notices it (riders, drivers, staff) and how bad it is. Then the area it most likely belongs to (one key, or "" if unclear), a short issue title, and 2-4 first steps to investigate. Be honest when the information is not enough. Areas:\n${areaList}`,
      `Error:\n${hide(JSON.stringify(body.error ?? {}))}`,
      obj({ explanation: str, likely_area: str, suggested_title: str, first_steps: strs }), (x) => typeof x.explanation === "string",
    );
    if (result && !areaKeys.includes(result.data.likely_area)) result.data.likely_area = "";
  } else {
    return json({ error: "Unknown action" }, 400);
  }
  if (!result) return json({ error: "The AI didn't give a usable answer. Try again in a moment." }, 502);
  return json({ ...(deep(result.data, mask.show) as Json), provider: result.provider });
});
