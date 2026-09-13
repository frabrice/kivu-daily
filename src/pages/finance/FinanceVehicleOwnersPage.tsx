import { Car } from 'lucide-react';
import TransactionTypePage from '../../components/finance/TransactionTypePage';

export default function FinanceVehicleOwnersPage() {
  return (
    <TransactionTypePage
      type="vehicle_owner_payment"
      title="Vehicle-Owner Payments"
      icon={Car}
      description="Settlements to vehicle owners, verified against operational days, deductions, and contract before payment. Paid from I&M."
      emptyText="No vehicle-owner payments logged yet."
    />
  );
}
