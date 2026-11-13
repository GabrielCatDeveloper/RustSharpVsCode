/**
 * Traducción de diagnósticos de R# a diagnósticos de VSCode.
 *
 * Ver rsharp-spec.md §17 (Diagnósticos) y §14.4 (traduce errores de `rustc`
 * a líneas de R# con source maps).
 *
 * Este módulo no importa `vscode`: devuelve estructuras planas que la capa de
 * la extensión (T3.1) convierte a `vscode.Diagnostic`. Así se puede probar en
 * Node puro.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { RSharpDiagnostic } from './types';

/** Fuente fija de todos los diagnósticos emitidos por R#. */
const RSHARP_SOURCE = 'R#';

/**
 * Convierte un diagnóstico de R# en el objeto plano que consume
 * `vscode.DiagnosticCollection.set`.
 *
 * Reglas:
 * - `line` y `column` son 1-based en R# y 0-based en VSCode: se resta 1.
 * - Si falta `line` se usa la primera línea (0 en VSCode).
 * - Si falta `column` se usa el primer carácter (0 en VSCode).
 * - `length` por defecto: 1 carácter; si se puede leer el archivo (usando
 *   `root` para resolver `d.file`) se extiende hasta el final de la línea.
 * - `source` es siempre `"R#"` y `code` conserva el texto exacto del
 *   diagnóstico (`R#0042`, `R#0101`, `R#0150`...).
 */
export function toVscodeDiagnostic(d: RSharpDiagnostic, root: string): {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity: 'error' | 'warning' | 'info' | 'hint';
  source: string;
  code: string;
  message: string;
} {
  // `line`/`column` son 1-based; en VSCode son 0-based.
  const startLine = Math.max(0, (d.line ?? 1) - 1);
  const startCharacter = Math.max(0, (d.column ?? 1) - 1);
  const length = resolveLength(d, root, startLine, startCharacter);

  return {
    range: {
      start: { line: startLine, character: startCharacter },
      end: { line: startLine, character: startCharacter + length },
    },
    severity: d.severity,
    source: RSHARP_SOURCE,
    code: d.code,
    message: d.message,
  };
}

/**
 * Agrupa los diagnósticos por archivo. Los diagnósticos sin `file` se
 * agrupan bajo la clave `''` (cadena vacía).
 */
export function groupByFile(diags: RSharpDiagnostic[]): Map<string, RSharpDiagnostic[]> {
  const grouped = new Map<string, RSharpDiagnostic[]>();
  for (const diag of diags) {
    const key = diag.file ?? '';
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(diag);
    } else {
      grouped.set(key, [diag]);
    }
  }
  return grouped;
}

/**
 * Cuenta los diagnósticos por severidad. El contrato no tiene campo para los
 * `hint`, así que no se cuentan (quedan fuera del resumen).
 */
export function summarizeDiagnostics(diags: RSharpDiagnostic[]): { errors: number; warnings: number; infos: number } {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const diag of diags) {
    switch (diag.severity) {
      case 'error':
        errors += 1;
        break;
      case 'warning':
        warnings += 1;
        break;
      case 'info':
        infos += 1;
        break;
      default:
        // 'hint': el contrato de resumen no lo contempla.
        break;
    }
  }
  return { errors, warnings, infos };
}

/**
 * Texto plano de un diagnóstico: `"R#0042: mensaje"` más la ayuda opcional
 * en una segunda línea indentada.
 */
export function diagnosticText(d: RSharpDiagnostic): string {
  const code = d.code ?? '';
  const head = code ? `${code}: ${d.message}` : d.message;
  const help = d.help?.trim();
  if (!help) {
    return head;
  }
  return `${head}\n  Ayuda: ${help}`;
}

/**
 * Longitud del rango resaltado. Si el diagnóstico no la indica, se usa 1
 * carácter; si el archivo se puede leer se usa el resto de la línea.
 */
function resolveLength(d: RSharpDiagnostic, root: string, line: number, character: number): number {
  if (d.length !== undefined && Number.isFinite(d.length)) {
    return Math.max(0, Math.trunc(d.length));
  }
  const lineLength = readLineLength(d.file, root, line);
  if (lineLength === undefined) {
    return 1;
  }
  return Math.max(1, lineLength - character);
}

/**
 * Longitud de la línea (sin salto de línea) del archivo indicado, o
 * `undefined` si el archivo no existe o no se puede leer.
 */
function readLineLength(file: string | undefined, root: string, line: number): number | undefined {
  if (!file) {
    return undefined;
  }
  const absolute = path.isAbsolute(file) ? file : path.resolve(root, file);
  try {
    const content = fs.readFileSync(absolute, 'utf8');
    const lines = content.split(/\r?\n/);
    const text = lines[line];
    if (text === undefined) {
      return undefined;
    }
    return text.length;
  } catch {
    // El archivo puede no existir todavía (p. ej. diagnóstico sobre un
    // archivo virtual): en ese caso se resalta un solo carácter.
    return undefined;
  }
}
