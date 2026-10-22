import { createClient } from "jsr:@supabase/supabase-js@2";
import { computeDepositStanding } from "../_shared/depositRules.ts";
import { DEFAULT_HOURS, RosterDriver, RosterFreelance, ShiftHours, ShiftKey, currentShiftDay, expectedFor, kigaliDay } from "../_shared/onShift.ts";

// Copies every platform driver's state in the Kivu Ride app (online or
// not, status, logged in, last seen) into platform_driver_status, matched
// to our drivers and freelancers (phone) and our cars (plate), and logs
// each change online <-> offline in driver_online_log (see migration
// 20261030100000). Runs every 2 minutes from pg_cron (x-cron-secret), or
// on demand from "Ours On Shift" (Refresh). The location itself is never
// stored, only when it was last updated.
//
// It then works out driver_shift_roster: who should be driving on the
// shift running now (or the next one), from cars, shifts, rest days,
// pauses, freelancers and whether each driver is cleared to drive.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-cron-secret",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const cronSecret = Deno.env.get("NOTIFICATIONS_CRON_SECRET");
const apiKey = Deno.env.get("KIVURIDE_API_KEY");
const apiBase = Deno.env.get("KIVURIDE_API_URL") || "https://kivuride.onrender.com";

const PAGE = 100;
const CAN_SEE = ["call_center", "fleet", "finance", "it"];
// Last seen moving by less than this is not worth a write (the app pings often).
const SEEN_STEP_MS = 5 * 60_000;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const phoneKey = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-9);
const plateKey = (p: string | null | undefined) => (p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

interface Upstream {
  id: number; full_name: string | null; phone: string | null; vehicle_plate: string | null;
  is_online: boolean | null; driver_status: string | null; is_currently_logged_in: boolean | null;
  session_last_seen_at: string | null; last_location_update: string | null; app_version: string | null; is_deleted: boolean | null;
}
interface Row {
  platform_driver_id: number; full_name: string | null; phone: string | null; vehicle_plate: string | null; is_online: boolean; driver_status: string | null;
  logged_in: boolean | null; last_seen_at: string | null; last_location_at: string | null; app_version: string | null;
  kivu_driver_id: string | null; freelancer_id: string | null; kivu_vehicle_id: string | null; status_since: string; synced_at: string;
}

async function api(path: string, attempt = 0): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(`${apiBase}${path}`, { headers: { "X-API-Key": apiKey!, Accept: "application/json" }, signal: ctrl.signal });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 2) throw new Error(`KivuRide API ${res.status} on ${path}`);
      await new Promise((r) => setTimeout(r, 2 ** attempt * 2000));
      return api(path, attempt + 1);
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`KivuRide API ${res.status} on ${path}`);
    return body as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

async function allDrivers(): Promise<Upstream[]> {
  const out: Upstream[] = [];
  for (let page = 1; page <= 50; page++) {
    const body = await api(`/admin/drivers?limit=${PAGE}&page=${page}`);
    const data = body?.data as { items?: Upstream[]; has_next?: boolean } | undefined;
    if (!data || !Array.isArray(data.items)) throw new Error("Unexpected response from /admin/drivers");
    out.push(...data.items);
    if (!data.has_next) break;
  }
  // The list can reorder while we page through it (drivers going online): keep one per id.
  return [...new Map(out.map((d) => [d.id, d])).values()];
}

// ------------------------------------------------------------ who should be driving
// deno-lint-ignore no-explicit-any
type Any = any;
async function syncRoster(db: Any, now: number) {
  const today = kigaliDay(now);
  const [{ data: ds }, { data: deps }, { data: hrs }, { data: fl }, { data: fds }, { data: vs }, { data: existing }] = await Promise.all([
    db.from("drivers").select("id, full_name, phone, start_date, rest_day, initial_deposit_paid, initial_deposit_amount, initial_deposit_date, contract_status, vehicle_id, shift, payments_from, opening_credit, rate_history, pauses:driver_pauses(start_date, end_date, approval_status, reason)").eq("contract_status", "active"),
    db.from("driver_deposits").select("driver_id, paid_date, amount, created_at, status"),
    db.from("fleet_shift_hours").select("shift, starts, ends"),
    db.from("freelance_shifts").select("id, day, vehicle_id, shift, freelancer_id, covering_driver_id, status").gte("day", kigaliDay(now - 86400_000)),
    db.from("freelance_drivers").select("id, full_name, phone"),
    db.from("vehicles").select("id, plate_number"),
    db.from("driver_shift_roster").select("*"),
  ]);
  const hours: ShiftHours = { day: { ...DEFAULT_HOURS.day }, night: { ...DEFAULT_HOURS.night } };
  for (const h of (hrs ?? []) as { shift: ShiftKey; starts: string; ends: string }[]) hours[h.shift] = { starts: h.starts.slice(0, 5), ends: h.ends.slice(0, 5) };
  const plate = new Map<string, string>(((vs ?? []) as { id: string; plate_number: string }[]).map((v) => [v.id, v.plate_number]));
  const fname = new Map<string, { full_name: string; phone: string }>(((fds ?? []) as { id: string; full_name: string; phone: string }[]).map((f) => [f.id, f]));
  const drivers: (RosterDriver & { raw: Any })[] = ((ds ?? []) as Any[]).map((d) => ({ ...d, plate: d.vehicle_id ? plate.get(d.vehicle_id) ?? null : null, raw: d }));
  const freelance: RosterFreelance[] = ((fl ?? []) as Any[]).map((f) => ({ ...f, name: fname.get(f.freelancer_id)?.full_name ?? "Freelancer", phone: fname.get(f.freelancer_id)?.phone ?? null, plate: plate.get(f.vehicle_id) ?? null }));
  // Not cleared to drive (payments behind): kept off the road on purpose, not "offline".
  const blockedOf = (id: string) => {
    const d = drivers.find((x) => x.id === id);
    if (!d?.start_date) return null;
    const s = computeDepositStanding(d.raw, ((deps ?? []) as Any[]).filter((x) => x.driver_id === id), today);
    return s.isCleared ? null : "Not cleared to drive (payment)";
  };
  const rows = (["day", "night"] as ShiftKey[]).flatMap((shift) => expectedFor(hours, shift, currentShiftDay(hours, shift, now), drivers, freelance, blockedOf)).map((e) => ({
    key: e.key, kind: e.kind, driver_id: e.driverId, freelancer_id: e.freelancerId, name: e.name, phone: e.phone, plate: e.plate, vehicle_id: e.vehicleId,
    shift: e.shift, day: e.day, starts_at: new Date(e.start).toISOString(), ends_at: new Date(e.end).toISOString(), blocked: e.blocked,
  }));
  // Write only what changed; remove shifts that are over or no longer expected.
  const old = new Map<string, Any>(((existing ?? []) as Any[]).map((r) => [r.key, r]));
  const same = (a: Record<string, unknown>, b: Record<string, unknown>) => Object.keys(a).every((k) => (k === "starts_at" || k === "ends_at" ? Date.parse(String(a[k])) === Date.parse(String(b[k])) : (a[k] ?? null) === (b[k] ?? null)));
  const changed = rows.filter((r) => !old.has(r.key) || !same(r, old.get(r.key)));
  const gone = [...old.keys()].filter((k) => !rows.some((r) => r.key === k));
  if (changed.length) {
    const { error } = await db.from("driver_shift_roster").upsert(changed.map((r) => ({ ...r, computed_at: new Date(now).toISOString() })), { onConflict: "key" });
    if (error) throw new Error(error.message);
  }
  if (gone.length) {
    const { error } = await db.from("driver_shift_roster").delete().in("key", gone);
    if (error) throw new Error(error.message);
  }
  return { expected: rows.length, changed: changed.length, removed: gone.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Auth: the cron secret, or a signed-in member of a team that sees drivers' status.
  const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  if (!isCron) {
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const { data: p } = await db.from("profiles").select("role, is_active, department:departments(slug)").eq("id", user.id).maybeSingle();
    const slug = (p?.department as { slug?: string } | null)?.slug ?? "";
    if (!p?.is_active || !(p.role === "managing_director" || CAN_SEE.includes(slug))) return json({ error: "Unauthorized" }, 401);
  }
  if (!apiKey) return json({ error: "KIVURIDE_API_KEY is not set" }, 500);

  const started = new Date().toISOString();
  await db.from("platform_sync_state").upsert({ key: "drivers", last_run_at: started });
  try {
    const [upstream, { data: ds }, { data: fs }, { data: vs }, { data: prevRows }] = await Promise.all([
      allDrivers(),
      db.from("drivers").select("id, phone, contract_status"),
      db.from("freelance_drivers").select("id, phone"),
      db.from("vehicles").select("id, plate_number"),
      db.from("platform_driver_status").select("*"),
    ]);
    // Our drivers by phone: an active contract wins over an ended one.
    const driver = new Map<string, string>();
    for (const d of (ds ?? []).sort((a, b) => (a.contract_status === "active" ? 1 : 0) - (b.contract_status === "active" ? 1 : 0))) if (phoneKey(d.phone)) driver.set(phoneKey(d.phone), d.id);
    const freelancer = new Map<string, string>((fs ?? []).filter((f) => phoneKey(f.phone)).map((f) => [phoneKey(f.phone), f.id]));
    const vehicle = new Map<string, string>((vs ?? []).map((v) => [plateKey(v.plate_number), v.id]));
    const prev = new Map<number, Row>(((prevRows ?? []) as Row[]).map((r) => [r.platform_driver_id, r]));

    const writes: Row[] = [];
    const log: { platform_driver_id: number; kivu_driver_id: string | null; freelancer_id: string | null; is_online: boolean; at: string }[] = [];
    for (const u of upstream) {
      if (u.is_deleted) continue;
      const before = prev.get(u.id);
      const online = !!u.is_online;
      const row: Row = {
        platform_driver_id: u.id, full_name: u.full_name, phone: u.phone, vehicle_plate: u.vehicle_plate, is_online: online, driver_status: u.driver_status,
        logged_in: u.is_currently_logged_in, last_seen_at: u.session_last_seen_at, last_location_at: u.last_location_update, app_version: u.app_version,
        kivu_driver_id: driver.get(phoneKey(u.phone)) ?? null, freelancer_id: freelancer.get(phoneKey(u.phone)) ?? null,
        kivu_vehicle_id: (u.vehicle_plate && vehicle.get(plateKey(u.vehicle_plate))) || null,
        status_since: before && before.is_online === online ? before.status_since : started, synced_at: started,
      };
      if (!before || before.is_online !== online) log.push({ platform_driver_id: u.id, kivu_driver_id: row.kivu_driver_id, freelancer_id: row.freelancer_id, is_online: online, at: started });
      const moved = (a: string | null, b: string | null) => (a ? Date.parse(a) : 0) - (b ? Date.parse(b) : 0) >= SEEN_STEP_MS || (!!a !== !!b);
      const changed = !before || before.is_online !== online || before.driver_status !== row.driver_status || before.logged_in !== row.logged_in
        || before.full_name !== row.full_name || before.phone !== row.phone || before.vehicle_plate !== row.vehicle_plate || before.app_version !== row.app_version
        || before.kivu_driver_id !== row.kivu_driver_id || before.freelancer_id !== row.freelancer_id || before.kivu_vehicle_id !== row.kivu_vehicle_id
        || moved(row.last_seen_at, before.last_seen_at) || moved(row.last_location_at, before.last_location_at);
      if (changed) writes.push(row);
    }
    for (let i = 0; i < writes.length; i += 200) {
      const { error } = await db.from("platform_driver_status").upsert(writes.slice(i, i + 200), { onConflict: "platform_driver_id" });
      if (error) throw new Error(error.message);
    }
    if (log.length) {
      const { error } = await db.from("driver_online_log").insert(log);
      if (error) throw new Error(error.message);
    }
    const roster = await syncRoster(db, Date.parse(started));
    await db.from("platform_sync_state").upsert({ key: "drivers", last_run_at: started, last_ok_at: new Date().toISOString(), last_error: null, last_changed: writes.length, platform_total: upstream.length });
    return json({ ok: true, drivers: upstream.length, written: writes.length, changes: log.length, online: upstream.filter((u) => u.is_online && !u.is_deleted).length, roster });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("platform_sync_state").upsert({ key: "drivers", last_run_at: started, last_error: message.slice(0, 500) });
    return json({ error: message }, 500);
  }
});
