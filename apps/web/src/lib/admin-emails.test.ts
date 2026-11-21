import { describe, expect, it } from 'vitest'
import { canAccessAdmin, roleWithAdminList } from '@/lib/admin-emails'

describe('canAccessAdmin', () => {
  it('does not treat a trader as staff', () => {
    expect(
      canAccessAdmin({ email: 'trader@example.com', role: 'trader' }),
    ).toBe(false)
  })

  it('allows dashboard staff roles even when the email is not on the Vite list', () => {
    expect(
      canAccessAdmin({ email: 'nicolekhaukani@gmail.com', role: 'superadmin' }),
    ).toBe(true)
    expect(canAccessAdmin({ email: 'ops@example.com', role: 'admin' })).toBe(true)
    expect(canAccessAdmin({ email: 'books@example.com', role: 'finance' })).toBe(true)
  })

  it('keeps superadmin when applying the allow-list', () => {
    expect(roleWithAdminList('nobody@example.com', 'superadmin')).toBe('superadmin')
  })
})
