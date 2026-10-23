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
  assert.deepEqual(extractSeries('<html><body>intet</body></html>'), { name: null, description: null, image: null });
});
