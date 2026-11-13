#!/usr/bin/env node
/**
 * `rsharp` (mock) — CLI de simulación del compilador R# / Rust#.
 *
 * El compilador real (RSharp.Cli) todavía no existe. Este script emula el
 * mismo contrato que espera `src/cli.ts` para poder probar la extensión de
 * VSCode sin la CLI de verdad:
 *
 * ```text
 * rsharp transpile --project <dir> [--output <dir>] [--json]
 * rsharp build     --project <dir> [--profile debug|release] [--target <t>] [--dist <dir>] [--json]
 * rsharp run       --project <dir> [--target <t>] [--profile <p>] [--json]
 * rsharp clean     --project <dir> [--output <dir>] [--dist <dir>] [--json]
 * rsharp --version
 * ```
 *
 * Reglas:
 *
 * - Con `--json` se imprime **un único** objeto JSON con la forma
 *   `RSharpCliEnvelope` de `src/types.ts` (nada más en stdout).
 * - Sin `--json` se imprime texto legible en español.
 * - Código de salida: `0` si todo fue bien, `1` si hay algún error.
 *
 * Notas de la simulación:
 *
 * - `transpile` busca un `.rsh` en el proyecto y genera `main.rs` con una
 *   correspondencia 1:1 de líneas (la línea N del Rust sale de la línea N del
 *   `.rsh`), lo que permite probar el mapeo de source maps.
 * - `transpile` devuelve además un diagnóstico `R#0042` cuando el `.rsh`
 *   menciona `sugar` (spec §17).
 * - `build` escribe un `Cargo.toml` y un `main.rs` con un error de `rustc`
 *   DELIBERADO (`let x: i32 = "hola";`) y compila de verdad con
 *   `cargo build --target-dir <distDir>` para poder probar la traducción de
 *   errores de Rust a líneas de R#.
 * - `run` no compila: simula la ejecución del programa.
 * - `clean` borra la carpeta de salida y la de distribución.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const CLI_NAME = 'rsharp';
const CLI_VERSION = '0.1.0-mock';

/** Perfiles de compilación admitidos (spec §9). */
const PROFILES = ['debug', 'release'];

/** Destinos admitidos (spec §9). */
const TARGETS = ['native', 'wasm32-unknown-unknown', 'wasm32-wasip1'];

/** Carpeta de salida por defecto (spec §3): `<proyecto>/target/rsharp`. */
const DEFAULT_OUTPUT_RELATIVE = path.join('target', 'rsharp');

/** Carpeta de distribución por defecto (spec §3): `<proyecto>/dist`. */
const DEFAULT_DIST_RELATIVE = 'dist';

/** Carpetas que nunca se recorren al buscar archivos `.rsh`. */
const SKIP_DIRS = new Set([
  'node_modules',
  'target',
  'dist',
  'out',
  'bin',
  'obj',
  'build',
  'vendor',
]);

/** Salida del programa simulado en `rsharp run`. */
const PROGRAM_OUTPUT = 'Hola desde R# (mock)';

/**
 * Ejemplo de `.rsh` que se usa cuando el proyecto no tiene ninguno.
 * No se escribe en disco: solo sirve como origen del Rust generado.
 */
const EXAMPLE_RSH = [
  '// Ejemplo de R# usado por el mock de la CLI.',
  'using System;',
  '',
  'namespace HolaMundo',
  '{',
  '    public class Programa',
  '    {',
  '        public static void Main()',
  '        {',
  '            Console.WriteLine("Hola desde R# (mock)");',
  '            var contador = 1;',
  '        }',
  '    }',
  '}',
].join('\n');

const USAGE = [
  `${CLI_NAME} ${CLI_VERSION} (simulación)`,
  '',
  'Uso:',
  `  ${CLI_NAME} transpile --project <dir> [--output <dir>] [--json]`,
  `  ${CLI_NAME} build --project <dir> [--profile debug|release] [--target <t>] [--dist <dir>] [--json]`,
  `  ${CLI_NAME} run --project <dir> [--target <t>] [--profile <p>] [--json]`,
  `  ${CLI_NAME} clean --project <dir> [--output <dir>] [--dist <dir>] [--json]`,
  `  ${CLI_NAME} --version`,
  '',
  'Opciones:',
  '  --project <dir>   Raíz del proyecto R#.',
  '  --output <dir>    Carpeta donde se genera el Rust (por defecto target/rsharp).',
  '  --dist <dir>      Carpeta donde se compila el binario (por defecto dist).',
  '  --profile <p>     Perfil de compilación: debug | release.',
  '  --target <t>      Destino: native | wasm32-unknown-unknown | wasm32-wasip1.',
  '  --json            Imprime un único objeto JSON (RSharpCliEnvelope).',
].join('\n');

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

/** Error controlado con el `kind` del contrato `RSharpCliEnvelope.error`. */
class CliError extends Error {
  /**
   * @param {'not-found'|'spawn-failed'|'bad-json'|'unsupported'|'non-zero'|'unknown'} kind
   * @param {string} message
   */
  constructor(kind, message) {
    super(message);
    this.name = 'CliError';
    this.kind = kind;
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Convierte una ruta en POSIX (barras `/`) para el JSON. */
function toPosix(value) {
  return value.split(path.sep).join('/');
}

/** Resuelve una ruta: si es relativa, se resuelve contra `base`. */
function resolvePath(value, base) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(base, value);
}

/** Normaliza una ruta de proyecto y comprueba que exista. */
function resolveProject(value) {
  const dir = value ? path.resolve(value) : process.cwd();
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new CliError('not-found', `No se encontró el proyecto: ${dir}`);
  }
  return dir;
}

/** Separa el texto en líneas sin la última línea vacía del salto final. */
function splitLines(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/** Nombre de crate válido a partir del nombre de la carpeta del proyecto. */
function crateName(projectDir) {
  const raw = path.basename(projectDir) || 'rsharp_app';
  let name = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[-_]+/, '')
    .replace(/[-_]+$/, '');
  if (name.length === 0) {
    name = 'rsharp_app';
  }
  if (/^[0-9]/.test(name)) {
    name = `rsharp_${name}`;
  }
  return name;
}

/** Busca todos los `.rsh` del proyecto, ordenados de forma estable. */
function findRshFiles(projectDir) {
  const found = [];
  const stack = [projectDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) {
          continue;
        }
        stack.push(full);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.rsh')) {
        found.push(full);
      }
    }
  }
  found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return found;
}

/**
 * Elige el origen `.rsh` del proyecto.
 *
 * Si el proyecto no tiene ninguno, se usa el ejemplo embebido (virtual: no se
 * escribe en disco) para que la CLI siempre pueda transpilar algo.
 */
function pickRshSource(projectDir) {
  const files = findRshFiles(projectDir);
  if (files.length > 0) {
    const file = files[0];
    let content = '';
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      content = '';
    }
    return {
      relPath: toPosix(path.relative(projectDir, file)),
      absolutePath: file,
      content,
      lines: splitLines(content),
      virtual: false,
    };
  }
  return {
    relPath: 'main.rsh',
    absolutePath: undefined,
    content: EXAMPLE_RSH,
    lines: splitLines(EXAMPLE_RSH),
    virtual: true,
  };
}

/**
 * Transpila una línea de R# a una línea de Rust.
 *
 * La conversión es intentionally burda: el objetivo es que la línea N del Rust
 * se corresponda con la línea N del `.rsh` (mapeo lineal de source maps).
 */
function transpileLine(raw) {
  const line = raw.trim();
  if (line.length === 0) {
    return '';
  }
  if (line.startsWith('//')) {
    return line;
  }
  if (/^using\s+/i.test(line)) {
    return `// ${line}`;
  }
  const writeLine = /^Console\.WriteLine\s*\(\s*(.*?)\s*\)\s*;?$/.exec(line);
  if (writeLine) {
    return `println!("${writeLine[1]}");`;
  }
  const varDecl = /^var\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*;$/.exec(line);
  if (varDecl) {
    return `let ${varDecl[1]}: i32 = ${varDecl[2]};`;
  }
  return `// ${line}`;
}

/** Transpila todas las líneas de un `.rsh`. */
function transpileLines(lines) {
  return lines.map((line) => transpileLine(line));
}

/**
 * Construye el source map lineal: la línea N del Rust sale de la línea N del
 * `.rsh`. Solo incluye las líneas que existen en ambos ficheros.
 */
function linearSourceMap(rustFile, rshFile, rustLines, rshLines) {
  const total = Math.min(rustLines, rshLines);
  const entries = [];
  for (let i = 1; i <= total; i += 1) {
    entries.push({ rustLine: i, rshLine: i });
  }
  return { rustFile, rshFile, entries };
}

/**
 * Busca la palabra `sugar` en un `.rsh` para poder emitir el diagnóstico
 * `R#0042` («el código exige un sugar apagado», spec §17).
 */
function findSugarOccurrence(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    const match = /sugar/i.exec(lines[i]);
    if (match) {
      return { line: i + 1, column: match.index + 1, length: match[0].length };
    }
  }
  return undefined;
}

/**
 * Extrae diagnósticos de la salida de `rustc`/`cargo`.
 *
 * Formato de referencia:
 *
 * ```text
 * error[E0308]: mismatched types
 *   --> main.rs:2:18
 * ```
 */
function parseRustcDiagnostics(text) {
  const diagnostics = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const header = /^\s*(error|warning)(?:\[([A-Za-z0-9_]+)\])?:\s*(.*)$/.exec(lines[i]);
    if (!header) {
      continue;
    }
    const diagnostic = {
      severity: header[1] === 'warning' ? 'warning' : 'error',
      message: header[3].trim(),
      source: 'rustc',
    };
    if (header[2]) {
      diagnostic.code = header[2];
    }
    for (let j = i + 1; j < lines.length && j <= i + 12; j += 1) {
      if (/^\s*(error|warning)/.test(lines[j])) {
        break;
      }
      const location = /^\s*-->\s+(.+?)\s*$/.exec(lines[j]);
      if (location && diagnostic.file === undefined) {
        const parts = /^(.*):(\d+):(\d+)$/.exec(location[1]);
        if (parts) {
          diagnostic.file = parts[1];
          diagnostic.line = Number(parts[2]);
          diagnostic.column = Number(parts[3]);
        }
      }
      const help = /^\s*(?:=\s*)?help:\s*(.*)$/.exec(lines[j]);
      if (help && diagnostic.help === undefined) {
        diagnostic.help = help[1].trim();
      }
    }
    diagnostics.push(diagnostic);
  }
  return diagnostics;
}

// ---------------------------------------------------------------------------
// Sobre (envelope)
// ---------------------------------------------------------------------------

/** Crea el sobre `RSharpCliEnvelope` con los campos comunes. */
function makeEnvelope(command, ok, started, extra = {}) {
  const envelope = {
    ok,
    command,
    durationMs: Math.max(0, Date.now() - started),
  };
  return { ...envelope, ...extra };
}

/** Cuenta los errores de una lista de diagnósticos. */
function countErrors(diagnostics) {
  return diagnostics.filter((d) => d.severity === 'error').length;
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

/** `rsharp transpile --project <dir> [--output <dir>]` */
function commandTranspile(options, started) {
  const projectDir = resolveProject(options.project);
  const outputDir = options.output
    ? resolvePath(options.output, projectDir)
    : path.join(projectDir, DEFAULT_OUTPUT_RELATIVE);

  const source = pickRshSource(projectDir);
  const rustLines = transpileLines(source.lines);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'main.rs'), `${rustLines.join('\n')}\n`, 'utf8');

  const files = [
    {
      path: 'main.rs',
      language: 'rust',
      lines: rustLines.length,
    },
  ];

  const sourceMaps = [
    linearSourceMap('main.rs', source.relPath, rustLines.length, source.lines.length),
  ];

  const diagnostics = [];
  const sugar = findSugarOccurrence(source.lines);
  if (sugar) {
    diagnostics.push({
      code: 'R#0042',
      severity: 'error',
      message: 'El código requiere un «sugar» que está apagado en el perfil activo.',
      file: source.relPath,
      line: sugar.line,
      column: sugar.column,
      length: sugar.length,
      help:
        'Activa el sugar en `rsharp.toml` ([sugar]) o compila con `rsharp build --profile release`.',
      source: 'R#',
    });
  }

  const ok = countErrors(diagnostics) === 0;
  const summary =
    `Transpilado: ${files.length} archivo(s), ${sourceMaps[0].entries.length} línea(s) mapeadas` +
    (diagnostics.length > 0 ? `, ${diagnostics.length} diagnóstico(s).` : '.');

  const extra = {
    files,
    diagnostics,
    sourceMaps,
    summary,
  };
  if (!ok) {
    extra.error = {
      message: `La transpilación produjo ${countErrors(diagnostics)} error(es).`,
      kind: 'unknown',
    };
  }

  const envelope = makeEnvelope('transpile', ok, started, extra);
  return { envelope, text: renderText(envelope), textFirst: null };
}

/** `rsharp build --project <dir> [--profile] [--target] [--dist]` */
function commandBuild(options, started) {
  const projectDir = resolveProject(options.project);
  const outputDir = options.output
    ? resolvePath(options.output, projectDir)
    : path.join(projectDir, DEFAULT_OUTPUT_RELATIVE);
  const distDir = options.dist
    ? resolvePath(options.dist, projectDir)
    : path.join(projectDir, DEFAULT_DIST_RELATIVE);

  const profile = options.profile ?? 'debug';
  if (!PROFILES.includes(profile)) {
    throw new CliError('unsupported', `Perfil desconocido: ${profile} (usa debug o release).`);
  }
  const target = options.target ?? 'native';
  if (!TARGETS.includes(target)) {
    throw new CliError(
      'unsupported',
      `Destino desconocido: ${target} (usa ${TARGETS.join(', ')}).`,
    );
  }

  const name = crateName(projectDir);
  const source = pickRshSource(projectDir);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(distDir, { recursive: true });

  const cargoToml = [
    '[package]',
    `name = "${name}"`,
    'version = "0.1.0"',
    'edition = "2021"',
    '',
    '[[bin]]',
    `name = "${name}"`,
    'path = "main.rs"',
    '',
    '[profile.release]',
    'opt-level = 3',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outputDir, 'Cargo.toml'), cargoToml, 'utf8');

  // Error DELIBERADO de rustc (E0308) para probar el mapeo de source maps.
  const mainRs = [
    'fn main() {',
    '    let x: i32 = "hola";',
    `    println!("${PROGRAM_OUTPUT}");`,
    '}',
  ].join('\n');
  fs.writeFileSync(path.join(outputDir, 'main.rs'), `${mainRs}\n`, 'utf8');

  const files = [
    { path: 'Cargo.toml', language: 'toml', lines: cargoToml.split('\n').length - 1 },
    { path: 'main.rs', language: 'rust', lines: mainRs.split('\n').length },
  ];

  const sourceMaps = [
    linearSourceMap('main.rs', source.relPath, mainRs.split('\n').length, source.lines.length),
  ];

  const cargoArgs = ['build'];
  if (target !== 'native') {
    cargoArgs.push('--target', target);
  }
  if (profile === 'release') {
    cargoArgs.push('--release');
  }
  cargoArgs.push('--target-dir', distDir);

  const cargoCommand = `cargo ${cargoArgs.join(' ')}`;
  const result = spawnSync('cargo', cargoArgs, {
    cwd: outputDir,
    encoding: 'utf8',
    windowsHide: true,
  });

  const cargoInfo = {
    command: cargoCommand,
    exitCode: 0,
    stdout: '',
    stderr: '',
  };

  let ok = true;
  let diagnostics = [];
  let artifact;
  let error;

  if (result.error) {
    cargoInfo.exitCode = 127;
    cargoInfo.stderr = result.error.message;
    ok = false;
    error = {
      message:
        'No se encontró «cargo» en el PATH: no se puede compilar. ' +
        'Instálalo con rustup (https://rustup.rs).',
      kind: 'not-found',
    };
  } else {
    cargoInfo.exitCode = typeof result.status === 'number' ? result.status : 1;
    cargoInfo.stdout = result.stdout ?? '';
    cargoInfo.stderr = result.stderr ?? '';
    diagnostics = parseRustcDiagnostics(`${cargoInfo.stdout}\n${cargoInfo.stderr}`);
    if (cargoInfo.exitCode !== 0) {
      ok = false;
      error = {
        message: `cargo build terminó con código ${cargoInfo.exitCode}.`,
        kind: 'non-zero',
      };
    } else {
      artifact = path.join(distDir, profile === 'release' ? 'release' : 'debug', name);
    }
  }

  const summary = ok
    ? `Compilado con cargo (${profile}, ${target}): ${artifact}`
    : `La compilación falló (${cargoInfo.exitCode}) con ${diagnostics.length} diagnóstico(s).`;

  const extra = {
    files,
    diagnostics,
    sourceMaps,
    summary,
    cargo: cargoInfo,
  };
  if (artifact) {
    extra.artifact = artifact;
  }
  if (error) {
    extra.error = error;
  }

  const envelope = makeEnvelope('build', ok, started, extra);
  return { envelope, text: renderText(envelope), textFirst: null };
}

/** `rsharp run --project <dir> [--target] [--profile]` */
function commandRun(options, started) {
  const projectDir = resolveProject(options.project);

  const profile = options.profile ?? 'debug';
  if (!PROFILES.includes(profile)) {
    throw new CliError('unsupported', `Perfil desconocido: ${profile} (usa debug o release).`);
  }
  const target = options.target ?? 'native';
  if (!TARGETS.includes(target)) {
    throw new CliError(
      'unsupported',
      `Destino desconocido: ${target} (usa ${TARGETS.join(', ')}).`,
    );
  }

  const distDir = options.dist
    ? resolvePath(options.dist, projectDir)
    : path.join(projectDir, DEFAULT_DIST_RELATIVE);
  const artifact = path.join(distDir, profile === 'release' ? 'release' : 'debug', crateName(projectDir));

  const envelope = makeEnvelope('run', true, started, {
    files: [],
    diagnostics: [],
    sourceMaps: [],
    summary: PROGRAM_OUTPUT,
    artifact,
  });

  return { envelope, text: renderText(envelope), textFirst: PROGRAM_OUTPUT };
}

/** `rsharp clean --project <dir> [--output] [--dist]` */
function commandClean(options, started) {
  const projectDir = resolveProject(options.project);
  const outputDir = options.output
    ? resolvePath(options.output, projectDir)
    : path.join(projectDir, DEFAULT_OUTPUT_RELATIVE);
  const distDir = options.dist
    ? resolvePath(options.dist, projectDir)
    : path.join(projectDir, DEFAULT_DIST_RELATIVE);

  for (const dir of [outputDir, distDir]) {
    if (path.resolve(dir) === path.resolve(projectDir)) {
      throw new CliError(
        'unsupported',
        'No se puede borrar la raíz del proyecto: elige otras carpetas para output y dist.',
      );
    }
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.rmSync(distDir, { recursive: true, force: true });

  const envelope = makeEnvelope('clean', true, started, {
    files: [],
    diagnostics: [],
    summary: `Limpieza completada: ${outputDir}, ${distDir}`,
  });

  return { envelope, text: renderText(envelope), textFirst: null };
}

// ---------------------------------------------------------------------------
// Renderizado en texto
// ---------------------------------------------------------------------------

/** Renderiza el sobre como texto legible en español. */
function renderText(envelope) {
  const lines = [];
  lines.push(`${CLI_NAME} ${CLI_VERSION} — ${envelope.command}`);
  if (envelope.summary) {
    lines.push(envelope.summary);
  }
  if (envelope.files && envelope.files.length > 0) {
    lines.push('Archivos generados:');
    for (const file of envelope.files) {
      const linesInfo = file.lines === undefined ? '' : `, ${file.lines} líneas`;
      lines.push(`  - ${file.path} (${file.language}${linesInfo})`);
    }
  }
  if (envelope.sourceMaps && envelope.sourceMaps.length > 0) {
    const entries = envelope.sourceMaps.reduce(
      (total, map) => total + (map.entries ? map.entries.length : 0),
      0,
    );
    lines.push(`Source maps: ${envelope.sourceMaps.length} (${entries} entradas)`);
  }
  if (envelope.diagnostics && envelope.diagnostics.length > 0) {
    lines.push('Diagnósticos:');
    for (const diagnostic of envelope.diagnostics) {
      const where = diagnostic.file
        ? ` (${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ''})`
        : '';
      const code = diagnostic.code ? `${diagnostic.code}: ` : '';
      lines.push(`  ${code}${diagnostic.message}${where}`);
      if (diagnostic.help) {
        lines.push(`    Ayuda: ${diagnostic.help}`);
      }
    }
  }
  if (envelope.cargo) {
    lines.push(`cargo: ${envelope.cargo.command} → código ${envelope.cargo.exitCode}`);
    const cargoText = `${envelope.cargo.stdout ?? ''}${envelope.cargo.stderr ?? ''}`.trim();
    if (cargoText) {
      for (const line of cargoText.split(/\r?\n/)) {
        lines.push(`  | ${line}`);
      }
    }
  }
  if (envelope.artifact) {
    lines.push(`Artefacto: ${envelope.artifact}`);
  }
  if (envelope.error) {
    lines.push(`Error: ${envelope.error.message}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Argumentos y punto de entrada
// ---------------------------------------------------------------------------

/** Opciones que aceptan un valor. */
const VALUE_OPTIONS = new Map([
  ['--project', 'project'],
  ['--output', 'output'],
  ['--dist', 'dist'],
  ['--profile', 'profile'],
  ['--target', 'target'],
]);

/** Analiza la línea de órdenes. */
function parseArgv(argv) {
  const options = {
    json: false,
    version: false,
    help: false,
  };
  let command;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      options.version = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      const name = equals >= 0 ? arg.slice(0, equals) : arg;
      const key = VALUE_OPTIONS.get(name);
      if (!key) {
        throw new CliError('unsupported', `Opción desconocida: ${name}`);
      }
      let value;
      if (equals >= 0) {
        value = arg.slice(equals + 1);
      } else {
        value = argv[i + 1];
        i += 1;
        if (value === undefined) {
          throw new CliError('unsupported', `Falta el valor de la opción ${name}.`);
        }
      }
      options[key] = value;
      continue;
    }
    if (command === undefined) {
      command = arg;
      continue;
    }
    throw new CliError('unsupported', `Argumento inesperado: ${arg}`);
  }

  return { command, options };
}

/** Ejecuta la CLI y devuelve el código de salida. */
function main(argv) {
  const started = Date.now();

  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = error instanceof CliError ? error.kind : 'unknown';
    const envelope = makeEnvelope('unknown', false, started, {
      error: { message, kind },
      summary: 'No se pudo entender la línea de órdenes.',
    });
    if (parsed?.options.json) {
      process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    } else {
      process.stderr.write(`${USAGE}\n\nError: ${message}\n`);
    }
    return 1;
  }

  const { command, options } = parsed;

  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (options.version && command === undefined) {
    process.stdout.write(`${CLI_NAME} ${CLI_VERSION}\n`);
    return 0;
  }
  if (command === undefined) {
    process.stderr.write(`${USAGE}\n\nError: falta el comando.\n`);
    return 1;
  }

  try {
    let result;
    switch (command) {
      case 'transpile':
        result = commandTranspile(options, started);
        break;
      case 'build':
        result = commandBuild(options, started);
        break;
      case 'run':
        result = commandRun(options, started);
        break;
      case 'clean':
        result = commandClean(options, started);
        break;
      default:
        throw new CliError('unsupported', `Comando desconocido: ${command}`);
    }

    if (options.json) {
      process.stdout.write(`${JSON.stringify(result.envelope, null, 2)}\n`);
    } else {
      if (result.textFirst) {
        process.stdout.write(`${result.textFirst}\n`);
      }
      process.stdout.write(`${result.text}\n`);
    }
    return result.envelope.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = error instanceof CliError ? error.kind : 'unknown';
    const envelope = makeEnvelope(command, false, started, {
      error: { message, kind },
      summary: `El comando «${command}» falló: ${message}`,
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    } else {
      process.stderr.write(`Error: ${message}\n`);
    }
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
