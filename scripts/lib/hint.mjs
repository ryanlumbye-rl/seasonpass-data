/**
 * TV 2 Play skriver selv, hvornår næste afsnit kommer, i feltet infoHint på
 * seriesiden — fx "Ny episode på lørdag" for Simon siger. Det er en
 * menneskelæselig tekst, ikke et datofelt, så den fortolkes her i generatoren
 * én gang. Appen ser kun en ISO-dato.
 *
 * En form, vi ikke kender, bliver aldrig gættet: den rapporteres som
 * unparsed, og serien får ingen dato. Hellere intet svar end et forkert —
 * samme princip som "manual er helligt" i overrides.json.
 */
const UGEDAGE = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const MÅNEDER = ['januar', 'februar', 'marts', 'april', 'maj', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'december'];

/**
 * Feltet står i sidens nyttelast med ét backslash foran hvert anførselstegn.
 * Nøjagtigheden her er ikke kosmetisk: et håndskrevet fikstur med en anden
 * escaping gav en grøn test og en funktion, der fandt null på den rigtige
 * side. Derfor er regexet fastholdt af fixtures/tv2play-serieside.html.
 */
const FELT = /\\"infoHint\\":(?:null|\\"([^\\"]*)\\")/;

export function extractHint(html) {
  const m = FELT.exec(html);
  return m ? (m[1] ?? null) : null;
}

const iso = (d) => d.toISOString().slice(0, 10);
const dag = (s) => new Date(`${s}T00:00:00Z`);

export function parseHint(text, todayISO) {
  if (!text) return null;
  const t = text.trim().toLowerCase();

  if (/\bi morgen\b/.test(t)) {
    const d = dag(todayISO); d.setUTCDate(d.getUTCDate() + 1); return { date: iso(d) };
  }

  // "på næste onsdag" er onsdag i NÆSTE kalenderuge, ikke den kommende onsdag.
  // Ryan, 21-10-2026: formen optræder kun på selve udgivelsesdagen, hvor TV 2
  // allerede kender det efterfølgende afsnit — derfor ville "syv dage frem"
  // tilfældigvis ramme rigtigt i praksis. Men det er ikke det, ordet betyder,
  // og en formulering på en anden ugedag ville så give en dato en uge for tidligt.
  const ugeNæste = UGEDAGE.findIndex((u) => new RegExp(`\\bnæste ${u}\\b`).test(t));
  if (ugeNæste >= 0) {
    const d = dag(todayISO);
    const tilMandag = (d.getUTCDay() + 6) % 7; // 0 = mandag, dansk ugestart
    d.setUTCDate(d.getUTCDate() - tilMandag + 7 + ((ugeNæste + 6) % 7));
    return { date: iso(d) };
  }

  const uge = UGEDAGE.findIndex((u) => new RegExp(`\\bpå ${u}\\b`).test(t));
  if (uge >= 0) {
    const d = dag(todayISO);
    // Strengt efter i dag: "på onsdag" en onsdag betyder om en uge
    const frem = ((uge - d.getUTCDay() + 7) % 7) || 7;
    d.setUTCDate(d.getUTCDate() + frem);
    return { date: iso(d) };
  }

  const m = new RegExp(`\\b(\\d{1,2})\\.\\s*(${MÅNEDER.join('|')})\\b`).exec(t);
  if (m) {
    const dato = Number(m[1]);
    const måned = MÅNEDER.indexOf(m[2]);
    const d0 = dag(todayISO);
    // Året står ikke i teksten. Vælg det, der ligger foran os.
    let år = d0.getUTCFullYear();
    if (Date.UTC(år, måned, dato) < d0.getTime()) år += 1;
    return { date: iso(new Date(Date.UTC(år, måned, dato))) };
  }

  return { unparsed: text };
}
