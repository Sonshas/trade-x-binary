import { AdminFeesPanel } from "@/features/admin/AdminFeesPanel";
import { AdminPayMode } from "@/features/admin/AdminPayMode";
import { AdminWithdrawControls } from "@/features/admin/AdminWithdrawControls";
import { AdminTradeSettingsPage } from "@/features/admin/AdminTradeSettingsPage";
import { AdminTablePage } from "@/features/admin/AdminTables";
import { RealAdminDashboard } from "@/features/admin/RealAdminDashboard";
import { DailyDepositsAdmin } from "@/features/admin/DailyDepositsAdmin";
import { RealWithdrawalsAdmin } from "@/features/admin/RealWithdrawalsAdmin";
import { SystemHealthPanel } from "@/features/admin/SystemHealthPanel";
import { realAccountShort } from "@/lib/branding";

export { AdminUsersLivePage as AdminUsersPage } from "@/features/admin/AdminUsersLive";
export {
  AdminAuditPage,
  AdminDepositsLivePage as AdminDepositsPage,
  AdminLedgerLivePage as AdminLedgerPage,
  AdminMarketsPage,
  AdminMegapayPage,
  AdminNotificationsLivePage as AdminNotificationsPage,
  AdminStkQueuePage,
  AdminSupportLivePage as AdminSupportPage,
  AdminTradesLivePage as AdminTradesPage,
} from "@/features/admin/AdminOpsPages";

export function AdminSystemPage() {
  return <SystemHealthPanel />;
}

export function AdminDashboardPage() {
  return <RealAdminDashboard />;
}

export function AdminDailyDepositsPage() {
  return (
    <AdminTablePage
      title="Daily deposits"
      subtitle="Pick a Nairobi date to see that day’s completed deposit earnings in USD and KES."
      message="KES uses the Superadmin deposit conversion rate (USD × rate). Changing the date reloads that calendar day."
    >
      <DailyDepositsAdmin />
    </AdminTablePage>
  );
}

export function AdminWithdrawalsPage() {
  return (
    <AdminTablePage
      title="Withdrawals"
      subtitle={`${realAccountShort()} withdrawals from Supabase. COMPLETED only after the M-Pesa receipt or B2C confirmation.`}
      message={`The ${realAccountShort().toLowerCase()} balance is held when a withdrawal is requested. Complete it with the M-Pesa receipt, or fail it to refund the hold.`}
    >
      <div data-testid="admin-withdrawals-real">
        <RealWithdrawalsAdmin />
      </div>
    </AdminTablePage>
  );
}

export function AdminTradeSettingsRoute() {
  return <AdminTradeSettingsPage />;
}

export function AdminWithdrawControlsPage() {
  return <AdminWithdrawControls />;
}

export function AdminFeesPage() {
  return (
    <AdminTablePage
      title="Fees & payments"
      subtitle={`Deposit pay mode, wallet rates, and cash-out limits for the ${realAccountShort()} wallet.`}
      message="Pay mode and wallet fees save separately. Stake limits, trade payout, and win rates are under Trade settings. Gate prompts stay under Withdrawal controls."
    >
      <div className="space-y-6">
        <AdminPayMode embedded />
        <AdminFeesPanel />
      </div>
    </AdminTablePage>
  );
}
