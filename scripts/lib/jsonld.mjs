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
    return { name, description, image: raw ? widen(raw) : null, ...pageArt(html, raw, name) };
  }
  return { name: null, description: null, image: null, poster: null, titleArt: null };
}

/**
 * Plakat og titelart fra sidens egne data (Ryan 23-10-2026), ikke fra schema.org. Siden har
 * seriens billede i flere formater under backgroundImage; r2x3 er TV 2's stående mobiludgave.
 * Andre serier på siden har deres egne, så kun det udsnit, der er af SERIENS billede (samme
 * uuid som schema.org's image), bruges. Titelarten tages kun, når dens tekst er seriens navn.
 */
function pageArt(html, image, name) {
  const flat = html.replace(/\\"/g, '"').replace(/\\u0026/g, '&');
  const uuid = image?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  let poster = null;
  if (uuid) {
    for (const m of flat.matchAll(/"r2x3":\{"__typename":"Image","url":"([^"]+)"/g)) {
      if (m[1].includes(uuid)) { poster = sized(m[1], 600); break; }
    }
  }
  let titleArt = null;
  for (const m of flat.matchAll(/"title":\{"text":"([^"]*)","art":"(https:[^"]+)"/g)) {
    if (name && m[1].trim() === name) { titleArt = m[2]; break; }
  }
  return { poster, titleArt };
}

function sized(url, w) {
  try {
    const u = new URL(url.replace(/&amp;/g, '&'));
    u.searchParams.set('w', String(w));
    return u.toString();
  } catch {
    return null;
  }
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
