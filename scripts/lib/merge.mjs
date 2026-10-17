/**
 * Flet genererede poster ind i overrides.json.
 *
 * Reglen, der ikke må brydes: en post med source "manual" er tjekket af et menneske
 * og vinder over alt, generatoren mener. Poster, generatoren ikke har data for,
 * står urørt — en tom kørsel må ikke kunne tømme filen.
 *
 * F2: changedSince giver kun de sider, hvis lastmod har flyttet sig, så fra anden
 * kørsel er en indkommende post typisk en delmængde — måske ét afsnit. Erstattes
 * posten i sin helhed, forsvinder alt det, tidligere kørsler fandt, og episoderne
 * falder tilbage til amerikanske datoer i appen. Derfor flettes sæsoner og afsnit
 * sammen i stedet for at blive erstattet (se mergeShow).
 *
 * Accepteret konsekvens: en dato, der trækkes tilbage i kilden, lever videre i
 * filen, til et menneske fjerner den. Det er med vilje — en overflødig dato gør
 * langt mindre skade end en slettet, korrekt dato.
 */
export function mergeOverrides(existing, entries, today) {
  const shows = { ...(existing.shows ?? {}) };
  const changed = [];
  const skipped = [];
  const staleManual = [];

  for (const [key, entry] of Object.entries(entries)) {
    const current = shows[key];
    // Default-deny, ikke default-destroy: kun en post, der POSITIVT er
    // mærket "scraper", må generatoren røre. Er `source` ukendt, mangler den,
    // eller er den fejlstavet ("Manual", "manuel"), er den IKKE bevist
    // scraper-ejet, og skal behandles som beskyttet — det modsatte af det
    // gamle tjek (`current?.source === 'manual'`), som lod alt andet end det
    // ene ord "manual" passere og dermed kunne overskrive en hvilken som
    // helst ukendt/fejlstavet post.
    if (current && current.source !== 'scraper') {
      skipped.push(key);
      // Minor 11: filen røres stadig ikke, men en RIGTIG manuel post (ikke
      // bare en ukendt/fejlstavet source) kan sammenlignes med det, TV 2
      // Play nu rapporterer — se findStaleManualDates.
      if (current.source === 'manual') staleManual.push(...findStaleManualDates(key, current, entry));
      continue;
    }

    const merged = current ? mergeShow(current, entry) : entry;
    // Kanonisk sammenligning, ikke rå JSON.stringify: build.mjs og test-fixtures
    // indsætter felter i forskellig rækkefølge, og rå JSON.stringify ville så
    // melde "ændret" på data, der reelt er identisk — præcis den støj i filen,
    // F1 handlede om at undgå.
    if (canonicalJSON(current) === canonicalJSON(merged)) continue;
    shows[key] = merged;
    changed.push(key);
  }

  return {
    next: {
      ...existing,
      version: existing.version ?? 1,
      updated: changed.length ? `${today}T00:00:00Z` : existing.updated,
      shows,
    },
    changed: changed.sort(),
    skipped: skipped.sort(),
    staleManual,
  };
}

/**
 * Flet en indkommende post ind i den eksisterende post for samme serie.
 * Sæsoner unioneres pr. sæsonnøgle: en sæson kun i den eksisterende post
 * bevares som den er; en sæson i begge får sine episodeOverrides unioneret
 * pr. afsnitsnøgle, hvor den indkommende dato vinder ved konflikt (den er
 * den friskeste). release og episodes genberegnes derefter fra unionen, så
 * de beskriver hele sæsonen og ikke bare den del, denne kørsel så.
 * title, service, source og note kommer fra den indkommende post.
 *
 * Både her og i det øverste niveau (mergeOverrides) bevares felter, vi ikke
 * selv kender til, i stedet for at blive bygget op igen felt for felt: et
 * ukendt felt på en serie eller en sæson (en menneskelig kommentar, f.eks.)
 * skal overleve næste kørsel i stedet for at blive tabt i stilhed.
 */
function mergeShow(current, incoming) {
  const seasons = { ...(current.seasons ?? {}) };

  for (const [seasonKey, incomingSeason] of Object.entries(incoming.seasons ?? {})) {
    const currentSeason = current.seasons?.[seasonKey];
    const episodeOverrides = Object.fromEntries(
      Object.entries({
        ...(currentSeason?.episodeOverrides ?? {}),
        ...incomingSeason.episodeOverrides,
      }).sort((a, b) => Number(a[0]) - Number(b[0])),
    );
    const dates = Object.values(episodeOverrides).map((x) => x.release).sort();

    seasons[seasonKey] = {
      ...currentSeason,
      ...incomingSeason,
      episodes: dates.length,
      release: dates[0],
      pattern: incomingSeason.pattern,
      episodeOverrides,
    };
  }

  // De kendte felter holder deres egen faste rækkefølge (som før fixet), så
  // vi bevidst IKKE arver current's feltrækkefølge her: buildEntries skriver
  // title, source, note, seasons, service (service tilføjes efter loopet,
  // se build.mjs), mens denne funktion altid har skrevet title, service,
  // source, note, seasons — værdi-identisk, men i en anden rækkefølge (I3).
  // Spreder vi current FØRST, ville denne forskel forsvinde af sig selv og
  // aldrig ramme canonicalJSON's sortering — præcis den vej, I3 beder om at
  // få testet, fordi den er load-bearing i praksis. Derfor: kendte felter i
  // fast rækkefølge, og kun de UKENDTE current-felter spredes ind bagefter.
  const KNOWN_SHOW_FIELDS = ['title', 'service', 'source', 'note', 'seasons'];
  const unknownCurrentFields = Object.fromEntries(
    Object.entries(current).filter(([field]) => !KNOWN_SHOW_FIELDS.includes(field)),
  );
  return {
    title: incoming.title,
    service: incoming.service,
    source: incoming.source,
    note: incoming.note,
    seasons,
    ...unknownCurrentFields,
  };
}

/**
 * Minor 11: begge de håndverificerede serier er "manual", så generatoren
 * henter og udtrækker deres sande danske dato hver kørsel — og smider den
 * væk med kun en log-linje om, at posten er sprunget over. Filen rører vi
 * stadig ikke (den forbliver urørt i mergeOverrides), men vi sammenligner,
 * så en forkert dato i den fil, appen stoler mest på, ikke kan gå ubemærket.
 *
 * Sammenligningen er bevidst begrænset til det, filen faktisk indeholder:
 * - Har sæsonen allerede en explicit episodeOverride for afsnittet, bruges
 *   den direkte.
 * - Ellers bruges kun "weekly"-mønsteret: release er dato for afsnit 1, og
 *   trinnet er syv dage. Det er det eneste mønster, de nuværende manuelle
 *   poster bruger — vi genimplementerer ikke appens fulde mønster-udvidelse
 *   her, så alt andet (andre mønstre, eller ingen episodeOverride at måle
 *   imod) springes stille over i stedet for at gætte.
 */
function findStaleManualDates(key, current, incoming) {
  const found = [];
  for (const [seasonKey, incomingSeason] of Object.entries(incoming.seasons ?? {})) {
    const currentSeason = current.seasons?.[seasonKey];
    if (!currentSeason) continue;

    for (const [episodeKey, { release: scrapedDate }] of Object.entries(incomingSeason.episodeOverrides ?? {})) {
      let fileDate = currentSeason.episodeOverrides?.[episodeKey]?.release;
      if (fileDate == null && currentSeason.pattern === 'weekly' && currentSeason.release) {
        fileDate = addDaysISO(currentSeason.release, (Number(episodeKey) - 1) * 7);
      }
      if (fileDate == null || fileDate === scrapedDate) continue;
      found.push({ key, season: seasonKey, episode: episodeKey, fileDate, scrapedDate });
    }
  }
  return found;
}

/** Lægger `days` dage til en 'YYYY-MM-DD'-dato og returnerer samme format. */
function addDaysISO(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * JSON med objektnøgler sorteret rekursivt, så feltrækkefølge aldrig tæller som en
 * ændring. Eksporteret, så CLI'en kan bruge samme kanoniske sammenligning til at
 * afgøre, om unmatched.json reelt har ændret sig, før den skrives igen (F3).
 */
export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
