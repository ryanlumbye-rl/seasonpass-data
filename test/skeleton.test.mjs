import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('mapping-filen peger flere slugs paa samme serie', () => {
  const m = JSON.parse(readFileSync('mappings/tv2play.json', 'utf8'));
  assert.equal(m['mobland-skyshowtime'], m['mobland-tv2play']);
  assert.equal(m['mobland-tv2play'], 75026);
});

test('fixtures findes og indeholder det vi tester paa', () => {
  assert.match(readFileSync('fixtures/tv2play-episode.html', 'utf8'), /datePublished/);
  assert.match(readFileSync('fixtures/tv2play-sitemap.xml', 'utf8'), /lastmod/);
});
