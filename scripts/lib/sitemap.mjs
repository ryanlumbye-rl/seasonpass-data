/**
 * Sitemappet er TV 2 Plays egen fortegnelse, og hver post har lastmod.
 * Det giver både opdagelse og ændringsdetektion, så vi kun henter det, der har flyttet sig.
 */

/** Afsnit-URL: /serie/<slug>/<sæsonsti>/<afsnitsslug>-<guid>. Sæsonstien er ikke altid et tal. */
const EPISODE = /^https:\/\/play\.tv2\.dk\/serie\/([^/]+)\/([^/]+)\/(.+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function parseSitemap(xml) {
  const out = [];
  for (const m of xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]*)<\/lastmod>)?/g)) {
    out.push({ loc: m[1].trim(), lastmod: (m[2] ?? '').trim() });
  }
  return out;
}

export function episodeUrls(entries) {
  const out = [];
  for (const e of entries) {
    const m = EPISODE.exec(e.loc);
    if (!m) continue;
    out.push({ ...e, slug: m[1], seasonPath: m[2], guid: m[4] });
  }
  return out;
}

/** Ukendt URL eller ændret lastmod. Uændrede sider hentes aldrig igen. */
export function changedSince(entries, state) {
  return entries.filter((e) => state[e.loc] !== e.lastmod);
}

/**
 * Nyeste lastmod først. Budgettet pr. kørsel er mindre end kataloget, og
 * rækkefølgen er det, der gør ventetiden ligegyldig: en serie, der sender nu,
 * ligger øverst og kommer med i første kørsel, mens bagkataloget fylder op
 * bagefter, hvor ingen venter på det.
 *
 * Poster uden lastmod ryger bagerst. Tom streng sorterer ellers før alt
 * andet, og så ville de stjæle hele budgettet fra det, der faktisk er nyt.
 */
export function newestFirst(entries) {
  return [...entries].sort((a, b) => {
    const x = a.lastmod || '', y = b.lastmod || '';
    if (!x !== !y) return x ? -1 : 1;
    return x === y ? 0 : x < y ? 1 : -1;
  });
}

/**
 * Hvad denne kørsel når — HELE serier ad gangen, nyeste serie først.
 *
 * Budgetterer man pr. afsnit, deles en serie mellem to kørsler. Første kørsel
 * udgav Simon siger med 1 af 3 afsnit, fordi det tredje havde nyere lastmod
 * end de to andre — og 57 af 224 serier endte sådan. En serie, der siger
 * "1 afsnit" om noget, der har tre, er et selvsikkert forkert svar, og det er
 * værre end slet ikke at udgive den endnu. Hellere færre serier, der er hele.
 *
 * Rækkefølgen er stadig nyeste først, bare på serieniveau: den serie, der
 * sender nu, kommer med i denne kørsel.
 *
 * En enkelt serie større end hele budgettet (Krejlerkongen har 672 afsnit)
 * tages alligevel, når den står først — ellers ville den aldrig kunne hentes.
 */
export function dueThisRun(entries, state, budget) {
  const bySlug = new Map();
  for (const e of changedSince(entries, state)) {
    if (!bySlug.has(e.slug)) bySlug.set(e.slug, []);
    bySlug.get(e.slug).push(e);
  }
  // En serie, vi allerede har hentet afsnit fra, er udgivet og ufuldstændig
  // lige nu. Den skal gøres færdig, før vi begynder på en ny: ellers ligger
  // den i appen og siger "5 afsnit" om noget, der har ni, indtil dens tur
  // kommer efter lastmod. Færdiggør altid det påbegyndte først.
  const paabegyndt = new Set();
  for (const [slug, eps] of bySlug) {
    if (eps.some((e) => Object.prototype.hasOwnProperty.call(state, e.loc))) paabegyndt.add(slug);
  }
  // En slug kan også være påbegyndt, uden at nogen af dens RESTERENDE afsnit
  // står i tilstanden — derfor ses der på hele sitemappet, ikke kun på resten.
  for (const loc of Object.keys(state)) {
    const m = /\/serie\/([^/]+)\//.exec(loc);
    if (m && bySlug.has(m[1])) paabegyndt.add(m[1]);
  }

  const nyeste = (eps) => eps.reduce((m, e) => ((e.lastmod || '') > m ? e.lastmod || '' : m), '');
  const serier = [...bySlug.entries()].sort(([sa, a], [sb, b]) => {
    const pa = paabegyndt.has(sa), pb = paabegyndt.has(sb);
    if (pa !== pb) return pa ? -1 : 1;
    const x = nyeste(a), y = nyeste(b);
    if (!x !== !y) return x ? -1 : 1;
    return x === y ? 0 : x < y ? 1 : -1;
  }).map(([, eps]) => eps);

  const ud = [];
  for (const eps of serier) {
    if (ud.length && ud.length + eps.length > budget) break;
    ud.push(...newestFirst(eps));
  }
  return ud;
}

// I4: rene sanity-bunde, ikke forretningsregler. Formålet er alene at fange,
// at sitemap'et eller sideformatet er faldet fra hinanden under os (TV 2
// omlægger <url>/<loc>, skifter sitemap-stien, eller fjerner GUID'et i
// slutningen af afsnits-URL'en) — så alle tællinger går mod nul, intet
// skrives, PR-trinnet no-op'er, og jobbet lukker grønt for evigt uden
// signal. Tallene er bevidst langt under det reelle (~40.800 URL'er i alt):
// de skal aldrig selv udløse en fejl ved normal drift, kun ved reelt
// parse-sammenbrud.
export const MIN_TOTAL_SITEMAP_URLS = 1000;
export const MIN_MAPPED_EPISODE_URLS = 1;
/** Langt de fleste afsnits-URL'er er ukortlagte. Går de mod nul, er noget gået i stykker. */
export const MIN_UNMAPPED_EPISODE_URLS = 500;

/**
 * Kast med en klar dansk fejl, hvis sitemap-parsingen er faldet under
 * sanity-bunden. Kaldes efter parsing, så en reel ændring hos TV 2 stopper
 * jobbet højlydt i stedet for at producere en stille, tom PR.
 */
export function assertSitemapHealth(allEntries, mappedEpisodes, unmappedEpisodes) {
  if (allEntries.length < MIN_TOTAL_SITEMAP_URLS) {
    throw new Error(
      `Sitemap-sundhedstjek fejlede: kun ${allEntries.length} URL'er i alt i sitemap'et ` +
      `(forventede mindst ${MIN_TOTAL_SITEMAP_URLS}). TV 2 Play har sandsynligvis ændret ` +
      `sitemap-formatet eller -stien, ikke bare indholdet.`,
    );
  }
  if (mappedEpisodes.length < MIN_MAPPED_EPISODE_URLS) {
    throw new Error(
      `Sitemap-sundhedstjek fejlede: 0 kortlagte afsnits-URL'er fundet. ` +
      `Episode-regexen i sitemap.mjs matcher sandsynligvis ikke længere TV 2 Plays URL-format.`,
    );
  }
  if (unmappedEpisodes.length < MIN_UNMAPPED_EPISODE_URLS) {
    throw new Error(
      `Sitemap-sundhedstjek fejlede: kun ${unmappedEpisodes.length} ukortlagte afsnits-URL'er fundet ` +
      `(forventede mindst ${MIN_UNMAPPED_EPISODE_URLS}). TV 2 Play har sandsynligvis ændret ` +
      `sitemap-formatet eller -stien, ikke bare indholdet.`,
    );
  }
}
