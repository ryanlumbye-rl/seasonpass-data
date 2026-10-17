#!/usr/bin/env node
/**
 * Henter danske afsnitsdatoer fra TV 2 Plays egen schema.org og fletter dem ind
 * i overrides.json. Høflig af design: kun sider hvis lastmod har flyttet sig,
 * én forespørgsel ad gangen, og en pause imellem.
 *
 * Kør tørt med:  node scripts/tv2play.mjs --dry-run
 */
import { writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { assertSitemapHealth, changedSince, episodeUrls, parseSitemap } from './lib/sitemap.mjs';
import { extractEpisode } from './lib/jsonld.mjs';
import { buildEntries, buildUnmatched, limitUnmatched } from './lib/build.mjs';
import { canonicalJSON, mergeOverrides } from './lib/merge.mjs';
import { readJson } from './lib/io.mjs';

const UA = 'SeasonPass-data/1.0 (+https://github.com/ryanlumbye-rl/seasonpass-data)';
const INDEX = 'https://play.tv2.dk/vp_sitemaps/sitemap-index.xml.gz';
const PAUSE = 500;
const DRY = process.argv.includes('--dry-run');
const UNMATCHED_CAP = 50;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { gzip = false } = {}) {
  // Et timeout, så en hængende forespørgsel ikke kan stalle jobbet op til
  // GitHubs seks-timers grænse — try/catch nedenfor fanger kun fejl, ikke hang.
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url} svarede ${res.status}`);
  return gzip ? gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8') : res.text();
}

async function main() {
  const mapping = readJson('mappings/tv2play.json', {});
  const state = readJson('state/tv2play-lastmod.json', {});
  // Egen tilstandsfil for ukendte serier (Fix A): en serie, der senere bliver
  // tilføjet til mappings/tv2play.json, skal IKKE se "allerede set uændret" ud,
  // bare fordi den en gang optrådte i en tidligere ukendt-rapport.
  const unmatchedState = readJson('state/tv2play-unmatched-lastmod.json', {});
  const overrides = readJson('overrides.json', { version: 1, shows: {} });
  const existingUnmatched = readJson('unmatched.json', {});

  const index = await get(INDEX, { gzip: true });
  const parts = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  console.log(`sitemap-index: ${parts.length} dele`);

  const all = [];
  for (const part of parts) {
    await sleep(PAUSE);
    all.push(...parseSitemap(await get(part, { gzip: part.endsWith('.gz') })));
  }
  console.log(`URL'er i alt: ${all.length}`);

  const episodes = episodeUrls(all);
  const mine = episodes.filter((e) => mapping[e.slug]);
  const unmapped = episodes.filter((e) => !mapping[e.slug]);

  // Falder sitemap'et eller sideformatet fra hinanden (TV 2 omlægger stier,
  // fjerner GUID'et, eller omorganiserer <url>/<loc>), går tællingerne mod
  // nul, PR-trinnet no-op'er, og jobbet lukker grønt — for evigt, uden signal.
  // Fejl højlydt her i stedet.
  assertSitemapHealth(all, mine);

  const todo = changedSince(mine, state);
  console.log(`afsnit vi følger: ${mine.length}, heraf ændret siden sidst: ${todo.length}`);

  const found = [];
  for (const e of todo) {
    await sleep(PAUSE);
    try {
      const episode = extractEpisode(await get(e.loc));
      if (episode) { found.push({ slug: e.slug, episode }); state[e.loc] = e.lastmod; }
      else console.warn(`ingen brugbar schema.org: ${e.loc}`);
    } catch (err) {
      console.warn(`kunne ikke hentes: ${e.loc} — ${err.message}`);
    }
  }
  console.log(`afsnit med dato: ${found.length}`);

  // Fix A/B (runde 2): ukendte serier, der er dukket op eller ændret sig siden
  // sidst. Ingen ekstra hentninger — slug og sæsonsti kommer alene fra
  // sitemap'et, som vi allerede har i hukommelsen. Tilstanden er nøglet pr.
  // slug (ikke pr. URL), så filen bliver tusinder, ikke titusinder, rækker —
  // og er tilstanden tom (første kørsel), tier buildUnmatched stille, så hele
  // TV 2 Plays eksisterende katalog ikke ser "ændret" ud på én gang.
  const { report: newlyUnmatched, nextState: nextUnmatchedState } = buildUnmatched(unmapped, unmatchedState);
  console.log(`ukendte serier med ændringer siden sidst: ${Object.keys(newlyUnmatched).length}`);

  const { entries } = buildEntries(found, mapping);
  // unmatched.json akkumuleres ligesom overrides.json: en kørsel ser kun det,
  // der er ændret, så erstattes filen med bare det, forsvinder alt, en
  // tidligere kørsel fandt. Vi starter derfor fra det, der allerede ligger på
  // disk, lægger denne kørsels fund ovenpå, og fjerner de slugs, der i
  // mellemtiden er blevet kortlagt (de hører til et andet sted nu).
  const accumulatedUnmatched = Object.fromEntries(
    Object.entries({ ...existingUnmatched, ...newlyUnmatched })
      .filter(([slug]) => !mapping[slug]),
  );
  // Fix C (runde 2): uden en grænse kunne en samlet lastmod-opdatering på
  // TV 2 Plays side genoplive hele floden fra første kørsel. De 50 nyeste
  // overlever; resten tælles og logges, så det ikke sker i stilhed.
  const { kept: unmatched, omitted: unmatchedOmitted } = limitUnmatched(accumulatedUnmatched, UNMATCHED_CAP);

  const today = new Date().toISOString().slice(0, 10);
  const { next, changed, skipped, staleManual } = mergeOverrides(overrides, entries, today);

  console.log(`ændrede poster: ${changed.length ? changed.join(', ') : 'ingen'}`);
  if (skipped.length) console.log(`sprunget over, fordi de er manuelle: ${skipped.join(', ')}`);
  // Minor 11: filen røres aldrig for en manuel post, men en uoverensstemmelse
  // mellem den og det, TV 2 Play nu rapporterer, skal lyde højt et sted et
  // menneske ser det — her i jobbets log.
  if (staleManual.length) {
    console.warn('ADVARSEL: manuel post ser forkert ud ifølge TV 2 Play (filen er IKKE ændret):');
    for (const s of staleManual) {
      console.warn(`  ${s.key} sæson ${s.season} afsnit ${s.episode}: filen siger ${s.fileDate}, TV 2 Play siger nu ${s.scrapedDate}`);
    }
  }
  if (Object.keys(unmatched).length) console.log(`uden match: ${Object.keys(unmatched).length} serier, se unmatched.json`);
  if (unmatchedOmitted) console.log(`${unmatchedOmitted} ukendte serier udeladt af unmatched.json (grænse ${UNMATCHED_CAP}, nyeste bevares)`);

  if (DRY) { console.log('tørkørsel: intet skrevet'); return; }

  // Fix C (runde 1): state/-filerne skrives ubetinget — deres indhold ændrer
  // sig legitimt ved hver kørsel. overrides.json og unmatched.json skrives
  // kun, når der reelt er noget nyt, så en hånd-skrevet, stabil fil ikke får
  // en daglig git-diff af ren omformatering.
  writeFileSync('state/tv2play-lastmod.json', `${JSON.stringify(state, null, 2)}\n`);
  writeFileSync('state/tv2play-unmatched-lastmod.json', `${JSON.stringify(nextUnmatchedState, null, 2)}\n`);

  if (changed.length) {
    writeFileSync('overrides.json', `${JSON.stringify(next, null, 2)}\n`);
  } else {
    console.log('overrides.json: ingen ændringer, skriver ikke');
  }

  if (canonicalJSON(existingUnmatched) !== canonicalJSON(unmatched)) {
    writeFileSync('unmatched.json', `${JSON.stringify(unmatched, null, 2)}\n`);
  } else {
    console.log('unmatched.json: ingen ændringer, skriver ikke');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
