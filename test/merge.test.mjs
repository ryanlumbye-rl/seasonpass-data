import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeOverrides } from '../scripts/lib/merge.mjs';
import { buildEntries } from '../scripts/lib/build.mjs';

const gen = (date) => ({
  'tvmaze:75026': {
    title: 'Mobland', service: 'tv2', source: 'scraper', note: 'Hentet fra TV 2 Plays schema.org',
    seasons: { 2: { episodes: 1, release: date, pattern: 'explicit', episodeOverrides: { 5: { release: date } } } },
  },
});
const file = (shows) => ({ version: 1, updated: '2026-10-01T00:00:00Z', shows });

// Review Focus 5
test('overskriver ALDRIG en manuel post', () => {
  const manual = { title: 'Mobland', service: 'tv2', source: 'manual', note: 'Tjekket i haanden 16-10-2026', seasons: {} };
  const r = mergeOverrides(file({ 'tvmaze:75026': manual }), gen('2026-10-19'), '2026-10-17');
  assert.deepEqual(r.next.shows['tvmaze:75026'], manual);
  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.skipped, ['tvmaze:75026']);
});

test('skriver en ny post', () => {
  const r = mergeOverrides(file({}), gen('2026-10-19'), '2026-10-17');
  assert.deepEqual(r.changed, ['tvmaze:75026']);
  assert.equal(r.next.shows['tvmaze:75026'].seasons[2].episodeOverrides[5].release, '2026-10-19');
});

test('skriver kun naar noget faktisk er aendret', () => {
  const first = mergeOverrides(file({}), gen('2026-10-19'), '2026-10-17');
  const again = mergeOverrides(first.next, gen('2026-10-19'), '2026-10-18');
  assert.deepEqual(again.changed, []);
  assert.equal(again.next.updated, first.next.updated, 'updated maa ikke flytte sig uden aendringer');
});

test('opdaterer updated naar noget aendres', () => {
  const first = mergeOverrides(file({}), gen('2026-10-19'), '2026-10-17');
  const moved = mergeOverrides(first.next, gen('2026-10-26'), '2026-10-18');
  assert.deepEqual(moved.changed, ['tvmaze:75026']);
  assert.match(moved.next.updated, /^2026-10-18/);
});

test('rører ikke poster, generatoren ikke har data for', () => {
  const other = { title: 'Andet', service: 'tv2', source: 'scraper', note: 'fra en tidligere koersel', seasons: {} };
  const r = mergeOverrides(file({ 'tvmaze:1': other }), gen('2026-10-19'), '2026-10-17');
  assert.deepEqual(r.next.shows['tvmaze:1'], other);
});

// F2: en delmaengde (changedSince giver kun det, der har flyttet sig) maa ikke
// overskrive en hel saeson, en tidligere koersel allerede har fundet.
test('en delvis koersel sletter ikke tidligere fundne afsnit i samme saeson', () => {
  const full = {
    title: 'Mobland', service: 'tv2', source: 'scraper', note: 'Hentet fra TV 2 Plays schema.org',
    seasons: {
      2: {
        episodes: 2, release: '2026-09-28', pattern: 'explicit',
        episodeOverrides: { 2: { release: '2026-09-28' }, 5: { release: '2026-10-19' } },
      },
    },
  };
  const partial = {
    'tvmaze:75026': {
      title: 'Mobland', service: 'tv2', source: 'scraper', note: 'Hentet fra en senere koersel',
      seasons: { 2: { episodes: 1, release: '2026-10-26', pattern: 'explicit', episodeOverrides: { 6: { release: '2026-10-26' } } } },
    },
  };
  const r = mergeOverrides(file({ 'tvmaze:75026': full }), partial, '2026-10-18');
  const s = r.next.shows['tvmaze:75026'].seasons[2];
  assert.deepEqual(Object.keys(s.episodeOverrides), ['2', '5', '6']);
  assert.equal(s.release, '2026-09-28');
  assert.equal(s.episodes, 3);
});

// I2: det gamle tjek var `current?.source === 'manual'` — fail-open, fordi
// alt andet end netop det ene ord talte som "scraper-ejet" og kunne
// overskrives. En post uden `source` overhovedet (en skrivefejl, en
// håndskrevet post uden feltet) skal beskyttes ligesom en rigtig manuel post.
test('I2: en post uden source-felt overskrives ikke (default-deny, ikke default-destroy)', () => {
  const noSource = { title: 'Mobland', service: 'tv2', note: 'glemte at saette source', seasons: {} };
  const r = mergeOverrides(file({ 'tvmaze:75026': noSource }), gen('2026-10-19'), '2026-10-17');
  assert.deepEqual(r.next.shows['tvmaze:75026'], noSource);
  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.skipped, ['tvmaze:75026']);
});

test('I2: en fejlstavet source ("Manual") overskrives ikke', () => {
  const misspelled = { title: 'Mobland', service: 'tv2', source: 'Manual', note: 'tjekket i haanden', seasons: {} };
  const r = mergeOverrides(file({ 'tvmaze:75026': misspelled }), gen('2026-10-19'), '2026-10-17');
  assert.deepEqual(r.next.shows['tvmaze:75026'], misspelled);
  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.skipped, ['tvmaze:75026']);
});

// I2: merge.mjs rebyggede tidligere objekter felt for felt paa tre niveauer
// (top, show, saeson), saa et felt, koden ikke selv kendte til, blev tabt
// stille ved naeste koersel. Nu spredes det eksisterende objekt ind i stedet
// for at blive genopbygget, saa et ukendt felt paa hvert niveau overlever.
test('I2: et ukendt felt paa top-niveau overlever en flet', () => {
  const existing = { ...file({}), genereretAf: 'en menneskelig note, koden ikke kender' };
  const r = mergeOverrides(existing, gen('2026-10-19'), '2026-10-17');
  assert.equal(r.next.genereretAf, 'en menneskelig note, koden ikke kender');
});

test('I2: et ukendt felt paa serie-niveau overlever en flet af en scraper-ejet post', () => {
  const current = {
    title: 'Mobland', service: 'tv2', source: 'scraper', note: 'Hentet fra TV 2 Plays schema.org',
    verified: '2026-10-18', // en menneskelig annotation paa en scraper-ejet post
    seasons: { 2: { episodes: 1, release: '2026-09-28', pattern: 'explicit', episodeOverrides: { 2: { release: '2026-09-28' } } } },
  };
  const r = mergeOverrides(file({ 'tvmaze:75026': current }), gen('2026-10-19'), '2026-10-17');
  assert.equal(r.next.shows['tvmaze:75026'].verified, '2026-10-18');
});

test('I2: et ukendt felt paa saeson-niveau overlever en flet', () => {
  const current = {
    title: 'Mobland', service: 'tv2', source: 'scraper', note: 'Hentet fra TV 2 Plays schema.org',
    seasons: {
      2: {
        episodes: 1, release: '2026-09-28', pattern: 'explicit',
        episodeOverrides: { 2: { release: '2026-09-28' } },
        kommentar: 'en note om saesonen, koden ikke kender',
      },
    },
  };
  const r = mergeOverrides(file({ 'tvmaze:75026': current }), gen('2026-10-19'), '2026-10-17');
  assert.equal(r.next.shows['tvmaze:75026'].seasons[2].kommentar, 'en note om saesonen, koden ikke kender');
});

// I3: buildEntries' faktiske rækkefølge (title, source, note, seasons,
// service — service tilføjes efter loopet) matcher ikke mergeShow's (title,
// service, source, note, seasons). Alle andre merge-fixtures er
// håndskrevet i mergeShow's rækkefølge, saa denne er den eneste test, der
// reelt motionerer canonicalJSON paa den vej, hvor den er load-bearing: uden
// den ville en reordering-only diff ramme den fil, ejeren tjekker i haanden,
// hver dag. Testen skal fejle, hvis canonicalJSON reduceres til et rent
// JSON.stringify.
test('I3: samme data genereret igen giver INGEN aendring, selv naar feltraekkefoelgen er forskellig', () => {
  const { entries } = buildEntries(
    [
      { slug: 'mobland-tv2play', episode: { series: 'Mobland', season: 2, episode: 5, date: '2026-10-19', name: 'A' } },
    ],
    { 'mobland-tv2play': 75026 },
  );
  const existing = file(entries);
  const r = mergeOverrides(existing, entries, '2026-10-18');
  assert.deepEqual(r.changed, [], 'identisk data, bare i en anden feltraekkefoelge, er ikke en aendring');
});

// Minor 11: begge de haandverificerede serier er "manual", saa generatoren
// henter og udtraekker den sande dato hver koersel og smider den vaek i dag
// — med kun en log-linje om, at posten er sprunget over. Her er det den fil,
// appen stoler mest paa, der har ingen automatisk kontrol. Naar den
// indkommende scrapede dato for samme saeson+afsnit er forskellig fra det,
// filen implicerer (via "weekly"-moensteret), skal det rapporteres —
// UDEN at filen aendres.
test('Minor 11: en forkert manuel dato rapporteres som staleManual, men filen aendres ikke', () => {
  const manual = {
    title: 'Mobland', service: 'tv2', source: 'manual', note: 'Tjekket i haanden 16-10-2026',
    seasons: { 2: { episodes: 10, release: '2026-09-21', pattern: 'weekly' } },
  };
  // Episode 6 under "weekly" fra 2026-09-21 skulle lande 2026-10-26 (5 uger
  // efter afsnit 1), men TV 2 Play rapporterer nu 2026-11-02 — en uge for sent.
  const incoming = {
    'tvmaze:75026': {
      title: 'Mobland', service: 'tv2', source: 'scraper', note: 'Hentet fra TV 2 Plays schema.org',
      seasons: { 2: { episodes: 1, release: '2026-11-02', pattern: 'explicit', episodeOverrides: { 6: { release: '2026-11-02' } } } },
    },
  };
  const r = mergeOverrides(file({ 'tvmaze:75026': manual }), incoming, '2026-10-18');
  assert.deepEqual(r.next.shows['tvmaze:75026'], manual, 'filen maa ikke aendres for en manuel post');
  assert.deepEqual(r.skipped, ['tvmaze:75026']);
  assert.equal(r.staleManual.length, 1);
  assert.deepEqual(r.staleManual[0], {
    key: 'tvmaze:75026', season: '2', episode: '6', fileDate: '2026-10-26', scrapedDate: '2026-11-02',
  });
});

test('Minor 11: en manuel dato, der STEMMER overens, giver ingen staleManual-rapport', () => {
  const manual = {
    title: 'Mobland', service: 'tv2', source: 'manual', note: 'Tjekket i haanden 16-10-2026',
    seasons: { 2: { episodes: 10, release: '2026-09-21', pattern: 'weekly' } },
  };
  const incoming = {
    'tvmaze:75026': {
      title: 'Mobland', service: 'tv2', source: 'scraper', note: 'Hentet fra TV 2 Plays schema.org',
      seasons: { 2: { episodes: 1, release: '2026-10-19', pattern: 'explicit', episodeOverrides: { 5: { release: '2026-10-19' } } } },
    },
  };
  const r = mergeOverrides(file({ 'tvmaze:75026': manual }), incoming, '2026-10-18');
  assert.deepEqual(r.staleManual, []);
});
