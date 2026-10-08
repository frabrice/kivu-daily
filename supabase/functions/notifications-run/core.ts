import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { isoWeekday, shiftDay } from "../_shared/depositRules.ts";

// Shared types and helpers for every notification module. A module
// exports a map of rule definitions (scheduled digests or instant
// events); index.ts owns the schedule clock, recipients, outbox and
// sending, so a module only ever decides *what* an email says.

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  role: string;
  is_active: boolean;
  department: { slug: string | null; name: string | null } | null;
}

export interface Recipient { id: string; email: string; name: string }

// Tone colours a stat, an alert box or a whole table row.
export type Tone = "danger" | "warning" | "good" | "info";
// Numeric columns are right-aligned automatically; `align` overrides.
// `tones` highlights rows (same order as `rows`).
// `phoneHide` lists column indexes dropped on narrow phone screens.
export interface Table { head: string[]; rows: string[][]; align?: ("left" | "right" | "center")[]; tones?: (Tone | null)[]; phoneHide?: number[] }
export interface Stat { label: string; value: string; sub?: string; tone?: Tone }
export interface Block { heading?: string; text?: string; table?: Table; stats?: Stat[]; alert?: { tone: Tone; text: string } }

export interface Built {
  subject: string;
  heading: string;
  intro: string;
  // Headline numbers shown as tiles under the intro.
  stats?: Stat[];
  alert?: { tone: Tone; text: string };
  table?: Table;
  blocks?: Block[];
  footnote?: string;
  inApp: string;
  // Personal emails (e.g. "you have unfinished tasks") name their one
  // recipient; everything else goes to the rule's whole audience.
  recipients?: string[];
  // The email's button: a label and a query string for the app, e.g.
  // { label: "Open ticket", query: "ticket=<id>" }. Defaults to the app home.
  cta?: { label: string; query: string };
}

export interface Ctx {
  db: SupabaseClient;
  today: string;
  profiles: Profile[];
  responsibilities: Record<string, string | null>;
  cache: Map<string, Promise<unknown>>;
}

export interface ScheduledRule {
  kind: "scheduled";
  days: number[];          // ISO weekdays, 1 = Monday
  at: number;              // minutes after midnight, Kigali
  when?: (today: string) => boolean;
  // `force` = test send: skip date guards so the MD can preview any day.
  build: (ctx: Ctx, force: boolean) => Promise<Built[]>;
}

export interface EventRule {
  kind: "event";
  build: (payload: Record<string, unknown>, ctx: Ctx) => Promise<Built | null>;
  // A realistic payload from live data, for "Send test to me".
  sample: (ctx: Ctx) => Promise<Record<string, unknown> | null>;
}

export type RuleDef = ScheduledRule | EventRule;

export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
export const MON_SAT = [1, 2, 3, 4, 5, 6];
export const hm = (h: number, m = 0) => h * 60 + m;

// Load something at most once per run, shared across every rule that
// needs it (drivers, transactions, tasks...).
export function cached<T>(ctx: Ctx, key: string, load: () => Promise<T>): Promise<T> {
  if (!ctx.cache.has(key)) ctx.cache.set(key, load());
  return ctx.cache.get(key) as Promise<T>;
}

export async function rows<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const rwf = (n: number) => `${Math.round(n).toLocaleString("en-US")} RWF`;
export const day = (d: string | null | undefined) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "—";
export const dayWithYear = (d: string | null | undefined) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
export const longDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const firstName = (name: string) => name.trim().split(/\s+/)[0];

export function personName(ctx: Ctx, id: string | null | undefined): string {
  return ctx.profiles.find((p) => p.id === id)?.full_name.trim() ?? "—";
}

export function activeEmployees(ctx: Ctx): Profile[] {
  return ctx.profiles.filter((p) => p.is_active && p.role === "employee");
}

// Monday-Sunday of the week before `today`.
export function lastWeek(today: string): { start: string; end: string } {
  const thisMonday = shiftDay(today, 1 - isoWeekday(today));
  return { start: shiftDay(thisMonday, -7), end: shiftDay(thisMonday, -1) };
}

export function monthOf(d: string): string {
  return d.slice(0, 7);
}

export function previousMonth(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function monthLabel(ym: string): string {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
