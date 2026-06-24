# Refonte design FormA⁺Super (charte avril 2026) - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Appliquer fidèlement la nouvelle charte « FormA⁺Super » (Direction B, handoff Claude Design avril 2026) à toute l'application Cockpit/formaps.

**Architecture:** Le style est centralisé via les tokens Tailwind 4 `@theme` (`src/app/globals.css`) et l'objet `COLORS` (`src/lib/design/tokens.ts`). On met à jour la palette une fois → propagation quasi-globale, puis on retouche à la main les composants partagés (lockup de marque, panneau login violine, timeline `onDark`, avatar) et on balaie les couleurs hex codées en dur, écran par écran.

**Tech Stack:** Next.js 16 (App Router), Tailwind CSS 4 (`@theme` inline), React 18, TypeScript, Vitest + Testing Library.

## Global Constraints

- **Source de vérité du design** : `D:\Téléchargements DATA\Bot Brain APS-handoff\bot-brain-aps\project\directions\dirB.jsx` (+ `shared.jsx`). Recréer la mise en page, pas seulement les tokens.
- **Nouvelle palette (verbatim du prototype `B`)** : bg/crème `#FFFAEF` · surface `#FFFFFF` · panel `#FBF4E6` · card `#FFFFFF` · ink/violine `#511227` · sub `#7C606A` · faint `#B3A1A8` · line `#EBDFCD` · red (Rouge Auchan) `#E0001A` · redSoft `#FBE7E2` · redInk → violine `#511227` · coral (accent login) `#FF6A78`.
- **Typo** : Montserrat unique. Titres en extra-bold (`font-extrabold`, poids 800) conformes au prototype.
- **Lockup de marque** : logo PNG officiel + trait vertical + label « FORMATION » en capitales (décision user). Remplace le « cercle rouge + boussole + FormA+Super » partout (nav, login, mobile, admin).
- **Périmètre** : toute l'app, peaufinée à la main (décision user) - écrans salarié + admin + gazette + profil.
- **Règles maison** : aucun tiret cadratin (`—`/`–`) dans le code/commentaires/UI, remplacer par `-`. Accents FR corrects dans l'UI. Identifiants techniques (volumes `cockpit_*`, routeur Traefik) INTACTS.
- **Identifiants techniques INTACTS** : ne renommer aucun token CSS variable de façon qui casse un import ; on ajoute des tokens, on ne supprime pas `sand`/`redink`/`redsoft` (encore référencés).
- **Gate par tâche** : `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm test` tous verts avant commit. Vérif navigateur authentifié à la fin (feedback_design_handoff_fidelity).

---

### Task 1: Mise à jour de la palette de tokens

**Files:**
- Modify: `src/app/globals.css:3-18` (bloc `@theme`)
- Modify: `src/lib/design/tokens.ts:1-6` (objet `COLORS`)
- Test: `tests/lib/tokens.test.ts`

**Interfaces:**
- Produces: tokens Tailwind `bg-bg surface card panel ink violine sub faint line red redsoft redink cream coral sand` et `COLORS.{bg,surface,card,panel,ink,violine,sub,faint,line,red,redSoft,redInk,cream,coral,sand}`.

- [ ] **Step 1: Mettre à jour `tests/lib/tokens.test.ts`** (le test fige l'ancienne valeur rouge)

```ts
import { describe, it, expect } from 'vitest'
import { COLORS } from '@/lib/design/tokens'

describe('design tokens', () => {
  it('expose la charte FormA+Super (avril 2026)', () => {
    expect(COLORS.red).toBe('#E0001A')
    expect(COLORS.ink).toBe('#511227')
    expect(COLORS.violine).toBe('#511227')
    expect(COLORS.bg).toBe('#FFFAEF')
    expect(COLORS.coral).toBe('#FF6A78')
  })
})
```

(Adapter le reste du fichier existant : remplacer toute assertion sur `#C8102E`/`#221C16`/`#F4EEE3`.)

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `npm test -- tokens`
Expected: FAIL (COLORS.red vaut encore `#C8102E`, `COLORS.violine`/`COLORS.coral` indéfinis)

- [ ] **Step 3: Mettre à jour `src/lib/design/tokens.ts`**

```ts
export const COLORS = {
  bg: '#FFFAEF', surface: '#FFFFFF', card: '#FFFFFF', panel: '#FBF4E6',
  ink: '#511227', violine: '#511227', sub: '#7C606A', faint: '#B3A1A8',
  line: '#EBDFCD', red: '#E0001A', redSoft: '#FBE7E2', redInk: '#511227',
  cream: '#FFFAEF', coral: '#FF6A78', sand: '#F1E7D4',
} as const

export const STAGES = ['Préparation', 'Formation', 'Tests', 'Bascule', 'Ouverture'] as const
export type StageIndex = 0 | 1 | 2 | 3 | 4
```

- [ ] **Step 4: Mettre à jour le bloc `@theme` de `src/app/globals.css`**

```css
@theme {
  --color-bg: #FFFAEF;
  --color-surface: #FFFFFF;
  --color-card: #FFFFFF;
  --color-panel: #FBF4E6;
  --color-ink: #511227;
  --color-violine: #511227;
  --color-sub: #7C606A;
  --color-faint: #B3A1A8;
  --color-line: #EBDFCD;
  --color-red: #E0001A;
  --color-redsoft: #FBE7E2;
  --color-redink: #511227;
  --color-cream: #FFFAEF;
  --color-coral: #FF6A78;
  --color-sand: #F1E7D4;

  --font-serif: var(--font-montserrat), system-ui, sans-serif;
  --font-sans: var(--font-montserrat), system-ui, sans-serif;
}
```

- [ ] **Step 5: Lancer test + lint + typecheck**

Run: `npm test -- tokens && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css src/lib/design/tokens.ts tests/lib/tokens.test.ts
git commit -m "feat(design): apply FormA+Super charte tokens (violine + rouge auchan)"
```

---

### Task 2: Asset logo blanc + composant BrandLockup

**Files:**
- Create: `public/logo-aps-white.png` (copie depuis le handoff, 467x147)
- Create: `src/components/ui/BrandLockup.tsx`
- Test: `tests/components/BrandLockup.test.tsx`

**Interfaces:**
- Produces: `BrandLockup({ onDark?: boolean; logoH?: number })` - rend `<img alt="A+Super">` (blanc si `onDark`) + séparateur + label « FORMATION ».

- [ ] **Step 1: Copier l'asset**

```bash
cp "/d/Téléchargements DATA/Bot Brain APS-handoff/bot-brain-aps/project/assets/logo-aps-white.png" public/logo-aps-white.png
```

- [ ] **Step 2: Écrire le test `tests/components/BrandLockup.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import { BrandLockup } from '@/components/ui/BrandLockup'

it('rend le logo clair par défaut + le label FORMATION', () => {
  render(<BrandLockup />)
  expect(screen.getByText('Formation')).toBeInTheDocument()
  expect(screen.getByAltText('A+Super')).toHaveAttribute('src', expect.stringContaining('logo-aps.png'))
})

it('rend le logo blanc en mode onDark', () => {
  render(<BrandLockup onDark />)
  expect(screen.getByAltText('A+Super')).toHaveAttribute('src', expect.stringContaining('logo-aps-white.png'))
})
```

(Note : avec `next/image`, l'`src` est réécrit. Si l'assertion `src` échoue, vérifier via `decodeURIComponent` du `src` ou matcher sur `logo-aps-white`. Adapter le matcher au rendu réel de `next/image` en test.)

- [ ] **Step 3: Lancer le test → échec attendu**

Run: `npm test -- BrandLockup`
Expected: FAIL (module introuvable)

- [ ] **Step 4: Écrire `src/components/ui/BrandLockup.tsx`**

```tsx
import Image from 'next/image'

const INTRINSIC_W = 467
const INTRINSIC_H = 147
const RATIO = INTRINSIC_W / INTRINSIC_H

export type BrandLockupProps = {
  onDark?: boolean
  logoH?: number
}

export function BrandLockup({ onDark = false, logoH = 28 }: BrandLockupProps) {
  const width = Math.round(logoH * RATIO)
  return (
    <div className="flex items-center gap-3">
      <Image
        src={onDark ? '/logo-aps-white.png' : '/logo-aps.png'}
        alt="A+Super"
        height={logoH}
        width={width}
        style={{ height: logoH, width: 'auto', display: 'block' }}
        priority
      />
      <span
        aria-hidden="true"
        className={onDark ? 'bg-white/30' : 'bg-line'}
        style={{ width: 1, height: logoH * 0.82 }}
      />
      <span
        className={`font-sans font-bold uppercase tracking-[0.16em] ${onDark ? 'text-cream' : 'text-violine'}`}
        style={{ fontSize: logoH * 0.42 }}
      >
        Formation
      </span>
    </div>
  )
}
```

- [ ] **Step 5: Lancer le test → succès**

Run: `npm test -- BrandLockup`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add public/logo-aps-white.png src/components/ui/BrandLockup.tsx tests/components/BrandLockup.test.tsx
git commit -m "feat(ui): BrandLockup (logo officiel + label FORMATION, variante onDark)"
```

---

### Task 3: Variante `onDark` de la timeline BRoute

**Files:**
- Modify: `src/components/route/BRoute.tsx`
- Modify: `src/components/route/BRoute.tsx` ligne 38 (couleur du check : déjà `#fff`, OK)
- Test: `tests/components/BRoute.test.tsx`

**Interfaces:**
- Consumes: `STAGES` (tokens.ts).
- Produces: `BRoute({ current?: number; compact?: boolean; onDark?: boolean })`.

- [ ] **Step 1: Ajouter un test onDark à `tests/components/BRoute.test.tsx`**

```tsx
it('rend les libellés en clair sur fond sombre (onDark)', () => {
  render(<BRoute current={1} onDark />)
  // les libellés restent présents ; le rendu visuel diffère (couleurs inline)
  expect(screen.getByText('Formation')).toBeInTheDocument()
  expect(screen.getByText('Préparation')).toBeInTheDocument()
})
```

- [ ] **Step 2: Lancer → échec si la prop n'existe pas (TS)** puis implémenter.

Run: `npm run typecheck`
Expected: FAIL (prop `onDark` inconnue) une fois le test ajouté avec la prop.

- [ ] **Step 3: Réécrire `src/components/route/BRoute.tsx`** pour gérer `onDark`

```tsx
import { STAGES } from '@/lib/design/tokens'
import { Icon } from '@/components/ui/Icon'

export type BRouteProps = {
  current?: number
  compact?: boolean
  onDark?: boolean
}

export function BRoute({ current = 1, compact, onDark = false }: BRouteProps) {
  const progressWidth = `${(current / (STAGES.length - 1)) * 84}%`
  const track = onDark ? 'bg-white/20' : 'bg-line'
  const idleCircle = onDark ? 'border-white/30 bg-white/[0.08]' : 'border-line bg-surface'
  const idleNum = onDark ? 'text-white/70' : 'text-faint'
  const labelOn = onDark ? 'text-cream' : 'text-ink'
  const labelOff = onDark ? 'text-white/60' : 'text-sub'
  return (
    <div className="relative flex items-start">
      <div className={`absolute top-[13px] left-[8%] right-[8%] h-0.5 ${track}`} />
      <div className="absolute top-[13px] left-[8%] h-0.5 bg-red" style={{ width: progressWidth }} />
      {STAGES.map((s, i) => {
        const done = i < current
        const on = i === current
        return (
          <div key={s} className="z-[1] flex flex-1 flex-col items-center gap-[9px]">
            <div
              className={`flex items-center justify-center rounded-full border-2 transition-all duration-200 ${
                on ? 'h-7 w-7 border-red bg-red'
                  : done ? 'h-[22px] w-[22px] border-red bg-red'
                    : `h-[22px] w-[22px] ${idleCircle}`
              }`}
            >
              {done ? (
                <Icon name="check" size={13} color="#fff" strokeWidth={2.4} />
              ) : on ? (
                <span className="h-2 w-2 rounded-full bg-white" />
              ) : (
                <span className={`text-[11px] font-bold ${idleNum}`}>{i + 1}</span>
              )}
            </div>
            {!compact && (
              <div className={`text-center text-[12.5px] ${on ? `font-extrabold ${labelOn}` : `font-semibold ${labelOff}`}`}>
                {s}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Lancer test + typecheck → succès**

Run: `npm test -- BRoute && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/route/BRoute.tsx tests/components/BRoute.test.tsx
git commit -m "feat(route): BRoute onDark variant for violine surfaces"
```

---

### Task 4: Refonte du login (panneau violine)

**Files:**
- Modify: `src/app/(auth)/connexion/page.tsx`
- Modify: `src/components/auth/LoginForm.tsx` (eyebrow + libellés uppercase, `text-redink` reste = violine)
- Test: `tests/components/ConnexionPage.test.tsx`, `tests/components/LoginForm.test.tsx` (doivent rester verts)

**Interfaces:**
- Consumes: `BrandLockup` (Task 2, onDark), `BRoute` (Task 3, onDark), `LoginForm`.

- [ ] **Step 1: Réécrire le panneau gauche + droite de `connexion/page.tsx`**

Remplacer le bloc JSX retourné (garder la logique `auth()`/`redirect`/`searchParams`) par :

```tsx
  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      {/* Gauche - panneau de marque violine (charte : logo blanc sur fond coloré) */}
      <div className="relative flex w-full flex-col overflow-hidden bg-violine px-[56px] py-[54px] text-cream md:w-[54%]">
        <div className="pointer-events-none absolute -right-[120px] -top-[100px] h-[360px] w-[360px] rounded-full bg-red/[0.16]" />
        <div className="pointer-events-none absolute -bottom-[140px] right-[30px] h-[280px] w-[280px] rounded-full bg-cream/5" />
        <BrandLockup onDark logoH={30} />
        <div className="relative mb-[42px] mt-auto">
          <div className="mb-4 text-[12.5px] font-bold uppercase tracking-[0.14em] text-cream/85">
            Auchan&nbsp;&nbsp;→&nbsp;&nbsp;Intermarché
          </div>
          <h1 className="m-0 max-w-[470px] font-sans text-[44px] font-extrabold leading-[1.08] tracking-[-0.02em]">
            Chaque étape du trajet, <span className="text-coral">accompagnée</span>.
          </h1>
          <p className="mt-[18px] max-w-[430px] text-[15px] leading-[1.6] text-cream/80">
            FormA⁺Super réunit vos formations, vos repères et l’assistant BRAIN pour
            traverser la bascule sereinement, ensemble.
          </p>
        </div>
        <div className="relative">
          <BRoute current={1} onDark />
        </div>
      </div>

      {/* Droite - formulaire */}
      <div className="flex flex-1 items-center justify-center bg-bg p-10">
        <div className="w-[350px] max-w-full">
          <div className="mb-[10px] text-[11.5px] font-bold uppercase tracking-[0.12em] text-red">
            Portail formation
          </div>
          <h2 className="m-0 font-sans text-[30px] font-extrabold tracking-[-0.01em]">Se connecter</h2>
          <p className="mb-7 mt-[7px] text-[14px] text-sub">Avec votre identifiant salarié A⁺Super.</p>

          {changed === '1' && (
            <p role="status" className="mb-4 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink">
              Mot de passe modifié, reconnectez-vous.
            </p>
          )}

          <LoginForm />

          <p className="mt-6 text-center text-[12px] leading-[1.5] text-faint">
            Accès réservé aux salariés du groupe.
          </p>
        </div>
      </div>
    </div>
  )
```

Retirer les imports devenus inutiles (`Icon`, `ApsLogo`) et ajouter `BrandLockup`.

- [ ] **Step 2: Ajuster `LoginForm.tsx`** - libellés en capitales façon prototype

Dans `Field`, remplacer la ligne du label par :
```tsx
        <div className="mb-[7px] text-[11.5px] font-bold uppercase tracking-[0.08em] text-sub">{label}</div>
```
Le lien « Mot de passe oublié ? » : `text-violine` (au lieu de `text-redink`, équivalent mais explicite).

- [ ] **Step 3: Lancer les tests login → verts**

Run: `npm test -- ConnexionPage LoginForm && npm run typecheck && npm run lint -- --max-warnings 0`
Expected: PASS (corriger toute assertion cassée)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(auth)/connexion/page.tsx" src/components/auth/LoginForm.tsx
git commit -m "feat(login): violine brand panel with white logo + coral accent (charte refonte)"
```

---

### Task 5: Nav desktop (BNav) - lockup + avatar violine

**Files:**
- Modify: `src/components/nav/BNav.tsx`
- Test: `tests/components/BNav.test.tsx` (rester vert)

**Interfaces:**
- Consumes: `BrandLockup` (Task 2).

- [ ] **Step 1: Remplacer le lockup et l'avatar dans `BNav.tsx`**

- Remplacer le bloc `<Link href="/" ...>` (cercle rouge + boussole + texte) par :
```tsx
      <Link href="/" className="flex items-center" aria-label="Accueil FormA+Super">
        <BrandLockup logoH={28} />
      </Link>
```
- Avatar : remplacer `bg-sand text-[13px] font-bold` par `bg-violine text-cream text-[12.5px] font-bold` et retirer `hover:bg-line` (mettre `hover:opacity-90`).
- Retirer le `<ApsLogo height={28} />` final (le logo est désormais dans le lockup de gauche).
- Mettre à jour imports (`BrandLockup` ajouté ; `Icon`/`ApsLogo` retirés s'ils ne servent plus - `Icon` sert encore pour search/bell, le garder).

- [ ] **Step 2: Tests + lint + typecheck**

Run: `npm test -- BNav && npm run typecheck && npm run lint -- --max-warnings 0`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/nav/BNav.tsx
git commit -m "feat(nav): official logo lockup + violine avatar in BNav"
```

---

### Task 6: Barres mobiles (MobileBrandBar + MobileTabBar)

**Files:**
- Modify: `src/components/nav/MobileBrandBar.tsx`
- Modify: `src/components/nav/MobileTabBar.tsx:44` (hex en dur)
- Test: `tests/components/MobileTabBar.test.tsx` (rester vert)

- [ ] **Step 1: `MobileBrandBar.tsx`** - remplacer cercle+boussole+texte par `BrandLockup logoH={22}`

```tsx
import { Icon } from '@/components/ui/Icon'
import { BrandLockup } from '@/components/ui/BrandLockup'
import { COLORS } from '@/lib/design/tokens'

export function MobileBrandBar() {
  return (
    <header className="flex items-center gap-[9px] border-b border-line bg-surface px-[18px] py-4 md:hidden">
      <BrandLockup logoH={22} />
      <Icon name="bell" size={20} color={COLORS.sub} className="ml-auto" />
    </header>
  )
}
```

- [ ] **Step 2: `MobileTabBar.tsx`** - remplacer `color={active ? '#A20D24' : '#B7AD9A'}` par `color={active ? COLORS.red : COLORS.faint}` (importer `COLORS` si absent).

- [ ] **Step 3: Tests + lint + typecheck → verts** ; **Commit**

```bash
git add src/components/nav/MobileBrandBar.tsx src/components/nav/MobileTabBar.tsx
git commit -m "feat(nav): mobile bars use brand lockup + charte tokens"
```

---

### Task 7: Accueil (Home) - icônes, accents, titres

**Files:**
- Modify: `src/app/(app)/page.tsx`
- Test: aucun test dédié à la home ; gate = suite complète + navigateur.

- [ ] **Step 1: Importer `COLORS`** et remplacer les hex en dur :
  - L'ouverture `import { COLORS } from '@/lib/design/tokens'`.
  - `color="#A20D24"` (icône book, l.76) → `color={COLORS.red}`.
  - `color="#A20D24"` (arrow « Continuer le parcours », l.87) → `color={COLORS.violine}`.
  - `color="#A20D24"` (icône formation strip, l.131) → `color={COLORS.red}`.
- [ ] **Step 2: Titres en extra-bold** : sur les `<h1>` (l.27 et l.46) et titres de carte (`Espace Formation`, `Assistant BRAIN`, l.78/98) et `À reprendre` (l.113), remplacer `font-medium` par `font-extrabold`.
- [ ] **Step 3: Carte BRAIN** : `border-ink bg-ink` reste correct (ink = violine). CTA `text-redink` (l.85) = violine, OK. Laisser tel quel.
- [ ] **Step 4: Suite + lint + typecheck → verts** ; **Commit**

```bash
git add "src/app/(app)/page.tsx"
git commit -m "feat(home): charte tokens for icons + extrabold headings"
```

---

### Task 8: Espace Formation (liste) + FormationCard

**Files:**
- Modify: `src/app/(app)/formations/page.tsx` (titre extrabold si présent)
- Modify: `src/components/formations/FormationCard.tsx:32,48`
- Test: aucun dédié ; gate = suite + navigateur.

- [ ] **Step 1: `FormationCard.tsx`** - importer `COLORS`, remplacer :
  - `color="#A20D24"` (icône, l.32) → `color={COLORS.red}`.
  - `color={isPdf ? '#A20D24' : '#8A7F6E'}` (l.48) → `color={isPdf ? COLORS.red : COLORS.sub}`.
  - Titre de carte : si `font-medium`, passer en `font-bold`/`font-extrabold` selon prototype (`fontWeight 700`).
- [ ] **Step 2: `formations/page.tsx`** - `<h1>` en `font-extrabold`.
- [ ] **Step 3: Suite + lint + typecheck → verts** ; **Commit**

```bash
git add "src/app/(app)/formations/page.tsx" src/components/formations/FormationCard.tsx
git commit -m "feat(formations): charte tokens + extrabold heading on list"
```

---

### Task 9: Détail formation

**Files:**
- Modify: `src/app/(app)/formations/[slug]/page.tsx` (hex aux lignes 41,62,66,84,121,127,150,151,175,181,206,210)
- Test: aucun dédié ; gate = suite + navigateur.

- [ ] **Step 1: Importer `COLORS`** et remplacer chaque hex par le token correspondant, selon le prototype `FormDetailB` :
  - chevron retour (l.41) `#8A7F6E` → `COLORS.sub`.
  - icônes meta file/clock (l.62,66) `#8A7F6E` → `COLORS.sub`.
  - « Ouvrir sur SharePoint » (l.84,175) - icône externe : prototype = `COLORS.sub` (sidebar). Utiliser `COLORS.sub`.
  - « Consulter » eye (l.121) `#A20D24` → `COLORS.red` ; « Télécharger » download (l.127) `#8A7F6E` → garder l'icône download en `COLORS.red` (prototype docs = download rouge) ; ajuster pour cohérence : download → `COLORS.red`.
  - check (l.181) `#A20D24` → `COLORS.red`.
  - related icons (l.206) `#A20D24` → `COLORS.red` ; arrow related (l.210) `#B7AD9A` → `COLORS.faint`.
  - ImgSlot tone/accent (l.150,151) : harmoniser vers crème chaude `tone="#F3E9D7"` `accent="#D9C9AE"` (valeurs prototype).
- [ ] **Step 2: Titre `<h1>`** en `font-extrabold` ; eyebrow tag en `text-red` (déjà).
- [ ] **Step 3: Suite + lint + typecheck → verts** ; **Commit**

```bash
git add "src/app/(app)/formations/[slug]/page.tsx"
git commit -m "feat(formation-detail): charte tokens + extrabold heading"
```

---

### Task 10: BRAIN (BrainChat)

**Files:**
- Modify: `src/components/brain/BrainChat.tsx:88,95,139,179,229` (hex)
- Test: `tests/components/BrainChat.test.tsx` (rester vert)

- [ ] **Step 1: Importer `COLORS`** (si absent) et remplacer :
  - `color="#8A7F6E"` (l.88,95) → `COLORS.sub`.
  - garder `#fff` (l.139,179,229).
- [ ] **Step 2: En-tête BRAIN** : titre `font-extrabold` ; le rond rouge (`bg-red`) reste. Bulle user `bg-violine`/`bg-ink` = violine OK. `<sup>` `text-red` OK.
- [ ] **Step 3: Tests BrainChat + suite + lint + typecheck → verts** ; **Commit**

```bash
git add src/components/brain/BrainChat.tsx
git commit -m "feat(brain): charte tokens + extrabold heading"
```

---

### Task 11: Profil, mot de passe, logout

**Files:**
- Modify: `src/app/(app)/profil/page.tsx:27` (`#8A7F6E`)
- Modify: `src/components/nav/LogoutButton.tsx:14` (`#A20D24`)
- Modify: `src/components/account/ChangePasswordForm.tsx` (titres extrabold, accents OK)
- Test: `tests/components/ChangePasswordForm.test.tsx` (rester vert)

- [ ] **Step 1:** `profil/page.tsx` l.27 `#8A7F6E` → `COLORS.sub` (importer). `LogoutButton.tsx` l.14 `#A20D24` → `COLORS.red`.
- [ ] **Step 2:** Titres de section profil/mot de passe en `font-extrabold` (cohérence prototype).
- [ ] **Step 3: Tests + lint + typecheck → verts** ; **Commit**

```bash
git add "src/app/(app)/profil/page.tsx" src/components/nav/LogoutButton.tsx src/components/account/ChangePasswordForm.tsx
git commit -m "feat(account): charte tokens + extrabold headings"
```

---

### Task 12: Gazette / Actualités (pages publiques)

**Files:**
- Modify: `src/app/(app)/actualites/page.tsx:92,93` (ImgSlot tones)
- Modify: `src/app/(app)/actualites/[slug]/page.tsx` (titres extrabold, accents)
- Test: aucun dédié ; gate = suite + navigateur.

- [ ] **Step 1:** ImgSlot tones (l.92,93) → `tone="#F3E9D7"` `accent="#D9C9AE"`. Titres « La Gazette A⁺Super » et titres d'articles en `font-extrabold`. Vérifier les accents FR.
- [ ] **Step 2: Suite + lint + typecheck → verts** ; **Commit**

```bash
git add "src/app/(app)/actualites/page.tsx" "src/app/(app)/actualites/[slug]/page.tsx"
git commit -m "feat(gazette): charte tokens + extrabold headings"
```

---

### Task 13: Coque Admin (AdminNav + écrans admin)

**Files:**
- Modify: `src/components/admin/AdminNav.tsx`
- Modify: `src/components/admin/EmbedTestAdmin.tsx` (hex si présents) et autres composants admin avec hex/`bg-sand`
- Test: `tests/components/EmbedTestAdmin.test.tsx`, `FaqBuilderAdmin`, `FaqDraftEditor`, `FaqGapsAdmin`, `NewsEditor`, `TiptapEditor`, `ui-primitives` (rester verts)

**Interfaces:**
- Consumes: `BrandLockup` (Task 2).

- [ ] **Step 1: `AdminNav.tsx`** - remplacer le bloc « cercle rouge + settings + Admin » par un mini-lockup cohérent :
```tsx
      <div className="mb-6 flex items-center gap-[10px] px-2">
        <BrandLockup logoH={22} />
      </div>
```
  (le label « FORMATION » suffit ; ajouter sous le lockup un sous-titre « Admin » `text-[11px] uppercase tracking-[0.12em] text-sub` si souhaité). État actif : `bg-sand` reste valide (token conservé) ; option : passer à `bg-panel`/`bg-redsoft`. Garder `bg-sand` pour ne casser aucun test.
- [ ] **Step 2: Balayer les composants admin** pour hex en dur résiduels (`grep -rn "#[0-9A-Fa-f]\{6\}" src/components/admin src/app/admin`) et remplacer par tokens. Titres principaux des écrans admin en `font-extrabold`.
- [ ] **Step 3: Lancer TOUTE la suite admin** (les composants admin mockent tRPC - feedback_ui_task_run_full_suite) :

Run: `npm test && npm run typecheck && npm run lint -- --max-warnings 0`
Expected: PASS (corriger toute assertion cassée)

- [ ] **Step 4: Commit**

```bash
git add src/components/admin src/app/admin
git commit -m "feat(admin): brand lockup + charte tokens across admin shell"
```

---

### Task 14: Balayage final hex + ImgSlot + vérification navigateur

**Files:**
- Modify: tout fichier avec hex en dur résiduel (`src/components/ui/ImgSlot.tsx` defaults si on veut harmoniser)
- Test: suite complète

- [ ] **Step 1: Balayage global** des hex restants

```bash
grep -rn "#[0-9A-Fa-f]\{6\}\|#[0-9A-Fa-f]\{3\}\b" src --include="*.tsx" | grep -v "#fff\|#FFF"
```
Vérifier que chaque occurrence restante est volontaire (placeholders ImgSlot, `#fff`). Remplacer les couleurs de marque oubliées par les tokens.

- [ ] **Step 2: Suite complète + lint + typecheck**

Run: `npm test && npm run typecheck && npm run lint -- --max-warnings 0`
Expected: tout vert.

- [ ] **Step 3: Build prod (placeholders env)**

Run: `npm run build`
Expected: build OK (vérifie les imports/`next/image`).

- [ ] **Step 4: Vérification navigateur authentifié** (feedback_design_handoff_fidelity)

Lancer le dev server, se connecter (seed `admin@aps.fr/admin1234`), et comparer à `dirB.jsx` écran par écran :
  - Connexion : panneau gauche violine, logo blanc + FORMATION, mot « accompagnée » corail, BRoute onDark, eyebrow « PORTAIL FORMATION » rouge.
  - Accueil : lockup logo, avatar violine, titres extrabold, icônes rouge vif, carte BRAIN violine.
  - Formations / Détail / BRAIN : accents rouge Auchan, encre violine, titres extrabold.
  - Admin + Gazette + Profil : héritent la charte, titres extrabold, pas de brun résiduel.
Vérifier les accents FR et l'absence de tiret cadratin.

- [ ] **Step 5: Commit final éventuel**

```bash
git add -A
git commit -m "chore(design): final hex sweep + ImgSlot harmonisation"
```

---

## Self-Review

- **Spec coverage** : palette (T1), logo blanc + lockup (T2), timeline onDark (T3), login violine (T4), nav desktop (T5), nav mobile (T6), accueil (T7), formations liste (T8), détail (T9), BRAIN (T10), profil/mdp (T11), gazette (T12), admin (T13), balayage + navigateur (T14). Tous les écrans du périmètre « tout » couverts.
- **Placeholders** : valeurs hex exactes fournies partout ; pas de TODO.
- **Type consistency** : `BrandLockup({onDark,logoH})`, `BRoute({current,compact,onDark})`, `COLORS.{violine,coral,red,sub,faint,redInk,...}` cohérents entre tâches.
- **Risque tests** : `tokens.test.ts` mis à jour (T1) ; tests composant mockent tRPC → lancer la suite COMPLÈTE après toute tâche touchant un appel tRPC (feedback_ui_task_run_full_suite). Aucun renommage d'identifiant technique.
