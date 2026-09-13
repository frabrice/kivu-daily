import { Truck } from 'lucide-react';
import TransactionTypePage from '../../components/finance/TransactionTypePage';

export default function FinanceSuppliersPage() {
  return (
    <TransactionTypePage
      type="supplier_payment"
      title="Supplier Payments"
      icon={Truck}
      description="Payments to suppliers — insurance, charging, maintenance, RURA, office/admin — supported by invoice or purchase order. Paid from I&M."
      emptyText="No supplier payments logged yet."
    />
  );
}
