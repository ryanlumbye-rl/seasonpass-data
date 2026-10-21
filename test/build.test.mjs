import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEntries, buildUnmatched, serviceForSlug } from '../scripts/lib/build.mjs';

const mapping = { 'mobland-skyshowtime': 75026, 'mobland-tv2play': 75026 };
const ep = (season, episode, date, name = 'A', series = 'Mobland') => ({ series, season, episode, date, name });

test('sluggen afslører tjenesten', () => {
  assert.equal(serviceForSlug('mobland-skyshowtime'), 'skyshowtime');
  assert.equal(serviceForSlug('mobland-tv2play'), 'tv2');
  assert.equal(serviceForSlug('forraeder-usa-tv2echo'), 'tv2');
});

// Review Focus 1: en serie kan vaere fordelt over flere slugs.
test('samler afsnit fra flere slugs i én post', () => {
  const { entries } = buildEntries([
    { slug: 'mobland-skyshowtime', episode: ep(2, 2, '2026-09-28') },
    { slug: 'mobland-tv2play', episode: ep(2, 5, '2026-10-19') },
  ], mapping);
  const s = entries['tvmaze:75026'].seasons['2'];
  assert.deepEqual(Object.keys(s.episodeOverrides), ['2', '5']);
  assert.equal(s.episodeOverrides['5'].release, '2026-10-19');
  assert.equal(s.episodes, 2);
  // F1: service maa ikke afhaenge af, hvilken slug kom foerst i sitemap'et.
  assert.equal(entries['tvmaze:75026'].service, 'tv2');
});

// Minor 5: title havde samme fejl, som service blev flyttet ud af loopet for
// at undgaa — vinderen var bare "hvilken episode kom foerst i found" (reelt
// sitemap-raekkefoelgen, som vi ikke styrer). Nu afgoeres title ogsaa efter
// kørslen, fra den alfabetisk foerste slug, uanset raekkefoelgen i `found`.
test('title afhaenger af alfabetisk foerste slug, ikke af hvilket afsnit der kom foerst', () => {
  const { entries } = buildEntries([
    { slug: 'mobland-tv2play', episode: ep(2, 5, '2026-10-19', 'A', 'MobLand hos TV 2 Play') },
    { slug: 'mobland-skyshowtime', episode: ep(2, 2, '2026-09-28', 'A', 'MobLand hos SkyShowtime') },
  ], mapping);
  // "mobland-skyshowtime" < "mobland-tv2play" alfabetisk, saa dens titel
  // vinder, selv om tv2play-afsnittet kom foerst paa listen.
  assert.equal(entries['tvmaze:75026'].title, 'MobLand hos SkyShowtime');
});

test('skriver explicit-moenster med tidligste dato som release', () => {
  const { entries } = buildEntries([
    { slug: 'mobland-tv2play', episode: ep(2, 5, '2026-10-19') },
    { slug: 'mobland-skyshowtime', episode: ep(2, 2, '2026-09-28') },
  ], mapping);
  const s = entries['tvmaze:75026'].seasons['2'];
  assert.equal(s.pattern, 'explicit');
  assert.equal(s.release, '2026-09-28');
});

test('mærker posten som scraper og giver den en begrundelse', () => {
  const { entries } = buildEntries([{ slug: 'mobland-tv2play', episode: ep(2, 5, '2026-10-19') }], mapping);
  const e = entries['tvmaze:75026'];
  assert.equal(e.source, 'scraper');
  assert.equal(e.service, 'tv2');
  assert.ok(e.note.length > 10);
});

// I1: unmatched-grenen i buildEntries er død kode — CLI'en forfiltrerer til
// kortlagte slugs, før buildEntries kaldes. Dens tidligere form manglede
// .lastmod og fortrængte dermed den rigtige rapport, dengang unmatched.json
// havde et loft at konkurrere om. Loftet er væk, men reglen står: en ukendt
// slug springes helt over, og buildEntries returnerer ingen unmatched-gren.
// buildUnmatched er den eneste kilde til ukendte serier.
test('ukendte slugs springes stille over i buildEntries (ingen unmatched-gren laengere)', () => {
  const result = buildEntries(
    [
      { slug: 'en-ukendt-serie-tv2play', episode: ep(1, 1, '2026-10-19') },
      { slug: 'mobland-tv2play', episode: ep(2, 5, '2026-10-19') },
    ],
    mapping,
  );
  assert.deepEqual(Object.keys(result), ['entries'], 'buildEntries maa ikke returnere en unmatched-gren laengere');
  assert.deepEqual(Object.keys(result.entries), ['tvmaze:75026'], 'kun den kortlagte slug giver en post');
});

// Fix A: buildEntries' unmatched-grene kan aldrig naa, naar CLI'en forfiltrerer
// paa mapping[e.slug] foer buildEntries kaldes. buildUnmatched er den rigtige
// kilde til "ukendte serier" og bruger alene sitemap-metadata, ingen hentning.
const url = (slug, seasonPath, guid, lastmod) => ({
  loc: `https://play.tv2.dk/serie/${slug}/${seasonPath}/afsnit-${guid}`,
  lastmod, slug, seasonPath, guid,
});

test('rapporterer hver ukortlagt serie, ikke kun dem der har flyttet sig', () => {
  const { report } = buildUnmatched([
    { slug: 'a-tv2', seasonPath: '1', lastmod: '2020-01-01' },
    { slug: 'b-tv2', seasonPath: '2', lastmod: '2026-10-20' },
  ]);
  assert.deepEqual(Object.keys(report).sort(), ['a-tv2', 'b-tv2']);
});

test('nøglerne er sorterede, så en ny serie giver få linjers diff', () => {
  const { report } = buildUnmatched([
    { slug: 'z-tv2', seasonPath: '1', lastmod: '2026-01-01' },
    { slug: 'a-tv2', seasonPath: '1', lastmod: '2026-01-01' },
  ]);
  assert.deepEqual(Object.keys(report), ['a-tv2', 'z-tv2']);
});

test('samler sæsoner og tæller afsnit pr. serie', () => {
  const { report } = buildUnmatched([
    { slug: 'a-tv2', seasonPath: '2', lastmod: '2026-01-02' },
    { slug: 'a-tv2', seasonPath: '1', lastmod: '2026-01-03' },
  ]);
  assert.deepEqual(report['a-tv2'], { seasons: ['1', '2'], episodes: 2, lastmod: '2026-01-03' });
});

test('buildUnmatched samler flere saesonstier for samme serie', () => {
  const entries = [
    url('bagom-tv2play', '2026', '33333333-3333-3333-3333-333333333333', '2026-01-01'),
    url('bagom-tv2play', '2025', '44444444-4444-4444-4444-444444444444', '2025-06-01'),
  ];
  const { report } = buildUnmatched(entries);
  assert.deepEqual(report['bagom-tv2play'].seasons, ['2025', '2026']);
});
