import { useEffect, useState, useCallback } from 'react';
import { supabase, Driver, CallLog, CallReason, CallOutcome, CallScript } from './supabase';

export function useCallCenterData() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [reasons, setReasons] = useState<CallReason[]>([]);
  const [outcomes, setOutcomes] = useState<CallOutcome[]>([]);
  const [scripts, setScripts] = useState<CallScript[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [d, l, r, o, s] = await Promise.all([
      supabase.from('drivers').select('*'),
      supabase.from('call_logs').select('*, outcome:call_outcomes(*), reason:call_reasons(*), caller:profiles(*)').order('created_at', { ascending: false }),
      supabase.from('call_reasons').select('*').order('sort_order'),
      supabase.from('call_outcomes').select('*').order('sort_order'),
      supabase.from('call_scripts').select('*').order('created_at', { ascending: false }),
    ]);
    setDrivers((d.data as Driver[]) ?? []);
    setLogs((l.data as CallLog[]) ?? []);
    setReasons((r.data as CallReason[]) ?? []);
    setOutcomes((o.data as CallOutcome[]) ?? []);
    setScripts((s.data as CallScript[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('call-center-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_logs' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_scripts' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  return { drivers, logs, reasons, outcomes, scripts, loading, reload: load };
}

export const STAGE_LABEL: Record<string, string> = {
  applying: 'Applying', raw: 'Raw', ready: 'Ready', active: 'Active', flagged: 'Flagged', inactive: 'Inactive',
};
