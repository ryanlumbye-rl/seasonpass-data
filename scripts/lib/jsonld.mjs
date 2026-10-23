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

/**
 * Seriens egen beskrivelse og billede fra seriesidens schema.org TVSeries. og:description
 * er TV 2's generelle reklametekst ("Prøv TV 2 Play nu") og bruges ikke. Billedet ligger
 * på TV 2's billed-CDN, hvor w= styrer bredden; siden beder om 720 px, vi tager 1280 til
 * forhåndsvisningens store felt. rect= (beskæringen) bevares.
 */
export function extractSeries(html) {
  for (const m of html.matchAll(BLOCK)) {
    let d;
    try { d = JSON.parse(m[1].trim()); } catch { continue; }
    if (!d || d['@type'] !== 'TVSeries') continue;
    const description = typeof d.description === 'string' && d.description.trim() ? d.description.trim() : null;
    const raw = typeof d.image === 'string' ? d.image : Array.isArray(d.image) && typeof d.image[0] === 'string' ? d.image[0] : null;
    const name = typeof d.name === 'string' && d.name.trim() ? d.name.trim() : null;
    return { name, description, image: raw ? widen(raw) : null };
  }
  return { name: null, description: null, image: null };
}

function widen(url) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('tv2i.dk')) u.searchParams.set('w', '1280');
    return u.toString();
  } catch {
    return null;
  }
}
