import { render } from '@testing-library/react'
import { Icon } from '@/components/ui/Icon'
import { expect, test } from 'vitest'
test('rend une icône connue sans crash', () => {
  const { container } = render(<Icon name="compass" size={20} />)
  expect(container.querySelector('svg')).toBeInTheDocument()
})
test('icône inconnue ne crash pas', () => {
  const { container } = render(<Icon name="__nope__" />)
  expect(container).toBeInTheDocument()
})
