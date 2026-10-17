import { readFileSync } from 'node:fs';

/**
 * Læs en JSON-fil fra disk.
 *
 * Mangler filen, bruges fallback — det er det normale ved første kørsel
 * (state/-filerne og unmatched.json findes ikke, før scriptet har kørt én gang).
 *
 * Findes filen, men kan den ikke parses (korrupt eller afbrudt skrivning),
 * er det en helt anden situation: at falde tilbage til fallback her ville for
 * overrides.json betyde, at en korrupt fil stille bliver til en tom fil, og at
 * den næste rigtige kørsel skriver tomheden tilbage — og sletter alt, inklusive
 * de manuelle poster. Derfor kaster vi i stedet, så main().catch fanger det og
 * stopper kørslen før der skrives noget.
 */
export function readJson(path, fallback) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
  return JSON.parse(raw);
}
