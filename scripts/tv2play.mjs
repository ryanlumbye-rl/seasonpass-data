#!/usr/bin/env node
/**
 * Henter danske afsnitsdatoer fra TV 2 Plays egen schema.org og fletter dem ind
 * i overrides.json. Høflig af design: kun sider hvis lastmod har flyttet sig,
 * én forespørgsel ad gangen, og en pause imellem.
 *
 * Kør tørt med:  node scripts/tv2play.mjs --dry-run
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { assertSitemapHealth, changedSince, dueThisRun, episodeUrls, parseSitemap } from './lib/sitemap.mjs';
import { extractEpisode, extractSeries } from './lib/jsonld.mjs';
import { extractHint, parseHint } from './lib/hint.mjs';
import { isSupported } from './lib/scope.mjs';
import { buildTv2Shows, canonicalSlugs, consolidate } from './lib/tv2shows.mjs';
import { buildEntries, buildUnmatched } from './lib/build.mjs';
import { canonicalJSON, mergeOverrides } from './lib/merge.mjs';
import { readJson } from './lib/io.mjs';
import { fetchSeriesPage, seriesPages, siblingPages } from './lib/seriespage.mjs';

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
// Serier, der blev bygget før billede og beskrivelse kom med (22-10-2026), henter deres
// serieside igen — højst så mange pr. kørsel, så opsamlingen ikke æder budgettet.
// 23-10-2026 kom plakat og titelart med, så hele kataloget (~1.500 serier, ½ sekund hver)
// skal hentes én gang til; deadline'en nedenfor stopper den i tide, og resten tages næste nat.
const BACKFILL_BUDGET = 2000;
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
  const pages = seriesPages(all);

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
  // episode.series (vi har det allerede); forsiden bruges til hintet og til
  // seriens egen beskrivelse og billede (extractSeries).
  const meta = {};
  let viaSibling = 0;
  const unparsedThisRun = {};
  const slugsThisRun = [...new Set(found2.map((f) => f.slug))].sort();
  for (const slug of slugsThisRun) {
    await sleep(PAUSE);
    const name = found2.find((f) => f.slug === slug).episode.series;
    try {
      const page = await fetchSeriesPage(slug, name, pages, get);
      if (!page) throw new Error(`ingen forside, heller ikke under en anden endelse (https://play.tv2.dk/serie/${slug} svarede 404)`);
      if (page.slug !== slug) viaSibling += 1;
      const { html } = page;
      const hintText = extractHint(html);
      const parsedHint = hintText ? parseHint(hintText, today) : null;
      const { description, image, poster, titleArt } = extractSeries(html);
      meta[slug] = { name, tmdbId: null, next: parsedHint?.date ?? null, description, image, poster, titleArt };
      if (parsedHint?.unparsed) unparsedThisRun[slug] = parsedHint.unparsed;
    } catch (err) {
      console.warn(`serieforside kunne ikke hentes: ${slug} — ${err.message}`);
      meta[slug] = { name, tmdbId: null, next: null };
    }
  }

  console.log(`serieforsider fundet under en anden endelse: ${viaSibling}`);

  const { shows: newShows } = buildTv2Shows(found2, meta);

  // Opsamling: serie-filer fra før billede og beskrivelse kom med, og som denne kørsel
  // ikke allerede har rørt. Et hentet svar uden billede gemmes som null, så serien ikke
  // hentes igen hver nat; en fejl lader feltet mangle, så næste kørsel prøver igen.
  const backfill = {};
  const built = existsSync('tv2play/shows') ? readdirSync('tv2play/shows').filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
  // Også serier, der fik image: null, fordi deres egen forside svarede 404, men som har en
  // forside under en anden endelse (23-10-2026) — dem kan vi nu finde.
  const needsArt = (slug) => {
    const show = readJson(`tv2play/shows/${slug}.json`, {}) ?? {};
    return !('image' in show) || !('poster' in show) || (show.image === null && siblingPages(slug, pages).length > 0);
  };
  const missing = built.filter((slug) => !newShows[slug] && needsArt(slug)).slice(0, BACKFILL_BUDGET);
  for (const slug of missing) {
    if (Date.now() - started > FETCH_DEADLINE_MS) break;
    await sleep(PAUSE);
    try {
      const name = readJson(`tv2play/shows/${slug}.json`, {})?.name;
      const page = await fetchSeriesPage(slug, name, pages, get);
      // Ingen forside nogen steder: serien er fjernet fra TV 2 Play (fx Clarkson's Farm,
      // 22-10-2026). Det er et svar, ikke en fejl — gem null, så den ikke hentes igen hver nat.
      backfill[slug] = page ? extractSeries(page.html) : { description: null, image: null, poster: null, titleArt: null };
    } catch (err) {
      console.warn(`serieforside kunne ikke hentes (opsamling): ${slug} — ${err.message}`);
    }
  }
  console.log(`opsamling af billede og beskrivelse: ${Object.keys(backfill).length} af ${missing.length} serier`);
  console.log(`TV 2 Play-serier bygget denne kørsel: ${Object.keys(newShows).length}`);
  console.log(`hints der ikke kunne fortolkes: ${Object.keys(unparsedThisRun).length}`);
  if (Object.keys(unparsedThisRun).length) console.log(`  serier: ${Object.keys(unparsedThisRun).join(', ')}`);

  // Budgettet gør, at én kørsel kun ser en del af kataloget. Filerne lægges
  // derfor OVENPÅ det, der allerede ligger på disk — nøjagtig som
  // overrides.json/mergeOverrides ovenfor — ellers sletter hver kørsel det,
  // den forrige fandt.
  const existingIndexFile = readJson('tv2play/index.json', { version: 1, updated: '', shows: {} });

  const mergedShowFiles = {};
  for (const [slug, show] of Object.entries(newShows)) {
    const existingShow = readJson(`tv2play/shows/${slug}.json`, null);
    mergedShowFiles[slug] = existingShow ? mergeTv2Show(existingShow, show) : show;
  }
  for (const [slug, art] of Object.entries(backfill)) {
    mergedShowFiles[slug] = { ...readJson(`tv2play/shows/${slug}.json`, {}), description: art.description, image: art.image, poster: art.poster, titleArt: art.titleArt };
  }

  // Samme serie under to adresser (alfa-tv2echo + alfa-tv2play) samles under -tv2play,
  // og indekset bygges forfra ud fra de samlede serier — se consolidate. Derfor læses alle
  // serie-filer, ikke kun dem, denne kørsel rørte: en kanal-udgave fra en tidligere nat skal
  // også foldes ind.
  const allShows = {};
  for (const slug of built) allShows[slug] = readJson(`tv2play/shows/${slug}.json`, null);
  Object.assign(allShows, mergedShowFiles);
  for (const slug of Object.keys(allShows)) if (!allShows[slug]) delete allShows[slug];
  const info = Object.fromEntries(Object.entries(allShows).map(([slug, x]) => [slug, { name: x.name, episodes: x.episodes?.length ?? 0 }]));
  const canon = canonicalSlugs([...new Set([...supportedUnmapped.map((e) => e.slug), ...Object.keys(allShows)])], info);
  const { shows: consolidated, index: newIndexAll, images: newImagesAll } = consolidate(allShows, canon);
  const variants = Object.keys(consolidated).filter((slug) => canon.get(slug) !== slug).length;
  console.log(`TV 2 Play-varianter foldet ind under -tv2play: ${variants}`);
  const indexFile = { version: 1, updated: today, shows: newIndexAll, images: newImagesAll };

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

  if (Object.keys(consolidated).length) mkdirSync('tv2play/shows', { recursive: true });
  for (const [slug, show] of Object.entries(consolidated)) {
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
