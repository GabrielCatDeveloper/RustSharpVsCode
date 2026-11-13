/**
 * Vista lateral del proyecto R# (Rust#).
 *
 * Ver rsharp-spec.md §14.3 ("Vista lateral con las rutas actuales") y §14.4
 * (prioridad de `rsharp.toml` sobre los ajustes de VSCode).
 *
 * La vista muestra, en secciones: el proyecto, la configuración efectiva, las
 * rutas de salida y distribución, el estado del toolchain y los archivos Rust
 * ya generados.
 *
 * Nota importante: la vista registra por su cuenta dos comandos internos
 * (`rsharp.tree.openFolder` y `rsharp.tree.openFile`, con un sufijo si hay más
 * de una vista viva) para que los nodos con ruta sean clicables. El código de
 * la extensión no tiene que registrarlos.
 */

// El enunciado pide el import solo de tipos; además hace falta el módulo en
// tiempo de ejecución para construir los objetos de interfaz (`TreeItem`,
// `ThemeIcon`), que no se pueden crear con un import de tipo.
import type * as vscode from 'vscode';
import * as vscodeApi from 'vscode';

import * as path from 'node:path';

import type { ResolvedConfig } from './config';
import type { ToolPaths } from './toolchain';

export interface TreeDependencies {
  getConfig(): ResolvedConfig;
  getToolchain(): ToolPaths;
  /** Abre una carpeta en el explorador de VSCode. */
  openFolder(path: string): void | Promise<void>;
  /** Abre un archivo en un editor. */
  openFile(path: string): void | Promise<void>;
  /** Lista los archivos Rust generados en la carpeta de salida. */
  listGeneratedFiles(outputDir: string): string[];
}

export interface ProjectTreeProvider extends vscode.TreeDataProvider<TreeNodeData> {
  refresh(): void;
  dispose(): void;
}

export interface TreeNodeData {
  /** 'section' | 'project' | 'path' | 'tool' | 'file' | 'info' */
  kind: 'section' | 'project' | 'path' | 'tool' | 'file' | 'info';
  label: string;
  description?: string;
  tooltip?: string;
  /** Ruta absoluta a la que apunta el nodo. */
  path?: string;
}

/** Prefijo de los comandos internos que usa la vista. */
const OPEN_FOLDER_COMMAND_PREFIX = 'rsharp.tree.openFolder';

/** Prefijo del comando interno que abre un archivo en un editor. */
const OPEN_FILE_COMMAND_PREFIX = 'rsharp.tree.openFile';

/**
 * Contador de vistas creadas.
 *
 * Cada vista registra sus propios comandos, así que dos vistas vivas a la vez
 * (o una vista recreada sin liberar la anterior) no chocan con el registro de
 * comandos de VSCode, que rechaza los identificadores repetidos.
 */
let viewCounter = 0;

/** Identificadores de las secciones de la vista. */
type SectionId = 'proyecto' | 'configuracion' | 'rutas' | 'toolchain' | 'generado';

/**
 * Nodo interno: un {@link TreeNodeData} con los datos que solo necesita la
 * vista (sección a la que pertenece e icono explícito).
 */
interface InternalNode extends TreeNodeData {
  /** Sección a la que pertenece el nodo (solo en nodos de tipo 'section'). */
  section?: SectionId;
  /** Codicon explícito del nodo, sin los `$()` del texto de la barra. */
  icon?: string;
}

/** `ToolPaths` con las versiones opcionales que pueda añadir el descubrimiento. */
type ToolPathsWithVersions = ToolPaths & { versions?: Record<string, string> };

/** Icono de cada sección de la vista. */
const SECTION_ICONS: Readonly<Record<SectionId, string>> = {
  proyecto: 'project',
  configuracion: 'settings-gear',
  rutas: 'folder',
  toolchain: 'tools',
  generado: 'file-code',
};

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

/** Ruta relativa a la raíz del proyecto; si está fuera, se devuelve la absoluta. */
function relativeTo(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (relative === '') return '.';
  if (path.isAbsolute(relative) || relative.startsWith('..')) return target;
  return relative;
}

/** Versión de una herramienta, si la información está disponible. */
function toolVersion(tools: ToolPaths, key: string): string | undefined {
  const withVersions: ToolPathsWithVersions = tools;
  const version = withVersions.versions?.[key];
  return version !== undefined && version.length > 0 ? version : undefined;
}

/** Nodo de una herramienta con su estado (✔/✘) y su ruta. */
function toolNode(tools: ToolPaths, label: string, toolPath: string | undefined): InternalNode {
  const found = typeof toolPath === 'string' && toolPath.length > 0;
  const version = toolVersion(tools, label);
  const mark = found ? '✔' : '✘';
  const description = found ? (version ?? toolPath ?? '') : 'no encontrado';
  const tooltip = found
    ? `Ruta: ${toolPath ?? ''}${version === undefined ? '' : `\nVersión: ${version}`}`
    : `No se encontró "${label}" en el sistema.`;
  return {
    kind: 'tool',
    label: `${label} ${mark}`,
    description,
    tooltip,
    icon: found ? 'check' : 'error',
  };
}

/** Icono por defecto según el tipo de nodo. */
function defaultIcon(kind: TreeNodeData['kind']): string {
  switch (kind) {
    case 'section':
      return 'folder';
    case 'project':
      return 'project';
    case 'path':
      return 'folder';
    case 'tool':
      return 'check';
    case 'file':
      return 'file-code';
    case 'info':
      return 'symbol-value';
    default:
      return 'symbol-value';
  }
}

/** Comando asociado a un nodo, si el nodo apunta a una ruta. */
function commandFor(
  element: TreeNodeData,
  openFolderCommand: string,
  openFileCommand: string,
): vscodeApi.Command | undefined {
  if (element.path === undefined) return undefined;
  if (element.kind === 'file') {
    return { command: openFileCommand, title: 'Abrir archivo', arguments: [element.path] };
  }
  if (element.kind === 'path' || element.kind === 'project') {
    return { command: openFolderCommand, title: 'Abrir carpeta', arguments: [element.path] };
  }
  return undefined;
}

/** Implementación del proveedor de la vista lateral. */
class ProjectTreeProviderImpl implements ProjectTreeProvider {
  private readonly deps: TreeDependencies;
  private readonly emitter: vscodeApi.EventEmitter<TreeNodeData | undefined | null | void>;
  readonly onDidChangeTreeData: vscodeApi.Event<TreeNodeData | undefined | null | void>;
  private readonly disposables: vscodeApi.Disposable[] = [];
  /** Comando interno que abre carpetas. */
  private readonly openFolderCommand: string;
  /** Comando interno que abre archivos. */
  private readonly openFileCommand: string;

  constructor(deps: TreeDependencies) {
    this.deps = deps;
    this.emitter = new vscodeApi.EventEmitter<TreeNodeData | undefined | null | void>();
    this.onDidChangeTreeData = this.emitter.event;

    viewCounter += 1;
    const suffix = viewCounter === 1 ? '' : String(viewCounter);
    this.openFolderCommand = `${OPEN_FOLDER_COMMAND_PREFIX}${suffix}`;
    this.openFileCommand = `${OPEN_FILE_COMMAND_PREFIX}${suffix}`;

    // Comandos internos: hacen clicables los nodos con ruta.
    this.disposables.push(
      vscodeApi.commands.registerCommand(this.openFolderCommand, (target: string) => {
        void guard(`No se pudo abrir la carpeta "${target}"`, () => deps.openFolder(target));
      }),
    );
    this.disposables.push(
      vscodeApi.commands.registerCommand(this.openFileCommand, (target: string) => {
        void guard(`No se pudo abrir el archivo "${target}"`, () => deps.openFile(target));
      }),
    );
  }

  /** Pide a VSCode que vuelva a pedir los nodos. */
  refresh(): void {
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  getTreeItem(element: TreeNodeData): vscodeApi.TreeItem {
    const collapsibleState =
      element.kind === 'section'
        ? vscodeApi.TreeItemCollapsibleState.Collapsed
        : vscodeApi.TreeItemCollapsibleState.None;

    const item = new vscodeApi.TreeItem(element.label, collapsibleState);
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.contextValue = element.kind;

    const internal: InternalNode = element;
    item.iconPath = new vscodeApi.ThemeIcon(internal.icon ?? defaultIcon(element.kind));

    const command = commandFor(element, this.openFolderCommand, this.openFileCommand);
    if (command !== undefined) {
      item.command = command;
    }

    return item;
  }

  getChildren(element?: TreeNodeData): TreeNodeData[] {
    if (element === undefined) {
      return this.buildSections();
    }
    if (element.kind !== 'section') {
      return [];
    }

    const internal: InternalNode = element;
    const section = internal.section;
    if (section === undefined) {
      return [];
    }

    try {
      switch (section) {
        case 'proyecto':
          return this.buildProjectSection();
        case 'configuracion':
          return this.buildConfigSection();
        case 'rutas':
          return this.buildPathsSection();
        case 'toolchain':
          return this.buildToolchainSection();
        case 'generado':
          return this.buildGeneratedSection();
        default:
          return [];
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return [{ kind: 'info', label: 'No se pudo leer el estado del proyecto', description: detail }];
    }
  }

  // --- secciones ----------------------------------------------------------

  private buildSections(): InternalNode[] {
    const sections: Array<[SectionId, string]> = [
      ['proyecto', 'Proyecto'],
      ['configuracion', 'Configuración'],
      ['rutas', 'Rutas'],
      ['toolchain', 'Toolchain'],
      ['generado', 'Rust generado'],
    ];
    return sections.map(([id, label]) => this.buildSection(id, label));
  }

  private buildSection(id: SectionId, label: string): InternalNode {
    return { kind: 'section', label, section: id, icon: SECTION_ICONS[id] };
  }

  /** Sección "Proyecto": nombre del proyecto y raíz. */
  private buildProjectSection(): InternalNode[] {
    const config = this.deps.getConfig();
    const name = config.toml?.project.name ?? path.basename(config.projectRoot) ?? config.projectRoot;
    const root = config.projectRoot;
    return [
      {
        kind: 'project',
        label: name,
        description: root,
        tooltip: `Proyecto: ${name}\n${root}`,
        path: root,
      },
      {
        kind: 'path',
        label: 'Raíz del proyecto',
        description: relativeTo(root, root),
        tooltip: root,
        path: root,
      },
    ];
  }

  /** Sección "Configuración": `rsharp.toml`, destino, perfil y sugar. */
  private buildConfigSection(): InternalNode[] {
    const config = this.deps.getConfig();
    const toml = config.toml;
    const nodes: InternalNode[] = [];

    if (toml !== null) {
      nodes.push({
        kind: 'file',
        label: 'rsharp.toml',
        description: relativeTo(config.projectRoot, toml.filePath),
        tooltip: toml.filePath,
        path: toml.filePath,
      });
    } else {
      nodes.push({
        kind: 'file',
        label: 'rsharp.toml',
        description: 'no encontrado',
        tooltip: `No se encontró "rsharp.toml" en ${config.projectRoot}.`,
      });
      nodes.push({
        kind: 'info',
        label: 'No se encontró rsharp.toml',
        description: config.projectRoot,
        tooltip:
          'Crea un archivo "rsharp.toml" en la raíz del proyecto para definir el destino, el perfil y el sugar.',
      });
    }

    nodes.push({
      kind: 'info',
      label: 'Destino',
      description: config.target,
      tooltip: 'Destino de compilación (`[build].target`).',
    });
    nodes.push({
      kind: 'info',
      label: 'Perfil',
      description: config.profile,
      tooltip: 'Perfil de compilación (`[build].profile`).',
    });

    if (toml !== null) {
      // El perfil activo puede sobrescribir valores de `[sugar]`.
      const overrides = toml.profiles[config.profile] ?? {};
      const effective = { ...toml.sugar, ...overrides };
      const suffix = (key: keyof typeof overrides): string =>
        overrides[key] === undefined ? '' : ' (perfil activo)';

      nodes.push({
        kind: 'info',
        label: 'Cadenas',
        description: effective.strings,
        tooltip: `Representación de cadenas (\`[sugar].strings\`)${suffix('strings')}.`,
      });
      nodes.push({
        kind: 'info',
        label: 'Desbordamiento',
        description: effective.overflow,
        tooltip: `Comportamiento ante desbordamiento (\`[sugar].overflow\`)${suffix('overflow')}.`,
      });
      nodes.push({
        kind: 'info',
        label: 'Reentrada',
        description: effective.reentrancy,
        tooltip: `Comportamiento ante reentrada (\`[sugar].reentrancy\`)${suffix('reentrancy')}.`,
      });
      nodes.push({
        kind: 'info',
        label: 'Finalizadores',
        description: effective.finalizers,
        tooltip: `Finalizadores deterministas (\`[sugar].finalizers\`)${suffix('finalizers')}.`,
      });
      nodes.push({
        kind: 'info',
        label: 'Ciclos',
        description: effective.cycles,
        tooltip: `Detección de ciclos (\`[sugar].cycles\`)${suffix('cycles')}.`,
      });
    }

    return nodes;
  }

  /** Sección "Rutas": carpeta de salida y carpeta de distribución. */
  private buildPathsSection(): InternalNode[] {
    const config = this.deps.getConfig();
    return [
      {
        kind: 'path',
        label: 'Carpeta de salida (outputDir)',
        description: relativeTo(config.projectRoot, config.outputDir),
        tooltip: config.outputDir,
        path: config.outputDir,
        icon: 'output',
      },
      {
        kind: 'path',
        label: 'Carpeta de distribución (distDir)',
        description: relativeTo(config.projectRoot, config.distDir),
        tooltip: config.distDir,
        path: config.distDir,
        icon: 'library',
      },
    ];
  }

  /** Sección "Toolchain": `dotnet`, `cargo` y `rsharp`. */
  private buildToolchainSection(): InternalNode[] {
    const tools = this.deps.getToolchain();
    return [toolNode(tools, 'dotnet', tools.dotnet), toolNode(tools, 'cargo', tools.cargo), toolNode(tools, 'rsharp', tools.rsharp)];
  }

  /** Sección "Rust generado": archivos Rust de la carpeta de salida. */
  private buildGeneratedSection(): InternalNode[] {
    const config = this.deps.getConfig();
    const files = this.deps.listGeneratedFiles(config.outputDir);
    if (files.length === 0) {
      return [
        {
          kind: 'info',
          label: 'Todavía no hay archivos Rust generados',
          description: relativeTo(config.projectRoot, config.outputDir),
          tooltip: 'Ejecuta "R#: Transpile" para generar el Rust en esta carpeta.',
        },
      ];
    }

    return files.map((file) => {
      const absolute = path.isAbsolute(file) ? file : path.resolve(config.outputDir, file);
      return {
        kind: 'file',
        label: path.basename(absolute),
        description: path.relative(config.outputDir, absolute),
        tooltip: absolute,
        path: absolute,
      };
    });
  }
}

/**
 * Crea el proveedor de la vista lateral del proyecto.
 *
 * @param deps fuentes de datos (configuración, toolchain) y acciones de apertura.
 */
export function createProjectTree(deps: TreeDependencies): ProjectTreeProvider {
  return new ProjectTreeProviderImpl(deps);
}
