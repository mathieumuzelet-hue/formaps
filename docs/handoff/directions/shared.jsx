// shared.jsx — icons, data, placeholders shared by all 3 directions.
// Exported to window at the bottom.

// ── Icon set (24x24 stroke) ─────────────────────────────────
const ICON_PATHS = {
  home: 'M3 11.5L12 4l9 7.5M5 10v10h5v-6h4v6h5V10',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  book: 'M4 5a2 2 0 012-2h12v16H6a2 2 0 00-2 2zM18 3v16M8 7h6M8 11h6',
  brain: 'M8.5 4.5a3 3 0 00-3 3 3 3 0 00-1.5 5.2A3 3 0 008 17.5M15.5 4.5a3 3 0 013 3 3 3 0 011.5 5.2 3 3 0 01-4 4.3M12 4v15',
  chat: 'M4 5h16v11H9l-4 4z',
  search: 'M11 4a7 7 0 105 12l4 4M11 4a7 7 0 015 12',
  bell: 'M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6M10 21h4',
  user: 'M5 20a7 7 0 0114 0M12 4a4 4 0 100 8 4 4 0 000-8z',
  chevronR: 'M9 5l7 7-7 7',
  chevronD: 'M5 9l7 7 7-7',
  chevronL: 'M15 5l-7 7 7 7',
  arrowR: 'M4 12h15M13 6l6 6-6 6',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 19h16',
  external: 'M14 4h6v6M20 4l-8 8M18 13v6H5V6h6',
  lock: 'M6 10V8a6 6 0 1112 0v2M5 10h14v10H5z',
  check: 'M5 12l5 5L20 6',
  checkCircle: 'M12 3a9 9 0 100 18 9 9 0 000-18zM8 12l3 3 5-6',
  play: 'M8 5v14l11-7z',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  send: 'M4 12l16-7-7 16-2-7z',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l4 2',
  shield: 'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z',
  cart: 'M4 5h2l2 11h10l2-8H7M9 20a1 1 0 100 2 1 1 0 000-2zM17 20a1 1 0 100 2 1 1 0 000-2z',
  euro: 'M16 6a6 6 0 100 12M5 10h8M5 14h8',
  box: 'M4 8l8-4 8 4-8 4zM4 8v8l8 4 8-4V8M12 12v8',
  truck: 'M3 6h11v9H3zM14 9h4l3 3v3h-7M7 18a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM17 18a1.5 1.5 0 100 3 1.5 1.5 0 000-3z',
  headset: 'M5 13v-1a7 7 0 0114 0v1M5 13a2 2 0 002 2v-4a2 2 0 00-2 2zM19 13a2 2 0 01-2 2v-4a2 2 0 012 2zM17 15v1a3 3 0 01-3 3h-2',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 3v2M12 19v2M5 5l1.5 1.5M17.5 17.5L19 19M3 12h2M19 12h2M5 19l1.5-1.5M17.5 6.5L19 5',
  logout: 'M9 4H5v16h4M16 12H9M13 8l4 4-4 4',
  pin: 'M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11zM12 8a2 2 0 100 4 2 2 0 000-4z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  compass: 'M12 3a9 9 0 100 18 9 9 0 000-18zM15 9l-2 5-4 1 2-5z',
  quote: 'M7 7H4v6h6V7L7 4M20 7h-3v6h6V7l-3-3',
};

function Icon({ name, size = 22, sw = 1.7, color = 'currentColor', style }) {
  const d = ICON_PATHS[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      style={style} aria-hidden="true">
      {d && d.split('M').filter(Boolean).map((seg, i) => <path key={i} d={'M' + seg} />)}
    </svg>
  );
}

// ── APS logo (A+SUPER) — detoured to transparent, red on any light surface ──
function ApsLogoSlot({ h = 28 }) {
  return (
    <img src="assets/logo-aps.png" alt="A+SUPER" height={h}
      style={{ height: h, width: 'auto', display: 'block', flexShrink: 0 }} />
  );
}

// ── Striped image placeholder ───────────────────────────────
function ImgSlot({ label = 'image', w = '100%', h = 160, radius = 12, accent = '#c9bfb2', tone = '#efe9e0', style }) {
  const stripe = `repeating-linear-gradient(135deg, ${tone}, ${tone} 11px, ${accent}22 11px, ${accent}22 22px)`;
  const lines = String(label).split(/\\n|\n/);
  return (
    <div style={{ width: w, height: h, borderRadius: radius, background: stripe,
      border: `1px solid ${accent}55`, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'rgba(60,52,44,.55)', fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 12, letterSpacing: '.04em', textAlign: 'center', lineHeight: 1.5, padding: 8, boxSizing: 'border-box', ...style }}>
      <div>{lines.map((l, i) => <div key={i}>{l}</div>)}</div>
    </div>
  );
}

// ── Data: formations ────────────────────────────────────────
// kind: 'sharepoint' (phase 1 — redirect) or 'pdf' (phase 2 — dedicated page)
const TRAININGS = [
  { id: 'mercalys',  name: 'Mercalys',          icon: 'box',      desc: 'Gestion des prix & étiquettes',     count: 8,  kind: 'sharepoint', tag: 'Outils' },
  { id: 'encaiss',   name: 'Encaissement',      icon: 'cart',     desc: 'Caisse, scan & moyens de paiement', count: 12, kind: 'pdf',        tag: 'Caisse' },
  { id: 'compta',    name: 'Comptabilité',      icon: 'euro',     desc: 'Clôtures, écritures & flux',        count: 6,  kind: 'sharepoint', tag: 'Gestion' },
  { id: 'stocks',    name: 'Gestion des stocks',icon: 'layers',   desc: 'Réception, inventaire & commandes', count: 9,  kind: 'pdf',        tag: 'Logistique' },
  { id: 'rh',        name: 'RH & Paie',         icon: 'user',     desc: 'Contrats, planning & bulletins',    count: 7,  kind: 'sharepoint', tag: 'RH' },
  { id: 'drive',     name: 'Drive & E-commerce',icon: 'truck',    desc: 'Préparation & retrait des commandes',count: 5, kind: 'sharepoint', tag: 'Service' },
  { id: 'client',    name: 'Relation client',   icon: 'headset',  desc: 'Accueil, SAV & fidélité',           count: 4,  kind: 'pdf',        tag: 'Service' },
  { id: 'secu',      name: 'Sécurité & Hygiène',icon: 'shield',   desc: 'Normes, contrôles & procédures',    count: 6,  kind: 'sharepoint', tag: 'Magasin' },
];

// ── Data: BRAIN sample conversation ─────────────────────────
const BRAIN_SUGGEST = [
  'Comment paramétrer une caisse Mercalys ?',
  'Quelles sont les étapes de la clôture comptable ?',
  'Où trouver le planning de bascule de mon magasin ?',
  'Comment gérer un retour client après la bascule ?',
];

const BRAIN_CONVO = [
  { role: 'user', text: 'Comment se passe l’encaissement d’un bon d’achat Auchan après la bascule ?' },
  { role: 'ai',
    text: 'Après la bascule, les bons d’achat Auchan restent acceptés jusqu’au 31/12. En caisse, sélectionnez le mode de paiement « Bon Auchan » dans le menu Encaissement, scannez le code-barres du bon, puis validez. Le montant est déduit automatiquement ; un éventuel reliquat est rendu en bon Intermarché.',
    sources: [
      { doc: 'Guide Encaissement v2.pdf', page: 'p. 14', tag: 'Encaissement' },
      { doc: 'Note de bascule — Moyens de paiement', page: '§3.2', tag: 'Bascule' },
    ] },
];

// ── Data: formation detail (phase 2 — page PDF dédiée) ──────
const FORMATION_DETAIL = {
  id: 'encaiss', name: 'Encaissement', tag: 'Caisse', icon: 'cart',
  desc: 'Tout pour maîtriser la caisse Intermarché : scan, moyens de paiement, bons d’achat Auchan et procédures d’ouverture / clôture.',
  duree: '~45 min', maj: 'Mis à jour le 28 mai 2026', progress: 60,
  docs: [
    { t: 'Guide de prise en main de la caisse', size: '2,4 Mo', pages: 18, neuf: true },
    { t: 'Moyens de paiement après la bascule', size: '1,1 Mo', pages: 9 },
    { t: 'Gestion des bons d’achat Auchan', size: '0,8 Mo', pages: 6, neuf: true },
    { t: 'Ouverture & clôture de caisse', size: '1,6 Mo', pages: 12 },
    { t: 'FAQ encaissement — cas particuliers', size: '0,5 Mo', pages: 4 },
  ],
  related: ['mercalys', 'compta', 'client'],
};

Object.assign(window, { Icon, ApsLogoSlot, ImgSlot, TRAININGS, BRAIN_SUGGEST, BRAIN_CONVO, FORMATION_DETAIL });
