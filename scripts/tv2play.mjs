#!/usr/bin/env node
/**
 * Henter danske afsnitsdatoer fra TV 2 Plays egen schema.org og fletter dem ind
 * i overrides.json. Høflig af design: kun sider hvis lastmod har flyttet sig,
 * én forespørgsel ad gangen, og en pause imellem.
 *
 * Kør tørt med:  node scripts/tv2play.mjs --dry-run
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { assertSitemapHealth, changedSince, dueThisRun, episodeUrls, parseSitemap } from './lib/sitemap.mjs';
import { extractEpisode } from './lib/jsonld.mjs';
import { extractHint, parseHint } from './lib/hint.mjs';
import { isSupported } from './lib/scope.mjs';
import { buildTv2Shows } from './lib/tv2shows.mjs';
import { buildEntries, buildUnmatched } from './lib/build.mjs';
import { canonicalJSON, mergeOverrides } from './lib/merge.mjs';
import { readJson } from './lib/io.mjs';

const UA = 'SeasonPass-data/1.0 (+https://github.com/ryanlumbye-rl/seasonpass-data)';
const INDEX = 'https://play.tv2.dk/vp_sitemaps/sitemap-index.xml.gz';
const PAUSE = 500;
// Kørslen 21-10-2026 nåede omkring ét afsnit i sekundet, så 15.000 er cirka
// fire timer. Med ~27.000 afsnit i kataloget er det fyldt op på to nætter;
// derefter henter changedSince kun nattens ændringer, og en kørsel tager minutter.
// Nyeste lastmod tages først, så aktive serier kommer før bagkataloget.
const FETCH_BUDGET = 15000;
// Rammer workflowets timeout-minutes, dræbes kørslen, før tilstanden skrives,
// og hele nattens hentning er tabt. Derfor stopper løkken selv i god tid og
// gemmer det, den nåede. Skal ligge et godt stykke under timeout-minutes (330):
// serieforsiderne og skrivningen kommer bagefter.
const FETCH_DEADLINE_MS = 270 * 60 * 1000;
const DRY = process.argv.includes('--dry-run');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { gzip = false } = {}) {
  // Et timeout, så en hængende forespørgsel ikke kan stalle jobbet op til
  // GitHubs seks-timers grænse — try/catch nedenfor fanger kun fejl, ikke hang.
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url} svarede ${res.status}`);
  return gzip ? gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8') : res.text();
}

async function main() {
  const started = Date.now();
  const mapping = readJson('mappings/tv2play.json', {});
  const state = readJson('state/tv2play-lastmod.json', {});
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
  assertSitemapHealth(all, mine, unmapped);

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

  // unmatched.json viser hele arbejdslisten, hver kørsel: alle ukendte
  // serier, ikke kun dem der har flyttet sig siden sidst. Ingen ekstra
  // hentninger — slug og sæsonsti kommer alene fra sitemap'et, som vi
  // allerede har i hukommelsen.
  const { report: unmatched } = buildUnmatched(unmapped);

  const { entries } = buildEntries(found, mapping);

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

  // TV 2 Play-udgivelsen: afsnit uden TVmaze-mapping, som appen alligevel vil
  // vise (isSupported), hentet under samme budget og høflighed som ovenfor.
  const supportedUnmapped = unmapped.filter((e) => isSupported(e.slug));
  const unmappedTodo = dueThisRun(supportedUnmapped, state, FETCH_BUDGET);
  console.log(`ukortlagte, understøttede afsnit: ${supportedUnmapped.length}, heraf taget af budgettet: ${unmappedTodo.length}`);

  const found2 = [];
  // En kørsel under fuldt budget tager timer, og loggen skriver
  // ellers kun, når noget går galt. En tavs kørsel kan ikke skelnes fra en død
  // kørsel, så den melder fremdrift undervejs.
  const PROGRESS_EVERY = 250;
  for (const [i, e] of unmappedTodo.entries()) {
    if (Date.now() - started > FETCH_DEADLINE_MS) {
      console.log(`  deadline nået efter ${i} af ${unmappedTodo.length} afsnit — resten tages næste kørsel`);
      break;
    }
    await sleep(PAUSE);
    try {
      const episode = extractEpisode(await get(e.loc));
      if (episode) { found2.push({ slug: e.slug, seasonPath: e.seasonPath, guid: e.guid, episode }); state[e.loc] = e.lastmod; }
      else console.warn(`ingen brugbar schema.org: ${e.loc}`);
    } catch (err) {
      console.warn(`kunne ikke hentes: ${e.loc} — ${err.message}`);
    }
    if ((i + 1) % PROGRESS_EVERY === 0) {
      console.log(`  ${i + 1}/${unmappedTodo.length} afsnit hentet, ${found2.length} med dato`);
    }
  }
  console.log(`ukortlagte afsnit med dato: ${found2.length}`);

  // Serieforsiden hentes én gang pr. serie, ikke pr. afsnit — ellers henter
  // vi tusindvis af sider for ingenting. Navnet tages fra afsnittets
  // episode.series (vi har det allerede); forsiden skal kun bruges til hintet.
  const meta = {};
  const unparsedThisRun = {};
  const slugsThisRun = [...new Set(found2.map((f) => f.slug))].sort();
  for (const slug of slugsThisRun) {
    await sleep(PAUSE);
    const name = found2.find((f) => f.slug === slug).episode.series;
    try {
      const html = await get(`https://play.tv2.dk/serie/${slug}`);
      const hintText = extractHint(html);
      const parsedHint = hintText ? parseHint(hintText, today) : null;
      meta[slug] = { name, tmdbId: null, next: parsedHint?.date ?? null };
      if (parsedHint?.unparsed) unparsedThisRun[slug] = parsedHint.unparsed;
    } catch (err) {
      console.warn(`serieforside kunne ikke hentes: ${slug} — ${err.message}`);
      meta[slug] = { name, tmdbId: null, next: null };
    }
  }

  const { index: newIndex, shows: newShows } = buildTv2Shows(found2, meta);
  console.log(`TV 2 Play-serier bygget denne kørsel: ${Object.keys(newShows).length}`);
  console.log(`hints der ikke kunne fortolkes: ${Object.keys(unparsedThisRun).length}`);
  if (Object.keys(unparsedThisRun).length) console.log(`  serier: ${Object.keys(unparsedThisRun).join(', ')}`);

  // Budgettet gør, at én kørsel kun ser en del af kataloget. Filerne lægges
  // derfor OVENPÅ det, der allerede ligger på disk — nøjagtig som
  // overrides.json/mergeOverrides ovenfor — ellers sletter hver kørsel det,
  // den forrige fandt.
  const existingIndexFile = readJson('tv2play/index.json', { version: 1, updated: '', shows: {} });
  const mergedIndex = { ...existingIndexFile.shows, ...newIndex };
  const indexFile = { version: 1, updated: today, shows: mergedIndex };

  const mergedShowFiles = {};
  for (const [slug, show] of Object.entries(newShows)) {
    const existingShow = readJson(`tv2play/shows/${slug}.json`, null);
    mergedShowFiles[slug] = existingShow ? mergeTv2Show(existingShow, show) : show;
  }

  const existingHintsFile = readJson('tv2play/unparsed-hints.json', { version: 1, updated: '', hints: {} });
  const mergedHints = { ...existingHintsFile.hints };
  for (const slug of slugsThisRun) {
    // Enten opdateres den med et nyt uforstået hint, eller den fjernes, fordi
    // hintet nu blev forstået (eller ikke findes længere) — begge dele er en
    // konklusion fra DENNE kørsels serieforsidekald, ikke fra tidligere.
    if (unparsedThisRun[slug]) mergedHints[slug] = unparsedThisRun[slug];
    else delete mergedHints[slug];
  }
  const hintsFile = { version: 1, updated: today, hints: mergedHints };

  if (DRY) { console.log('tørkørsel: intet skrevet'); return; }

  // state/tv2play-lastmod.json skrives ubetinget — indholdet ændrer sig
  // legitimt ved hver kørsel. overrides.json og unmatched.json skrives kun,
  // når der reelt er noget nyt, så en hånd-skrevet, stabil fil ikke får en
  // daglig git-diff af ren omformatering.
  writeFileSync('state/tv2play-lastmod.json', `${JSON.stringify(state, null, 2)}\n`);

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

  // Samme regel som overrides.json/unmatched.json ovenfor: skriv kun en fil,
  // når indholdet reelt har ændret sig, så en kørsel uden nyt for en given
  // serie ikke genererer en daglig diff af ren omformatering.
  if (canonicalJSON(existingIndexFile) !== canonicalJSON(indexFile)) {
    mkdirSync('tv2play', { recursive: true });
    writeFileSync('tv2play/index.json', `${JSON.stringify(indexFile, null, 2)}\n`);
  } else {
    console.log('tv2play/index.json: ingen ændringer, skriver ikke');
  }

  if (Object.keys(mergedShowFiles).length) mkdirSync('tv2play/shows', { recursive: true });
  for (const [slug, show] of Object.entries(mergedShowFiles)) {
    const existingShow = readJson(`tv2play/shows/${slug}.json`, null);
    if (canonicalJSON(existingShow) === canonicalJSON(show)) continue;
    writeFileSync(`tv2play/shows/${slug}.json`, `${JSON.stringify(show, null, 2)}\n`);
  }

  if (canonicalJSON(existingHintsFile) !== canonicalJSON(hintsFile)) {
    mkdirSync('tv2play', { recursive: true });
    writeFileSync('tv2play/unparsed-hints.json', `${JSON.stringify(hintsFile, null, 2)}\n`);
  } else {
    console.log('tv2play/unparsed-hints.json: ingen ændringer, skriver ikke');
  }
}

/**
 * Flet en nyligt bygget serie ind i det, der allerede ligger i
 * tv2play/shows/<slug>.json. Episoder akkumuleres på tværs af kørsler (samme
 * grund som mergeOverrides: budgettet lader os kun se en del af afsnittene ad
 * gangen), mens de øvrige felter (navn, status, next, tmdbId) kommer fra
 * DENNE kørsels friske hentning af serieforsiden — de er aldrig forældede på
 * samme måde, for de hentes hver gang serien røres.
 */
function mergeTv2Show(existing, incoming) {
  const byId = new Map((existing.episodes ?? []).map((e) => [e.id, e]));
  for (const e of incoming.episodes) byId.set(e.id, e);
  const episodes = [...byId.values()].sort((a, b) => a.season - b.season || a.number - b.number);
  return { ...incoming, episodes };
}

main().catch((e) => { console.error(e); process.exit(1); });
