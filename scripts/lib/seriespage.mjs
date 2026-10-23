/**
 * Hvor seriens forside ligger. Normalt på /serie/<slug>, men ikke altid: afsnittene af
 * X-Files ligger under x-files-tv2play, mens forsiden kun findes som x-files-none
 * (23-10-2026: 70 serier svarede 404 på den måde, alle med afsnit i sitemap'et og en
 * forside under en anden endelse — SkyShowtime, BritBox, -none, -tv2 …).
 */
import { extractSeries } from './jsonld.mjs';

const SERIES_PAGE = /^https:\/\/play\.tv2\.dk\/serie\/([^/]+)\/?$/;
const base = (slug) => slug.slice(0, slug.lastIndexOf('-'));
const norm = (s) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Slugs, der har deres egen forside i sitemap'et. */
export function seriesPages(entries) {
  const out = new Set();
  for (const e of entries) {
    const m = SERIES_PAGE.exec(e.loc);
    if (m) out.add(m[1]);
  }
  return out;
}

/** Andre forsider med samme navnestart. Tom, hvis sluggen selv har en forside. */
export function siblingPages(slug, pages) {
  if (pages.has(slug)) return [];
  const b = base(slug);
  return [...pages].filter((p) => p !== slug && base(p) === b).sort();
}

/**
 * Hent seriens forside: først sin egen, og ved 404 en søskende-forside — men kun hvis
 * dens TVSeries-navn er seriens navn. Samme navnestart er ikke nok til at være samme serie.
 * Giver { html, slug } eller null, hvis ingen forside passer. Andre fejl end 404 kastes,
 * så kaldet kan prøve igen næste nat.
 */
export async function fetchSeriesPage(slug, name, pages, get) {
  try {
    return { html: await get(`https://play.tv2.dk/serie/${slug}`), slug };
  } catch (err) {
    if (!/svarede 404$/.test(err.message)) throw err;
  }
  for (const sib of siblingPages(slug, pages)) {
    let html;
    try { html = await get(`https://play.tv2.dk/serie/${sib}`); } catch { continue; }
    if (norm(extractSeries(html).name) === norm(name)) return { html, slug: sib };
  }
  return null;
}
