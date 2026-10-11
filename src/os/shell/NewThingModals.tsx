import { useMemo } from 'react';
import AssignTaskModal from '../../components/AssignTaskModal';
import CreateAnnouncementModal from '../../components/CreateAnnouncementModal';
import CreateMeetingModal from '../../components/CreateMeetingModal';
import { useCompanyData } from '../../lib/company';

// The "+ New" menu in the top bar opens these from any page.
export function AssignTaskHost({ onClose }: { onClose: () => void }) {
  const { profiles } = useCompanyData();
  const employees = useMemo(() => profiles.filter((p) => p.role === 'employee' && p.is_active), [profiles]);
  return <AssignTaskModal open onClose={onClose} employees={employees} onAssigned={onClose} />;
}

export function AnnouncementHost({ onClose }: { onClose: () => void }) {
  return <CreateAnnouncementModal open onClose={onClose} />;
}

export function MeetingHost({ onClose }: { onClose: () => void }) {
  return <CreateMeetingModal open onClose={onClose} />;
}
