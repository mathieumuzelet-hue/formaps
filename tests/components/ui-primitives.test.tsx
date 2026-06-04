import { render, screen } from '@testing-library/react'
import { ApsLogo } from '@/components/ui/ApsLogo'
import { ImgSlot } from '@/components/ui/ImgSlot'
import { expect, test } from 'vitest'

test('ApsLogo rend une image avec alt A+SUPER', () => {
  render(<ApsLogo height={30} />)
  const img = screen.getByAltText('A+SUPER')
  expect(img).toBeInTheDocument()
})

test('ImgSlot rend son libellé', () => {
  render(<ImgSlot label="visuel de couverture" />)
  expect(screen.getByText('visuel de couverture')).toBeInTheDocument()
})
