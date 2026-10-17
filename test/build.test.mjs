import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEntries, buildUnmatched, limitUnmatched, serviceForSlug } from '../scripts/lib/build.mjs';

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

// I1: unmatched-grenen i buildEntries er død kode (CLI'en forfiltrerer til
// kortlagte slugs, før buildEntries kaldes), og dens tidligere form,
// {series, season, example}, manglede .lastmod — hvilket fik limitUnmatched's
// komparator til at sortere den FØRST og fortrænge den rigtige rapport.
// En ukendt slug skal derfor bare springes helt over, og buildEntries skal
// ikke længere returnere noget "unmatched" overhovedet.
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

// Fix (runde 2, punkt 1): en tom tilstand er en opstart, ikke en aendring.
// Rapporten skal vaere tom, men tilstanden skal alligevel fyldes, saa en
// SENERE koersel kan opdage reelle aendringer mod denne baseline.
test('tom tilstand giver tom rapport, men fylder tilstanden (opstart)', () => {
  const entries = [
    url('ny-serie-tv2play', '1', '11111111-1111-1111-1111-111111111111', '2026-10-15'),
    url('ny-serie-tv2play', '1', '22222222-2222-2222-2222-222222222222', '2026-10-16'),
  ];
  const { report, nextState } = buildUnmatched(entries, {});
  assert.deepEqual(report, {}, 'opstart skal ikke rapportere hele det eksisterende katalog');
  assert.equal(nextState['ny-serie-tv2play'], '2026-10-16', 'tilstanden skal stadig fyldes');
});

// Fix (runde 2, punkt 2): tilstanden er noeglet pr. slug, ikke pr. URL, og
// gemmer den nyeste lastmod set for serien, selv naar flere afsnit aendrer sig.
test('tilstanden er noeglet pr. slug med nyeste lastmod ved flere aendrede afsnit', () => {
  const previousState = { 'ny-serie-tv2play': '2026-09-01' };
  const entries = [
    url('ny-serie-tv2play', '1', '11111111-1111-1111-1111-111111111111', '2026-10-15'),
    url('ny-serie-tv2play', '1', '22222222-2222-2222-2222-222222222222', '2026-10-16'),
  ];
  const { report, nextState } = buildUnmatched(entries, previousState);
  assert.deepEqual(report['ny-serie-tv2play'], { seasons: ['1'], episodes: 2, lastmod: '2026-10-16' });
  assert.equal(nextState['ny-serie-tv2play'], '2026-10-16', 'tilstanden gemmer kun den nyeste lastmod, ikke en pr. URL');
  assert.equal(Object.keys(nextState).length, 1, 'tilstanden er pr. slug, ikke pr. URL');
});

test('buildUnmatched samler flere saesonstier for samme serie', () => {
  const previousState = { 'bagom-tv2play': '2024-01-01' };
  const entries = [
    url('bagom-tv2play', '2026', '33333333-3333-3333-3333-333333333333', '2026-01-01'),
    url('bagom-tv2play', '2025', '44444444-4444-4444-4444-444444444444', '2025-06-01'),
  ];
  const { report } = buildUnmatched(entries, previousState);
  assert.deepEqual(report['bagom-tv2play'].seasons, ['2025', '2026']);
});

// Fix A (runde 1): en egen tilstand for ukendte serier, saa en serie, der
// senere bliver tilfoejet til mappings/tv2play.json, ikke fejlagtigt ser
// "set uaendret" ud, fordi den engang optraadte i en tidligere ukendt-rapport.
test('buildUnmatched muterer ikke input-tilstanden', () => {
  const entries = [url('ny-serie-tv2play', '1', '55555555-5555-5555-5555-555555555555', '2026-10-15')];
  const previousState = { 'en-anden-serie': '2026-01-01' };
  const { nextState } = buildUnmatched(entries, previousState);
  assert.deepEqual(previousState, { 'en-anden-serie': '2026-01-01' }, 'input-tilstanden maa ikke mutere');
  assert.equal(nextState['ny-serie-tv2play'], '2026-10-15');
});

// Fix (runde 2, punkt 3): uden en graense kunne en samlet lastmod-opdatering
// paa TV 2 Plays side (eller en frisk opstart) oversvoemme unmatched.json igen.
test('limitUnmatched holder graensen og rapporterer det udeladte antal', () => {
  const unmatched = Object.fromEntries(
    Array.from({ length: 60 }, (_, i) => [
      `serie-${i}`,
      { seasons: ['1'], episodes: 1, lastmod: `2026-01-${String(i + 1).padStart(2, '0')}` },
    ]),
  );
  const { kept, omitted } = limitUnmatched(unmatched, 50);
  assert.equal(Object.keys(kept).length, 50);
  assert.equal(omitted, 10);
  // Nyeste lastmod foerst: serie-59 (2026-02-28 svarer ikke, men den hoejeste dag) overlever, serie-0 goer ikke.
  assert.ok('serie-59' in kept, 'den nyeste skal vaere med');
  assert.ok(!('serie-0' in kept), 'den aeldste skal vaere udeladt');
});

test('limitUnmatched udelader intet, naar alt er under graensen', () => {
  const unmatched = { 'serie-a': { seasons: ['1'], episodes: 1, lastmod: '2026-01-01' } };
  const { kept, omitted } = limitUnmatched(unmatched, 50);
  assert.deepEqual(kept, unmatched);
  assert.equal(omitted, 0);
});
