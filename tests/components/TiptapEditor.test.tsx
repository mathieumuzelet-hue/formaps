import { render, screen, waitFor } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'

import { TiptapEditor } from '@/components/admin/TiptapEditor'

// ProseMirror needs DOM measurement APIs that jsdom doesn't implement.
beforeAll(() => {
  const rect = {
    x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
    toJSON: () => ({}),
  } as DOMRect
  Range.prototype.getBoundingClientRect = () => rect
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
  document.elementFromPoint = () => null
})

test("applique la valeur arrivée après le montage (hydratation différée du parent)", async () => {
  const onChange = vi.fn()
  // Reproduit NewsEditor : l'éditeur est monté avec '' AVANT que le state
  // parent ne soit hydraté depuis le serveur.
  const { rerender } = render(<TiptapEditor value="" onChange={onChange} />)

  // L'éditeur se crée dans un effet (immediatelyRender: false) — attendre la toolbar.
  await screen.findByRole('button', { name: 'Gras' })

  rerender(<TiptapEditor value="<p>Bonjour la Gazette</p>" onChange={onChange} />)

  await waitFor(() => {
    expect(screen.getByText('Bonjour la Gazette')).toBeInTheDocument()
  })
  // La resynchronisation ne doit PAS émettre onUpdate (sinon boucle / faux dirty).
  expect(onChange).not.toHaveBeenCalled()
})

test('ne ré-applique pas la valeur quand elle est déjà à jour (frappe utilisateur)', async () => {
  const onChange = vi.fn()
  const { rerender } = render(
    <TiptapEditor value="<p>Texte initial</p>" onChange={onChange} />,
  )
  await screen.findByText('Texte initial')

  // Le parent renvoie exactement le HTML courant (cycle onChange → value) :
  // aucun setContent ne doit avoir lieu (pas de reset de sélection/caret).
  rerender(<TiptapEditor value="<p>Texte initial</p>" onChange={onChange} />)
  expect(screen.getByText('Texte initial')).toBeInTheDocument()
  expect(onChange).not.toHaveBeenCalled()
})
