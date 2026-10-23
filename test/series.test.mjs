import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractSeries } from '../scripts/lib/jsonld.mjs';

// Hele, rigtige seriesider hentet fra play.tv2.dk 22-10-2026.
const skadestue = () => readFileSync('fixtures/tv2play-serieside-24-timer.html', 'utf8');
const krejler = () => readFileSync('fixtures/tv2play-serieside-krejlerkongen.html', 'utf8');

test('tager seriens egen beskrivelse fra schema.org, ikke og:description-reklamen', () => {
  const s = extractSeries(krejler());
  assert.match(s.description, /^Lasse Rimmer er vært, når to hold kendte danskere/);
  assert.doesNotMatch(s.description, /Prøv TV 2 Play nu/);
});

test('tager billedet i en større udgave end sidens 720 px', () => {
  const s = extractSeries(krejler());
  assert.match(s.image, /^https:\/\/cdn-play\.tv2i\.dk\/69335a40-4238-463e-b2dc-b52546f18676\.jpg\?/);
  assert.match(s.image, /[?&]w=1280(&|$)/);
  assert.match(s.image, /rect=0%2C0%2C3887%2C2160/); // beskæringen bevares
});

test('virker også på en anden serie: 24 timer på skadestuen', () => {
  const s = extractSeries(skadestue());
  assert.match(s.description, /^Kom tæt på den hektiske hverdag på skadestuen St\. George/);
  assert.match(s.image, /^https:\/\/cdn-play\.tv2i\.dk\/280d3b1b-c37c-4fa0-8090-2b9966fcea2f\.jpg\?.*w=1280/);
});

test('giver null-felter for en side uden TVSeries, i stedet for at kaste', () => {
  assert.deepEqual(extractSeries('<html><body>intet</body></html>'), { name: null, description: null, image: null, poster: null, titleArt: null });
});

// Plakat og titelart (Ryan 23-10-2026): uden dem stod en TV 2 Play-serie som et tomt kort under
// "Kommer snart". TV 2's eget stående mobilformat (r2x3) er et udsnit af seriens billede.
const xfiles = () => readFileSync('fixtures/tv2play-serieside-x-files-none.html', 'utf8');

test('tager TV 2s stående plakat (r2x3) af seriens eget billede', () => {
  const s = extractSeries(krejler());
  assert.match(s.poster, /^https:\/\/cdn-play\.tv2i\.dk\/69335a40-4238-463e-b2dc-b52546f18676\.jpg\?/);
  assert.match(s.poster, /ar=2%3A3/);
  assert.match(s.poster, /[?&]w=600(&|$)/);
  assert.match(extractSeries(xfiles()).poster, /6306afa0-ddec-304d-a5c5-7ea6fdbebe92/);
});

test('tager titelarten, når TV 2 har en', () => {
  assert.match(extractSeries(krejler()).titleArt, /^https:\/\/cdn-play\.tv2i\.dk\/4a234ab8-cb64-43d5-8439-e8c006e74b4f\.png/);
  assert.match(extractSeries(xfiles()).titleArt, /179c09fe-4de9-3892-8fb7-0b8d34cacaf1/);
});

test('ingen titelart på 24 timer på skadestuen: null, ikke en tom streng', () => {
  const s = extractSeries(skadestue());
  assert.equal(s.titleArt, null);
  assert.match(s.poster, /280d3b1b-c37c-4fa0-8090-2b9966fcea2f/);
});
