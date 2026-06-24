import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { BrandLockup } from '@/components/ui/BrandLockup'

test('rend le logo clair par défaut + le label FORMATION', () => {
  render(<BrandLockup />)
  expect(screen.getByText('Formation')).toBeInTheDocument()
  const src = screen.getByAltText('A+Super').getAttribute('src') ?? ''
  expect(decodeURIComponent(src)).toContain('logo-aps.png')
})

test('rend le logo blanc en mode onDark', () => {
  render(<BrandLockup onDark />)
  const src = screen.getByAltText('A+Super').getAttribute('src') ?? ''
  expect(decodeURIComponent(src)).toContain('logo-aps-white.png')
})
