import { Block, Built, cached, Ctx, esc, personName, RuleDef, rows } from "./core.ts";

// Call Center shifts: the report an agent files when ending a shift, and
// the alert when a shift was left open.

export interface ShiftRow {
  id: string; agent_id: string; partner_id: string | null; station: string; slot: string; started_at: string; ended_at: string | null;
  status: string; late_minutes: number; report: Record<string, unknown>; stats: Record<string, number>;
}

const SLOT_LABEL: Record<string, string> = { morning: "Morning 06:00–14:00", afternoon: "Afternoon 14:00–22:00", night: "Night 22:00–06:00" };
const kigaliTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" });
const kigaliDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Kigali" });
export const hours = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m`;

export function loadShifts(ctx: Ctx, sinceIso: string) {
  return cached(ctx, `shifts:${sinceIso}`, () => rows<ShiftRow>(ctx.db.from("call_center_shifts").select("*").gte("started_at", sinceIso).order("started_at")));
}

async function shift(ctx: Ctx, id: unknown) {
  const [s] = await rows<ShiftRow>(ctx.db.from("call_center_shifts").select("*").eq("id", id as string));
  return s ?? null;
}

const n = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : String(v));

// Calls by type (reports filed before 5 Oct 2026 only have the totals).
export const IN_TYPES: [string, string][] = [["in_passengers", "passengers"], ["in_drivers", "our drivers"], ["in_noninsider", "Non-Insider"], ["in_partners", "owners & partners"], ["in_other", "other"]];
export const OUT_TYPES: [string, string][] = [["out_drivers", "our drivers"], ["out_noninsider", "Non-Insider"], ["out_callbacks", "call-backs"], ["out_other", "other"]];
const breakdown = (r: Record<string, unknown>, types: [string, string][]) => {
  const parts = types.filter(([k]) => Number(r[k] ?? 0) > 0).map(([k, l]) => `${r[k]} ${l}`);
  return parts.length ? ` — ${parts.join(" · ")}` : "";
};

export const shiftRules: Record<string, RuleDef> = {
  shift_report: {
    kind: "event",
    sample: async (ctx) => {
      const [s] = await rows<{ id: string }>(ctx.db.from("call_center_shifts").select("id").eq("status", "closed").order("ended_at", { ascending: false }).limit(1));
      return s ? { shift_id: s.id } : null;
    },
    build: async (p, ctx): Promise<Built | null> => {
      const s = await shift(ctx, p.shift_id);
      if (!s) return null;
      const r = s.report;
      const st = s.stats;
      const who = personName(ctx, s.agent_id);
      const text = (label: string, key: string): Block | null => (r[key] && String(r[key]).trim() ? { heading: label, text: `<div style="white-space:pre-wrap;">${esc(String(r[key]))}</div>` } : null);
      const blocks: Block[] = [
        {
          table: {
            head: ["", ""],
            rows: [
              ["Time", `${kigaliTime(s.started_at)}–${s.ended_at ? kigaliTime(s.ended_at) : "now"} (${hours(st.minutes ?? 0)})${s.late_minutes > 10 ? ` <span style="color:#d97706;">· ${s.late_minutes} min late</span>` : ""}`],
              ["Computer / partner", `${esc(s.station)}${s.partner_id ? ` · with ${esc(personName(ctx, s.partner_id))}` : ""}`],
              ["Calls received", `<b>${n(r.calls_received)}</b>${breakdown(r, IN_TYPES)}`],
              ["Calls made", `<b>${n(r.calls_made)}</b>${breakdown(r, OUT_TYPES)}`],
              ["Missed · WhatsApp/SMS", `${n(r.calls_missed)} missed · ${n(r.messages_handled)} messages`],
              ["Logged in Kivu Daily", `${st.contacts_logged ?? 0} contacts (${st.solved_on_call ?? 0} solved on the spot, ${st.handed_on ?? 0} handed on, ${st.bookings ?? 0} bookings) · ${st.cases_closed ?? 0} cases closed · ${st.driver_calls ?? 0} driver calls`],
              ...(st.outreach_calls ? [["Non-Insider outreach", `${st.outreach_calls} calls logged · ${st.outreach_interested ?? 0} interested`]] : []),
            ],
          },
        },
        ...[text("Worked on", "worked_on"), text("Resolved", "resolved_summary"), text("Still unresolved", "unresolved_summary"),
          text("Problems", "problems"), text("What callers said", "feedback"), text("Suggestions", "suggestions")].filter((b): b is Block => b !== null),
      ];
      const gap = Number(r.calls_received ?? 0) - (st.contacts_logged ?? 0);
      if (gap >= 5) blocks.push({ text: `<span style="color:#d97706;">${gap} calls received weren't logged as contacts — ask ${esc(who.split(" ")[0])} to log every call.</span>` });
      return {
        subject: `Shift report: ${who} — ${SLOT_LABEL[s.slot] ?? s.slot}, ${n(r.calls_received)} calls in`,
        heading: `Shift report — ${esc(who)}`,
        intro: `${kigaliDate(s.started_at)}, ${SLOT_LABEL[s.slot] ?? s.slot}.`,
        blocks,
        inApp: `Shift report: ${who}, ${n(r.calls_received)} calls in`,
      };
    },
  },

  shift_not_closed: {
    kind: "event",
    sample: async (ctx) => {
      const [s] = await rows<{ id: string }>(ctx.db.from("call_center_shifts").select("id").order("started_at", { ascending: false }).limit(1));
      return s ? { shift_id: s.id } : null;
    },
    build: async (p, ctx) => {
      const s = await shift(ctx, p.shift_id);
      if (!s) return null;
      const who = personName(ctx, s.agent_id);
      return {
        subject: `Shift not ended: ${who} (${SLOT_LABEL[s.slot] ?? s.slot})`,
        heading: "A Call Center shift wasn't ended",
        intro: `${esc(who)} started a shift at ${kigaliTime(s.started_at)} on ${kigaliDate(s.started_at)} (${esc(s.station)}) and never ended it, so there's no shift report or handover. It was closed automatically after 10 hours. Remind them that signing out goes through "End shift".`,
        inApp: `Shift not ended: ${who}`,
      };
    },
  },
};
