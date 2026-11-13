/**
 * Tests de `src/diagnostics.ts`.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import {
  diagnosticText,
  groupByFile,
  summarizeDiagnostics,
  toVscodeDiagnostic,
} from '../diagnostics';
import type { RSharpDiagnostic } from '../types';

const ROOT = '/workspace/proyecto';

function diag(overrides: Partial<RSharpDiagnostic> = {}): RSharpDiagnostic {
  return {
    code: 'R#0042',
    severity: 'error',
    message: 'usa [Weak] en este campo o activa #codeGenAI',
    ...overrides,
  };
}

test('toVscodeDiagnostic: convierte línea y columna 1-based a 0-based', () => {
  const d = toVscodeDiagnostic(diag({ file: 'src/main.rsh', line: 12, column: 5 }), ROOT);

  assert.deepEqual(d.range.start, { line: 11, character: 4 });
  assert.deepEqual(d.range.end, { line: 11, character: 5 });
});

test('toVscodeDiagnostic: sin línea usa la primera línea', () => {
  const d = toVscodeDiagnostic(diag({ file: 'src/main.rsh' }), ROOT);

  assert.equal(d.range.start.line, 0);
  assert.equal(d.range.start.character, 0);
});

test('toVscodeDiagnostic: sin columna usa el primer carácter', () => {
  const d = toVscodeDiagnostic(diag({ file: 'src/main.rsh', line: 3 }), ROOT);

  assert.equal(d.range.start.line, 2);
  assert.equal(d.range.start.character, 0);
});

test('toVscodeDiagnostic: la longitud por defecto es un carácter', () => {
  const d = toVscodeDiagnostic(diag({ file: 'no/existe.rsh', line: 4, column: 2 }), ROOT);

  assert.deepEqual(d.range.end, { line: 3, character: 2 });
});

test('toVscodeDiagnostic: respeta la longitud indicada', () => {
  const d = toVscodeDiagnostic(diag({ file: 'src/main.rsh', line: 4, column: 2, length: 6 }), ROOT);

  assert.deepEqual(d.range.end, { line: 3, character: 7 });
});

test('toVscodeDiagnostic: usa la raíz del proyecto para resolver el archivo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsharp-diag-'));
  try {
    fs.writeFileSync(path.join(dir, 'main.rsh'), 'class A {}\nclass B {}\n', 'utf8');
    const d = toVscodeDiagnostic(diag({ file: 'main.rsh', line: 2, column: 7 }), dir);

    // Fin de la línea "class B {}" (10 caracteres): el rango llega al final.
    assert.equal(d.range.start.character, 6);
    assert.equal(d.range.end.character, 10);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('toVscodeDiagnostic: source fijo "R#" y severidad conservada', () => {
  const d = toVscodeDiagnostic(diag({ severity: 'warning', source: 'otro' }), ROOT);

  assert.equal(d.source, 'R#');
  assert.equal(d.severity, 'warning');
  assert.equal(d.message, 'usa [Weak] en este campo o activa #codeGenAI');
});

test('toVscodeDiagnostic: conserva los códigos R# exactos', () => {
  for (const code of ['R#0042', 'R#0101', 'R#0150']) {
    const d = toVscodeDiagnostic(diag({ code }), ROOT);
    assert.equal(d.code, code);
  }
});

test('groupByFile: agrupa por archivo', () => {
  const grouped = groupByFile([
    diag({ file: 'a.rsh' }),
    diag({ file: 'b.rsh' }),
    diag({ file: 'a.rsh' }),
  ]);

  assert.equal(grouped.size, 2);
  assert.equal(grouped.get('a.rsh')?.length, 2);
  assert.equal(grouped.get('b.rsh')?.length, 1);
});

test('groupByFile: los diagnósticos sin archivo van a la clave vacía', () => {
  const grouped = groupByFile([diag(), diag({ file: 'a.rsh' })]);

  assert.equal(grouped.size, 2);
  assert.equal(grouped.get('')?.length, 1);
});

test('groupByFile: lista vacía devuelve un mapa vacío', () => {
  assert.equal(groupByFile([]).size, 0);
});

test('summarizeDiagnostics: cuenta por severidad', () => {
  const summary = summarizeDiagnostics([
    diag({ severity: 'error' }),
    diag({ severity: 'error' }),
    diag({ severity: 'warning' }),
    diag({ severity: 'info' }),
  ]);

  assert.deepEqual(summary, { errors: 2, warnings: 1, infos: 1 });
});

test('summarizeDiagnostics: lista vacía', () => {
  assert.deepEqual(summarizeDiagnostics([]), { errors: 0, warnings: 0, infos: 0 });
});

test('diagnosticText: "código: mensaje"', () => {
  const text = diagnosticText(diag());

  assert.equal(text, 'R#0042: usa [Weak] en este campo o activa #codeGenAI');
});

test('diagnosticText: añade la ayuda opcional', () => {
  const text = diagnosticText(diag({ help: 'activa [sugar.cycles] en rsharp.toml' }));

  assert.equal(
    text,
    'R#0042: usa [Weak] en este campo o activa #codeGenAI\n  Ayuda: activa [sugar.cycles] en rsharp.toml',
  );
});
