/**
 * Lado de .NET: compilar y depurar R# con Roslyn.
 *
 * La idea que hace posible todo esto es que **un `.rsh` es C# válido**
 * (spec §3 y §4.1). Roslyn no distingue por la extensión del fichero: el
 * compilador acepta cualquier fichero como entrada y el PDB guarda la ruta
 * tal cual se le pasó.
 *
 * Consecuencia: si se compila el proyecto con `dotnet build` incluyendo los
 * `.rsh` en `<Compile Include>`, el PDB referencia los `.rsh` y el
 * depurador de .NET (vsdbg) los abre tal cual. Los puntos de parada, las
 * variables y el paso a paso funcionan **sin source maps**, porque la fuente
 * que se depura ES la que el usuario escribió.
 *
 * Esto no sustituye al compilador R#: el producto sigue siendo Rust. Es la
 * vía de depuración cómoda (y la referencia semántica) mientras tanto.
 */

import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { RSharpDiagnostic } from './types';

/** Framework por defecto si no se puede detectar el SDK instalado. */
const DEFAULT_FRAMEWORK = 'net8.0';

/** Herramienta de .NET localizada. */
export interface DotnetTool {
  /** Ruta al ejecutable `dotnet`. */
  path: string;
  /** Versión reportada, si se pudo leer. */
  version?: string;
}

/**
 * Busca el SDK de .NET.
 *
 * Se mira primero el `PATH` y luego las rutas habituales de instalación
 * (`~/.dotnet/dotnet`, `%ProgramFiles%\dotnet\dotnet.exe`).
 */
export function findDotnet(
  env: NodeJS.ProcessEnv = process.env,
  exists: (candidate: string) => boolean = fs.existsSync,
): DotnetTool | undefined {
  const candidates: string[] = [];

  const root = env.DOTNET_ROOT;
  if (root) {
    candidates.push(path.join(root, 'dotnet'), path.join(root, 'dotnet.exe'));
  }

  const home = env.HOME ?? env.USERPROFILE;
  if (home) {
    candidates.push(path.join(home, '.dotnet', 'dotnet'));
  }

  for (const entry of (env.PATH ?? '').split(path.delimiter)) {
    if (entry.length > 0) {
      candidates.push(path.join(entry, 'dotnet'), path.join(entry, 'dotnet.exe'));
    }
  }

  for (const candidate of candidates) {
    if (exists(candidate)) {
      return { path: candidate };
    }
  }
  return undefined;
}

/**
 * Devuelve la versión del SDK instalado, para elegir el `TargetFramework`.
 *
 * `dotnet --list-sdks` devuelve una línea por SDK: `10.0.403 [/ruta]`.
 */
export function detectFramework(dotnetPath: string): string {
  try {
    const result = spawnSync(dotnetPath, ['--list-sdks'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status !== 0) {
      return DEFAULT_FRAMEWORK;
    }
    const majors = (result.stdout ?? '')
      .split(/\r?\n/)
      .map((line) => /^(\d+)\./.exec(line.trim()))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1]));
    if (majors.length === 0) {
      return DEFAULT_FRAMEWORK;
    }
    return `net${Math.max(...majors)}.0`;
  } catch {
    return DEFAULT_FRAMEWORK;
  }
}

/** Opciones para generar el proyecto de .NET. */
export interface DotnetProjectOptions {
  /** Carpeta donde se escribe el `.csproj` y la salida de la compilación. */
  outputDir: string;
  /** Rutas absolutas de los `.rsh` que se compilan. */
  sources: string[];
  /** Nombre del ensamblado. */
  assemblyName: string;
  /** Clase de entrada (`Namespace.Clase`), si se conoce. */
  startupObject?: string;
  /** `TargetFramework` (`net8.0`, `net10.0`, ...). */
  framework: string;
}

/**
 * Escribe el `.csproj` que compila los `.rsh` con Roslyn.
 *
 * Los `Compile Include` usan rutas absolutas: así el PDB referencia los
 * ficheros originales y el depurador abre el `.rsh`, no una copia.
 *
 * @returns la ruta del `.csproj` generado.
 */
export function generateDotnetProject(options: DotnetProjectOptions): string {
  const projectPath = path.join(options.outputDir, `${options.assemblyName}.csproj`);
  fs.mkdirSync(options.outputDir, { recursive: true });

  const includes = options.sources
    .map((source) => `    <Compile Include="${source.replace(/\\/g, '/')}" />`)
    .join('\n');

  const startup = options.startupObject
    ? `    <StartupObject>${options.startupObject}</StartupObject>\n`
    : '';

  const content = [
    '<Project Sdk="Microsoft.NET.Sdk">',
    '',
    '  <!-- Generado por la extensión de R#: compila los `.rsh` con Roslyn. -->',
    '  <PropertyGroup>',
    '    <OutputType>Exe</OutputType>',
    `    <TargetFramework>${options.framework}</TargetFramework>`,
    '    <Nullable>disable</Nullable>',
    '    <ImplicitUsings>disable</ImplicitUsings>',
    '    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>',
    '    <DebugType>portable</DebugType>',
    '    <GenerateDocumentationFile>false</GenerateDocumentationFile>',
    `    <AssemblyName>${options.assemblyName}</AssemblyName>`,
    startup.trimEnd(),
    '  </PropertyGroup>',
    '',
    '  <ItemGroup>',
    includes,
    '  </ItemGroup>',
    '',
    '</Project>',
    '',
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  fs.writeFileSync(projectPath, content, 'utf8');
  return projectPath;
}

/** Resultado de compilar el proyecto con .NET. */
export interface DotnetBuildResult {
  ok: boolean;
  /** Ruta del ensamblado generado. */
  assembly?: string;
  /** Diagnósticos de Roslyn, con la ruta del `.rsh`. */
  diagnostics: RSharpDiagnostic[];
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Opciones para compilar con .NET. */
export interface DotnetBuildOptions {
  /** Ruta de `dotnet`. */
  dotnetPath: string;
  /** Ruta del `.csproj`. */
  projectPath: string;
  /** Carpeta de salida de la compilación. */
  outputDir: string;
  /** Raíz del proyecto, para resolver las rutas de los diagnósticos. */
  projectRoot: string;
  /** Callback con la salida en vivo. */
  logger?: (message: string) => void;
  /** Configuración de la compilación. */
  configuration?: 'Debug' | 'Release';
}

/**
 * Compila el proyecto con `dotnet build` y devuelve los diagnósticos de
 * Roslyn apuntando a los `.rsh`.
 */
export function buildDotnetProject(
  options: DotnetBuildOptions,
): Promise<DotnetBuildResult> {
  const configuration = options.configuration ?? 'Debug';
  const args = [
    'build',
    options.projectPath,
    '--configuration',
    configuration,
    '--output',
    options.outputDir,
    '--nologo',
    '-v',
    'minimal',
  ];

  return new Promise<DotnetBuildResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    let child;
    try {
      child = spawn(options.dotnetPath, args, {
        cwd: path.dirname(options.projectPath),
        windowsHide: true,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      resolve({
        ok: false,
        diagnostics: [],
        stdout: '',
        stderr: detail,
        exitCode: 127,
      });
      return;
    }

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      options.logger?.(chunk);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      options.logger?.(chunk);
    });

    child.on('error', (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        ok: false,
        diagnostics: [],
        stdout,
        stderr: `${stderr}\n${error.message}`,
        exitCode: 127,
      });
    });

    child.on('close', (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      const exitCode = typeof code === 'number' ? code : 1;
      const text = `${stdout}\n${stderr}`;
      const diagnostics = parseDotnetDiagnostics(text, options.projectRoot);
      const assembly = findAssembly(options.outputDir);
      resolve({
        ok: exitCode === 0,
        assembly,
        diagnostics,
        stdout,
        stderr,
        exitCode,
      });
    });
  });
}

/**
 * Analiza la salida de MSBuild y extrae los diagnósticos de Roslyn.
 *
 * Formato típico:
 *
 * ```text
 * Program.rsh(12,5): error CS1002: ; expected [demo.csproj]
 * ```
 *
 * Como el compilador recibe los `.rsh` directamente, el fichero del
 * diagnóstico ya es el `.rsh`: no hace falta ningún source map.
 */
export function parseDotnetDiagnostics(
  text: string,
  projectRoot: string,
): RSharpDiagnostic[] {
  const diagnostics: RSharpDiagnostic[] = [];
  const pattern =
    /^(.+?)\((\d+)(?:,(\d+))?\)\s*:\s*(error|warning|info)\s+(CS\d+)\s*:\s*(.*)$/gm;

  let match = pattern.exec(text);
  while (match !== null) {
    const [, file, line, column, severity, code, message] = match;
    const absolute = path.isAbsolute(file) ? file : path.resolve(projectRoot, file);
    // MSBuild añade el proyecto entre corchetes: `... [demo.csproj]`.
    const clean = message.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
    diagnostics.push({
      code,
      severity: severity === 'warning' ? 'warning' : severity === 'info' ? 'info' : 'error',
      message: clean,
      file: absolute,
      line: Number(line),
      column: column !== undefined ? Number(column) : undefined,
      source: 'R#',
    });
    match = pattern.exec(text);
  }

  return diagnostics;
}

/**
 * Busca el ensamblado generado en la carpeta de salida.
 */
export function findAssembly(outputDir: string): string | undefined {
  try {
    const entries = fs.readdirSync(outputDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.dll') && !entry.name.includes('.')) {
        return path.join(outputDir, entry.name);
      }
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.dll')) {
        return path.join(outputDir, entry.name);
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Indica si el depurador de .NET (vsdbg / C# Dev Kit) está instalado.
 *
 * El tipo de depurador de .NET en VSCode es `coreclr`.
 */
export function isDotnetDebuggerInstalled(
  commands: string[] = [],
): boolean {
  return commands.some(
    (command) =>
      command.startsWith('coreclr.') ||
      command.startsWith('csharp.') ||
      command.startsWith('dotnet.'),
  );
}
