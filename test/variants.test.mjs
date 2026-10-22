import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { canonicalSlugs, consolidate } from '../scripts/lib/tv2shows.mjs';

const ep = (id, season, number, airdate = '2024-01-01') => ({ id, season, number, name: `Afsnit ${number}`, airdate });
const show = (slug, episodes, extra = {}) => ({
  id: `tv2play:${slug}`, name: 'Alene sammen', service: 'tv2', status: 'Unknown', tmdbId: null, next: null,
  description: null, image: null, episodes, ...extra,
});

test('canonicalSlugs: en kanal-udgave peger på -tv2play, når den findes', () => {
  const c = canonicalSlugs(['alene-sammen-tv2echo', 'alene-sammen-tv2play', 'anna-pihl-tv2', 'klovn-tv2play', 'oxen-tv2']);
  assert.equal(c.get('alene-sammen-tv2echo'), 'alene-sammen-tv2play');
  assert.equal(c.get('alene-sammen-tv2play'), 'alene-sammen-tv2play');
  assert.equal(c.get('anna-pihl-tv2'), 'anna-pihl-tv2'); // ingen -tv2play-udgave: står for sig selv
  assert.equal(c.get('oxen-tv2'), 'oxen-tv2');
});

// Målt 22-10-2026: i 71 af 80 par har kanal-udgaven afsnit, -tv2play ikke har (Alene sammen: 1 mod 31).
test('consolidate samler afsnittene under -tv2play, ét afsnit tælles én gang', () => {
  const canon = canonicalSlugs(['alene-sammen-tv2echo', 'alene-sammen-tv2play']);
  const out = consolidate({
    'alene-sammen-tv2play': show('alene-sammen-tv2play', [ep('p-1-1', 1, 1)]),
    'alene-sammen-tv2echo': show('alene-sammen-tv2echo', [ep('e-1-1', 1, 1), ep('e-1-2', 1, 2), ep('e-2-1', 2, 1)]),
  }, canon);
  const main = out.shows['alene-sammen-tv2play'];
  assert.equal(main.id, 'tv2play:alene-sammen-tv2play');
  assert.deepEqual(main.episodes.map((e) => e.id), ['p-1-1', 'e-1-2', 'e-2-1']);
});

test('kanal-udgavens fil bliver en kopi med sit eget id, så den, der følger den, ikke mister noget', () => {
  const canon = canonicalSlugs(['alene-sammen-tv2echo', 'alene-sammen-tv2play']);
  const out = consolidate({
    'alene-sammen-tv2play': show('alene-sammen-tv2play', [ep('p-1-1', 1, 1)]),
    'alene-sammen-tv2echo': show('alene-sammen-tv2echo', [ep('e-1-2', 1, 2)]),
  }, canon);
  const alias = out.shows['alene-sammen-tv2echo'];
  assert.equal(alias.id, 'tv2play:alene-sammen-tv2echo');
  assert.deepEqual(alias.episodes.map((e) => e.id), ['p-1-1', 'e-1-2']);
});

test('indekset og billedkortet har kun -tv2play-udgaven', () => {
  const canon = canonicalSlugs(['alfa-tv2echo', 'alfa-tv2play', 'oxen-tv2']);
  const out = consolidate({
    'alfa-tv2play': show('alfa-tv2play', [ep('a', 1, 1)], { name: 'Alfa' }),
    'alfa-tv2echo': show('alfa-tv2echo', [ep('b', 1, 2)], { name: 'Alfa', image: 'https://cdn-play.tv2i.dk/echo.jpg' }),
    'oxen-tv2': show('oxen-tv2', [ep('c', 1, 1)], { name: 'Oxen', tmdbId: 5 }),
  }, canon);
  assert.deepEqual(out.index, { 'alfa-tv2play': ['Alfa', null], 'oxen-tv2': ['Oxen', 5] });
  // -tv2play har intet billede, så kanal-udgavens bruges
  assert.deepEqual(out.images, { 'alfa-tv2play': 'https://cdn-play.tv2i.dk/echo.jpg' });
});

test('næste afsnit er den tidligste kendte dato; beskrivelse og billede foretrækker -tv2play', () => {
  const canon = canonicalSlugs(['x-tv2nord', 'x-tv2play']);
  const out = consolidate({
    'x-tv2play': show('x-tv2play', [ep('a', 1, 1)], { next: '2026-11-05', description: 'Fra tv2play', image: 'https://cdn-play.tv2i.dk/p.jpg' }),
    'x-tv2nord': show('x-tv2nord', [ep('b', 1, 2)], { next: '2026-10-29', description: 'Fra nord', image: 'https://cdn-play.tv2i.dk/n.jpg' }),
  }, canon);
  const m = out.shows['x-tv2play'];
  assert.equal(m.next, '2026-10-29');
  assert.equal(m.status, 'Running');
  assert.equal(m.description, 'Fra tv2play');
  assert.equal(m.image, 'https://cdn-play.tv2i.dk/p.jpg');
});

test('kun kanal-udgaven er hentet indtil videre: den bliver til -tv2play-serien', () => {
  const canon = canonicalSlugs(['bad-blood-skyshowtime', 'bad-blood-tv2play']);
  const out = consolidate({ 'bad-blood-skyshowtime': show('bad-blood-skyshowtime', [ep('s', 1, 1)], { name: 'Bad Blood', service: 'skyshowtime' }) }, canon);
  // Indholdet er SkyShowtimes, også under -tv2play-adressen: det kræver tilkøbet
  assert.equal(out.shows['bad-blood-tv2play'].service, 'skyshowtime');
  assert.equal(out.shows['bad-blood-tv2play'].id, 'tv2play:bad-blood-tv2play');
  assert.deepEqual(out.index, { 'bad-blood-tv2play': ['Bad Blood', null] });
});

// Ryan 22-10-2026: tre serier stod stadig to gange i søgningen, fordi ingen af udgaverne var
// -tv2play (fx jo-faerre-jo-bedre-tv2 og -tv2charlie). Uden en -tv2play samles udgaver med
// samme titel under den med flest afsnit.
test('canonicalSlugs: uden -tv2play samles samme titel under udgaven med flest afsnit', () => {
  const info = {
    'jo-faerre-jo-bedre-tv2': { name: 'Jo færre jo bedre', episodes: 108 },
    'jo-faerre-jo-bedre-tv2charlie': { name: 'Jo færre jo bedre', episodes: 2 },
    'laban-det-lille-spoegelse-cmore': { name: 'Laban - Det lille spøgelse', episodes: 6 },
    'laban-det-lille-spoegelse-oiii': { name: 'Laban det lille spøgelse', episodes: 18 },
  };
  const c = canonicalSlugs(Object.keys(info), info);
  assert.equal(c.get('jo-faerre-jo-bedre-tv2charlie'), 'jo-faerre-jo-bedre-tv2');
  assert.equal(c.get('jo-faerre-jo-bedre-tv2'), 'jo-faerre-jo-bedre-tv2');
  assert.equal(c.get('laban-det-lille-spoegelse-cmore'), 'laban-det-lille-spoegelse-oiii');
});

test('canonicalSlugs: forskellige titler med samme slug-start samles ikke', () => {
  const info = {
    'bonderoeven-tv2': { name: 'Bonderøven', episodes: 40 },
    'bonderoeven-tv2fri': { name: 'Bonderøven i Sverige', episodes: 8 },
  };
  const c = canonicalSlugs(Object.keys(info), info);
  assert.equal(c.get('bonderoeven-tv2fri'), 'bonderoeven-tv2fri');
});

test('canonicalSlugs: -tv2play vinder stadig, også over en udgave med flere afsnit', () => {
  const info = {
    'alfa-tv2play': { name: 'Alfa', episodes: 3 },
    'alfa-tv2echo': { name: 'Alfa', episodes: 30 },
  };
  assert.equal(canonicalSlugs(Object.keys(info), info).get('alfa-tv2echo'), 'alfa-tv2play');
});
