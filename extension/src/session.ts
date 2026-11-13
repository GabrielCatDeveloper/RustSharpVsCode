/**
 * Estado de la última sesión de R# (transpilación o compilación).
 *
 * La extensión necesita recordar, entre comandos, qué se generó por última
 * vez: los source maps para traducir errores de Rust a líneas del `.rsh`, el
 * artefacto compilado y las rutas efectivas del proyecto.
 *
 * Este módulo NO importa `vscode`: es lógica pura y se prueba en Node.
 */

import type {
  RSharpGeneratedFile,
  RSharpProfile,
  RSharpSourceMap,
  RSharpTarget,
} from './types';

/** Estado completo de la sesión. */
export interface SessionState {
  /** Raíz del proyecto R#. */
  projectRoot: string;
  /** Carpeta con el Rust generado. */
  outputDir: string;
  /** Carpeta con el binario compilado. */
  distDir: string;
  /** Destino de la última operación. */
  target: RSharpTarget;
  /** Perfil de la última operación. */
  profile: RSharpProfile;
  /** Binario o módulo generado (si la CLI lo informa). */
  artifact?: string;
  /** Source maps devueltos por la última transpilación. */
  sourceMaps: RSharpSourceMap[];
  /** Ficheros generados por la última transpilación. */
  generatedFiles: RSharpGeneratedFile[];
  /** Marca de tiempo (epoch ms). */
  updatedAt: number;
}

/** Nombre del fichero donde se persiste la sesión. */
export const SESSION_FILE_NAME = '.rsharp-session.json';

/**
 * Almacena el estado de la sesión.
 *
 * La extensión lo persiste en la carpeta de salida para que sobreviva a un
 * reinicio de VSCode: al volver a depurar, los source maps siguen estando.
 */
export class RSharpSession {
  private state: SessionState | undefined;

  /** Estado actual (o `undefined` si todavía no se ha transpilado nada). */
  get(): SessionState | undefined {
    return this.state;
  }

  /** Actualiza el estado con los campos indicados y devuelve el resultado. */
  update(patch: Partial<SessionState>): SessionState {
    const base: SessionState = this.state ?? {
      projectRoot: '',
      outputDir: '',
      distDir: '',
      target: 'native',
      profile: 'debug',
      sourceMaps: [],
      generatedFiles: [],
      updatedAt: 0,
    };

    this.state = {
      ...base,
      ...patch,
      updatedAt: Date.now(),
    };
    return this.state;
  }

  /** Borra el estado (por ejemplo, tras una limpieza). */
  clear(): void {
    this.state = undefined;
  }

  /** Serializa el estado a JSON. */
  serialize(): string {
    return JSON.stringify(this.state ?? null, null, 2);
  }

  /** Carga un estado serializado. Devuelve `undefined` si no es válido. */
  deserialize(text: string): SessionState | undefined {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null) {
        return undefined;
      }
      const candidate = parsed as Partial<SessionState>;
      if (typeof candidate.projectRoot !== 'string') {
        return undefined;
      }
      this.state = {
        projectRoot: candidate.projectRoot,
        outputDir: candidate.outputDir ?? '',
        distDir: candidate.distDir ?? '',
        target: candidate.target ?? 'native',
        profile: candidate.profile ?? 'debug',
        artifact: candidate.artifact,
        sourceMaps: Array.isArray(candidate.sourceMaps) ? candidate.sourceMaps : [],
        generatedFiles: Array.isArray(candidate.generatedFiles) ? candidate.generatedFiles : [],
        updatedAt: candidate.updatedAt ?? Date.now(),
      };
      return this.state;
    } catch {
      return undefined;
    }
  }
}
