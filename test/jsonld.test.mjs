import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractEpisode } from '../scripts/lib/jsonld.mjs';

const page = () => readFileSync('fixtures/tv2play-episode.html', 'utf8');

test('tager saeson, afsnit og dato fra en rigtig side', () => {
  assert.deepEqual(extractEpisode(page()), {
    series: 'Mobland', season: 2, episode: 5, name: 'Birdland', date: '2026-10-19',
  });
});

// Review Focus 2: saesonstien i URL'en kan vaere et aarstal. Tallet skal komme fra schema.org.
test('bruger seasonNumber fra schema.org og ikke fra URL-stien', () => {
  const html = page().replace('"seasonNumber":2', '"seasonNumber":7');
  assert.equal(extractEpisode(html).season, 7);
});

// Review Focus 3: containsSeason maa gerne vaere en liste.
test('tager containsSeason som liste', () => {
  const html = page().replace(
    /"containsSeason":\{(.*?)\},"numberOfSeasons"/s,
    '"containsSeason":[{$1}],"numberOfSeasons"',
  );
  assert.equal(extractEpisode(html).episode, 5);
});

// Review Focus 4: indhold uden dato skal springes over, ikke skrive undefined videre.
test('giver null, naar datePublished mangler', () => {
  assert.equal(extractEpisode(page().replace('"datePublished":"2026-10-19"', '"x":1')), null);
});

test('giver null for en side uden brugbar schema.org', () => {
  assert.equal(extractEpisode('<html><body>ingenting</body></html>'), null);
  assert.equal(extractEpisode('<script type="application/ld+json">{ ikke json </script>'), null);
});
