import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertSitemapHealth, changedSince, episodeUrls, MIN_TOTAL_SITEMAP_URLS, parseSitemap,
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
  assert.throws(() => assertSitemapHealth(faaUrls, mappedEpisoder), /Sitemap-sundhedstjek fejlede/);
});

test('assertSitemapHealth kaster paa nul kortlagte afsnits-URL\'er, selv med rigeligt sitemap', () => {
  const mangeUrls = Array.from({ length: MIN_TOTAL_SITEMAP_URLS + 1 }, (_, i) => ({ loc: `u${i}` }));
  assert.throws(() => assertSitemapHealth(mangeUrls, []), /Sitemap-sundhedstjek fejlede/);
});

test('assertSitemapHealth kaster ikke, naar begge tal er over bunden', () => {
  const mangeUrls = Array.from({ length: MIN_TOTAL_SITEMAP_URLS + 1 }, (_, i) => ({ loc: `u${i}` }));
  assert.doesNotThrow(() => assertSitemapHealth(mangeUrls, [{ slug: 'mobland-tv2play' }]));
});
