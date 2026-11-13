/**
 * Pruebas del archivo de bloqueo (`rsharp.lock`).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LOCK_FILE_NAME,
  hashSugar,
  inspectLock,
  parseLockFile,
} from '../lock';
import type { SugarConfig } from '../types';

const SUGAR: SugarConfig = {
  strings: 'utf8',
  overflow: 'panic',
  reentrancy: 'panic',
  finalizers: 'deterministic',
  cycles: 'weak-attribute',
};

test('el nombre del archivo de bloqueo es rsharp.lock', () => {
  assert.equal(LOCK_FILE_NAME, 'rsharp.lock');
});

test('hashSugar: el hash no depende del orden de las claves', () => {
  const a = hashSugar(SUGAR);
  const b = hashSugar({ ...SUGAR });
  assert.equal(a, b);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
});

test('hashSugar: cambiar un valor cambia el hash', () => {
  const base = hashSugar(SUGAR);
  const changed = hashSugar({ ...SUGAR, overflow: 'wrap' });
  assert.notEqual(base, changed);
});

test('parseLockFile: lee un bloqueo válido', () => {
  const lock = parseLockFile(
    JSON.stringify({ version: 1, sugar: { hash: 'sha256:abc' } }),
  );
  assert.equal(lock?.version, 1);
  assert.equal(lock?.sugar?.hash, 'sha256:abc');
});

test('parseLockFile: un contenido inválido devuelve undefined', () => {
  assert.equal(parseLockFile('esto no es json'), undefined);
  assert.equal(parseLockFile('[]'), undefined);
});

test('inspectLock: sin archivo no hay nada que invalidar', () => {
  const inspection = inspectLock(undefined, SUGAR);
  assert.equal(inspection.status, 'missing');
  assert.deepEqual(inspection.affected, []);
});

test('inspectLock: un bloqueo corrupto seAvisa pero no rompe', () => {
  const inspection = inspectLock('roto', SUGAR);
  assert.equal(inspection.status, 'invalid');
  assert.match(inspection.message, /no se puede leer/);
});

test('inspectLock: con el hash al día está ok', () => {
  const text = JSON.stringify({ version: 1, sugar: { hash: hashSugar(SUGAR) } });
  const inspection = inspectLock(text, SUGAR);
  assert.equal(inspection.status, 'ok');
  assert.deepEqual(inspection.affected, []);
});

test('inspectLock: si el sugar cambia, se invalidan los bloqueos afectados', () => {
  const text = JSON.stringify({
    version: 1,
    sugar: { hash: hashSugar(SUGAR) },
    crates: { rand: { version: '0.8', apiHash: 'sha256:x' } },
    libraries: { mylib: { hash: 'sha256:y' } },
  });

  const inspection = inspectLock(text, { ...SUGAR, overflow: 'wrap' });
  assert.equal(inspection.status, 'stale');
  assert.equal(inspection.affected.length, 2);
  assert.ok(inspection.affected.some((item) => item.includes('rand')));
  assert.ok(inspection.affected.some((item) => item.includes('mylib')));
});

test('inspectLock: un bloqueo sin hash de sugar no invalida nada', () => {
  const text = JSON.stringify({ version: 1, crates: {} });
  const inspection = inspectLock(text, SUGAR);
  assert.equal(inspection.status, 'ok');
  assert.deepEqual(inspection.affected, []);
});
