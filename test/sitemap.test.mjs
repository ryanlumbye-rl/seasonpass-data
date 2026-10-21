import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertSitemapHealth, changedSince, dueThisRun, episodeUrls, MIN_TOTAL_SITEMAP_URLS, MIN_UNMAPPED_EPISODE_URLS,
  newestFirst, parseSitemap,
} from '../scripts/lib/sitemap.mjs';

const xml = () => readFileSync('fixtures/tv2play-sitemap.xml', 'utf8');

test('parseSitemap laeser loc og lastmod', () => {
  const e = parseSitemap(xml());
  assert.equal(e.length, 4);
  assert.equal(e[0].lastmod, '2026-10-08');
});

test('episodeUrls tager kun afsnit, ikke film og serieforsider', () => {
  const e = episodeUrls(parseSitemap(xml()));
  assert.equal(e.length, 2);
  assert.deepEqual(e.map((x) => x.slug), ['mobland-tv2play', 'mobland-skyshowtime']);
  assert.equal(e[0].seasonPath, '2');
  assert.equal(e[0].guid, '80b88860-165f-499f-bb19-11bfcff45442');
});

test('changedSince tager kun det der har flyttet sig', () => {
  const e = episodeUrls(parseSitemap(xml()));
  const state = { [e[0].loc]: '2026-10-08' };
  const changed = changedSince(e, state);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].slug, 'mobland-skyshowtime');
});

test('changedSince tager alt, naar tilstanden er tom', () => {
  const e = episodeUrls(parseSitemap(xml()));
  assert.equal(changedSince(e, {}).length, 2);
});

// I4: falder sitemap'et eller sideformatet fra hinanden hos TV 2 (omlagt
// <url>/<loc>, en flyttet sitemap-sti, eller en fjernet GUID i slutningen af
// afsnits-URL'en), skal det fejle højlydt, i stedet for at tælle ned til nul,
// skrive ingenting og lukke jobbet grønt for evigt uden signal.
test('assertSitemapHealth kaster paa for faa URL\'er i alt', () => {
  const faaUrls = Array.from({ length: MIN_TOTAL_SITEMAP_URLS - 1 }, (_, i) => ({ loc: `u${i}` }));
  const mappedEpisoder = [{ slug: 'mobland-tv2play' }];
  const unmappedEpisoder = Array.from({ length: MIN_UNMAPPED_EPISODE_URLS + 1 }, (_, i) => ({ loc: `u${i}` }));
  assert.throws(() => assertSitemapHealth(faaUrls, mappedEpisoder, unmappedEpisoder), /Sitemap-sundhedstjek fejlede/);
});

test('assertSitemapHealth kaster paa nul kortlagte afsnits-URL\'er, selv med rigeligt sitemap', () => {
  const mangeUrls = Array.from({ length: MIN_TOTAL_SITEMAP_URLS + 1 }, (_, i) => ({ loc: `u${i}` }));
  const unmappedEpisoder = Array.from({ length: MIN_UNMAPPED_EPISODE_URLS + 1 }, (_, i) => ({ loc: `u${i}` }));
  assert.throws(() => assertSitemapHealth(mangeUrls, [], unmappedEpisoder), /Sitemap-sundhedstjek fejlede/);
});

test('assertSitemapHealth kaster paa for faa ukortlagte afsnits-URL\'er, selv med rigeligt sitemap', () => {
  const mangeUrls = Array.from({ length: MIN_TOTAL_SITEMAP_URLS + 1 }, (_, i) => ({ loc: `u${i}` }));
  const mappedEpisoder = [{ slug: 'mobland-tv2play' }];
  const faaUnmappede = Array.from({ length: MIN_UNMAPPED_EPISODE_URLS - 1 }, (_, i) => ({ loc: `u${i}` }));
  assert.throws(() => assertSitemapHealth(mangeUrls, mappedEpisoder, faaUnmappede), /Sitemap-sundhedstjek fejlede/);
});

test('assertSitemapHealth kaster ikke, naar alle tre tal er over bunden', () => {
  const mangeUrls = Array.from({ length: MIN_TOTAL_SITEMAP_URLS + 1 }, (_, i) => ({ loc: `u${i}` }));
  const unmappedEpisoder = Array.from({ length: MIN_UNMAPPED_EPISODE_URLS + 1 }, (_, i) => ({ loc: `u${i}` }));
  assert.doesNotThrow(() => assertSitemapHealth(mangeUrls, [{ slug: 'mobland-tv2play' }], unmappedEpisoder));
});

test('nyeste lastmod først, så aktive serier kommer med i første kørsel', () => {
  const r = newestFirst([
    { loc: 'a', lastmod: '2024-01-01' },
    { loc: 'b', lastmod: '2026-10-20' },
    { loc: 'c', lastmod: '2025-06-06' },
  ]);
  assert.deepEqual(r.map((x) => x.loc), ['b', 'c', 'a']);
});

test('poster uden lastmod ryger bagerst, ikke forrest', () => {
  // Sitemappet har poster uden <lastmod>. Tom streng sorterer før alt andet
  // ved almindelig sammenligning, og de ville stjæle hele budgettet.
  const r = newestFirst([
    { loc: 'uden', lastmod: '' },
    { loc: 'med', lastmod: '2020-01-01' },
  ]);
  assert.deepEqual(r.map((x) => x.loc), ['med', 'uden']);
});

test('sorteringen ændrer ikke den oprindelige liste', () => {
  const ind = [{ loc: 'a', lastmod: '2024-01-01' }, { loc: 'b', lastmod: '2026-01-01' }];
  newestFirst(ind);
  assert.equal(ind[0].loc, 'a');
});

test('budgettet tager hele serier, aldrig en halv', () => {
  // Simon siger blev udgivet med 1 af 3 afsnit, fordi det tredje havde nyere
  // lastmod. En halv serie er et selvsikkert forkert svar.
  const e = (slug, loc, lastmod) => ({ slug, loc, lastmod });
  const due = dueThisRun([
    e('simon', 's1', '2026-10-08'), e('simon', 's2', '2026-10-08'), e('simon', 's3', '2026-10-12'),
    e('anden', 'a1', '2026-10-11'), e('anden', 'a2', '2026-10-11'),
  ], {}, 3);
  // "simon" er nyest (10-12) og fylder præcis budgettet; "anden" venter
  assert.deepEqual(due.map((x) => x.loc).sort(), ['s1', 's2', 's3']);
});

test('henter aldrig noget, der allerede staar i tilstanden', () => {
  const e = (slug, loc, lastmod) => ({ slug, loc, lastmod });
  const due = dueThisRun([e('a', 'a1', '2026-10-20'), e('b', 'b1', '2026-10-19')], { a1: '2026-10-20' }, 10);
  assert.deepEqual(due.map((x) => x.loc), ['b1']);
});

test('en paabegyndt serie goeres faerdig foer en ny begyndes', () => {
  // Foerste koersel udgav 89 halve serier. De ligger i appen og siger "5 afsnit"
  // om noget der har ni, indtil deres tur kommer efter lastmod. Det maa ikke ske.
  const e = (slug, loc, lastmod) => ({ slug, loc, lastmod });
  const due = dueThisRun([
    e('halv', '/serie/halv/1/b', '2020-01-01'),   // gammel, men paabegyndt
    e('frisk', '/serie/frisk/1/a', '2026-10-20'), // nyere, men urort
  ], { '/serie/halv/1/a': '2019-01-01' }, 1);
  assert.deepEqual(due.map((x) => x.slug), ['halv']);
});

test('en serie stoerre end budgettet tages alligevel, naar den staar foerst', () => {
  // Krejlerkongen har 672 afsnit. Sprang vi den over, ville den aldrig blive hentet.
  const e = (loc) => ({ slug: 'stor', loc, lastmod: '2026-10-20' });
  const due = dueThisRun([e('x1'), e('x2'), e('x3')], {}, 2);
  assert.equal(due.length, 3);
});

test('nyeste serie foerst, ikke nyeste afsnit', () => {
  const e = (slug, loc, lastmod) => ({ slug, loc, lastmod });
  const due = dueThisRun([
    e('gammel', 'g1', '2020-01-01'),
    e('ny', 'n1', '2026-10-20'),
  ], {}, 10);
  assert.deepEqual(due.map((x) => x.slug), ['ny', 'gammel']);
});
