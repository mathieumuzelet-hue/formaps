'use client'

import { useState } from 'react'

import { buildManualPayload, buildRefinePayload, useEmbedTest } from '@/lib/embed-test/useEmbedTest'
import { escapeSeparator } from '@/lib/embed-test/chunker'
import { formatDifySettings } from '@/lib/embed-test/dify-settings'
import { chunkConfigSchema, type EmbedTestModelKey } from '@/lib/embed-test/types'

const MAX_SIZE = 25 * 1024 * 1024

export function EmbedTestAdmin() {
  const { state, run, reset } = useEmbedTest()
  const [file, setFile] = useState<File | null>(null)
  const [model, setModel] = useState<EmbedTestModelKey>('sonnet')
  const [copied, setCopied] = useState(false)

  // « Tester ma config » manual form
  const [manualOpen, setManualOpen] = useState(false)
  const [manualMode, setManualMode] = useState<'general' | 'parent-child'>('general')
  const [manualSeparator, setManualSeparator] = useState('\\n\\n')
  const [manualMaxTokens, setManualMaxTokens] = useState('1024')
  const [manualOverlapTokens, setManualOverlapTokens] = useState('150')
  const [manualParentMaxTokens, setManualParentMaxTokens] = useState('1024')
  const [manualChildMaxTokens, setManualChildMaxTokens] = useState('256')
  const [manualRemoveExtraSpaces, setManualRemoveExtraSpaces] = useState(true)
  const [manualRemoveUrlsEmails, setManualRemoveUrlsEmails] = useState(false)
  const [manualError, setManualError] = useState(false)

  const running = state.status === 'running'
  const tooBig = file != null && file.size > MAX_SIZE
  const canLaunch = file != null && !tooBig && !running

  const onManualSubmit = () => {
    const maxTokens = Number(manualMaxTokens)
    const overlapTokens = Number(manualOverlapTokens)
    const parsed = chunkConfigSchema.safeParse({
      label: `Manuelle (${maxTokens} tk / ${overlapTokens} ov)`,
      mode: manualMode,
      separator: manualSeparator,
      maxTokens,
      overlapTokens,
      ...(manualMode === 'parent-child'
        ? {
            parentMaxTokens: Number(manualParentMaxTokens),
            childMaxTokens: Number(manualChildMaxTokens),
          }
        : {}),
      preprocessing: {
        removeExtraSpaces: manualRemoveExtraSpaces,
        removeUrlsEmails: manualRemoveUrlsEmails,
      },
    })
    if (!parsed.success) {
      setManualError(true)
      return
    }
    setManualError(false)
    const payload = buildManualPayload(state, parsed.data)
    if (!file || !payload) return
    setCopied(false)
    void run(file, model, payload)
  }

  const onLaunch = () => {
    if (!file) return
    setCopied(false)
    void run(file, model)
  }

  const onRefine = () => {
    const payload = buildRefinePayload(state)
    if (!file || !payload) return
    setCopied(false)
    void run(file, model, payload)
  }

  const globalBest = state.bestSoFar
  const recommendedText =
    globalBest != null
      ? formatDifySettings(globalBest.config, globalBest.ocr)
      : (state.report?.recommendation.difySettings ?? '')
  const bestFromOtherRound =
    globalBest != null && state.report != null && globalBest.round !== state.round

  const onCopy = async () => {
    if (!state.report) return
    try {
      await navigator.clipboard.writeText(recommendedText)
      setCopied(true)
    } catch {
      // Clipboard unavailable — skip the "Copié" confirmation.
    }
  }

  const best = state.report?.recommendation.configIndex

  return (
    <div className="mx-auto max-w-[860px] px-6 py-8">
      <h1 className="font-serif text-[26px] font-semibold">Labo d&apos;embed</h1>
      <p className="mt-1 text-[14px] text-sub">
        Testez les paramètres d&apos;ingestion d&apos;un document avant de les reporter
        manuellement dans Dify. Aucun envoi vers Dify.
      </p>

      {/* Formulaire */}
      <section className="mt-6 rounded-xl border border-line bg-white p-5">
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-[14px] font-medium">
            Fichier PDF (25 Mo max)
            <input
              type="file"
              accept="application/pdf"
              disabled={running}
              onChange={(e) => {
                reset()
                setFile(e.target.files?.[0] ?? null)
              }}
              className="text-[13.5px]"
            />
            {tooBig && (
              <p className="text-[12.5px] text-red">Fichier trop volumineux (25 Mo max).</p>
            )}
          </label>
          <label className="flex flex-col gap-1 text-[14px] font-medium">
            Modèle
            <select
              value={model}
              disabled={running}
              onChange={(e) => setModel(e.target.value as EmbedTestModelKey)}
              className="w-fit rounded-lg border border-line px-3 py-2 text-[13.5px]"
            >
              <option value="sonnet">Sonnet 4.6 — recommandé (~0,10-0,50 $ / test)</option>
              <option value="opus">Opus 4.8 — qualité max (~0,50-2,50 $ / test)</option>
            </select>
          </label>
          <p className="text-[12.5px] text-sub">
            Le document est analysé par l&apos;API Claude d&apos;Anthropic (service externe).
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onLaunch}
              disabled={!canLaunch}
              className="rounded-lg bg-red px-4 py-2 text-[14px] font-bold text-white disabled:opacity-40"
            >
              {running ? 'Test en cours…' : 'Lancer le test'}
            </button>
            {(state.status === 'done' || state.status === 'error') && (
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-line px-4 py-2 text-[14px] font-medium"
              >
                Relancer
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Timeline */}
      {state.steps.length > 0 && (
        <section className="mt-6 rounded-xl border border-line bg-white p-5" role="status">
          <h2 className="text-[15px] font-bold">Progression</h2>
          <ul className="mt-2 flex flex-col gap-1 text-[13.5px]">
            {state.steps.map((s, i) => (
              <li key={`${s.id}-${i}`} className="flex items-center gap-2">
                <span aria-hidden>
                  {i < state.steps.length - 1
                    ? '✓'
                    : state.status === 'error'
                      ? '✗'
                      : running
                        ? '…'
                        : '✓'}
                </span>
                {s.label}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Diagnostic structure */}
      {state.diagnostic && (
        <section className="mt-6 rounded-xl border border-line bg-white p-5">
          <h2 className="text-[15px] font-bold">Structure du texte extrait</h2>
          <p className="mt-1 text-[14px]">
            {state.diagnostic.verdict === 'structured' && '✅ Structuré'}
            {state.diagnostic.verdict === 'weakly_structured' && '⚠️ Peu structuré'}
            {state.diagnostic.verdict === 'flat' && '🚫 Plat'}
            <span className="ml-2 text-[12.5px] text-sub">
              {state.diagnostic.paragraphBreaks} sauts de paragraphe ·{' '}
              ~{state.diagnostic.avgParagraphTokens} tokens/paragraphe ·{' '}
              {Math.round(state.diagnostic.shortLineRatio * 100)} % de lignes courtes
            </span>
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-[13px] text-sub">
            {state.diagnostic.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Erreur */}
      {state.status === 'error' && state.error && (
        <section className="mt-6 rounded-xl border border-red/40 bg-white p-5 text-[14px]" role="alert">
          {state.error}
        </section>
      )}

      {/* Rapport */}
      {state.report && (
        <>
          <section className="mt-6 rounded-xl border border-line bg-white p-5">
            <h2 className="text-[15px] font-bold">Verdict extraction</h2>
            <p className="mt-1 text-[14px]">
              {state.report.ocr.verdict === 'text_ok'
                ? "✅ L'extraction texte basique suffit."
                : '⚠️ Passez par le pipeline OCR — couche texte non fiable.'}
            </p>
            <p className="mt-1 text-[13px] text-sub">{state.report.ocr.reason}</p>
          </section>

          <section className="mt-6 rounded-xl border border-line bg-white p-5">
            <h2 className="text-[15px] font-bold">
              Configurations testées — Tour {state.round}
            </h2>
            {state.round > 1 && (
              <p className="mt-1 text-[12.5px] text-sub">
                {state.history.length} configs testées au total
              </p>
            )}
            <table className="mt-3 w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-sub">
                  <th className="py-2 pr-3">Config</th>
                  <th className="py-2 pr-3">Mode</th>
                  <th className="py-2 pr-3">Délimiteur</th>
                  <th className="py-2 pr-3">Taille</th>
                  <th className="py-2 pr-3">Overlap</th>
                  <th className="py-2 pr-3">Chunks</th>
                  <th className="py-2 pr-3">Score</th>
                  <th className="py-2">Problèmes</th>
                </tr>
              </thead>
              <tbody>
                {state.report.ranking
                  .map((idx) => ({
                    config: state.configs[idx],
                    result: state.results.find((r) => r.index === idx),
                  }))
                  .concat(
                    state.results
                      .filter((r) => r.failed)
                      .map((r) => ({ config: state.configs[r.index], result: r })),
                  )
                  .map(({ config, result }) =>
                    config && result ? (
                      <tr
                        key={result.index}
                        className={`border-b border-line/60 ${result.failed ? 'opacity-40' : ''} ${
                          result.index === best ? 'font-bold' : ''
                        }`}
                      >
                        <td className="py-2 pr-3">{config.label}</td>
                        <td className="py-2 pr-3">
                          {config.mode === 'general' ? 'Général' : 'Parent-enfant'}
                        </td>
                        <td className="py-2 pr-3">{escapeSeparator(config.separator)}</td>
                        <td className="py-2 pr-3">
                          {config.mode === 'general'
                            ? `${config.maxTokens} tk`
                            : `${config.parentMaxTokens}/${config.childMaxTokens} tk`}
                        </td>
                        <td className="py-2 pr-3">{config.overlapTokens} tk</td>
                        <td className="py-2 pr-3">{result.chunkCount}</td>
                        <td className="py-2 pr-3">
                          {result.failed ? 'échec' : `${result.score}/10`}
                        </td>
                        <td className="py-2 text-sub">{result.issues.join(' · ') || '—'}</td>
                      </tr>
                    ) : null,
                  )}
              </tbody>
            </table>
          </section>

          <section className="mt-6 rounded-xl border-2 border-red/50 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-bold">
                {bestFromOtherRound
                  ? `Recommandation — meilleure config (tour ${globalBest!.round})`
                  : 'Recommandation — à reporter dans Dify'}
              </h2>
              <button
                type="button"
                onClick={onCopy}
                className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium"
              >
                {copied ? 'Copié ✓' : 'Copier'}
              </button>
            </div>
            <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-sand/50 p-3 text-[13px]">
              {recommendedText}
            </pre>
            <p className="mt-2 text-[13px] text-sub">
              {globalBest?.rationale ?? state.report.recommendation.rationale}
            </p>
            {state.status === 'done' && (
              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={onRefine}
                  disabled={!file || running}
                  className="rounded-lg bg-red px-4 py-2 text-[14px] font-bold text-white disabled:opacity-40"
                >
                  Raffiner (tour {state.round + 1})
                </button>
                <button
                  type="button"
                  onClick={() => setManualOpen((o) => !o)}
                  className="rounded-lg border border-line px-4 py-2 text-[14px] font-medium"
                >
                  Tester ma config
                </button>
                {!file && (
                  <p className="text-[12.5px] text-sub">
                    Resélectionnez le PDF pour raffiner.
                  </p>
                )}
              </div>
            )}
            {state.status === 'done' && manualOpen && (
              <div className="mt-4 flex flex-col gap-3 rounded-lg border border-line bg-white p-4">
                <label className="flex flex-col gap-1 text-[13px] font-medium">
                  Mode
                  <select
                    value={manualMode}
                    disabled={running}
                    onChange={(e) =>
                      setManualMode(e.target.value as 'general' | 'parent-child')
                    }
                    className="w-fit rounded-lg border border-line px-3 py-2 text-[13px]"
                  >
                    <option value="general">Général</option>
                    <option value="parent-child">Parent-enfant</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[13px] font-medium">
                  Séparateur
                  <input
                    type="text"
                    value={manualSeparator}
                    disabled={running}
                    onChange={(e) => setManualSeparator(e.target.value)}
                    className="w-fit rounded-lg border border-line px-3 py-2 text-[13px]"
                  />
                </label>
                <div className="flex gap-3">
                  <label className="flex flex-col gap-1 text-[13px] font-medium">
                    Longueur max
                    <input
                      type="number"
                      value={manualMaxTokens}
                      disabled={running}
                      onChange={(e) => setManualMaxTokens(e.target.value)}
                      className="w-[120px] rounded-lg border border-line px-3 py-2 text-[13px]"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[13px] font-medium">
                    Chevauchement
                    <input
                      type="number"
                      value={manualOverlapTokens}
                      disabled={running}
                      onChange={(e) => setManualOverlapTokens(e.target.value)}
                      className="w-[120px] rounded-lg border border-line px-3 py-2 text-[13px]"
                    />
                  </label>
                </div>
                {manualMode === 'parent-child' && (
                  <div className="flex gap-3">
                    <label className="flex flex-col gap-1 text-[13px] font-medium">
                      Parent
                      <input
                        type="number"
                        value={manualParentMaxTokens}
                        disabled={running}
                        onChange={(e) => setManualParentMaxTokens(e.target.value)}
                        className="w-[120px] rounded-lg border border-line px-3 py-2 text-[13px]"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[13px] font-medium">
                      Enfant
                      <input
                        type="number"
                        value={manualChildMaxTokens}
                        disabled={running}
                        onChange={(e) => setManualChildMaxTokens(e.target.value)}
                        className="w-[120px] rounded-lg border border-line px-3 py-2 text-[13px]"
                      />
                    </label>
                  </div>
                )}
                <label className="flex items-center gap-2 text-[13px] font-medium">
                  <input
                    type="checkbox"
                    checked={manualRemoveExtraSpaces}
                    disabled={running}
                    onChange={(e) => setManualRemoveExtraSpaces(e.target.checked)}
                  />
                  Remplacer les espaces consécutifs
                </label>
                <label className="flex items-center gap-2 text-[13px] font-medium">
                  <input
                    type="checkbox"
                    checked={manualRemoveUrlsEmails}
                    disabled={running}
                    onChange={(e) => setManualRemoveUrlsEmails(e.target.checked)}
                  />
                  Supprimer URLs et e-mails
                </label>
                {manualError && (
                  <p className="text-[12.5px] text-red" role="alert">
                    Valeurs invalides — taille 100-4000, chevauchement &lt; taille.
                  </p>
                )}
                <button
                  type="button"
                  onClick={onManualSubmit}
                  disabled={!file || running}
                  className="w-fit rounded-lg bg-red px-4 py-2 text-[14px] font-bold text-white disabled:opacity-40"
                >
                  Tester cette config (tour {state.round + 1})
                </button>
              </div>
            )}
            <p className="mt-3 text-[12px] text-sub">
              Tokens Claude consommés : {state.report.usage.inputTokens.toLocaleString('fr-FR')} in
              / {state.report.usage.outputTokens.toLocaleString('fr-FR')} out · Rapport éphémère —
              perdu au rechargement de la page.
            </p>
          </section>
        </>
      )}
    </div>
  )
}
