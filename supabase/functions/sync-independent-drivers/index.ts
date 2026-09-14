import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// The rider-facing platform's own driver id/vehicle id are the join key
// back to platform_drivers.external_id / platform_cars.external_id, so a
// repeat sync updates the same rows instead of creating duplicates every
// time someone clicks "Sync". Survey-only fields (is_branded,
// allows_branding, and is_owner past its first sync) are never
// overwritten here - the platform has no concept of them, and stomping
// them on every sync would erase work IT/Fleet/Call Center already did.
const DEFAULT_API_BASE = "https://kivuride-developtesting.onrender.com";
const PAGE_SIZE = 50;

interface UpstreamVehicle {
  id: number;
  plate: string;
  make: string | null;
  model: string | null;
  color: string | null;
  owner_driver_id: number | null;
}

interface UpstreamDriver {
  id: number;
  full_name: string;
  phone: string;
  email: string | null;
  vehicle: UpstreamVehicle | null;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiBase = Deno.env.get("INDEPENDENT_DRIVERS_API_URL") || DEFAULT_API_BASE;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("role, department:departments(slug)")
      .eq("id", user.id)
      .maybeSingle();

    const deptSlug = (callerProfile as { department?: { slug?: string } } | null)?.department?.slug;
    const allowed = callerProfile?.role === "managing_director" || ["fleet", "call_center", "it"].includes(deptSlug ?? "");
    if (!allowed) {
      return json({ error: "Only Fleet, Call Center, IT, or the MD can sync Non-Insider data" }, 403);
    }

    // Pull every page. The upstream list can reorder mid-paginate (drivers
    // going online/offline shifts sort order), which can hand back the
    // same driver twice across pages - harmless here since each one is
    // upserted by external_id, so a repeat just updates the same row.
    const items: UpstreamDriver[] = [];
    let skip = 0;
    while (true) {
      const res = await fetch(`${apiBase}/v2/drivers/independent?skip=${skip}&limit=${PAGE_SIZE}`);
      if (!res.ok) {
        return json({ error: `Upstream API returned ${res.status}` }, 502);
      }
      const body = await res.json();
      const page = body?.data;
      if (!page || !Array.isArray(page.items)) {
        return json({ error: "Unexpected response shape from upstream API" }, 502);
      }
      items.push(...page.items);
      if (!page.has_next) break;
      skip += PAGE_SIZE;
    }

    let driversCreated = 0;
    let driversUpdated = 0;
    let carsCreated = 0;
    let carsUpdated = 0;

    for (const item of items) {
      let carId: string | null = null;

      if (item.vehicle) {
        const v = item.vehicle;
        const { data: existingCar } = await adminClient
          .from("platform_cars")
          .select("id")
          .eq("external_id", v.id)
          .maybeSingle();

        if (existingCar) {
          await adminClient
            .from("platform_cars")
            .update({
              plate_number: v.plate,
              make: v.make,
              model: v.model,
              color: v.color,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingCar.id);
          carId = existingCar.id;
          carsUpdated++;
        } else {
          const { data: newCar, error: carErr } = await adminClient
            .from("platform_cars")
            .insert({
              external_id: v.id,
              plate_number: v.plate,
              make: v.make,
              model: v.model,
              color: v.color,
              created_by: user.id,
            })
            .select("id")
            .single();
          if (carErr) throw carErr;
          carId = newCar.id;
          carsCreated++;
        }
      }

      const { data: existingDriver } = await adminClient
        .from("platform_drivers")
        .select("id")
        .eq("external_id", item.id)
        .maybeSingle();

      if (existingDriver) {
        await adminClient
          .from("platform_drivers")
          .update({
            full_name: item.full_name,
            phone: item.phone,
            email: item.email,
            car_id: carId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingDriver.id);
        driversUpdated++;
      } else {
        const isOwner = item.vehicle ? item.vehicle.owner_driver_id === item.id : null;
        const { error: driverErr } = await adminClient.from("platform_drivers").insert({
          external_id: item.id,
          full_name: item.full_name,
          phone: item.phone,
          email: item.email,
          is_owner: isOwner,
          car_id: carId,
          created_by: user.id,
        });
        if (driverErr) throw driverErr;
        driversCreated++;
      }
    }

    return json({
      success: true,
      fetched: items.length,
      drivers: { created: driversCreated, updated: driversUpdated },
      cars: { created: carsCreated, updated: carsUpdated },
    }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
