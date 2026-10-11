import { EntityViewProps } from '../../os/peek';

// Kivu OS object page - built in a later step.
export default function AgentEntity({ id }: EntityViewProps) {
  return <div className="p-6 text-body text-fg-muted">{id}</div>;
}
