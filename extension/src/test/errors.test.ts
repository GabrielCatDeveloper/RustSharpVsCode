/**
 * Tests de `src/errors.ts`: traducción de diagnósticos de `rustc` al formato
 * limpio al estilo TypeScript.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatCleanDiagnostic,
  mapRustDiagnostic,
  summarizeCleanDiagnostics,
} from '../errors';
import type { CleanDiagnostic } from '../errors';
import type { RSharpSourceMap, RustDiagnostic } from '../types';

/**
 * Source map de ejemplo: la línea 12 del Rust generado corresponde a la línea
 * 12 del `.rsh`.
 */
const MAP: RSharpSourceMap = {
  rustFile: 'gen/main.rs',
  rshFile: 'src/main.rsh',
  entries: [
    { rustLine: 1, rshLine: 1 },
    { rustLine: 12, rshLine: 12 },
    { rustLine: 20, rshLine: 18 },
  ],
};

/** Diagnóstico de `rustc` de ejemplo. */
function rustDiagnostic(overrides: Partial<RustDiagnostic> = {}): RustDiagnostic {
  return {
    code: 'E0308',
    severity: 'error',
    message: 'mismatched types',
    raw: 'error[E0308]: mismatched types',
    ...overrides,
  };
}

test('mapRustDiagnostic: con source map apunta al .rsh y conserva la posición de Rust', () => {
  const clean = mapRustDiagnostic(
    rustDiagnostic({ file: 'gen/main.rs', line: 12, column: 5 }),
    [MAP],
  );

  assert.deepEqual(clean.location, { file: 'src/main.rsh', line: 12, column: 5 });
  assert.deepEqual(clean.rustLocation, { file: 'gen/main.rs', line: 12, column: 5 });
});

test('mapRustDiagnostic: sin source map no inventa la ubicación de R#', () => {
  const clean = mapRustDiagnostic(
    rustDiagnostic({ file: 'gen/main.rs', line: 12, column: 5 }),
    [],
  );

  assert.equal(clean.location, undefined);
  assert.deepEqual(clean.rustLocation, { file: 'gen/main.rs', line: 12, column: 5 });
});

test('mapRustDiagnostic: un source map de otro archivo no se aplica', () => {
  const clean = mapRustDiagnostic(
    rustDiagnostic({ file: 'gen/otro.rs', line: 12, column: 5 }),
    [MAP],
  );

  assert.equal(clean.location, undefined);
  assert.deepEqual(clean.rustLocation, { file: 'gen/otro.rs', line: 12, column: 5 });
});

test('mapRustDiagnostic: propaga código, mensaje, ayuda y salida original', () => {
  const clean = mapRustDiagnostic(
    rustDiagnostic({ help: 'expected `i32`, found `&str`' }),
    [],
  );

  assert.equal(clean.severity, 'error');
  assert.equal(clean.code, 'E0308');
  assert.equal(clean.message, 'mismatched types');
  assert.equal(clean.help, 'expected `i32`, found `&str`');
  assert.equal(clean.raw, 'error[E0308]: mismatched types');
});

test('mapRustDiagnostic: los avisos de rustc se traducen a "warning"', () => {
  const clean = mapRustDiagnostic(
    rustDiagnostic({ severity: 'warning', code: 'unused_variables' }),
    [],
  );

  assert.equal(clean.severity, 'warning');
  assert.equal(clean.code, 'unused_variables');
});

test('mapRustDiagnostic: sin fichero no hay ubicaciones', () => {
  const clean = mapRustDiagnostic(rustDiagnostic(), [MAP]);

  assert.equal(clean.location, undefined);
  assert.equal(clean.rustLocation, undefined);
});

test('mapRustDiagnostic: sin línea pero con fichero conserva la línea 1 de Rust', () => {
  const clean = mapRustDiagnostic(rustDiagnostic({ file: 'gen/main.rs' }), [MAP]);

  assert.deepEqual(clean.rustLocation, { file: 'gen/main.rs', line: 1, column: undefined });
  assert.equal(clean.location, undefined);
});

test('formatCleanDiagnostic: formato exacto al estilo TypeScript', () => {
  const clean = mapRustDiagnostic(
    rustDiagnostic({
      file: 'gen/main.rs',
      line: 12,
      column: 5,
      help: 'expected `i32`, found `&str`',
    }),
    [MAP],
  );

  const text = formatCleanDiagnostic(clean);

  assert.strictEqual(
    text,
    [
      'R# error [E0308]: mismatched types',
      '  src/main.rsh:12:5',
      '  help: expected `i32`, found `&str`',
    ].join('\n'),
  );
});

test('formatCleanDiagnostic: con showRustDetail aparece la línea de Rust', () => {
  const clean = mapRustDiagnostic(
    rustDiagnostic({
      file: 'gen/main.rs',
      line: 12,
      column: 5,
      help: 'expected `i32`, found `&str`',
    }),
    [MAP],
  );

  const text = formatCleanDiagnostic(clean, { showRustDetail: true });

  assert.strictEqual(
    text,
    [
      'R# error [E0308]: mismatched types',
      '  src/main.rsh:12:5',
      '  (Rust: gen/main.rs:12:5)',
      '  help: expected `i32`, found `&str`',
    ].join('\n'),
  );
});

test('formatCleanDiagnostic: sin showRustDetail no aparece el detalle de Rust', () => {
  const clean = mapRustDiagnostic(
    rustDiagnostic({ file: 'gen/main.rs', line: 12, column: 5 }),
    [MAP],
  );

  assert.equal(formatCleanDiagnostic(clean).includes('gen/main.rs'), false);
  assert.equal(formatCleanDiagnostic(clean, { showRustDetail: false }).includes('gen/main.rs'), false);
});

test('formatCleanDiagnostic: sin código ni ubicación solo muestra la cabecera', () => {
  const diagnostic: CleanDiagnostic = { severity: 'warning', message: 'variable sin usar' };

  assert.strictEqual(formatCleanDiagnostic(diagnostic), 'R# warning: variable sin usar');
});

test('formatCleanDiagnostic: sin columna la ubicación es fichero:línea', () => {
  const diagnostic: CleanDiagnostic = {
    severity: 'error',
    code: 'E0308',
    message: 'mismatched types',
    location: { file: 'src/main.rsh', line: 12 },
  };

  assert.strictEqual(
    formatCleanDiagnostic(diagnostic),
    'R# error [E0308]: mismatched types\n  src/main.rsh:12',
  );
});

test('formatCleanDiagnostic: una ayuda de varias líneas se divide', () => {
  const diagnostic: CleanDiagnostic = {
    severity: 'error',
    message: 'mismatched types',
    help: 'primera ayuda\nsegunda ayuda',
  };

  assert.strictEqual(
    formatCleanDiagnostic(diagnostic),
    'R# error: mismatched types\n  help: primera ayuda\n  help: segunda ayuda',
  );
});

test('summarizeCleanDiagnostics: lista vacía devuelve undefined', () => {
  assert.equal(summarizeCleanDiagnostics([]), undefined);
});

test('summarizeCleanDiagnostics: dos errores en el mismo archivo', () => {
  const summary = summarizeCleanDiagnostics([
    { severity: 'error', message: 'uno', location: { file: 'src/main.rsh', line: 1 } },
    { severity: 'error', message: 'dos', location: { file: 'src/main.rsh', line: 9 } },
  ]);

  assert.strictEqual(summary, 'Se encontraron 2 errores en 1 archivo.');
});

test('summarizeCleanDiagnostics: cuenta los archivos distintos', () => {
  const summary = summarizeCleanDiagnostics([
    { severity: 'error', message: 'uno', location: { file: 'src/main.rsh', line: 1 } },
    { severity: 'error', message: 'dos', location: { file: 'src/otro.rsh', line: 9 } },
  ]);

  assert.strictEqual(summary, 'Se encontraron 2 errores en 2 archivos.');
});

test('summarizeCleanDiagnostics: cuenta por severidad', () => {
  const summary = summarizeCleanDiagnostics([
    { severity: 'error', message: 'uno', location: { file: 'src/main.rsh', line: 1 } },
    { severity: 'warning', message: 'dos', location: { file: 'src/otro.rsh', line: 9 } },
  ]);

  assert.strictEqual(summary, 'Se encontraron 1 error y 1 advertencia en 2 archivos.');
});

test('summarizeCleanDiagnostics: los diagnósticos sin ubicación no cuentan archivo', () => {
  const summary = summarizeCleanDiagnostics([
    { severity: 'error', message: 'uno' },
    { severity: 'error', message: 'dos' },
  ]);

  assert.strictEqual(summary, 'Se encontraron 2 errores.');
});
