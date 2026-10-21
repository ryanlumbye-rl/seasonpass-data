import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isSupported } from '../scripts/lib/scope.mjs';

test('serier og dokumentar hører til', () => {
  assert.equal(isSupported('simon-siger-tv2'), true);
  assert.equal(isSupported('nybyggerne-tv2'), true);
  assert.equal(isSupported('24-timer-paa-skadestuen-tv2'), true);
  assert.equal(isSupported('mobland-skyshowtime'), true);
  assert.equal(isSupported('vaerkstedet-uk-tv2fri'), true);
});

test('nyheder og sport hører ikke til', () => {
  assert.equal(isSupported('news-co-tv2news'), false);
  assert.equal(isSupported('superliga-tv2sport'), false);
});

test('børneindhold er ude — appen henvender sig fra 12 år', () => {
  assert.equal(isSupported('simon-sfkids'), false);
});

test('endelsen skal stå sidst, ikke midt i navnet', () => {
  // En serie om nyheder er ikke en nyhedsudsendelse
  assert.equal(isSupported('bag-om-tv2news-tv2'), true);
});
