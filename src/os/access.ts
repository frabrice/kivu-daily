import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { useDuties } from '../lib/callTickets';
import { Profile } from '../lib/supabase';

// Who is looking: role, department and the named duties they hold. Every
// module and page in the registry decides visibility from this alone.
export interface Access {
  profile: Profile | null;
  isMd: boolean;
  dept: string | null;
  duties: Set<string>;
  in: (...depts: string[]) => boolean;
  // Company plan: 'full' (MD, owners) or 'department' (a department head).
  plan: 'full' | 'department' | null;
  planDept: string | null;
}

export interface PlanMembership { access: 'full' | 'department'; department_slug: string | null }

export function makeAccess(profile: Profile | null, duties: Record<string, { profile_id: string | null }>, plan: PlanMembership | null = null): Access {
  const isMd = profile?.role === 'managing_director';
  const dept = profile?.department?.slug ?? null;
  const mine = new Set(Object.entries(duties).filter(([, d]) => d.profile_id && d.profile_id === profile?.id).map(([k]) => k));
  return {
    profile, isMd, dept, duties: mine, in: (...depts) => isMd || (!!dept && depts.includes(dept)),
    plan: isMd ? 'full' : plan?.access ?? null, planDept: isMd ? null : plan?.department_slug ?? null,
  };
}

function usePlanMembership(profileId: string | undefined) {
  const [m, setM] = useState<PlanMembership | null>(null);
  useEffect(() => {
    if (!profileId) { setM(null); return; }
    supabase.from('company_plan_members').select('access, department_slug').eq('profile_id', profileId).maybeSingle().then(({ data }) => setM((data as PlanMembership | null) ?? null));
  }, [profileId]);
  return m;
}

export function useAccess(): Access {
  const { profile } = useAuth();
  const duties = useDuties();
  const plan = usePlanMembership(profile?.id);
  return useMemo(() => makeAccess(profile, duties, plan), [profile, duties, plan]);
}
