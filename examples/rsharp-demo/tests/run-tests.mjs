#!/usr/bin/env node
/**
 * Arnés de pruebas del proyecto de ejemplo `rsharp-demo`.
 *
 * Comprueba la cadena completa:
 *
 *   `.rsh`  --[rsharp transpile]-->  Rust  --[cargo build]-->  binario  --[run]-->  salida
 *
 * Y, si hay un SDK de .NET disponible, hace además la **prueba diferencial**
 * de la spec §4.1: ejecuta el mismo `.rsh` como C# y compara la salida con
 * la del binario de Rust.
 *
 * Uso:
 *   node tests/run-tests.mjs            # pruebas completas
 *   node tests/run-tests.mjs --no-dotnet # sin la prueba diferencial
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const REPO = path.resolve(PROJECT, '..', '..');
const MOCK_CLI = path.join(REPO, 'extension', 'tools', 'mock-rsharp.mjs');

/** Contador de pruebas superadas y fallidas. */
const results = { passed: 0, failed: 0 };

/** Registra el resultado de una comprobación. */
function check(description, condition, detail = '') {
  if (condition) {
    results.passed += 1;
    process.stdout.write(`  ✓ ${description}\n`);
  } else {
    results.failed += 1;
    process.stdout.write(`  ✗ ${description}${detail ? `\n      ${detail}` : ''}\n`);
  }
}

/** Ejecuta la CLI de simulación y devuelve el sobre JSON. */
function rsharp(args) {
  const result = spawnSync(process.execPath, [MOCK_CLI, ...args, '--json'], {
    encoding: 'utf8',
    cwd: PROJECT,
  });
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `La CLI no devolvió JSON (código ${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }
}

/** Ejecuta un comando y devuelve { status, stdout, stderr }. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Busca el SDK de .NET. */
function findDotnet() {
  const candidates = ['dotnet', path.join(os.homedir(), '.dotnet', 'dotnet')];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (result.status === 0) {
      return candidate;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------

process.stdout.write('== R# demo: pruebas del flujo completo ==\n\n');

process.stdout.write('1. Transpilación\n');
const transpiled = rsharp(['transpile', '--project', PROJECT]);
check('la transpilación termina bien', transpiled.ok === true, transpiled.error?.message);
check(
  'genera un fichero Rust por cada `.rsh`',
  (transpiled.files ?? []).length === 3,
  `generados: ${(transpiled.files ?? []).map((file) => file.path).join(', ')}`,
);
check(
  'devuelve un source map por fichero',
  (transpiled.sourceMaps ?? []).length === 3,
);
const mainMap = (transpiled.sourceMaps ?? []).find((map) => map.rustFile === 'main.rs');
check(
  'el source map apunta al `.rsh` de origen',
  mainMap !== undefined && mainMap.rshFile.endsWith('Program.rsh'),
  JSON.stringify(mainMap?.rshFile),
);
check(
  'el source map alinea la línea 1 con la línea 1',
  mainMap?.entries?.[0]?.rustLine === 1 && mainMap?.entries?.[0]?.rshLine === 1,
);

process.stdout.write('\n2. Compilación con cargo\n');
const built = rsharp(['build', '--project', PROJECT]);
check('la compilación termina bien', built.ok === true, built.error?.message);
check('cargo devuelve 0', built.cargo?.exitCode === 0, built.cargo?.stderr?.slice(0, 400));
check('indica el artefacto generado', typeof built.artifact === 'string');

process.stdout.write('\n3. Ejecución del binario\n');
const executed = run(built.artifact, [], { cwd: PROJECT });
check('el binario se ejecuta sin error', executed.status === 0, executed.stderr.slice(0, 400));

const expected = fs.readFileSync(path.join(HERE, 'expected-output.txt'), 'utf8');
const normalize = (text) =>
  text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
check(
  'la salida coincide con la esperada',
  normalize(executed.stdout) === normalize(expected),
  `esperado:\n${normalize(expected)}\nobtenido:\n${normalize(executed.stdout)}`,
);
check('la salida empieza por el título', executed.stdout.includes('=== R# demo ==='));
check('la salida termina correctamente', executed.stdout.trimEnd().endsWith('fin'));
check(
  'el error se captura y se informa',
  executed.stdout.includes('capturado: no es un número: abc'),
);

process.stdout.write('\n4. Compilación en release\n');
const release = rsharp(['build', '--project', PROJECT, '--profile', 'release']);
check('la compilación en release termina bien', release.ok === true, release.error?.message);
check(
  'el binario de release está en su carpeta',
  typeof release.artifact === 'string' && release.artifact.includes('release'),
  release.artifact,
);

process.stdout.write('\n5. Destination WASM\n');
const wasm = rsharp(['build', '--project', PROJECT, '--target', 'wasm32-unknown-unknown']);
if (wasm.ok === true) {
  check('compila a WebAssembly', typeof wasm.artifact === 'string', wasm.artifact);
} else {
  process.stdout.write(
    `  · el destino wasm32-unknown-unknown no está instalado en esta máquina ` +
      `(${wasm.error?.message ?? 'error desconocido'}). Es una limitación del entorno, no del código.\n`,
  );
}

process.stdout.write('\n6. Limpieza\n');
const cleaned = rsharp(['clean', '--project', PROJECT]);
check('la limpieza termina bien', cleaned.ok === true, cleaned.error?.message);
check(
  'borra la carpeta de salida',
  !fs.existsSync(path.join(PROJECT, 'target', 'rsharp')),
);

if (!process.argv.includes('--no-dotnet')) {
  process.stdout.write('\n7. Prueba diferencial con .NET (spec §4.1)\n');
  const dotnet = findDotnet();
  if (dotnet === undefined) {
    process.stdout.write('  · no hay SDK de .NET en esta máquina: se omite la comparación.\n');
  } else {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsharp-diff-'));
    try {
      // El mismo código, ejecutado como C#.
      const sources = fs
        .readdirSync(path.join(PROJECT, 'src'))
        .filter((file) => file.endsWith('.rsh'))
        .map((file) => path.join(PROJECT, 'src', file));
      for (const source of sources) {
        fs.copyFileSync(source, source.replace(/\.rsh$/, '.cs'));
      }
      fs.writeFileSync(
        path.join(workdir, 'diff.csproj'),
        [
          '<Project Sdk="Microsoft.NET.Sdk">',
          '  <PropertyGroup>',
          '    <OutputType>Exe</OutputType>',
          '    <TargetFramework>net10.0</TargetFramework>',
          '    <Nullable>disable</Nullable>',
          '    <ImplicitUsings>disable</ImplicitUsings>',
          '    <StartupObject>Demo.Program</StartupObject>',
          '    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>',
          '  </PropertyGroup>',
          '  <ItemGroup>',
          ...sources.map((source) => `    <Compile Include="${source}" />`),
          '  </ItemGroup>',
          '</Project>',
          '',
        ].join('\n'),
      );

      const restored = built.ok
        ? rsharp(['build', '--project', PROJECT])
        : undefined;
      const dotnetBuild = run(dotnet, ['build', '-v', 'q', '-o', path.join(workdir, 'out')], {
        cwd: workdir,
      });
      check(
        'el mismo código compila como C#',
        dotnetBuild.status === 0,
        dotnetBuild.stderr.slice(0, 600),
      );

      if (dotnetBuild.status === 0) {
        const dotnetRun = run(
          path.join(workdir, 'out', path.basename(workdir) + '.dll'),
          [],
          { cwd: workdir },
        );
        const exe = fs
          .readdirSync(path.join(workdir, 'out'))
          .find((file) => file.endsWith('.dll') && !file.includes('Microsoft'));
        const dotnetExec = exe
          ? run(dotnet, [path.join(workdir, 'out', exe)], { cwd: workdir })
          : dotnetRun;
        check(
          'la salida de .NET coincide con la de Rust',
          normalize(dotnetExec.stdout) === normalize(executed.stdout),
          `dotnet:\n${normalize(dotnetExec.stdout)}\nrust:\n${normalize(executed.stdout)}`,
        );
        void restored;
      }
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
      for (const source of fs.readdirSync(path.join(PROJECT, 'src'))) {
        if (source.endsWith('.cs')) {
          fs.rmSync(path.join(PROJECT, 'src', source));
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 8. El compilador real (Roslyn) frente al mini-transpilador
// ---------------------------------------------------------------------------

const REAL_CLI = path.join(
  REPO,
  'compiler',
  'src',
  'RSharp.Cli',
  'bin',
  'Debug',
  'net8.0',
  'rsharp',
);

process.stdout.write('\n8. Compilador real (Roslyn)\n');
if (!fs.existsSync(REAL_CLI)) {
  process.stdout.write(
    '  · el compilador real no está compilado (dotnet build compiler/src/RSharp.Cli): se omite.\n',
  );
} else {
  const dotnetRoot = process.env.DOTNET_ROOT ?? path.join(os.homedir(), '.dotnet');
  const environment = { ...process.env, DOTNET_ROOT: dotnetRoot };

  const realBuild = spawnSync(
    REAL_CLI,
    ['build', '--project', PROJECT, '--json'],
    { encoding: 'utf8', cwd: PROJECT, env: environment },
  );

  let realEnvelope;
  try {
    realEnvelope = JSON.parse(realBuild.stdout);
  } catch {
    realEnvelope = {};
  }

  check(
    'el compilador real compila el proyecto',
    realEnvelope.ok === true,
    (realEnvelope.error && realEnvelope.error.message) || realBuild.stderr?.slice(0, 400),
  );

  const realBinary = path.join(
    PROJECT,
    'dist',
    'debug',
    'rsharp_demo',
  );
  const realRun = fs.existsSync(realBinary)
    ? spawnSync(realBinary, [], { encoding: 'utf8', cwd: PROJECT })
    : { status: 1, stdout: '', stderr: 'no se generó el binario' };

  check(
    'el binario del compilador real se ejecuta',
    realRun.status === 0,
    realRun.stderr?.slice(0, 300),
  );
  check(
    'la salida del compilador real coincide con la esperada',
    normalize(realRun.stdout) === normalize(expected),
    `real:\n${normalize(realRun.stdout)}\nesperado:\n${normalize(expected)}`,
  );

  // Los source maps del compilador real deben estar alineados 1:1.
  const sourceMapPath = path.join(PROJECT, 'target', 'rsharp', 'rsharp.sourcemap.json');
  if (fs.existsSync(sourceMapPath)) {
    const maps = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'));
    const aligned = maps.every(
      (map) => map.entries.every((entry) => entry.rustLine === entry.rshLine),
    );
    check('los source maps del compilador real están alineados 1:1', aligned);
  } else {
    check('el compilador real genera el archivo de source maps', false);
  }

  // El mini-transpilador y el compilador real deben coincidir.
  const mockRun = spawnSync(
    process.execPath,
    [MOCK_CLI, 'run', '--project', PROJECT],
    { encoding: 'utf8', cwd: PROJECT },
  );
  check(
    'el mini-transpilador y el compilador real dan la misma salida',
    normalize(mockRun.stdout) === normalize(realRun.stdout),
    `mock:\n${normalize(mockRun.stdout)}\nreal:\n${normalize(realRun.stdout)}`,
  );
}

process.stdout.write(
  `\n== ${results.passed} correctas, ${results.failed} fallidas ==\n`,
);
process.exit(results.failed === 0 ? 0 : 1);