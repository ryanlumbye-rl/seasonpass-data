import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildTv2Shows } from '../scripts/lib/tv2shows.mjs';

const ep = (slug, season, episode, date, name = `Afsnit ${episode}`, seasonPath = String(season)) =>
  ({ slug, seasonPath, guid: `${slug}-${season}-${episode}`, episode: { series: 'Simon siger', season, episode, name, date } });

const meta = { 'simon-siger-tv2': { name: 'Simon siger', tmdbId: 335191, next: '2026-10-25' } };

test('bygger indeks og serie-fil', () => {
  const { index, shows } = buildTv2Shows([
    ep('simon-siger-tv2', 1, 2, '2026-10-17'),
    ep('simon-siger-tv2', 1, 1, '2026-10-10'),
  ], meta);

  assert.deepEqual(index, { 'simon-siger-tv2': ['Simon siger', 335191] });
  const s = shows['simon-siger-tv2'];
  assert.equal(s.id, 'tv2play:simon-siger-tv2');
  assert.equal(s.service, 'tv2');
  assert.equal(s.next, '2026-10-25');
  // Sorteret på sæson og nummer, uanset hvilken rækkefølge de blev hentet i
  assert.deepEqual(s.episodes.map((e) => e.number), [1, 2]);
  assert.deepEqual(s.episodes[0], { id: 'simon-siger-tv2-1-1', season: 1, number: 1, name: 'Afsnit 1', airdate: '2026-10-10' });
});

test('to slugs er to serier — slug er identiteten her', () => {
  // buildEntries samler MobLands to slugs på ét TVmaze-id. Det må IKKE ske her:
  // uden et TVmaze-id er slug'en det eneste, der identificerer serien.
  const { shows } = buildTv2Shows([
    ep('mobland-tv2play', 2, 4, '2026-10-12'),
    ep('mobland-skyshowtime', 2, 1, '2026-09-21'),
  ], { 'mobland-tv2play': { name: 'MobLand', tmdbId: null, next: null },
       'mobland-skyshowtime': { name: 'MobLand', tmdbId: null, next: null } });
  assert.deepEqual(Object.keys(shows).sort(), ['mobland-skyshowtime', 'mobland-tv2play']);
  assert.equal(shows['mobland-skyshowtime'].service, 'skyshowtime');
});

test('afgrænsede serier kommer slet ikke med', () => {
  const { index, shows } = buildTv2Shows([ep('news-co-tv2news', 1, 1, '2026-10-10')],
    { 'news-co-tv2news': { name: 'News & Co', tmdbId: null, next: null } });
  assert.deepEqual(index, {});
  assert.deepEqual(shows, {});
});

test('samme afsnit hentet to gange tælles én gang', () => {
  const { shows } = buildTv2Shows([
    ep('simon-siger-tv2', 1, 1, '2026-10-10'),
    ep('simon-siger-tv2', 1, 1, '2026-10-10'),
  ], meta);
  assert.equal(shows['simon-siger-tv2'].episodes.length, 1);
});

test('en sæsonsti der ikke er et tal bruger schema.orgs sæsonnummer', () => {
  // episodeUrls advarer selv: seasonPath er ikke altid et tal.
  const { shows } = buildTv2Shows([ep('simon-siger-tv2', 1, 1, '2026-10-10', 'Afsnit 1', 'kommer-snart')], meta);
  assert.equal(shows['simon-siger-tv2'].episodes[0].season, 1);
});

test('et navn med anførselstegn rører ikke filnavnet', () => {
  const { index, shows } = buildTv2Shows([ep('det-er-"sjovt"-tv2', 1, 1, '2026-10-10')],
    { 'det-er-"sjovt"-tv2': { name: 'Det er "sjovt" 🎬', tmdbId: null, next: null } });
  // Nøglen er slug'en, uforandret; navnet er bare data
  assert.equal(Object.keys(shows)[0], 'det-er-"sjovt"-tv2');
  assert.equal(index['det-er-"sjovt"-tv2'][0], 'Det er "sjovt" 🎬');
});

test('status følger om der er et næste afsnit', () => {
  const { shows } = buildTv2Shows([ep('simon-siger-tv2', 1, 1, '2026-10-10')], meta);
  assert.equal(shows['simon-siger-tv2'].status, 'Running');
  const slut = buildTv2Shows([ep('simon-siger-tv2', 1, 1, '2026-10-10')],
    { 'simon-siger-tv2': { name: 'Simon siger', tmdbId: null, next: null } });
  // Ikke 'Ended': TV 2 Play siger kun om der kommer et afsnit, ikke om serien er slut
  assert.equal(slut.shows['simon-siger-tv2'].status, 'Unknown');
});
