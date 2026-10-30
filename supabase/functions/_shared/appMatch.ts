// Matching our drivers and cars to their accounts and cars in the Kivu Ride
// app. Shared by driver-status-sync (Ours On Shift) and fleet-sync (Under
// Management), so both always agree. Order for a driver: a link made by
// hand, else the phone (main or second), else our car's plate + the name.
// A pair someone marked "not the same person" is never matched again.

export const phoneKey = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-9);
export const plateKey = (p: string | null | undefined) => (p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
// Words of a name (3+ letters), to tell whether two names are the same person.
export const nameWords = (n: string | null | undefined) => new Set((n ?? "").toLowerCase().normalize("NFD").replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3));
export const sameName = (a: string | null | undefined, b: string | null | undefined) => { const x = nameWords(a); return [...nameWords(b)].some((w) => x.has(w)); };
// The app writes phones as +2507XXXXXXXX, Kivu Daily as 07XXXXXXXX.
export const appPhone = (p: string | null | undefined) => (phoneKey(p).length === 9 ? `+250${phoneKey(p)}` : null);
export const localPhone = (p: string | null | undefined) => (phoneKey(p).length === 9 ? `0${phoneKey(p)}` : (p ?? null));

export interface KdDriver { id: string; full_name: string; phone: string | null; phone_alt?: string | null; contract_status: string; vehicle_id: string | null }
export interface KdFreelancer { id: string; full_name?: string | null; phone: string | null }
export interface AppDriverLike { id: number; full_name: string | null; phone: string | null; vehicle_plate: string | null }
export type MatchMethod = "link" | "phone" | "plate_name" | null;
export interface Match { kivu_driver_id: string | null; freelancer_id: string | null; match_method: MatchMethod }

export function driverMatcher(input: {
  drivers: KdDriver[]; freelancers: KdFreelancer[]; vehicles: { id: string; plate_number: string }[];
  links: { driver_id: string | null; freelancer_id: string | null; platform_driver_id: number }[];
  rejects: { driver_id: string; platform_driver_id: number }[];
}) {
  const rejected = new Set(input.rejects.map((r) => `${r.driver_id}:${r.platform_driver_id}`));
  const linkedTo = new Map(input.links.map((l) => [l.platform_driver_id, l]));
  // People linked by hand are matched only through their link.
  const handLinked = new Set(input.links.flatMap((l) => [l.driver_id, l.freelancer_id]).filter(Boolean) as string[]);
  // Our drivers by phone (main and second): an active contract wins over an ended one.
  const byPhone = new Map<string, string>();
  const ordered = [...input.drivers].sort((a, b) => (a.contract_status === "active" ? 1 : 0) - (b.contract_status === "active" ? 1 : 0));
  for (const d of ordered) for (const p of [d.phone_alt, d.phone]) if (phoneKey(p).length === 9 && !handLinked.has(d.id)) byPhone.set(phoneKey(p), d.id);
  const freelancer = new Map(input.freelancers.filter((f) => phoneKey(f.phone) && !handLinked.has(f.id)).map((f) => [phoneKey(f.phone), f.id]));
  const vehicle = new Map(input.vehicles.map((v) => [plateKey(v.plate_number), v.id]));
  const active = input.drivers.filter((d) => d.contract_status === "active" && !handLinked.has(d.id));
  return (u: AppDriverLike): Match => {
    const l = linkedTo.get(u.id);
    if (l) return { kivu_driver_id: l.driver_id, freelancer_id: l.freelancer_id, match_method: "link" };
    const k = phoneKey(u.phone);
    const d0 = byPhone.get(k) ?? null, d = d0 && !rejected.has(`${d0}:${u.id}`) ? d0 : null;
    const f = freelancer.get(k) ?? null;
    if (d || f) return { kivu_driver_id: d, freelancer_id: f, match_method: "phone" };
    const v = u.vehicle_plate ? vehicle.get(plateKey(u.vehicle_plate)) : null;
    if (v) {
      const hits = active.filter((x) => x.vehicle_id === v && sameName(x.full_name, u.full_name) && !rejected.has(`${x.id}:${u.id}`));
      if (hits.length === 1) return { kivu_driver_id: hits[0].id, freelancer_id: null, match_method: "plate_name" };
    }
    return { kivu_driver_id: null, freelancer_id: null, match_method: null };
  };
}
