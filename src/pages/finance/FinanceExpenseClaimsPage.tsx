import { Receipt } from 'lucide-react';
import TransactionTypePage from '../../components/finance/TransactionTypePage';

export default function FinanceExpenseClaimsPage() {
  return (
    <TransactionTypePage
      type="expense_claim"
      title="Expense Claims"
      icon={Receipt}
      description="Employee reimbursement requests — business purpose, amount, and a supporting receipt required before approval."
      emptyText="No expense claims logged yet."
    />
  );
}
