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

/**
 * Kast med en klar dansk fejl, hvis sitemap-parsingen er faldet under
 * sanity-bunden. Kaldes efter parsing, så en reel ændring hos TV 2 stopper
 * jobbet højlydt i stedet for at producere en stille, tom PR.
 */
export function assertSitemapHealth(allEntries, mappedEpisodes) {
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
}
