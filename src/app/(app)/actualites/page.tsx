import Link from 'next/link'

import { getServerCaller } from '@/server/trpc/server'
import { ImgSlot } from '@/components/ui/ImgSlot'
import { formatDateFr } from '@/lib/format-date'

type Article = Awaited<
  ReturnType<Awaited<ReturnType<typeof getServerCaller>>['news']['listPublished']>
>[number]

const datelineFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' })

export default async function ActualitesPage() {
  const api = await getServerCaller()
  const articles = await api.news.listPublished()

  const today = datelineFmt.format(new Date())
  const featured = articles[0]
  const rest = articles.slice(1)

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-8 md:px-10 md:py-12">
      {/* Masthead / nameplate */}
      <header className="border-y-2 border-ink py-5 text-center">
        <h1 className="font-serif text-[34px] font-extrabold uppercase leading-[0.95] tracking-[0.02em] md:text-[52px]">
          La Gazette A<span className="text-red">⁺</span>SUPER
        </h1>
        <div className="mt-3 flex flex-col items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.18em] text-sub md:flex-row md:justify-between md:gap-0">
          <span className="first-letter:capitalize">{today}</span>
          <span className="text-faint">N° {articles.length}</span>
          <span className="text-red">Le journal interne de la bascule</span>
        </div>
      </header>

      {articles.length === 0 ? (
        <div className="py-24 text-center">
          <p className="font-serif text-[19px] italic text-sub">
            Aucune actualité publiée pour le moment.
          </p>
          <p className="mt-2 text-[13px] uppercase tracking-[0.15em] text-faint">
            Revenez bientôt — la rédaction prépare sa prochaine édition.
          </p>
        </div>
      ) : (
        <>
          {/* Featured / front-page lead */}
          {featured && <Featured article={featured} />}

          {/* The rest — newspaper columns */}
          {rest.length > 0 && (
            <section className="mt-10 border-t-2 border-ink pt-2">
              <div className="mb-5 flex items-center gap-3">
                <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-red">
                  La suite de l&apos;édition
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="grid grid-cols-1 gap-x-8 md:grid-cols-3 md:divide-x md:divide-line">
                {rest.map((article, i) => (
                  <Column key={article.id} article={article} first={i === 0} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Featured({ article }: { article: Article }) {
  const date = formatDateFr(article.publishedAt)
  return (
    <article className="mt-8">
      <Link
        href={`/actualites/${article.slug}`}
        className="group grid grid-cols-1 items-start gap-7 md:grid-cols-2 md:gap-9"
      >
        <div className="overflow-hidden border border-line">
          {article.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={article.coverImageUrl}
              alt={article.title}
              className="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            />
          ) : (
            <ImgSlot
              label={'à la une'}
              height={300}
              radius={0}
              tone="#EFE6D6"
              accent="#D6C9B2"
            />
          )}
        </div>

        <div>
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-red">
            À la une
          </div>
          <h2 className="font-serif text-4xl font-extrabold leading-[1.05] tracking-[-0.01em] decoration-red/40 decoration-2 underline-offset-4 group-hover:underline md:text-5xl">
            {article.title}
          </h2>
          {article.excerpt && (
            <p className="mt-4 font-serif text-[18px] leading-[1.6] text-sub md:text-[19px]">
              {article.excerpt}
            </p>
          )}
          <div className="mt-5 border-t border-line pt-3 text-[12.5px] uppercase tracking-[0.1em] text-faint">
            {article.authorName ? `Par ${article.authorName}` : 'La rédaction'}
            {date && <span className="text-line"> · </span>}
            {date}
          </div>
        </div>
      </Link>
    </article>
  )
}

function Column({ article, first }: { article: Article; first: boolean }) {
  const date = formatDateFr(article.publishedAt)
  return (
    <Link
      href={`/actualites/${article.slug}`}
      className="group block py-5 md:px-7 md:py-1 md:first:pl-0"
    >
      {article.coverImageUrl && (
        <div className="mb-3 overflow-hidden border border-line">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={article.coverImageUrl}
            alt={article.title}
            className="aspect-[16/9] w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
        </div>
      )}
      <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] text-red">
        {article.authorName ? `Par ${article.authorName}` : 'La rédaction'}
      </div>
      <h3
        className={`font-serif font-bold leading-snug tracking-[-0.01em] decoration-red/40 underline-offset-2 group-hover:underline ${
          first ? 'text-2xl' : 'text-lg md:text-xl'
        }`}
      >
        {article.title}
      </h3>
      {article.excerpt && (
        <p className="mt-2 line-clamp-3 text-[14px] leading-[1.55] text-sub">
          {article.excerpt}
        </p>
      )}
      {date && (
        <div className="mt-2.5 text-[11px] uppercase tracking-[0.12em] text-faint">
          {date}
        </div>
      )}
    </Link>
  )
}
