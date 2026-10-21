/**
 * Byg overrides-poster af de fundne afsnit.
 *
 * To ting kilden kræver af os:
 * 1. En serie er ikke én slug. MobLands sæson 2 ligger som mobland-skyshowtime
 *    (afsnit 1-3) og mobland-tv2play (afsnit 4-5), så vi samler pr. TVmaze-id.
 * 2. Vi gætter aldrig et match. Ukendte slugs går til unmatched.json.
 */

/** Sluggens endelse siger, hvor titlen ligger. Alt der ikke er SkyShowtime, er TV 2 Play. */
export function serviceForSlug(slug) {
  return /-skyshowtime$/.test(slug) ? 'skyshowtime' : 'tv2';
}

export function buildEntries(found, mapping) {
  const entries = {};
  const servicesByKey = {};
  const titlesByKey = {};

  for (const { slug, episode } of found) {
    if (!episode) continue;
    const id = mapping[slug];
    // Vi gætter aldrig et match: en ukendt slug springes helt over her.
    // buildUnmatched (ovenfor) er den rigtige kilde til "ukendte serier" —
    // den bruger alene sitemap-metadata, uden at kræve en hentning som denne
    // funktion arbejder på. CLI'en forfiltrerer desuden til kortlagte slugs,
    // før buildEntries kaldes, så denne grene i praksis aldrig når et ukendt
    // match alligevel.
    if (!id) continue;
    const key = `tvmaze:${id}`;
    const e = (entries[key] ??= {
      title: episode.series,
      source: 'scraper',
      note: 'Hentet fra TV 2 Plays egen schema.org (datePublished)',
      seasons: {},
    });
    (servicesByKey[key] ??= new Set()).add(serviceForSlug(slug));
    (titlesByKey[key] ??= {})[slug] = episode.series;
    const s = (e.seasons[String(episode.season)] ??= { episodes: 0, release: episode.date, pattern: 'explicit', episodeOverrides: {} });
    s.episodeOverrides[String(episode.episode)] = { release: episode.date };
  }

  // release er den tidligste kendte dato, og episodes antallet af poster.
  // service OG title afgøres HER, ikke ved oprettelse: sitemap'ets
  // rækkefølge (som vi ikke styrer) afgør ellers hvilken slugs episode kommer
  // først, og både "tv2"/"skyshowtime" og titlen ville kunne flippe mellem
  // kørsler uden at dataen har ændret sig. Reglen for service er den samme
  // konvention som serviceForSlug: tv2, med mindre ALLE afsnit for serien kom
  // fra SkyShowtime. Reglen for title er alfabetisk første slug set for serien.
  for (const [key, e] of Object.entries(entries)) {
    const services = servicesByKey[key];
    e.service = services.size === 1 && services.has('skyshowtime') ? 'skyshowtime' : 'tv2';
    const firstSlug = Object.keys(titlesByKey[key]).sort()[0];
    e.title = titlesByKey[key][firstSlug];
    for (const s of Object.values(e.seasons)) {
      const dates = Object.values(s.episodeOverrides).map((x) => x.release).sort();
      s.release = dates[0];
      s.episodes = dates.length;
      s.episodeOverrides = Object.fromEntries(
        Object.entries(s.episodeOverrides).sort((a, b) => Number(a[0]) - Number(b[0])),
      );
    }
  }
  return { entries };
}

/**
 * Hver ukortlagt serie, hver kørsel.
 *
 * Tidligere rapporterede denne funktion kun serier, hvis lastmod havde
 * flyttet sig, og registrerede ved første kørsel hele katalogets lastmod i
 * stilhed. Hensigten var at holde den første PR lille; virkningen var, at
 * bagkataloget blev usynligt for altid — målt 21-10-2026 var 1.546 af 1.635
 * serier skjult. Filen er en arbejdsliste, og en arbejdsliste, der skjuler
 * 95 % af arbejdet, er værre end ingen.
 *
 * Nøglerne sorteres, så en ny serie giver få linjers diff frem for at flytte
 * rundt på filen.
 */
export function buildUnmatched(entries) {
  const groups = {};
  for (const e of entries) {
    const g = (groups[e.slug] ??= { seasons: new Set(), episodes: 0, lastmod: '' });
    g.seasons.add(e.seasonPath);
    g.episodes += 1;
    if (e.lastmod > g.lastmod) g.lastmod = e.lastmod;
  }
  const report = {};
  for (const slug of Object.keys(groups).sort()) {
    const g = groups[slug];
    report[slug] = { seasons: [...g.seasons].sort(), episodes: g.episodes, lastmod: g.lastmod };
  }
  return { report };
}
