import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { extractHint, parseHint } from '../scripts/lib/hint.mjs';

// Formen i siden, målt 21-10-2026 på play.tv2.dk/serie/simon-siger-tv2
// Samme escaping som TV 2 Plays egen side: ét backslash foran hvert anførselstegn.
const side = (v) => `<script>self.__next_f.push([1,"...\\"infoHint\\":${v},\\"title\\":..."])</script>`;

test('læser strengen ud af den rigtige sides escaping', () => {
  // Fiksturet er et trimmet udsnit af play.tv2.dk/serie/simon-siger-tv2 (21-10-2026).
  // Det er testens anker: et håndskrevet fikstur kom engang til at bruge en anden
  // escaping end siden selv, og så fandt koden null på virkeligheden med grøn test.
  assert.equal(extractHint(readFileSync('fixtures/tv2play-serieside.html', 'utf8')), 'Ny episode på lørdag');
});

test('ingen hint når feltet er null eller mangler', () => {
  assert.equal(extractHint(side('null')), null);
  assert.equal(extractHint('<html>uden feltet</html>'), null);
});

test('ugedag bliver den næste forekomst strengt efter i dag', () => {
  // onsdag 2026-10-21
  assert.deepEqual(parseHint('Ny episode på lørdag', '2026-10-21'), { date: '2026-10-24' });
  // samme ugedag som i dag betyder om en uge, ikke i dag
  assert.deepEqual(parseHint('Ny episode på onsdag', '2026-10-21'), { date: '2026-10-28' });
});

test('ugedag hen over et månedsskift', () => {
  assert.deepEqual(parseHint('Ny episode på mandag', '2026-10-29'), { date: '2026-11-02' });
});

test('"naeste ugedag" er ugen efter, ikke den kommende', () => {
  // Ryan, 21-10-2026: "Naeste onsdag er onsdag i naeste uge." Formen optraeder
  // kun paa selve udgivelsesdagen — Doc Martin viste den 21-10 — men betydningen
  // er ugen efter, ogsaa hvis den dukker op paa en anden dag.
  // 2026-10-21 er en onsdag.
  assert.deepEqual(parseHint('Ny episode på næste onsdag', '2026-10-21'), { date: '2026-10-28' });
  assert.deepEqual(parseHint('Ny episode på næste onsdag', '2026-10-19'), { date: '2026-10-28' });
  assert.deepEqual(parseHint('Ny episode på næste mandag', '2026-10-21'), { date: '2026-10-26' });
  // Soendag slutter den danske uge, saa "naeste soendag" ligger sidst
  assert.deepEqual(parseHint('Ny episode på næste søndag', '2026-10-21'), { date: '2026-11-01' });
});

test('i morgen', () => {
  assert.deepEqual(parseHint('Ny episode i morgen', '2026-10-31'), { date: '2026-11-01' });
});

test('eksplicit dato — året udledes, så det altid ligger foran', () => {
  assert.deepEqual(parseHint('Ny episode 4. november', '2026-10-21'), { date: '2026-11-04' });
  assert.deepEqual(parseHint('Ny episode 4. januar', '2026-12-28'), { date: '2027-01-04' });
});

test('ny sæson tæller også', () => {
  assert.deepEqual(parseHint('Ny sæson på mandag', '2026-10-21'), { date: '2026-10-26' });
});

test('ingen kommende afsnit', () => {
  assert.equal(parseHint(null, '2026-10-21'), null);
});

test('en form vi ikke kender bliver aldrig gættet', () => {
  assert.deepEqual(parseHint('Ny episode snart', '2026-10-21'), { unparsed: 'Ny episode snart' });
  assert.deepEqual(parseHint('Sidste afsnit nu', '2026-10-21'), { unparsed: 'Sidste afsnit nu' });
});
