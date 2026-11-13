/**
 * Barra de estado de R# (Rust#).
 *
 * Ver rsharp-spec.md §14.3 ("Botones Transpile, Build y Run en la barra de
 * estado") y §14.4 ("Muestra el progreso en el panel de salida R#").
 *
 * La barra resume el estado del proyecto (destino, perfil, toolchain y
 * `rsharp.toml`) y da acceso a todas las acciones de la extensión mediante el
 * menú `rsharp.statusBarMenu`.
 *
 * Nota importante: `createStatusBar` registra el comando
 * `rsharp.statusBarMenu`. El código de la extensión **no** debe registrarlo
 * otra vez (VSCode rechaza los comandos duplicados); basta con invocarlo con
 * `vscode.commands.executeCommand('rsharp.statusBarMenu')`.
 */

// El enunciado pide el import solo de tipos; además hace falta el módulo en
// tiempo de ejecución para construir los objetos de interfaz (`StatusBarItem`,
// `MarkdownString`, `QuickPick`), que no se pueden crear con un import de tipo.
import type * as vscode from 'vscode';
import * as vscodeApi from 'vscode';

import type { RSharpTarget, RSharpProfile } from './types';

export interface StatusBarState {
  target: RSharpTarget;
  profile: RSharpProfile;
  /** La CLI rsharp está disponible. */
  toolchainOk: boolean;
  /** Se encontró un rsharp.toml en el workspace. */
  projectFound: boolean;
}

export interface StatusBarActions {
  transpile(): void | Promise<void>;
  build(): void | Promise<void>;
  run(): void | Promise<void>;
  buildWasm(): void | Promise<void>;
  selectTarget(): void | Promise<void>;
  showOutput(): void | Promise<void>;
}

export interface StatusBarController {
  readonly item: vscode.StatusBarItem;
  update(state: StatusBarState): void;
  dispose(): void;
}

/** Comando que abre el menú de acciones de la barra de estado. */
const MENU_COMMAND = 'rsharp.statusBarMenu';

/** Prioridad del elemento en la barra de estado (a la izquierda). */
const ITEM_PRIORITY = 10;

/** Nombre corto de cada destino, para que quepa en la barra de estado. */
const SHORT_TARGETS: Readonly<Record<RSharpTarget, string>> = {
  native: 'native',
  'wasm32-unknown-unknown': 'wasm32',
  'wasm32-wasip1': 'wasip1',
};

/** Nombres de las acciones del menú, en el mismo orden que la spec §14.2. */
const ACTION_LABELS = [
  'Transpile',
  'Build',
  'Run',
  'Build WASM',
  'Select target',
  'Show output',
] as const;

/** Estado mostrado hasta que la extensión informa del estado real. */
const INITIAL_STATE: StatusBarState = {
  target: 'native',
  profile: 'debug',
  toolchainOk: false,
  projectFound: false,
};

/** Entrada del menú rápido: una etiqueta y la acción que ejecuta. */
interface MenuEntry extends vscodeApi.QuickPickItem {
  /** Acción que se ejecuta al elegir la entrada. */
  run(): void | Promise<void>;
}

/**
 * Ejecuta una acción y convierte cualquier fallo en un mensaje de error.
 * Nunca deja rechazos de promesa sin atender.
 */
async function guard(context: string, action: () => void | Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    vscodeApi.window.showErrorMessage(`${context}: ${detail}`);
  }
}

/** Construye el texto de la barra según el estado del proyecto. */
function buildText(state: StatusBarState): string {
  if (!state.toolchainOk) return '$(warning) R#';
  if (!state.projectFound) return '$(file-directory) R#';
  const base = `$(tools) R# ${SHORT_TARGETS[state.target]}`;
  return state.profile === 'release' ? `${base} (release)` : base;
}

/** Construye el tooltip en Markdown: destino, perfil, toolchain y acciones. */
function buildTooltip(state: StatusBarState): string {
  const actions = ACTION_LABELS.join(' · ');
  return [
    '**R# (Rust#)**',
    '',
    `- Destino: \`${state.target}\``,
    `- Perfil: \`${state.profile}\``,
    `- Toolchain: ${state.toolchainOk ? '✔ disponible' : '✘ no disponible'}`,
    `- Proyecto: ${state.projectFound ? '✔ `rsharp.toml` encontrado' : '✘ no se encontró `rsharp.toml`'}`,
    '',
    `**Acciones:** ${actions}`,
  ].join('\n');
}

/** Construye las entradas del menú de acciones. */
function buildMenuEntries(actions: StatusBarActions): MenuEntry[] {
  return [
    {
      label: 'Transpile',
      description: 'Genera el Rust en la carpeta de salida',
      run: () => actions.transpile(),
    },
    {
      label: 'Build',
      description: 'Transpila y compila en la carpeta de distribución',
      run: () => actions.build(),
    },
    {
      label: 'Run',
      description: 'Compila y ejecuta el binario generado',
      run: () => actions.run(),
    },
    {
      label: 'Build WASM',
      description: 'Compila el proyecto a WebAssembly',
      run: () => actions.buildWasm(),
    },
    {
      label: 'Select target',
      description: 'Elige el destino de compilación',
      run: () => actions.selectTarget(),
    },
    {
      label: 'Show output',
      description: 'Muestra el panel de salida de R#',
      run: () => actions.showOutput(),
    },
  ];
}

/** Implementación del controlador de la barra de estado. */
class StatusBarControllerImpl implements StatusBarController {
  readonly item: vscode.StatusBarItem;
  private readonly actions: StatusBarActions;
  private readonly disposables: vscodeApi.Disposable[] = [];
  /** Último estado aplicado, para no tocar la barra si nada ha cambiado. */
  private state: StatusBarState | undefined;

  constructor(actions: StatusBarActions) {
    this.actions = actions;

    this.item = vscodeApi.window.createStatusBarItem(vscodeApi.StatusBarAlignment.Left, ITEM_PRIORITY);
    this.item.name = 'R#';
    this.item.command = { command: MENU_COMMAND, title: 'Acciones de R#' };
    this.item.text = buildText(INITIAL_STATE);
    this.item.tooltip = new vscodeApi.MarkdownString(buildTooltip(INITIAL_STATE));
    this.item.show();

    // El comando se registra aquí: la extensión solo lo invoca. Si ya existe
    // (por ejemplo, porque otra parte de la extensión lo registró antes), se
    // reutiliza el existente en lugar de romper la activación.
    try {
      this.disposables.push(
        vscodeApi.commands.registerCommand(MENU_COMMAND, () => {
          this.showMenu();
        }),
      );
    } catch {
      // El comando ya está registrado por otro sitio: el elemento sigue
      // funcionando porque su `command` apunta al identificador existente.
    }
  }

  /** Aplica el estado a la barra; solo la toca si algo ha cambiado. */
  update(state: StatusBarState): void {
    const previous = this.state;
    if (
      previous !== undefined &&
      previous.target === state.target &&
      previous.profile === state.profile &&
      previous.toolchainOk === state.toolchainOk &&
      previous.projectFound === state.projectFound
    ) {
      this.state = state;
      return;
    }

    this.state = state;
    this.item.text = buildText(state);
    this.item.tooltip = new vscodeApi.MarkdownString(buildTooltip(state));
  }

  /** Abre el menú rápido con todas las acciones. */
  private showMenu(): void {
    const picker = vscodeApi.window.createQuickPick<MenuEntry>();
    picker.title = 'R# (Rust#)';
    picker.placeholder = 'Acciones de R#';
    picker.matchOnDescription = true;
    picker.items = buildMenuEntries(this.actions);

    picker.onDidAccept(() => {
      const entry = picker.selectedItems[0] ?? picker.activeItems[0];
      picker.hide();
      if (entry !== undefined) {
        void guard(`No se pudo completar la acción "${entry.label}"`, entry.run);
      }
    });
    picker.onDidHide(() => {
      picker.dispose();
    });
    picker.show();
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.item.dispose();
  }
}

/**
 * Crea la barra de estado de R# y la registra en la interfaz.
 *
 * @param actions acciones que se ofrecen en el menú `rsharp.statusBarMenu`.
 */
export function createStatusBar(actions: StatusBarActions): StatusBarController {
  return new StatusBarControllerImpl(actions);
}
