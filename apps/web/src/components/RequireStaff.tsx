import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ProgressLoader } from '@/components/ProgressLoader'
import { useAuthSession } from '@/hooks/useAuth'
import { canAccessAdmin } from '@/lib/admin-emails'
import { TRADE_ROUTE } from '@/lib/auth-redirect'

function StaffGate() {
  return <ProgressLoader label="Opening admin" />
}

export function RequireStaff({ children }: { children: ReactNode }) {
  const { user, isSignedIn, loading } = useAuthSession()
  const location = useLocation()
  const allowed = canAccessAdmin(user)

  if (loading) return <StaffGate />

  if (!isSignedIn) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    )
  }

  if (!allowed) return <Navigate to={TRADE_ROUTE} replace />

  return children
}
