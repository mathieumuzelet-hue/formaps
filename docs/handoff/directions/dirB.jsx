// dirB.jsx — Direction B "Le Trajet" (éditorial, papier chaud, parcours par étapes)
// Exports: LoginB, HomeB, FormB, BrainB, HomeBMobile

const B = {
  bg: '#F4EEE3', surface: '#FBF7EF', card: '#FFFFFF',
  ink: '#221C16', sub: '#8A7F6E', faint: '#B7AD9A',
  line: '#E4DBCB', red: '#C8102E', redSoft: '#F4E5E1', redInk: '#A20D24',
  sand: '#EADFC9', serif: '"Newsreader", Georgia, serif',
  font: '"Hanken Grotesk", system-ui, sans-serif',
};

const bWrap = { width: '100%', height: '100%', background: B.bg, color: B.ink,
  fontFamily: B.font, display: 'flex', flexDirection: 'column', overflow: 'hidden' };

const STAGES = ['Préparation', 'Formation', 'Tests', 'Bascule', 'Ouverture'];

// Navigation hook for the clickable prototype. No-op in the static canvas
// (window.__cockpitNav is undefined there), so clicks are harmless.
const navTo = (id) => { if (typeof window !== 'undefined' && window.__cockpitNav) window.__cockpitNav(id); };

function BNav({ active }) {
  const items = [['home', 'Accueil'], ['form', 'Formations'], ['brain', 'BRAIN'], ['news', 'Actualités']];
  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: 30, padding: '20px 40px',
      borderBottom: `1px solid ${B.line}`, background: B.surface }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => navTo('home')}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: B.red, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="compass" size={19} color="#fff" sw={1.9} />
        </div>
        <span style={{ fontSize: 22, fontWeight: 600, fontFamily: B.serif, letterSpacing: '-.01em' }}>Cockpit</span>
      </div>
      <nav style={{ display: 'flex', gap: 26, marginLeft: 12 }}>
        {items.map(([id, lb]) => (
          <div key={id} onClick={() => navTo(id)} style={{ fontSize: 14.5, fontWeight: active === id ? 700 : 500,
            color: active === id ? B.ink : B.sub, position: 'relative', paddingBottom: 3, cursor: 'pointer' }}>
            {lb}
            {active === id && <div style={{ position: 'absolute', left: 0, right: 0, bottom: -21, height: 2.5, background: B.red }} />}
          </div>
        ))}
      </nav>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 18 }}>
        <Icon name="search" size={20} color={B.sub} />
        <Icon name="bell" size={20} color={B.sub} />
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: B.sand, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>CM</div>
        <ApsLogoSlot h={28} />
      </div>
    </header>
  );
}

// Route timeline ──────────────────────────────────────────────
function BRoute({ current = 1, compact }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 13, left: '8%', right: '8%', height: 2, background: B.line }} />
      <div style={{ position: 'absolute', top: 13, left: '8%', width: `${(current / (STAGES.length - 1)) * 84}%`, height: 2, background: B.red }} />
      {STAGES.map((s, i) => {
        const done = i < current, on = i === current;
        return (
          <div key={s} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, zIndex: 1 }}>
            <div style={{ width: on ? 28 : 22, height: on ? 28 : 22, borderRadius: '50%',
              background: done || on ? B.red : B.surface, border: `2px solid ${done || on ? B.red : B.line}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: '.2s' }}>
              {done ? <Icon name="check" size={13} color="#fff" sw={2.4} />
                : on ? <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />
                : <span style={{ fontSize: 11, fontWeight: 700, color: B.faint }}>{i + 1}</span>}
            </div>
            {!compact && <div style={{ fontSize: 12.5, fontWeight: on ? 800 : 600, color: on ? B.ink : B.sub, textAlign: 'center' }}>{s}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── Login ───────────────────────────────────────────────────
function LoginB() {
  const field = (label, ph, icon) => (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 7, color: B.sub }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${B.line}`, borderRadius: 10, padding: '13px 14px', background: B.card }}>
        <Icon name={icon} size={18} color={B.faint} />
        <span style={{ color: B.faint, fontSize: 14 }}>{ph}</span>
      </div>
    </label>
  );
  return (
    <div style={{ ...bWrap, flexDirection: 'row' }}>
      <div style={{ width: '54%', background: B.surface, padding: '54px 56px', display: 'flex', flexDirection: 'column', borderRight: `1px solid ${B.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: B.red, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="compass" size={21} color="#fff" sw={1.9} />
          </div>
          <span style={{ fontSize: 25, fontWeight: 600, fontFamily: B.serif }}>Cockpit</span>
        </div>
        <div style={{ marginTop: 'auto', marginBottom: 40 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: B.red, letterSpacing: '.04em', marginBottom: 14 }}>AUCHAN → INTERMARCHÉ</div>
          <h1 style={{ margin: 0, fontFamily: B.serif, fontWeight: 500, fontSize: 46, lineHeight: 1.08, letterSpacing: '-.02em', maxWidth: 460 }}>
            Chaque étape du trajet, accompagnée.
          </h1>
          <p style={{ fontSize: 15.5, lineHeight: 1.6, color: B.sub, marginTop: 18, maxWidth: 420 }}>
            Cockpit réunit vos formations, vos repères et l’assistant BRAIN pour traverser la bascule sereinement, ensemble.
          </p>
        </div>
        <BRoute current={1} />
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, background: B.bg }}>
        <div style={{ width: 350 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 34 }}><ApsLogoSlot h={30} /></div>
          <h2 style={{ margin: 0, fontFamily: B.serif, fontWeight: 500, fontSize: 30 }}>Se connecter</h2>
          <p style={{ fontSize: 14, color: B.sub, marginTop: 6, marginBottom: 28 }}>Avec votre identifiant salarié.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 17 }}>
            {field('Identifiant', 'prenom.nom', 'user')}
            {field('Mot de passe', '••••••••', 'lock')}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '12px 0 22px' }}>
            <span style={{ fontSize: 13, color: B.redInk, fontWeight: 600 }}>Mot de passe oublié ?</span>
          </div>
          <button onClick={() => navTo('home')} style={{ width: '100%', border: 'none', background: B.red, color: '#fff', borderRadius: 10,
            padding: '15px', fontSize: 15.5, fontWeight: 700, fontFamily: B.font, display: 'flex',
            alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }}>
            Embarquer <Icon name="arrowR" size={18} color="#fff" />
          </button>
          <p style={{ fontSize: 12.5, color: B.faint, textAlign: 'center', marginTop: 24, lineHeight: 1.5 }}>
            Accès réservé aux salariés du groupe.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Home ────────────────────────────────────────────────────
function HomeB() {
  return (
    <div style={bWrap}>
      <BNav active="home" />
      <div style={{ padding: '30px 40px', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: B.red, letterSpacing: '.04em', marginBottom: 6 }}>VOTRE TRAJET · MAGASIN DE LILLE</div>
            <h1 style={{ margin: 0, fontFamily: B.serif, fontWeight: 500, fontSize: 38, letterSpacing: '-.02em', lineHeight: 1.05 }}>
              Bonjour Camille, plus que <span style={{ color: B.red }}>18 jours</span>.
            </h1>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontSize: 13, color: B.sub }}>Étape en cours</div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>2 · Formation des équipes</div>
          </div>
        </div>
        {/* route card */}
        <div style={{ background: B.surface, border: `1px solid ${B.line}`, borderRadius: 18, padding: '26px 40px 24px' }}>
          <BRoute current={1} />
        </div>
        {/* access + formations */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          {[
            { icon: 'book', t: 'Espace Formation', d: 'Reprenez là où vous en étiez — 3 formations sur 8 terminées.', cta: 'Continuer le parcours', to: 'form' },
            { icon: 'brain', t: 'Assistant BRAIN', d: 'Une question sur la bascule ? BRAIN répond, sources à l’appui.', cta: 'Poser une question', to: 'brain' },
          ].map((c, i) => (
            <div key={c.t} onClick={() => navTo(c.to)} style={{ background: i ? B.ink : B.card, color: i ? '#fff' : B.ink,
              border: `1px solid ${i ? B.ink : B.line}`, borderRadius: 18, padding: '24px 26px', position: 'relative', overflow: 'hidden', cursor: 'pointer' }}>
              <div style={{ width: 50, height: 50, borderRadius: '50%', background: i ? 'rgba(255,255,255,.12)' : B.redSoft,
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Icon name={c.icon} size={26} color={i ? '#fff' : B.redInk} sw={1.8} />
              </div>
              <div style={{ fontFamily: B.serif, fontSize: 23, fontWeight: 500, marginBottom: 7 }}>{c.t}</div>
              <div style={{ fontSize: 14, lineHeight: 1.55, color: i ? 'rgba(255,255,255,.78)' : B.sub, maxWidth: 380, marginBottom: 18 }}>{c.d}</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: i ? '#fff' : B.redInk }}>
                {c.cta} <Icon name="arrowR" size={17} color={i ? '#fff' : B.redInk} />
              </div>
            </div>
          ))}
        </div>
        {/* recent formations strip */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 12 }}>
            <div style={{ fontFamily: B.serif, fontSize: 19, fontWeight: 500 }}>À reprendre</div>
            <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: B.redInk, cursor: 'pointer' }} onClick={() => navTo('form')}>Tout l’espace formation →</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
            {TRAININGS.slice(0, 3).map((t, i) => (
              <div key={t.id} onClick={() => navTo('detail')} style={{ background: B.card, border: `1px solid ${B.line}`, borderRadius: 14, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 13, cursor: 'pointer' }}>
                <div style={{ width: 42, height: 42, borderRadius: 10, background: B.redSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name={t.icon} size={22} color={B.redInk} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>{t.name}</div>
                  <div style={{ height: 5, background: B.line, borderRadius: 3, marginTop: 7 }}>
                    <div style={{ width: `${[70, 30, 100][i]}%`, height: '100%', background: B.red, borderRadius: 3 }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Formation list ──────────────────────────────────────────
function FormB() {
  return (
    <div style={bWrap}>
      <BNav active="form" />
      <div style={{ padding: '28px 40px', overflow: 'hidden' }}>
        <div style={{ marginBottom: 22, maxWidth: 620 }}>
          <h1 style={{ margin: 0, fontFamily: B.serif, fontWeight: 500, fontSize: 34, letterSpacing: '-.02em' }}>Espace Formation</h1>
          <p style={{ fontSize: 14.5, color: B.sub, marginTop: 8, lineHeight: 1.5 }}>
            Les contenus pour maîtriser les nouveaux outils. Dans un premier temps les fiches renvoient vers SharePoint ; les pages dédiées de téléchargement PDF arrivent ensuite.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {TRAININGS.map((t, i) => (
            <div key={t.id} onClick={() => navTo('detail')} style={{ background: B.card, border: `1px solid ${B.line}`, borderRadius: 14, padding: '18px', display: 'flex', flexDirection: 'column', gap: 12, position: 'relative', cursor: 'pointer' }}>
              <div style={{ position: 'absolute', top: 14, right: 16, fontFamily: B.serif, fontSize: 26, color: B.line, fontWeight: 500 }}>{String(i + 1).padStart(2, '0')}</div>
              <div style={{ width: 46, height: 46, borderRadius: '50%', background: B.redSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={t.icon} size={23} color={B.redInk} sw={1.8} />
              </div>
              <div>
                <div style={{ fontFamily: B.serif, fontSize: 18, fontWeight: 500 }}>{t.name}</div>
                <div style={{ fontSize: 12.5, color: B.sub, marginTop: 3, lineHeight: 1.4 }}>{t.desc}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 'auto', paddingTop: 10,
                borderTop: `1px solid ${B.line}`, color: t.kind === 'pdf' ? B.redInk : B.sub, fontWeight: 700, fontSize: 12.5 }}>
                <Icon name={t.kind === 'pdf' ? 'download' : 'external'} size={16} color={t.kind === 'pdf' ? B.redInk : B.sub} />
                {t.kind === 'pdf' ? 'Télécharger le PDF' : 'Ouvrir dans SharePoint'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── BRAIN ───────────────────────────────────────────────────
function BrainB() {
  const c = BRAIN_CONVO[1];
  return (
    <div style={bWrap}>
      <BNav active="brain" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', maxWidth: 860, width: '100%', margin: '0 auto', padding: '26px 40px 0', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 22 }}>
          <div style={{ width: 46, height: 46, borderRadius: '50%', background: B.red, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="brain" size={25} color="#fff" sw={1.8} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontFamily: B.serif, fontWeight: 500, fontSize: 26 }}>BRAIN</h1>
            <div style={{ fontSize: 13, color: B.sub }}>L’assistant qui répond avec vos documents, sources citées.</div>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ alignSelf: 'flex-end', maxWidth: '70%', background: B.ink, color: '#fff', padding: '13px 18px', borderRadius: '18px 18px 5px 18px', fontSize: 14.5, lineHeight: 1.5 }}>
            {BRAIN_CONVO[0].text}
          </div>
          <div style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
            <div style={{ fontFamily: B.serif, fontSize: 16.5, lineHeight: 1.7, color: B.ink }}>
              {c.text}
              <sup style={{ color: B.red, fontWeight: 700, fontFamily: B.font, fontSize: 12, padding: '0 2px' }}>[1][2]</sup>
            </div>
            <div style={{ marginTop: 18, borderTop: `1px solid ${B.line}`, paddingTop: 14 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: B.faint, letterSpacing: '.06em', marginBottom: 10 }}>SOURCES CITÉES</div>
              {c.sources.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 0' }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', border: `1.5px solid ${B.red}`, color: B.red, fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                  <Icon name="file" size={17} color={B.sub} />
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{s.doc}</span>
                  <span style={{ fontSize: 12.5, color: B.faint }}>· {s.tag} · {s.page}</span>
                  <Icon name="external" size={15} color={B.faint} style={{ marginLeft: 'auto' }} />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ paddingBottom: 18 }}>
          <div style={{ fontSize: 12, color: B.faint, fontWeight: 700, marginBottom: 9 }}>SUGGESTIONS</div>
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginBottom: 16 }}>
            {BRAIN_SUGGEST.slice(0, 3).map((q) => (
              <div key={q} style={{ background: B.surface, border: `1px solid ${B.line}`, borderRadius: 20, padding: '9px 15px', fontSize: 13, fontWeight: 600 }}>{q}</div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${B.line}`, borderRadius: 14, padding: '6px 6px 6px 18px', background: B.card }}>
            <span style={{ flex: 1, fontSize: 14.5, color: B.faint }}>Écrivez votre question…</span>
            <button style={{ width: 44, height: 44, borderRadius: 11, border: 'none', background: B.red, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <Icon name="send" size={20} color="#fff" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Mobile ──────────────────────────────────────────────────
function HomeBMobile() {
  return (
    <div style={{ width: '100%', height: '100%', background: B.bg, fontFamily: B.font, color: B.ink, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 9, background: B.surface, borderBottom: `1px solid ${B.line}` }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: B.red, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="compass" size={17} color="#fff" />
        </div>
        <span style={{ fontSize: 19, fontWeight: 600, fontFamily: B.serif }}>Cockpit</span>
        <Icon name="bell" size={20} color={B.sub} style={{ marginLeft: 'auto' }} />
      </div>
      <div style={{ padding: '18px', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: B.red, letterSpacing: '.04em', marginBottom: 5 }}>VOTRE TRAJET · LILLE</div>
          <div style={{ fontFamily: B.serif, fontSize: 27, fontWeight: 500, lineHeight: 1.1 }}>Plus que <span style={{ color: B.red }}>18 jours</span>.</div>
        </div>
        <div style={{ background: B.surface, border: `1px solid ${B.line}`, borderRadius: 16, padding: '20px 16px 16px' }}>
          <BRoute current={1} compact />
          <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 800, marginTop: 14 }}>Étape 2 · Formation</div>
        </div>
        {[
          { icon: 'book', t: 'Espace Formation', d: '3 / 8 terminées', dark: false },
          { icon: 'brain', t: 'Assistant BRAIN', d: 'Posez vos questions', dark: true },
        ].map((x) => (
          <div key={x.t} style={{ background: x.dark ? B.ink : B.card, color: x.dark ? '#fff' : B.ink, border: `1px solid ${x.dark ? B.ink : B.line}`, borderRadius: 14, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 13 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: x.dark ? 'rgba(255,255,255,.12)' : B.redSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon name={x.icon} size={22} color={x.dark ? '#fff' : B.redInk} sw={1.8} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: B.serif, fontSize: 18, fontWeight: 500 }}>{x.t}</div>
              <div style={{ fontSize: 12.5, color: x.dark ? 'rgba(255,255,255,.7)' : B.sub, marginTop: 1 }}>{x.d}</div>
            </div>
            <Icon name="arrowR" size={18} color={x.dark ? '#fff' : B.redInk} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', borderTop: `1px solid ${B.line}`, background: B.surface, padding: '10px 0 14px' }}>
        {[['home', 'Accueil', 1], ['book', 'Former', 0], ['brain', 'BRAIN', 0], ['user', 'Profil', 0]].map(([ic, lb, on]) => (
          <div key={lb} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: on ? B.redInk : B.faint }}>
            <Icon name={ic} size={21} color={on ? B.redInk : B.faint} sw={on ? 2 : 1.7} />
            <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 600 }}>{lb}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Formation detail (éditorial) ────────────────────────────
function FormDetailB() {
  const f = FORMATION_DETAIL;
  const rel = TRAININGS.filter((t) => f.related.includes(t.id));
  return (
    <div style={bWrap}>
      <BNav active="form" />
      <div style={{ padding: '26px 40px', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 34 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: B.sub, marginBottom: 16, cursor: 'pointer', width: 'fit-content' }} onClick={() => navTo('form')}>
            <Icon name="chevronL" size={15} color={B.sub} />
            <span style={{ fontWeight: 600 }}>Espace Formation</span>
            <span style={{ color: B.faint }}>/</span>
            <span style={{ color: B.ink, fontWeight: 700 }}>{f.name}</span>
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: B.red, letterSpacing: '.05em', marginBottom: 8 }}>{f.tag.toUpperCase()}</div>
          <h1 style={{ margin: 0, fontFamily: B.serif, fontWeight: 500, fontSize: 40, letterSpacing: '-.02em', lineHeight: 1.05 }}>{f.name}</h1>
          <p style={{ fontFamily: B.serif, fontSize: 17.5, lineHeight: 1.55, color: B.sub, margin: '14px 0 18px', maxWidth: 560 }}>{f.desc}</p>
          <div style={{ display: 'flex', gap: 18, fontSize: 13, color: B.sub, paddingBottom: 20, borderBottom: `1px solid ${B.line}` }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="file" size={15} color={B.sub} /> {f.docs.length} documents</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="clock" size={15} color={B.sub} /> {f.duree}</span>
            <span>{f.maj}</span>
          </div>
          <div style={{ marginTop: 22 }}>
            {f.docs.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '15px 2px', borderBottom: `1px solid ${B.line}` }}>
                <span style={{ fontFamily: B.serif, fontSize: 24, fontWeight: 500, color: B.faint, width: 32 }}>{String(i + 1).padStart(2, '0')}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ fontFamily: B.serif, fontSize: 17, fontWeight: 500 }}>{d.t}</span>
                    {d.neuf && <span style={{ fontSize: 10, fontWeight: 800, color: B.red, border: `1px solid ${B.red}`, padding: '1px 7px', borderRadius: 20 }}>NOUVEAU</span>}
                  </div>
                  <div style={{ fontSize: 12.5, color: B.faint, marginTop: 2 }}>PDF · {d.pages} pages · {d.size}</div>
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: B.redInk, fontWeight: 700, fontSize: 13.5 }}>
                  <Icon name="download" size={17} color={B.redInk} /> Télécharger
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <ImgSlot label="visuel de couverture\n(photo caisse / capture)" h={170} radius={16} tone="#EFE6D6" accent="#D6C9B2" />
          <div style={{ background: B.surface, border: `1px solid ${B.line}`, borderRadius: 16, padding: '18px 20px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: B.sub, marginBottom: 6 }}>PROGRESSION</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontFamily: B.serif, fontSize: 32, fontWeight: 500 }}>{f.progress}%</span>
              <span style={{ fontSize: 13, color: B.sub }}>du parcours</span>
            </div>
            <div style={{ height: 6, background: B.line, borderRadius: 3, marginTop: 10 }}>
              <div style={{ width: `${f.progress}%`, height: '100%', background: B.red, borderRadius: 3 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${B.line}`, color: B.sub, fontWeight: 700, fontSize: 13 }}>
              <Icon name="external" size={16} color={B.sub} /> Ouvrir sur SharePoint
            </div>
          </div>
          <div style={{ background: B.surface, border: `1px solid ${B.line}`, borderRadius: 16, padding: '18px 20px' }}>
            <div style={{ fontFamily: B.serif, fontSize: 18, fontWeight: 500, marginBottom: 10 }}>Pour aller plus loin</div>
            {rel.map((t, i) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: i ? `1px solid ${B.line}` : 'none' }}>
                <Icon name={t.icon} size={20} color={B.redInk} />
                <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1 }}>{t.name}</span>
                <Icon name="arrowR" size={16} color={B.faint} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LoginB, HomeB, FormB, BrainB, HomeBMobile, FormDetailB });
