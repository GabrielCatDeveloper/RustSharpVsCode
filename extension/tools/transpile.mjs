/**
 * Mini-transpilador C# -> Rust para la CLI de simulación.
 *
 * ATENCIÓN: esto NO es el compilador R# (`RSharp.Compiler`), que todavía no
 * existe. Es un sustituto funcional, limitado al subconjunto de C# que usa el
 * proyecto de ejemplo `examples/rsharp-demo`, y sirve para dos cosas:
 *
 *  1. Probar de extremo a extremo el flujo de la extensión
 *     (`.rsh` -> Rust -> `cargo` -> binario -> tests) sin el compilador real.
 *  2. Generar un Rust **alineado línea a línea** con el `.rsh` de origen, de
 *     modo que los source maps y el remapeo de rutas de LLDB funcionen.
 *
 * Cuando exista `RSharp.Cli`, este fichero se retira: el contrato de la CLI
 * (`docs/CLI-CONTRACT.md`) ya está definido y es el mismo.
 *
 * Subconjunto soportado:
 *   - `using`, `namespace` (se aplana), `class`, `struct`, `enum`, `interface`.
 *   - Campos, auto-propiedades, constructores, métodos (estáticos y de instancia).
 *   - `List<T>`, interfaces como `Box<dyn Trait>` y despacho dinámico.
 *   - `if/else`, `while`, `for`, `foreach`, `break`, `continue`, `return`.
 *   - `try/catch`, `throw new Exception(...)` -> `Result<T, String>`.
 *   - LINQ: `Where`, `Select`, `ToList`, `Sum`, `Count`.
 *   - BCL: `Console.WriteLine/Write`, `Math.*`, `ToString("F2")`, `string.Length`.
 */

import { UnsupportedError } from './errors.mjs';

// ---------------------------------------------------------------------------
// LÉXICO
// ---------------------------------------------------------------------------

const PUNCTUATION = [
  '==', '!=', '<=', '>=', '&&', '||', '=>', '+=', '-=', '*=', '/=', '++', '--',
  '{', '}', '(', ')', '[', ']', ';', ',', '.', ':', '?', '=', '+', '-', '*', '/', '%',
  '<', '>', '!', '&', '|',
];

/** Convierte el código fuente en una lista de tokens con su línea. */
function tokenize(source) {
  const tokens = [];
  let index = 0;
  let line = 1;

  while (index < source.length) {
    const char = source[index];

    if (char === '\n') {
      line += 1;
      index += 1;
      continue;
    }
    if (char === ' ' || char === '\t' || char === '\r') {
      index += 1;
      continue;
    }
    if (source.startsWith('//', index)) {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      const block = source.slice(index, end === -1 ? source.length : end);
      line += (block.match(/\n/g) ?? []).length;
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    if (char === '"') {
      let value = '';
      let cursor = index + 1;
      while (cursor < source.length && source[cursor] !== '"') {
        if (source[cursor] === '\\') {
          const next = source[cursor + 1];
          const escapes = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', '0': '\0' };
          value += escapes[next] ?? next;
          cursor += 2;
          continue;
        }
        if (source[cursor] === '\n') {
          line += 1;
        }
        value += source[cursor];
        cursor += 1;
      }
      tokens.push({ type: 'str', value, line });
      index = cursor + 1;
      continue;
    }
    if (char === "'") {
      let value = '';
      let cursor = index + 1;
      while (cursor < source.length && source[cursor] !== "'") {
        if (source[cursor] === '\\') {
          value += source[cursor + 1];
          cursor += 2;
          continue;
        }
        value += source[cursor];
        cursor += 1;
      }
      tokens.push({ type: 'char', value, line });
      index = cursor + 1;
      continue;
    }
    if (/[0-9]/.test(char)) {
      const match = /^[0-9][0-9_]*(\.[0-9][0-9_]*)?([eE][+-]?[0-9]+)?[dDfFmMlL]?/.exec(source.slice(index));
      const raw = match ? match[0] : char;
      tokens.push({
        type: 'num',
        value: raw,
        isFloat: raw.includes('.') || /[eE]/.test(raw) || /[dDfFmM]$/.test(raw),
        line,
      });
      index += raw.length;
      continue;
    }
    if (/[A-Za-z_@]/.test(char)) {
      const match = /^[A-Za-z_@][A-Za-z0-9_]*/.exec(source.slice(index));
      const raw = match ? match[0] : char;
      tokens.push({ type: 'id', value: raw, line });
      index += raw.length;
      continue;
    }
    const punctuation = PUNCTUATION.find((item) => source.startsWith(item, index));
    if (punctuation) {
      tokens.push({ type: 'punct', value: punctuation, line });
      index += punctuation.length;
      continue;
    }
    throw new UnsupportedError(`Carácter no soportado: «${char}»`, line);
  }

  tokens.push({ type: 'eof', value: '', line });
  return tokens;
}

// ---------------------------------------------------------------------------
// SINTÁCTICO
// ---------------------------------------------------------------------------

/** Analizador sintáctico recursivo descendente. */
class Parser {
  constructor(source) {
    this.tokens = tokenize(source);
    this.position = 0;
  }

  peek(offset = 0) {
    return this.tokens[Math.min(this.position + offset, this.tokens.length - 1)];
  }

  next() {
    const token = this.tokens[this.position];
    if (token.type !== 'eof') {
      this.position += 1;
    }
    return token;
  }

  at(value) {
    const token = this.peek();
    return token.value === value && (token.type === 'punct' || token.type === 'id');
  }

  eat(value) {
    if (this.at(value)) {
      this.next();
      return true;
    }
    return false;
  }

  expect(value) {
    if (!this.eat(value)) {
      const token = this.peek();
      throw new UnsupportedError(
        `Se esperaba «${value}» y se encontró «${token.value}»`,
        token.line,
      );
    }
  }

  expectId() {
    const token = this.peek();
    if (token.type !== 'id') {
      throw new UnsupportedError(`Se esperaba un identificador, no «${token.value}»`, token.line);
    }
    this.next();
    return token.value;
  }

  /** Analiza el fichero completo. */
  parseFile() {
    const file = { usings: [], namespace: '', types: [] };

    while (this.at('using')) {
      this.next();
      let name = '';
      while (!this.at(';')) {
        name += this.next().value;
      }
      this.expect(';');
      file.usings.push(name);
    }

    if (this.at('namespace')) {
      this.next();
      file.namespace = this.expectId();
      this.expect(';');
    }

    while (this.peek().type !== 'eof') {
      file.types.push(this.parseType());
    }

    return file;
  }

  /** Analiza una clase, estructura, enumeración o interfaz. */
  parseType() {
    const attributes = this.parseAttributes();
    const modifiers = this.parseModifiers();
    const keyword = this.peek();

    if (keyword.value === 'enum') {
      return this.parseEnum(attributes, modifiers);
    }
    if (keyword.value === 'interface') {
      return this.parseInterface(attributes, modifiers);
    }
    if (keyword.value === 'class' || keyword.value === 'struct') {
      return this.parseClass(attributes, modifiers, keyword.value);
    }
    throw new UnsupportedError(`Declaración no soportada: «${keyword.value}»`, keyword.line);
  }

  parseAttributes() {
    const attributes = [];
    while (this.at('[')) {
      this.next();
      let name = '';
      while (!this.at(']')) {
        name += this.next().value;
      }
      this.expect(']');
      attributes.push(name);
    }
    return attributes;
  }

  parseModifiers() {
    const modifiers = [];
    const known = [
      'public', 'private', 'protected', 'internal', 'static', 'readonly',
      'sealed', 'abstract', 'virtual', 'override', 'partial', 'async', 'extern',
      'new', 'const', 'unsafe',
    ];
    while (this.peek().type === 'id' && known.includes(this.peek().value)) {
      modifiers.push(this.next().value);
    }
    return modifiers;
  }

  parseEnum(attributes, modifiers) {
    const line = this.peek().line;
    this.next();
    const name = this.expectId();
    this.expect('{');
    const members = [];
    while (!this.at('}')) {
      const memberLine = this.peek().line;
      const memberName = this.expectId();
      let value = members.length;
      if (this.eat('=')) {
        value = Number(this.next().value);
      }
      members.push({ name: memberName, value, line: memberLine });
      if (!this.eat(',')) {
        break;
      }
    }
    const endLine = this.peek().line;
    this.expect('}');
    return { kind: 'enum', attributes, modifiers, name, members, line, endLine };
  }

  parseInterface(attributes, modifiers) {
    const line = this.peek().line;
    this.next();
    const name = this.expectId();
    const bases = [];
    if (this.eat(':')) {
      bases.push(this.parseTypeName());
      while (this.eat(',')) {
        bases.push(this.parseTypeName());
      }
    }
    this.expect('{');
    const members = [];
    while (!this.at('}')) {
      const member = this.parseMember();
      if (member) {
        members.push(member);
      }
    }
    const endLine = this.peek().line;
    this.expect('}');
    return { kind: 'interface', attributes, modifiers, name, bases, members, line, endLine };
  }

  parseClass(attributes, modifiers, keyword) {
    const line = this.peek().line;
    this.next();
    const name = this.expectId();
    const bases = [];
    if (this.eat(':')) {
      bases.push(this.parseTypeName());
      while (this.eat(',')) {
        bases.push(this.parseTypeName());
      }
    }
    this.expect('{');
    const members = [];
    while (!this.at('}')) {
      const member = this.parseMember();
      if (member) {
        members.push(member);
      }
    }
    const endLine = this.peek().line;
    this.expect('}');
    return { kind: keyword, attributes, modifiers, name, bases, members, line, endLine };
  }

  parseTypeName() {
    let name = this.expectId();
    while (this.at('.')) {
      this.next();
      name += `::${this.expectId()}`;
    }
    if (this.at('<')) {
      this.next();
      let depth = 1;
      let generic = '';
      while (depth > 0) {
        const token = this.next();
        if (token.value === '<') depth += 1;
        if (token.value === '>') depth -= 1;
        if (depth > 0) generic += token.value;
      }
      name += `<${generic}>`;
    }
    while (this.at('[') && this.peek(1).value === ']') {
      this.next();
      this.next();
      name += '[]';
    }
    return name;
  }

  /** Analiza un miembro de clase. */
  parseMember() {
    const attributes = this.parseAttributes();
    const modifiers = this.parseModifiers();
    const line = this.peek().line;

    // Constructor: Nombre ( ... )
    if (this.peek().type === 'id' && this.peek(1).value === '(') {
      const name = this.expectId();
      const parameters = this.parseParameters();
      let baseArguments = null;
      if (this.eat(':')) {
        this.expect('base');
        this.expect('(');
        baseArguments = this.parseArguments();
        this.expect(')');
      }
      const body = this.parseBlock();
      return { kind: 'ctor', attributes, modifiers, name, parameters, baseArguments, body, line };
    }

    const type = this.parseTypeName();
    const name = this.expectId();

    // Propiedad auto: Tipo Nombre { get; set; }
    if (this.at('{')) {
      this.next();
      const accessors = [];
      while (!this.at('}')) {
        accessors.push(this.expectId());
        this.expect(';');
      }
      this.expect('}');
      return { kind: 'property', attributes, modifiers, type, name, accessors, line };
    }

    // Método: Tipo Nombre ( ... ) { ... }
    if (this.at('(')) {
      const parameters = this.parseParameters();
      if (this.eat(';')) {
        // Método abstracto (declaración sin cuerpo, típico de las interfaces).
        return { kind: 'method', attributes, modifiers, type, name, parameters, body: null, line };
      }
      let body;
      if (this.at('{')) {
        body = this.parseBlock();
      } else {
        this.expect('=>');
        const expression = this.parseExpression();
        this.expect(';');
        body = { kind: 'block', statements: [{ kind: 'return', expression, line }], endLine: line };
      }
      return { kind: 'method', attributes, modifiers, type, name, parameters, body, line };
    }

    // Campo: Tipo Nombre (= expr)? ;
    let initializer = null;
    if (this.eat('=')) {
      initializer = this.parseExpression();
    }
    this.expect(';');
    return { kind: 'field', attributes, modifiers, type, name, initializer, line };
  }

  parseParameters() {
    this.expect('(');
    const parameters = [];
    while (!this.at(')')) {
      const type = this.parseTypeName();
      const name = this.expectId();
      parameters.push({ type, name });
      if (!this.eat(',')) {
        break;
      }
    }
    this.expect(')');
    return parameters;
  }

  parseBlock() {
    const line = this.peek().line;
    this.expect('{');
    const statements = [];
    while (!this.at('}')) {
      const statement = this.parseStatement();
      if (statement) {
        statements.push(statement);
      }
    }
    const endLine = this.peek().line;
    this.expect('}');
    return { kind: 'block', statements, line, endLine };
  }

  parseStatement() {
    const token = this.peek();

    if (token.value === '{') {
      return this.parseBlock();
    }
    if (token.value === ';') {
      this.next();
      return null;
    }
    if (token.value === 'if') {
      this.next();
      this.expect('(');
      const condition = this.parseExpression();
      this.expect(')');
      const consequent = this.parseStatement();
      let alternate = null;
      if (this.eat('else')) {
        alternate = this.parseStatement();
      }
      return { kind: 'if', condition, consequent, alternate, line: token.line };
    }
    if (token.value === 'while') {
      this.next();
      this.expect('(');
      const condition = this.parseExpression();
      this.expect(')');
      const body = this.parseStatement();
      return { kind: 'while', condition, body, line: token.line };
    }
    if (token.value === 'for') {
      this.next();
      this.expect('(');
      const initializer = this.parseSimpleStatement();
      this.expect(';');
      const condition = this.at(';') ? null : this.parseExpression();
      this.expect(';');
      const update = this.at(')') ? null : this.parseSimpleStatement();
      this.expect(')');
      const body = this.parseStatement();
      return { kind: 'for', initializer, condition, update, body, line: token.line };
    }
    if (token.value === 'foreach') {
      this.next();
      this.expect('(');
      const type = this.parseTypeName();
      const name = this.expectId();
      this.expect('in');
      const source = this.parseExpression();
      this.expect(')');
      const body = this.parseStatement();
      return { kind: 'foreach', type, name, source, body, line: token.line };
    }
    if (token.value === 'try') {
      this.next();
      const body = this.parseBlock();
      let catchVariable = null;
      let catchBody = null;
      if (this.eat('catch')) {
        this.expect('(');
        this.parseTypeName();
        catchVariable = this.expectId();
        this.expect(')');
        catchBody = this.parseBlock();
      }
      return { kind: 'try', body, catchVariable, catchBody, line: token.line };
    }
    if (token.value === 'return') {
      this.next();
      const expression = this.at(';') ? null : this.parseExpression();
      this.expect(';');
      return { kind: 'return', expression, line: token.line };
    }
    if (token.value === 'throw') {
      this.next();
      this.expect('new');
      this.parseTypeName();
      const args = this.at('(') ? this.parseArguments() : [];
      this.expect(';');
      return { kind: 'throw', args, line: token.line };
    }
    if (token.value === 'break' || token.value === 'continue') {
      this.next();
      this.expect(';');
      return { kind: token.value, line: token.line };
    }

    // Asignación: destino = valor;
    // Solo cuando el destino es un identificador (`x = 1`) o una propiedad
    // (`obj.prop = 1`). Si no, la sentencia es una declaración.
    if (token.type === 'id' && (this.peek(1).value === '=' || this.peek(1).value === '.')) {
      const start = this.position;
      const expression = this.parseExpression();
      if (this.at('=')) {
        this.next();
        const value = this.parseExpression();
        this.expect(';');
        return { kind: 'assign', target: expression, value, line: token.line };
      }
      this.position = start;
    }

    const simple = this.parseSimpleStatement();
    if (simple.kind === 'local') {
      return simple;
    }
    this.expect(';');
    return { kind: 'expression', expression: simple.expression, line: simple.line };
  }

  /** Analiza una sentencia simple (declaración o expresión). */
  parseSimpleStatement() {
    const start = this.position;
    const token = this.peek();
    const type = this.parseTypeName();
    // Tras el tipo debe venir el nombre de la variable (y no un '(').
    if (this.peek().type === 'id' && this.peek(1).value !== '(') {
      const name = this.expectId();
      let initializer = null;
      if (this.eat('=')) {
        initializer = this.parseExpression();
      }
      return { kind: 'local', type, name, initializer, line: token.line };
    }
    // No era una declaración: se vuelve al principio y se lee como expresión.
    this.position = start;
    const expression = this.parseExpression();
    return { kind: 'expression', expression, line: token.line };
  }

  parseArguments() {
    this.expect('(');
    const args = [];
    while (!this.at(')')) {
      args.push(this.parseExpression());
      if (!this.eat(',')) {
        break;
      }
    }
    this.expect(')');
    return args;
  }

  parseExpression() {
    return this.parseTernary();
  }

  parseTernary() {
    const condition = this.parseBinary(0);
    if (this.eat('?')) {
      const consequent = this.parseExpression();
      this.expect(':');
      const alternate = this.parseExpression();
      return { kind: 'ternary', condition, consequent, alternate, line: condition.line };
    }
    return condition;
  }

  parseBinary(level) {
    const levels = [
      ['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%'],
    ];
    if (level >= levels.length) {
      return this.parseUnary();
    }
    let left = this.parseBinary(level + 1);
    while (true) {
      const token = this.peek();
      if (token.type !== 'punct' || !levels[level].includes(token.value)) {
        break;
      }
      this.next();
      const right = this.parseBinary(level + 1);
      left = { kind: 'binary', operator: token.value, left, right, line: token.line };
    }
    return left;
  }

  parseUnary() {
    const token = this.peek();
    if (token.value === '-' || token.value === '!') {
      this.next();
      const operand = this.parseUnary();
      return { kind: 'unary', operator: token.value, operand, line: token.line };
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let expression = this.parsePrimary();
    while (true) {
      const token = this.peek();
      if (token.value === '.') {
        this.next();
        const name = this.expectId();
        expression = { kind: 'member', target: expression, name, line: token.line };
        continue;
      }
      if (token.value === '(') {
        const args = this.parseArguments();
        expression = { kind: 'call', callee: expression, args, line: expression.line };
        continue;
      }
      if (token.value === '[') {
        this.next();
        const index = this.parseExpression();
        this.expect(']');
        expression = { kind: 'index', target: expression, index, line: token.line };
        continue;
      }
      if (token.value === '++' || token.value === '--') {
        this.next();
        expression = { kind: 'update', operator: token.value, target: expression, line: token.line };
        continue;
      }
      break;
    }
    return expression;
  }

  parsePrimary() {
    const token = this.peek();

    if (token.type === 'num') {
      this.next();
      return { kind: 'literal', value: token.value, isFloat: token.isFloat, line: token.line };
    }
    if (token.type === 'str') {
      this.next();
      return { kind: 'literal', value: token.value, isFloat: false, isString: true, line: token.line };
    }
    if (token.type === 'id') {
      if (token.value === 'true' || token.value === 'false') {
        this.next();
        return { kind: 'literal', value: token.value, isFloat: false, isBool: true, line: token.line };
      }
      if (token.value === 'null') {
        this.next();
        return { kind: 'literal', value: 'null', isFloat: false, isNull: true, line: token.line };
      }
      if (token.value === 'new') {
        this.next();
        const type = this.parseTypeName();
        const args = this.at('(') ? this.parseArguments() : [];
        return { kind: 'new', type, args, line: token.line };
      }
      if (this.peek(1).value === '=>') {
        this.next();
        this.next();
        const body = this.parseExpression();
        return { kind: 'lambda', parameters: [token.value], body, line: token.line };
      }
      this.next();
      return { kind: 'identifier', name: token.value, line: token.line };
    }
    if (token.value === '(') {
      if (this.peek(1).type === 'id' && this.peek(2).value === ')') {
        this.next();
        const parameter = this.expectId();
        this.expect(')');
        this.expect('=>');
        const body = this.parseExpression();
        return { kind: 'lambda', parameters: [parameter], body, line: token.line };
      }
      this.next();
      const expression = this.parseExpression();
      this.expect(')');
      return expression;
    }
    throw new UnsupportedError(`Expresión no soportada: «${token.value}»`, token.line);
  }
}

// ---------------------------------------------------------------------------
// UTILIDADES DE TIPOS
// ---------------------------------------------------------------------------

/** Convierte un tipo de C# en un tipo de Rust. */
function rustType(type, context) {
  if (type.endsWith('[]')) {
    return `Vec<${rustType(type.slice(0, -2), context)}>`;
  }
  const clean = type;
  if (clean.startsWith('List<')) {
    return `Vec<${rustType(clean.slice(5, -1), context)}>`;
  }
  switch (clean) {
    case 'int':
    case 'long':
    case 'short':
    case 'byte':
      return 'i32';
    case 'double':
    case 'float':
    case 'decimal':
      return 'f64';
    case 'string':
      return 'String';
    case 'bool':
      return 'bool';
    case 'void':
      return '()';
    case 'object':
      return 'String';
    default:
      break;
  }
  if (context.interfaces.has(clean)) {
    return `Box<dyn ${clean}>`;
  }
  return clean;
}

/** Valor por defecto de un tipo. */
function defaultValue(type, context) {
  const clean = type.replace(/\[\]/g, '');
  if (clean.startsWith('List<')) {
    return 'Vec::new()';
  }
  switch (clean) {
    case 'int':
    case 'long':
      return '0';
    case 'double':
    case 'float':
      return '0.0';
    case 'bool':
      return 'false';
    case 'string':
      return 'String::new()';
    default:
      break;
  }
  if (context.enums.has(clean)) {
    const first = context.enums.get(clean);
    return first ? `${clean}::${first}` : clean;
  }
  if (context.classes.has(clean)) {
    return `${clean}::new()`;
  }
  return 'String::new()';
}

/** Convierte un identificador de C# a snake_case de Rust. */
function snakeCase(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

/** `true` si el tipo es un primitivo copiable. */
function isPrimitive(type) {
  return ['int', 'long', 'double', 'float', 'bool', 'byte', 'short'].includes(type);
}

// ---------------------------------------------------------------------------
// CONTEXTO DEL PROYECTO
// ---------------------------------------------------------------------------

function buildContext(files) {
  const classes = new Map();
  const interfaces = new Map();
  const enums = new Map();

  for (const file of files) {
    for (const type of file.types) {
      if (type.kind === 'enum') {
        enums.set(type.name, type.members[0]?.name);
      } else if (type.kind === 'interface') {
        interfaces.set(type.name, type);
      } else {
        classes.set(type.name, type);
      }
    }
  }

  const throwsMethods = new Set();
  for (const file of files) {
    for (const type of file.types) {
      for (const member of type.members ?? []) {
        if (member.kind === 'method' && member.body) {
          const hasThrow = JSON.stringify(member.body).includes('"kind":"throw"');
          if (hasThrow) {
            throwsMethods.add(member.name);
          }
        }
      }
    }
  }

  return { classes, interfaces, enums, throwsMethods, files };
}

// ---------------------------------------------------------------------------
// EMISOR
// ---------------------------------------------------------------------------

/** Acumulador de líneas de Rust, alineado con las líneas del origen. */
class FileBuilder {
  constructor(name) {
    this.name = name;
    this.lines = [];
    this.tail = [];
  }

  write(line, text) {
    const index = Math.max(0, line - 1);
    while (this.lines.length < index) {
      this.lines.push('');
    }
    const current = this.lines[index] ?? '';
    this.lines[index] = current.length === 0 ? text : `${current} ${text}`;
  }

  /**
   * Escribe al final del fichero.
   *
   * Se usa para las implementaciones que no tienen línea propia en el origen
   * (por ejemplo, el `impl` de un trait): van después de todo el contenido
   * para no descolocar el resto del fichero.
   */
  writeTail(text) {
    this.tail.push(text);
  }

  toString() {
    return `${[...this.lines, ...this.tail].join('\n')}\n`;
  }
}

/** Traduce un fichero completo a Rust. */
function emitFile(file, context) {
  const builder = new FileBuilder(file.name);

  for (const type of file.types) {
    if (type.kind === 'enum') {
      emitEnum(type, builder, context);
    } else if (type.kind === 'interface') {
      emitInterface(type, builder, context);
    } else {
      emitClass(type, builder, context);
    }
  }

  return builder;
}

function emitEnum(type, builder) {
  const members = type.members
    .map((member) => `${member.name} = ${member.value}`)
    .join(', ');
  builder.write(type.line, `#[repr(i32)] #[derive(PartialEq, Eq, Clone, Copy, Debug)] pub enum ${type.name} { ${members} }`);

  // `as_str` y `Display` van al final: no tienen línea propia en el origen.
  builder.writeTail(`impl ${type.name} {`);
  builder.writeTail(`pub fn as_str(&self) -> &'static str {`);
  builder.writeTail(`match self {`);
  for (const member of type.members) {
    builder.writeTail(`${type.name}::${member.name} => "${member.name}",`);
  }
  builder.writeTail(`}`);
  builder.writeTail(`}`);
  builder.writeTail(`}`);
  builder.writeTail(`impl std::fmt::Display for ${type.name} {`);
  builder.writeTail(`fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {`);
  builder.writeTail(`write!(f, "{}", self.as_str())`);
  builder.writeTail(`}`);
  builder.writeTail(`}`);
}

function emitInterface(type, builder, context) {
  const members = type.members
    .filter((member) => member.kind === 'method')
    .map((member) => {
      const parameters = member.parameters
        .map((parameter) => `${snakeCase(parameter.name)}: ${rustType(parameter.type, context)}`)
        .join(', ');
      const receiver = member.modifiers.includes('static') ? '' : '&self';
      return `fn ${snakeCase(member.name)}(${receiver}${receiver ? ', ' : ''}${parameters}) -> ${rustType(member.type, context)};`;
    })
    .join(' ');
  builder.write(type.line, `pub trait ${type.name} { ${members} }`);
}

function emitClass(type, builder, context) {
  const isStatic = type.modifiers.includes('static');

  if (isStatic) {
    builder.write(type.line, `pub struct ${type.name};`);
    builder.write(type.line, `impl ${type.name} {`);
    for (const member of type.members) {
      emitMember(member, type, builder, context, { static: true });
    }
    builder.write(type.endLine ?? type.line, `}`);
    return;
  }

  // La estructura se escribe entera en la línea de la declaración: así los
  // campos no descolocan el resto del fichero.
  const fields = type.members
    .filter((member) => member.kind === 'field' || member.kind === 'property')
    .map((member) => `${snakeCase(member.name)}: ${rustType(member.type, context)}`)
    .join(', ');
  builder.write(type.line, `#[derive(Clone)] pub struct ${type.name} { ${fields} }`);
  builder.write(type.line, `impl ${type.name} {`);

  // Las interfaces que implementa la clase.
  const traits = type.bases
    .map((base) => context.interfaces.get(base.split('<')[0]))
    .filter((trait) => trait !== undefined);

  const traitMethodNames = new Set();
  for (const trait of traits) {
    for (const member of trait.members) {
      if (member.kind === 'method') {
        traitMethodNames.add(member.name);
      }
    }
  }

  // Los métodos que cumplen el contrato de la interfaz se quedan en el `impl`
  // propio de la clase: en Rust el método inherente tiene prioridad sobre el
  // del trait, así que no hay ambigüedad.
  for (const member of type.members) {
    emitMember(member, type, builder, context, { static: false });
  }
  builder.write(type.endLine ?? type.line, `}`);

  // El `impl` del trait va al final y delega en los métodos inherentes.
  for (const trait of traits) {
    builder.writeTail(`impl ${trait.name} for ${type.name} {`);
    for (const traitMember of trait.members) {
      if (traitMember.kind !== 'method') {
        continue;
      }
      const implementation = type.members.find(
        (member) => member.kind === 'method' && member.name === traitMember.name,
      );
      if (!implementation) {
        continue;
      }
      const parameters = implementation.parameters
        .map((parameter) => `${snakeCase(parameter.name)}`)
        .join(', ');
      builder.writeTail(
        `fn ${snakeCase(traitMember.name)}(&self${parameters ? `, ${parameters}` : ''}) -> ${rustType(traitMember.type, context)} { ${type.name}::${snakeCase(traitMember.name)}(self${parameters ? `, ${parameters}` : ''}) }`,
      );
    }
    builder.writeTail(`}`);
  }
}

function emitMember(member, owner, builder, context, options) {
  if (member.kind === 'field') {
    if (options.static) {
      const rustName = snakeCase(member.name);
      const initializer = member.initializer
        ? ` = ${emitExpression(member.initializer, owner, context, { static: true, locals: new Map() })}`
        : '';
      builder.write(
        member.line,
        `pub static ${rustName}: ${rustType(member.type, context)} = ${defaultValue(member.type, context)}${initializer};`,
      );
    }
    return;
  }

  if (member.kind === 'property') {
    const rustName = snakeCase(member.name);
    const rustTypeName = rustType(member.type, context);
    const clone = rustTypeName === 'String' ? '.clone()' : '';
    if (member.accessors.includes('get')) {
      builder.write(
        member.line,
        `pub fn ${rustName}(&self) -> ${rustTypeName} { self.${rustName}${clone} }`,
      );
    }
    if (member.accessors.includes('set')) {
      builder.write(
        member.line,
        `pub fn set_${rustName}(&mut self, value: ${rustTypeName}) { self.${rustName} = value; }`,
      );
    }
    return;
  }

  if (member.kind === 'ctor') {
    const parameters = member.parameters
      .map((parameter) => `${snakeCase(parameter.name)}: ${rustType(parameter.type, context)}`)
      .join(', ');
    builder.write(member.line, `pub fn new(${parameters}) -> Self {`);
    const defaults = owner.members
      .filter((item) => item.kind === 'field' || item.kind === 'property')
      .map((item) => `${snakeCase(item.name)}: ${defaultValue(item.type, context)}`)
      .join(', ');
    builder.write(member.line, `let mut instance = Self { ${defaults} };`);
    const locals = new Map();
    for (const parameter of member.parameters) {
      locals.set(parameter.name, parameter.type);
    }
    if (member.body) {
      emitBlock(member.body, owner, builder, context, {
        locals,
        constructor: true,
        instanceName: 'instance',
      });
    }
    builder.write(member.body?.endLine ?? member.line, `instance }`);
    return;
  }

  if (member.kind === 'method') {
    const isStatic = options.static || member.modifiers.includes('static');
    const parameters = member.parameters
      .map((parameter) => `${snakeCase(parameter.name)}: ${rustType(parameter.type, context)}`)
      .join(', ');
    const receiver = isStatic ? '' : '&self';
    const rustName = snakeCase(member.name);
    const returns = rustType(member.type, context);
    const throws = context.throwsMethods.has(member.name);
    const returnType = throws ? `Result<${returns}, String>` : returns;
    builder.write(
      member.line,
      `pub fn ${rustName}(${receiver}${receiver && parameters ? ', ' : ''}${parameters}) -> ${returnType} {`,
    );
    const locals = new Map();
    for (const parameter of member.parameters) {
      locals.set(parameter.name, parameter.type);
    }
    if (member.body) {
      emitBlock(member.body, owner, builder, context, {
        locals,
        isStatic,
        throws,
      });
    }
    builder.write(member.body?.endLine ?? member.line, `}`);
  }
}

function emitBlock(block, owner, builder, context, options = {}) {
  for (const statement of block.statements) {
    emitStatement(statement, owner, builder, context, options);
  }
}

/**
 * Renderiza unas sentencias en un bloque aparte y devuelve sus líneas.
 *
 * Se usa para los cuerpos que deben ir en una sola línea (por ejemplo, el
 * `try`, cuyo contenido vive dentro de una closure).
 */
function renderStatements(statements, owner, context, options = {}) {
  const temporary = new FileBuilder('temporary');
  for (const statement of statements) {
    emitStatement(statement, owner, temporary, context, options);
  }
  return temporary.lines.filter((line) => line.trim().length > 0);
}

function emitStatement(statement, owner, builder, context, options = {}) {
  const scope = { ...options };

  switch (statement.kind) {
    case 'block':
      builder.write(statement.line, '{');
      emitBlock(statement, owner, builder, context, options);
      builder.write(statement.endLine ?? statement.line, '}');
      return;
    case 'local': {
      const rustTypeName = rustType(statement.type, context);
      let initializer = statement.initializer
        ? emitExpression(statement.initializer, owner, context, {
          ...scope,
          expectedType: statement.type,
        })
        : defaultValue(statement.type, context);
      const value = statement.initializer && statement.initializer.kind === 'index'
        ? `${initializer}.clone()`
        : initializer;
      builder.write(
        statement.line,
        `let mut ${snakeCase(statement.name)}: ${rustTypeName} = ${value};`,
      );
      options.locals?.set(statement.name, statement.type);
      return;
    }
    case 'expression':
      builder.write(
        statement.line,
        `${emitExpression(statement.expression, owner, context, scope)};`,
      );
      return;
    case 'assign': {
      const value = emitExpression(statement.value, owner, context, scope);

      // `CultureInfo.CurrentCulture = ...` no tiene equivalente: en Rust el
      // formato de los números es siempre invariante.
      if (
        statement.target.kind === 'member' &&
        statement.target.target.kind === 'identifier' &&
        statement.target.target.name === 'CultureInfo'
      ) {
        builder.write(
          statement.line,
          `// ${emitExpression(statement.target, owner, context, scope)} = ${value}; ` +
            '// En Rust el formato numérico es siempre invariante.',
        );
        return;
      }

      // Variable local.
      if (statement.target.kind === 'identifier' && scope.locals?.has(statement.target.name)) {
        builder.write(statement.line, `${snakeCase(statement.target.name)} = ${value};`);
        return;
      }

      // Propiedad de otro objeto: `orden.set_referencia(valor)`.
      if (statement.target.kind === 'member') {
        const targetText = emitExpression(statement.target.target, owner, context, scope);
        const targetType = inferType(statement.target.target, context, scope);
        const ownerClass = context.classes.get(targetType);
        const property = ownerClass?.members.find(
          (item) => item.kind === 'property' && item.name === statement.target.name,
        );
        if (property) {
          builder.write(
            statement.line,
            `${targetText}.set_${snakeCase(statement.target.name)}(${value});`,
          );
          return;
        }
        builder.write(
          statement.line,
          `${targetText}.${snakeCase(statement.target.name)} = ${value};`,
        );
        return;
      }

      const name = statement.target.name;
      // Propiedad del propio tipo: `instance.set_x(valor)`.
      const member = owner?.members?.find(
        (item) => (item.kind === 'field' || item.kind === 'property') && item.name === name,
      );
      if (member) {
        const target = scope.instanceName ?? 'self';
        if (member.kind === 'property') {
          builder.write(statement.line, `${target}.set_${snakeCase(name)}(${value});`);
        } else {
          builder.write(statement.line, `${target}.${snakeCase(name)} = ${value};`);
        }
        return;
      }
      builder.write(statement.line, `${snakeCase(name)} = ${value};`);
      return;
    }
    case 'if': {
      const condition = emitExpression(statement.condition, owner, context, scope);
      builder.write(statement.line, `if ${condition} {`);
      emitStatement(statement.consequent, owner, builder, context, options);
      if (statement.consequent.kind === 'block') {
        builder.write(statement.consequent.endLine ?? statement.line, '}');
      } else {
        builder.write(statement.line, '}');
      }
      if (statement.alternate) {
        builder.write(statement.line, `else {`);
        emitStatement(statement.alternate, owner, builder, context, options);
        if (statement.alternate.kind === 'block') {
          builder.write(statement.alternate.endLine ?? statement.line, '}');
        } else {
          builder.write(statement.line, '}');
        }
      }
      return;
    }
    case 'while': {
      const condition = emitExpression(statement.condition, owner, context, scope);
      builder.write(statement.line, `while ${condition} {`);
      emitStatement(statement.body, owner, builder, context, options);
      builder.write(statement.body.endLine ?? statement.line, '}');
      return;
    }
    case 'for': {
      emitFor(statement, owner, builder, context, options);
      return;
    }
    case 'foreach': {
      const source = emitExpression(statement.source, owner, context, scope);
      const elementType = statement.type.replace(/\[\]/g, '');
      const iterator = iterationStrategy(elementType, context);
      builder.write(
        statement.line,
        `for ${snakeCase(statement.name)} in ${source}.${iterator} {`,
      );
      emitStatement(statement.body, owner, builder, context, options);
      builder.write(statement.body.endLine ?? statement.line, '}');
      return;
    }
    case 'try': {
      // El bloque `try` se emite en una sola línea: su cuerpo va dentro de
      // una closure, así que no puede repartirse por varias líneas.
      const body = renderStatements(statement.body.statements, owner, context, {
        ...options,
        inTry: true,
        expectedType: undefined,
      });
      const catchBody = statement.catchBody
        ? renderStatements(statement.catchBody.statements, owner, context, {
          ...options,
          catchVariable: statement.catchVariable,
        })
        : [];
      builder.write(
        statement.line,
        `let __result = (|| -> Result<(), String> { ${body.join(' ')} Ok(()) })(); ` +
          `match __result { Ok(_) => {}, Err(__error) => { ${catchBody.join(' ')} } }`,
      );
      return;
    }
    case 'return': {
      const value = statement.expression
        ? emitExpression(statement.expression, owner, context, scope)
        : '';
      if (options.throws) {
        builder.write(statement.line, `return Ok(${value});`);
      } else {
        builder.write(statement.line, `return ${value};`);
      }
      return;
    }
    case 'throw': {
      const message = statement.args[0]
        ? emitExpression(statement.args[0], owner, context, scope)
        : '"error"';
      builder.write(statement.line, `return Err(format!("{}", ${message}));`);
      return;
    }
    case 'break':
      builder.write(statement.line, `break;`);
      return;
    case 'continue':
      builder.write(statement.line, `continue;`);
      return;
    default:
      throw new UnsupportedError(`Sentencia no soportada: «${statement.kind}»`, statement.line ?? 0);
  }
}

/** Emite un `for` de C# como bucle de rango o como `while`. */
function emitFor(statement, owner, builder, context, options) {
  const initializer = statement.initializer;
  const update = statement.update;

  const range = detectRange(initializer, statement.condition, update);
  if (range) {
    const bound = emitExpression(range.bound, owner, context, options);
    builder.write(
      statement.line,
      `for ${snakeCase(range.variable)} in 0..(${bound}) {`,
    );
    emitStatement(statement.body, owner, builder, context, options);
    builder.write(statement.body.endLine ?? statement.line, '}');
    return;
  }

  const init = initializer
    ? emitSimple(initializer, owner, context, options)
    : '';
  const condition = statement.condition
    ? emitExpression(statement.condition, owner, context, options)
    : 'true';
  const step = update ? emitSimple(update, owner, context, options) : '';
  builder.write(statement.line, `let mut ${init};`);
  builder.write(statement.line, `while ${condition} {`);
  emitStatement(statement.body, owner, builder, context, options);
  builder.write(statement.body.endLine ?? statement.line, `}${step ? ` ${step};` : ''}`);
}

/** Detecta el patrón `for (int i = 0; i < N; i++)`. */
function detectRange(initializer, condition, update) {
  if (!initializer || initializer.kind !== 'local') {
    return null;
  }
  if (!initializer.initializer || initializer.initializer.kind !== 'literal') {
    return null;
  }
  if (initializer.initializer.value !== '0') {
    return null;
  }
  if (!condition || condition.kind !== 'binary' || condition.operator !== '<') {
    return null;
  }
  if (condition.left.kind !== 'identifier' || condition.left.name !== initializer.name) {
    return null;
  }
  if (!update || update.kind !== 'expression') {
    return null;
  }
  const updateExpression = update.expression;
  if (
    updateExpression.kind !== 'update' ||
    updateExpression.operator !== '++' ||
    updateExpression.target.kind !== 'identifier' ||
    updateExpression.target.name !== initializer.name
  ) {
    return null;
  }
  return { variable: initializer.name, bound: condition.right };
}

/** Estrategia de iteración según el tipo del elemento. */
function iterationStrategy(elementType, context) {
  const clean = elementType.replace(/\[\]/g, '');
  if (clean === 'string') {
    return 'iter().cloned()';
  }
  if (clean === 'int' || clean === 'double' || clean === 'bool' || clean === 'float') {
    return 'iter().copied()';
  }
  if (context.enums.has(clean)) {
    return 'iter().copied()';
  }
  return 'iter()';
}

function emitSimple(statement, owner, context, scope) {
  if (!statement) {
    return '';
  }
  if (statement.kind === 'local') {
    const initializer = statement.initializer
      ? emitExpression(statement.initializer, owner, context, {
        ...scope,
        expectedType: statement.type,
      })
      : defaultValue(statement.type, context);
    return `${snakeCase(statement.name)}: ${rustType(statement.type, context)} = ${initializer}`;
  }
  if (statement.kind === 'expression') {
    return emitExpression(statement.expression, owner, context, scope);
  }
  return '';
}

// ---------------------------------------------------------------------------
// INFERENCIA DE TIPOS
// ---------------------------------------------------------------------------

function inferType(expression, context, scope) {
  if (!expression) {
    return '';
  }
  switch (expression.kind) {
    case 'literal':
      if (expression.isString) return 'string';
      if (expression.isBool) return 'bool';
      if (expression.isFloat) return 'double';
      return 'int';
    case 'identifier':
      if (expression.name === 'this') {
        return scope.ownerType?.name ?? '';
      }
      return scope.locals?.get(expression.name) ?? '';
    case 'new':
      return expression.type.split('<')[0];
    case 'member':
      return inferMemberType(expression, context, scope);
    case 'call':
      return inferCallType(expression, context, scope);
    case 'index': {
      const targetType = inferType(expression.target, context, scope);
      if (targetType.startsWith('List<')) {
        return targetType.slice(5, -1);
      }
      if (targetType.endsWith('[]')) {
        return targetType.slice(0, -2);
      }
      return targetType;
    }
    case 'binary': {
      const left = inferType(expression.left, context, scope);
      const right = inferType(expression.right, context, scope);
      if (left === 'string' || right === 'string') return 'string';
      if (left === 'double' || right === 'double') return 'double';
      if (left === 'bool' || right === 'bool') return 'bool';
      return 'int';
    }
    case 'unary':
      return inferType(expression.operand, context, scope);
    case 'ternary':
      return inferType(expression.consequent, context, scope);
    case 'update':
      return inferType(expression.target, context, scope);
    case 'lambda':
      return 'lambda';
    default:
      return '';
  }
}

function inferMemberType(expression, context, scope) {
  const targetType = inferType(expression.target, context, scope);
  const owner = context.classes.get(targetType);
  if (owner) {
    const member = owner.members.find(
      (item) =>
        (item.kind === 'field' || item.kind === 'property') && item.name === expression.name,
    );
    if (member) {
      return member.type;
    }
    const method = owner.members.find(
      (item) => item.kind === 'method' && item.name === expression.name,
    );
    if (method) {
      return method.type;
    }
  }
  const iface = context.interfaces.get(targetType);
  if (iface) {
    const method = iface.members.find(
      (item) => item.kind === 'method' && item.name === expression.name,
    );
    if (method) {
      return method.type;
    }
  }
  switch (expression.name) {
    case 'Count':
    case 'Length':
      return 'int';
    case 'Message':
      return 'string';
    default:
      return '';
  }
}

function inferCallType(expression, context, scope) {
  const callee = expression.callee;
  if (callee.kind === 'member') {
    const targetType = inferType(callee.target, context, scope);
    const owner = context.classes.get(targetType);
    if (owner) {
      const method = owner.members.find(
        (item) => item.kind === 'method' && item.name === callee.name,
      );
      if (method) {
        return method.type;
      }
      const property = owner.members.find(
        (item) => item.kind === 'property' && item.name === callee.name,
      );
      if (property) {
        return property.type;
      }
    }
    const iface = context.interfaces.get(targetType);
    if (iface) {
      const method = iface.members.find(
        (item) => item.kind === 'method' && item.name === callee.name,
      );
      if (method) {
        return method.type;
      }
    }
    switch (callee.name) {
      case 'ToString':
        return 'string';
      case 'Where':
      case 'Select':
      case 'ToList':
        return 'List';
      case 'Sum':
        return 'double';
      case 'Count':
        return 'int';
      default:
        return '';
    }
  }
  if (callee.kind === 'identifier') {
    for (const owner of context.classes.values()) {
      const method = owner.members.find(
        (item) => item.kind === 'method' && item.name === callee.name,
      );
      if (method) {
        return method.type;
      }
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// EMISIÓN DE EXPRESIONES
// ---------------------------------------------------------------------------

function emitExpression(expression, owner, context, scope = {}) {
  switch (expression.kind) {
    case 'literal':
      if (expression.isString) {
        const text = `"${expression.value.replace(/"/g, '\\"')}"`;
        return scope.expectedType === 'string' ? `${text}.to_string()` : text;
      }
      if (expression.isBool) {
        return expression.value;
      }
      if (expression.isNull) {
        return 'None';
      }
      if (expression.isFloat) {
        let value = expression.value.replace(/[dDfFmM]$/, '');
        if (!value.includes('.')) {
          value += '.0';
        }
        return value;
      }
      return expression.value.replace(/[lL]$/, '');
    case 'identifier':
      return emitIdentifier(expression, owner, context, scope);
    case 'new': {
      const typeName = expression.type.split('<')[0];
      const generic = expression.type.includes('<')
        ? expression.type.slice(expression.type.indexOf('<') + 1, -1)
        : '';
      const expected = scope.expectedType ?? '';
      const constructor = context.classes.get(typeName)?.members.find(
        (member) => member.kind === 'ctor',
      );
      const parameterTypes = constructor?.parameters?.map((parameter) => parameter.type);
      const args = emitArguments(expression.args, parameterTypes, owner, context, scope);
      if (generic) {
        // `new List<int>()` -> `Vec::<i32>::new()`
        const container = typeName === 'List' ? 'Vec' : typeName;
        return `${container}::<${rustType(generic, context)}>::new(${args.join(', ')})`;
      }
      const base = context.classes.has(typeName)
        ? `${typeName}::new(${args.join(', ')})`
        : `${typeName}::new(${args.join(', ')})`;
      // Si el destino es una interfaz, se envuelve en `Box<dyn Trait>`.
      if (context.interfaces.has(expected.split('<')[0])) {
        return `Box::new(${base})`;
      }
      return base;
    }
    case 'member':
      return emitMemberAccess(expression, owner, context, scope);
    case 'call':
      return emitCall(expression, owner, context, scope);
    case 'index': {
      const target = emitExpression(expression.target, owner, context, scope);
      const index = emitExpression(expression.index, owner, context, scope);
      return `${target}[${index}]`;
    }
    case 'binary':
      return emitBinary(expression, owner, context, scope);
    case 'unary': {
      const operand = emitExpression(expression.operand, owner, context, scope);
      return expression.operator === '-' ? `-${operand}` : `!${operand}`;
    }
    case 'update': {
      const target = emitExpression(expression.target, owner, context, scope);
      return `${target} ${expression.operator === '++' ? '+=' : '-='} 1`;
    }
    case 'ternary': {
      const condition = emitExpression(expression.condition, owner, context, scope);
      const consequent = emitExpression(expression.consequent, owner, context, scope);
      const alternate = emitExpression(expression.alternate, owner, context, { ...scope, expectedType: scope.expectedType });
      return `if ${condition} { ${consequent} } else { ${alternate} }`;
    }
    case 'lambda': {
      const parameters = expression.parameters.map((parameter) => snakeCase(parameter)).join(', ');
      const body = emitExpression(expression.body, owner, context, scope);
      return `|${parameters}| ${body}`;
    }    default:
      throw new UnsupportedError(`Expresión no soportada: «${expression.kind}»`, expression.line);
  }
}

function emitIdentifier(expression, owner, context, scope) {
  const name = expression.name;
  if (name === 'this') {
    return 'self';
  }
  if (scope.dereference?.has(name)) {
    return `*${snakeCase(name)}`;
  }
  if (scope.locals?.has(name)) {
    return snakeCase(name);
  }
  if (scope.catchVariable === name) {
    return '__error';
  }
  const field = owner?.members?.find(
    (item) => (item.kind === 'field' || item.kind === 'property') && item.name === name,
  );
  if (field) {
    if (field.kind === 'property') {
      return scope.instanceName
        ? `${scope.instanceName}.set_${snakeCase(name)}(...)`
        : `self.${snakeCase(name)}()`;
    }
    return scope.instanceName ? `${scope.instanceName}.${snakeCase(name)}` : `self.${snakeCase(name)}`;
  }
  const method = owner?.members?.find(
    (item) => item.kind === 'method' && item.name === name,
  );
  if (method) {
    return scope.static
      ? `${owner.name}::${snakeCase(name)}`
      : `self.${snakeCase(name)}`;
  }
  return snakeCase(name);
}

function emitMemberAccess(expression, owner, context, scope) {
  const target = expression.target;

  // Enumeración: Status.Pending
  if (target.kind === 'identifier' && context.enums.has(target.name)) {
    return `${target.name}::${expression.name}`;
  }

  // Math.PI
  if (
    target.kind === 'identifier' &&
    target.name === 'Math' &&
    expression.name === 'PI'
  ) {
    return 'std::f64::consts::PI';
  }

  // Clase estática: Utilities.Sum
  if (target.kind === 'identifier' && context.classes.has(target.name)) {
    const ownerClass = context.classes.get(target.name);
    const method = ownerClass.members.find(
      (item) => item.kind === 'method' && item.name === expression.name,
    );
    if (method) {
      return `${target.name}::${snakeCase(expression.name)}`;
    }
  }

  const targetText = emitExpression(target, owner, context, scope);
  const targetType = inferType(target, context, scope);

  // `lista.Count` -> `lista.len()`, `texto.Length` -> `texto.len()`
  if (
    (expression.name === 'Count' || expression.name === 'Length') &&
    (targetType.startsWith('List<') || targetType === 'string' || targetType.endsWith('[]'))
  ) {
    return `${targetText}.len()`;
  }

  const ownerClass = context.classes.get(targetType);
  if (ownerClass) {
    const property = ownerClass.members.find(
      (item) => item.kind === 'property' && item.name === expression.name,
    );
    if (property) {
      return `${targetText}.${snakeCase(expression.name)}()`;
    }
    const field = ownerClass.members.find(
      (item) => item.kind === 'field' && item.name === expression.name,
    );
    if (field) {
      return `${targetText}.${snakeCase(expression.name)}`;
    }
  }

  const ownField = owner?.members?.find(
    (item) => item.kind === 'field' && item.name === expression.name,
  );
  if (ownField) {
    return `${targetText}.${snakeCase(expression.name)}`;
  }
  const ownProperty = owner?.members?.find(
    (item) => item.kind === 'property' && item.name === expression.name,
  );
  if (ownProperty) {
    return `${targetText}.${snakeCase(expression.name)}()`;
  }

  // `catch (Exception error)` -> `error.Message`
  if (target.kind === 'identifier' && scope.catchVariable === target.name) {
    return '__error';
  }

  return `${targetText}.${snakeCase(expression.name)}`;
}

function emitBinary(expression, owner, context, scope) {
  let left = emitExpression(expression.left, owner, context, scope);
  let right = emitExpression(expression.right, owner, context, scope);
  const operator = expression.operator;

  if (operator === '+') {
    const leftType = inferType(expression.left, context, scope);
    const rightType = inferType(expression.right, context, scope);
    if (leftType === 'string' || rightType === 'string') {
      return `format!("{}{}", ${left}, ${right})`;
    }
  }
  if (operator === '/') {
    // En C# `doble / entero` es división real; en Rust hace falta el cast.
    const leftType = inferType(expression.left, context, scope);
    const rightType = inferType(expression.right, context, scope);
    if (leftType === 'double' && rightType === 'int') {
      right = `(${right}) as f64`;
    }
  }
  if (operator === '&&') {
    return `(${left} && ${right})`;
  }
  if (operator === '||') {
    return `(${left} || ${right})`;
  }
  return `(${left} ${operator} ${right})`;
}

function emitCall(expression, owner, context, scope) {
  const callee = expression.callee;

  // Console.WriteLine / Console.Write
  if (
    callee.kind === 'member' &&
    callee.target.kind === 'identifier' &&
    callee.target.name === 'Console'
  ) {
    const args = expression.args.map((argument) =>
      emitExpression(argument, owner, context, scope),
    );
    const macro = callee.name === 'Write' ? 'print!' : 'println!';
    if (args.length === 0) {
      return `${macro}("")`;
    }
    if (args.length === 1) {
      return `${macro}("{}", ${args[0]})`;
    }
    const placeholders = args.map(() => '{}').join(', ');
    return `${macro}("${placeholders}", ${args.join(', ')})`;
  }

  // Math.PI
  if (
    callee.kind === 'member' &&
    callee.target.kind === 'identifier' &&
    callee.target.name === 'Math' &&
    callee.name === 'PI'
  ) {
    return 'std::f64::consts::PI';
  }

  // Math.f(x)
  if (
    callee.kind === 'member' &&
    callee.target.kind === 'identifier' &&
    callee.target.name === 'Math'
  ) {
    const args = expression.args.map((argument) =>
      emitExpression(argument, owner, context, scope),
    );
    const first = args[0] ?? '0.0';
    const methods = {
      Sqrt: 'sqrt', Abs: 'abs', Floor: 'floor', Ceiling: 'ceil', Round: 'round',
      Min: 'min', Max: 'max', Pow: 'powf',
    };
    const method = methods[callee.name];
    if (!method) {
      throw new UnsupportedError(`Math.${callee.name} no soportado`, callee.line);
    }
    return `(${first}).${method}(${args.slice(1).join(', ')})`;
  }

  // Lista: Add / ToList / Sum / Where / Select
  if (callee.kind === 'member') {
    const receiverType = inferType(callee.target, context, scope);
    if (receiverType.startsWith('List<') || receiverType === 'List') {
      const receiver = emitExpression(callee.target, owner, context, scope);
      const elementType = receiverType.startsWith('List<')
        ? receiverType.slice(5, -1)
        : '';
      const args = expression.args.map((argument) =>
        emitExpression(argument, owner, context, {
          ...scope,
          expectedType: callee.name === 'Add' ? elementType : undefined,
        }),
      );
      // Si el receptor es un `Vec`, hay que consumirlo como iterador. Si ya
      // viene de otra llamada de LINQ, la cadena sigue siendo un iterador.
      const isVector = receiverType.startsWith('List<');
      const chain = isVector ? `${receiver}.clone().into_iter()` : receiver;
      switch (callee.name) {
        case 'Add':
          return `${receiver}.push(${args.join(', ')})`;
        case 'ToList':
          return `${chain}.collect::<Vec<_>>()`;
        case 'Sum':
          return `${chain}.sum::<f64>()`;
        case 'Count':
          return `${receiver}.len()`;
        case 'Where': {
          // `filter` recibe el elemento por referencia: hay que desreferenciar.
          const lambda = expression.args[0];
          const dereference = new Set();
          if (isPrimitive(elementType) && lambda && lambda.kind === 'lambda') {
            for (const parameter of lambda.parameters) {
              dereference.add(parameter);
            }
          }
          const lambdaText = emitExpression(lambda, owner, context, {
            ...scope,
            dereference,
          });
          return `${chain}.filter(${lambdaText})`;
        }
        case 'Select':
          return `${chain}.map(${args[0]})`;
        default:
          break;
      }
    }
  }

  // ToString("F2") / ToString()
  if (callee.kind === 'member' && callee.name === 'ToString') {
    const receiver = emitExpression(callee.target, owner, context, scope);
    const receiverType = inferType(callee.target, context, scope);
    const format = expression.args[0];
    if (format) {
      const formatValue = format.kind === 'literal' ? format.value : 'F2';
      const spec = formatValue === 'F2' ? '{:.2}' : formatValue === 'F1' ? '{:.1}' : '{}';
      return `format!("${spec}", ${receiver})`;
    }
    if (receiverType === 'string') {
      return `${receiver}.clone()`;
    }
    if (context.enums.has(receiverType)) {
      return `${receiver}.as_str()`;
    }
    return `${receiver}.to_string()`;
  }

  // Métodos que lanzan excepciones: se desenvuelven con `?`.
  const name = callName(callee);
  const parameterTypes = parameterTypesOf(callee, owner, context, scope);
  if (context.throwsMethods.has(name)) {
    const targetText = emitExpression(callee, owner, context, scope);
    const args = emitArguments(expression.args, parameterTypes, owner, context, scope);
    if (scope.inTry) {
      return `${targetText}(${args.join(', ')})?`;
    }
    return `${targetText}(${args.join(', ')}).unwrap_or_else(|__e| panic!("{}", __e))`;
  }

  const targetText = emitExpression(callee, owner, context, scope);
  const args = emitArguments(expression.args, parameterTypes, owner, context, scope);
  return `${targetText}(${args.join(', ')})`;
}

/**
 * Tipos de los parámetros de un método, para adaptar los argumentos.
 *
 * En C# un `string` es un valor; en Rust puede ser `&str` o `String`. Aquí se
 * elige `String` (propiedad), así que los literales se convierten con
 * `.to_string()`.
 */
function parameterTypesOf(callee, owner, context, scope) {
  let method;
  if (callee.kind === 'member') {
    const targetType = inferType(callee.target, context, scope);
    const ownerClass = context.classes.get(targetType);
    if (ownerClass) {
      method = ownerClass.members.find(
        (item) => item.kind === 'method' && item.name === callee.name,
      );
    }
    if (!method && callee.target.kind === 'identifier') {
      const staticClass = context.classes.get(callee.target.name);
      if (staticClass) {
        method = staticClass.members.find(
          (item) => item.kind === 'method' && item.name === callee.name,
        );
      }
    }
    if (!method) {
      const iface = context.interfaces.get(targetType);
      if (iface) {
        method = iface.members.find(
          (item) => item.kind === 'method' && item.name === callee.name,
        );
      }
    }
  } else if (callee.kind === 'identifier') {
    method = owner?.members?.find(
      (item) => item.kind === 'method' && item.name === callee.name,
    );
  }
  return method?.parameters?.map((parameter) => parameter.type);
}

/** Emite los argumentos adaptándolos al tipo del parámetro. */
function emitArguments(args, parameterTypes, owner, context, scope) {
  return args.map((argument, index) => {
    const expected = parameterTypes?.[index];
    return emitExpression(argument, owner, context, { ...scope, expectedType: expected });
  });
}

function callName(callee) {
  if (callee.kind === 'member') {
    return callee.name;
  }
  if (callee.kind === 'identifier') {
    return callee.name;
  }
  return '';
}

// ---------------------------------------------------------------------------
// API PÚBLICA
// ---------------------------------------------------------------------------

/**
 * Recoge los nombres de tipo que menciona un fichero.
 *
 * Se usa para generar los `use` cruzados entre ficheros del proyecto.
 */
function collectTypeNames(node, found = new Set()) {
  if (node === null || typeof node !== 'object') {
    return found;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectTypeNames(item, found);
    }
    return found;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' && typeof value === 'string') {
      found.add(value.split('<')[0].replace(/\[\]/g, ''));
    } else if (key === 'bases' && Array.isArray(value)) {
      for (const base of value) {
        found.add(String(base).split('<')[0]);
      }
    } else {
      collectTypeNames(value, found);
    }
  }
  return found;
}

/**
 * Traduce un conjunto de ficheros C# a Rust.
 *
 * @param {Array<{name: string, content: string}>} files
 * @returns {Array<{name: string, rust: string, sourceMap: Array<{rustLine: number, rshLine: number}>}>}
 */
export function transpileProject(files) {
  const parsed = files.map((file) => {
    const parser = new Parser(file.content);
    const parsedFile = parser.parseFile();
    return { name: file.name, ...parsedFile };
  });

  const context = buildContext(parsed);

  // De qué fichero viene cada tipo: para los `use` cruzados.
  const typeToFile = new Map();
  for (const file of parsed) {
    for (const type of file.types) {
      typeToFile.set(type.name, file.name);
    }
  }

  const results = [];
  for (const file of parsed) {
    const builder = emitFile(file, context);

    // `use crate::<modulo>::<Tipo>;` para los tipos de otros ficheros.
    const referenced = collectTypeNames(file.types);
    const uses = [];
    for (const typeName of referenced) {
      const owner = typeToFile.get(typeName);
      if (owner === undefined || owner === file.name) {
        continue;
      }
      uses.push(`use crate::${snakeCase(owner)}::${typeName};`);
    }
    if (uses.length > 0) {
      builder.write(1, uses.join(' '));
    }

    const rust = builder.toString();
    const sourceMap = [];
    const lines = rust.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].trim().length > 0) {
        sourceMap.push({ rustLine: index + 1, rshLine: index + 1 });
      }
    }

    // Clase con punto de entrada `Main`.
    let entryClass;
    for (const type of file.types) {
      for (const member of type.members ?? []) {
        if (member.kind === 'method' && member.name === 'Main') {
          entryClass = type.name;
        }
      }
    }

    results.push({ name: file.name, rust, sourceMap, entryClass });
  }

  return results;
}
