/**
 * Prueba de integración del flujo "estilo TypeScript".
 *
 * Comprueba la cadena completa con datos REALES:
 *
 *   mock-rsharp (cargo real)  →  rustc-parser  →  sourcemap  →  errors
 *
 * El objetivo es que el error de `rustc` aparezca en la línea del `.rsh` y no
 * en la del Rust generado. Es el mismo objetivo que cumple TypeScript con el
 * JavaScript.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatCleanDiagnostic, mapRustDiagnostic } from '../errors';
import { parseCargoOutput } from '../rustc-parser';
import { resolveRustLocation } from '../sourcemap';
import type { RSharpCliEnvelope, RSharpSourceMap } from '../types';

/** Ruta de la CLI de simulación. */
const MOCK_CLI = path.join(__dirname, '..', '..', 'tools', 'mock-rsharp.mjs');

/** Crea un proyecto R# temporal con un `.rsh` de varias líneas. */
function createDemoProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsharp-it-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'rsharp.toml'),
    ['schema = 1', '[project]', 'name = "demo"', ''].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'src', 'main.rsh'),
    [
      'using System;',
      '',
      'public class Program',
      '{',
      '    public static void Main(string[] args)',
      '    {',
      '        Console.WriteLine("hola");',
      '    }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  return root;
}

/** Ejecuta el mock en modo `build` y devuelve el sobre JSON. */
function runMockBuild(root: string): RSharpCliEnvelope {
  // `spawnSync` no lanza cuando el proceso termina con código distinto de 0:
  // el mock devuelve 1 a propósito, porque el build falla con el error de
  // rustc que queremos comprobar.
  const result = spawnSync(
    process.execPath,
    [MOCK_CLI, 'build', '--project', root, '--json'],
    { encoding: 'utf8', cwd: root },
  );
  assert.ok(result.stdout, 'el mock debe imprimir el sobre JSON');
  return JSON.parse(result.stdout) as RSharpCliEnvelope;
}

test('el error de rustc se traduce a la línea del archivo .rsh', () => {
  const root = createDemoProject();
  try {
    const envelope = runMockBuild(root);

    // 1. El mock usa cargo de verdad, así que hay un error de rustc real.
    const cargoStderr = envelope.cargo?.stderr ?? '';
    assert.ok(cargoStderr.includes('E0308'), 'la salida de cargo debe traer E0308');

    // 2. rustc-parser extrae el diagnóstico con su código y su ubicación.
    const rustDiagnostics = parseCargoOutput(cargoStderr);
    const typed = rustDiagnostics.find((item) => item.code === 'E0308');
    assert.ok(typed, 'debe detectarse el diagnóstico E0308');
    assert.equal(typed?.file, 'main.rs');
    assert.equal(typed?.line, 2);

    // 3. El source map traduce la línea de Rust a la línea del `.rsh`.
    const maps = (envelope.sourceMaps ?? []) as RSharpSourceMap[];
    assert.ok(maps.length > 0, 'el sobre debe traer source maps');
    const location = resolveRustLocation('main.rs', 2, maps);
    assert.ok(location, 'debe resolverse la ubicación en el .rsh');
    assert.equal(location?.rshFile, 'src/main.rsh');
    assert.equal(location?.rshLine, 2);

    // 4. El diagnóstico limpio apunta al `.rsh`, no al Rust generado.
    const clean = mapRustDiagnostic(typed!, maps);
    assert.equal(clean.location?.file, 'src/main.rsh');
    assert.equal(clean.location?.line, 2);
    assert.equal(clean.rustLocation?.file, 'main.rs');

    // 5. El texto final tiene el formato de TypeScript y no enseña Rust.
    const text = formatCleanDiagnostic(clean);
    assert.match(text, /^R# error \[E0308\]: mismatched types$/m);
    assert.match(text, /src\/main\.rsh:2:18/);
    assert.ok(!text.includes('let x: i32'), 'no debe aparecer el código Rust');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sin source maps el error de rustc no se ancla al .rsh', () => {
  const root = createDemoProject();
  try {
    const envelope = runMockBuild(root);
    const rustDiagnostics = parseCargoOutput(envelope.cargo?.stderr ?? '');
    const typed = rustDiagnostics.find((item) => item.code === 'E0308');
    assert.ok(typed);

    const clean = mapRustDiagnostic(typed!, []);
    assert.equal(clean.location, undefined);
    assert.equal(clean.rustLocation?.file, 'main.rs');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
