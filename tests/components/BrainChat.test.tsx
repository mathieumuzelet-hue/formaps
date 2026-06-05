import { render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import type { BrainMessage } from '@/lib/brain/useBrainChat'

const { useBrainChat } = vi.hoisted(() => ({ useBrainChat: vi.fn() }))

vi.mock('@/lib/brain/useBrainChat', () => ({ useBrainChat: () => useBrainChat() }))

import { BrainChat } from '@/components/brain/BrainChat'

function mockChat(messages: BrainMessage[], status = 'idle') {
  useBrainChat.mockReturnValue({ messages, status, send: vi.fn() })
}

test('chaque paire question/réponse est rendue dans sa propre carte', () => {
  mockChat([
    { role: 'user', text: 'q1' },
    { role: 'ai', text: 'r1' },
    { role: 'user', text: 'q2' },
    { role: 'ai', text: 'r2' },
  ])

  render(<BrainChat suggestions={[]} />)

  const cards = screen.getAllByTestId('brain-exchange')
  expect(cards).toHaveLength(2)
  // Question et réponse cohabitent dans la MÊME carte.
  expect(within(cards[0]).getByText('q1')).toBeInTheDocument()
  expect(within(cards[0]).getByText('r1')).toBeInTheDocument()
  expect(within(cards[1]).getByText('q2')).toBeInTheDocument()
  expect(within(cards[1]).getByText('r2')).toBeInTheDocument()
})

test("l'indicateur cerveau animé apparaît dans la carte de la question en cours", () => {
  mockChat(
    [
      { role: 'user', text: 'q1' },
      { role: 'ai', text: '' },
    ],
    'streaming',
  )

  render(<BrainChat suggestions={[]} />)

  const cards = screen.getAllByTestId('brain-exchange')
  expect(cards).toHaveLength(1)
  const indicator = within(cards[0]).getByTestId('brain-thinking')
  expect(indicator).toBeInTheDocument()
  // Accessible : l'animation reste annoncée comme « BRAIN réfléchit ».
  expect(indicator).toHaveAttribute('aria-label', 'BRAIN réfléchit')
})

test("pas d'indicateur quand le streaming est terminé", () => {
  mockChat([
    { role: 'user', text: 'q1' },
    { role: 'ai', text: 'r1' },
  ])

  render(<BrainChat suggestions={[]} />)

  expect(screen.queryByTestId('brain-thinking')).not.toBeInTheDocument()
})

test('aucune carte quand il n’y a pas encore de message', () => {
  mockChat([])
  render(<BrainChat suggestions={[]} />)
  expect(screen.queryByTestId('brain-exchange')).not.toBeInTheDocument()
})
