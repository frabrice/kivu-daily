import { Built, Ctx, day, esc, hm, RuleDef, rows, rwf } from "./core.ts";
import { shiftDay } from "../_shared/depositRules.ts";

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

// On the 1st: last month at Kivu Ride, for the MD and full plan access.
interface Facts { own_income_by_type: Record<string, number>; spent_by_type: Record<string, number>; budget_spent: number; trips: { requested: number; completed: number; no_driver: number; fares: number }; it: { issues_done: number; bugs_fixed: number; releases: { name: string }[]; milestones_completed: string[] } }
const SPENT: Record<string, string> = { vehicle_owner_payment: "Car owners paid", driver_payroll: "Driver payroll", payroll: "Staff payroll", supplier_payment: "Suppliers", expense: "Expenses", refund: "Refunds" };
async function monthly(ctx: Ctx, force: boolean): Promise<Built[]> {
  if (!force && ctx.today.slice(8, 10) !== "01") return [];
  const to = shiftDay(`${ctx.today.slice(0, 7)}-01`, -1), from = `${to.slice(0, 7)}-01`;
  const prevTo = shiftDay(from, -1), prevFrom = `${prevTo.slice(0, 7)}-01`;
  const [{ data: f }, { data: pf }, settings] = await Promise.all([
    ctx.db.rpc("company_month_facts", { p_from: from, p_to: to }),
    ctx.db.rpc("company_month_facts", { p_from: prevFrom, p_to: prevTo }),
    rows<{ commission_pct: number; monthly_costs: number }>(ctx.db.from("company_money_settings").select("commission_pct, monthly_costs").eq("id", 1)),
  ]);
  if (!f) return [];
  const facts = f as Facts, prev = pf as Facts | null;
  const pct = Number(settings[0]?.commission_pct ?? 9.5) / 100;
  const days = Number(to.slice(8, 10));
  const income = (x: Facts) => Number(x.own_income_by_type?.management_margin ?? 0) + Number(x.own_income_by_type?.revenue ?? 0) + Math.round(Number(x.trips.fares) * pct);
  const perDay = (x: Facts, d: number) => Math.round((Number(x.trips.completed) / d) * 10) / 10;
  const inc = income(facts), prevInc = prev ? income(prev) : 0;
  const change = (now: number, before: number) => (before ? ` (${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)}% vs the month before)` : "");
  const decisions = await rows<{ number: number; title: string; decision: string | null }>(ctx.db.from("company_decisions").select("number, title, decision").gte("decided_at", from).lte("decided_at", to).neq("status", "proposed").order("number"));
  const admins = await rows<{ profile_id: string }>(ctx.db.from("company_plan_members").select("profile_id").eq("access", "full"));
  const monthName = new Date(`${from}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const costs = Number(settings[0]?.monthly_costs ?? 0);
  return [{
    subject: `${monthName} at Kivu Ride: ${perDay(facts, days)} trips a day, ${rwf(inc)} own income`,
    heading: `${monthName} at Kivu Ride`,
    intro: `The month in numbers, ready for the partners' review.${costs ? ` Running costs are set at ${rwf(costs)} a month — own income ${inc >= costs ? "covered" : "did not cover"} them.` : ""}`,
    stats: [
      { label: "Completed trips / day", value: String(perDay(facts, days)), sub: `${facts.trips.completed} trips${prev ? change(perDay(facts, days), perDay(prev, Number(prevTo.slice(8, 10)))) : ""}` },
      { label: "Requests completed", value: facts.trips.requested ? `${Math.round((facts.trips.completed / facts.trips.requested) * 100)}%` : "—", sub: facts.trips.requested ? `${Math.round((facts.trips.no_driver / facts.trips.requested) * 100)}% found no driver` : "" },
      { label: "Own income", value: rwf(inc), sub: `margins, fees, commission${change(inc, prevInc)}`, tone: costs && inc < costs ? "warning" : "good" },
      { label: "IT", value: `${facts.it.issues_done} done`, sub: facts.it.releases.length ? `released ${facts.it.releases.map((r) => r.name).join(", ")}` : "no release" },
    ],
    blocks: [
      { heading: "Out, in the ledger", table: { head: ["What", "Amount"], rows: [...Object.entries(facts.spent_by_type ?? {}).map(([k, v]) => [SPENT[k] ?? k.replace(/_/g, " "), rwf(Number(v))]), ["From approved budgets", rwf(Number(facts.budget_spent ?? 0))]] } },
      ...(decisions.length ? [{ heading: "Decisions", table: { head: ["Decision", "What we decided"], rows: decisions.map((d) => [`D${d.number} · ${esc(d.title)}`, esc(d.decision ?? "—")]) } }] : []),
    ],
    inApp: `${monthName} at Kivu Ride: ${perDay(facts, days)} trips a day, ${rwf(inc)} own income`,
    recipients: [...new Set([...ctx.profiles.filter((p) => p.role === "managing_director").map((p) => p.id), ...admins.map((a) => a.profile_id)])],
    cta: { label: "Open the monthly review", query: `page=company_review&month=${from}` },
    footnote: `Period ${day(from)} – ${day(to)}. The app commission is estimated from completed trip fares.`,
  }];
}

export const planRules: Record<string, RuleDef> = {
  company_monthly_review: { kind: "scheduled", days: [1, 2, 3, 4, 5, 6, 7], at: hm(9), build: (ctx, force) => monthly(ctx, force) },
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
