import { serviceForSlug } from './build.mjs';
import { isSupported } from './scope.mjs';

/**
 * Byg appens TV 2 Play-data: et lille søgeindeks og en fil pr. serie.
 *
 * Forskellen fra buildEntries er identiteten. Dér samles flere slugs på ét
 * TVmaze-id, fordi MobLands sæson 2 ligger spredt på to slugs. Her findes
 * der intet TVmaze-id — slug'en ER serien — så to slugs forbliver to serier.
 * At slå dem sammen ville kræve et gæt, og vi gætter ikke.
 */
export function buildTv2Shows(found, meta) {
  const bySlug = new Map();

  for (const f of found) {
    if (!isSupported(f.slug)) continue;
    const m = meta[f.slug];
    if (!m?.name) continue; // uden navn har vi ingen serie at vise

    if (!bySlug.has(f.slug)) {
      bySlug.set(f.slug, {
        id: `tv2play:${f.slug}`,
        name: m.name,
        service: serviceForSlug(f.slug),
        // TV 2 Play siger kun, om der kommer et afsnit, aldrig om serien er slut.
        // 'Ended' ville erklaere hver serie mellem saesoner for doed — og kun 9 af
        // 45 maalte serier havde en kommende dato. 'Unknown' viser "Venter paa ny
        // saeson", hvilket er sandt.
        status: m.next ? 'Running' : 'Unknown',
        tmdbId: m.tmdbId ?? null,
        next: m.next ?? null,
        // Fra seriesidens schema.org (extractSeries): til forhåndsvisningen, når TMDB intet har.
        description: m.description ?? null,
        image: m.image ?? null,
        episodes: new Map(), // på GUID, så samme afsnit kun tælles én gang
      });
    }
    // Sæsonnummeret kommer fra schema.org, ikke fra URL-stien: seasonPath er
    // ikke altid et tal.
    bySlug.get(f.slug).episodes.set(f.guid, {
      id: f.guid,
      season: f.episode.season,
      number: f.episode.episode,
      name: f.episode.name,
      airdate: f.episode.date,
    });
  }

  const index = {};
  const shows = {};
  // Billederne ligger i et kort ved siden af indekset, ikke i dets poster: appen i drift
  // (22-10-2026) afviser en post med andet end [navn, tmdbId] og ville smide hele indekset væk.
  const images = {};
  for (const slug of [...bySlug.keys()].sort()) {
    const s = bySlug.get(slug);
    index[slug] = [s.name, s.tmdbId];
    if (s.image) images[slug] = s.image;
    shows[slug] = {
      ...s,
      episodes: [...s.episodes.values()].sort((a, b) => a.season - b.season || a.number - b.number),
    };
  }
  return { index, shows, images };
}

/**
 * Samme serie under to adresser: 'alfa-tv2echo' og 'alfa-tv2play'. Ryan (22-10-2026): kun
 * -tv2play-udgaven skal findes i appen. Men i 71 af 80 målte par har kanal-udgaven afsnit,
 * -tv2play ikke har (Alene sammen: 1 mod 31), så afsnittene samles under -tv2play i stedet for
 * at kanal-udgaven smides væk. Serier hører sammen, når alt før sidste bindestreg er ens.
 */
export function canonicalSlugs(slugs, info = {}) {
  const all = new Set(slugs);
  const base = (slug) => slug.slice(0, slug.lastIndexOf('-'));
  // Uden en -tv2play samles udgaver med samme titel (uden tegnsætning) under den med flest
  // afsnit (Ryan 22-10-2026: Jo færre jo bedre stod to gange). Kendes titlen ikke, røres
  // udgaven ikke — to serier med samme slug-start må aldrig blandes sammen.
  const title = (slug) => info[slug]?.name?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') || null;
  const best = new Map();
  for (const slug of all) {
    const t = title(slug);
    if (!t) continue;
    const key = `${base(slug)}|${t}`;
    const cur = best.get(key);
    if (!cur || (info[slug].episodes ?? 0) > (info[cur].episodes ?? 0)) best.set(key, slug);
  }
  const out = new Map();
  for (const slug of all) {
    const b = base(slug);
    if (all.has(`${b}-tv2play`)) out.set(slug, `${b}-tv2play`);
    else out.set(slug, title(slug) ? best.get(`${b}|${title(slug)}`) : slug);
  }
  return out;
}

/**
 * Saml alle serie-filer efter canonicalSlugs. Resultatet:
 * - shows: den samlede serie under -tv2play-sluggen, og for hver kanal-udgave en kopi med sit
 *   eget id — så den, der allerede følger 'alfa-tv2echo', beholder alle afsnit.
 * - index og images: kun de samlede serier, så søgningen viser hver serie én gang.
 * Samme afsnit (sæson + nummer) tælles én gang; -tv2play-udgavens afsnit vinder.
 */
export function consolidate(showsBySlug, canon) {
  const groups = new Map();
  for (const slug of Object.keys(showsBySlug).sort()) {
    const c = canon.get(slug) ?? slug;
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(slug);
  }
  const shows = {};
  const index = {};
  const images = {};
  for (const [c, members] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const parts = [c, ...members.filter((m) => m !== c).sort()].map((m) => showsBySlug[m]).filter(Boolean);
    const head = parts[0];
    const byKey = new Map();
    for (const p of parts) for (const e of p.episodes ?? []) {
      const key = `${e.season}x${e.number}`;
      if (!byKey.has(key)) byKey.set(key, e);
    }
    const nexts = parts.map((p) => p.next).filter(Boolean).sort();
    const first = (field) => parts.map((p) => p[field]).find((v) => v != null) ?? null;
    const merged = {
      ...head,
      id: `tv2play:${c}`,
      name: head.name,
      service: parts.some((p) => p.service === 'skyshowtime') ? 'skyshowtime' : head.service ?? serviceForSlug(c),
      tmdbId: first('tmdbId'),
      next: nexts[0] ?? null,
      status: nexts.length ? 'Running' : head.status,
      description: first('description'),
      image: first('image'),
      episodes: [...byKey.values()].sort((a, b) => a.season - b.season || a.number - b.number),
    };
    shows[c] = merged;
    for (const m of members) if (m !== c) shows[m] = { ...merged, id: `tv2play:${m}` };
    index[c] = [merged.name, merged.tmdbId];
    if (merged.image) images[c] = merged.image;
  }
  return { shows, index, images };
}
