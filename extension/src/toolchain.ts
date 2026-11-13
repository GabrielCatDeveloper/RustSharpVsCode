/**
 * Descubrimiento del toolchain de R# (Rust#).
 *
 * La extensión de VSCode es un cliente delgado (spec §14.1): ejecuta `dotnet`
 * para transpilar (el transpilador corre como DLL o CLI en .NET, spec §4.4) y
 * `cargo` para compilar el Rust generado (spec §14.4).
 *
 * Este módulo no importa `vscode`: se puede probar en Node puro.
 * No lanza excepciones: si una herramienta no se encuentra, simply no aparece
 * en el resultado y `describeMissingTools` explica qué falta.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Rutas absolutas de las herramientas que usa la extensión. */
export interface ToolPaths {
  /** Ejecutable de .NET (`dotnet`). Necesario si la CLI se distribuye como DLL. */
  dotnet?: string;
  /** Ejecutable de Rust (`cargo`). Necesario para compilar. */
  cargo?: string;
  /** CLI `rsharp` (ejecutable o DLL). */
  rsharp?: string;
  /** `true` cuando `rsharp` es una DLL y hay que lanzarla con `dotnet`. */
  rsharpIsDll: boolean;
}

/** Entrada de {@link resolveToolchain}. */
export interface ToolPathsInput {
  /** Ruta configurada por el usuario (`rsharp.cliPath`). Se usa tal cual. */
  cliPath?: string | null;
  /** Ruta configurada por el usuario (`rsharp.dotnetPath`). */
  dotnetPath?: string | null;
  /** Ruta configurada por el usuario (`rsharp.cargoPath`). */
  cargoPath?: string | null;
  /** Si es `true` se buscan las herramientas en el PATH y en rutas conocidas. */
  autoDetect: boolean;
  /** Entorno usado para el PATH y el HOME (por defecto `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Comprobación de existencia de ficheros (por defecto `fs.existsSync`). */
  exists?: (p: string) => boolean;
}

/** Nombres buscados en el PATH (en POSIX y en Windows). */
const RSPHARP_NAMES: readonly string[] = ['rsharp', 'rsharp.exe'];
const DOTNET_NAMES: readonly string[] = ['dotnet', 'dotnet.exe'];
const CARGO_NAMES: readonly string[] = ['cargo', 'cargo.exe'];

/** Mensajes de herramientas ausentes (texto de UI, en español). */
const MSG_MISSING_CLI =
  'Falta la CLI de R# (rsharp). Instala RSharp.Cli o configura `rsharp.cliPath`.';
const MSG_MISSING_DOTNET = 'Falta .NET SDK (dotnet), necesario para ejecutar la CLI de R#.';
const MSG_MISSING_CARGO =
  'Falta el toolchain de Rust (cargo), necesario para compilar. Instálalo con rustup (https://rustup.rs).';

/** Normaliza una ruta configurable: vacío o `null` significa "no configurado". */
function cleanPath(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** `true` si la ruta apunta a una DLL de .NET. */
function isDllPath(value: string): boolean {
  return value.toLowerCase().endsWith('.dll');
}

/** Comprobación de existencia por defecto (nunca lanza). */
function defaultExists(candidate: string): boolean {
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
}

/** Carpetas del PATH, usando el separador de la plataforma (`:` o `;`). */
function pathEntries(env: NodeJS.ProcessEnv): string[] {
  const raw = env.PATH ?? env.Path ?? env.path;
  if (typeof raw !== 'string' || raw.length === 0) {
    return [];
  }
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Primer candidato existente de una lista, o `undefined`. */
function findFirst(candidates: readonly string[], exists: (p: string) => boolean): string | undefined {
  for (const candidate of candidates) {
    if (exists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** Busca un ejecutable en el PATH. */
function findInPath(
  env: NodeJS.ProcessEnv,
  names: readonly string[],
  exists: (p: string) => boolean,
): string | undefined {
  for (const dir of pathEntries(env)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (exists(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

/** Carpeta personal (`HOME`/`USERPROFILE` del entorno o la del proceso). */
function homeDirectory(env: NodeJS.ProcessEnv): string {
  return env.HOME ?? env.USERPROFILE ?? os.homedir();
}

/**
 * Rutas extra donde puede estar el SDK de .NET.
 *
 * En Linux y macOS la instalación oficial vive en `~/.dotnet`; en Windows,
 * en `%ProgramFiles%\dotnet`. El entorno `DOTNET_ROOT` también vale.
 */
function dotnetExtraCandidates(env: NodeJS.ProcessEnv): string[] {
  const candidates: string[] = [];

  const root = env.DOTNET_ROOT;
  if (root) {
    candidates.push(path.join(root, 'dotnet'), path.join(root, 'dotnet.exe'));
  }

  const home = homeDirectory(env);
  candidates.push(path.join(home, '.dotnet', 'dotnet'));
  candidates.push(path.join(home, '.dotnet', 'dotnet.exe'));

  if (env.ProgramFiles) {
    candidates.push(path.join(env.ProgramFiles, 'dotnet', 'dotnet.exe'));
  }

  return candidates;
}

/**
 * Rutas extra donde puede estar la CLI `rsharp` cuando no está en el PATH:
 * - `~/.dotnet/tools/rsharp` (instalación con `dotnet tool install`),
 * - `./.rsharp/bin/rsharp` (instalación local del proyecto),
 * - la carpeta del propio binario de la extensión (`path.dirname(process.execPath)`),
 * - la carpeta de la extensión (`__dirname` y su padre, por si la CLI se
 *   distribuye junto a `out/`).
 * - `rsharp.dll` en `~/.dotnet/tools` (una herramienta de .NET puede dejar la
 *   DLL junto al ejecutable).
 */
function rsharpExtraCandidates(env: NodeJS.ProcessEnv): string[] {
  const dirs: string[] = [
    path.join(homeDirectory(env), '.dotnet', 'tools'),
    path.resolve(process.cwd(), '.rsharp', 'bin'),
    path.dirname(process.execPath),
    path.resolve(__dirname, '..'),
    __dirname,
  ];
  const candidates: string[] = [];
  for (const dir of dirs) {
    candidates.push(path.join(dir, 'rsharp'));
    candidates.push(path.join(dir, 'rsharp.exe'));
  }
  // Una herramienta de .NET puede dejar la DLL junto al ejecutable.
  candidates.push(path.join(dirs[0], 'rsharp.dll'));

  // Desarrollo: el compilador del propio repositorio, si está compilado.
  candidates.push(path.join(repoRoot(), 'compiler', 'src', 'RSharp.Cli', 'bin', 'Debug', 'net8.0', 'rsharp'));
  candidates.push(path.join(repoRoot(), 'compiler', 'src', 'RSharp.Cli', 'bin', 'Release', 'net8.0', 'rsharp'));

  return candidates;
}

/**
 * Raíz del repositorio, si la extensión se está ejecutando desde él.
 *
 * En desarrollo, la extensión vive en `<repo>/extension` y el compilador en
 * `<repo>/compiler`. En una instalación normal la ruta no existe y, sencillamente,
 * no se encontrará.
 */
function repoRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

/**
 * Resuelve las rutas de las herramientas.
 *
 * - Las rutas configuradas por el usuario (`cliPath`, `dotnetPath`,
 *   `cargoPath`) se usan **tal cual**, sin comprobar si existen: quien las
 *   configuró sabe lo que hace.
 * - Con `autoDetect: true` se busca en el PATH y, para la CLI, en las rutas
 *   extra conocidas.
 */
export function resolveToolchain(input: ToolPathsInput): ToolPaths {
  const env = input.env ?? process.env;
  const exists = input.exists ?? defaultExists;
  const tool: ToolPaths = { rsharpIsDll: false };

  const cliPath = cleanPath(input.cliPath);
  const dotnetPath = cleanPath(input.dotnetPath);
  const cargoPath = cleanPath(input.cargoPath);

  if (cliPath) {
    tool.rsharp = cliPath;
    tool.rsharpIsDll = isDllPath(cliPath);
  } else if (input.autoDetect) {
    const found =
      findInPath(env, RSPHARP_NAMES, exists) ?? findFirst(rsharpExtraCandidates(env), exists);
    if (found) {
      tool.rsharp = found;
      tool.rsharpIsDll = isDllPath(found);
    }
  }

  if (dotnetPath) {
    tool.dotnet = dotnetPath;
  } else if (input.autoDetect) {
    const found =
      findInPath(env, DOTNET_NAMES, exists) ?? findFirst(dotnetExtraCandidates(env), exists);
    if (found) {
      tool.dotnet = found;
    }
  }

  if (cargoPath) {
    tool.cargo = cargoPath;
  } else if (input.autoDetect) {
    const found = findInPath(env, CARGO_NAMES, exists);
    if (found) {
      tool.cargo = found;
    }
  }

  return tool;
}

/**
 * Construye el comando para invocar la CLI.
 *
 * - Si la CLI es una DLL: `dotnet <rsharp.dll> <args>`.
 * - Si es un ejecutable: `<rsharp> <args>`.
 *
 * No incluye `--project`: eso lo añade la capa de comandos.
 * Si falta `dotnet` para una DLL se usa el nombre genérico `dotnet`; la falta
 * real se informa con {@link describeMissingTools}.
 */
export function buildRSharpCommand(tool: ToolPaths, args: string[]): { command: string; args: string[] } {
  const rest = [...args];
  if (tool.rsharpIsDll) {
    const dll = tool.rsharp;
    return {
      command: tool.dotnet ?? 'dotnet',
      args: dll ? [dll, ...rest] : rest,
    };
  }
  return {
    command: tool.rsharp ?? 'rsharp',
    args: rest,
  };
}

/**
 * Mensajes (en español) con las herramientas que faltan.
 *
 * - Sin CLI: no se puede transpilar ni compilar.
 * - Sin `dotnet` con la CLI en DLL: no se puede ejecutar la CLI.
 * - Sin `cargo`: solo se impide compilar; transpilar sigue siendo posible.
 */
export function describeMissingTools(tool: ToolPaths): string[] {
  const missing: string[] = [];
  if (!tool.rsharp) {
    missing.push(MSG_MISSING_CLI);
  } else if (tool.rsharpIsDll && !tool.dotnet) {
    missing.push(MSG_MISSING_DOTNET);
  }
  if (!tool.cargo) {
    missing.push(MSG_MISSING_CARGO);
  }
  return missing;
}
