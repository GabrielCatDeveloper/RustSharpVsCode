/**
 * Integración con el depurador.
 *
 * La spec §14.5 pide CodeLLDB con source maps y deja la depuración para una
 * versión posterior. Aquí se resuelve la parte que sí es posible sin un
 * compilador de R#: preparar la configuración de CodeLLDB y traducir los
 * puntos de parada que el usuario pone en un `.rsh` a las líneas del Rust
 * generado.
 *
 * La diferencia con TypeScript es real y conviene decirla: el depurador de
 * VSCode sabe mapear JavaScript a TypeScript porque TypeScript emite source
 * maps que LLDB/Node consumen. LLDB no tiene un mecanismo equivalente para
 * Rust, así que el punto de parada se traduce de línea y el depurador abre el
 * fichero Rust. Por eso la experiencia por defecto (R#: Run) no usa el
 * depurador: ejecuta el programa, traduce los pánicos al `.rsh` y nunca
 * muestra el Rust generado.
 */

import * as path from 'node:path';

import * as vscode from 'vscode';

import type { ResolvedConfig } from './config';
import type { SessionState } from './session';
import { resolveRshLocation } from './sourcemap';

/** Dependencias del proveedor de configuración de depuración. */
export interface DebugDependencies {
  /** Estado de la última compilación. */
  getSession(): SessionState | undefined;
  /** Configuración resuelta del proyecto. */
  getConfig(): ResolvedConfig;
}

/** Tipo de depurador que usa la extensión (CodeLLDB). */
export const DEBUGGER_TYPE = 'lldb';

/**
 * Proveedor de configuración de depuración.
 *
 * - `provideDebugConfigurations` ofrece una plantilla lista para usar.
 * - `resolveDebugConfiguration` rellena el programa, el directorio de trabajo
 *   y traduce los puntos de parada de `.rsh` a Rust.
 */
export class RSharpDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  constructor(private readonly deps: DebugDependencies) {}

  /** Plantilla de configuración que se ofrece en "launch.json". */
  provideDebugConfigurations(): vscode.DebugConfiguration[] {
    const config = this.deps.getConfig();
    const name = config.toml?.project.name ?? 'rsharp';
    return [
      {
        type: DEBUGGER_TYPE,
        request: 'launch',
        name: 'R#: depurar (nativo)',
        program: path.join(config.distDir, name),
        cwd: config.projectRoot,
        args: [],
        sourceLanguages: ['rust'],
        stopAtEntry: false,
        preLaunchTask: 'R#: Build',
      },
    ];
  }

  /**
   * Completa la configuración antes de arrancar la sesión.
   *
   * Traduce los puntos de parada: si el usuario marcó una línea de un `.rsh`,
   * se busca la línea equivalente del Rust generado con los source maps de la
   * última transpilación.
   */
  resolveDebugConfiguration(
    _folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): vscode.DebugConfiguration {
    const resolved: vscode.DebugConfiguration = { ...config };

    const session = this.deps.getSession();
    const projectConfig = this.deps.getConfig();

    if (!resolved.program && session?.artifact) {
      resolved.program = session.artifact;
    }
    if (!resolved.cwd) {
      resolved.cwd = projectConfig.projectRoot;
    }

    const breakpoints = resolved.breakpoints;
    if (Array.isArray(breakpoints) && session && session.sourceMaps.length > 0) {
      resolved.breakpoints = breakpoints.map((breakpoint) =>
        translateBreakpoint(
          breakpoint as BreakpointLike,
          session,
          projectConfig.projectRoot,
        ),
      );
    }

    return resolved;
  }
}

/**
 * Forma de un punto de parada dentro de `vscode.DebugConfiguration`.
 *
 * La API de VSCode no exporta un tipo público para esto, así que se declara
 * aquí la parte que la extensión necesita.
 */
interface BreakpointLike {
  path?: string;
  line?: number;
  [key: string]: unknown;
}

/**
 * Traduce un punto de parada de `.rsh` al Rust generado.
 *
 * Si no hay equivalencia, el punto de parada se deja intacto: es preferible
 * un punto mal colocado que un punto en un sitio incorrecto.
 */
function translateBreakpoint(
  breakpoint: BreakpointLike,
  session: SessionState,
  root: string,
): BreakpointLike {
  const file = breakpoint.path;
  if (!file || typeof breakpoint.line !== 'number') {
    return breakpoint;
  }
  if (!file.toLowerCase().endsWith('.rsh')) {
    return breakpoint;
  }

  const relative = path.isAbsolute(file) ? path.relative(root, file) : file;
  const candidates = [relative, file, path.basename(file)];

  for (const candidate of candidates) {
    const mapped = resolveRshLocation(candidate, breakpoint.line, session.sourceMaps);
    if (mapped) {
      const rustPath = path.isAbsolute(mapped.rustFile)
        ? mapped.rustFile
        : path.resolve(session.outputDir, mapped.rustFile);
      return {
        ...breakpoint,
        path: rustPath,
        line: mapped.rustLine,
      };
    }
  }

  return breakpoint;
}

/**
 * Indica si el depurador solicitado está instalado.
 *
 * `lldb` es el identificador de CodeLLDB. Si no está instalado, la extensión
 * lo avisa y ofrece instalarlo.
 */
export async function isDebuggerInstalled(): Promise<boolean> {
  const debuggerTypes = vscode.extensions.all.filter((extension) =>
    extension.id.toLowerCase().includes('lldb'),
  );
  if (debuggerTypes.length > 0) {
    return true;
  }
  const commands = await vscode.commands.getCommands(true);
  return commands.some((command) => command.startsWith('lldb.'));
}
