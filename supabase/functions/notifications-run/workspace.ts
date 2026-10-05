import { shiftDay } from "../_shared/depositRules.ts";
import { ALL_DAYS, Built, cached, Ctx, esc, firstName, hm, personName, plural, RuleDef, rows } from "./core.ts";

// Everyone's own workspace (Phase 3): add today's tasks, finish them,
// and hear back when someone replies to a comment. These are the only
// emails a person can switch off themselves (Settings).

export interface TaskRow { user_id: string; title: string; completed: boolean; date: string; due_time: string | null; recurring_task_id: string | null }

// The last ~2 weeks of tasks covers the daily digest and the weekly report.
export function loadRecentTasks(ctx: Ctx) {
  return cached(ctx, "tasks", () => rows<TaskRow>(ctx.db.from("tasks").select("user_id, title, completed, date, due_time, recurring_task_id").gte("date", shiftDay(ctx.today, -14))));
}

// Everyone with an account - the MD has standing duties too.
const everyone = (ctx: Ctx) => ctx.profiles.filter((p) => p.is_active && p.email);
const byDue = (a: TaskRow, b: TaskRow) => (a.due_time ?? "99:99").localeCompare(b.due_time ?? "99:99") || a.title.localeCompare(b.title);
const taskRow = (t: TaskRow) => [`${esc(t.title)}${t.recurring_task_id ? ' <span style="color:#2F8C86;font-size:11px;">(standing duty)</span>' : ""}`, t.due_time ?? "Today"];

export const workspaceRules: Record<string, RuleDef> = {
  // 07:00 every day: your list for today (standing duties + anything
  // assigned or carried over). Monday-Saturday, people with nothing on
  // their list are asked to add their tasks.
  task_morning: {
    kind: "scheduled", days: ALL_DAYS, at: hm(7),
    build: async (ctx) => {
      const today = (await loadRecentTasks(ctx)).filter((t) => t.date === ctx.today);
      const sunday = new Date(`${ctx.today}T00:00:00Z`).getUTCDay() === 0;
      return everyone(ctx).flatMap((p): Built[] => {
        const mine = today.filter((t) => t.user_id === p.id && !t.completed).sort(byDue);
        if (mine.length === 0) {
          if (sunday || p.role !== "employee") return [];
          return [{
            recipients: [p.id],
            subject: "Add today's tasks",
            heading: "What are you working on today?",
            intro: `Good morning ${esc(firstName(p.full_name))} — you haven't got any tasks for today yet. Take two minutes to list what you'll get done, so your day counts on the team board.`,
            inApp: "Add today's tasks",
          }];
        }
        const duties = mine.filter((t) => t.recurring_task_id).length;
        return [{
          recipients: [p.id],
          subject: `Your day: ${plural(mine.length, "task")}${duties ? ` (${duties} standing ${duties === 1 ? "duty" : "duties"})` : ""}`,
          heading: `Good morning ${esc(firstName(p.full_name))}`,
          intro: "Here's your list for today. Tick each one off in Kivu Daily as soon as it's done — the team board and the MD's morning briefing count them. Add anything else you plan to do.",
          table: { head: ["Task", "Done by"], rows: mine.map(taskRow) },
          inApp: `${plural(mine.length, "task")} on your list today`,
        }];
      });
    },
  },

  // 13:00: anything with a "done by" time that has passed and isn't ticked.
  task_overdue: {
    kind: "scheduled", days: ALL_DAYS, at: hm(13),
    build: async (ctx) => {
      const nowHm = new Date(Date.now() + 2 * 3600000).toISOString().slice(11, 16);
      const late = (await loadRecentTasks(ctx)).filter((t) => t.date === ctx.today && !t.completed && t.due_time && t.due_time <= nowHm);
      return everyone(ctx)
        .map((p) => ({ p, mine: late.filter((t) => t.user_id === p.id).sort(byDue) }))
        .filter((r) => r.mine.length > 0)
        .map(({ p, mine }): Built => ({
          recipients: [p.id],
          subject: `${plural(mine.length, "task")} past due — please act`,
          heading: "These were due this morning",
          intro: `${esc(firstName(p.full_name))}, these should already be done. If they are, tick them off; if not, do them now — or add a note on the task saying what's blocking you.`,
          table: { head: ["Task", "Was due"], rows: mine.map(taskRow) },
          inApp: `${plural(mine.length, "task")} past due`,
        }));
    },
  },

  task_unfinished: {
    kind: "scheduled", days: ALL_DAYS, at: hm(17, 30),
    build: async (ctx) => {
      const open = (await loadRecentTasks(ctx)).filter((t) => t.date === ctx.today && !t.completed);
      return everyone(ctx)
        .map((p) => ({ p, mine: open.filter((t) => t.user_id === p.id).sort(byDue) }))
        .filter((r) => r.mine.length > 0)
        .map(({ p, mine }): Built => ({
          recipients: [p.id],
          subject: `${plural(mine.length, "task")} still open today`,
          heading: "Before you finish for the day",
          intro: `${esc(firstName(p.full_name))}, these are still open. Tick off what's done. Standing duties that aren't ticked show as missed in the MD's morning briefing.`,
          table: { head: ["Task", "Done by"], rows: mine.map(taskRow) },
          inApp: `${plural(mine.length, "task")} still open today`,
        }));
    },
  },

  comment_reply: {
    kind: "event",
    sample: async (ctx) => {
      const [latest] = await rows<{ id: string }>(ctx.db.from("comments").select("id").order("created_at", { ascending: false }).limit(1));
      return latest ? { comment_id: latest.id } : null;
    },
    build: async (p, ctx) => {
      const [c] = await rows<{ author_id: string; target_user_id: string | null; content: string; parent_comment_id: string | null }>(
        ctx.db.from("comments").select("author_id, target_user_id, content, parent_comment_id").eq("id", p.comment_id as string),
      );
      if (!c || !c.target_user_id || c.target_user_id === c.author_id) return null;
      const author = personName(ctx, c.author_id);
      return {
        recipients: [c.target_user_id],
        subject: `${author} ${c.parent_comment_id ? "replied to you" : "left you a comment"}`,
        heading: `${esc(author)} ${c.parent_comment_id ? "replied" : "left you a comment"}`,
        intro: `<div style="border-left:3px solid #4F7B3E;padding:4px 12px;margin:8px 0;color:#333;">${esc(c.content).replace(/\n/g, "<br>")}</div>Reply from Comments in Kivu Daily.`,
        inApp: `${author} ${c.parent_comment_id ? "replied to you" : "left you a comment"}`,
      };
    },
  },
};
