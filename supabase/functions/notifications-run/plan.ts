import { Ctx, esc, RuleDef, rows, rwf } from "./core.ts";

// Company plan (migration 20261022100000): a budget sent for approval goes
// to the MD and everyone with full plan access; the owner hears the decision.

interface BudgetRow { id: string; number: number; name: string; kind: string; department_slug: string | null; owner_id: string | null; start_month: string; months: number; goal: string | null; target_value: number | null; target_unit: string | null; approved_amount: number | null; decision_note: string | null; created_by: string | null }
interface LineRow { description: string; amount: number; recurrence: string; months: number }
const lineTotal = (l: LineRow) => Number(l.amount) * (l.recurrence === "monthly" ? l.months : 1);
const who = (ctx: Ctx, id: unknown) => ctx.profiles.find((p) => p.id === id)?.full_name.trim() || "Someone";
const month = (d: string) => new Date(`${d.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

async function load(ctx: Ctx, id: unknown) {
  const [b] = await rows<BudgetRow>(ctx.db.from("company_budgets").select("id, number, name, kind, department_slug, owner_id, start_month, months, goal, target_value, target_unit, approved_amount, decision_note, created_by").eq("id", String(id)));
  if (!b) return null;
  const lines = await rows<LineRow>(ctx.db.from("company_budget_lines").select("description, amount, recurrence, months").eq("budget_id", b.id).order("sort"));
  return { b, lines, planned: lines.reduce((s, l) => s + lineTotal(l), 0) };
}
const latest = async (ctx: Ctx, col: "submitted_at" | "approved_at") => {
  const [x] = await rows<{ id: string }>(ctx.db.from("company_budgets").select("id").not(col, "is", null).order(col, { ascending: false }).limit(1));
  return x ? { budget_id: x.id, approved: true } : null;
};

export const planRules: Record<string, RuleDef> = {
  company_budget_submitted: {
    kind: "event",
    sample: (ctx) => latest(ctx, "submitted_at"),
    build: async (p, ctx) => {
      const x = await load(ctx, p.budget_id);
      if (!x) return null;
      const { b, lines, planned } = x;
      const admins = await rows<{ profile_id: string }>(ctx.db.from("company_plan_members").select("profile_id").eq("access", "full"));
      const period = `${month(b.start_month)}${b.months > 1 ? ` + ${b.months - 1} month${b.months > 2 ? "s" : ""}` : ""}`;
      return {
        subject: `Budget to approve: ${b.name} (${rwf(planned)})`,
        heading: "A budget is waiting for your approval",
        intro: `<b>${esc(who(ctx, p.actor_id))}</b> asks for <b>${rwf(planned)}</b> for <b>${esc(b.name)}</b> (${period}).`
          + (b.goal ? `<br><br><b>Goal:</b> ${esc(b.goal)}` : "")
          + (b.target_value ? `<br><b>Expected:</b> ${Number(b.target_value).toLocaleString("en-US")} ${esc(b.target_unit ?? "")} (${rwf(planned / Number(b.target_value))} each)` : "")
          + (b.approved_amount !== null ? `<br><br>Approved before: ${rwf(Number(b.approved_amount))}.` : ""),
        table: { head: ["Line", "Total"], rows: [...lines.map((l) => [esc(l.description) + (l.recurrence === "monthly" ? ` (${rwf(Number(l.amount))} × ${l.months} months)` : ""), rwf(lineTotal(l))]), ["<b>Total</b>", `<b>${rwf(planned)}</b>`]] },
        inApp: `Approve or not: ${b.name} (${rwf(planned)})`,
        recipients: [...new Set([...ctx.profiles.filter((x) => x.role === "managing_director").map((x) => x.id), ...admins.map((a) => a.profile_id)])],
        cta: { label: "Approve or not", query: `page=company_budget&b=${b.id}` },
      };
    },
  },
  company_budget_decided: {
    kind: "event",
    sample: (ctx) => latest(ctx, "approved_at"),
    build: async (p, ctx) => {
      const x = await load(ctx, p.budget_id);
      if (!x) return null;
      const { b } = x;
      const yes = p.approved === true, kept = p.kept === true;
      const amount = rwf(Number(b.approved_amount ?? 0));
      return {
        subject: yes ? `Approved: ${b.name} — ${amount}` : kept ? `Budget kept at ${amount}: ${b.name}` : `Not approved: ${b.name}`,
        heading: yes ? "Your budget is approved" : kept ? "The bigger amount was not approved" : "Your budget was not approved",
        intro: `<b>${esc(who(ctx, p.actor_id))}</b> ${yes ? `approved <b>${esc(b.name)}</b> for <b>${amount}</b>. Finance records spending against it in the ledger.` : kept ? `kept <b>${esc(b.name)}</b> at <b>${amount}</b>.` : `did not approve <b>${esc(b.name)}</b>.`}`
          + (b.decision_note ? `<br><br>“${esc(b.decision_note)}”` : ""),
        inApp: yes ? `Approved: ${b.name} (${amount})` : kept ? `Budget kept: ${b.name}` : `Not approved: ${b.name}`,
        cta: { label: "Open the budget", query: `page=company_budget&b=${b.id}` },
      };
    },
  },
};
