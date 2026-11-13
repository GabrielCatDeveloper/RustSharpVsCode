/**
 * Tests de `src/panic.ts`: detección de pánicos de Rust y su traducción a
 * la línea del `.rsh` original.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatCleanDiagnostic } from '../errors';
import { findRustPanics, mapPanic } from '../panic';

/** Bloque de pánico tal y como lo escribe Rust en `stderr`. */
const PANIC_BLOCK = [
  "thread 'main' panicked at src/main.rs:12:5:",
  'explicit panic',
  'note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace',
].join('\n');

test('findRustPanics: detecta fichero, línea, columna y mensaje', () => {
  const panics = findRustPanics(PANIC_BLOCK);

  assert.equal(panics.length, 1);
  assert.equal(panics[0].file, 'src/main.rs');
  assert.equal(panics[0].line, 12);
  assert.equal(panics[0].column, 5);
  assert.equal(panics[0].message, 'explicit panic');
});

test('findRustPanics: conserva el bloque original', () => {
  const panics = findRustPanics(PANIC_BLOCK);

  assert.strictEqual(panics[0].raw, PANIC_BLOCK);
});

test('findRustPanics: pánico sin columna', () => {
  const panics = findRustPanics(["thread 'main' panicked at src/main.rs:7:", 'boom'].join('\n'));

  assert.equal(panics.length, 1);
  assert.equal(panics[0].file, 'src/main.rs');
  assert.equal(panics[0].line, 7);
  assert.equal(panics[0].column, undefined);
  assert.equal(panics[0].message, 'boom');
});

test('findRustPanics: varios pánicos en la misma salida', () => {
  const output = [
    PANIC_BLOCK,
    '',
    "thread 'worker' panicked at src/worker.rs:3:9:",
    'worker panic',
  ].join('\n');

  const panics = findRustPanics(output);

  assert.equal(panics.length, 2);
  assert.deepEqual(
    panics.map((p) => [p.file, p.line, p.column, p.message]),
    [
      ['src/main.rs', 12, 5, 'explicit panic'],
      ['src/worker.rs', 3, 9, 'worker panic'],
    ],
  );
});

test('findRustPanics: texto sin pánicos devuelve un array vacío', () => {
  const output = [
    '   Compiling mi_app v0.1.0 (/workspace/proyecto)',
    '    Finished dev [unoptimized + debuginfo] target(s) in 1.23s',
    '     Running `target/debug/mi_app`',
    'hola mundo',
  ].join('\n');

  assert.deepEqual(findRustPanics(output), []);
});

test('findRustPanics: texto vacío devuelve un array vacío', () => {
  assert.deepEqual(findRustPanics(''), []);
});

test('findRustPanics: un mensaje de varias líneas se conserva entero', () => {
  const output = [
    "thread 'main' panicked at src/main.rs:12:5:",
    'primera línea',
    'segunda línea',
    'note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace',
  ].join('\n');

  const panics = findRustPanics(output);

  assert.equal(panics.length, 1);
  assert.strictEqual(panics[0].message, 'primera línea\nsegunda línea');
});

test('findRustPanics: un pánico sin mensaje usa un texto por defecto', () => {
  const panics = findRustPanics("thread 'main' panicked at src/main.rs:12:5:");

  assert.equal(panics.length, 1);
  assert.equal(panics[0].message, 'pánico sin mensaje');
});

test('mapPanic: traduce la ubicación al .rsh y marca el código "panic"', () => {
  const panic = findRustPanics(PANIC_BLOCK)[0];

  const diagnostic = mapPanic(panic, (file, line) => {
    if (file === 'src/main.rs' && line === 12) {
      return { rshFile: 'src/main.rsh', rshLine: 7 };
    }
    return undefined;
  });

  assert.equal(diagnostic.severity, 'error');
  assert.equal(diagnostic.code, 'panic');
  assert.deepEqual(diagnostic.location, { file: 'src/main.rsh', line: 7, column: 5 });
  assert.deepEqual(diagnostic.rustLocation, { file: 'src/main.rs', line: 12, column: 5 });
  assert.equal(diagnostic.message, 'Pánico en tiempo de ejecución: explicit panic');
  assert.strictEqual(diagnostic.raw, PANIC_BLOCK);
});

test('mapPanic: sin source map conserva solo la ubicación de Rust', () => {
  const panic = findRustPanics(PANIC_BLOCK)[0];

  const diagnostic = mapPanic(panic, () => undefined);

  assert.equal(diagnostic.location, undefined);
  assert.deepEqual(diagnostic.rustLocation, { file: 'src/main.rs', line: 12, column: 5 });
  assert.equal(diagnostic.code, 'panic');
});

test('mapPanic: el diagnóstico formateado usa el formato limpio', () => {
  const panic = findRustPanics(PANIC_BLOCK)[0];

  const diagnostic = mapPanic(panic, () => ({ rshFile: 'src/main.rsh', rshLine: 7 }));

  assert.strictEqual(
    formatCleanDiagnostic(diagnostic),
    [
      'R# error [panic]: Pánico en tiempo de ejecución: explicit panic',
      '  src/main.rsh:7:5',
    ].join('\n'),
  );
});
