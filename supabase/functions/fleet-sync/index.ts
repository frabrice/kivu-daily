import { createClient } from "jsr:@supabase/supabase-js@2";
import { appPhone, driverMatcher, localPhone, nameWords, phoneKey, plateKey, sameName } from "../_shared/appMatch.ts";

// Under Management (migration 20261031110000): Kivu Daily and the Kivu Ride
// app in step for every car we manage and its drivers.
//
// "sync" (every 10 minutes from pg_cron, or "Check now"): copies the app's
// fleet companies, their cars (day/night roster, who drives now) and which
// company each driver is in; matches them to our cars (link, else plate) and
// drivers (_shared/appMatch.ts); then lists every difference as a case in
// fleet_sync_cases ("To confirm"). A difference that goes away closes its
// case; one someone dismissed stays dismissed.
//
// The other actions change Kivu Daily and/or the app, one click by the MD or
// Fleet each, and are logged in fleet_sync_log with what the app answered.
// Creating checks the app first (phone, licence, plate): if the driver or car
// is already there it is linked instead, never created twice. Writes to the
// app use the live key, which never leaves the server.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-cron-secret",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const cronSecret = Deno.env.get("NOTIFICATIONS_CRON_SECRET");
const liveKey = Deno.env.get("KIVURIDE_LIVE_API_KEY");
const readKey = liveKey || Deno.env.get("KIVURIDE_API_KEY");
const apiBase = Deno.env.get("KIVURIDE_API_URL") || "https://kivuride.onrender.com";

const SEE = ["fleet", "finance", "it"];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
// deno-lint-ignore no-explicit-any
type Any = any;

// ------------------------------------------------------------------ the app's API
interface ApiRes { status: number; ok: boolean; body: Any }
async function api(method: string, path: string, body?: unknown, attempt = 0): Promise<ApiRes> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${apiBase}${path}`, {
      method, signal: ctrl.signal,
      headers: { "X-API-Key": (method === "GET" ? readKey : liveKey)!, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    // Only reads are retried: a write is never sent twice.
    if (method === "GET" && (res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2 ** attempt * 2000));
      return api(method, path, body, attempt + 1);
    }
    return { status: res.status, ok: res.ok, body: await res.json().catch(() => null) };
  } finally {
    clearTimeout(timer);
  }
}
async function get(path: string): Promise<Any> {
  const r = await api("GET", path);
  if (!r.ok) throw new Error(`KivuRide API ${r.status} on ${path.split("?")[0]}`);
  return r.body?.data ?? r.body;
}
// What the app said, in a sentence.
const said = (r: ApiRes) => {
  const b = r.body;
  const m = typeof b?.detail === "string" ? b.detail : Array.isArray(b?.detail) ? b.detail.map((x: Any) => x?.msg ?? String(x)).join("; ") : b?.message ?? b?.error ?? "";
  return `${r.status}${m ? ` ${String(m).slice(0, 300)}` : ""}`;
};
async function pool<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await f(items[k]); } }));
  return out;
}

interface AppCompany { id: number; name: string; fleet_code: string | null; status: string | null; driver_count: number | null }
interface AppVehicle {
  id: number; plate: string; make: string | null; model: string | null; year: number | null; color: string | null; seats: number | null; fuel_type: string | null;
  status: string | null; is_approved: boolean | null; fleet_company_id: number | null; owner_driver_id: number | null;
  insurance_expiry: string | null; registration_expiry: string | null;
  active_assignment: { driver_id: number; driver_name: string | null; driver_phone: string | null; assigned_at: string | null } | null;
}
interface AppDriver { id: number; full_name: string | null; phone: string | null; email?: string | null; vehicle_plate: string | null; is_approved: boolean | null; is_rejected: boolean | null; is_deleted: boolean | null; license_number: string | null; license_expiry?: string | null; is_online: boolean | null }
interface RosterEntry { driver_id: number; name: string | null; phone: string | null; label: string | null }

async function pagedDrivers(query: string): Promise<AppDriver[]> {
  const out: AppDriver[] = [];
  for (let page = 1; page <= 50; page++) {
    const d = await get(`/admin/drivers?limit=100&page=${page}${query}`);
    out.push(...(d?.items ?? []));
    if (!d?.has_next) break;
  }
  return out;
}
const rosterOf = async (vehicleId: number): Promise<RosterEntry[]> => {
  const d = await get(`/v2/admin/vehicles/${vehicleId}/dedicated-drivers`);
  return ((Array.isArray(d) ? d : d?.items ?? []) as Any[]).filter((x) => !x.removed_at).map((x) => ({ driver_id: x.driver_id, name: x.driver_name ?? null, phone: x.driver_phone ?? null, label: x.label ?? null }));
};

async function readApp() {
  const companies = ((await get("/v2/fleet/companies?limit=100"))?.items ?? []) as AppCompany[];
  const vehicles: AppVehicle[] = [];
  for (let skip = 0; skip < 5000; skip += 200) {
    const d = await get(`/v2/admin/vehicles?limit=200&skip=${skip}`);
    vehicles.push(...(d?.items ?? []));
    if (!d?.has_next) break;
  }
  const [all, members] = await Promise.all([
    pagedDrivers(""),
    pool(companies, 4, async (c) => ({ company: c.id, drivers: await pagedDrivers(`&fleet_company_id=${c.id}`) })),
  ]);
  const fleetCars = vehicles.filter((v) => v.fleet_company_id && v.status !== "decommissioned");
  const rosters = new Map<number, RosterEntry[]>(await pool(fleetCars, 5, async (v) => [v.id, await rosterOf(v.id)] as [number, RosterEntry[]]));
  const drivers = new Map<number, AppDriver>(all.map((d) => [d.id, d]));
  for (const m of members) for (const d of m.drivers) if (!drivers.has(d.id)) drivers.set(d.id, d);
  const memberOf = new Map<number, number>();
  for (const m of members) for (const d of m.drivers) memberOf.set(d.id, m.company);
  return { companies, vehicles, drivers, memberOf, rosters };
}

// ------------------------------------------------------------------ sync
interface Case {
  key: string; kind: string; title: string; driver_id?: string | null; vehicle_id?: string | null; platform_driver_id?: number | null; platform_vehicle_id?: number | null;
  kd_value?: string | null; app_value?: string | null; details?: Record<string, unknown>;
}
const WORKING_STAGES = ["ready", "active"];

async function sync(db: Any) {
  const started = new Date().toISOString();
  const app = await readApp();
  const [{ data: ds }, { data: fs }, { data: vs }, { data: dl }, { data: vl }, { data: rj }, { data: oldCo }, { data: owners }, { data: oldCases }] = await Promise.all([
    db.from("drivers").select("id, full_name, phone, phone_alt, email, stage, contract_status, vehicle_id, shift"),
    db.from("freelance_drivers").select("id, full_name, phone"),
    db.from("vehicles").select("id, plate_number, make, model, color, owner_id"),
    db.from("driver_app_links").select("driver_id, freelancer_id, platform_driver_id"),
    db.from("vehicle_app_links").select("vehicle_id, platform_vehicle_id"),
    db.from("app_match_rejects").select("driver_id, platform_driver_id"),
    db.from("platform_fleet_companies").select("id, kind, owner_id, owner_confirmed"),
    db.from("vehicle_owners").select("id, full_name"),
    db.from("fleet_sync_cases").select("id, key, status, first_seen_at, resolved_by, resolved_at, resolution"),
  ]);
  const kdDrivers = (ds ?? []) as Any[];
  const kdCars = (vs ?? []) as Any[];
  const ownerName = new Map<string, string>(((owners ?? []) as Any[]).map((o) => [o.id, o.full_name]));

  // 1. Companies: keep the kind and owner people chose; guess the owner by name until someone confirms.
  const prevCo = new Map<number, Any>(((oldCo ?? []) as Any[]).map((c) => [c.id, c]));
  const companies = app.companies.map((c) => {
    const p = prevCo.get(c.id);
    let owner = p?.owner_id ?? null;
    if (!owner && !p?.owner_confirmed) {
      const hits = ((owners ?? []) as Any[]).filter((o) => sameName(o.full_name, c.name));
      if (hits.length === 1) owner = hits[0].id;
    }
    return { id: c.id, name: c.name.replace(/\s+/g, " ").trim(), fleet_code: c.fleet_code, status: c.status, driver_count: c.driver_count, kind: p?.kind ?? "managed", owner_id: owner, owner_confirmed: p?.owner_confirmed ?? false, synced_at: started };
  });
  const company = new Map(companies.map((c) => [c.id, c]));
  const managed = (id: number | null | undefined) => !!id && company.get(id)?.kind === "managed";
  if (companies.length) {
    const { error } = await db.from("platform_fleet_companies").upsert(companies, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }

  // 2. Cars: every fleet car (not decommissioned), plus any app car one of ours is linked or plate-matched to.
  const linkedCar = new Map<number, string>(((vl ?? []) as Any[]).map((l) => [l.platform_vehicle_id, l.vehicle_id]));
  const handLinkedKd = new Set(((vl ?? []) as Any[]).map((l) => l.vehicle_id));
  const kdByPlate = new Map<string, Any>(kdCars.filter((v) => !handLinkedKd.has(v.id)).map((v) => [plateKey(v.plate_number), v]));
  const carRows: Any[] = [];
  const claimed = new Set<string>();
  for (const v of app.vehicles) {
    const byLink = linkedCar.get(v.id) ?? null;
    const byPlate = !byLink && v.status !== "decommissioned" ? kdByPlate.get(plateKey(v.plate))?.id ?? null : null;
    const kid = byLink ?? (byPlate && !claimed.has(byPlate) ? byPlate : null);
    if (kid) claimed.add(kid);
    if (!kid && !(v.fleet_company_id && v.status !== "decommissioned")) continue;
    const a = v.active_assignment;
    carRows.push({
      id: v.id, plate: v.plate, make: v.make, model: v.model, year: v.year, color: v.color, seats: v.seats, fuel_type: v.fuel_type, status: v.status, is_approved: v.is_approved,
      fleet_company_id: v.fleet_company_id, owner_driver_id: v.owner_driver_id, insurance_expiry: v.insurance_expiry, registration_expiry: v.registration_expiry,
      current_driver_id: a?.driver_id ?? null, current_driver_name: a?.driver_name ?? null, current_driver_phone: a?.driver_phone ?? null, assigned_at: a?.assigned_at ?? null,
      roster: app.rosters.get(v.id) ?? [], kivu_vehicle_id: kid, match_method: byLink ? "link" : kid ? "plate" : null, synced_at: started,
    });
  }
  if (carRows.length) {
    const { error } = await db.from("platform_vehicles").upsert(carRows, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
  const keepCars = carRows.map((c) => c.id);
  await db.from("platform_vehicles").delete().not("id", "in", `(${keepCars.length ? keepCars.join(",") : "0"})`);

  // 3. Which company each driver is in.
  const members = [...app.memberOf].map(([platform_driver_id, fleet_company_id]) => ({ platform_driver_id, fleet_company_id, synced_at: started }));
  if (members.length) {
    const { error } = await db.from("platform_fleet_members").upsert(members, { onConflict: "platform_driver_id" });
    if (error) throw new Error(error.message);
  }
  await db.from("platform_fleet_members").delete().not("platform_driver_id", "in", `(${members.length ? members.map((m) => m.platform_driver_id).join(",") : "0"})`);

  // 4. Drivers: who is who.
  const matchOf = driverMatcher({ drivers: kdDrivers, freelancers: fs ?? [], vehicles: kdCars, links: dl ?? [], rejects: rj ?? [] });
  const appDrivers = [...app.drivers.values()].filter((d) => !d.is_deleted);
  const matched = new Map<number, ReturnType<typeof matchOf>>(appDrivers.map((d) => [d.id, matchOf(d)]));
  const rank = { link: 0, phone: 1, plate_name: 2 } as Record<string, number>;
  const accountOf = new Map<string, AppDriver>();   // our driver -> their app account (best match)
  for (const d of appDrivers) {
    const m = matched.get(d.id)!;
    if (!m.kivu_driver_id) continue;
    const prev = accountOf.get(m.kivu_driver_id);
    if (!prev || rank[m.match_method!] < rank[matched.get(prev.id)!.match_method!]) accountOf.set(m.kivu_driver_id, d);
  }
  const kdDriver = new Map<string, Any>(kdDrivers.map((d) => [d.id, d]));
  const carOfKd = new Map<string, Any>(carRows.filter((c) => c.kivu_vehicle_id).map((c) => [c.kivu_vehicle_id, c]));
  const kdCar = new Map<string, Any>(kdCars.map((v) => [v.id, v]));
  const working = kdDrivers.filter((d) => d.contract_status === "active" && (d.vehicle_id || WORKING_STAGES.includes(d.stage)));
  const nm = (d: { full_name: string | null } | undefined | null) => (d?.full_name ?? "").replace(/\s+/g, " ").trim() || "—";
  const brief = (d: AppDriver) => ({ id: d.id, full_name: nm(d), phone: d.phone, vehicle_plate: d.vehicle_plate, is_approved: d.is_approved, linked: !!matched.get(d.id)?.kivu_driver_id });
  const companyName = (id: number | null | undefined) => (id ? company.get(id)?.name ?? `company #${id}` : null);

  // 5. The differences.
  const cases: Case[] = [];
  for (const d of working) {
    const a = accountOf.get(d.id);
    const car = d.vehicle_id ? kdCar.get(d.vehicle_id) : null;
    if (!a) {
      const mine = nameWords(d.full_name);
      const score = (x: AppDriver) => ([d.phone, d.phone_alt].some((p) => phoneKey(p) && phoneKey(p) === phoneKey(x.phone)) ? 4 : 0) + (car && plateKey(x.vehicle_plate) === plateKey(car.plate_number) ? 2 : 0) + 2 * [...nameWords(x.full_name)].filter((w) => mine.has(w)).length;
      const suggestions = appDrivers.map((x) => ({ x, s: score(x) })).filter((y) => y.s >= 2).sort((p, q) => q.s - p.s).slice(0, 3).map((y) => brief(y.x));
      cases.push({ key: `drv_missing:${d.id}`, kind: "driver_not_in_app", title: `${nm(d)} is not in the app`, driver_id: d.id, vehicle_id: d.vehicle_id, kd_value: d.phone, details: { suggestions, plate: car?.plate_number ?? null, shift: d.shift, company_id: d.vehicle_id ? carOfKd.get(d.vehicle_id)?.fleet_company_id ?? null : null } });
      continue;
    }
    const m = matched.get(a.id)!;
    if (phoneKey(a.phone) && ![d.phone, d.phone_alt].some((p) => phoneKey(p) === phoneKey(a.phone)))
      cases.push({ key: `drv_phone:${d.id}:${a.id}`, kind: "phone_differs", title: `${nm(d)}: the phone differs`, driver_id: d.id, vehicle_id: d.vehicle_id, platform_driver_id: a.id, kd_value: [d.phone, d.phone_alt].filter(Boolean).join(" · "), app_value: a.phone, details: { match_method: m.match_method, app_name: nm(a) } });
    if (!sameName(d.full_name, a.full_name))
      cases.push({ key: `drv_name:${d.id}:${a.id}`, kind: "name_differs", title: `${nm(d)}: the name differs`, driver_id: d.id, platform_driver_id: a.id, kd_value: nm(d), app_value: nm(a), details: { match_method: m.match_method } });
    if (a.is_rejected) cases.push({ key: `drv_rejected:${a.id}`, kind: "not_approved", title: `${nm(d)} was rejected by KivuRide`, driver_id: d.id, platform_driver_id: a.id, app_value: "Rejected", details: {} });
    else if (a.is_approved === false) cases.push({ key: `drv_approval:${a.id}`, kind: "not_approved", title: `${nm(d)} is waiting for KivuRide's approval`, driver_id: d.id, platform_driver_id: a.id, app_value: "Not approved yet", details: {} });
  }

  for (const v of kdCars) {
    const c = carOfKd.get(v.id);
    if (!c) {
      const suggest = companies.find((x) => x.kind === "managed" && x.owner_id && x.owner_id === v.owner_id);
      cases.push({ key: `car_missing:${v.id}`, kind: "car_not_in_app", title: `${v.plate_number} is not in the app`, vehicle_id: v.id, kd_value: v.plate_number, details: { company_id: suggest?.id ?? null, make: v.make, model: v.model, color: v.color } });
      continue;
    }
    const co = c.fleet_company_id ? company.get(c.fleet_company_id) : null;
    const kdOwner = v.owner_id ? ownerName.get(v.owner_id) ?? null : null;
    if (!c.fleet_company_id) cases.push({ key: `car_owner:${v.id}:${c.id}:own`, kind: "car_wrong_owner", title: `${v.plate_number} is an independent driver's car in the app`, vehicle_id: v.id, platform_vehicle_id: c.id, kd_value: kdOwner, app_value: "Independent driver's own car", details: {} });
    else if (co && co.kind !== "managed") cases.push({ key: `car_owner:${v.id}:${c.id}:${co.id}`, kind: "car_wrong_owner", title: `${v.plate_number} is in ${co.name} in the app`, vehicle_id: v.id, platform_vehicle_id: c.id, kd_value: kdOwner, app_value: co.name, details: { company_id: co.id } });
    else if (co?.owner_id && v.owner_id && co.owner_id !== v.owner_id) cases.push({ key: `car_owner:${v.id}:${c.id}:${co.id}`, kind: "car_wrong_owner", title: `${v.plate_number}: a different owner in the app`, vehicle_id: v.id, platform_vehicle_id: c.id, kd_value: kdOwner, app_value: `${co.name} (${ownerName.get(co.owner_id) ?? "another owner"})`, details: { company_id: co.id } });

    // Our drivers on this car must be on it in the app too...
    const ours = working.filter((d) => d.vehicle_id === v.id);
    const onCar = (pid: number) => c.current_driver_id === pid || (c.roster as RosterEntry[]).some((r) => r.driver_id === pid);
    for (const d of ours) {
      const a = accountOf.get(d.id);
      if (!a || onCar(a.id)) continue;
      cases.push({ key: `roster_missing:${d.id}:${c.id}`, kind: "not_on_car_in_app", title: `${nm(d)} is not on ${v.plate_number} in the app`, driver_id: d.id, vehicle_id: v.id, platform_driver_id: a.id, platform_vehicle_id: c.id,
        kd_value: `${v.plate_number} · ${d.shift === "day" ? "day" : d.shift === "night" ? "night" : "day & night"}`, app_value: a.vehicle_plate ? `Drives ${a.vehicle_plate}` : "No car in the app",
        details: { shift: d.shift, now_driving: c.current_driver_name, roster: (c.roster as RosterEntry[]).map((r) => r.name), roster_full: (c.roster as RosterEntry[]).length >= 2, member_of: companyName(app.memberOf.get(a.id)), car_company: companyName(c.fleet_company_id) } });
    }
    // ...and nobody else.
    const inApp = new Set<number>([...(c.roster as RosterEntry[]).map((r) => r.driver_id), ...(c.current_driver_id ? [c.current_driver_id] : [])]);
    for (const pid of inApp) {
      const m = matched.get(pid);
      if (m?.freelancer_id) continue;
      const kd = m?.kivu_driver_id ? kdDriver.get(m.kivu_driver_id) : null;
      if (kd && kd.contract_status === "active" && kd.vehicle_id === v.id) continue;
      const a = app.drivers.get(pid);
      const r = (c.roster as RosterEntry[]).find((x) => x.driver_id === pid);
      const name = nm(a ?? { full_name: r?.name ?? c.current_driver_name });
      cases.push({ key: `roster_extra:${c.id}:${pid}`, kind: "extra_on_car_in_app", title: `${name} is on ${v.plate_number} in the app, not in Kivu Daily`, vehicle_id: v.id, platform_driver_id: pid, platform_vehicle_id: c.id, driver_id: kd?.id ?? null,
        kd_value: kd ? `${nm(kd)} · ${kd.contract_status === "ended" ? "contract ended" : kd.vehicle_id ? `on ${kdCar.get(kd.vehicle_id)?.plate_number ?? "another car"}` : "no car"}` : "Not in Kivu Daily", app_value: c.current_driver_id === pid ? "Driving it now" : `On its roster${r?.label ? ` (${r.label})` : ""}`,
        details: { driving_now: c.current_driver_id === pid, on_roster: !!r, company: companyName(c.fleet_company_id) } });
    }
  }

  const onManagedCar = new Set<number>();
  for (const c of carRows) {
    if (!managed(c.fleet_company_id)) continue;
    for (const r of c.roster as RosterEntry[]) onManagedCar.add(r.driver_id);
    if (c.current_driver_id) onManagedCar.add(c.current_driver_id);
    if (!c.kivu_vehicle_id) cases.push({ key: `car_app_only:${c.id}`, kind: "car_only_in_app", title: `${c.plate} is in the app only`, platform_vehicle_id: c.id, app_value: `${c.plate} · ${[c.make, c.model].filter(Boolean).join(" ")} · ${companyName(c.fleet_company_id)}`, details: { now_driving: c.current_driver_name, company: companyName(c.fleet_company_id) } });
  }
  // A driver whose contract ended must leave any fleet company (training
  // and test too: still in one, they get requests), except the operator's.
  for (const [pid, cid] of app.memberOf) {
    const kindOf = company.get(cid)?.kind;
    if (!kindOf || kindOf === "operator") continue;
    const a = app.drivers.get(pid);
    if (!a || a.is_deleted) continue;
    const m = matched.get(pid);
    if (m?.freelancer_id) continue;
    const kd = m?.kivu_driver_id ? kdDriver.get(m.kivu_driver_id) : null;
    if (managed(cid) && !kd && !onManagedCar.has(pid)) cases.push({ key: `drv_app_only:${pid}`, kind: "driver_only_in_app", title: `${nm(a)} is in ${companyName(cid)} in the app, not in Kivu Daily`, platform_driver_id: pid, app_value: [a.phone, a.vehicle_plate].filter(Boolean).join(" · "), details: { company_id: cid, company: companyName(cid) } });
    if (kd && kd.contract_status === "ended") cases.push({ key: `drv_ended:${pid}`, kind: "ended_still_in_app", title: `${nm(kd)}: contract ended, still in ${companyName(cid)} in the app`, driver_id: kd.id, platform_driver_id: pid, kd_value: "Contract ended", app_value: `In ${companyName(cid)}${a.vehicle_plate ? ` · drives ${a.vehicle_plate}` : ""}`, details: { company_id: cid, company: companyName(cid), on_car: onManagedCar.has(pid) } });
  }

  // 6. Save: same difference = same case. Gone = fixed. Dismissed stays dismissed.
  const old = new Map<string, Any>(((oldCases ?? []) as Any[]).map((c) => [c.key, c]));
  const rows = [...new Map(cases.map((c) => [c.key, c])).values()].map((c) => {
    const o = old.get(c.key);
    const reopen = o?.status === "resolved";
    return {
      key: c.key, kind: c.kind, title: c.title, driver_id: c.driver_id ?? null, vehicle_id: c.vehicle_id ?? null, platform_driver_id: c.platform_driver_id ?? null, platform_vehicle_id: c.platform_vehicle_id ?? null,
      kd_value: c.kd_value ?? null, app_value: c.app_value ?? null, details: c.details ?? {}, last_seen_at: started,
      // Every row carries every column (one upsert for all): a resolved case that comes back opens again.
      ...(o && !reopen ? { status: o.status, first_seen_at: o.first_seen_at, resolved_by: o.resolved_by, resolved_at: o.resolved_at, resolution: o.resolution }
        : { status: "open", first_seen_at: started, resolved_by: null, resolved_at: null, resolution: null }),
    };
  });
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("fleet_sync_cases").upsert(rows.slice(i, i + 200), { onConflict: "key" });
    if (error) throw new Error(error.message);
  }
  const live = new Set(rows.map((r) => r.key));
  const gone = ((oldCases ?? []) as Any[]).filter((c) => c.status === "open" && !live.has(c.key)).map((c) => c.id);
  if (gone.length) await db.from("fleet_sync_cases").update({ status: "resolved", resolved_at: started, resolution: "Fixed: no longer different" }).in("id", gone);

  const summary = { companies: companies.length, cars: carRows.filter((c) => managed(c.fleet_company_id) || c.kivu_vehicle_id).length, open: rows.filter((r) => (old.get(r.key)?.status ?? "open") !== "dismissed").length, fixed: gone.length };
  await db.from("platform_sync_state").upsert({ key: "fleet", last_run_at: started, last_ok_at: new Date().toISOString(), last_error: null, last_changed: gone.length, platform_total: carRows.length });
  // Every car registered on the app (not decommissioned), for the public website's total.
  await db.from("platform_sync_state").upsert({ key: "vehicles", last_run_at: started, last_ok_at: new Date().toISOString(), last_error: null, platform_total: app.vehicles.filter((v) => v.status !== "decommissioned").length });
  return summary;
}

// ------------------------------------------------------------------ actions
interface Step { call: string; status: number; ok: boolean; message?: string }
class Stop extends Error {}

async function act(db: Any, actor: string | null, body: Any) {
  const steps: Step[] = [];
  const call = async (method: string, path: string, payload?: unknown, label?: string) => {
    const r = await api(method, path, payload);
    steps.push({ call: label ?? `${method} ${path.split("?")[0]}`, status: r.status, ok: r.ok, message: r.ok ? undefined : said(r) });
    return r;
  };
  const need = (r: ApiRes, what: string) => { if (!r.ok) throw new Stop(`${what}: the app answered ${said(r)}`); return r; };
  const driverOf = async (id: string) => {
    const { data } = await db.from("drivers").select("id, full_name, phone, phone_alt, email, license_number, license_expiry, vehicle_id, shift").eq("id", id).maybeSingle();
    if (!data) throw new Stop("This driver is not in Kivu Daily.");
    return data as Any;
  };
  const appDriver = async (pid: number) => need(await call("GET", `/admin/drivers/${pid}`, undefined, "Read the driver in the app"), "Reading the driver").body?.data as AppDriver;
  const n = (x: unknown) => { const v = Number(x); if (!Number.isInteger(v) || v <= 0) throw new Stop("Missing or wrong id."); return v; };
  const writes = () => { if (!liveKey) throw new Stop("The live key (KIVURIDE_LIVE_API_KEY) is not set: nothing can be changed in the app."); };
  const closeCase = async (id: string | undefined, resolution: string) => { if (id) await db.from("fleet_sync_cases").update({ status: "resolved", resolved_by: actor, resolved_at: new Date().toISOString(), resolution }).eq("id", id); };
  // Existing app accounts with this phone or licence (the search is loose: keep exact matches only).
  const findDrivers = async (phones: (string | null | undefined)[], licence?: string | null) => {
    const keys = [...new Set(phones.map(phoneKey).filter((k) => k.length === 9))];
    const lic = (licence ?? "").replace(/\s/g, "").toUpperCase();
    const found = new Map<number, AppDriver>();
    for (const q of [...keys, ...(lic.length >= 5 ? [lic] : [])]) {
      const r = await call("GET", `/admin/drivers?search=${encodeURIComponent(q)}&limit=20`, undefined, `Look for ${q} in the app`);
      need(r, "Searching the app");
      for (const d of (r.body?.data?.items ?? []) as AppDriver[]) {
        if (d.is_deleted) continue;
        if (keys.includes(phoneKey(d.phone)) || (lic && (d.license_number ?? "").replace(/\s/g, "").toUpperCase() === lic)) found.set(d.id, d);
      }
    }
    return [...found.values()];
  };
  const findCars = async (plate: string) => {
    const r = await call("GET", `/v2/admin/vehicles?search=${encodeURIComponent(plateKey(plate))}&limit=50`, undefined, `Look for ${plate} in the app`);
    need(r, "Searching the app");
    return ((r.body?.data?.items ?? []) as AppVehicle[]).filter((v) => plateKey(v.plate) === plateKey(plate));
  };
  const linkDriver = async (driverId: string, pid: number) => {
    const { data: other } = await db.from("driver_app_links").select("driver_id, freelancer_id").eq("platform_driver_id", pid).maybeSingle();
    if (other && other.driver_id !== driverId) throw new Stop("That app account is already linked to someone else in Kivu Daily.");
    await db.from("driver_app_links").delete().eq("driver_id", driverId);
    const { error } = await db.from("driver_app_links").insert({ driver_id: driverId, platform_driver_id: pid, linked_by: actor });
    if (error) throw new Stop(error.message);
    await db.from("app_match_rejects").delete().eq("driver_id", driverId).eq("platform_driver_id", pid);
  };
  const linkCar = async (vehicleId: string, pvid: number) => {
    const { data: other } = await db.from("vehicle_app_links").select("vehicle_id").eq("platform_vehicle_id", pvid).maybeSingle();
    if (other && other.vehicle_id !== vehicleId) throw new Stop("That app car is already linked to another car in Kivu Daily.");
    await db.from("vehicle_app_links").delete().eq("vehicle_id", vehicleId);
    const { error } = await db.from("vehicle_app_links").insert({ vehicle_id: vehicleId, platform_vehicle_id: pvid, linked_by: actor });
    if (error) throw new Stop(error.message);
  };
  const updateDriver = async (id: string, patch: Record<string, unknown>) => { const { error } = await db.from("drivers").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id); if (error) throw new Stop(error.message); };

  const a = String(body.action ?? "");
  let summary = "";
  let result: Record<string, unknown> = {};
  try { switch (a) {
    case "set_company": {
      const id = n(body.id);
      const patch: Record<string, unknown> = {};
      if (body.kind !== undefined) { if (!["managed", "operator", "ignore"].includes(body.kind)) throw new Stop("Unknown kind."); patch.kind = body.kind; }
      if (body.owner_id !== undefined) { patch.owner_id = body.owner_id || null; patch.owner_confirmed = true; }
      const { error } = await db.from("platform_fleet_companies").update(patch).eq("id", id);
      if (error) throw new Stop(error.message);
      summary = `Company #${id}: ${Object.keys(patch).filter((k) => k !== "owner_confirmed").join(", ")} changed`;
      break;
    }
    case "link_driver": {
      const d = await driverOf(body.driver_id);
      const pid = n(body.platform_driver_id);
      await linkDriver(d.id, pid);
      await closeCase(body.case_id, `Linked to app account #${pid}`);
      summary = `Linked ${d.full_name} to app account #${pid}`;
      break;
    }
    case "reject_match": {
      const d = await driverOf(body.driver_id);
      const pid = n(body.platform_driver_id);
      await db.from("driver_app_links").delete().eq("driver_id", d.id).eq("platform_driver_id", pid);
      const { error } = await db.from("app_match_rejects").upsert({ driver_id: d.id, platform_driver_id: pid, rejected_by: actor }, { onConflict: "driver_id,platform_driver_id" });
      if (error) throw new Stop(error.message);
      await closeCase(body.case_id, `Not the same person as app account #${pid}`);
      summary = `${d.full_name} is not app account #${pid}`;
      break;
    }
    case "link_vehicle": {
      const { data: v } = await db.from("vehicles").select("id, plate_number").eq("id", body.vehicle_id).maybeSingle();
      if (!v) throw new Stop("This car is not in Kivu Daily.");
      const pvid = n(body.platform_vehicle_id);
      await linkCar(v.id, pvid);
      await closeCase(body.case_id, `Linked to app car #${pvid}`);
      summary = `Linked ${v.plate_number} to app car #${pvid}`;
      break;
    }
    case "dismiss": case "reopen": {
      const reopen = a === "reopen";
      const { error } = await db.from("fleet_sync_cases").update(reopen ? { status: "open", resolved_by: null, resolved_at: null, resolution: null } : { status: "dismissed", resolved_by: actor, resolved_at: new Date().toISOString(), resolution: String(body.note ?? "").trim() || "Dismissed" }).eq("id", body.case_id);
      if (error) throw new Stop(error.message);
      const { data: c } = await db.from("fleet_sync_cases").select("title").eq("id", body.case_id).maybeSingle();
      summary = `${reopen ? "Reopened" : "Dismissed"}: ${c?.title ?? body.case_id}`;
      break;
    }
    case "keep_kd_phone": case "keep_kd_name": {
      writes();
      const d = await driverOf(body.driver_id);
      const pid = n(body.platform_driver_id);
      let payload: Record<string, unknown>;
      if (a === "keep_kd_phone") {
        const chosen = body.phone ?? d.phone;
        if (![d.phone, d.phone_alt].some((p) => phoneKey(p) === phoneKey(chosen)) || !appPhone(chosen)) throw new Stop("Choose one of the driver's phones in Kivu Daily.");
        payload = { phone: appPhone(chosen) };
      } else payload = { full_name: String(d.full_name).replace(/\s+/g, " ").trim() };
      need(await call("PUT", `/admin/drivers/${pid}`, payload, `Update the ${a === "keep_kd_phone" ? "phone" : "name"} in the app`), "Updating the app");
      await closeCase(body.case_id, a === "keep_kd_phone" ? `Kivu Daily kept: app phone set to ${payload.phone}` : `Kivu Daily kept: app name set to ${payload.full_name}`);
      summary = `${d.full_name}: ${a === "keep_kd_phone" ? `phone in the app set to ${payload.phone}` : "name in the app set from Kivu Daily"}`;
      break;
    }
    case "keep_app_phone": case "keep_both_phones": case "keep_app_name": {
      const d = await driverOf(body.driver_id);
      const ad = await appDriver(n(body.platform_driver_id));
      if (a === "keep_app_name") {
        await updateDriver(d.id, { full_name: nmTrim(ad.full_name) });
        summary = `${d.full_name}: name in Kivu Daily set to ${nmTrim(ad.full_name)}`;
      } else {
        const p = localPhone(ad.phone);
        if (!p) throw new Stop("The app has no phone for this driver.");
        // Keeping the app's phone as the main one: the old one stays as the second, so nothing is lost.
        await updateDriver(d.id, a === "keep_app_phone" ? { phone: p, phone_alt: d.phone } : { phone_alt: p });
        summary = a === "keep_app_phone" ? `${d.full_name}: main phone set to ${p} (from the app)` : `${d.full_name}: second phone ${p} added (from the app)`;
      }
      await closeCase(body.case_id, summary);
      break;
    }
    case "create_driver": {
      writes();
      const d = await driverOf(body.driver_id);
      const { data: linked } = await db.from("driver_app_links").select("platform_driver_id").eq("driver_id", d.id).maybeSingle();
      if (linked) throw new Stop(`${d.full_name} is already linked to app account #${linked.platform_driver_id}.`);
      const phone = appPhone(body.phone ?? d.phone);
      const email = String(body.email ?? "").trim();
      const licence = String(body.license_number ?? "").trim();
      const expiry = String(body.license_expiry ?? "").slice(0, 10);
      if (!phone) throw new Stop("A valid phone is needed (07X XXX XXXX).");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Stop("A valid email is needed: the app sends the login details there.");
      if (licence.length < 4) throw new Stop("The driving licence number is needed.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new Stop("The licence expiry date is needed.");
      const companyId = body.fleet_company_id ? n(body.fleet_company_id) : null;
      // Never twice: anyone in the app with one of these phones or this licence is the same person.
      const dupes = await findDrivers([phone, d.phone, d.phone_alt], licence);
      if (dupes.length) {
        result = { duplicates: dupes.map((x) => ({ id: x.id, full_name: nmTrim(x.full_name), phone: x.phone, vehicle_plate: x.vehicle_plate, is_approved: x.is_approved })) };
        summary = `${d.full_name} not created: already in the app (${dupes.map((x) => `#${x.id}`).join(", ")})`;
        await log(db, actor, a, summary, false, body, steps);
        return { ok: false, error: "Already in the app: link instead of creating.", ...result, steps };
      }
      const payload = { full_name: String(d.full_name).replace(/\s+/g, " ").trim(), email, phone, license_number: licence, license_expiry: `${expiry}T00:00:00Z` };
      need(await call("POST", companyId ? `/v2/fleet/companies/${companyId}/drivers/register` : "/v2/drivers/admin/independent", payload, companyId ? `Create the driver in company #${companyId}` : "Create the driver (no fleet)"), "Creating the driver");
      const made = (await findDrivers([phone])).sort((x, y) => y.id - x.id)[0];
      if (!made) throw new Stop("Created, but the new account was not found to link: check \"To confirm\" after the next sync.");
      await linkDriver(d.id, made.id);
      await updateDriver(d.id, { license_number: licence, license_expiry: expiry, ...(d.email ? {} : { email }) });
      await closeCase(body.case_id, `Created in the app (#${made.id})`);
      result = { platform_driver_id: made.id };
      summary = `${d.full_name} created in the app (#${made.id}${companyId ? `, company #${companyId}` : ", no fleet"})`;
      break;
    }
    case "create_vehicle": {
      writes();
      const { data: v } = await db.from("vehicles").select("id, plate_number").eq("id", body.vehicle_id).maybeSingle();
      if (!v) throw new Stop("This car is not in Kivu Daily.");
      const { data: linked } = await db.from("vehicle_app_links").select("platform_vehicle_id").eq("vehicle_id", v.id).maybeSingle();
      if (linked) throw new Stop(`${v.plate_number} is already linked to app car #${linked.platform_vehicle_id}.`);
      const companyId = n(body.fleet_company_id);
      const year = Number(body.year);
      if (!body.make || !body.model || !body.color || !Number.isInteger(year) || year < 1990 || year > 2100) throw new Stop("Make, model, year and colour are needed.");
      const dupes = await findCars(v.plate_number);
      if (dupes.length) {
        result = { duplicates: dupes.map((x) => ({ id: x.id, plate: x.plate, make: x.make, model: x.model, fleet_company_id: x.fleet_company_id, status: x.status })) };
        summary = `${v.plate_number} not created: already in the app (${dupes.map((x) => `#${x.id}`).join(", ")})`;
        await log(db, actor, a, summary, false, body, steps);
        return { ok: false, error: "Already in the app: link instead of creating.", ...result, steps };
      }
      const payload = { plate: plateKey(v.plate_number), make: String(body.make).trim(), model: String(body.model).trim(), year, color: String(body.color).trim(), vehicle_type: "economy", seats: Number(body.seats) || 4, fuel_type: String(body.fuel_type || "electric") };
      need(await call("POST", `/v2/admin/vehicles?fleet_company_id=${companyId}`, payload, `Create the car in company #${companyId}`), "Creating the car");
      const made = (await findCars(v.plate_number))[0];
      if (!made) throw new Stop("Created, but the new car was not found to link: check \"To confirm\" after the next sync.");
      await linkCar(v.id, made.id);
      await closeCase(body.case_id, `Created in the app (#${made.id})`);
      result = { platform_vehicle_id: made.id };
      summary = `${v.plate_number} created in the app (#${made.id}, company #${companyId})`;
      break;
    }
    case "put_on_car": {
      writes();
      const pid = n(body.platform_driver_id), pvid = n(body.platform_vehicle_id);
      const label = String(body.label ?? "").trim() || null;
      const car = need(await call("GET", `/v2/admin/vehicles/${pvid}`, undefined, "Read the car in the app"), "Reading the car").body?.data as AppVehicle;
      if (!car.fleet_company_id) throw new Stop("In the app this car belongs to an independent driver, not to a fleet company.");
      const ad = await appDriver(pid);
      // 1. In the car's company (a driver is in one company only: leave the old one first).
      const r = need(await call("GET", `/admin/drivers?fleet_company_id=${car.fleet_company_id}&search=${phoneKey(ad.phone)}&limit=20`, undefined, "Is the driver in the car's company?"), "Reading the company");
      const member = ((r.body?.data?.items ?? []) as AppDriver[]).some((x) => x.id === pid);
      if (!member) {
        const { data: m } = await db.from("platform_fleet_members").select("fleet_company_id").eq("platform_driver_id", pid).maybeSingle();
        if (m && m.fleet_company_id !== car.fleet_company_id) need(await call("DELETE", `/v2/fleet/companies/${m.fleet_company_id}/drivers/${pid}`, undefined, `Leave company #${m.fleet_company_id}`), "Leaving the old company");
        need(await call("POST", `/v2/fleet/companies/${car.fleet_company_id}/drivers/direct-add-by-phone`, { phone: ad.phone }, `Join company #${car.fleet_company_id}`), "Joining the car's company");
      }
      // 2. On the car's roster (2 drivers at most).
      const roster = await rosterOf(pvid);
      if (!roster.some((x) => x.driver_id === pid)) {
        if (roster.length >= 2) throw new Stop(`The car already has 2 drivers in the app (${roster.map((x) => x.name).join(", ")}): take one off first.`);
        need(await call("POST", `/v2/admin/vehicles/${pvid}/dedicated-drivers`, { driver_id: pid, ...(label ? { label } : {}) }, `Add to the car's roster${label ? ` (${label})` : ""}`), "Adding to the roster");
      }
      // 3. Driving it now, if asked (someone else driving it is only replaced when asked too).
      let note = "";
      if (body.make_current && car.active_assignment?.driver_id !== pid) {
        if (car.active_assignment && !body.replace) note = ` ${car.active_assignment.driver_name ?? "Someone"} is still driving it now.`;
        else need(await call("POST", `/v2/admin/vehicles/${pvid}/assign`, { driver_id: pid, replace: !!car.active_assignment }, "Make them the car's driver now"), "Making them the driver");
      }
      await closeCase(body.case_id, `Put on ${car.plate} in the app`);
      summary = `${nmTrim(ad.full_name)} put on ${car.plate} in the app${label ? ` (${label})` : ""}.${note}`;
      break;
    }
    case "take_off_car": {
      writes();
      const pid = n(body.platform_driver_id), pvid = n(body.platform_vehicle_id);
      const car = need(await call("GET", `/v2/admin/vehicles/${pvid}`, undefined, "Read the car in the app"), "Reading the car").body?.data as AppVehicle;
      if (car.active_assignment?.driver_id === pid) need(await call("POST", `/v2/admin/vehicles/${pvid}/unassign`, undefined, "Stop driving it now"), "Taking them off (refused during a trip)");
      if ((await rosterOf(pvid)).some((x) => x.driver_id === pid)) need(await call("DELETE", `/v2/admin/vehicles/${pvid}/dedicated-drivers/${pid}`, undefined, "Remove from the car's roster"), "Removing from the roster");
      if (body.leave_company && car.fleet_company_id) need(await call("DELETE", `/v2/fleet/companies/${car.fleet_company_id}/drivers/${pid}`, undefined, `Leave company #${car.fleet_company_id}`), "Leaving the company");
      await closeCase(body.case_id, `Taken off ${car.plate} in the app`);
      summary = `Driver #${pid} taken off ${car.plate} in the app${body.leave_company ? " and out of its company" : ""}`;
      break;
    }
    case "remove_from_company": {
      writes();
      const pid = n(body.platform_driver_id), cid = n(body.fleet_company_id);
      need(await call("DELETE", `/v2/fleet/companies/${cid}/drivers/${pid}`, undefined, `Leave company #${cid}`), "Removing from the company");
      await closeCase(body.case_id, `Removed from company #${cid} in the app`);
      summary = `Driver #${pid} removed from company #${cid} in the app (the account stays)`;
      break;
    }
    case "create_company": {
      // The owner's fleet company in the app, from the owner's details in Kivu Daily.
      writes();
      const { data: o } = await db.from("vehicle_owners").select("id, full_name, email, phone").eq("id", body.owner_id).maybeSingle();
      if (!o) throw new Stop("This owner is not in Kivu Daily.");
      const name = String(body.name ?? o.full_name ?? "").replace(/\s+/g, " ").trim();
      const email = String(body.contact_email ?? o.email ?? "").trim();
      const phone = localPhone(String(body.contact_phone ?? o.phone ?? ""));
      const address = String(body.address ?? "Kigali").trim() || "Kigali";
      if (name.length < 3) throw new Stop("The company needs a name.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Stop("The company needs a valid email (the owner's email in Kivu Daily is missing or wrong).");
      if (!phone) throw new Stop("The company needs a Rwanda phone number (the owner's phone in Kivu Daily is missing or wrong).");
      const { data: has } = await db.from("platform_fleet_companies").select("id, name").eq("owner_id", o.id).eq("kind", "managed").maybeSingle();
      if (has) throw new Stop(`${o.full_name} already has a company in the app: ${has.name} (#${has.id}).`);
      const sameName = (c: AppCompany) => c.name.replace(/\s+/g, " ").trim().toLowerCase() === name.toLowerCase();
      const list = (need(await call("GET", "/v2/fleet/companies?limit=100", undefined, "List the app's companies"), "Reading the companies").body?.data?.items ?? []) as AppCompany[];
      const same = list.find(sameName);
      if (same) throw new Stop(`A company named "${same.name}" (#${same.id}) is already in the app: choose it as ${o.full_name}'s company in Fleet companies instead.`);
      const made = need(await call("POST", "/v2/fleet/companies", { name, contact_email: email, contact_phone: phone, address }, `Create the company "${name}"`), "Creating the company").body?.data as AppCompany | undefined;
      const id = made?.id ?? ((need(await call("GET", "/v2/fleet/companies?limit=100", undefined, "Find the new company"), "Reading the companies").body?.data?.items ?? []) as AppCompany[]).find(sameName)?.id;
      if (!id) throw new Stop("Created, but the new company was not found: it shows after the next sync.");
      await db.from("platform_fleet_companies").upsert({ id, name, fleet_code: made?.fleet_code ?? null, status: made?.status ?? null, driver_count: 0, kind: "managed", owner_id: o.id, owner_confirmed: true, synced_at: new Date().toISOString() });
      result = { fleet_company_id: id };
      summary = `Company "${name}" (#${id}) created in the app for ${o.full_name}`;
      break;
    }
    case "add_to_kd": {
      // A driver who is in the app only becomes a Kivu Daily driver, linked to that account.
      const pid = n(body.platform_driver_id);
      const ad = await appDriver(pid);
      const { data: linkedTo } = await db.from("driver_app_links").select("driver_id").eq("platform_driver_id", pid).maybeSingle();
      if (linkedTo?.driver_id) throw new Stop("This app account is already linked to a driver in Kivu Daily.");
      const { data: all } = await db.from("drivers").select("id, full_name, phone, phone_alt");
      const same = ((all ?? []) as Any[]).find((d) => [d.phone, d.phone_alt].some((x) => phoneKey(x) && phoneKey(x) === phoneKey(ad.phone)));
      if (same) throw new Stop(`${same.full_name} in Kivu Daily has this phone: link them instead of adding a new driver.`);
      const shift = ["day", "night", "full"].includes(body.shift) ? body.shift : null;
      const rest = typeof body.rest_day === "string" && body.rest_day ? body.rest_day : null;
      const start = /^\d{4}-\d{2}-\d{2}$/.test(String(body.start_date ?? "")) ? body.start_date : null;
      const vehicleId = body.vehicle_id || null;
      if (vehicleId && (!shift || !start || !rest)) throw new Stop("A driver on a car needs the shift, the start date and the rest day.");
      const { data: made, error } = await db.from("drivers").insert({
        full_name: nmTrim(ad.full_name), phone: localPhone(ad.phone) ?? ad.phone, email: ad.email || null, license_number: ad.license_number ?? null,
        license_expiry: ad.license_expiry ? String(ad.license_expiry).slice(0, 10) : null, stage: vehicleId ? "ready" : "raw", contract_status: "active",
        vehicle_id: vehicleId, shift, start_date: start, rest_day: rest, initial_deposit_paid: false, created_by: actor,
        notes: `Added from the Kivu Ride app (account #${pid}) on Under Management.`,
      }).select("id, full_name").single();
      if (error) throw new Stop(error.message);
      await linkDriver(made.id, pid);
      await closeCase(body.case_id, "Added to Kivu Daily");
      result = { driver_id: made.id };
      summary = `${made.full_name} added to Kivu Daily from app account #${pid}`;
      break;
    }
    case "offboard": {
      // Contract ended: off every car and out of the fleet company in the app.
      // The account stays, and the driver stays in Kivu Daily with no car.
      writes();
      const d = await driverOf(body.driver_id);
      const { data: st } = await db.from("platform_driver_status").select("platform_driver_id").eq("kivu_driver_id", d.id);
      const { data: ln } = await db.from("driver_app_links").select("platform_driver_id").eq("driver_id", d.id);
      const pids = [...new Set([...((st ?? []) as Any[]), ...((ln ?? []) as Any[])].map((x) => Number(x.platform_driver_id)).filter(Boolean))];
      if (!pids.length) { summary = `${nmTrim(d.full_name)}: no app account, nothing to remove`; break; }
      const { data: cars } = await db.from("platform_vehicles").select("id, plate, current_driver_id, roster");
      const { data: mem } = await db.from("platform_fleet_members").select("platform_driver_id, fleet_company_id").in("platform_driver_id", pids);
      const { data: kinds } = await db.from("platform_fleet_companies").select("id, kind");
      const kindOf = new Map(((kinds ?? []) as Any[]).map((c) => [c.id, c.kind]));
      const done: string[] = [];
      for (const pid of pids) {
        for (const c of (cars ?? []) as Any[]) {
          if (c.current_driver_id === pid) { need(await call("POST", `/v2/admin/vehicles/${c.id}/unassign`, undefined, `Stop driving ${c.plate}`), "Taking them off the car (refused during a trip)"); done.push(`off ${c.plate}`); }
          if (((c.roster ?? []) as RosterEntry[]).some((r) => r.driver_id === pid)) { need(await call("DELETE", `/v2/admin/vehicles/${c.id}/dedicated-drivers/${pid}`, undefined, `Remove from ${c.plate}'s roster`), "Removing from the roster"); done.push(`off ${c.plate}'s roster`); }
        }
        for (const m of ((mem ?? []) as Any[]).filter((x) => x.platform_driver_id === pid)) {
          if (kindOf.get(m.fleet_company_id) === "operator") continue;
          need(await call("DELETE", `/v2/fleet/companies/${m.fleet_company_id}/drivers/${pid}`, undefined, `Leave company #${m.fleet_company_id}`), "Removing from the company");
          done.push(`out of company #${m.fleet_company_id}`);
        }
      }
      await db.from("fleet_sync_cases").update({ status: "resolved", resolved_by: actor, resolved_at: new Date().toISOString(), resolution: "Contract ended: removed in the app" }).eq("kind", "ended_still_in_app").eq("driver_id", d.id).eq("status", "open");
      summary = `${nmTrim(d.full_name)} (contract ended): ${done.length ? done.join(", ") : "nothing to remove"} in the app`;
      break;
    }
    default:
      throw new Stop("Unknown action.");
  } } catch (err) {
    // Stopped part-way: say what was done and what the app answered.
    const message = err instanceof Error ? err.message : String(err);
    await log(db, actor, a, `Failed: ${message}`, false, body, steps);
    return { ok: false, error: message, steps };
  }
  await log(db, actor, a, summary, true, body, steps);
  return { ok: true, message: summary, ...result, steps };
}
const nmTrim = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
async function log(db: Any, actor: string | null, action: string, summary: string, ok: boolean, input: Any, steps: Step[]) {
  const { action: _a, ...rest } = input ?? {};
  await db.from("fleet_sync_log").insert({ actor, action, summary: summary.slice(0, 500), ok, input: rest, steps });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "sync");

  // Auth: the cron secret, or a signed-in member: Fleet/Finance/IT/MD may sync, only Fleet and the MD act.
  let actor: string | null = null;
  const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  if (!isCron) {
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const { data: p } = await db.from("profiles").select("role, is_active, department:departments(slug)").eq("id", user.id).maybeSingle();
    const slug = (p?.department as { slug?: string } | null)?.slug ?? "";
    const md = p?.role === "managing_director";
    if (!p?.is_active || !(md || SEE.includes(slug))) return json({ error: "Unauthorized" }, 401);
    if (action !== "sync" && !(md || slug === "fleet")) return json({ ok: false, error: "Only Fleet and the MD can change drivers and cars." }, 403);
    actor = user.id;
  }
  if (!readKey) return json({ error: "No KivuRide API key is set" }, 500);

  if (action === "sync") {
    const started = new Date().toISOString();
    try {
      return json({ ok: true, ...(await sync(db)) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.from("platform_sync_state").upsert({ key: "fleet", last_run_at: started, last_error: message.slice(0, 500) });
      return json({ ok: false, error: message }, 500);
    }
  }

  let out: Record<string, unknown>;
  try {
    out = await act(db, actor, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(db, actor, action, `Failed: ${message}`, false, body, []).catch(() => null);
    return json({ ok: false, error: message });
  }
  // Show the result right away: read the app again, and refresh Ours On Shift in the background.
  if (cronSecret) {
    const refresh = fetch(`${supabaseUrl}/functions/v1/driver-status-sync`, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": cronSecret }, body: "{}" }).catch(() => null);
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(refresh);
  }
  try {
    out.sync = await sync(db);
  } catch (err) {
    out.sync_error = err instanceof Error ? err.message : String(err);
  }
  return json(out);
});
