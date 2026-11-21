import { isDashboardAdminRole } from '@/domain/admin-dashboard'
import type { User, UserRole } from '@/types'

function parseEmails(raw: string | undefined): Set<string> {
  const emails = new Set<string>()
  if (!raw) return emails
  for (const part of raw.split(/[,;\s]+/)) {
    const email = part.trim().toLowerCase()
    if (email.includes('@')) emails.add(email)
  }
  return emails
}

const ADMIN_EMAILS = parseEmails(import.meta.env.VITE_ADMIN_EMAILS)
const VIP_EMAILS = parseEmails(import.meta.env.VITE_VIP_EMAILS)

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return ADMIN_EMAILS.has(email.trim().toLowerCase())
}

export function isVipEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return VIP_EMAILS.has(email.trim().toLowerCase())
}

export function roleWithAdminList(email: string | null | undefined, role: UserRole): UserRole {
  if (!isAdminEmail(email)) return role
  if (role === 'trader') return 'admin'
  return role
}

/** Admin console UI access: allow-listed emails or dashboard staff roles. Never used to sign anyone out. */
export function canAccessAdmin(user: Pick<User, 'email' | 'role'> | null | undefined): boolean {
  if (!user) return false
  if (isAdminEmail(user.email)) return true
  return isDashboardAdminRole(user.role)
}
