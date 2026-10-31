import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { appPhone, phoneKey } from "../_shared/appMatch.ts";

// Dispatch (migration 20261101100000, page /dispatch): anyone on the team
// books a Kivu Ride trip for a caller, a friend or family member.
//
// The booking goes through the app's partner booking API
// (POST /v2/partner/trips): the app offers the trip to the nearest drivers
// and the first to accept takes it. Every booking is a row in `dispatches`
// with who made it; "status" (the page, every few seconds) and "refresh"
// (pg_cron, every minute) copy what the app says onto it: driver, car,
// trip code, status, final fare.
//
// Places: our own trips' addresses first (dispatch_known_places), then
// OpenStreetMap (Photon search, Nominatim for a dropped pin). A Google Maps
// or WhatsApp location link pasted by the agent is read for its coordinates.
//
// Every booking is real. The MD can tick "test" to book with the sandbox
// key (kr_test_): a test driver plays the trip through and nobody is sent.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-cron-secret",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const cronSecret = Deno.env.get("NOTIFICATIONS_CRON_SECRET");
const liveKey = Deno.env.get("KIVURIDE_LIVE_API_KEY") ?? "";
const testKey = Deno.env.get("KIVURIDE_API_KEY") ?? "";
const apiBase = Deno.env.get("KIVURIDE_API_URL") || "https://kivuride.onrender.com";
const sandboxReady = testKey.startsWith("kr_test_");
const UA = "KivuDaily/1.0 (dispatch; kivuride.com)";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
// deno-lint-ignore no-explicit-any
type Any = any;
class Stop extends Error {}

const FINAL = ["completed", "cancelled", "failed"];
// Rwanda, a little wider: a pin outside it is a mistake.
const inRwanda = (lat: number, lng: number) => lat > -2.95 && lat < -0.95 && lng > 28.75 && lng < 31.0;

// ------------------------------------------------------------------ the app's API
interface ApiRes { status: number; ok: boolean; body: Any; timedOut?: boolean }
async function api(method: string, path: string, opts: { body?: unknown; sandbox?: boolean; timeout?: number } = {}): Promise<ApiRes> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 25_000);
  try {
    const res = await fetch(`${apiBase}${path}`, {
      method, signal: ctrl.signal,
      headers: { "X-API-Key": opts.sandbox ? testKey : (liveKey || testKey), Accept: "application/json", ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, ok: res.ok, body: await res.json().catch(() => null) };
  } catch (err) {
    return { status: 0, ok: false, body: { detail: err instanceof Error ? err.message : String(err) }, timedOut: true };
  } finally {
    clearTimeout(timer);
  }
}
const said = (r: ApiRes) => {
  const b = r.body;
  const m = typeof b?.detail === "string" ? b.detail : Array.isArray(b?.detail) ? b.detail.map((x: Any) => `${(x?.loc ?? []).slice(-1)[0] ?? ""} ${x?.msg ?? x}`.trim()).join("; ") : b?.message ?? b?.error ?? "";
  return String(m || `The app answered ${r.status || "nothing"}`).slice(0, 300);
};

// Vehicle types change rarely: read once per instance, again after 10 minutes.
let typesCache: { at: number; list: Any[] } | null = null;
async function vehicleTypes(): Promise<Any[]> {
  if (typesCache && Date.now() - typesCache.at < 600_000) return typesCache.list;
  const r = await api("GET", "/vehicle-types/");
  const list = (r.body?.data ?? r.body ?? []) as Any[];
  if (!r.ok || !Array.isArray(list)) throw new Stop("Could not read the car types from the app.");
  typesCache = { at: Date.now(), list: list.filter((t) => t.is_active !== false).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) };
  return typesCache.list;
}

// ------------------------------------------------------------------ places
interface Place { address: string; lat: number; lng: number; source: "ours" | "map" | "link" | "pin"; detail?: string; uses?: number }
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

async function places(db: SupabaseClient, q: string): Promise<Place[]> {
  q = q.trim().slice(0, 120);
  if (q.length < 2) return [];
  const [ours, map] = await Promise.all([
    db.rpc("dispatch_known_places", { p_q: q, p_limit: 5 }).then(({ data }) => ((data ?? []) as Any[]).map((p) => ({ address: p.address, lat: p.lat, lng: p.lng, source: "ours" as const, uses: Number(p.uses) }))),
    fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=7&lat=-1.95&lon=30.07&bbox=28.85,-2.85,30.9,-1.05&lang=en`, { headers: { "User-Agent": UA } })
      .then((r) => (r.ok ? r.json() : { features: [] }))
      .then((d) => ((d?.features ?? []) as Any[]).filter((f) => f?.properties?.countrycode === "RW").map((f) => {
        const p = f.properties;
        const name = p.name ?? [p.housenumber, p.street].filter(Boolean).join(" ");
        const detail = [p.name ? p.street : null, p.locality ?? p.district, p.city].filter((x, i, a) => x && a.indexOf(x) === i).join(", ");
        return { address: [name, detail].filter(Boolean).join(", "), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], source: "map" as const, detail: p.osm_value?.replace(/_/g, " ") };
      }))
      .catch(() => [] as Place[]),
  ]);
  const seen = new Set<string>();
  return [...ours, ...map].filter((p) => {
    const k = p.address.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!k || seen.has(k) || !inRwanda(p.lat, p.lng)) return false;
    seen.add(k);
    return true;
  }).slice(0, 10);
}

async function reverse(lat: number, lng: number): Promise<string> {
  try {
    const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1&lang=en`, { headers: { "User-Agent": UA } });
    const p = (await r.json())?.features?.[0]?.properties;
    const parts = [p?.name ?? [p?.housenumber, p?.street].filter(Boolean).join(" "), p?.name ? p?.street : null, p?.locality ?? p?.district, p?.city].filter((x, i, arr) => x && arr.indexOf(x) === i);
    if (parts.length) return parts.join(", ");
  } catch { /* try the next one */ }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&zoom=18&accept-language=en`, { headers: { "User-Agent": UA } });
    const d = await r.json();
    const a = d?.address ?? {};
    const parts = [d?.name || null, a.road, a.neighbourhood ?? a.suburb, a.city ?? a.town ?? a.county].filter((x, i, arr) => x && arr.indexOf(x) === i);
    if (parts.length) return parts.join(", ");
  } catch { /* fall through */ }
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

// Coordinates out of what an agent pastes: "-1.95, 30.06", a Google Maps
// link (long or maps.app.goo.gl), an OpenStreetMap link, a WhatsApp location.
const COORDS = [
  /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/, /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
  /[?&](?:q|ll|query|destination|center|daddr|saddr)=(?:loc:)?(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/,
  /[?&]mlat=(-?\d{1,2}\.\d+)&mlon=(-?\d{1,3}\.\d+)/, /#map=\d+\/(-?\d{1,2}\.\d+)\/(-?\d{1,3}\.\d+)/,
  /^\s*(-?\d{1,2}\.\d{3,})\s*[,;\s]\s*(-?\d{1,3}\.\d{3,})\s*$/,
];
const coordsIn = (s: string) => {
  for (const re of COORDS) { const m = s.match(re); if (m) { const lat = Number(m[1]), lng = Number(m[2]); if (inRwanda(lat, lng)) return { lat, lng }; } }
  return null;
};
const SHORT_HOSTS = ["maps.app.goo.gl", "goo.gl", "g.co", "maps.google.com", "www.google.com", "google.com", "www.openstreetmap.org", "osm.org"];
async function fromLink(text: string): Promise<Place> {
  const direct = coordsIn(text);
  let found = direct;
  if (!found) {
    const url = text.match(/https?:\/\/\S+/)?.[0];
    if (!url) throw new Stop("Paste a Google Maps link, a WhatsApp location link or coordinates like -1.9536, 30.0606.");
    // Follow the short link (only map sites) until the address shows the coordinates.
    let next = url;
    for (let i = 0; i < 5 && !found; i++) {
      const host = new URL(next).hostname.toLowerCase();
      if (!SHORT_HOSTS.includes(host)) throw new Stop("Only Google Maps and OpenStreetMap links can be read.");
      const r = await fetch(next, { redirect: "manual", headers: { "User-Agent": UA } });
      const loc = r.headers.get("location");
      found = coordsIn(decodeURIComponent(next));
      if (found) break;
      if (!loc) {
        const html = await r.text().catch(() => "");
        found = coordsIn(decodeURIComponent(html.slice(0, 200_000)));
        break;
      }
      next = new URL(loc, next).toString();
      found = coordsIn(decodeURIComponent(next));
    }
    if (!found) throw new Stop("No location found in that link. Ask the client to share their location again, or search the place by name.");
  }
  return { address: await reverse(found.lat, found.lng), lat: found.lat, lng: found.lng, source: "link" };
}

// ------------------------------------------------------------------ quote
async function quote(db: SupabaseClient, pickup: { lat: number; lng: number }, destination: { lat: number; lng: number }) {
  const types = await vehicleTypes();
  const [names, ...perType] = await Promise.all([
    db.from("platform_driver_status").select("platform_driver_id, full_name, vehicle_plate, kivu_driver_id"),
    ...types.map(async (t) => {
      const [est, near] = await Promise.all([
        api("POST", "/v2/partner/trips/estimate", { body: { pickup_lat: pickup.lat, pickup_lng: pickup.lng, destination_lat: destination.lat, destination_lng: destination.lng, vehicle_type: t.slug } }),
        api("GET", `/drivers/available?lat=${pickup.lat}&lng=${pickup.lng}&radius_km=5&vehicle_type=${encodeURIComponent(t.slug)}`),
      ]);
      return { t, est, near };
    }),
  ]);
  const byId = new Map<number, Any>(((names.data ?? []) as Any[]).map((d) => [d.platform_driver_id, d]));
  return types.map((t, i) => {
    const { est, near } = perType[i];
    const e = est.body?.data ?? {};
    const drivers = (Array.isArray(near.body) ? near.body : near.body?.data ?? []) as Any[];
    return {
      slug: t.slug, name: t.name, subtitle: t.subtitle ?? null, seats: t.seats ?? null,
      fare: est.ok ? e.estimated_fare ?? null : null, distance_km: e.distance_km ?? null, duration_minutes: e.duration_minutes ?? null,
      error: est.ok ? null : said(est),
      drivers: drivers.map((d) => {
        const known = byId.get(d.id);
        return {
          id: d.id, name: d.full_name ?? known?.full_name ?? null, plate: d.vehicle_plate ?? known?.vehicle_plate ?? null,
          car: [d.vehicle_make, d.vehicle_model, d.vehicle_color].filter(Boolean).join(" ") || null, distance_km: d.distance_km ?? null,
          status: d.status ?? null, rating: d.rating ?? null, ours: !!known?.kivu_driver_id, lat: d.current_lat ?? null, lng: d.current_lng ?? null,
        };
      }).sort((a, b) => (a.distance_km ?? 99) - (b.distance_km ?? 99)),
      drivers_ok: near.ok,
    };
  });
}

// ------------------------------------------------------------------ trips
const trimTo = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
function fromTrip(t: Any) {
  return {
    platform_trip_id: t.id ?? null, status: t.status ?? "requested", trip_code: t.trip_code ?? null,
    driver_name: t.driver?.name ?? null, driver_phone: t.driver?.phone ?? null, driver_rating: t.driver?.rating ?? null,
    vehicle_plate: t.vehicle?.plate ?? null, vehicle_label: [t.vehicle?.make, t.vehicle?.model, t.vehicle?.color].filter(Boolean).join(" ") || null,
    fare: t.fare ?? null, estimated_distance_km: t.estimated_distance_km ?? null, estimated_duration_minutes: t.estimated_duration_minutes ?? null,
    accepted_at: t.accepted_at ?? null, started_at: t.started_at ?? null, completed_at: t.completed_at ?? null,
    cancelled_at: t.cancelled_at ?? null, cancelled_by: t.cancelled_by ?? null, cancellation_reason: t.cancellation_reason ?? null,
    last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}

// The app did not answer the booking: look for it by our reference before saying anything.
async function findByReference(ref: string, sandbox: boolean): Promise<Any | null> {
  const r = await api("GET", "/v2/partner/trips?skip=0&limit=50", { sandbox });
  const items = (r.body?.data?.items ?? []) as Any[];
  return items.find((t) => t.partner_reference === ref) ?? null;
}

async function refreshOne(db: SupabaseClient, row: Any) {
  if (FINAL.includes(row.status)) return row;
  let trip: Any = null;
  if (row.platform_trip_id) {
    const r = await api("GET", `/v2/partner/trips/${row.platform_trip_id}`, { sandbox: row.sandbox });
    if (r.ok) trip = r.body?.data ?? r.body;
  } else if (row.status === "unknown" || row.status === "booking") {
    trip = await findByReference(row.partner_reference, row.sandbox);
    if (!trip && Date.now() - Date.parse(row.created_at) > 10 * 60_000) {
      const { data } = await db.from("dispatches").update({ status: "failed", error: "The app never confirmed this booking.", last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id).select().single();
      return data;
    }
  }
  if (!trip) {
    await db.from("dispatches").update({ last_checked_at: new Date().toISOString() }).eq("id", row.id);
    return row;
  }
  const { data } = await db.from("dispatches").update({ ...fromTrip(trip), error: null }).eq("id", row.id).select().single();
  return data ?? row;
}

interface Who { id: string; md: boolean; dept: string }

async function book(db: SupabaseClient, who: Who, b: Any) {
  const sandbox = b.test === true;
  if (sandbox && !who.md) throw new Stop("Only the MD can make test bookings.");
  if (sandbox && !sandboxReady) throw new Stop("The sandbox key is not set, so test bookings are off.");
  if (!sandbox && !liveKey) throw new Stop("The live key is not set: bookings are off.");

  const name = trimTo(b.client_name, 80);
  const phoneDigits = phoneKey(b.client_phone);
  const email = trimTo(b.client_email, 120) || null;
  const pu = b.pickup ?? {}, de = b.destination ?? {};
  const forKind = ["hotline", "whatsapp", "friend_family", "company", "other"].includes(b.for_kind) ? b.for_kind : "hotline";
  const pay = b.payment_method === "mobile_money" ? "mobile_money" : "cash";
  if (name.length < 2) throw new Stop("Write the client's name.");
  if (phoneDigits.length !== 9 || !/^7[2389]/.test(phoneDigits)) throw new Stop("Write a Rwanda phone number, like 0788 123 456.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Stop("That email address does not look right.");
  for (const [p, l] of [[pu, "pickup"], [de, "destination"]] as const) {
    if (!trimTo(p.address, 300) || !Number.isFinite(num(p.lat)) || !Number.isFinite(num(p.lng))) throw new Stop(`Choose the ${l} from the list, the map or a link.`);
    if (!inRwanda(num(p.lat), num(p.lng))) throw new Stop(`The ${l} is outside Rwanda.`);
  }
  const types = await vehicleTypes();
  const vt = types.find((t) => t.slug === b.vehicle_type);
  if (!vt) throw new Stop("Choose the car type.");

  let scheduled: string | null = null;
  if (b.scheduled_pickup_time) {
    const raw = String(b.scheduled_pickup_time);
    const at = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}+02:00`);
    if (Number.isNaN(at.getTime())) throw new Stop("The pickup time is not a date.");
    if (at.getTime() < Date.now() + 10 * 60_000) throw new Stop("A pickup for later must be at least 10 minutes from now. For now, choose Now.");
    if (at.getTime() > Date.now() + 14 * 86_400_000) throw new Stop("Book at most 14 days ahead.");
    scheduled = at.toISOString();
  }

  // The same person booked for the same phone a moment ago and it is still running: ask first.
  if (!b.confirm_again) {
    const { data: recent } = await db.from("dispatches").select("id, client_name, status, created_at, client_phone")
      .gte("created_at", new Date(Date.now() - 15 * 60_000).toISOString()).not("status", "in", "(completed,cancelled,failed)");
    const same = ((recent ?? []) as Any[]).find((r) => phoneKey(r.client_phone) === phoneDigits);
    if (same) return { ok: false, again: true, error: `${same.client_name} already has a trip booked ${Math.max(1, Math.round((Date.now() - Date.parse(same.created_at)) / 60000))} min ago that is still running. Book another one anyway?` };
  }

  const { data: shift } = await db.from("call_center_shifts").select("id").eq("agent_id", who.id).eq("status", "open").maybeSingle();
  const id = crypto.randomUUID();
  const ref = `KD-${id.slice(0, 8).toUpperCase()}`;
  const row = {
    id, created_by: who.id, shift_id: shift?.id ?? null, for_kind: forKind,
    client_name: name, client_phone: appPhone(b.client_phone), client_email: email,
    pickup_address: trimTo(pu.address, 300), pickup_lat: num(pu.lat), pickup_lng: num(pu.lng),
    destination_address: trimTo(de.address, 300), destination_lat: num(de.lat), destination_lng: num(de.lng),
    vehicle_type: vt.slug, payment_method: pay, scheduled_pickup_time: scheduled, note: trimTo(b.note, 500) || null,
    estimated_fare: Number.isFinite(num(b.estimate?.fare)) ? num(b.estimate.fare) : null,
    estimated_distance_km: Number.isFinite(num(b.estimate?.distance_km)) ? num(b.estimate.distance_km) : null,
    estimated_duration_minutes: Number.isFinite(num(b.estimate?.duration_minutes)) ? num(b.estimate.duration_minutes) : null,
    nearby_drivers: Number.isFinite(num(b.nearby_drivers)) ? num(b.nearby_drivers) : null,
    partner_reference: ref, sandbox, status: "booking",
  };
  const { error: insErr } = await db.from("dispatches").insert(row);
  if (insErr) throw new Error(insErr.message);

  const payload: Record<string, unknown> = {
    pickup_address: row.pickup_address, pickup_lat: row.pickup_lat, pickup_lng: row.pickup_lng,
    destination_address: row.destination_address, destination_lat: row.destination_lat, destination_lng: row.destination_lng,
    vehicle_type: row.vehicle_type, client_name: row.client_name, client_phone: row.client_phone, payment_method: pay, partner_reference: ref,
  };
  if (email) payload.client_email = email;
  if (scheduled) payload.scheduled_pickup_time = scheduled;
  if (sandbox) payload.sandbox_autoplay = true;
  // Never sent twice: a booking with no answer is looked up by its reference instead.
  const r = await api("POST", "/v2/partner/trips", { body: payload, sandbox, timeout: 40_000 });
  if (r.ok) {
    const { data } = await db.from("dispatches").update(fromTrip(r.body?.data ?? r.body)).eq("id", id).select().single();
    return { ok: true, dispatch: data };
  }
  if (r.timedOut || r.status >= 500) {
    const found = await findByReference(ref, sandbox).catch(() => null);
    if (found) {
      const { data } = await db.from("dispatches").update(fromTrip(found)).eq("id", id).select().single();
      return { ok: true, dispatch: data };
    }
    const { data } = await db.from("dispatches").update({ status: "unknown", error: `The app did not answer (${said(r)}). Kivu Daily keeps checking; do not book again yet.`, updated_at: new Date().toISOString() }).eq("id", id).select().single();
    return { ok: true, dispatch: data };
  }
  const { data } = await db.from("dispatches").update({ status: "failed", error: said(r), updated_at: new Date().toISOString() }).eq("id", id).select().single();
  return { ok: false, error: `The app refused the booking: ${said(r)}`, dispatch: data };
}

async function cancel(db: SupabaseClient, who: Who, id: string, reason: string) {
  const { data: row } = await db.from("dispatches").select("*").eq("id", id).maybeSingle();
  if (!row) throw new Stop("Booking not found.");
  if (!(row.created_by === who.id || who.md || who.dept === "call_center")) throw new Stop("Only the person who booked it, the Call Center or the MD can cancel it.");
  if (!row.platform_trip_id) throw new Stop("This booking has no trip in the app to cancel.");
  if (["in_progress", "driver_completed", "completed", "cancelled"].includes(row.status)) throw new Stop("The client is already picked up, or the trip is over: it cannot be cancelled.");
  const why = trimTo(reason, 200) || "Cancelled from Kivu Daily";
  const r = await api("POST", `/v2/partner/trips/${row.platform_trip_id}/cancel`, { body: { reason: why }, sandbox: row.sandbox });
  if (!r.ok) throw new Stop(`The app did not cancel it: ${said(r)}`);
  await db.from("dispatches").update({ ...fromTrip(r.body?.data ?? r.body), cancelled_by_profile: who.id }).eq("id", id);
  const { data } = await db.from("dispatches").select("*").eq("id", id).single();
  return { ok: true, dispatch: data };
}

async function pool<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await f(items[k]); } }));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");

  if (action === "refresh") {
    if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) return json({ error: "Unauthorized" }, 401);
    const { data } = await db.from("dispatches").select("*").not("status", "in", "(completed,cancelled,failed)").gte("created_at", new Date(Date.now() - 3 * 86_400_000).toISOString());
    const rows = (data ?? []) as Any[];
    await pool(rows, 4, (r) => refreshOne(db, r).catch(() => null));
    return json({ ok: true, checked: rows.length });
  }

  // Everyone on the team who is signed in and active.
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const uid = (await userClient.auth.getUser()).data.user?.id ?? null;
  if (!uid) return json({ error: "Unauthorized" }, 401);
  const { data: p } = await db.from("profiles").select("role, is_active, department:departments(slug)").eq("id", uid).maybeSingle();
  if (!p?.is_active) return json({ error: "Unauthorized" }, 401);
  const who: Who = { id: uid, md: p.role === "managing_director", dept: (p.department as { slug?: string } | null)?.slug ?? "" };

  try {
    switch (action) {
      case "config":
        return json({ ok: true, live: !!liveKey, test: who.md && sandboxReady });
      case "places":
        return json({ ok: true, places: await places(db, String(body.q ?? "")) });
      case "reverse": {
        const lat = num(body.lat), lng = num(body.lng);
        if (!inRwanda(lat, lng)) throw new Stop("That point is outside Rwanda.");
        return json({ ok: true, place: { address: await reverse(lat, lng), lat, lng, source: "pin" } });
      }
      case "link":
        return json({ ok: true, place: await fromLink(String(body.text ?? "").slice(0, 2000)) });
      case "quote": {
        const pu = body.pickup ?? {}, de = body.destination ?? {};
        if (![pu.lat, pu.lng, de.lat, de.lng].every((v) => Number.isFinite(num(v)))) throw new Stop("Choose the pickup and the destination first.");
        return json({ ok: true, types: await quote(db, { lat: num(pu.lat), lng: num(pu.lng) }, { lat: num(de.lat), lng: num(de.lng) }) });
      }
      case "book":
        return json(await book(db, who, body));
      case "status": {
        const { data: row } = await db.from("dispatches").select("*").eq("id", String(body.id ?? "")).maybeSingle();
        if (!row || !(row.created_by === who.id || who.md || who.dept === "call_center")) throw new Stop("Booking not found.");
        return json({ ok: true, dispatch: await refreshOne(db, row) });
      }
      case "cancel":
        return json(await cancel(db, who, String(body.id ?? ""), String(body.reason ?? "")));
      default:
        return json({ ok: false, error: "Unknown action" }, 400);
    }
  } catch (err) {
    if (err instanceof Stop) return json({ ok: false, error: err.message });
    console.error(err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
