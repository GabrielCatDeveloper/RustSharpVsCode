/**
 * Errores de la CLI de simulación.
 */

/** Error de construcción no soportada por el mini-transpilador. */
export class UnsupportedError extends Error {
  /**
   * @param {string} message
   * @param {number} line línea 1-based del código C#
   */
  constructor(message, line) {
    super(line ? `R#0101: ${message} (línea ${line})` : `R#0101: ${message}`);
    this.name = 'UnsupportedError';
    this.line = line ?? 0;
  }
}

/** Error de uso de la CLI. */
export class CliError extends Error {
  /**
   * @param {string} kind
   * @param {string} message
   */
  constructor(kind, message) {
    super(message);
    this.name = 'CliError';
    this.kind = kind;
  }
}
