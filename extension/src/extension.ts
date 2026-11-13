/**
 * R# (Rust#) — extensión de VSCode.
 *
 * Cliente delgado del compilador R# (spec §14.1):
 * - ejecuta `rsharp` (o `dotnet rsharp.dll`) para transpilar,
 * - ejecuta `cargo` para compilar,
 * - traduce los errores al archivo `.rsh` que el usuario ha escrito.
 *
 * Idea central, la misma que TypeScript: el Rust generado es un producto
 * intermedio (§1) y el usuario nunca necesita verlo. Los errores de `rustc`
 * y los pánicos en tiempo de ejecución se muestran en el `.rsh`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { RSharpCli } from './cli';
import { registerCommands } from './commands';
import { loadProjectConfig, type ResolvedConfig } from './config';
import { DEBUGGER_TYPE, RSharpDebugConfigurationProvider, isDebuggerInstalled } from './debug';
import { formatCleanDiagnostic, mapRustDiagnostic, summarizeCleanDiagnostics } from './errors';
import { findRustPanics, mapPanic } from './panic';
import {
  DIAGNOSTIC_COLLECTION_NAME,
  publishCleanDiagnostics,
  publishRSharpDiagnostics,
  publishRustDiagnostics,
} from './publish';
import { parseCargoOutput } from './rustc-parser';
import { RSharpSession, SESSION_FILE_NAME } from './session';
import { createStatusBar } from './statusbar';
import { resolveRustLocation } from './sourcemap';
import { createProjectTree } from './treeview';
import { resolveToolchain, type ToolPaths } from './toolchain';
import {
  RSPHARP_PROFILES,
  RSPHARP_TARGETS,
  type CliResult,
  type RSharpDiagnostic,
  type RSharpProfile,
  type RSharpSourceMap,
  type RSharpTarget,
} from './types';

/** Nombre del fichero de configuración del proyecto. */
const TOML_FILE_NAME = 'rsharp.toml';

/** Claves usadas en el estado del workspace. */
const STATE_OUTPUT_DIR = 'rsharp.outputDir';
const STATE_DIST_DIR = 'rsharp.distDir';
const STATE_RUN_TARGET = 'rsharp.runTarget';
const STATE_PROFILE = 'rsharp.profile';

/** Estado global de la extensión mientras está activa. */
interface ExtensionState {
  root: string | undefined;
  config: ResolvedConfig | undefined;
  toolchain: ToolPaths;
  session: RSharpSession;
  /** Colección de diagnósticos del editor. */
  collection: vscode.DiagnosticCollection;
  /** Acumulado de `stderr` del programa en ejecución. */
  programStderr: string;
  /** `true` si el usuario ha pedido ver el detalle de Rust. */
  showRustDetail: boolean;
}

/**
 * Punto de entrada de la extensión.
 */
export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('R#');
  context.subscriptions.push(output);

  const diagnostics = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_COLLECTION_NAME);
  context.subscriptions.push(diagnostics);

  const state: ExtensionState = {
    root: undefined,
    config: undefined,
    toolchain: { rsharpIsDll: false },
    session: new RSharpSession(),
    collection: diagnostics,
    programStderr: '',
    showRustDetail: false,
  };

  // --- carga inicial -------------------------------------------------------
  reload(state, context);
  logStartup(state, output);

  // --- barra de estado ------------------------------------------------------
  const statusBar = createStatusBar({
    transpile: () => {
      void vscode.commands.executeCommand('rsharp.transpile');
    },
    build: () => {
      void vscode.commands.executeCommand('rsharp.build');
    },
    run: () => {
      void vscode.commands.executeCommand('rsharp.run');
    },
    buildWasm: () => {
      void vscode.commands.executeCommand('rsharp.buildWasm');
    },
    selectTarget: () => {
      void vscode.commands.executeCommand('rsharp.selectTarget');
    },
    showOutput: () => output.show(true),
  });
  context.subscriptions.push(statusBar);

  // --- vista lateral --------------------------------------------------------
  const tree = createProjectTree({
    getConfig: () => state.config ?? emptyConfig(),
    getToolchain: () => state.toolchain,
    openFolder: (target) => {
      void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target), false);
    },
    openFile: (target) => {
      void vscode.window.showTextDocument(vscode.Uri.file(target));
    },
    listGeneratedFiles: (outputDir) => listGeneratedFiles(outputDir),
  });
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('rsharp.explorer', tree),
  );
  context.subscriptions.push(tree);

  const refresh = (): void => {
    reload(state, context);
    const config = state.config;
    statusBar.update({
      target: config?.target ?? 'native',
      profile: config?.profile ?? 'debug',
      toolchainOk: state.toolchain.rsharp !== undefined,
      projectFound: state.root !== undefined,
    });
    tree.refresh();
  };

  // --- comandos -------------------------------------------------------------
  const cli = new RSharpCli({
    tool: state.toolchain,
    cwd: state.root ?? process.cwd(),
    logger: (message) => output.append(message),
  });

  context.subscriptions.push(
    ...registerCommands({
      getConfig: () => state.config ?? emptyConfig(),
      getToolchain: () => state.toolchain,
      getCli: () => cli,
      log: (message) => output.appendLine(message),
      logError: (message) => output.appendLine(`[error] ${message}`),
      info: (message) => void vscode.window.showInformationMessage(message),
      refresh,
      getRoot: () => state.root,
      getState: () => context.workspaceState,
      getOutput: () => output,
      onCliResult: (result) => handleCliResult(state, context, result, output),
      onProgramOutput: (text, stream) => handleProgramOutput(state, text, stream, output),
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('rsharp.showOutput', () => output.show(true)),
    vscode.commands.registerCommand('rsharp.selectTarget', () => selectTarget(context, refresh)),
    vscode.commands.registerCommand('rsharp.selectProfile', () => selectProfile(context, refresh)),
    vscode.commands.registerCommand('rsharp.openGeneratedRust', () => openGeneratedRust(state)),
    vscode.commands.registerCommand('rsharp.copyGeneratedRust', () => copyGeneratedRust(state)),
    vscode.commands.registerCommand('rsharp.restartLanguageServer', () => restartLanguageServer()),
    vscode.commands.registerCommand('rsharp.toggleCSharpAssociation', () =>
      toggleCSharpAssociation(context),
    ),
    vscode.commands.registerCommand('rsharp.showToolchainStatus', () =>
      showToolchainStatus(state),
    ),
    vscode.commands.registerCommand('rsharp.debug', () => startDebugSession(state, output)),
    vscode.commands.registerCommand('rsharp.toggleRustDetail', () => {
      state.showRustDetail = !state.showRustDetail;
      void vscode.window.showInformationMessage(
        state.showRustDetail
          ? 'R#: se mostrará el detalle de Rust en los errores.'
          : 'R#: los errores se mostrarán solo en el archivo .rsh.',
      );
    }),
  );

  // --- depuración -----------------------------------------------------------
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      DEBUGGER_TYPE,
      new RSharpDebugConfigurationProvider({
        getSession: () => state.session.get(),
        getConfig: () => state.config ?? emptyConfig(),
      }),
    ),
  );

  // --- reacción a cambios ---------------------------------------------------
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('rsharp')) {
        refresh();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => refresh()),
  );

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(state.root ?? context.extensionPath), TOML_FILE_NAME),
  );
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(() => refresh()),
    watcher.onDidChange(() => refresh()),
    watcher.onDidDelete(() => refresh()),
  );
}

/**
 * Limpia el estado al deactivate la extensión.
 */
export function deactivate(): void {
  // Nada que liberar: los recursos se registran en `context.subscriptions`.
}

// ---------------------------------------------------------------------------
// Carga de configuración
// ---------------------------------------------------------------------------

/**
 * Recalcula la configuración del proyecto y el toolchain.
 */
function reload(state: ExtensionState, context: vscode.ExtensionContext): void {
  state.root = findProjectRoot();

  const settings = vscode.workspace.getConfiguration(
    'rsharp',
    state.root ? vscode.Uri.file(state.root) : undefined,
  );
  const config = loadProjectConfig(state.root ?? context.extensionPath, {
    outputDir: context.workspaceState.get<string>(STATE_OUTPUT_DIR) ?? settings.get<string>('outputDir'),
    distDir: context.workspaceState.get<string>(STATE_DIST_DIR) ?? settings.get<string>('distDir'),
    target: settings.get<string>('target'),
    profile: settings.get<string>('profile'),
  });
  state.config = config;

  state.toolchain = resolveToolchain({
    cliPath: settings.get<string>('cliPath'),
    dotnetPath: settings.get<string>('dotnetPath'),
    cargoPath: settings.get<string>('cargoPath'),
    autoDetect: settings.get<boolean>('autoDetectToolchain') ?? true,
  });

  // El perfil y el destino elegidos en la UI tienen prioridad sobre el
  // ajuste por defecto, pero no sobre `rsharp.toml` (spec §14.4).
  const runTarget = context.workspaceState.get<RSharpTarget>(STATE_RUN_TARGET);
  const profile = context.workspaceState.get<RSharpProfile>(STATE_PROFILE);
  if (runTarget && config.source !== 'toml') {
    config.target = runTarget;
  }
  if (profile && config.source !== 'toml') {
    config.profile = profile;
  }

  loadSession(state);
}

/**
 * Busca la carpeta que contiene un `rsharp.toml`.
 */
function findProjectRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  for (const folder of folders) {
    if (fs.existsSync(path.join(folder.uri.fsPath, TOML_FILE_NAME))) {
      return folder.uri.fsPath;
    }
  }
  return undefined;
}

/**
 * Carga la sesión guardada en la carpeta de salida.
 *
 * Los source maps sobreviven a un reinicio de VSCode, de modo que los
 * errores de Rust se pueden seguir traduciendo al `.rsh`.
 */
function loadSession(state: ExtensionState): void {
  const config = state.config;
  if (!config) {
    return;
  }
  const sessionFile = path.join(config.outputDir, SESSION_FILE_NAME);
  try {
    if (fs.existsSync(sessionFile)) {
      state.session.deserialize(fs.readFileSync(sessionFile, 'utf8'));
    }
  } catch {
    // Una sesión corrupta no debe impedir usar la extensión.
  }
}

/**
 * Guarda la sesión en la carpeta de salida.
 */
function saveSession(state: ExtensionState): void {
  const config = state.config;
  if (!config) {
    return;
  }
  try {
    fs.mkdirSync(config.outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(config.outputDir, SESSION_FILE_NAME),
      state.session.serialize(),
      'utf8',
    );
  } catch {
    // Si no se puede guardar, la sesión sigue viva en memoria.
  }
}

/**
 * Escribe el estado inicial en el panel de salida.
 */
function logStartup(state: ExtensionState, output: vscode.OutputChannel): void {
  output.appendLine('R# (Rust#) — extensión activa.');
  if (!state.root) {
    output.appendLine(
      `No se encontró ${TOML_FILE_NAME} en el workspace. Crea uno o abre una carpeta con un proyecto R#.`,
    );
    return;
  }
  output.appendLine(`Proyecto: ${state.root}`);
  const config = state.config;
  if (config) {
    output.appendLine(`  salida:   ${config.outputDir}`);
    output.appendLine(`  dist:     ${config.distDir}`);
    output.appendLine(`  destino:  ${config.target}`);
    output.appendLine(`  perfil:   ${config.profile}`);
    for (const warning of config.warnings) {
      output.appendLine(`  aviso: ${warning}`);
    }
  }
  output.appendLine(
    `Toolchain: dotnet=${state.toolchain.dotnet ?? 'no encontrado'}, ` +
      `cargo=${state.toolchain.cargo ?? 'no encontrado'}, ` +
      `rsharp=${state.toolchain.rsharp ?? 'no encontrado'}`,
  );
}

/** Configuración vacía, para cuando todavía no hay proyecto. */
function emptyConfig(): ResolvedConfig {
  return {
    projectRoot: '',
    toml: null,
    outputDir: '',
    distDir: '',
    target: 'native',
    profile: 'debug',
    source: 'default',
    warnings: [],
  };
}

/** Lista los ficheros Rust generados en la carpeta de salida. */
function listGeneratedFiles(outputDir: string): string[] {
  if (!outputDir || !fs.existsSync(outputDir)) {
    return [];
  }
  const found: string[] = [];
  const walk = (directory: string, depth: number): void => {
    if (depth > 3) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'target' || entry.name === '.git') {
          continue;
        }
        walk(full, depth + 1);
      } else if (entry.name.endsWith('.rs')) {
        found.push(full);
      }
    }
  };
  walk(outputDir, 0);
  return found.sort();
}

// ---------------------------------------------------------------------------
// Resultado de la CLI
// ---------------------------------------------------------------------------

/**
 * Publica los diagnósticos que devuelve la CLI.
 *
 * - Los diagnósticos de R# llegan ya posicionados en el `.rsh`.
 * - Los errores de `rustc` llegan en `cargo.stderr` y se traducen con los
 *   source maps, de forma que el usuario ve el error en su archivo.
 */
function handleCliResult(
  state: ExtensionState,
  context: vscode.ExtensionContext,
  result: CliResult,
  output: vscode.OutputChannel,
): void {
  const config = state.config;
  if (!config) {
    return;
  }

  const envelope = result.envelope;
  const diagnostics = envelope?.diagnostics ?? [];
  const sourceMaps = envelope?.sourceMaps ?? [];
  const files = envelope?.files ?? [];

  state.session.update({
    projectRoot: config.projectRoot,
    outputDir: config.outputDir,
    distDir: config.distDir,
    target: config.target,
    profile: config.profile,
    sourceMaps: sourceMaps.length > 0 ? sourceMaps : state.session.get()?.sourceMaps ?? [],
    generatedFiles: files.length > 0 ? files : state.session.get()?.generatedFiles ?? [],
    artifact: envelope?.artifact ?? state.session.get()?.artifact,
  });
  saveSession(state);

  // La salida de `cargo` contiene los errores de `rustc` en el Rust generado:
  // se traducen a la línea del `.rsh` con los source maps.
  const cargoOutput = [envelope?.cargo?.stderr, envelope?.cargo?.stdout]
    .filter((text): text is string => typeof text === 'string' && text.length > 0)
    .join('\n');

  publishAll(state, diagnostics, sourceMaps, cargoOutput);
  void context;
  void output;
}

/**
 * Publica diagnósticos de R# y de Rust en la colección del editor.
 */
function publishAll(
  state: ExtensionState,
  diagnostics: RSharpDiagnostic[],
  sourceMaps: RSharpSourceMap[],
  cargoOutput: string,
): void {
  const config = state.config;
  if (!config) {
    return;
  }
  const collection = state.collection;
  const showRust = vscode.workspace
    .getConfiguration('rsharp')
    .get<boolean>('showRustDiagnostics') ?? true;

  publishRSharpDiagnostics(collection, diagnostics, config.projectRoot);

  if (!showRust || cargoOutput.trim().length === 0) {
    return;
  }

  const rustDiagnostics = parseCargoOutput(cargoOutput);
  publishRustDiagnostics(collection, rustDiagnostics, sourceMaps, config.projectRoot);

  for (const rustDiagnostic of rustDiagnostics) {
    const clean = mapRustDiagnostic(rustDiagnostic, sourceMaps);
    // El detalle de Rust (código y fragmento) solo se enseña si el usuario
    // lo pide de forma explícita.
    if (state.showRustDetail) {
      void vscode.window.showErrorMessage(
        formatCleanDiagnostic(clean, { showRustDetail: true }),
      );
    } else {
      const location = clean.location
        ? `${clean.location.file}:${clean.location.line}`
        : undefined;
      const summary = clean.help
        ? `${clean.message} (${clean.help.split('\n')[0]})`
        : clean.message;
      void vscode.window.showErrorMessage(
        location ? `R#: ${summary} — ${location}` : `R#: ${summary}`,
      );
    }
  }
}

/**
 * Traduce un pánico de Rust a la línea del `.rsh` y lo publica.
 */
function handleProgramOutput(
  state: ExtensionState,
  text: string,
  stream: 'stdout' | 'stderr',
  output: vscode.OutputChannel,
): void {
  if (stream !== 'stderr') {
    return;
  }
  state.programStderr = (state.programStderr + text).slice(-64_000);

  const panics = findRustPanics(state.programStderr);
  if (panics.length === 0) {
    return;
  }

  const maps = state.session.get()?.sourceMaps ?? [];
  const root = state.config?.projectRoot ?? '';
  const clean = panics.map((panic) =>
    mapPanic(panic, (file, line) => resolveRustLocation(file, line, maps)),
  );

  publishCleanDiagnostics(state.collection, clean, root);

  for (const diagnostic of clean) {
    output.appendLine(formatCleanDiagnostic(diagnostic, { showRustDetail: state.showRustDetail }));
  }
  const summary = summarizeCleanDiagnostics(clean);
  if (summary) {
    void vscode.window.showErrorMessage(summary);
  }
}

// ---------------------------------------------------------------------------
// Comandos auxiliares
// ---------------------------------------------------------------------------

/** Permite elegir el destino de compilación. */
async function selectTarget(context: vscode.ExtensionContext, refresh: () => void): Promise<void> {
  const items = RSPHARP_TARGETS.map((target) => ({
    label: target,
    description: target === 'native' ? 'Binario nativo' : 'Módulo WebAssembly',
    target,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: 'R#: destino de compilación',
    placeHolder: 'Elige el destino',
  });
  if (!picked) {
    return;
  }
  await context.workspaceState.update(STATE_RUN_TARGET, picked.target);
  refresh();
}

/** Permite elegir el perfil de compilación. */
async function selectProfile(context: vscode.ExtensionContext, refresh: () => void): Promise<void> {
  const items = RSPHARP_PROFILES.map((profile) => ({
    label: profile,
    description: profile === 'release' ? 'Con optimizaciones' : 'Sin optimizaciones',
    profile,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: 'R#: perfil de compilación',
    placeHolder: 'Elige el perfil',
  });
  if (!picked) {
    return;
  }
  await context.workspaceState.update(STATE_PROFILE, picked.profile);
  refresh();
}

/** Abre el fichero Rust generado en un editor. */
async function openGeneratedRust(state: ExtensionState): Promise<void> {
  const config = state.config;
  if (!config) {
    return;
  }
  const files = listGeneratedFiles(config.outputDir);
  if (files.length === 0) {
    void vscode.window.showInformationMessage(
      'R#: todavía no hay Rust generado. Ejecuta «R#: Transpile» primero.',
    );
    return;
  }
  const picked = await vscode.window.showQuickPick(
    files.map((file) => ({ label: path.relative(config.outputDir, file), file })),
    { title: 'R#: abrir el Rust generado' },
  );
  if (picked) {
    await vscode.window.showTextDocument(vscode.Uri.file(picked.file));
  }
}

/** Copia el fichero Rust generado al portapapeles. */
async function copyGeneratedRust(state: ExtensionState): Promise<void> {
  const config = state.config;
  if (!config) {
    return;
  }
  const files = listGeneratedFiles(config.outputDir);
  if (files.length === 0) {
    void vscode.window.showInformationMessage(
      'R#: todavía no hay Rust generado. Ejecuta «R#: Transpile» primero.',
    );
    return;
  }
  const picked = await vscode.window.showQuickPick(
    files.map((file) => ({ label: path.relative(config.outputDir, file), file })),
    { title: 'R#: copiar el Rust generado' },
  );
  if (!picked) {
    return;
  }
  const content = await fs.promises.readFile(picked.file, 'utf8');
  await vscode.env.clipboard.writeText(content);
  void vscode.window.showInformationMessage(`R#: copiado ${picked.label}.`);
}

/** Reinicia el servidor de lenguaje de C# (Roslyn / C# Dev Kit). */
async function restartLanguageServer(): Promise<void> {
  const commands = await vscode.commands.getCommands(true);
  const candidates = [
    'C#: Restart Language Server',
    'dotnet.restartLanguageServer',
    'csharp.restartLanguageServer',
  ];
  for (const candidate of candidates) {
    if (commands.includes(candidate)) {
      await vscode.commands.executeCommand(candidate);
      void vscode.window.showInformationMessage('R#: servidor de lenguaje de C# reiniciado.');
      return;
    }
  }
  void vscode.window.showWarningMessage(
    'R#: no se encontró el servidor de lenguaje de C#. Instala C# Dev Kit para tener autocompletado y diagnóstico en los archivos .rsh.',
  );
}

/** Alterna la asociación de `*.rsh` con el lenguaje `csharp`. */
async function toggleCSharpAssociation(context: vscode.ExtensionContext): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('files');
  const associations = configuration.get<Record<string, string>>('associations') ?? {};
  const current = associations['*.rsh'];

  const next: Record<string, string> = { ...associations };
  if (current === 'csharp') {
    delete next['*.rsh'];
  } else {
    next['*.rsh'] = 'csharp';
  }

  await configuration.update(
    'associations',
    next,
    vscode.ConfigurationTarget.Workspace,
  );
  void vscode.window.showInformationMessage(
    current === 'csharp'
      ? 'R#: los archivos .rsh usan la gramática propia de R#.'
      : 'R#: los archivos .rsh usan el lenguaje csharp (Roslyn / C# Dev Kit).',
  );
  void context;
}

/** Muestra el estado del toolchain. */
async function showToolchainStatus(state: ExtensionState): Promise<void> {
  const tool = state.toolchain;
  const lines = [
    `dotnet: ${tool.dotnet ?? 'no encontrado'}`,
    `cargo:  ${tool.cargo ?? 'no encontrado'}`,
    `rsharp: ${tool.rsharp ?? 'no encontrado'}${tool.rsharpIsDll ? ' (DLL)' : ''}`,
    `proyecto: ${state.root ?? 'no encontrado'}`,
  ];
  const choice = await vscode.window.showInformationMessage(
    lines.join('\n'),
    'Abrir ajustes',
  );
  if (choice === 'Abrir ajustes') {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'rsharp');
  }
}

/**
 * Arranca una sesión de depuración con CodeLLDB.
 *
 * Si el depurador no está instalado, se ofrece instalarlo. Los puntos de
 * parada en archivos `.rsh` se traducen a Rust con los source maps.
 */
async function startDebugSession(
  state: ExtensionState,
  output: vscode.OutputChannel,
): Promise<void> {
  const config = state.config;
  if (!config) {
    void vscode.window.showInformationMessage(
      'R#: no hay un proyecto R# activo (falta rsharp.toml).',
    );
    return;
  }

  if (!(await isDebuggerInstalled())) {
    const choice = await vscode.window.showWarningMessage(
      'R#: la depuración necesita CodeLLDB. ¿Instalarlo?',
      'Instalar',
      'Cancelar',
    );
    if (choice === 'Instalar') {
      await vscode.commands.executeCommand(
        'workbench.extensions.installExtension',
        'vadimcn.vscode-lldb',
      );
    }
    return;
  }

  const session = state.session.get();
  const program = session?.artifact ?? path.join(config.distDir, config.toml?.project.name ?? '');
  if (!program || !fs.existsSync(program)) {
    void vscode.window.showWarningMessage(
      'R#: no hay binario compilado. Ejecuta «R#: Build» antes de depurar.',
    );
    return;
  }

  output.appendLine(`R#: iniciando la depuración de ${program}`);
  await vscode.debug.startDebugging(
    vscode.workspace.getWorkspaceFolder(vscode.Uri.file(config.projectRoot)),
    {
      type: DEBUGGER_TYPE,
      request: 'launch',
      name: 'R#: depurar (nativo)',
      program,
      cwd: config.projectRoot,
      args: [],
      stopAtEntry: false,
    },
    { noDebug: false },
  );
}
