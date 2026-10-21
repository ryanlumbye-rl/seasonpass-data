/**
 * Hvilke af TV 2 Plays serier appen vil have.
 *
 * Ryan, 21-10-2026: "ting som nybyggerne og dokumentarer er også relevant.
 * Men ting som nyhederne osv. er ligegyldigt."
 *
 * Børneindhold er ude efter beslutningen 17-10-2026: appen henvender sig fra
 * 12 år og op.
 *
 * Endelsen er sidst i slug'en og siger, hvilken kanal titlen hører til.
 * Derfor $ — "bag-om-tv2news-tv2" er en serie om nyhederne, ikke en
 * nyhedsudsendelse.
 */
const UDE = /-(tv2news|tv2sport|sfkids)$/;

export function isSupported(slug) {
  return !UDE.test(slug);
}
