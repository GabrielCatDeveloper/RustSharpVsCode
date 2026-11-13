/**
 * Diagnósticos "limpios" al estilo TypeScript.
 *
 * TypeScript nunca muestra el JavaScript generado al programmer: cuando algo
 * falla, muestra el error en la línea del `.ts`. R# aplica el mismo criterio:
 * el Rust transpilado es un producto intermedio (§1) y el usuario no debe
 * necesitar abrirlo para entender un fallo.
 *
 * Este módulo traduce el ruido de `rustc` (código de error, fichero Rust,
 * fragmento de código) a un diagnóstico corto con la ubicación en el `.rsh`.
 *
 * Este módulo NO importa `vscode`: es lógica pura y se prueba en Node.
 */

import type { RSharpSourceMap, RustDiagnostic } from './types';
import { resolveRustLocation } from './sourcemap';

/** Severidad de un diagnóstico limpio. */
export type CleanSeverity = 'error' | 'warning';

/** Ubicación dentro de un archivo. */
export interface CleanLocation {
  /** Ruta del archivo (relativa al proyecto cuando se puede). */
  file: string;
  /** Línea 1-based. */
  line: number;
  /** Columna 1-based. */
  column?: number;
}

/**
 * Diagnóstico tal y como se muestra al usuario.
 *
 * `location` apunta al archivo R# (lo que el usuario ha escrito).
 * `rustLocation` conserva la posición original en el Rust generado, por si
 * hace falta depurar a nivel de Rust.
 */
export interface CleanDiagnostic {
  severity: CleanSeverity;
  /** Código de rustc (`E0308`) o código de R# (`R#0042`). */
  code?: string;
  message: string;
  /** Ubicación en el archivo R# original. */
  location?: CleanLocation;
  /** Ubicación original en el Rust generado. */
  rustLocation?: CleanLocation;
  help?: string;
  /** Salida original de rustc (solo se muestra si el usuario lo pide). */
  raw?: string;
}

/** Etiqueta visible del origen del error. */
const SOURCE_LABEL = 'R#';

/**
 * Traduce un diagnóstico de `rustc` al formato limpio, usando los source maps
 * para apuntar a la línea del `.rsh`.
 *
 * Si no hay source map que corresponda, la ubicación de Rust se conserva como
 * `rustLocation` y no se inventa una ubicación de R#.
 */
export function mapRustDiagnostic(
  diagnostic: RustDiagnostic,
  maps: RSharpSourceMap[],
): CleanDiagnostic {
  const clean: CleanDiagnostic = {
    severity: diagnostic.severity === 'warning' ? 'warning' : 'error',
    message: diagnostic.message,
  };

  if (diagnostic.code) {
    clean.code = diagnostic.code;
  }
  if (diagnostic.help) {
    clean.help = diagnostic.help;
  }
  if (diagnostic.raw) {
    clean.raw = diagnostic.raw;
  }

  if (diagnostic.file) {
    const rustLocation: CleanLocation = {
      file: diagnostic.file,
      line: diagnostic.line ?? 1,
      column: diagnostic.column,
    };
    clean.rustLocation = rustLocation;

    if (diagnostic.line !== undefined) {
      const mapped = resolveRustLocation(diagnostic.file, diagnostic.line, maps);
      if (mapped) {
        clean.location = {
          file: mapped.rshFile,
          line: mapped.rshLine,
          column: diagnostic.column,
        };
      }
    }
  }

  return clean;
}

/**
 * Formatea un diagnóstico limpio con el formato de TypeScript:
 *
 * ```text
 * R# error [E0308]: mismatched types
 *   src/main.rsh:12:5
 *   help: expected `i32`, found `&str`
 * ```
 *
 * `showRustDetail` añade la ubicación en el Rust generado, pero nunca el
 * fragmento de código Rust: el código generado no se enseña salvo que el
 * usuario lo pida de forma explícita.
 */
export function formatCleanDiagnostic(
  diagnostic: CleanDiagnostic,
  options?: { showRustDetail?: boolean },
): string {
  const lines: string[] = [];
  const label = diagnostic.severity === 'warning' ? 'warning' : 'error';
  const code = diagnostic.code ? ` [${diagnostic.code}]` : '';
  lines.push(`${SOURCE_LABEL} ${label}${code}: ${diagnostic.message}`);

  if (diagnostic.location) {
    lines.push(`  ${formatLocation(diagnostic.location)}`);
  }
  if (options?.showRustDetail && diagnostic.rustLocation) {
    lines.push(`  (Rust: ${formatLocation(diagnostic.rustLocation)})`);
  }
  if (diagnostic.help) {
    for (const helpLine of diagnostic.help.split(/\r?\n/)) {
      lines.push(`  help: ${helpLine}`);
    }
  }
  return lines.join('\n');
}

/** Formatea una ubicación como `fichero:línea:columna`. */
function formatLocation(location: CleanLocation): string {
  const column = location.column !== undefined ? `:${location.column}` : '';
  return `${location.file}:${location.line}${column}`;
}

/**
 * Resume varios diagnósticos en una línea, como hace el compilador de
 * TypeScript ("Found 3 errors in 2 files").
 */
export function summarizeCleanDiagnostics(
  diagnostics: CleanDiagnostic[],
): string | undefined {
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  if (diagnostics.length === 0) {
    return undefined;
  }

  const parts: string[] = [];
  if (errors > 0) {
    parts.push(`${errors} ${errors === 1 ? 'error' : 'errores'}`);
  }
  if (warnings > 0) {
    parts.push(`${warnings} ${warnings === 1 ? 'advertencia' : 'advertencias'}`);
  }

  const files = new Set(
    diagnostics
      .map((d) => d.location?.file)
      .filter((file): file is string => typeof file === 'string'),
  );
  const filePart =
    files.size > 0
      ? ` en ${files.size} ${files.size === 1 ? 'archivo' : 'archivos'}`
      : '';
  return `Se encontraron ${parts.join(' y ')}${filePart}.`;
}
