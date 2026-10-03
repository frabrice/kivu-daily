import { daysUntilDate, shiftDay } from "../_shared/depositRules.ts";
import { car, loadDrivers } from "./drivers.ts";
import { loadTickets } from "./tickets.ts";
import { Block, Built, cached, Ctx, day, dayWithYear, esc, hm, MON_SAT, personName, plural, RuleDef, rows, rwf } from "./core.ts";

// Operations (Phase 3): Fleet's Monday housekeeping list, Call Center's
// morning queue, contract changes for Fleet, and the Flag-to-IT loop.

const DOC_LABELS: Record<string, string> = {
  application_letter: "Application letter", cv: "CV", id: "National ID", driving_license: "Driving licence",
  medical_certificate: "Medical certificate", criminal_record: "Criminal record", discipline_certificate: "Discipline certificate",
};

interface VehicleRow { id: string; plate_number: string; rura_license_status: string | null; rura_license_expiry_date: string | null }
interface FineRow { id: string; driver_id: string | null; vehicle_id: string | null; amount: number; fine_date: string; reason: string | null }
interface StoryRow { id: string; title: string | null; need: string | null; persona: string | null; details: string | null; status: string; source: string; created_by: string | null; created_at: string; updated_at: string }
interface CallRow { driver_id: string; created_at: string; caller_id: string | null; outcome: { label: string; needs_followup: boolean } | null }

export function loadVehicles(ctx: Ctx) {
  return cached(ctx, "vehicles", () => rows<VehicleRow>(ctx.db.from("vehicles").select("id, plate_number, rura_license_status, rura_license_expiry_date").order("plate_number")));
}

export function loadCalls(ctx: Ctx) {
  return cached(ctx, "calls", () => rows<CallRow>(ctx.db.from("call_logs").select("driver_id, created_at, caller_id, outcome:call_outcomes(label, needs_followup)").order("created_at", { ascending: false })));
}

export function loadFlaggedStories(ctx: Ctx) {
  return cached(ctx, "flagged", () => rows<StoryRow>(ctx.db.from("user_stories").select("id, title, need, persona, details, status, source, created_by, created_at, updated_at").eq("source", "flagged")));
}

// Cars with nobody on an active contract driving them.
export async function carsWithoutDriver(ctx: Ctx): Promise<VehicleRow[]> {
  const [vehicles, drivers] = await Promise.all([loadVehicles(ctx), loadDrivers(ctx)]);
  return vehicles.filter((v) => !drivers.some((d) => d.vehicle_id === v.id && d.contract_status === "active"));
}

const storyLabel = (s: StoryRow) => s.title?.trim() || s.need?.trim() || "an issue";

export const operationsRules: Record<string, RuleDef> = {
  fleet_weekly: {
    kind: "scheduled", days: [1], at: hm(8),
    build: async (ctx) => {
      const [drivers, vehicles, docs, fines, finePayments, idle] = await Promise.all([
        loadDrivers(ctx),
        loadVehicles(ctx),
        rows<{ driver_id: string; doc_type: string }>(ctx.db.from("driver_documents").select("driver_id, doc_type")),
        rows<FineRow>(ctx.db.from("driver_fines").select("id, driver_id, vehicle_id, amount, fine_date, reason")),
        rows<{ fine_id: string; amount: number }>(ctx.db.from("driver_fine_payments").select("fine_id, amount")),
        carsWithoutDriver(ctx),
      ]);
      const active = drivers.filter((d) => d.contract_status === "active" && d.vehicle_id);
      const missingDocs = active
        .map((d) => ({ d, missing: Object.keys(DOC_LABELS).filter((k) => !docs.some((x) => x.driver_id === d.id && x.doc_type === k)) }))
        .filter((r) => r.missing.length > 0);
      const unpaid = fines
        .map((f) => ({ f, owed: Number(f.amount) - finePayments.filter((p) => p.fine_id === f.id).reduce((s, p) => s + Number(p.amount), 0) }))
        .filter((r) => r.owed > 0)
        .sort((a, b) => a.f.fine_date.localeCompare(b.f.fine_date));
      const soon = shiftDay(ctx.today, 30);
      const licences = vehicles.filter((v) => v.rura_license_expiry_date && v.rura_license_expiry_date <= soon);

      const blocks: Block[] = [];
      if (idle.length) blocks.push({ heading: `Cars without a driver (${idle.length})`, text: idle.map((v) => esc(v.plate_number)).join(", ") + " — every idle day is lost income for the owner and for us." });
      if (licences.length) blocks.push({
        heading: `RURA licences expired or expiring within 30 days (${licences.length})`,
        table: {
          head: ["Car", "Expiry", ""],
          rows: licences.map((v) => {
            const left = daysUntilDate(ctx.today, v.rura_license_expiry_date!);
            const implausible = v.rura_license_expiry_date! < "2020-01-01";
            return [esc(v.plate_number), dayWithYear(v.rura_license_expiry_date), implausible ? "Date looks wrong — please correct it" : left < 0 ? `Expired ${plural(-left, "day")} ago` : `${plural(left, "day")} left`];
          }),
        },
      });
      if (unpaid.length) blocks.push({
        heading: `Unpaid fines (${unpaid.length}, ${rwf(unpaid.reduce((s, r) => s + r.owed, 0))})`,
        table: {
          head: ["Driver", "Car", "Fine date", "Still owed", "Reason"],
          rows: unpaid.map(({ f, owed }) => [
            esc(drivers.find((d) => d.id === f.driver_id)?.full_name ?? "—"),
            esc(vehicles.find((v) => v.id === f.vehicle_id)?.plate_number ?? "—"),
            day(f.fine_date), rwf(owed), esc(f.reason ?? ""),
          ]),
        },
      });
      if (missingDocs.length) blocks.push({
        heading: `Drivers with missing documents (${missingDocs.length})`,
        table: { head: ["Driver", "Car", "Missing"], rows: missingDocs.map((r) => [esc(r.d.full_name), esc(car(r.d)), r.missing.map((k) => DOC_LABELS[k]).join(", ")]) },
      });
      if (blocks.length === 0) return [];
      return [{
        subject: `Fleet this week: ${[
          idle.length && plural(idle.length, "idle car"),
          licences.length && plural(licences.length, "licence") + " to renew",
          unpaid.length && plural(unpaid.length, "unpaid fine"),
          missingDocs.length && `${plural(missingDocs.length, "driver")} missing documents`,
        ].filter(Boolean).join(", ")}`,
        heading: "Fleet — this week's housekeeping",
        intro: "Everything below is open in Kivu Daily right now. Fix what you can this week.",
        blocks,
        inApp: "Fleet weekly housekeeping list is ready",
      }];
    },
  },

  callcenter_followups: {
    kind: "scheduled", days: MON_SAT, at: hm(8),
    build: async (ctx) => {
      const [drivers, calls] = await Promise.all([loadDrivers(ctx), loadCalls(ctx)]);
      // Same queue rule as the Call Center page: never called, last call
      // needs a follow-up, or 7+ days since the last call.
      const due = drivers
        .filter((d) => d.stage !== "inactive")
        .map((d) => {
          const last = calls.find((c) => c.driver_id === d.id);
          const days = last ? daysUntilDate(last.created_at.slice(0, 10), ctx.today) : null;
          const why = !last ? "Never called" : last.outcome?.needs_followup ? `Follow-up: ${last.outcome.label}` : days! >= 7 ? `${days} days since last call` : null;
          return { d, last, why, rank: !last ? 0 : last.outcome?.needs_followup ? 1 : 2 };
        })
        .filter((r) => r.why)
        .sort((a, b) => a.rank - b.rank || a.d.full_name.localeCompare(b.d.full_name));
      const callbacks = (await loadTickets(ctx)).filter((t) => t.status === "resolved");
      if (due.length === 0 && callbacks.length === 0) return [];
      const blocks: Block[] = [];
      if (callbacks.length) blocks.push({
        heading: `Call these callers back (${callbacks.length})`,
        text: "Their issue is resolved. Tell them, then mark the ticket Closed — or Reopen it if it isn't fixed.",
        table: { head: ["Ticket", "Caller", "Phone", "Resolved by"], rows: callbacks.map((t) => [esc(t.reference), esc(t.caller_name), esc(t.caller_phone), esc(personName(ctx, t.resolved_by))]) },
      });
      if (due.length) blocks.push({
        heading: `Drivers to call (${due.length})`,
        table: { head: ["Driver", "Phone", "Why", "Last call"], rows: due.map((r) => [esc(r.d.full_name), esc(r.d.phone ?? "—"), esc(r.why!), r.last ? `${day(r.last.created_at.slice(0, 10))} · ${esc(personName(ctx, r.last.caller_id))}` : "—"]) },
      });
      return [{
        subject: `Call queue today: ${[callbacks.length && plural(callbacks.length, "caller") + " to call back", due.length && plural(due.length, "driver") + " to call"].filter(Boolean).join(", ")}`,
        heading: "Today's call queue",
        intro: "Most urgent first. Log each call in Kivu Daily so the queue updates.",
        blocks,
        inApp: `Call queue: ${[callbacks.length && plural(callbacks.length, "call-back"), due.length && plural(due.length, "driver")].filter(Boolean).join(", ")}`,
      }];
    },
  },

  driver_contract_fleet: {
    kind: "event",
    sample: async (ctx) => {
      const latest = [...await loadDrivers(ctx)].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return latest ? { driver_id: latest.id, event_type: "ended", event_date: ctx.today, reason: "Example reason" } : null;
    },
    build: async (p, ctx): Promise<Built | null> => {
      const d = (await loadDrivers(ctx)).find((x) => x.id === p.driver_id);
      if (!d) return null;
      const ended = p.event_type === "ended";
      return {
        subject: `${ended ? "Contract ended" : "Driver reactivated"}: ${d.full_name}`,
        heading: `${ended ? "Contract ended" : "Driver reactivated"}: ${esc(d.full_name)}`,
        intro: ended
          ? `${esc(d.full_name)}'s contract ended on ${day(p.event_date as string)}${p.reason ? ` — ${esc(String(p.reason))}` : ""}.`
            + `<br><br>Collect the car${d.vehicle ? ` (${esc(d.vehicle.plate_number)})` : ""} and any device, and plan who drives it next.`
          : `${esc(d.full_name)} was reactivated on ${day(p.event_date as string)}${d.vehicle ? ` and is assigned to ${esc(d.vehicle.plate_number)}` : ""}.`,
        inApp: `${ended ? "Contract ended" : "Reactivated"}: ${d.full_name}`,
      };
    },
  },

  it_flag_created: {
    kind: "event",
    sample: async (ctx) => {
      const latest = [...await loadFlaggedStories(ctx)].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return latest ? { story_id: latest.id } : null;
    },
    build: async (p, ctx) => {
      const s = (await loadFlaggedStories(ctx)).find((x) => x.id === p.story_id);
      if (!s) return null;
      return {
        subject: `New issue flagged to IT: ${storyLabel(s)}`,
        heading: "New issue flagged to IT",
        intro: `<b>${esc(personName(ctx, s.created_by))}</b> flagged: "${esc(storyLabel(s))}"`
          + `${s.details ? `<br><br>${esc(s.details).replace(/\n/g, "<br>")}` : ""}`
          + "<br><br>It's in the Product Hub's flagged inbox. Reply by moving it along — the person who flagged it is emailed when it's done.",
        inApp: `New issue flagged to IT: ${storyLabel(s)}`,
      };
    },
  },

  it_flag_resolved: {
    kind: "event",
    sample: async (ctx) => {
      const latest = [...await loadFlaggedStories(ctx)].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
      return latest ? { story_id: latest.id } : null;
    },
    build: async (p, ctx) => {
      const s = (await loadFlaggedStories(ctx)).find((x) => x.id === p.story_id);
      if (!s) return null;
      return {
        subject: `Fixed: ${storyLabel(s)}`,
        heading: "An issue you flagged is fixed",
        intro: `IT marked the issue you flagged on ${day(s.created_at.slice(0, 10))} as done: "<b>${esc(storyLabel(s))}</b>".`
          + "<br><br>If it's still happening, flag it again with what you saw.",
        inApp: `Fixed: ${storyLabel(s)}`,
      };
    },
  },
};
