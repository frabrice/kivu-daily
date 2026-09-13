import { Wallet } from 'lucide-react';
import TransactionTypePage from '../../components/finance/TransactionTypePage';

export default function FinanceFleetCollectionsPage() {
  return (
    <TransactionTypePage
      type="fleet_collection"
      title="Fleet Collections"
      icon={Wallet}
      description="Driver versement, deposits, and MoMo collections. Held in Bank of Kigali per contract — never automatically Kivu revenue."
      emptyText="No fleet collections logged yet."
    />
  );
}
