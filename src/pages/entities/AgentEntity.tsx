import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EntityViewProps } from '../../os/peek';
import { useEntityMeta } from '../../os/EntityLink';
import { supabase } from '../../lib/supabase';
import AgentPerformancePage from '../callCenter/AgentPerformancePage';

// A Call Center agent: days and starts, calls, cases, outreach, notes.
export default function AgentEntity({ id, mode }: EntityViewProps) {
  const nav = useNavigate();
  const name = useQuery({ queryKey: ['profile-name', id], queryFn: async () => (await supabase.from('profiles').select('full_name').eq('id', id).maybeSingle()).data?.full_name?.trim() ?? null });
  useEntityMeta('agent', id, mode, name.data);
  return <div className={mode === 'peek' ? 'p-4' : ''}><AgentPerformancePage agentId={id} onBack={() => nav(-1)} /></div>;
}
