import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJson } from '../scripts/lib/io.mjs';

test('mangler filen, bruges fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tv2play-io-'));
  try {
    assert.deepEqual(readJson(join(dir, 'findes-ikke.json'), { foo: 'bar' }), { foo: 'bar' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Fix B: en korrupt overrides.json maa ikke stille blive til en tom fil — det
// skal kaste, saa kørslen stopper, inden den skriver tomheden tilbage.
test('findes filen, men er den korrupt, kastes der i stedet for at bruge fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tv2play-io-'));
  try {
    const p = join(dir, 'korrupt.json');
    writeFileSync(p, '{ dette er ikke json');
    assert.throws(() => readJson(p, {}));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('en gyldig fil parses normalt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tv2play-io-'));
  try {
    const p = join(dir, 'ok.json');
    writeFileSync(p, '{"a":1}');
    assert.deepEqual(readJson(p, {}), { a: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
