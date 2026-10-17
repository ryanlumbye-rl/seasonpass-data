/**
 * TV 2 Play udstiller hver afsnitsside som schema.org TVSeries med én TVEpisode i
 * containsSeason. datePublished er den danske udgivelsesdato — verificeret 17-10-2026
 * mod MobLand S2E5 (19-10) og Tulsa King S4E1 (22-10).
 */

const BLOCK = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
const isDate = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);

export function extractEpisode(html) {
  for (const m of html.matchAll(BLOCK)) {
    let d;
    try { d = JSON.parse(m[1].trim()); } catch { continue; }
    if (!d || d['@type'] !== 'TVSeries') continue;

    // schema.org tillader både ét objekt og en liste
    for (const season of [].concat(d.containsSeason ?? [])) {
      for (const ep of [].concat(season?.episode ?? [])) {
        if (!isDate(ep?.datePublished)) continue;
        if (typeof ep.episodeNumber !== 'number' || typeof season.seasonNumber !== 'number') continue;
        return {
          series: String(d.name ?? ''),
          season: season.seasonNumber,
          episode: ep.episodeNumber,
          name: String(ep.name ?? ''),
          date: ep.datePublished,
        };
      }
    }
  }
  return null;
}
