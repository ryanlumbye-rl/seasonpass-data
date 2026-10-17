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
 * Byg en menneske-læsbar rapport over ukendte serier, der har ændret sig.
 *
 * `entries` er ALLE ukendte (ikke-kortlagte) afsnits-URL'er fra denne kørsels
 * sitemap-scan — ingen forfiltrering, ingen hentning. Slug og sæsonsti kommer
 * fra URL'en alene, og derfor kan vi ikke vide, om seasonPath reelt er et
 * sæsonnummer (Review Focus 2) eller en serie, der slet ikke findes endnu;
 * det er netop derfor et menneske skal se på det.
 *
 * `state` er nøglet pr. SLUG, ikke pr. URL (modsat de kortlagte afsnits
 * tilstand): kun den nyeste lastmod set for serien. Det er alt, rapporten
 * behøver — "har denne serie ændret sig siden sidst, vi kiggede" — og det
 * giver en tilstandsfil på størrelsesordenen tusind rækker i stedet for
 * titusinder. En serie, der lige er tilføjet til mappings/tv2play.json, kan
 * stadig ikke fejlagtigt se "set uændret" ud, fordi den optrådte i en
 * tidligere ukendt-rapport — den kortlagte sti bruger en helt anden fil.
 *
 * Er `state` tom (ingen tidligere kørsel har set nogen ukendt serie endnu),
 * er det en opstart: hele TV 2 Plays eksisterende katalog af ikke-kortlagte
 * serier ville ellers se "ændret" ud på én gang, fordi der ikke er noget at
 * sammenligne med. Det er ikke nyt, og skal ikke fylde rapporten — vi
 * registrerer stille tilstanden, men rapporterer intet. En serie, der får et
 * nyt afsnit i morgen, dukker op i morgen; det er pointen.
 */
export function buildUnmatched(entries, state) {
  const groups = {};
  for (const e of entries) {
    const g = (groups[e.slug] ??= { seasons: new Set(), episodes: 0, lastmod: '' });
    g.seasons.add(e.seasonPath);
    g.episodes += 1;
    if (e.lastmod > g.lastmod) g.lastmod = e.lastmod;
  }

  const bootstrapping = Object.keys(state).length === 0;
  const report = {};
  const nextState = { ...state };
  for (const [slug, g] of Object.entries(groups)) {
    if (!bootstrapping && state[slug] !== g.lastmod) {
      report[slug] = { seasons: [...g.seasons].sort(), episodes: g.episodes, lastmod: g.lastmod };
    }
    nextState[slug] = g.lastmod;
  }
  return { report, nextState };
}

/**
 * Begræns unmatched.json til de `cap` senest ændrede serier, nyeste lastmod
 * først. Uden en grænse ville en samlet lastmod-opdatering på TV 2 Plays
 * side (eller en frisk opstart, se buildUnmatched) kunne oversvømme filen
 * igen — en håndfuld om dagen, ikke hele kataloget.
 */
export function limitUnmatched(unmatched, cap) {
  const sorted = Object.entries(unmatched).sort(([, a], [, b]) => {
    if (a.lastmod === b.lastmod) return 0;
    return a.lastmod < b.lastmod ? 1 : -1;
  });
  return {
    kept: Object.fromEntries(sorted.slice(0, cap)),
    omitted: Math.max(0, sorted.length - cap),
  };
}
