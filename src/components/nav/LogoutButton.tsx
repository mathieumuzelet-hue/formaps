'use client'

import { signOut } from 'next-auth/react'

import { Icon } from '@/components/ui/Icon'

export function LogoutButton() {
  return (
    <button
      type="button"
      onClick={() => void signOut({ callbackUrl: '/connexion' })}
      className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-card px-[18px] py-[13px] text-[14px] font-bold text-redink"
    >
      <Icon name="logout" size={18} color="#A20D24" />
      Se déconnecter
    </button>
  )
}
