import { Ctx, day, esc, RuleDef, rows } from "./core.ts";

// Meetings (migration 20261026100000): the recap everyone expected gets when
// a meeting ends, and the host's note when someone books a one-to-one slot.

interface Occ { id: string; title: string; day: string; scheduled_start: string | null; started_at: string | null; ended_at: string | null; notes: string | null; metrics: unknown; expected: string[]; note_taker_id: string | null }
interface Att { profile_id: string; status: string; reason: string | null; guest: boolean }
interface Item { kind: string; text: string; owner_id: string | null; due_date: string | null }
interface Metric { label: string; value: string | number | null; unit?: string | null; note?: string | null }

const name = (ctx: Ctx, id: string | null) => (id ? ctx.profiles.find((p) => p.id === id)?.full_name.trim() ?? "Someone" : "—");
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Africa/Kigali", hour: "2-digit", minute: "2-digit" }) : "—");
const STATUS: Record<string, string> = { present: "Present", late: "Late", absent: "Absent", excused: "Excused", expected: "Not marked" };

export const meetingRules: Record<string, RuleDef> = {
  meeting_action_assigned: {
    kind: "event",
    sample: async (ctx) => {
      const [t] = await rows<{ id: string; user_id: string }>(ctx.db.from("tasks").select("id, user_id").not("meeting_occurrence_id", "is", null).order("created_at", { ascending: false }).limit(1));
      return t ? { task_id: t.id, recipient_id: t.user_id } : null;
    },
    build: async (p, ctx) => {
      const [t] = await rows<{ title: string; date: string; origin: { title?: string; day?: string; start?: string; by_name?: string } | null; meeting_occurrence_id: string | null }>(
        ctx.db.from("tasks").select("title, date, origin, meeting_occurrence_id").eq("id", String(p.task_id)));
      if (!t) return null;
      const o = t.origin ?? {};
      return {
        subject: `New task from the meeting: ${t.title}`,
        heading: "You have a new task",
        intro: `<b>${esc(t.title)}</b><br><br>Assigned by <b>${esc(o.by_name ?? name(ctx, (p.actor_id as string) ?? null))}</b> in <b>${esc(o.title ?? "a meeting")}</b>${o.day ? ` on ${day(o.day)}${o.start ? ` at ${o.start}` : ""}` : ""}. Due ${day(t.date)}.`,
        inApp: `New task from ${o.title ?? "a meeting"}: ${t.title}`,
        cta: { label: "Open my tasks", query: "page=tasks" },
      };
    },
  },
  meeting_recap: {
    kind: "event",
    sample: async (ctx) => {
      const [o] = await rows<{ id: string }>(ctx.db.from("meeting_occurrences").select("id").eq("status", "done").order("ended_at", { ascending: false }).limit(1));
      return o ? { occurrence_id: o.id } : null;
    },
    build: async (p, ctx) => {
      const [o] = await rows<Occ>(ctx.db.from("meeting_occurrences").select("id, title, day, scheduled_start, started_at, ended_at, notes, metrics, expected, note_taker_id").eq("id", String(p.occurrence_id)));
      if (!o) return null;
      const [att, items] = await Promise.all([
        rows<Att>(ctx.db.from("meeting_attendance").select("profile_id, status, reason, guest").eq("occurrence_id", o.id)),
        rows<Item>(ctx.db.from("meeting_items").select("kind, text, owner_id, due_date").eq("occurrence_id", o.id).neq("kind", "check").order("sort")),
      ]);
      const metrics = (Array.isArray(o.metrics) ? o.metrics : []) as Metric[];
      const late = o.scheduled_start && o.started_at ? Math.round((Date.parse(o.started_at) - Date.parse(`${o.day}T${o.scheduled_start}+02:00`)) / 60000) : null;
      const present = att.filter((a) => a.status === "present" || a.status === "late").length;
      const decisions = items.filter((i) => i.kind === "decision"), actions = items.filter((i) => i.kind === "action");
      const recipients = [...new Set([...o.expected, ...att.map((a) => a.profile_id)])];
      return {
        subject: `${o.title} · ${day(o.day)} — recap`,
        heading: o.title,
        intro: `${day(o.day)} · started ${time(o.started_at)}${late !== null && late > 2 ? ` (${late} min late)` : ""}, ended ${time(o.ended_at)} · ${present} of ${att.length} attended · notes by ${esc(name(ctx, o.note_taker_id))}.`,
        blocks: [
          { heading: "Attendance", table: { head: ["Who", "", "Why"], rows: att.map((a) => [esc(name(ctx, a.profile_id)) + (a.guest ? " (guest)" : ""), STATUS[a.status] ?? a.status, esc(a.reason ?? "")]), tones: att.map((a) => (a.status === "absent" ? "warning" : null)) } },
          ...(metrics.length ? [{ heading: "The numbers", table: { head: ["", "Today"], rows: metrics.filter((m) => m.value !== null && m.value !== "").map((m) => [esc(m.label), `${typeof m.value === "number" ? m.value.toLocaleString("en-US") : esc(String(m.value))}${m.unit ? ` ${esc(m.unit)}` : ""}${m.note ? ` — ${esc(m.note)}` : ""}`]) } }] : []),
          ...(o.notes?.trim() ? [{ heading: "Notes", text: esc(o.notes.trim()).replace(/\n/g, "<br>") }] : []),
          ...(decisions.length ? [{ heading: "Decisions", table: { head: ["Decided"], rows: decisions.map((d) => [esc(d.text)]) } }] : []),
          ...(actions.length ? [{ heading: "Actions (now in each person's tasks)", table: { head: ["What", "Who", "By"], rows: actions.map((a) => [esc(a.text), esc(name(ctx, a.owner_id)), a.due_date ? day(a.due_date) : "tomorrow"]) } }] : []),
        ],
        inApp: `${o.title} recap · ${present}/${att.length} attended${actions.length ? ` · ${actions.length} actions` : ""}`,
        recipients,
        cta: { label: "Open the meeting", query: `page=meeting&m=${o.id}` },
      };
    },
  },
  meeting_booked: {
    kind: "event",
    sample: async (ctx) => {
      const [s] = await rows<{ id: string; host_id: string }>(ctx.db.from("meeting_slots").select("id, host_id").not("booked_by", "is", null).order("booked_at", { ascending: false }).limit(1));
      return s ? { slot_id: s.id, recipient_id: s.host_id } : null;
    },
    build: async (p, ctx) => {
      const [s] = await rows<{ starts_at: string; title: string; booked_by: string | null; occurrence_id: string | null }>(ctx.db.from("meeting_slots").select("starts_at, title, booked_by, occurrence_id").eq("id", String(p.slot_id)));
      if (!s || !s.booked_by) return null;
      const when = new Date(s.starts_at).toLocaleString("en-GB", { timeZone: "Africa/Kigali", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      const [left] = await rows<{ n: number }>(ctx.db.from("meeting_slots").select("id", { count: "exact", head: false }).is("booked_by", null).gte("starts_at", new Date().toISOString()).then((r) => ({ data: [{ n: r.data?.length ?? 0 }], error: r.error })));
      return {
        subject: `${name(ctx, s.booked_by)} booked ${when}`,
        heading: "A one-to-one was booked",
        intro: `<b>${esc(name(ctx, s.booked_by))}</b> booked <b>${esc(s.title)}</b> on <b>${when}</b>.${left ? ` ${left.n} open slot${left.n === 1 ? "" : "s"} left.` : ""}`,
        inApp: `${name(ctx, s.booked_by)} booked a one-to-one on ${when}`,
        cta: { label: "Open meetings", query: `page=meeting${s.occurrence_id ? `&m=${s.occurrence_id}` : ""}` },
      };
    },
  },
};
