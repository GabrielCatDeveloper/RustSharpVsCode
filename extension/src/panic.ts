/**
 * Detección de pánicos de Rust en tiempo de ejecución.
 *
 * Cuando el programa generado entra en pánico, Rust escribe en `stderr`:
 *
 * ```text
 * thread 'main' panicked at src/main.rs:12:5:
 * explicit panic
 * note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
 * ```
 *
 * Esa ubicación es del Rust generado. Con los source maps se traduce a la
 * línea del `.rsh`, de forma que el usuario ve el fallo donde lo escribió y
 * no en un fichero que nunca ha visto.
 *
 * Este módulo NO importa `vscode`: es lógica pura y se prueba en Node.
 */

/** Pánico detectado en la salida de un programa. */
export interface RustPanic {
  /** Fichero Rust donde se produjo el pánico. */
  file?: string;
  /** Línea 1-based. */
  line?: number;
  /** Columna 1-based. */
  column?: number;
  /** Mensaje del pánico (la línea siguiente a la del `panicked at`). */
  message: string;
  /** Bloque original completo. */
  raw: string;
}

/** Cabecera del pánico: `thread 'main' panicked at file:line:col:`. */
const PANIC_RE = /panicked at\s+(.+?):(\d+):(\d+)\s*:?\s*$/;

/** Pánico sin columna: `panicked at file:line:`. */
const PANIC_NO_COL_RE = /panicked at\s+(.+?):(\d+)\s*:?\s*$/;

/**
 * Busca pánicos en una salida de programa.
 *
 * Devuelve todos los que encuentra: un programa puede escribir varios
 * pánicos (por ejemplo, cuando varios hilos fallan a la vez).
 */
export function findRustPanics(text: string): RustPanic[] {
  const panics: RustPanic[] = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const withColumn = PANIC_RE.exec(line);
    const withoutColumn = withColumn ? undefined : PANIC_NO_COL_RE.exec(line);
    if (!withColumn && !withoutColumn) {
      continue;
    }

    const raw: string[] = [line];
    const messageLines: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const next = lines[cursor];
      raw.push(next);
      // El mensaje termina en la primera línea que no es parte del bloque.
      if (next.trim().length === 0 || next.startsWith('note:')) {
        break;
      }
      messageLines.push(next);
      cursor += 1;
    }

    const panic: RustPanic = {
      message: messageLines.join('\n').trim() || 'pánico sin mensaje',
      raw: raw.join('\n'),
    };

    if (withColumn) {
      panic.file = withColumn[1].trim();
      panic.line = Number(withColumn[2]);
      panic.column = Number(withColumn[3]);
    } else if (withoutColumn) {
      panic.file = withoutColumn[1].trim();
      panic.line = Number(withoutColumn[2]);
    }

    panics.push(panic);
    index = cursor;
  }

  return panics;
}

/**
 * Traduce un pánico a un diagnóstico limpio, apuntando al `.rsh` original.
 *
 * `resolve` recibe el fichero Rust y la línea, y devuelve la ubicación en el
 * archivo R# (o `undefined` si no hay source map).
 */
export function mapPanic(
  panic: RustPanic,
  resolve: (file: string, line: number) => { rshFile: string; rshLine: number } | undefined,
): {
  severity: 'error';
  code: string;
  message: string;
  location?: { file: string; line: number; column?: number };
  rustLocation?: { file: string; line: number; column?: number };
  raw?: string;
} {
  const result: {
    severity: 'error';
    code: string;
    message: string;
    location?: { file: string; line: number; column?: number };
    rustLocation?: { file: string; line: number; column?: number };
    raw?: string;
  } = {
    severity: 'error',
    code: 'panic',
    message: `Pánico en tiempo de ejecución: ${panic.message}`,
  };

  if (panic.file) {
    result.rustLocation = { file: panic.file, line: panic.line ?? 1, column: panic.column };
    if (panic.line !== undefined) {
      const mapped = resolve(panic.file, panic.line);
      if (mapped) {
        result.location = {
          file: mapped.rshFile,
          line: mapped.rshLine,
          column: panic.column,
        };
      }
    }
  }
  if (panic.raw) {
    result.raw = panic.raw;
  }

  return result;
}
