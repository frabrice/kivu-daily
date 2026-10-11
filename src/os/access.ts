import { useMemo } from 'react';
import { useAuth } from '../lib/auth';
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
}

export function makeAccess(profile: Profile | null, duties: Record<string, { profile_id: string | null }>): Access {
  const isMd = profile?.role === 'managing_director';
  const dept = profile?.department?.slug ?? null;
  const mine = new Set(Object.entries(duties).filter(([, d]) => d.profile_id && d.profile_id === profile?.id).map(([k]) => k));
  return { profile, isMd, dept, duties: mine, in: (...depts) => isMd || (!!dept && depts.includes(dept)) };
}

export function useAccess(): Access {
  const { profile } = useAuth();
  const duties = useDuties();
  return useMemo(() => makeAccess(profile, duties), [profile, duties]);
}
