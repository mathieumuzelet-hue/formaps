# Frontend Filet (PR ⑤ audit 2026-06-09) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corriger le CRITICAL FB-C1 (TiptapEditor n'affiche jamais le contenu existant → perte d'article) et les findings frontend des 4 passes d'audit du 2026-06-09.

**Architecture:** Série de correctifs indépendants sur des composants client existants (Tiptap sync, NewsEditor garde-fous, nav, login) + 2 fichiers App Router nouveaux (error.tsx, not-found.tsx). Aucune migration, aucun changement serveur. Chaque tâche est commitée séparément sur la branche `feat/frontend-filet`.

**Tech Stack:** Next.js 16 App Router, React 19, Tiptap v3.25, Tailwind 4, vitest + @testing-library/react (jsdom), tRPC v11 (mocké en test via `vi.mock('@/lib/trpc/client')`).

**Hors scope (décisions différées) :** contrastes WCAG `--color-sub`/`--color-faint` (décision design à valider visuellement), toolbar Tiptap a11y complète (role/aria-pressed/remplacement de window.prompt), garde de navigation in-app sur Link (App Router n'expose pas d'événement router bloquant — on couvre beforeunload + gating de « Publier »).

**Conventions du repo :** tests composants dans `tests/components/*.test.tsx`, mocks tRPC via `vi.hoisted` + `vi.mock('@/lib/trpc/client')` (voir `tests/components/FaqGapsAdmin.test.tsx`), textes UI en français, code/commits en anglais.

---

### Task 0: Branche

- [ ] **Step 1: Créer la branche depuis main**

```bash
git -C C:\Users\mathi\formaps checkout -b feat/frontend-filet
```

---

### Task 1: FB-C1 — TiptapEditor doit appliquer la valeur arrivée après le montage (CRITICAL)

Contexte : `useEditor({ content: value })` n'applique `value` qu'à la **construction** de l'éditeur. `NewsEditor` monte `TiptapEditor` avec `contentHtml = ''` puis hydrate son state depuis tRPC **après** — l'éditeur reste vide, et « Enregistrer » écrase l'article avec du quasi-vide. Confirmé par 2 audits indépendants dans `@tiptap/core` (`setOptions` ne ré-applique jamais le doc).

**Files:**
- Modify: `src/components/admin/TiptapEditor.tsx` (composant lignes 23-55)
- Test: `tests/components/TiptapEditor.test.tsx` (nouveau)

- [ ] **Step 1: Write the failing test**

ProseMirror exige des APIs de mesure DOM que jsdom n'implémente pas — polyfills en tête de fichier.

```tsx
// tests/components/TiptapEditor.test.tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/TiptapEditor.test.tsx`
Expected: FAIL — le premier test timeout sur `getByText('Bonjour la Gazette')` (l'éditeur reste vide). Si ProseMirror lève une erreur DOM manquante différente (ex. `elementFromPoint`), compléter le polyfill du `beforeAll` plutôt que de modifier le composant.

- [ ] **Step 3: Write minimal implementation**

Dans `src/components/admin/TiptapEditor.tsx`, ajouter l'import et l'effet de sync juste après le `useEditor` :

```tsx
import { useEffect } from 'react'
```

```tsx
  // `content` is only applied when the editor is constructed. When the parent
  // hydrates its form state AFTER mount (NewsEditor loads the article via
  // tRPC), re-apply the external value. No-op while typing: onUpdate keeps
  // `value` equal to editor.getHTML(), so the guard short-circuits.
  useEffect(() => {
    if (!editor) return
    if (editor.getHTML() === value) return
    editor.commands.setContent(value, { emitUpdate: false })
  }, [editor, value])
```

Note Tiptap v3 : la signature est `setContent(content, options)` avec `options.emitUpdate` (vérifié dans `node_modules/@tiptap/core/dist/index.d.ts:3144-3152`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/TiptapEditor.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/components/TiptapEditor.test.tsx src/components/admin/TiptapEditor.tsx
git commit -m "fix(admin): TiptapEditor applies value that arrives after mount

The editor was constructed with content='' before NewsEditor hydrated its
form state from the server, so reopening an existing article showed an empty
editor and Save would wipe the published content."
```

---

### Task 2: Élision « plus qu'aujourd'hui » sur la home

Contexte : à J-0 la home affiche « Bonjour X, plus que aujourd'hui. » (`src/app/(app)/page.tsx:47-49` rend `plus que{' '}<span>{joursLabel(...)}</span>`).

**Files:**
- Modify: `src/lib/home-format.ts`
- Modify: `src/app/(app)/page.tsx:47-49`
- Test: `tests/lib/home-format.test.ts` (existant — ajouter des cas)

- [ ] **Step 1: Write the failing test**

Ajouter à `tests/lib/home-format.test.ts` (conserver les tests existants) :

```ts
import { joursLabel, plusQuePrefix } from '@/lib/home-format'

test("plusQuePrefix élide devant aujourd'hui", () => {
  expect(plusQuePrefix(0)).toBe("plus qu'")
  expect(plusQuePrefix(-2)).toBe("plus qu'")
})

test('plusQuePrefix garde « plus que » devant un nombre de jours', () => {
  expect(plusQuePrefix(1)).toBe('plus que ')
  expect(plusQuePrefix(18)).toBe('plus que ')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/home-format.test.ts`
Expected: FAIL — `plusQuePrefix` is not exported.

- [ ] **Step 3: Write minimal implementation**

Dans `src/lib/home-format.ts`, ajouter :

```ts
/**
 * Prefix for the countdown sentence, with French elision:
 * `plus que 18 jours` but `plus qu'aujourd'hui` (no space after the
 * apostrophe). Pairs with `joursLabel`.
 */
export function plusQuePrefix(n: number): string {
  return n <= 0 ? "plus qu'" : 'plus que '
}
```

Dans `src/app/(app)/page.tsx`, remplacer (lignes 47-49) :

```tsx
            Bonjour {firstName}, plus que{' '}
            <span className="text-red">{joursLabel(store.joursRestants)}</span>.
```

par :

```tsx
            Bonjour {firstName}, {plusQuePrefix(store.joursRestants)}
            <span className="text-red">{joursLabel(store.joursRestants)}</span>.
```

et compléter l'import existant : `import { joursLabel, plusQuePrefix } from '@/lib/home-format'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/home-format.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/home-format.ts "src/app/(app)/page.tsx" tests/lib/home-format.test.ts
git commit -m "fix(home): French elision for the J-0 countdown label"
```

---

### Task 3: Classes Tailwind mortes `redSoft` → `redsoft`

Contexte : le token CSS est `--color-redsoft` (`src/app/globals.css:12`, tout minuscule). Les 3 occurrences camelCase ne matchent aucun utilitaire Tailwind 4 → badge « Nouveau » sans fond, boutons « Supprimer » sans bordure/hover.

**Files:**
- Modify: `src/components/admin/FormationDocumentsAdmin.tsx:111` (`bg-redSoft`)
- Modify: `src/components/admin/FormationDocumentsAdmin.tsx:136` (`border-redSoft` + `hover:bg-redSoft`)
- Modify: `src/components/admin/FormationsAdmin.tsx:174` (`border-redSoft` + `hover:bg-redSoft`)

- [ ] **Step 1: Remplacer les 3 occurrences**

Dans les deux fichiers, remplacer toute occurrence de `redSoft` par `redsoft` **dans les className uniquement** (ne PAS toucher `src/lib/design/tokens.ts` qui exporte légitimement `COLORS.redSoft` en camelCase côté JS).

- [ ] **Step 2: Vérifier qu'il ne reste aucune classe camelCase**

Run: `npx eslint src/components/admin/FormationDocumentsAdmin.tsx src/components/admin/FormationsAdmin.tsx` puis grep :
```bash
grep -rn "redSoft" C:\Users\mathi\formaps\src --include=*.tsx
```
Expected: une seule occurrence restante, `src/lib/design/tokens.ts` (objet JS, pas une className).

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/FormationDocumentsAdmin.tsx src/components/admin/FormationsAdmin.tsx
git commit -m "fix(admin): dead Tailwind classes bg-redSoft/border-redSoft (token is redsoft)"
```

---

### Task 4: Actualités accessible en mobile (MobileTabBar)

Contexte : `/actualites` (La Gazette) n'apparaît pas dans `MobileTabBar` (`src/components/nav/MobileTabBar.tsx:8-14`) — inaccessible en mobile. Il n'existe pas d'icône journal dans `src/components/ui/Icon.tsx`.

**Files:**
- Modify: `src/components/ui/Icon.tsx` (map des icônes, lignes ~43-79)
- Modify: `src/components/nav/MobileTabBar.tsx:8-14`
- Test: `tests/components/MobileTabBar.test.tsx` (existant — étendre)

- [ ] **Step 1: Write the failing test**

Ajouter au describe existant de `tests/components/MobileTabBar.test.tsx` (réutiliser le mock `next/navigation` déjà en place dans ce fichier ; le lire avant de modifier) :

```tsx
test('expose un onglet Actualités vers /actualites', () => {
  render(<MobileTabBar />)
  const link = screen.getByRole('link', { name: /actualités/i })
  expect(link).toHaveAttribute('href', '/actualites')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/MobileTabBar.test.tsx`
Expected: FAIL — no link named Actualités.

- [ ] **Step 3: Write minimal implementation**

Dans `src/components/ui/Icon.tsx` : ajouter `Newspaper` à l'import lucide-react existant et `news: Newspaper,` dans la map (ordre alphabétique du bloc existant non requis — suivre le style du fichier).

Dans `src/components/nav/MobileTabBar.tsx`, remplacer le tableau `TABS` :

```tsx
const TABS: ReadonlyArray<readonly [href: string, icon: string, label: string]> =
  [
    ['/', 'home', 'Accueil'],
    ['/formations', 'book', 'Former'],
    ['/brain', 'brain', 'BRAIN'],
    ['/actualites', 'news', 'Actus'],
    ['/profil', 'user', 'Profil'],
  ]
```

(Label court « Actus » : 5 onglets en 10.5px — vérifier visuellement plus tard, le label complet reste dans `aria-label` du `<nav>` parent inchangé. Le `name` du test matche via le texte « Actus » ? NON — ajuster le test pour matcher `/actus/i`.)

⚠️ Cohérence test/label : utiliser `/actus/i` dans le test du Step 1 (le label affiché est « Actus »).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/MobileTabBar.test.tsx`
Expected: PASS (anciens tests inclus — si un test existant assertait 4 onglets, le mettre à jour à 5).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Icon.tsx src/components/nav/MobileTabBar.tsx tests/components/MobileTabBar.test.tsx
git commit -m "feat(nav): Actualites tab in the mobile tab bar"
```

---

### Task 5: Profil (et donc déconnexion) accessible en desktop

Contexte : `LogoutButton` ne vit que sur `/profil`, et `/profil` n'est lié nulle part en desktop — l'avatar de `BNav` pointe `/compte/mot-de-passe` (`src/components/nav/BNav.tsx:83-89`). Un employé desktop ne peut pas se déconnecter. `/profil` contient déjà le lien mot-de-passe ET le logout : pointer l'avatar dessus règle les deux.

**Files:**
- Modify: `src/components/nav/BNav.tsx:83-89`
- Test: `tests/components/BNav.test.tsx` (existant — étendre/ajuster)

- [ ] **Step 1: Write the failing test**

Dans `tests/components/BNav.test.tsx` (lire le fichier d'abord, réutiliser ses mocks `next/navigation`) :

```tsx
test("l'avatar pointe vers le profil (accès logout desktop)", () => {
  render(<BNav firstName="Camille" role="employee" />)
  const avatar = screen.getByRole('link', { name: /mon profil/i })
  expect(avatar).toHaveAttribute('href', '/profil')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/BNav.test.tsx`
Expected: FAIL. Si un test existant asserte `href="/compte/mot-de-passe"` sur l'avatar, il devra être mis à jour au Step 3.

- [ ] **Step 3: Write minimal implementation**

Dans `src/components/nav/BNav.tsx`, remplacer le Link avatar :

```tsx
        <Link
          href="/profil"
          title="Mon profil"
          aria-label="Mon profil"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-sand text-[13px] font-bold transition-colors hover:bg-line"
        >
          {initials(firstName)}
        </Link>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/BNav.test.tsx`
Expected: PASS (avec les ajustements éventuels des assertions préexistantes).

- [ ] **Step 5: Commit**

```bash
git add src/components/nav/BNav.tsx tests/components/BNav.test.tsx
git commit -m "fix(nav): desktop avatar links to /profil so logout is reachable"
```

---

### Task 6: LoginForm — erreur réseau ne doit pas bloquer le bouton

Contexte : `signIn` sans try/catch (`src/components/auth/LoginForm.tsx:57-70`) — un rejet réseau laisse `submitting=true` à vie (« Connexion… » gelé).

**Files:**
- Modify: `src/components/auth/LoginForm.tsx:52-71`
- Test: `tests/components/LoginForm.test.tsx` (existant — ajouter un cas)

- [ ] **Step 1: Write the failing test**

Ajouter au describe existant :

```tsx
test('réactive le formulaire si signIn rejette (erreur réseau)', async () => {
  signIn.mockRejectedValue(new Error('fetch failed'))
  const user = userEvent.setup()
  render(<LoginForm />)

  await user.click(screen.getByRole('button', { name: /Embarquer/i }))

  expect(
    await screen.findByText('Identifiant ou mot de passe invalide'),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Embarquer/i })).toBeEnabled()
  expect(push).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/LoginForm.test.tsx`
Expected: FAIL — unhandled rejection / bouton resté « Connexion… ».

- [ ] **Step 3: Write minimal implementation**

Remplacer le corps de `handleSubmit` :

```tsx
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(false)
    setSubmitting(true)

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError(true)
        setSubmitting(false)
        return
      }

      router.push('/')
      router.refresh()
    } catch {
      // Network failure before NextAuth could answer — same UX as bad creds.
      setError(true)
      setSubmitting(false)
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/LoginForm.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/auth/LoginForm.tsx tests/components/LoginForm.test.tsx
git commit -m "fix(auth): login form recovers from a rejected signIn call"
```

---

### Task 7: Supprimer le faux bouton « Ouvrir sur SharePoint »

Contexte : `src/app/(app)/formations/[slug]/page.tsx:157-162` rend un `<div>` stylé comme le lien actif quand `sharepointUrl` est absent — non cliquable, sans feedback.

**Files:**
- Modify: `src/app/(app)/formations/[slug]/page.tsx:147-162`

- [ ] **Step 1: Remplacer le ternaire par un rendu conditionnel**

Remplacer le bloc lignes 147-162 par :

```tsx
          {formation.sharepointUrl && (
            <a
              href={formation.sharepointUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex items-center gap-[9px] border-t border-line pt-[14px] text-[13px] font-bold text-sub"
            >
              <Icon name="external" size={16} color="#8A7F6E" /> Ouvrir sur
              SharePoint
            </a>
          )}
```

(Le faux `<div>` disparaît ; `MarkDoneButton` suit immédiatement, inchangé.)

- [ ] **Step 2: Vérifier la compilation**

Run: `npx tsc --noEmit 2>&1 | grep -v admin-users-password`
Expected: aucune nouvelle erreur (les 2 erreurs connues de `tests/server/admin-users-password.test.ts` sont préexistantes).

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/formations/[slug]/page.tsx"
git commit -m "fix(formations): remove dead SharePoint pseudo-button when no URL"
```

---

### Task 8: NewsEditor — « Voir » masqué sur brouillon, « Publier » gated sur modifications non enregistrées, garde beforeunload

Contexte (3 findings) : (a) « Voir » sur un brouillon → 404 garanti (`news.bySlug` rejette les drafts) ; (b) « Publier » publie la version serveur en ignorant les modifications en cours ; (c) fermer l'onglet perd l'article en cours d'édition sans avertissement.

**Files:**
- Modify: `src/components/admin/NewsEditor.tsx`
- Test: `tests/components/NewsEditor.test.tsx` (nouveau)

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/components/NewsEditor.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { byIdQuery, updateMutation, setStatusMutation } = vi.hoisted(() => ({
  byIdQuery: vi.fn(),
  updateMutation: vi.fn(),
  setStatusMutation: vi.fn(),
}))

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      admin: {
        news: {
          byId: { invalidate: vi.fn() },
          list: { invalidate: vi.fn() },
        },
      },
    }),
    admin: {
      news: {
        byId: { useQuery: () => byIdQuery() },
        update: { useMutation: () => updateMutation() },
        setStatus: { useMutation: () => setStatusMutation() },
      },
    },
  },
}))

// Tiptap est testé séparément (TiptapEditor.test.tsx) — stub léger ici.
vi.mock('@/components/admin/TiptapEditor', () => ({
  TiptapEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="Contenu" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

import { NewsEditor } from '@/components/admin/NewsEditor'

const ARTICLE = {
  id: 'a1',
  title: 'Titre existant',
  slug: 'titre-existant',
  excerpt: '',
  authorName: '',
  contentHtml: '<p>corps</p>',
  status: 'draft',
  coverImageUrl: null,
  updatedAt: new Date('2026-06-01T10:00:00Z'),
}

function mockHappyPath(status: 'draft' | 'published') {
  byIdQuery.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { ...ARTICLE, status },
  })
  updateMutation.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false })
  setStatusMutation.mockReturnValue({ mutate: vi.fn(), isPending: false })
}

describe('NewsEditor', () => {
  beforeEach(() => {
    byIdQuery.mockReset()
    updateMutation.mockReset()
    setStatusMutation.mockReset()
  })

  test("masque « Voir » sur un brouillon (news.bySlug rejette les drafts)", () => {
    mockHappyPath('draft')
    render(<NewsEditor id="a1" />)
    expect(screen.queryByRole('link', { name: 'Voir' })).not.toBeInTheDocument()
  })

  test('affiche « Voir » quand l’article est publié', () => {
    mockHappyPath('published')
    render(<NewsEditor id="a1" />)
    expect(screen.getByRole('link', { name: 'Voir' })).toHaveAttribute(
      'href',
      '/actualites/titre-existant',
    )
  })

  test('désactive « Publier » tant que des modifications ne sont pas enregistrées', async () => {
    mockHappyPath('draft')
    const user = userEvent.setup()
    render(<NewsEditor id="a1" />)

    const publish = screen.getByRole('button', { name: 'Publier' })
    expect(publish).toBeEnabled()

    await user.type(screen.getByDisplayValue('Titre existant'), ' modifié')

    expect(screen.getByRole('button', { name: 'Publier' })).toBeDisabled()
    expect(screen.getByText(/modifications non enregistrées/i)).toBeInTheDocument()
  })

  test('arme beforeunload quand le formulaire est dirty', async () => {
    mockHappyPath('draft')
    const addSpy = vi.spyOn(window, 'addEventListener')
    const user = userEvent.setup()
    render(<NewsEditor id="a1" />)

    await user.type(screen.getByDisplayValue('Titre existant'), '!')

    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
    addSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/NewsEditor.test.tsx`
Expected: FAIL — « Voir » présent sur draft ; « Publier » jamais désactivé ; pas de beforeunload.

- [ ] **Step 3: Write minimal implementation**

Dans `src/components/admin/NewsEditor.tsx` :

1. Ajouter l'état dirty à côté de `saved` :

```tsx
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
```

2. Dans `update.onSuccess`, après `setSaved(true)` : `setDirty(false)`.

3. Dans CHAQUE onChange de champ (Titre, Chapô, Auteur, TiptapEditor), à côté du `setSaved(false)` existant, ajouter `setDirty(true)`.

4. Garde beforeunload (après les useState, avant le early-return loading — règle des hooks) :

```tsx
  // Warn before closing the tab while there are unsaved edits. In-app Link
  // navigation cannot be intercepted in the App Router; "Publier" is gated
  // on dirty instead.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
```

5. « Voir » conditionnel — remplacer le `<Link href={`/actualites/${article.slug}`} ...>Voir</Link>` par :

```tsx
          {isPublished && (
            <Link
              href={`/actualites/${article.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sand/50"
            >
              Voir
            </Link>
          )}
```

6. « Publier » gated + indicateur dirty — remplacer le bouton setStatus :

```tsx
          {dirty && (
            <span className="text-[12px] font-medium text-redink">
              Modifications non enregistrées
            </span>
          )}
          <button
            type="button"
            disabled={setStatus.isPending || dirty}
            title={dirty ? "Enregistrez vos modifications avant de publier" : undefined}
            onClick={() =>
              setStatus.mutate({ id, status: isPublished ? 'draft' : 'published' })
            }
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-sand/50 disabled:opacity-50"
          >
            {isPublished ? 'Dépublier' : 'Publier'}
          </button>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/NewsEditor.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/NewsEditor.tsx tests/components/NewsEditor.test.tsx
git commit -m "fix(admin): news editor guards (hide Voir on drafts, gate Publier on dirty, beforeunload)"
```

---

### Task 9: error.tsx + not-found.tsx globaux

Contexte : aucun `error.tsx` / `not-found.tsx` dans `src/app` — toute erreur RSC/tRPC affiche l'écran générique Next.js au salarié ; un 404 (`notFound()` de la page formation/actualité) affiche le 404 par défaut.

**Files:**
- Create: `src/app/error.tsx`
- Create: `src/app/not-found.tsx`

- [ ] **Step 1: Créer `src/app/error.tsx`** (doit être un client component)

```tsx
'use client'

export default function Error({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-5 py-24 text-center md:px-10">
      <div className="mb-4 text-[13px] font-bold uppercase tracking-[0.04em] text-red">
        Cockpit
      </div>
      <h1 className="font-serif text-[27px] font-medium leading-[1.05] tracking-[-0.02em] md:text-[38px]">
        Une erreur est survenue.
      </h1>
      <p className="mt-4 max-w-[440px] text-[15.5px] leading-[1.6] text-sub">
        Le problème est de notre côté, pas du vôtre. Réessayez — si ça persiste,
        prévenez votre référent.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-8 rounded-[10px] bg-red px-6 py-[13px] text-[14.5px] font-bold text-white"
      >
        Réessayer
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Créer `src/app/not-found.tsx`**

```tsx
import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-5 py-24 text-center md:px-10">
      <div className="mb-4 text-[13px] font-bold uppercase tracking-[0.04em] text-red">
        Cockpit
      </div>
      <h1 className="font-serif text-[27px] font-medium leading-[1.05] tracking-[-0.02em] md:text-[38px]">
        Page introuvable.
      </h1>
      <p className="mt-4 max-w-[440px] text-[15.5px] leading-[1.6] text-sub">
        Cette page n&apos;existe pas ou n&apos;est plus disponible.
      </p>
      <Link
        href="/"
        className="mt-8 rounded-[10px] bg-red px-6 py-[13px] text-[14.5px] font-bold text-white"
      >
        Retour à l&apos;accueil
      </Link>
    </div>
  )
}
```

- [ ] **Step 3: Vérifier la compilation et le lint**

Run: `npx tsc --noEmit 2>&1 | grep -v admin-users-password` puis `npm run lint`
Expected: propre. (Note : `error.tsx` reçoit la prop `error` non utilisée — la garder dans la signature de type mais la déstructurer seulement si le lint exige ; sinon préfixer `_error`.)

- [ ] **Step 4: Commit**

```bash
git add src/app/error.tsx src/app/not-found.tsx
git commit -m "feat(app): branded error and not-found pages"
```

---

### Task 10: Empty state de la grille formations

Contexte : `src/app/(app)/formations/page.tsx:20-24` — 0 formation = grille vide sans message.

**Files:**
- Modify: `src/app/(app)/formations/page.tsx:20-24`

- [ ] **Step 1: Rendu conditionnel**

Remplacer le bloc grille par :

```tsx
      {formations.length === 0 ? (
        <div className="rounded-[14px] border border-line bg-surface px-6 py-7">
          <p className="text-[14.5px] leading-[1.5] text-sub">
            Aucune formation disponible pour le moment — les contenus arrivent
            bientôt.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {formations.map((formation, i) => (
            <FormationCard key={formation.id} formation={formation} index={i} />
          ))}
        </div>
      )}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `npx tsc --noEmit 2>&1 | grep -v admin-users-password`
Expected: propre.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/formations/page.tsx"
git commit -m "feat(formations): empty state when no formation is published"
```

---

### Task 11: Labels associés aux inputs (a11y formulaires admin)

Contexte : les formulaires admin rendent `<label>` et `<input>` frères non liés (pas de `htmlFor`/`id`) — lecteurs d'écran muets, clic label inerte. `ChangePasswordForm` fait déjà bien (modèle à suivre).

**Files:**
- Modify: `src/components/admin/NewsEditor.tsx` (Titre, Chapô, Auteur, Image de couverture — PAS « Contenu », le TiptapEditor n'est pas un input natif)
- Modify: `src/components/admin/MagasinsAdmin.tsx`
- Modify: `src/components/admin/FormationsAdmin.tsx`
- Modify: `src/components/admin/UtilisateursAdmin.tsx`
- Modify: `src/components/admin/FormationDocumentsAdmin.tsx`

- [ ] **Step 1: Lire chaque fichier et associer chaque paire label/input**

Pattern (formulaires single-instance → ids littéraux préfixés par domaine) :

```tsx
<label htmlFor="news-title" className={LABEL}>Titre</label>
<input id="news-title" ... />
```

Préfixes : `news-`, `store-`, `formation-`, `user-`, `doc-`. Pour les inputs DANS des lignes de liste (édition inline répétée), utiliser l'id de l'entité : `id={`store-${s.id}-name`}`. Ne pas toucher aux composants qui imbriquent déjà l'input dans le label (pattern alternatif valide, ex. `LoginForm`).

- [ ] **Step 2: Vérifier que les tests composants existants passent toujours**

Run: `npx vitest run tests/components/`
Expected: PASS — les tests utilisent `getByText`/`getByPlaceholderText`, l'ajout d'attributs ne casse rien. Si un test utilisait `getByLabelText` en échec avant, il marche maintenant.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/
git commit -m "fix(a11y): associate labels with inputs across admin forms"
```

---

### Task 12: Vérification finale + PR

- [ ] **Step 1: Suite complète + lint + types**

```bash
npm test
npm run lint
npx tsc --noEmit
```
Expected: tous les tests verts (321 + les nouveaux), lint 0 warning, tsc avec UNIQUEMENT les 2 erreurs préexistantes `tests/server/admin-users-password.test.ts:61`.

- [ ] **Step 2: Push de la branche + PR**

```bash
git push -u origin feat/frontend-filet
gh pr create --title "Frontend safety net: Tiptap content loss fix + audit PR 5 findings" --body "..."
```
Body : résumer FB-C1 (CRITICAL) + la liste des 10 fixes, référencer `docs/reviews/2026-06-09-fable5-audit.md`. NE PAS merger : CI verte requise + revue.
