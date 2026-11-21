import { useEffect, useState } from 'react'
import { Alert, Card, PageHeader } from '@/components/ui'
import { platformSettingsService } from '@/services/platform-settings'

/**
 * Live deposits are locked to Winsoft Daraja Paybill 4088285.
 * Admin can view status only — no till / MegaPay / primary paybill switch.
 */
export function AdminPayMode({ embedded = false }: { embedded?: boolean }) {
  const [paybillAlt, setPaybillAlt] = useState<string | null>(null)
  const [payMode, setPayMode] = useState<string>('daraja')
  const [payRoute, setPayRoute] = useState<string>('paybill_alt')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void platformSettingsService.load().then((result) => {
      if (!result.ok) {
        setError(result.error)
        return
      }
      setPayMode(result.data.payMode)
      setPayRoute(result.data.payRoute)
      setPaybillAlt(result.data.paybillAlt)
    })
  }, [])

  const locked = payMode === 'daraja' && payRoute === 'paybill_alt'
  const form = (
    <div className="space-y-4" data-testid="admin-pay-mode">
      {error ? <Alert tone="warn">{error}</Alert> : null}
      <Card className="space-y-2 ring-1 ring-signal">
        <p className="text-sm font-semibold text-paper">
          Daraja · Paybill {paybillAlt ?? '4088285'}
          <span className="ml-2 text-xs font-semibold uppercase text-signal">
            {locked ? 'Locked' : 'Enforcing'}
          </span>
        </p>
        <p className="text-sm text-mist">
          All member deposits and withdraw-gate STKs use Winsoft Writers Daraja Paybill{' '}
          {paybillAlt ?? '4088285'} only. MegaPay, Till, and the primary paybill are not used for
          live payments.
        </p>
      </Card>
    </div>
  )

  if (embedded) return <Card className="space-y-4">{form}</Card>

  return (
    <div>
      <PageHeader
        title="Pay mode"
        subtitle="Live payments are locked to Winsoft Daraja Paybill 4088285."
      />
      {form}
    </div>
  )
}
