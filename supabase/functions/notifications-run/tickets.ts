import { Block, Built, cached, Ctx, esc, firstName, hm, MON_SAT, personName, plural, RuleDef, rows } from "./core.ts";

// Call Center tickets: a caller's issue the agent couldn't solve on the
// call, assigned to whoever is in charge. Emails carry everything the
// assignee needs to act without opening the app first, and a button
// straight to the ticket.

export interface TicketRow {
  id: string; reference: string; caller_name: string; caller_phone: string; caller_email: string | null; caller_type: string;
  driver_id: string | null; platform_driver_id: string | null; category: string; priority: "normal" | "urgent" | "emergency";
  details: string; status: string; resolved_on_call: boolean; assignee_id: string | null; created_by: string | null;
  resolution_note: string | null; resolved_by: string | null; resolved_at: string | null; created_at: string; last_activity_at: string;
  channel: string; situation: string | null; trip_reference: string | null; vehicle_plate: string | null; actions_taken: string | null;
  promised_update_at: string | null; first_response_at: string | null; assigned_at: string | null; callback_at: string | null;
  emergency_details: Record<string, unknown> | null; md_acknowledged_at: string | null; satisfaction: string | null;
  driver: { full_name: string; vehicle: { plate_number: string } | null } | null;
  platform_driver: { full_name: string; phone: string | null } | null;
}

// Ticket categories are the Script Book's sections (plus the original
// categories, kept for older tickets).
export const CATEGORY_LABEL: Record<string, string> = {
  booking: "Booking & dispatch", fares_payments: "Fares & payments", before_pickup: "Before pickup", during_trip: "During the trip",
  lost_property: "Lost property", complaint: "Complaint", emergency: "Emergency & safety", driver_support: "Driver support",
  fleet_partner: "Fleet owner / partner", smart_account: "Smart Account", general: "General enquiry",
  app: "App problem", payment: "Payment", trip: "Trip", driver_behaviour: "Driver behaviour", lost_item: "Lost item", other: "Other",
};
const CALLER_TYPE_LABEL: Record<string, string> = {
  passenger: "Passenger", driver: "Driver", car_owner: "Fleet owner", partner: "Partner", smart_account: "Smart Account member",
  prospective_driver: "Prospective driver", organization: "Organisation / hotel", government_media: "Government / media", other: "Other",
};
const CHANNEL_LABEL: Record<string, string> = { call: "Call", whatsapp: "WhatsApp", sms: "SMS", web: "Website" };
// The Script Book's status words (13A).
const STATUS_LABEL: Record<string, string> = {
  open: "Assigned", in_progress: "In progress", waiting_on_caller: "Pending", resolved: "Resolved", closed: "Closed",
};
export const UNRESOLVED = ["open", "in_progress", "waiting_on_caller"];

export function loadTickets(ctx: Ctx) {
  return cached(ctx, "tickets", () => rows<TicketRow>(ctx.db.from("call_tickets").select(
    "id, reference, caller_name, caller_phone, caller_email, caller_type, driver_id, platform_driver_id, category, priority, details, status, resolved_on_call, assignee_id, created_by, resolution_note, resolved_by, resolved_at, created_at, last_activity_at, channel, situation, trip_reference, vehicle_plate, actions_taken, promised_update_at, first_response_at, assigned_at, callback_at, emergency_details, md_acknowledged_at, satisfaction, driver:drivers(full_name, vehicle:vehicles(plate_number)), platform_driver:platform_drivers(full_name, phone)",
  ).order("created_at", { ascending: false }).limit(1000)));
}

async function ticket(ctx: Ctx, id: unknown) {
  return (await loadTickets(ctx)).find((t) => t.id === id) ?? null;
}

// Resolution target: still unresolved 24 hours after an urgent call, or
// 3 days after a normal one.
export function isOverdue(t: TicketRow, now = Date.now()) {
  if (!UNRESOLVED.includes(t.status)) return false;
  const hours = (now - new Date(t.created_at).getTime()) / 3600000;
  return hours > (t.priority === "normal" ? 72 : 24);
}

// The Script Book's two-hour standard: the owner hasn't acted at all.
export function isResponseOverdue(t: TicketRow, now = Date.now()) {
  if (!UNRESOLVED.includes(t.status) || t.first_response_at || t.priority === "emergency") return false;
  return now - new Date(t.assigned_at ?? t.created_at).getTime() > 2 * 3600000;
}

export function waitingFor(t: TicketRow, now = Date.now()) {
  const h = Math.floor((now - new Date(t.created_at).getTime()) / 3600000);
  return h < 24 ? plural(h, "hour") : plural(Math.floor(h / 24), "day");
}

const kigaliTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" });

const phoneLink = (p: string) => `<a href="tel:${esc(p.replace(/[^\d+]/g, ""))}">${esc(p)}</a>`;
const urgentTag = '<span style="background:#dc2626;color:#fff;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;">URGENT</span>';
const emergencyTag = '<span style="background:#7f1d1d;color:#fff;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;">EMERGENCY</span>';
const quote = (s: string) => `<div style="border-left:3px solid #2F8C86;background:#f8fafc;padding:10px 12px;margin:4px 0 8px;white-space:pre-wrap;">${esc(s)}</div>`;
const priorityTag = (t: TicketRow) => (t.priority === "emergency" ? emergencyTag : t.priority === "urgent" ? urgentTag : "Normal");
const subjectPrefix = (t: TicketRow) => (t.priority === "emergency" ? "EMERGENCY: " : t.priority === "urgent" ? "URGENT: " : "");

function involved(t: TicketRow): string | null {
  if (t.driver) return `${esc(t.driver.full_name)}${t.driver.vehicle ? ` · ${esc(t.driver.vehicle.plate_number)}` : ""} (our driver)`;
  if (t.platform_driver) return `${esc(t.platform_driver.full_name)}${t.vehicle_plate ? ` · ${esc(t.vehicle_plate)}` : ""} (Non-Insider driver)`;
  if (t.vehicle_plate) return esc(t.vehicle_plate);
  return null;
}

function callerTable(t: TicketRow, ctx: Ctx): Block["table"] {
  const rowsOut: string[][] = [
    ["Reference", `<b>${esc(t.reference)}</b>`],
    ["Priority", priorityTag(t)],
    ["Situation", esc(t.situation ?? CATEGORY_LABEL[t.category] ?? t.category)],
    ["Caller", `${esc(t.caller_name)} (${CALLER_TYPE_LABEL[t.caller_type] ?? t.caller_type})`],
    ["Phone", phoneLink(t.caller_phone)],
  ];
  if (t.caller_email) rowsOut.push(["Email", `<a href="mailto:${esc(t.caller_email)}">${esc(t.caller_email)}</a>`]);
  const who = involved(t);
  if (who) rowsOut.push(["Driver / car", who]);
  if (t.trip_reference) rowsOut.push(["Trip", esc(t.trip_reference)]);
  rowsOut.push(["Received", `${CHANNEL_LABEL[t.channel] ?? t.channel} · ${esc(personName(ctx, t.created_by))}, ${kigaliTime(t.created_at)}`]);
  if (t.promised_update_at && UNRESOLVED.includes(t.status)) rowsOut.push(["Caller promised an update by", `<b>${kigaliTime(t.promised_update_at)}</b>`]);
  return { head: ["", ""], rows: rowsOut };
}

function emergencyBlock(t: TicketRow): Block | null {
  const e = t.emergency_details;
  if (!e) return null;
  const line = (label: string, v: unknown) => (v ? `<b>${label}:</b> ${esc(Array.isArray(v) ? v.join(", ") : String(v))}<br>` : "");
  return { heading: "Emergency details", text: line("Exact location", e.location) + line("Injuries / danger", e.injuries) + line("Emergency service called", e.services_called) + line("People involved", e.people) };
}

const openTicket = (t: TicketRow) => ({ label: "Open ticket", query: `ticket=${t.id}` });

async function sampleTicket(ctx: Ctx) {
  const latest = (await loadTickets(ctx)).find((t) => !t.resolved_on_call);
  return latest ? { ticket_id: latest.id, note: "Example note", action: "note", reason: "new" } : null;
}

const ACTION_VERB: Record<string, string> = {
  start: "started working on", waiting: "needs something from the caller on", note: "added a note to",
  reassign: "reassigned", close: "closed",
};

export const ticketRules: Record<string, RuleDef> = {
  ticket_emergency: {
    kind: "event",
    sample: async (ctx) => {
      const t = (await loadTickets(ctx)).find((x) => !x.resolved_on_call);
      return t ? { ticket_id: t.id } : null;
    },
    build: async (p, ctx): Promise<Built | null> => {
      const t = await ticket(ctx, p.ticket_id);
      if (!t) return null;
      const blocks: Block[] = [{ table: callerTable(t, ctx) }];
      const em = emergencyBlock(t);
      if (em) blocks.push(em);
      blocks.push({ heading: "What the caller said", text: quote(t.details) });
      if (t.actions_taken) blocks.push({ heading: "What the agent already did", text: quote(t.actions_taken) });
      blocks.push({ text: `Assigned to <b>${esc(personName(ctx, t.assignee_id))}</b>. The case can't be closed until the MD presses <b>Acknowledge</b> on it.` });
      return {
        subject: `EMERGENCY ${t.reference} — ${t.situation ?? "safety incident"}${t.vehicle_plate ? `, ${t.vehicle_plate}` : ""}`,
        heading: "Emergency call",
        intro: `<b>${esc(personName(ctx, t.created_by))}</b> logged an emergency call from ${esc(t.caller_name)} (${phoneLink(t.caller_phone)}).`,
        blocks,
        cta: openTicket(t),
        inApp: `EMERGENCY ${t.reference}: ${t.situation ?? "safety incident"}`,
      };
    },
  },

  ticket_response_overdue: {
    kind: "event",
    sample: sampleTicket,
    build: async (p, ctx) => {
      const t = await ticket(ctx, p.ticket_id);
      if (!t || !UNRESOLVED.includes(t.status) || t.first_response_at) return null;
      const owner = personName(ctx, t.assignee_id);
      return {
        subject: `No response in 2 hours: ${t.reference} — ${t.caller_name}`,
        heading: "A caller is waiting for a response",
        intro: `${esc(t.reference)} was assigned to <b>${esc(owner)}</b> ${waitingFor({ ...t, created_at: t.assigned_at ?? t.created_at })} ago and nobody has responded yet. The Script Book promises callers an initial response within two hours.`
          + `<br><br>${esc(owner.split(" ")[0])}: open it and press <b>Start working</b> or add a note — even "looking into it" counts.`,
        blocks: [{ table: callerTable(t, ctx) }, { heading: "What the caller said", text: quote(t.details) }],
        cta: openTicket(t),
        inApp: `No response in 2 hours: ${t.reference}`,
      };
    },
  },

  ticket_assigned: {
    kind: "event",
    sample: sampleTicket,
    build: async (p, ctx): Promise<Built | null> => {
      const t = await ticket(ctx, p.ticket_id);
      if (!t || !UNRESOLVED.includes(t.status)) return null;
      const actor = personName(ctx, p.actor_id as string);
      const reason = String(p.reason ?? "new");
      const lead = reason === "reassigned"
        ? `${esc(actor)} reassigned this ticket to you.`
        : reason === "reopened"
          ? `${esc(actor)} reopened this ticket — the caller says it isn't fixed yet.`
          : `${esc(actor)} from the Call Center took this call and needs you to handle it.`;
      const blocks: Block[] = [{ table: callerTable(t, ctx) }];
      const em = emergencyBlock(t);
      if (em) blocks.push(em);
      blocks.push({ heading: "What the caller said", text: quote(t.details) });
      if (t.actions_taken) blocks.push({ heading: "What the agent already did", text: quote(t.actions_taken) });
      blocks.push({
        text: `<b>Respond within 2 hours</b> (the Script Book standard): open the case and press <b>Start working</b> or add a note. When it's done, mark it <b>Resolved</b> with what you did — the Call Center will update ${esc(firstName(t.caller_name))}.`,
      });
      return {
        subject: `${subjectPrefix(t)}${reason === "reopened" ? "Reopened" : reason === "reassigned" ? "Reassigned to you" : "New case"} ${t.reference} — ${t.situation ?? CATEGORY_LABEL[t.category] ?? t.category}, ${t.caller_name}`,
        heading: `${reason === "reopened" ? "Case reopened" : "A case for you from the Call Center"}`,
        intro: lead + (p.note ? `<br>${quote(String(p.note))}` : ""),
        blocks,
        cta: openTicket(t),
        inApp: `${subjectPrefix(t)}case ${t.reference} from the Call Center: ${t.situation ?? CATEGORY_LABEL[t.category] ?? t.category}, ${t.caller_name}`,
      };
    },
  },

  ticket_activity: {
    kind: "event",
    sample: sampleTicket,
    build: async (p, ctx) => {
      const t = await ticket(ctx, p.ticket_id);
      if (!t) return null;
      const actor = personName(ctx, p.actor_id as string);
      const action = String(p.action ?? "note");
      const callNow = action === "waiting";
      return {
        subject: callNow
          ? `Please call ${t.caller_name} — ${t.reference} needs more information`
          : `${t.reference}: ${actor} ${ACTION_VERB[action] ?? "updated"} ${action === "reassign" ? `it to ${personName(ctx, t.assignee_id)}` : "the ticket"}`,
        heading: callNow ? "Please call the caller" : `Update on ${esc(t.reference)}`,
        intro: `<b>${esc(actor)}</b> ${ACTION_VERB[action] ?? "updated"} ${action === "reassign" ? `${esc(t.reference)} to <b>${esc(personName(ctx, t.assignee_id))}</b>` : esc(t.reference)}.`
          + (p.note ? quote(String(p.note)) : "")
          + (callNow ? `Call ${esc(t.caller_name)} on ${phoneLink(t.caller_phone)}, get what's needed, and add it as a note on the ticket.` : ""),
        blocks: [{ text: `Status: <b>${STATUS_LABEL[t.status] ?? t.status}</b> · ${esc(t.caller_name)} · ${CATEGORY_LABEL[t.category] ?? t.category}` }],
        cta: openTicket(t),
        inApp: `${t.reference}: ${actor} ${ACTION_VERB[action] ?? "updated"} the ticket`,
      };
    },
  },

  ticket_resolved: {
    kind: "event",
    sample: sampleTicket,
    build: async (p, ctx) => {
      const t = await ticket(ctx, p.ticket_id);
      if (!t || t.status !== "resolved") return null;
      return {
        subject: `Resolved: ${t.reference} — please call ${t.caller_name} back`,
        heading: "Resolved — call the caller back",
        intro: `<b>${esc(personName(ctx, t.resolved_by))}</b> resolved ${esc(t.reference)}:${quote(t.resolution_note ?? "")}`
          + `Call <b>${esc(t.caller_name)}</b> on ${phoneLink(t.caller_phone)} and tell them. Then mark the ticket <b>Closed</b> — or <b>Reopen</b> it if they say it isn't fixed.`,
        blocks: [{ heading: "Their original issue", text: quote(t.details) }],
        cta: openTicket(t),
        inApp: `Resolved: ${t.reference} — call ${t.caller_name} back`,
      };
    },
  },

  ticket_open_digest: {
    kind: "scheduled", days: MON_SAT, at: hm(8),
    build: async (ctx) => {
      const open = (await loadTickets(ctx)).filter((t) => UNRESOLVED.includes(t.status) && t.assignee_id);
      const byPerson = new Map<string, TicketRow[]>();
      for (const t of open) byPerson.set(t.assignee_id!, [...(byPerson.get(t.assignee_id!) ?? []), t]);
      return [...byPerson].map(([id, mine]): Built => {
        // No response yet first, then past target, then urgency, then oldest.
        const rank = (t: TicketRow) => (isResponseOverdue(t) ? 0 : isOverdue(t) ? 1 : 3) + (t.priority === "normal" ? 1 : 0);
        mine.sort((a, b) => rank(a) - rank(b) || a.created_at.localeCompare(b.created_at));
        const late = mine.filter((t) => isResponseOverdue(t) || isOverdue(t)).length;
        return {
          recipients: [id],
          subject: `You have ${plural(mine.length, "open case")} from the Call Center${late ? `, ${late} overdue` : ""}`,
          heading: "Your open Call Center cases",
          intro: "Callers are waiting on these. Update each one — even a note tells the Call Center what to say if the caller rings again.",
          table: {
            head: ["Case", "Caller", "Situation", "Status", "Waiting"],
            rows: mine.map((t) => [
              `${esc(t.reference)}${t.priority !== "normal" ? ` ${priorityTag(t)}` : ""}`,
              esc(t.caller_name), esc(t.situation ?? CATEGORY_LABEL[t.category] ?? t.category), STATUS_LABEL[t.status] ?? t.status,
              isResponseOverdue(t) ? `<span style="color:#dc2626;font-weight:600;">${waitingFor(t)} — no response yet</span>`
                : isOverdue(t) ? `<span style="color:#dc2626;font-weight:600;">${waitingFor(t)} — overdue</span>` : waitingFor(t),
            ]),
          },
          cta: { label: "Open From Call Center", query: "page=from_call_center" },
          inApp: `${plural(mine.length, "open case")} from the Call Center${late ? `, ${late} overdue` : ""}`,
        };
      });
    },
  },
};
