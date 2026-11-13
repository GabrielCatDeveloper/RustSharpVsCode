/**
 * Prueba de integración del flujo "estilo TypeScript".
 *
 * Comprueba la cadena completa con datos REALES:
 *
 *   `.rsh`  --[rsharp transpile]-->  Rust  --[cargo build]-->  binario
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

import { buildDotnetProject, detectFramework, findDotnet, generateDotnetProject } from '../csharp';
import { formatCleanDiagnostic, mapRustDiagnostic } from '../errors';
import { parseCargoOutput } from '../rustc-parser';
import { resolveRustLocation } from '../sourcemap';
import type { RSharpCliEnvelope, RSharpSourceMap } from '../types';

/** Ruta de la CLI de simulación. */
const MOCK_CLI = path.join(__dirname, '..', '..', 'tools', 'mock-rsharp.mjs');

/** Raíz del repositorio (dos niveles por encima de `extension/`). */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Proyecto de ejemplo. */
const DEMO_PROJECT = path.join(REPO_ROOT, 'examples', 'rsharp-demo');

/** Crea un proyecto R# temporal con un `.rsh` de varias líneas. */
function createDemoProject(source: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsharp-it-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'rsharp.toml'),
    ['schema = 1', '[project]', 'name = "demo"', ''].join('\n'),
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'src', 'main.rsh'), source, 'utf8');
  return root;
}

/** Ejecuta el mock en modo `build` y devuelve el sobre JSON. */
function runMockBuild(root: string): RSharpCliEnvelope {
  // `spawnSync` no lanza cuando el proceso termina con código distinto de 0:
  // el mock devuelve 1 a propósito cuando la compilación falla.
  const result = spawnSync(
    process.execPath,
    [MOCK_CLI, 'build', '--project', root, '--json'],
    { encoding: 'utf8', cwd: root },
  );
  assert.ok(result.stdout, 'el mock debe imprimir el sobre JSON');
  return JSON.parse(result.stdout) as RSharpCliEnvelope;
}

test('el error de rustc se traduce a la línea del archivo .rsh', () => {
  const source = [
    'using System;',
    '',
    'namespace Demo;',
    '',
    'public class Program',
    '{',
    '    public static void Main(string[] args)',
    '    {',
    '        int x = "hola";',
    '        Console.WriteLine(x.ToString());',
    '    }',
    '}',
    '',
  ].join('\n');
  const root = createDemoProject(source);
  try {
    const envelope = runMockBuild(root);
    assert.equal(envelope.ok, false, 'la compilación debe fallar');

    // 1. Hay un error real de rustc en la salida de cargo.
    const cargoStderr = envelope.cargo?.stderr ?? '';
    assert.ok(cargoStderr.includes('E0308'), 'la salida de cargo debe traer E0308');

    // 2. rustc-parser extrae el diagnóstico con su código y su ubicación.
    const rustDiagnostics = parseCargoOutput(cargoStderr);
    const typed = rustDiagnostics.find((item) => item.code === 'E0308');
    assert.ok(typed, 'debe detectarse el diagnóstico E0308');
    assert.equal(typed?.file, 'main.rs');
    assert.equal(typed?.line, 9);

    // 3. El source map traduce la línea de Rust a la línea del `.rsh`.
    const maps = (envelope.sourceMaps ?? []) as RSharpSourceMap[];
    assert.ok(maps.length > 0, 'el sobre debe traer source maps');
    const location = resolveRustLocation('main.rs', 9, maps);
    assert.ok(location, 'debe resolverse la ubicación en el .rsh');
    assert.equal(location?.rshFile, 'src/main.rsh');
    assert.equal(location?.rshLine, 9);

    // 4. El diagnóstico limpio apunta al `.rsh`, no al Rust generado.
    const clean = mapRustDiagnostic(typed!, maps);
    assert.equal(clean.location?.file, 'src/main.rsh');
    assert.equal(clean.location?.line, 9);
    assert.equal(clean.rustLocation?.file, 'main.rs');

    // 5. El texto final tiene el formato de TypeScript y no enseña Rust.
    const text = formatCleanDiagnostic(clean);
    assert.match(text, /^R# error \[E0308\]: mismatched types$/m);
    assert.match(text, /src\/main\.rsh:9:/);
    assert.ok(!text.includes('let x'), 'no debe aparecer el código Rust');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sin source maps el error de rustc no se ancla al .rsh', () => {
  const source = [
    'using System;',
    '',
    'public class Program',
    '{',
    '    public static void Main(string[] args)',
    '    {',
    '        int x = "hola";',
    '    }',
    '}',
    '',
  ].join('\n');
  const root = createDemoProject(source);
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

test('el proyecto de ejemplo se transpila, compila y ejecuta', () => {
  assert.ok(
    fs.existsSync(path.join(DEMO_PROJECT, 'rsharp.toml')),
    'debe existir el proyecto de ejemplo',
  );

  const result = spawnSync(
    process.execPath,
    [MOCK_CLI, 'build', '--project', DEMO_PROJECT, '--json'],
    { encoding: 'utf8', cwd: DEMO_PROJECT },
  );
  const envelope = JSON.parse(result.stdout) as RSharpCliEnvelope;
  assert.equal(envelope.ok, true, envelope.error?.message);
  assert.equal(envelope.cargo?.exitCode, 0);

  const artifact = envelope.artifact;
  assert.ok(artifact, 'debe informarse del artefacto');

  const execution = spawnSync(artifact, [], { encoding: 'utf8', cwd: DEMO_PROJECT });
  assert.equal(execution.status, 0, execution.stderr);
  assert.match(execution.stdout, /=== R# demo ===/);
  assert.match(execution.stdout, /capturado: no es un número: abc/);
  assert.match(execution.stdout, /fin/);
});

test('el compilador real (Roslyn) da el mismo resultado que el mini-transpilador', () => {
  const realCli = path.join(
    REPO_ROOT,
    'compiler',
    'src',
    'RSharp.Cli',
    'bin',
    'Debug',
    'net8.0',
    'rsharp',
  );

  if (!fs.existsSync(realCli)) {
    // El compilador real no está compilado: no es un fallo.
    return;
  }

  const environment = {
    ...process.env,
    DOTNET_ROOT: process.env.DOTNET_ROOT ?? path.join(os.homedir(), '.dotnet'),
  };

  const build = spawnSync(realCli, ['build', '--project', DEMO_PROJECT, '--json'], {
    encoding: 'utf8',
    cwd: DEMO_PROJECT,
    env: environment,
  });
  const envelope = JSON.parse(build.stdout) as RSharpCliEnvelope;
  assert.equal(envelope.ok, true, envelope.error?.message);
  assert.equal(envelope.cargo?.exitCode, 0);

  const artifact = envelope.artifact;
  assert.ok(artifact, 'debe informarse del artefacto');

  const execution = spawnSync(artifact, [], { encoding: 'utf8', cwd: DEMO_PROJECT });
  assert.equal(execution.status, 0, execution.stderr);

  // La salida debe coincidir con la del mini-transpilador.
  const mock = spawnSync(
    process.execPath,
    [MOCK_CLI, 'run', '--project', DEMO_PROJECT],
    { encoding: 'utf8', cwd: DEMO_PROJECT },
  );
  assert.equal(execution.stdout, mock.stdout);

  // Y con la salida esperada.
  const expected = fs.readFileSync(
    path.join(DEMO_PROJECT, 'tests', 'expected-output.txt'),
    'utf8',
  );
  assert.equal(
    execution.stdout.replace(/\r\n/g, '\n').trim(),
    expected.replace(/\r\n/g, '\n').trim(),
  );
});

// ---------------------------------------------------------------------------
// Compilación con Roslyn (el lado C#)
// ---------------------------------------------------------------------------

test('Roslyn compila los .rsh y el PDB los referencia', async () => {
  const dotnet = findDotnet();
  if (dotnet === undefined) {
    // Sin SDK de .NET la prueba se omite: no es un fallo del código.
    return;
  }

  const sources = fs
    .readdirSync(path.join(DEMO_PROJECT, 'src'))
    .filter((file) => file.endsWith('.rsh'))
    .map((file) => path.join(DEMO_PROJECT, 'src', file));

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsharp-cs-'));
  try {
    const projectPath = generateDotnetProject({
      outputDir,
      sources,
      assemblyName: 'rsharp_demo',
      framework: detectFramework(dotnet.path),
    });

    const result = await buildDotnetProject({
      dotnetPath: dotnet.path,
      projectPath,
      outputDir,
      projectRoot: DEMO_PROJECT,
    });

    assert.equal(result.ok, true, result.stderr.slice(0, 600));
    assert.ok(result.assembly, 'debe generarse el ensamblado');
    assert.equal(result.diagnostics.length, 0);

    // Lo importante: el PDB apunta a los `.rsh`, no a copias `.cs`.
    const pdb = path.join(outputDir, 'rsharp_demo.pdb');
    assert.ok(fs.existsSync(pdb), 'debe generarse el PDB');
    const content = fs.readFileSync(pdb).toString('latin1');
    assert.ok(content.includes('.rsh'), 'el PDB debe referenciar los archivos .rsh');
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
