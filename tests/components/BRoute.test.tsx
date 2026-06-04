import { render, screen } from '@testing-library/react'
import { BRoute } from '@/components/route/BRoute'
import { expect, test } from 'vitest'
test('affiche les 5 libellés hors compact', () => {
  render(<BRoute current={1} />)
  expect(screen.getByText('Formation')).toBeInTheDocument()
  expect(screen.getByText('Préparation')).toBeInTheDocument()
})
test('compact masque les libellés', () => {
  render(<BRoute current={1} compact />)
  expect(screen.queryByText('Formation')).not.toBeInTheDocument()
})
