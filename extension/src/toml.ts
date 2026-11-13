/**
 * Parser de TOML mínimo (sin dependencias externas) para leer `rsharp.toml`.
 *
 * Cubre el subconjunto de TOML v1.0 que necesita la extensión:
 * - tablas `[a.b.c]` y arrays de tablas `[[a]]`;
 * - arrays en línea `[1, 2, 3]` (incluidos arrays de arrays) y tablas en línea `{ a = 1 }`;
 * - cadenas básicas `"x"`, literales `'x'`, multilínea `"""x"""` y `'''x'''`;
 * - enteros (con `_`, hex/oct/bin), flotantes y booleanos;
 * - comentarios `#` fuera de cadenas;
 * - claves con comillas `"a b"` y claves punteadas `a.b = 1`.
 *
 * Las fechas y las horas NO están soportadas: se lanza `TomlParseError` con un
 * mensaje claro. Todos los errores incluyen línea y columna 1-based.
 */

/** Cualquier valor que puede aparecer en un documento TOML. */
export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;

/** Tabla TOML: objeto con claves de texto. */
export interface TomlTable {
  [key: string]: TomlValue;
}

/** Error de sintaxis o de semántica TOML, con posición 1-based. */
export class TomlParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(`${message} (línea ${line}, columna ${column})`);
    this.name = 'TomlParseError';
  }
}

/** Caracteres válidos en una clave sin comillas (TOML v1.0). */
const BARE_KEY_CHAR = /[A-Za-z0-9_-]/;

/** Caracteres que pueden formar un token numérico o de fecha. */
const NUMERIC_TOKEN_CHAR = /[0-9A-Za-z+\-_.:]/;

/** Fecha local u offset: `1979-05-27`, `1979-05-27T07:32:00Z`. */
const DATE_TOKEN = /^\d{4}-\d{2}-\d{2}([Tt ].*)?$/;

/** Hora local u offset: `07:32:00`, `07:32:00.999`. */
const TIME_TOKEN = /^\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/;

/** Separador interno de rutas de tablas (no puede aparecer en una clave). */
const PATH_SEPARATOR = '\u0000';

/** Normaliza finales de línea CRLF/CR a LF para poder contar líneas y columnas. */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Indica si el valor es una tabla (y no un array). */
function isTomlTable(value: TomlValue): value is TomlTable {
  return typeof value === 'object' && !Array.isArray(value);
}

/** Lee una clave de una tabla sin asumir que exista. */
function tableGet(table: TomlTable, key: string): TomlValue | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** Construye la clave interna de una ruta de tablas. */
function pathKey(parts: string[]): string {
  return parts.join(PATH_SEPARATOR);
}

/** Comprueba que los separadores `_` estén siempre entre dígitos válidos. */
function hasValidUnderscores(token: string, neighbor: RegExp): boolean {
  for (let i = 0; i < token.length; i++) {
    if (token[i] !== '_') continue;
    const before = i > 0 ? token[i - 1] : '';
    const after = i + 1 < token.length ? token[i + 1] : '';
    if (!neighbor.test(before) || !neighbor.test(after)) return false;
  }
  return true;
}

/**
 * Convierte un token numérico TOML en `number`.
 * Devuelve `undefined` si el token no es un número válido.
 */
function parseNumberToken(token: string): number | undefined {
  if (/^0x[0-9A-Fa-f_]+$/.test(token)) {
    if (!hasValidUnderscores(token, /[0-9A-Fa-f]/)) return undefined;
    return parseInt(token.slice(2).replace(/_/g, ''), 16);
  }
  if (/^0o[0-7_]+$/.test(token)) {
    if (!hasValidUnderscores(token, /[0-7]/)) return undefined;
    return parseInt(token.slice(2).replace(/_/g, ''), 8);
  }
  if (/^0b[01_]+$/.test(token)) {
    if (!hasValidUnderscores(token, /[01]/)) return undefined;
    return parseInt(token.slice(2).replace(/_/g, ''), 2);
  }
  if (/^[+-]?[0-9][0-9_]*$/.test(token)) {
    if (!hasValidUnderscores(token, /[0-9]/)) return undefined;
    return parseInt(token.replace(/_/g, ''), 10);
  }
  if (/^[+-]?inf$/.test(token)) {
    return token.startsWith('-') ? -Infinity : Infinity;
  }
  if (/^nan$/.test(token)) {
    return NaN;
  }
  if (/^[+-]?([0-9][0-9_]*)?\.[0-9][0-9_]*([eE][+-]?[0-9][0-9_]*)?$/.test(token)) {
    if (!hasValidUnderscores(token, /[0-9]/)) return undefined;
    return parseFloat(token.replace(/_/g, ''));
  }
  if (/^[+-]?[0-9][0-9_]*[eE][+-]?[0-9][0-9_]*$/.test(token)) {
    if (!hasValidUnderscores(token, /[0-9]/)) return undefined;
    return parseFloat(token.replace(/_/g, ''));
  }
  return undefined;
}

/** Analizador recursivo descendente sobre el texto TOML. */
class TomlParser {
  private pos = 0;
  private line = 1;
  private column = 1;

  /** Tablas definidas explícitamente con una cabecera `[a.b]`. */
  private readonly explicitTables = new Set<string>();
  /** Tablas de array definidas con una cabecera `[[a.b]]`. */
  private readonly arrayTables = new Set<string>();
  /** Tablas creadas implícitamente por claves punteadas (`a.b = 1`). */
  private readonly dottedTables = new Set<string>();

  constructor(private readonly text: string) {}

  /** Punto de entrada: devuelve la tabla raíz. */
  parse(): TomlTable {
    const root: TomlTable = {};
    let currentTable = root;
    let currentPath: string[] = [];

    for (;;) {
      this.skipBlank();
      if (this.eof()) break;

      if (this.peek() === '[') {
        const header = this.parseTableHeader(root);
        currentTable = header.table;
        currentPath = header.path;
        this.expectEndOfLine();
        continue;
      }

      const keyPath = this.parseKeyPath();
      this.skipSpaces();
      this.expect('=');
      this.skipSpaces();
      const value = this.parseValue();
      this.assignValue(currentTable, currentPath, keyPath, value, true);
      this.expectEndOfLine();
    }

    return root;
  }

  // -------------------------------------------------------------------------
  // Utilidades de posición
  // -------------------------------------------------------------------------

  private eof(): boolean {
    return this.pos >= this.text.length;
  }

  private peek(offset = 0): string {
    return this.text[this.pos + offset] ?? '';
  }

  /** Consume un carácter y actualiza línea/columna. */
  private advance(): string {
    const char = this.text[this.pos];
    if (char === undefined) return '';
    this.pos += 1;
    if (char === '\n') {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return char;
  }

  /** Crea un error con la posición actual. */
  private error(message: string): TomlParseError {
    return new TomlParseError(message, this.line, this.column);
  }

  private skipSpaces(): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.advance();
  }

  /** Salta espacios, saltos de línea y comentarios. */
  private skipBlank(): void {
    for (;;) {
      const char = this.peek();
      if (char === ' ' || char === '\t' || char === '\n') {
        this.advance();
        continue;
      }
      if (char === '#') {
        this.skipComment();
        continue;
      }
      return;
    }
  }

  /** Consume el resto de la línea empezando en `#`. */
  private skipComment(): void {
    while (!this.eof() && this.peek() !== '\n') this.advance();
  }

  /** Exige un carácter concreto. */
  private expect(char: string): void {
    if (this.peek() !== char) throw this.error(`se esperaba "${char}"`);
    this.advance();
  }

  /** Al final de una línea solo se admiten espacios y un comentario. */
  private expectEndOfLine(): void {
    this.skipSpaces();
    if (this.peek() === '#') this.skipComment();
    if (this.eof()) return;
    if (this.peek() === '\n') {
      this.advance();
      return;
    }
    throw this.error(`carácter inesperado "${this.peek()}" al final de la línea`);
  }

  // -------------------------------------------------------------------------
  // Claves
  // -------------------------------------------------------------------------

  /** Lee una clave (posiblemente punteada) y devuelve sus segmentos. */
  private parseKeyPath(): string[] {
    const parts: string[] = [];
    for (;;) {
      this.skipSpaces();
      parts.push(this.parseKeyPart());
      this.skipSpaces();
      if (this.peek() === '.') {
        this.advance();
        continue;
      }
      break;
    }
    return parts;
  }

  /** Lee un segmento de clave: con comillas o "bare". */
  private parseKeyPart(): string {
    const char = this.peek();
    if (char === '"') {
      if (this.peek(1) === '"' && this.peek(2) === '"') {
        throw this.error('una clave no puede ser una cadena multilínea');
      }
      return this.parseBasicString();
    }
    if (char === "'") {
      if (this.peek(1) === "'" && this.peek(2) === "'") {
        throw this.error('una clave no puede ser una cadena multilínea');
      }
      return this.parseLiteralString();
    }
    const start = this.pos;
    while (BARE_KEY_CHAR.test(this.peek())) this.advance();
    if (this.pos === start) throw this.error('se esperaba una clave');
    return this.text.slice(start, this.pos);
  }

  // -------------------------------------------------------------------------
  // Cabeceras de tabla
  // -------------------------------------------------------------------------

  /** Lee `[a.b]` o `[[a.b]]` y devuelve la tabla a la que apuntan las claves. */
  private parseTableHeader(root: TomlTable): { table: TomlTable; path: string[] } {
    this.advance(); // '['
    const isArray = this.peek() === '[';
    if (isArray) this.advance();

    this.skipSpaces();
    const path = this.parseKeyPath();
    this.skipSpaces();

    if (isArray) {
      this.expect(']');
      this.expect(']');
    } else {
      this.expect(']');
    }

    if (path.length === 0) throw this.error('la cabecera de la tabla está vacía');
    return { table: this.openTable(root, path, isArray), path };
  }

  /**
   * Crea (o reutiliza) la tabla apuntada por `path`.
   * `isArray` indica una cabecera `[[a]]`, que crea un array de tablas.
   */
  private openTable(root: TomlTable, path: string[], isArray: boolean): TomlTable {
    const key = pathKey(path);

    // Recorre los padres creando las tablas implícitas que falten.
    let parent = root;
    for (let i = 0; i < path.length - 1; i++) {
      const segment = path[i];
      const existing = tableGet(parent, segment);
      if (existing === undefined) {
        const created: TomlTable = {};
        parent[segment] = created;
        parent = created;
        continue;
      }
      if (isTomlTable(existing)) {
        parent = existing;
        continue;
      }
      if (Array.isArray(existing)) {
        // Un array de tablas: las sub-tablas se añaden al último elemento.
        if (!this.arrayTables.has(pathKey(path.slice(0, i + 1)))) {
          throw this.error(
            `no se puede definir la tabla "${pathKey(path.slice(0, i + 1))}" dentro de un array de valores`,
          );
        }
        const list = existing as TomlTable[];
        const lastElement = list[list.length - 1];
        if (lastElement === undefined) {
          throw this.error(
            `no se puede definir la tabla "${pathKey(path.slice(0, i + 1))}" dentro de un array de tablas vacío`,
          );
        }
        parent = lastElement;
        continue;
      }
      throw this.error(`no se puede redefinir el valor "${segment}" como tabla`);
    }

    const last = path[path.length - 1];
    const existing = tableGet(parent, last);

    if (isArray) {
      if (this.explicitTables.has(key)) {
        throw this.error(`la tabla "${key}" ya fue definida y no puede ser un array de tablas`);
      }
      if (this.dottedTables.has(key)) {
        throw this.error(`la tabla "${key}" fue definida con claves punteadas y no puede ser un array de tablas`);
      }
      if (existing === undefined) {
        const created: TomlTable = {};
        const list: TomlTable[] = [];
        list.push(created);
        parent[last] = list;
        this.arrayTables.add(key);
        return created;
      }
      if (Array.isArray(existing)) {
        if (!this.arrayTables.has(key)) {
          throw this.error(`no se puede redefinir el valor "${last}" como un array de tablas`);
        }
        const created: TomlTable = {};
        existing.push(created);
        return created;
      }
      if (isTomlTable(existing)) {
        throw this.error(`la tabla "${key}" ya fue definida y no puede convertirse en un array de tablas`);
      }
      throw this.error(`no se puede redefinir el valor "${last}" como un array de tablas`);
    }

    if (this.explicitTables.has(key)) {
      throw this.error(`la tabla "${key}" está definida más de una vez`);
    }
    if (this.arrayTables.has(key)) {
      throw this.error(`la tabla "${key}" es un array de tablas y no puede redefinirse como tabla`);
    }
    if (this.dottedTables.has(key)) {
      throw this.error(`la tabla "${key}" fue definida con claves punteadas y no puede redefinirse`);
    }
    if (existing === undefined) {
      const created: TomlTable = {};
      parent[last] = created;
      this.explicitTables.add(key);
      return created;
    }
    if (isTomlTable(existing)) {
      // Tabla creada implícitamente como super-tabla: ahora se define explícitamente.
      this.explicitTables.add(key);
      return existing;
    }
    throw this.error(`no se puede redefinir el valor "${last}" como tabla`);
  }

  // -------------------------------------------------------------------------
  // Valores
  // -------------------------------------------------------------------------

  /** Asigna un valor a una clave (posiblemente punteada) dentro de `table`. */
  private assignValue(
    table: TomlTable,
    basePath: string[],
    keyPath: string[],
    value: TomlValue,
    trackDotted: boolean,
  ): void {
    let current = table;
    for (let i = 0; i < keyPath.length - 1; i++) {
      const segment = keyPath[i];
      const existing = tableGet(current, segment);
      if (existing === undefined) {
        const created: TomlTable = {};
        current[segment] = created;
        current = created;
        if (trackDotted) {
          this.dottedTables.add(pathKey([...basePath, ...keyPath.slice(0, i + 1)]));
        }
        continue;
      }
      if (isTomlTable(existing)) {
        current = existing;
        continue;
      }
      if (Array.isArray(existing)) {
        throw this.error(`no se puede usar "${segment}" como tabla porque es un array`);
      }
      throw this.error(`no se puede redefinir el valor "${segment}" como tabla`);
    }

    const last = keyPath[keyPath.length - 1];
    if (tableGet(current, last) !== undefined) {
      throw this.error(`clave duplicada "${last}"`);
    }
    current[last] = value;
  }

  /** Lee un valor TOML en la posición actual. */
  private parseValue(): TomlValue {
    this.skipSpaces();
    const char = this.peek();
    if (char === '') throw this.error('falta el valor');

    switch (char) {
      case '"':
      case "'":
        return this.parseStringValue();
      case '[':
        return this.parseInlineArray();
      case '{':
        return this.parseInlineTable();
      default:
        break;
    }

    if (this.text.startsWith('true', this.pos)) {
      for (let i = 0; i < 4; i++) this.advance();
      return true;
    }
    if (this.text.startsWith('false', this.pos)) {
      for (let i = 0; i < 5; i++) this.advance();
      return false;
    }
    if (char === '+' || char === '-' || char === '.' || /[0-9]/.test(char) || char === 'i' || char === 'n') {
      return this.parseNumberOrDate();
    }
    throw this.error(`valor no válido "${char}"`);
  }

  /** Lee un número; las fechas y horas lanzan un error explícito. */
  private parseNumberOrDate(): number {
    const startLine = this.line;
    const startColumn = this.column;
    const start = this.pos;
    while (NUMERIC_TOKEN_CHAR.test(this.peek())) this.advance();
    const token = this.text.slice(start, this.pos);

    if (token.length === 0) throw this.error('se esperaba un número');
    if (DATE_TOKEN.test(token) || TIME_TOKEN.test(token)) {
      throw new TomlParseError(
        `las fechas y las horas no están soportadas ("${token}")`,
        startLine,
        startColumn,
      );
    }
    const value = parseNumberToken(token);
    if (value === undefined) {
      throw new TomlParseError(`número no válido "${token}"`, startLine, startColumn);
    }
    return value;
  }

  /** Lee un array en línea `[1, 2, 3]`. */
  private parseInlineArray(): TomlValue[] {
    this.advance(); // '['
    const items: TomlValue[] = [];
    for (;;) {
      this.skipBlank();
      if (this.eof()) throw this.error('el array no está cerrado');
      if (this.peek() === ']') {
        this.advance();
        return items;
      }
      items.push(this.parseValue());
      this.skipBlank();
      if (this.peek() === ',') {
        this.advance();
        continue;
      }
      if (this.peek() === ']') {
        this.advance();
        return items;
      }
      throw this.error('se esperaba "," o "]" en el array');
    }
  }

  /** Lee una tabla en línea `{ a = 1, b = "x" }`. */
  private parseInlineTable(): TomlTable {
    this.advance(); // '{'
    const table: TomlTable = {};
    this.skipBlank();
    if (this.peek() === '}') {
      this.advance();
      return table;
    }
    for (;;) {
      this.skipBlank();
      const keyPath = this.parseKeyPath();
      this.skipSpaces();
      this.expect('=');
      this.skipSpaces();
      const value = this.parseValue();
      this.assignValue(table, [], keyPath, value, false);
      this.skipBlank();
      if (this.peek() === ',') {
        this.advance();
        this.skipBlank();
        if (this.peek() === '}') {
          this.advance();
          return table;
        }
        continue;
      }
      if (this.peek() === '}') {
        this.advance();
        return table;
      }
      throw this.error('se esperaba "," o "}" en la tabla en línea');
    }
  }

  // -------------------------------------------------------------------------
  // Cadenas
  // -------------------------------------------------------------------------

  /** Decide entre cadena básica, literal o multilínea. */
  private parseStringValue(): string {
    const char = this.peek();
    if (char === '"') {
      if (this.peek(1) === '"' && this.peek(2) === '"') return this.parseMultilineBasic();
      return this.parseBasicString();
    }
    if (this.peek(1) === "'" && this.peek(2) === "'") return this.parseMultilineLiteral();
    return this.parseLiteralString();
  }

  /** Cadena básica `"x"` con escapes. */
  private parseBasicString(): string {
    const startLine = this.line;
    const startColumn = this.column;
    this.advance(); // '"'
    let out = '';
    for (;;) {
      if (this.eof()) throw new TomlParseError('la cadena no está cerrada', startLine, startColumn);
      const char = this.peek();
      if (char === '"') {
        this.advance();
        return out;
      }
      if (char === '\n') throw this.error('salto de línea dentro de una cadena básica');
      if (char === '\\') {
        out += this.parseEscape();
        continue;
      }
      const code = char.charCodeAt(0);
      if (code < 0x20 || code === 0x7f) {
        throw this.error('carácter de control no permitido en una cadena básica');
      }
      out += char;
      this.advance();
    }
  }

  /** Cadena literal `'x'` sin escapes. */
  private parseLiteralString(): string {
    const startLine = this.line;
    const startColumn = this.column;
    this.advance(); // "'"
    let out = '';
    for (;;) {
      if (this.eof()) throw new TomlParseError('la cadena no está cerrada', startLine, startColumn);
      const char = this.peek();
      if (char === "'") {
        this.advance();
        return out;
      }
      if (char === '\n') throw this.error('salto de línea dentro de una cadena literal');
      out += char;
      this.advance();
    }
  }

  /** Cadena multilínea básica `"""x"""`. */
  private parseMultilineBasic(): string {
    const startLine = this.line;
    const startColumn = this.column;
    this.advance();
    this.advance();
    this.advance();
    let out = '';
    this.trimFirstNewline();

    for (;;) {
      if (this.eof()) {
        throw new TomlParseError('la cadena multilínea no está cerrada', startLine, startColumn);
      }
      const char = this.peek();

      if (char === '"') {
        const run = this.countQuotes('"');
        if (run >= 3) {
          if (run > 5) {
            throw this.error('demasiadas comillas consecutivas en una cadena multilínea');
          }
          out += '"'.repeat(run - 3);
          for (let i = 0; i < run; i++) this.advance();
          return out;
        }
        out += '"'.repeat(run);
        for (let i = 0; i < run; i++) this.advance();
        continue;
      }

      if (char === '\\') {
        const trimmed = this.trimAfterLineEndingBackslash();
        if (trimmed) continue;
        out += this.parseEscape();
        continue;
      }

      out += char;
      this.advance();
    }
  }

  /** Cadena multilínea literal `'''x'''`. */
  private parseMultilineLiteral(): string {
    const startLine = this.line;
    const startColumn = this.column;
    this.advance();
    this.advance();
    this.advance();
    let out = '';
    this.trimFirstNewline();

    for (;;) {
      if (this.eof()) {
        throw new TomlParseError('la cadena multilínea no está cerrada', startLine, startColumn);
      }
      const char = this.peek();

      if (char === "'") {
        const run = this.countQuotes("'");
        if (run >= 3) {
          if (run > 5) {
            throw this.error('demasiadas comillas consecutivas en una cadena multilínea');
          }
          out += "'".repeat(run - 3);
          for (let i = 0; i < run; i++) this.advance();
          return out;
        }
        out += "'".repeat(run);
        for (let i = 0; i < run; i++) this.advance();
        continue;
      }

      out += char;
      this.advance();
    }
  }

  /** Cuenta comillas consecutivas desde la posición actual. */
  private countQuotes(quote: string): number {
    let count = 0;
    while (this.peek(count) === quote) count += 1;
    return count;
  }

  /** Elimina el salto de línea inicial de una cadena multilínea. */
  private trimFirstNewline(): void {
    if (this.peek() === '\n') this.advance();
  }

  /**
   * Gestiona la barra invertida al final de línea en cadenas multilínea básicas:
   * se descarta junto con todo el espacio en blanco que la sigue.
   * Devuelve `true` si se aplicó el recorte.
   */
  private trimAfterLineEndingBackslash(): boolean {
    const rest = this.text.slice(this.pos + 1);
    const match = /^[ \t]*\n/.exec(rest);
    if (!match) return false;
    this.advance(); // barra invertida
    for (let i = 0; i < match[0].length; i++) this.advance();
    while (!this.eof() && /\s/.test(this.peek())) this.advance();
    return true;
  }

  /** Lee una secuencia de escape y devuelve el carácter equivalente. */
  private parseEscape(): string {
    this.advance(); // '\'
    if (this.eof()) throw this.error('escape incompleto');
    const char = this.peek();
    switch (char) {
      case 'b':
        this.advance();
        return '\b';
      case 't':
        this.advance();
        return '\t';
      case 'n':
        this.advance();
        return '\n';
      case 'f':
        this.advance();
        return '\f';
      case 'r':
        this.advance();
        return '\r';
      case '"':
        this.advance();
        return '"';
      case '\\':
        this.advance();
        return '\\';
      case 'u':
        return this.parseUnicodeEscape(4);
      case 'U':
        return this.parseUnicodeEscape(8);
      default:
        throw this.error(`escape desconocido "\\${char}"`);
    }
  }

  /** Lee `\uXXXX` o `\UXXXXXXXX`. */
  private parseUnicodeEscape(digits: number): string {
    this.advance(); // 'u' o 'U'
    let hex = '';
    for (let i = 0; i < digits; i++) {
      if (this.eof()) throw this.error('escape unicode incompleto');
      const char = this.peek();
      if (!/[0-9A-Fa-f]/.test(char)) throw this.error(`carácter inválido "${char}" en un escape unicode`);
      hex += char;
      this.advance();
    }
    const code = parseInt(hex, 16);
    if (code > 0x10ffff) throw this.error('el escape unicode está fuera de rango');
    return String.fromCodePoint(code);
  }
}

/**
 * Parsea un documento TOML y devuelve su tabla raíz.
 * @throws {TomlParseError} si el documento no es TOML válido.
 */
export function parseToml(text: string): TomlValue {
  const normalized = normalizeNewlines(text.replace(/^\uFEFF/, ''));
  return new TomlParser(normalized).parse();
}
