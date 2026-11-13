/**
 * Parser de la salida de texto de `rustc` y `cargo`.
 *
 * Convierte la salida del compilador en `RustDiagnostic[]` para poder
 * mostrarla en el panel de salida y, cuando hay source maps, traducirla a
 * líneas de R# (spec §14.4).
 *
 * Formato de referencia (rustc):
 *
 * ```text
 * error[E0308]: mismatched types
 *    --> gen/main.rs:12:5
 *     |
 * 12  |     let x: i32 = "hola";
 *     |            ---   ^^^^ expected `i32`, found `&str`
 *     |            |
 *     |            expected due to this
 *     |
 * help: consider using `.to_string()`
 * ```
 *
 * Este módulo no importa `vscode`: es lógica pura y se puede probar en Node
 * puro.
 */

import type { RustDiagnostic } from './types';

/** Cabecera de diagnóstico: `error[E0308]: mensaje` o `warning: mensaje`. */
const HEADER_RE = /^\s*(error|warning)(?:\[([A-Za-z0-9_]+)\])?:\s*(.*)$/;

/** Línea de ubicación de rustc: `  --> ruta:linea:columna`. */
const LOCATION_RE = /^\s*-->\s+(.+?)\s*$/;

/** Final de la ruta con línea y columna (la ruta puede tener `:` y espacios). */
const FILE_LINE_COL_RE = /^(.*):(\d+):(\d+)$/;

/** Línea de ayuda: `help: ...` o `  = help: ...`. */
const HELP_RE = /^\s*(?:=\s*)?help:\s*(.*)$/;

// Las líneas `note: ...` y `  = note: ...` no aportan ningún campo del
// contrato: se conservan únicamente dentro de `raw`.

/** Línea de gutter de rustc: `12 | ...` o `   | ...`. */
const GUTTER_RE = /^\s*(?:\d+\s*)?\|(.*)$/;

/** Estatus de cargo que no son diagnósticos. */
const CARGO_STATUS_RE = /^\s*(?:Compiling|Finished|Running)\b/;

/** Estado interno mientras se acumula un bloque de diagnóstico. */
interface DiagnosticBuilder {
  code?: string;
  severity: 'error' | 'warning';
  message: string;
  file?: string;
  line?: number;
  column?: number;
  helps: string[];
  inlineHelps: string[];
  rawLines: string[];
}

/**
 * Parsea la salida de `rustc` y devuelve un diagnóstico por bloque.
 *
 * Un bloque empieza en una cabecera (`error...`/`warning...`) y termina en la
 * siguiente cabecera. Si el bloque no tiene una línea `-->`, el diagnóstico
 * se devuelve sin `file`/`line`/`column`: solo se mostrará en el panel de
 * salida.
 */
export function parseRustcOutput(text: string): RustDiagnostic[] {
  const diagnostics: RustDiagnostic[] = [];
  let current: DiagnosticBuilder | undefined;

  const flush = (): void => {
    if (current) {
      diagnostics.push(finalize(current));
      current = undefined;
    }
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const header = HEADER_RE.exec(rawLine);
    if (header) {
      flush();
      const code = header[2];
      current = {
        severity: header[1] === 'warning' ? 'warning' : 'error',
        message: header[3].trim(),
        helps: [],
        inlineHelps: [],
        rawLines: [rawLine],
      };
      if (code) {
        current.code = code;
      }
      continue;
    }

    if (!current) {
      // Texto previo a cualquier diagnóstico (p. ej. "   Compiling foo").
      continue;
    }

    current.rawLines.push(rawLine);

    if (current.file === undefined) {
      const location = matchLocation(rawLine);
      if (location) {
        current.file = location.file;
        current.line = location.line;
        current.column = location.column;
      }
    }

    const help = HELP_RE.exec(rawLine);
    if (help) {
      const text = help[1].trim();
      if (text) {
        current.helps.push(text);
      }
    }

    const inlineHelp = matchInlineHelp(rawLine);
    if (inlineHelp) {
      current.inlineHelps.push(inlineHelp);
    }
  }

  flush();
  return diagnostics;
}

/**
 * Parsea la salida de `cargo`, ignorando las líneas de estatus
 * (`Compiling ...`, `Finished ...`, `Running ...`) y delegando el resto en
 * `parseRustcOutput`.
 */
export function parseCargoOutput(text: string): RustDiagnostic[] {
  const filtered = text
    .split(/\r?\n/)
    .filter((line) => !CARGO_STATUS_RE.test(line))
    .join('\n');
  return parseRustcOutput(filtered);
}

/**
 * Extrae la ubicación de una línea `--> ruta:linea:columna`.
 *
 * Admite rutas con espacios y rutas de Windows con barras invertidas.
 */
function matchLocation(line: string): { file: string; line: number; column: number } | undefined {
  const match = LOCATION_RE.exec(line);
  if (!match) {
    return undefined;
  }
  const parts = FILE_LINE_COL_RE.exec(match[1]);
  if (!parts) {
    return undefined;
  }
  const file = parts[1];
  if (!file) {
    return undefined;
  }
  const lineNumber = Number(parts[2]);
  const columnNumber = Number(parts[3]);
  if (!Number.isFinite(lineNumber) || !Number.isFinite(columnNumber)) {
    return undefined;
  }
  return { file, line: lineNumber, column: columnNumber };
}

/**
 * Extrae la ayuda incrustada en una etiqueta de rustc, del tipo
 * `  |         ^ help: si no es intencional, usa `_x``.
 *
 * Solo se acepta si la línea es del gutter de rustc y la ayuda va después de
 * un caret, para no confundirla con el texto del código fuente.
 */
function matchInlineHelp(line: string): string | undefined {
  const gutter = GUTTER_RE.exec(line);
  if (!gutter) {
    return undefined;
  }
  const content = gutter[1];
  const index = content.search(/\bhelp:\s*/);
  if (index < 0) {
    return undefined;
  }
  const before = content.slice(0, index);
  if (!before.includes('^')) {
    return undefined;
  }
  const text = content.slice(index).replace(/^\s*help:\s*/, '').trim();
  return text.length > 0 ? text : undefined;
}

/**
 * Convierte el acumulador en un `RustDiagnostic` definitivo.
 */
function finalize(builder: DiagnosticBuilder): RustDiagnostic {
  const diagnostic: RustDiagnostic = {
    severity: builder.severity,
    message: builder.message,
    raw: trimTrailingBlankLines(builder.rawLines).join('\n'),
  };

  if (builder.code !== undefined) {
    diagnostic.code = builder.code;
  }
  if (builder.file !== undefined) {
    diagnostic.file = builder.file;
  }
  if (builder.line !== undefined) {
    diagnostic.line = builder.line;
  }
  if (builder.column !== undefined) {
    diagnostic.column = builder.column;
  }

  const help = builder.helps.length > 0 ? builder.helps.join('\n') : builder.inlineHelps.join('\n');
  if (help.length > 0) {
    diagnostic.help = help;
  }

  return diagnostic;
}

/**
 * Quita las líneas en blanco del final del bloque, para que `raw` no termine
 * con separadores sobrantes.
 */
function trimTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') {
    end -= 1;
  }
  return lines.slice(0, end);
}
