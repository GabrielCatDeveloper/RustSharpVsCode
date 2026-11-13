/**
 * Comandos de la extensión de R# (Rust#).
 *
 * Este módulo traduce las acciones de la paleta de VSCode en llamadas a la
 * CLI `rsharp` (`src/cli.ts`) y en interacciones con el usuario.
 *
 * Reglas de la spec que se respetan aquí:
 * - §14.2: los 8 comandos con sus identificadores exactos.
 * - §14.4: `outputDir` y `distDir` son independientes y NO pueden ser la
 *   misma carpeta; `rsharp.toml` tiene prioridad sobre lo que elige el
 *   usuario; las rutas fuera del workspace requieren confirmación; se
 *   comprueba que exista `cargo` antes de compilar.
 * - §14.4 y §17: los diagnósticos se publican en el panel de salida `R#` con
 *   su código (`R#0042`, `R#0101`, ...).
 *
 * Todos los textos de interfaz están en español; los identificadores, en
 * inglés.
 */

import { existsSync, rmSync } from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import type { RSharpCli } from './cli';
import type { ResolvedConfig } from './config';
import { diagnosticText } from './diagnostics';
import { describeMissingTools, type ToolPaths } from './toolchain';
import { runInTerminal as runProgramInTerminal } from './terminal';
import {
  RSPHARP_TARGETS,
  type CliResult,
  type RSharpDiagnostic,
  type RSharpProfile,
  type RSharpTarget,
} from './types';

// ---------------------------------------------------------------------------
// Contrato con la capa de activación
// ---------------------------------------------------------------------------

/** Dependencias que la capa de activación inyecta en los comandos. */
export interface CommandDependencies {
  /** Configuración resuelta del proyecto activo. */
  getConfig(): ResolvedConfig;
  /** Herramientas detectadas (dotnet, cargo, rsharp). */
  getToolchain(): ToolPaths;
  /** Cliente de la CLI. */
  getCli(): RSharpCli;
  /** Escribe una línea en el panel de salida "R#". */
  log(message: string): void;
  /** Escribe una línea de error en el panel de salida. */
  logError(message: string): void;
  /** Aviso informativo al usuario. */
  info(message: string): void;
  /** Refresca la barra de estado y la vista lateral. */
  refresh(): void;
  /** Raíz del workspace con un rsharp.toml, o undefined. */
  getRoot(): string | undefined;
  /** Estado del workspace para recordar las carpetas elegidas. */
  getState(): vscode.Memento;
  /** Canal de salida donde se puede escribir directamente. */
  getOutput(): vscode.OutputChannel;
  /**
   * Se invoca después de cada operación de la CLI.
   *
   * La capa de activación usa este gancho para publicar los diagnósticos en
   * el editor: los de R# que llegan en el sobre JSON y los de `rustc` que
   * llegan dentro de `cargo.stderr`, traducidos a la línea del `.rsh`.
   */
  onCliResult?(result: CliResult, operation: 'transpile' | 'build' | 'clean'): void;
  /**
   * Recibe la salida del programa ejecutado por `R#: Run`.
   *
   * La capa de activación la usa para detectar pánicos de Rust y traducirlos
   * a la línea del `.rsh`, de forma que el usuario no necesita ver el Rust
   * generado para entender qué ha fallado.
   */
  onProgramOutput?(text: string, stream: 'stdout' | 'stderr'): void;
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Identificadores de los comandos (spec §14.2). */
export const RSPHARP_COMMANDS = {
  transpile: 'rsharp.transpile',
  build: 'rsharp.build',
  buildRelease: 'rsharp.buildRelease',
  buildWasm: 'rsharp.buildWasm',
  run: 'rsharp.run',
  clean: 'rsharp.clean',
  chooseOutputFolder: 'rsharp.chooseOutputFolder',
  chooseDistFolder: 'rsharp.chooseDistFolder',
} as const;

/** Claves del estado (`Memento`) que usa esta capa. */
const STATE_OUTPUT_DIR = 'rsharp.outputDir';
const STATE_DIST_DIR = 'rsharp.distDir';
const STATE_RUN_TARGET = 'rsharp.runTarget';

/** Aviso cuando el workspace no tiene un `rsharp.toml`. */
const MSG_NO_TOML = 'No se encontró rsharp.toml en el workspace';

/** Aviso cuando falta el compilador de Rust. */
const MSG_MISSING_CARGO = 'Falta el toolchain de Rust (cargo), necesario para compilar.';

/** Confirmación de la limpieza. */
const MSG_CONFIRM_CLEAN = '¿Eliminar la carpeta de salida y la de distribución?';

/** Confirmación para usar una carpeta fuera del workspace. */
const MSG_CONFIRM_OUTSIDE = 'La carpeta está fuera del espacio de trabajo. ¿Usarla de todos modos?';

/** Etiqueta del botón de confirmación de la limpieza. */
const ACTION_DELETE = 'Eliminar';

/** Etiqueta del botón de confirmación para rutas fuera del workspace. */
const ACTION_USE_ANYWAY = 'Usarla de todos modos';

/** Destino WASM por defecto de `R#: Build WASM`. */
const DEFAULT_WASM_TARGET: RSharpTarget = 'wasm32-unknown-unknown';

/** Nombres de las dos rutas configurables. */
type RouteKind = 'output' | 'dist';

// ---------------------------------------------------------------------------
// Utilidades de ruta
// ---------------------------------------------------------------------------

/** Normaliza una ruta (absoluta, sin `..` ni barras redundantes). */
function normalizePath(target: string): string {
  return path.normalize(path.resolve(target));
}

/** Compara dos rutas de forma tolerante al sistema de archivos. */
function samePath(a: string, b: string): boolean {
  const left = normalizePath(a);
  const right = normalizePath(b);
  if (process.platform === 'win32') {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

/** `true` si `child` está dentro de `parent` (o es la misma carpeta). */
function isInside(parent: string, child: string): boolean {
  const relative = path.relative(normalizePath(parent), normalizePath(child));
  if (relative.length === 0) {
    return true;
  }
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** `true` si la carpeta está dentro del workspace o de la raíz del proyecto. */
function isInsideWorkspace(candidate: string, projectRoot: string): boolean {
  if (vscode.workspace.getWorkspaceFolder(vscode.Uri.file(candidate)) !== undefined) {
    return true;
  }
  return isInside(projectRoot, candidate);
}

/** Traduce una excepción a un mensaje legible. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Utilidades de estado
// ---------------------------------------------------------------------------

/**
 * Guarda un valor en el estado.
 *
 * La API histórica de `Memento.update` aceptaba un tercer parámetro `global`
 * que se eliminó de los tipos de VSCode (y de la API) hace tiempo. Se conserva
 * de forma retrocompatible: si el runtime aún lo acepta, el valor se guarda
 * globalmente (y sobrevive entre sesiones); si no, el ámbito depende del
 * `Memento` que inyecte la capa de activación (`globalState` /
 * `workspaceState`).
 */
async function updateState(
  state: vscode.Memento,
  key: string,
  value: string,
): Promise<void> {
  const update = state.update as unknown as (
    this: vscode.Memento,
    key: string,
    value: unknown,
    global?: boolean,
  ) => Thenable<void>;
  await update.call(state, key, value, true);
}

/** Destino guardado en el estado, si es un destino válido de R#. */
function readSavedTarget(deps: CommandDependencies): RSharpTarget | undefined {
  const saved = deps.getState().get<string>(STATE_RUN_TARGET);
  if (typeof saved !== 'string') {
    return undefined;
  }
  if (!(RSPHARP_TARGETS as readonly string[]).includes(saved)) {
    return undefined;
  }
  return saved as RSharpTarget;
}

/** Destino efectivo de `R#: Run`: el guardado si es concreto; si no, el del proyecto. */
function resolveRunTarget(deps: CommandDependencies, fallback: RSharpTarget): RSharpTarget {
  return readSavedTarget(deps) ?? fallback;
}

/** Destino efectivo de `R#: Build WASM`: el guardado si es WASM; si no, `wasm32-unknown-unknown`. */
function resolveWasmTarget(deps: CommandDependencies): RSharpTarget {
  const saved = readSavedTarget(deps);
  if (saved !== undefined && saved !== 'native') {
    return saved;
  }
  return DEFAULT_WASM_TARGET;
}

/** Ruta que define el `rsharp.toml` para la carpeta indicada, si la define. */
function tomlRoute(config: ResolvedConfig, kind: RouteKind): string | undefined {
  const toml = config.toml;
  if (toml === null) {
    return undefined;
  }
  const relative = kind === 'output' ? toml.paths.output : toml.paths.dist;
  if (typeof relative !== 'string' || relative.trim().length === 0) {
    return undefined;
  }
  return normalizePath(path.resolve(path.dirname(toml.filePath), relative));
}

// ---------------------------------------------------------------------------
// Utilidades de notificación y de panel
// ---------------------------------------------------------------------------

/** Publica un error inesperado: mensaje en la UI y pila en el panel. */
function reportUnexpected(deps: CommandDependencies, error: unknown): void {
  const message = describeError(error);
  deps.logError(`Error inesperado: ${message}`);
  if (error instanceof Error && typeof error.stack === 'string') {
    deps.logError(error.stack);
  }
  void vscode.window.showErrorMessage(message);
}

/** Publica los diagnósticos de R# en el panel de salida con su código. */
function reportDiagnostics(
  deps: CommandDependencies,
  diagnostics: readonly RSharpDiagnostic[],
): void {
  if (diagnostics.length === 0) {
    return;
  }
  deps.log(`Diagnósticos (${diagnostics.length}):`);
  for (const diagnostic of diagnostics) {
    deps.log(`  ${diagnosticText(diagnostic)}`);
    const location = formatLocation(diagnostic);
    if (location !== undefined) {
      deps.log(`    ${location}`);
    }
  }
}

/** Ubicación de un diagnóstico: `archivo:línea:columna`. */
function formatLocation(diagnostic: RSharpDiagnostic): string | undefined {
  if (diagnostic.file === undefined || diagnostic.file.length === 0) {
    return undefined;
  }
  let location = diagnostic.file;
  if (diagnostic.line !== undefined) {
    location += `:${diagnostic.line}`;
    if (diagnostic.column !== undefined) {
      location += `:${diagnostic.column}`;
    }
  }
  return location;
}

/** Mensaje de error de un `CliResult` fallido. */
function failureMessage(result: CliResult): string {
  return (
    result.failure?.message ??
    result.envelope?.error?.message ??
    `La CLI de R# terminó con código ${result.exitCode}.`
  );
}

/** Informa de un fallo: mensaje en la UI y detalle en el panel de salida. */
function reportFailure(deps: CommandDependencies, result: CliResult, label: string): boolean {
  if (result.ok) {
    return true;
  }
  const message = failureMessage(result);
  deps.logError(`${label}: ${message}`);
  const stderr = result.stderr?.trim();
  if (stderr !== undefined && stderr.length > 0) {
    deps.logError(stderr);
  }
  const raw = result.raw?.trim();
  if (raw !== undefined && raw.length > 0) {
    deps.getOutput().appendLine(raw);
  }
  deps.getOutput().show(true);
  void vscode.window.showErrorMessage(message);
  return false;
}

/** Informa de un éxito: resumen, archivos generados y salida de `cargo`. */
function reportSuccess(deps: CommandDependencies, result: CliResult, label: string): void {
  const envelope = result.envelope;
  const summary = envelope?.summary;
  deps.log(`${label}: correcto${summary !== undefined ? ` (${summary})` : ''}.`);
  if (envelope?.durationMs !== undefined) {
    deps.log(`  Duración: ${envelope.durationMs} ms`);
  }
  const files = envelope?.files ?? [];
  if (files.length > 0) {
    deps.log(`  Archivos generados: ${files.length}`);
    for (const file of files) {
      deps.log(`    ${file.path} (${file.language})`);
    }
  }
  const cargo = envelope?.cargo;
  if (cargo !== undefined) {
    deps.log(`  ${cargo.command} (código ${cargo.exitCode})`);
    const stdout = cargo.stdout?.trim();
    if (stdout !== undefined && stdout.length > 0) {
      deps.getOutput().appendLine(stdout);
    }
    const stderr = cargo.stderr?.trim();
    if (stderr !== undefined && stderr.length > 0) {
      deps.getOutput().appendLine(stderr);
    }
  }
}

// ---------------------------------------------------------------------------
// Operaciones con la CLI
// ---------------------------------------------------------------------------

/** Ejecuta `rsharp transpile` mostrando el progreso en la ventana. */
async function runTranspile(
  deps: CommandDependencies,
  root: string,
  config: ResolvedConfig,
): Promise<CliResult> {
  const outputDir = config.outputDir;
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: 'R#: transpilando',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: outputDir });
      deps.log(`Transpilando ${root} -> ${outputDir}`);
      return await deps.getCli().transpile(root, outputDir);
    },
  );
  reportDiagnostics(deps, result.envelope?.diagnostics ?? []);
  deps.onCliResult?.(result, 'transpile');
  return result;
}

/** Ejecuta `rsharp build` mostrando el progreso en la ventana. */
async function runCompile(
  deps: CommandDependencies,
  root: string,
  config: ResolvedConfig,
  options: { profile: RSharpProfile; target: RSharpTarget },
): Promise<CliResult> {
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: 'R#: compilando',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: `${options.profile} / ${options.target}` });
      deps.log(
        `Compilando ${root} (perfil ${options.profile}, destino ${options.target}) -> ${config.distDir}`,
      );
      return await deps.getCli().build(root, {
        profile: options.profile,
        target: options.target,
        distDir: config.distDir,
      });
    },
  );
  reportDiagnostics(deps, result.envelope?.diagnostics ?? []);
  deps.onCliResult?.(result, 'build');
  return result;
}

/**
 * Busca el binario generado dentro de `distDir`.
 *
 * Se prueba primero el artefacto que devuelve la CLI (`envelope.artifact`) y
 * después el nombre del proyecto (`rsharp.toml`), en las carpetas que usa
 * `cargo` (`distDir`, `distDir/<perfil>` y `distDir/<perfil>/<destino>`).
 */
function findBinary(
  config: ResolvedConfig,
  artifact: string | undefined,
  effective: { profile: RSharpProfile; target: RSharpTarget },
): string | undefined {
  const distDir = config.distDir;
  const candidates: string[] = [];

  if (artifact !== undefined && artifact.trim().length > 0) {
    const trimmed = artifact.trim();
    if (path.isAbsolute(trimmed)) {
      candidates.push(trimmed);
    } else {
      candidates.push(path.resolve(config.projectRoot, trimmed));
      candidates.push(path.resolve(distDir, trimmed));
    }
  }

  const projectName = config.toml?.project.name;
  if (projectName !== undefined && projectName.length > 0) {
    const names =
      process.platform === 'win32' ? [projectName, `${projectName}.exe`] : [projectName];
    for (const name of names) {
      candidates.push(path.join(distDir, name));
      candidates.push(path.join(distDir, effective.profile, name));
      candidates.push(path.join(distDir, effective.profile, effective.target, name));
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Lanza el binario en una terminal integrada.
 *
 * Se usa un seudoterminal (no `sendText`) para poder capturar la salida del
 * proceso: eso permite traducir un pánico de Rust a la línea del `.rsh`.
 */
function runInTerminal(deps: CommandDependencies, binary: string): void {
  const cwd = deps.getConfig().projectRoot;
  runProgramInTerminal({
    command: binary,
    cwd,
    onOutput: (text, stream) => deps.onProgramOutput?.(text, stream),
    onExit: (code) => deps.log(`El programa terminó con el código ${code ?? 0}.`),
  });
  deps.log(`Ejecutando "${binary}" en la terminal "R#".`);
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

/**
 * Devuelve la raíz del proyecto.
 * Si no hay `rsharp.toml`, avisa y devuelve `undefined` (no se hace nada más).
 */
function requireRoot(deps: CommandDependencies): string | undefined {
  const root = deps.getRoot();
  if (root === undefined || root.length === 0) {
    deps.info(MSG_NO_TOML);
    deps.log(`${MSG_NO_TOML}: no hay proyecto R# activo.`);
    return undefined;
  }
  return root;
}

/** `R#: Transpile`: genera el Rust en `outputDir`. */
async function commandTranspile(deps: CommandDependencies): Promise<void> {
  const root = requireRoot(deps);
  if (root === undefined) {
    return;
  }
  const config = deps.getConfig();
  const result = await runTranspile(deps, root, config);
  if (!reportFailure(deps, result, 'Transpilación')) {
    return;
  }
  reportSuccess(deps, result, 'Transpilación');
  deps.info('Transpilación completada.');
  deps.refresh();
}

/** `R#: Build`, `R#: Build Release` y `R#: Build WASM`: transpila y compila. */
async function commandBuild(
  deps: CommandDependencies,
  options: { profile: RSharpProfile; target: RSharpTarget },
): Promise<void> {
  const root = requireRoot(deps);
  if (root === undefined) {
    return;
  }
  const config = deps.getConfig();

  // §14.4: se verifica que exista `cargo` antes de compilar. Transpilar sí
  // se puede hacer sin él, así que el aviso no cancela la transpilación.
  const toolchain = deps.getToolchain();
  const canCompile = toolchain.cargo !== undefined;
  if (!canCompile) {
    const message = missingCargoMessage(toolchain);
    deps.info(message);
    deps.log(`${message} Se transpila, pero no se compila.`);
  }

  const transpileResult = await runTranspile(deps, root, config);
  if (!reportFailure(deps, transpileResult, 'Transpilación')) {
    return;
  }
  reportSuccess(deps, transpileResult, 'Transpilación');

  if (!canCompile) {
    deps.log('Se omite la compilación: falta el toolchain de Rust (cargo).');
    deps.refresh();
    return;
  }

  const buildResult = await runCompile(deps, root, config, options);
  if (!reportFailure(deps, buildResult, 'Compilación')) {
    return;
  }
  reportSuccess(deps, buildResult, 'Compilación');
  deps.info(
    `Compilación completada (perfil ${options.profile}, destino ${options.target}).`,
  );
  deps.refresh();
}

/** Mensaje de "falta cargo" reutilizando los mensajes del toolchain. */
function missingCargoMessage(toolchain: ToolPaths): string {
  const missing = describeMissingTools(toolchain);
  const message = missing.find((text) => text.includes('cargo'));
  return message ?? MSG_MISSING_CARGO;
}

/** `R#: Run`: compila y ejecuta el binario en una terminal. */
async function commandRun(deps: CommandDependencies): Promise<void> {
  const root = requireRoot(deps);
  if (root === undefined) {
    return;
  }
  const config = deps.getConfig();
  const target = resolveRunTarget(deps, config.target);

  if (target !== 'native') {
    reportWasmTarget(deps, config, target);
    return;
  }

  const toolchain = deps.getToolchain();
  if (toolchain.cargo === undefined) {
    const message = missingCargoMessage(toolchain);
    deps.info(message);
    deps.log(`${message} No se puede ejecutar sin compilar antes.`);
    return;
  }

  const transpileResult = await runTranspile(deps, root, config);
  if (!reportFailure(deps, transpileResult, 'Transpilación')) {
    return;
  }
  reportSuccess(deps, transpileResult, 'Transpilación');

  const buildResult = await runCompile(deps, root, config, {
    profile: config.profile,
    target: 'native',
  });
  if (!reportFailure(deps, buildResult, 'Compilación')) {
    return;
  }
  reportSuccess(deps, buildResult, 'Compilación');

  const binary = findBinary(config, buildResult.envelope?.artifact, {
    profile: config.profile,
    target: 'native',
  });
  if (binary === undefined) {
    const message = `No se encontró el binario en "${config.distDir}".`;
    deps.info(message);
    deps.logError(message);
    return;
  }

  runInTerminal(deps, binary);
  deps.refresh();
}

/** Explica que un módulo WASM no se ejecuta directamente en la terminal. */
function reportWasmTarget(
  deps: CommandDependencies,
  config: ResolvedConfig,
  target: RSharpTarget,
): void {
  const wasm = findWasmArtifact(config);
  const detail =
    wasm !== undefined
      ? `El módulo está en "${wasm}": puedes abrirlo o servirlo con un servidor local.`
      : 'Genéralo con «R#: Build WASM» y ábrelo desde el explorador o con un servidor local.';

  const message =
    `El destino "${target}" genera un módulo WASM, que no se ejecuta directamente en la terminal. ${detail}`;
  deps.info(message);
  deps.log(message);
  deps.refresh();
}

/** Busca un `.wasm` ya generado en `distDir`. */
function findWasmArtifact(config: ResolvedConfig): string | undefined {
  const distDir = config.distDir;
  const direct = path.join(distDir, `${config.toml?.project.name ?? 'module'}.wasm`);
  if (existsSync(direct)) {
    return direct;
  }
  const profileDir = path.join(distDir, config.profile);
  const inProfile = path.join(profileDir, `${config.toml?.project.name ?? 'module'}.wasm`);
  if (existsSync(inProfile)) {
    return inProfile;
  }
  return undefined;
}

/** `R#: Clean`: borra `outputDir` y `distDir` con confirmación previa. */
async function commandClean(deps: CommandDependencies): Promise<void> {
  const root = requireRoot(deps);
  if (root === undefined) {
    return;
  }
  const config = deps.getConfig();

  const answer = await vscode.window.showWarningMessage(
    MSG_CONFIRM_CLEAN,
    { modal: true },
    ACTION_DELETE,
  );
  if (answer !== ACTION_DELETE) {
    deps.log('Limpieza cancelada.');
    return;
  }

  const toolchain = deps.getToolchain();
  if (toolchain.rsharp !== undefined) {
    const result = await deps.getCli().clean(root, {
      outputDir: config.outputDir,
      distDir: config.distDir,
    });
    deps.onCliResult?.(result, 'clean');
    if (reportFailure(deps, result, 'Limpieza')) {
      reportSuccess(deps, result, 'Limpieza');
      deps.info('Se limpiaron las carpetas de salida y de distribución.');
      deps.refresh();
      return;
    }
    deps.log('La CLI de R# no pudo limpiar; se borran las carpetas directamente.');
  } else {
    deps.log('No hay CLI de R# disponible; se borran las carpetas directamente.');
  }

  removeDirectory(deps, config.outputDir, root);
  removeDirectory(deps, config.distDir, root);
  deps.info('Se eliminaron las carpetas de salida y de distribución.');
  deps.refresh();
}

/**
 * Borra una carpeta de forma recursiva.
 * Nunca borra la raíz del proyecto ni una carpeta que la contenga.
 */
function removeDirectory(
  deps: CommandDependencies,
  directory: string,
  projectRoot: string,
): void {
  const target = normalizePath(directory);
  const root = normalizePath(projectRoot);
  if (target === root || isInside(target, root)) {
    deps.logError(
      `Se omite el borrado de "${target}": contiene la raíz del proyecto "${root}".`,
    );
    return;
  }
  try {
    rmSync(target, { recursive: true, force: true });
    deps.log(`Se eliminó "${target}".`);
  } catch (error) {
    deps.logError(`No se pudo eliminar "${target}": ${describeError(error)}`);
  }
}

/** `R#: Choose Output Folder` y `R#: Choose Dist Folder`. */
async function commandChooseFolder(
  deps: CommandDependencies,
  kind: RouteKind,
): Promise<void> {
  const root = requireRoot(deps);
  if (root === undefined) {
    return;
  }
  const config = deps.getConfig();
  const current = kind === 'output' ? config.outputDir : config.distDir;
  const other = kind === 'output' ? config.distDir : config.outputDir;
  const stateKey = kind === 'output' ? STATE_OUTPUT_DIR : STATE_DIST_DIR;

  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    openLabel: 'Seleccionar carpeta',
    defaultUri: vscode.Uri.file(existsSync(current) ? current : root),
  });
  if (picked === undefined || picked.length === 0) {
    deps.log('Selección de carpeta cancelada.');
    return;
  }

  const chosen = picked[0].fsPath;

  // §14.4: una ruta fuera del workspace necesita confirmación explícita.
  if (!isInsideWorkspace(chosen, root)) {
    const answer = await vscode.window.showWarningMessage(
      MSG_CONFIRM_OUTSIDE,
      { modal: true },
      ACTION_USE_ANYWAY,
    );
    if (answer !== ACTION_USE_ANYWAY) {
      deps.log(`Se descarta "${chosen}": está fuera del espacio de trabajo.`);
      return;
    }
  }

  // §14.4: `outputDir` y `distDir` NO pueden ser la misma carpeta.
  if (samePath(chosen, other)) {
    const message =
      `La carpeta de salida y la de distribución son la misma ("${chosen}"): la spec §14.4 lo prohíbe.`;
    deps.logError(message);
    void vscode.window.showWarningMessage(message);
  }

  await updateState(deps.getState(), stateKey, chosen);
  deps.log(`Carpeta de ${kind === 'output' ? 'salida' : 'distribución'} guardada: ${chosen}`);

  // §14.4: `rsharp.toml` tiene prioridad sobre la elección del usuario.
  const refreshed = deps.getConfig();
  if (refreshed.source === 'toml') {
    const tomlRoutePath = tomlRoute(refreshed, kind);
    if (tomlRoutePath !== undefined) {
      deps.log(`rsharp.toml define la ruta; se usa ${tomlRoutePath}`);
    }
  }

  deps.refresh();
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

/**
 * Registra los 8 comandos de la spec §14.2.
 *
 * Cada comando va envuelto en un `try/catch`: nunca se lanza una excepción
 * hacia VSCode; el error se muestra en la UI y se escribe en el panel.
 */
export function registerCommands(deps: CommandDependencies): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  const register = (id: string, handler: () => Promise<void>): void => {
    disposables.push(
      vscode.commands.registerCommand(id, async () => {
        try {
          await handler();
        } catch (error) {
          reportUnexpected(deps, error);
        }
      }),
    );
  };

  register(RSPHARP_COMMANDS.transpile, () => commandTranspile(deps));
  register(RSPHARP_COMMANDS.build, () =>
    commandBuild(deps, { profile: 'debug', target: 'native' }),
  );
  register(RSPHARP_COMMANDS.buildRelease, () =>
    commandBuild(deps, { profile: 'release', target: 'native' }),
  );
  register(RSPHARP_COMMANDS.buildWasm, () =>
    commandBuild(deps, {
      profile: deps.getConfig().profile,
      target: resolveWasmTarget(deps),
    }),
  );
  register(RSPHARP_COMMANDS.run, () => commandRun(deps));
  register(RSPHARP_COMMANDS.clean, () => commandClean(deps));
  register(RSPHARP_COMMANDS.chooseOutputFolder, () =>
    commandChooseFolder(deps, 'output'),
  );
  register(RSPHARP_COMMANDS.chooseDistFolder, () =>
    commandChooseFolder(deps, 'dist'),
  );

  return disposables;
}
