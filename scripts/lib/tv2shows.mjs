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
  for (const slug of [...bySlug.keys()].sort()) {
    const s = bySlug.get(slug);
    index[slug] = [s.name, s.tmdbId];
    shows[slug] = {
      ...s,
      episodes: [...s.episodes.values()].sort((a, b) => a.season - b.season || a.number - b.number),
    };
  }
  return { index, shows };
}
