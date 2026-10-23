import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchSeriesPage, seriesPages, siblingPages } from '../scripts/lib/seriespage.mjs';

// Rigtig forside hentet fra play.tv2.dk 23-10-2026. Afsnittene ligger under x-files-tv2play,
// men /serie/x-files-tv2play svarer 404 — forsiden findes kun som x-files-none.
const xfiles = () => readFileSync('fixtures/tv2play-serieside-x-files-none.html', 'utf8');

const sitemap = [
  { loc: 'https://play.tv2.dk/serie/x-files-none' },
  { loc: 'https://play.tv2.dk/serie/x-files-tv2play/11/my-struggle-iv-800fc761-1125-4010-8821-7b050acedfca' },
  { loc: 'https://play.tv2.dk/serie/the-x-files-disneyplus' },
  { loc: 'https://play.tv2.dk/serie/simon-siger-tv2' },
];

function fakeGet(pages) {
  const calls = [];
  const get = async (url) => {
    calls.push(url);
    const slug = url.split('/serie/')[1];
    if (slug in pages) return pages[slug];
    throw new Error(`${url} svarede 404`);
  };
  return { get, calls };
}

test('seriesPages finder kun forsider, ikke afsnit', () => {
  assert.deepEqual([...seriesPages(sitemap)].sort(), ['simon-siger-tv2', 'the-x-files-disneyplus', 'x-files-none']);
});

test('siblingPages: samme navnestart, men ikke en anden serie med længere navn', () => {
  const pages = seriesPages(sitemap);
  assert.deepEqual(siblingPages('x-files-tv2play', pages), ['x-files-none']);
  assert.deepEqual(siblingPages('simon-siger-tv2', pages), []); // har sin egen forside
});

test('henter sin egen forside, når den findes', async () => {
  const { get, calls } = fakeGet({ 'simon-siger-tv2': '<html>simon</html>' });
  const r = await fetchSeriesPage('simon-siger-tv2', 'Simon siger', seriesPages(sitemap), get);
  assert.deepEqual(r, { html: '<html>simon</html>', slug: 'simon-siger-tv2' });
  assert.equal(calls.length, 1);
});

test('ved 404 bruges søskende-forsiden, når navnet passer (X-Files)', async () => {
  const { get } = fakeGet({ 'x-files-none': xfiles() });
  const r = await fetchSeriesPage('x-files-tv2play', 'X-Files', seriesPages(sitemap), get);
  assert.equal(r.slug, 'x-files-none');
  assert.match(r.html, /X-Files/);
});

test('ved 404 afvises en søskende-forside med et andet navn', async () => {
  const { get } = fakeGet({ 'x-files-none': xfiles() });
  const r = await fetchSeriesPage('x-files-tv2play', 'X-Filerne: Noget andet', seriesPages(sitemap), get);
  assert.equal(r, null);
});

test('andre fejl end 404 kastes, så serien prøves igen næste nat', async () => {
  const get = async (url) => { throw new Error(`${url} svarede 500`); };
  await assert.rejects(fetchSeriesPage('x-files-tv2play', 'X-Files', seriesPages(sitemap), get), /500/);
});
