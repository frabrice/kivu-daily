import { ALL_DAYS, Built, Ctx, esc, firstName, hm, longDay, plural, RuleDef, Tone } from "./core.ts";

// 17:30 every day (MD, 31 Oct 2026): the team's day - who is done, who is
// behind, what is late or still open. The MD gets everyone; each head of
// department (route_finance -> Finance, route_operations -> Fleet,
// route_it -> IT, route_call_center -> Call Center) gets their own people. Same numbers as People > Today
// (team_day(), migration 20261101190000).

interface DayTask { id: string; user_id: string; title: string; completed: boolean; due_time: string | null; smart_total: number | null; smart_done: number | null }
interface TeamDay {
  people: { id: string; full_name: string; dept: string | null; dept_name: string | null }[];
  tasks: DayTask[];
}

const units = (t: DayTask) => (t.smart_total && t.smart_total > 0 ? t.smart_total : 1);
const doneUnits = (t: DayTask) => (t.completed ? units(t) : Math.min(units(t), t.smart_total ? t.smart_done ?? 0 : 0));
const HEADS: [string, string][] = [["route_finance", "finance"], ["route_operations", "fleet"], ["route_it", "it"], ["route_call_center", "call_center"]];

function build(ctx: Ctx, data: TeamDay, people: TeamDay["people"], recipient: string, scope: string): Built {
  const nowHm = new Date().toLocaleTimeString("en-GB", { timeZone: "Africa/Kigali", hour: "2-digit", minute: "2-digit", hour12: false });
  const rows = people.map((p) => {
    const tasks = data.tasks.filter((t) => t.user_id === p.id);
    const total = tasks.reduce((s, t) => s + units(t), 0), done = tasks.reduce((s, t) => s + doneUnits(t), 0);
    const open = tasks.filter((t) => !t.completed);
    const late = open.filter((t) => t.due_time && t.due_time.slice(0, 5) < nowHm);
    return { p, tasks, total, done, pct: total ? Math.round((done / total) * 100) : null, open, late };
  }).sort((a, b) => (a.pct ?? -1) - (b.pct ?? -1) || b.late.length - a.late.length);
  const total = rows.reduce((s, r) => s + r.total, 0), done = rows.reduce((s, r) => s + r.done, 0);
  const late = rows.reduce((s, r) => s + r.late.length, 0);
  const none = rows.filter((r) => !r.tasks.length);
  const finished = rows.filter((r) => r.tasks.length && r.pct === 100);
  const behind = rows.filter((r) => r.tasks.length && (r.pct ?? 0) < 100);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const tone = (r: typeof rows[number]): Tone | null => (!r.tasks.length ? "warning" : r.late.length ? "danger" : (r.pct ?? 0) < 100 ? "warning" : "good");
  const openList = (r: typeof rows[number]) => r.open.slice(0, 4).map((t) => {
    const prog = t.smart_total ? ` (${t.smart_done ?? 0}/${t.smart_total})` : "";
    const isLate = r.late.includes(t);
    return `${isLate ? `<b style="color:#b91c1c;">${esc(t.due_time!.slice(0, 5))} late</b> ` : ""}${esc(t.title)}${prog}`;
  }).join("<br>") + (r.open.length > 4 ? `<br><span style="color:#6b7280;">…and ${r.open.length - 4} more</span>` : "");

  return {
    recipients: [recipient],
    subject: `Team day ${longDay(ctx.today)}: ${pct}% done${late ? `, ${plural(late, "task")} late` : ""}${none.length ? `, ${none.length} with no tasks` : ""}`,
    heading: `${scope}: ${pct}% of today's work done`,
    intro: `${finished.length ? `${plural(finished.length, "person", "people")} finished everything. ` : ""}${behind.length ? `${plural(behind.length, "person", "people")} still have work open.` : "Nobody has work left open."} Progress counts each item of a list task (5 of 7 calls = 5/7).`,
    alert: late ? { tone: "danger", text: `<b>${plural(late, "task")} late</b> (open after their due time): ${rows.filter((r) => r.late.length).map((r) => `${esc(firstName(r.p.full_name))} ${r.late.length}`).join(", ")}.` }
      : none.length ? { tone: "warning", text: `<b>No tasks today:</b> ${none.map((r) => esc(firstName(r.p.full_name))).join(", ")}.` } : { tone: "good", text: "Nothing late." },
    stats: [
      { label: "Done", value: `${pct}%`, sub: `${done} of ${total}`, tone: pct >= 80 ? "good" : pct >= 50 ? "warning" : "danger" },
      { label: "Late", value: String(late), tone: late ? "danger" : "good" },
      { label: "Finished everything", value: `${finished.length} / ${rows.length}` },
      { label: "No tasks", value: String(none.length), tone: none.length ? "warning" : undefined },
    ],
    table: {
      head: ["Person", "Done", "Still open"],
      rows: rows.map((r) => [
        `<b>${esc(r.p.full_name)}</b><br><span style="color:#6b7280;font-size:12px;">${esc(r.p.dept_name ?? "")}</span>`,
        r.tasks.length ? `${r.pct}%<br><span style="color:#6b7280;font-size:12px;">${r.tasks.filter((t) => t.completed).length}/${r.tasks.length} tasks</span>` : "No tasks",
        r.open.length ? openList(r) : r.tasks.length ? "All done" : "—",
      ]),
      tones: rows.map(tone),
    },
    inApp: `Team day: ${pct}% done${late ? `, ${late} late` : ""}${none.length ? `, ${none.length} with no tasks` : ""}`,
    cta: { label: "Open Team today", query: "page=people_today" },
  };
}

async function teamDay(ctx: Ctx): Promise<Built[]> {
  const { data, error } = await ctx.db.rpc("team_day", { p_day: ctx.today });
  if (error || !data) throw new Error(`team_day: ${error?.message ?? "no data"}`);
  const d = data as TeamDay;
  const out: Built[] = [];
  const md = ctx.profiles.find((p) => p.role === "managing_director" && p.is_active)?.id;
  if (md && d.people.length) out.push(build(ctx, d, d.people, md, "The team"));
  for (const [duty, dept] of HEADS) {
    const head = ctx.responsibilities[duty];
    if (!head || head === md) continue;
    const mine = d.people.filter((p) => p.dept === dept);
    if (mine.length) out.push(build(ctx, d, mine, head, mine[0].dept_name ?? dept));
  }
  return out;
}

export const teamDayRules: Record<string, RuleDef> = {
  team_day_summary: { kind: "scheduled", days: ALL_DAYS, at: hm(17, 30), build: (ctx) => teamDay(ctx), testAll: true },
};
