import Link from 'next/link'
import { notFound } from 'next/navigation'
import { TRPCError } from '@trpc/server'

import { getServerCaller } from '@/server/trpc/server'
import { Icon } from '@/components/ui/Icon'
import { formatDateFr } from '@/lib/format-date'

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const api = await getServerCaller()

  let article
  try {
    article = await api.news.bySlug({ slug })
  } catch (err) {
    if (err instanceof TRPCError && err.code === 'NOT_FOUND') {
      notFound()
    }
    throw err
  }

  const date = formatDateFr(article.publishedAt)

  return (
    <article className="mx-auto w-full max-w-[1100px] px-5 py-8 md:px-10 md:py-12">
      {/* Back to the front page */}
      <Link
        href="/actualites"
        className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.14em] text-sub transition-colors hover:text-red"
      >
        <Icon name="chevronL" size={14} color="currentColor" />
        La Gazette
      </Link>

      {/* Headline block */}
      <header className="mx-auto mt-6 max-w-[820px] text-center">
        <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.22em] text-red">
          Actualité interne
        </div>
        <h1 className="font-serif text-3xl font-extrabold leading-[1.04] tracking-[-0.01em] md:text-4xl">
          {article.title}
        </h1>
        {article.excerpt && (
          <p className="mx-auto mt-5 max-w-[640px] font-serif text-[17px] leading-[1.6] text-sub md:text-[18px]">
            {article.excerpt}
          </p>
        )}
        <div className="mt-7 border-y border-line py-3 text-[12px] uppercase tracking-[0.12em] text-faint">
          {article.authorName ? `Par ${article.authorName}` : 'La rédaction'}
          {date && <span className="text-line"> · </span>}
          {date}
        </div>
      </header>

      {/* Cover */}
      {article.coverImageUrl && (
        <figure className="mx-auto mt-8 max-w-[900px]">
          <div className="overflow-hidden border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={article.coverImageUrl}
              alt={article.title}
              className="w-full object-cover"
            />
          </div>
          <figcaption className="mt-2 border-t border-line pt-2 text-[11px] uppercase tracking-[0.1em] text-faint">
            {article.title}
          </figcaption>
        </figure>
      )}

      {/* Body */}
      <div
        className="mx-auto mt-10 max-w-[680px] font-serif text-ink [&>p:first-of-type]:first-letter:float-left [&>p:first-of-type]:first-letter:mr-2 [&>p:first-of-type]:first-letter:font-extrabold [&>p:first-of-type]:first-letter:text-5xl [&>p:first-of-type]:first-letter:leading-[0.8] [&>p:first-of-type]:first-letter:text-red [&_a]:text-redink [&_a]:underline [&_blockquote]:my-6 [&_blockquote]:border-l-4 [&_blockquote]:border-red [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-sub [&_h2]:mt-8 [&_h2]:text-2xl [&_h2]:font-bold [&_h3]:mt-6 [&_h3]:text-xl [&_h3]:font-semibold [&_img]:my-6 [&_img]:w-full [&_img]:border [&_img]:border-line [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-4 [&_p]:text-[17px] [&_p]:leading-[1.75] [&_ul]:list-disc [&_ul]:pl-6"
        dangerouslySetInnerHTML={{ __html: article.contentHtml }}
      />

      {/* Footer */}
      <footer className="mx-auto mt-12 max-w-[680px] border-t-2 border-ink pt-5">
        <Link
          href="/actualites"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-bold uppercase tracking-[0.14em] text-redink transition-colors hover:text-red"
        >
          <Icon name="chevronL" size={15} color="currentColor" />
          Retour à La Gazette
        </Link>
      </footer>
    </article>
  )
}
