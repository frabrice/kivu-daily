import { createClient } from "jsr:@supabase/supabase-js@2";

// Copies KivuRide platform trips into platform_trips (see migration
// 20261016110000). Runs every 2 minutes from pg_cron (x-cron-secret), or
// on demand from the Trips page ("Sync now", any signed-in staff member
// who can see trips). The API key stays here as a secret (KIVURIDE_API_KEY).
//
// The platform's /admin/trips has no "changed since" filter, so a normal
// run re-reads trips created in the last 2 days plus any older trip we
// still have as in progress; every 6 hours (or with { full: true }) it
// re-reads everything. Only rows whose content changed are written, so
// the Trips page isn't flooded with identical updates.

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

const FINAL = new Set(["completed", "cancelled"]);
const PAGE = 500;
const FULL_EVERY_MS = 6 * 3600_000;
const CAN_SEE = ["call_center", "fleet", "finance", "it"];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Trip = Record<string, any>;

async function api(path: string, attempt = 0): Promise<Trip> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000); // Render can take a while to wake up
  try {
    const res = await fetch(`${apiBase}${path}`, { headers: { "X-API-Key": apiKey!, Accept: "application/json" }, signal: ctrl.signal });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 3) throw new Error(`KivuRide API ${res.status} on ${path}`);
      const wait = Number(res.headers.get("Retry-After")) || 2 ** attempt * 2;
      await new Promise((r) => setTimeout(r, wait * 1000));
      return api(path, attempt + 1);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`KivuRide API ${res.status} on ${path}: ${JSON.stringify(body?.detail ?? body).slice(0, 300)}`);
    return body;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError" && attempt < 2) return api(path, attempt + 1);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function listAll(query: string): Promise<{ items: Trip[]; total: number }> {
  const items: Trip[] = [];
  let total = 0;
  for (let page = 1; page <= 200; page++) {
    const body = await api(`/admin/trips?limit=${PAGE}&page=${page}${query}`);
    const data = body?.data ?? {};
    items.push(...(data.items ?? []));
    total = data.total ?? items.length;
    if (!data.has_next) break;
  }
  return { items, total };
}

const digits = (p: string | null | undefined) => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : d; // 07xx / +2507xx / 2507xx all end the same
};
const plateKey = (p: string | null | undefined) => (p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

async function sha(text: string) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toRow(t: Trip, match: { driver: Map<string, string>; vehicle: Map<string, string> }) {
  // Never keep the trip code (it starts a ride) or the heavy route lines.
  const { trip_code: _code, suggested_polyline: _sp, driven_polyline: _dp, ...raw } = t;
  const d = t.driver ?? null;
  const rider = t.rider ?? null;
  const riderName = rider?.full_name ?? t.guest_name ?? t.booker_name ?? null;
  const riderPhone = rider?.phone ?? t.guest_phone ?? t.booker_phone ?? null;
  const plate = d?.vehicle_plate ?? null;
  return {
    id: Number(t.id),
    status: String(t.status ?? "unknown"),
    created_at: t.created_at ?? t.requested_at ?? null,
    requested_at: t.requested_at ?? null,
    accepted_at: t.accepted_at ?? null,
    started_at: t.started_at ?? null,
    completed_at: t.completed_at ?? null,
    cancelled_at: t.cancelled_at ?? null,
    is_scheduled: !!t.is_scheduled,
    scheduled_pickup_time: t.scheduled_pickup_time ?? null,
    vehicle_type: t.vehicle_type ?? null,
    passenger_count: num(t.passenger_count),
    pickup_address: t.pickup_address ?? null, pickup_lat: num(t.pickup_lat), pickup_lng: num(t.pickup_lng),
    destination_address: t.destination_address ?? null, destination_lat: num(t.destination_lat), destination_lng: num(t.destination_lng),
    rider_kind: rider ? "app" : t.guest_name || t.guest_phone ? "guest" : t.booker_name ? "booked" : "unknown",
    rider_name: riderName,
    rider_phone: riderPhone,
    platform_driver_id: num(t.driver_id ?? d?.id),
    driver_name: d?.full_name ?? null,
    driver_phone: d?.phone ?? null,
    driver_rating: num(d?.rating),
    vehicle_plate: plate,
    vehicle_label: d ? [d.vehicle_make, d.vehicle_model, d.vehicle_color].filter(Boolean).join(" ") || null : null,
    platform_vehicle_id: num(t.vehicle_id),
    kivu_driver_id: (d?.phone && match.driver.get(digits(d.phone))) || null,
    kivu_vehicle_id: (plate && match.vehicle.get(plateKey(plate))) || null,
    dispatch_method: t.dispatch_method ?? null,
    dispatched_by_admin_id: num(t.dispatched_by_admin_id),
    preferred_driver_id: num(t.preferred_driver_id),
    rejected_driver_count: Array.isArray(t.rejected_driver_ids) ? t.rejected_driver_ids.length : 0,
    estimated_distance_km: num(t.estimated_distance_km), actual_distance_km: num(t.actual_distance_km),
    estimated_duration_minutes: num(t.estimated_duration_minutes), actual_duration_minutes: num(t.actual_duration_minutes),
    base_fare: num(t.base_fare), distance_fare: num(t.distance_fare), time_fare: num(t.time_fare), surge_multiplier: num(t.surge_multiplier),
    waiting_minutes: num(t.total_waiting_minutes), waiting_fee: num(t.waiting_fee),
    extras_total: Array.isArray(t.extra_costs) ? t.extra_costs.reduce((s: number, x: Trip) => s + (Number(x?.amount) || 0), 0) : null,
    total_fare: num(t.total_fare ?? t.fare),
    payment_method: t.payment_method ?? null,
    payment_status: t.payment_status ?? null,
    rider_rating: num(t.user_rating),
    driver_rating_of_rider: num(t.driver_rating),
    rider_feedback: t.user_feedback ?? null,
    driver_feedback: t.driver_feedback ?? null,
    fraud_flag: !!t.fraud_flag,
    code_verified: !!t.code_verified,
    distance_source: t.distance_source ?? null,
    telemetry_status: t.telemetry_status ?? null,
    raw,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await req.json().catch(() => ({}));

  // Auth: the cron secret, or a signed-in member of a team that sees trips.
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
  const { data: state } = await db.from("platform_sync_state").select("*").eq("key", "trips").maybeSingle();
  await db.from("platform_sync_state").upsert({ key: "trips", last_run_at: started });

  try {
    const { count: have } = await db.from("platform_trips").select("id", { count: "exact", head: true });
    const full = !!body?.full || !have || !state?.last_full_at || Date.now() - Date.parse(state.last_full_at) > FULL_EVERY_MS;

    let trips: Trip[];
    let total: number | null = null;
    if (full) {
      const r = await listAll("");
      trips = r.items; total = r.total;
    } else {
      const since = new Date(Date.now() - 2 * 86400_000).toLocaleDateString("en-CA", { timeZone: "Africa/Kigali" });
      trips = (await listAll(`&date_from=${since}`)).items;
      // Older trips we still have as in progress: read each one again.
      const seen = new Set(trips.map((t) => Number(t.id)));
      const { data: open } = await db.from("platform_trips").select("id").not("status", "in", "(completed,cancelled)").limit(60);
      for (const o of open ?? []) {
        if (seen.has(Number(o.id))) continue;
        const one = await api(`/admin/trips/${o.id}`).catch(() => null);
        if (one?.data) trips.push(one.data);
      }
    }

    // Match to our own drivers (phone) and cars (plate).
    const [{ data: ds }, { data: vs }] = await Promise.all([
      db.from("drivers").select("id, phone, contract_status, updated_at"),
      db.from("vehicles").select("id, plate_number"),
    ]);
    const driver = new Map<string, string>();
    // Active contracts win over ended ones when a phone appears twice.
    for (const d of (ds ?? []).sort((a, b) => (a.contract_status === "active" ? 1 : 0) - (b.contract_status === "active" ? 1 : 0))) if (d.phone) driver.set(digits(d.phone), d.id);
    const vehicle = new Map<string, string>((vs ?? []).map((v) => [plateKey(v.plate_number), v.id]));

    // Only write what changed.
    const rows = await Promise.all(trips.filter((t) => t?.id).map(async (t) => {
      const row = toRow(t, { driver, vehicle });
      return { ...row, raw_hash: await sha(JSON.stringify(row)) };
    }));
    const existing = new Map<number, { raw_hash: string; status: string }>();
    for (let i = 0; i < rows.length; i += 300) {
      const ids = rows.slice(i, i + 300).map((r) => r.id);
      const { data } = await db.from("platform_trips").select("id, raw_hash, status").in("id", ids);
      for (const e of data ?? []) existing.set(Number(e.id), { raw_hash: e.raw_hash, status: e.status });
    }
    const now = new Date().toISOString();
    const changed = rows.filter((r) => existing.get(r.id)?.raw_hash !== r.raw_hash).map((r) => {
      const prev = existing.get(r.id);
      return { ...r, synced_at: now, ...(prev && prev.status === r.status ? {} : { status_changed_at: now }) };
    });
    for (let i = 0; i < changed.length; i += 200) {
      const { error } = await db.from("platform_trips").upsert(changed.slice(i, i + 200), { onConflict: "id" });
      if (error) throw new Error(`Saving trips: ${error.message}`);
    }
    const statusLog = changed.filter((r) => existing.get(r.id)?.status !== r.status).map((r) => ({ trip_id: r.id, status: r.status, seen_at: now }));
    for (let i = 0; i < statusLog.length; i += 500) await db.from("platform_trip_status_log").insert(statusLog.slice(i, i + 500));

    await db.from("platform_sync_state").upsert({
      key: "trips", last_run_at: started, last_ok_at: new Date().toISOString(), last_error: null, last_changed: changed.length,
      ...(full ? { last_full_at: new Date().toISOString(), platform_total: total } : {}),
    });
    return json({ ok: true, full, read: rows.length, changed: changed.length, new: changed.filter((r) => !existing.has(r.id)).length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("platform_sync_state").upsert({ key: "trips", last_run_at: started, last_error: msg.slice(0, 500) });
    return json({ error: msg }, 502);
  }
});
