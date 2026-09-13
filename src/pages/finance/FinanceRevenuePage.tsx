import { TrendingUp } from 'lucide-react';
import TransactionTypePage from '../../components/finance/TransactionTypePage';

export default function FinanceRevenuePage() {
  return (
    <TransactionTypePage
      type="revenue"
      title="Revenue"
      icon={TrendingUp}
      description="Kivu Ride's own income — trip commissions, management fees, platform fees, and other business revenue. Posted to Equity."
      emptyText="No revenue logged yet."
    />
  );
}
