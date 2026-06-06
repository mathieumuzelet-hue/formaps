'use client'

import { useState } from 'react'

import { useEmbedTest } from '@/lib/embed-test/useEmbedTest'
import type { EmbedTestModelKey } from '@/lib/embed-test/types'

const MAX_SIZE = 25 * 1024 * 1024

export function EmbedTestAdmin() {
  const { state, run, reset } = useEmbedTest()
  const [file, setFile] = useState<File | null>(null)
  const [model, setModel] = useState<EmbedTestModelKey>('sonnet')
  const [copied, setCopied] = useState(false)

  const running = state.status === 'running'
  const tooBig = file != null && file.size > MAX_SIZE
  const canLaunch = file != null && !tooBig && !running

  const onLaunch = () => {
    if (!file) return
    setCopied(false)
    void run(file, model)
  }

  const onCopy = async () => {
    if (!state.report) return
    try {
      await navigator.clipboard.writeText(state.report.recommendation.difySettings)
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
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
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
            <h2 className="text-[15px] font-bold">Configurations testées</h2>
            <table className="mt-3 w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-sub">
                  <th className="py-2 pr-3">Config</th>
                  <th className="py-2 pr-3">Mode</th>
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
              <h2 className="text-[15px] font-bold">Recommandation — à reporter dans Dify</h2>
              <button
                type="button"
                onClick={onCopy}
                className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium"
              >
                {copied ? 'Copié ✓' : 'Copier'}
              </button>
            </div>
            <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-sand/50 p-3 text-[13px]">
              {state.report.recommendation.difySettings}
            </pre>
            <p className="mt-2 text-[13px] text-sub">{state.report.recommendation.rationale}</p>
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
