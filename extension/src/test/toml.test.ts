import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseToml, TomlParseError, type TomlTable, type TomlValue } from '../toml';

/** Helper: parsea y devuelve la tabla raíz. */
function parseTable(text: string): TomlTable {
  const value: TomlValue = parseToml(text);
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value;
}

/** Helper: devuelve el error de parseo de un texto inválido. */
function expectError(text: string): TomlParseError {
  try {
    parseToml(text);
  } catch (error) {
    assert.ok(error instanceof TomlParseError, `se esperaba TomlParseError, llegó: ${String(error)}`);
    return error;
  }
  assert.fail('se esperaba un TomlParseError');
}

test('parsea valores escalares básicos', () => {
  const table = parseTable(
    [
      'texto = "hola"',
      "literal = 'mundo'",
      'entero = 42',
      'negativo = -7',
      'flotante = 3.14',
      'exponente = 1.5e3',
      'booleano = true',
      'falso = false',
    ].join('\n'),
  );

  assert.equal(table.texto, 'hola');
  assert.equal(table.literal, 'mundo');
  assert.equal(table.entero, 42);
  assert.equal(table.negativo, -7);
  assert.equal(table.flotante, 3.14);
  assert.equal(table.exponente, 1500);
  assert.equal(table.booleano, true);
  assert.equal(table.falso, false);
});

test('admite enteros con separadores y bases hex/oct/bin', () => {
  const table = parseTable(
    ['millon = 1_000_000', 'hexa = 0xDEAD_BEEF', 'octal = 0o755', 'binario = 0b1101'].join('\n'),
  );

  assert.equal(table.millon, 1000000);
  assert.equal(table.hexa, 0xdeadbeef);
  assert.equal(table.octal, 0o755);
  assert.equal(table.binario, 0b1101);
});

test('admite flotantes especiales', () => {
  const table = parseTable(['positivo = inf', 'negativo = -inf', 'nan = nan'].join('\n'));

  assert.equal(table.positivo, Infinity);
  assert.equal(table.negativo, -Infinity);
  assert.ok(Number.isNaN(table.nan as number));
});

test('ignora los comentarios', () => {
  const table = parseTable(
    ['# comentario de línea', 'a = 1 # comentario al final', '#', 'b = 2'].join('\n'),
  );

  assert.equal(table.a, 1);
  assert.equal(table.b, 2);
  assert.equal(Object.keys(table).length, 2);
});

test('no interpreta "#" dentro de una cadena como comentario', () => {
  const table = parseTable('color = "#ff0000" # esto sí es un comentario');
  assert.equal(table.color, '#ff0000');
});

test('parsea tablas anidadas', () => {
  const table = parseTable(
    ['[a]', 'x = 1', '[a.b]', 'y = 2', '[a.b.c]', 'z = 3'].join('\n'),
  );

  const a = table.a as TomlTable;
  const b = a.b as TomlTable;
  const c = b.c as TomlTable;
  assert.equal(a.x, 1);
  assert.equal(b.y, 2);
  assert.equal(c.z, 3);
});

test('parsea arrays de tablas', () => {
  const table = parseTable(
    ['[[producto]]', 'nombre = "uno"', '[[producto]]', 'nombre = "dos"'].join('\n'),
  );

  const productos = table.producto as TomlValue[];
  assert.ok(Array.isArray(productos));
  assert.equal(productos.length, 2);
  assert.equal((productos[0] as TomlTable).nombre, 'uno');
  assert.equal((productos[1] as TomlTable).nombre, 'dos');
});

test('parsea arrays en línea, vacíos y anidados', () => {
  const table = parseTable(
    [
      'vacio = []',
      'numeros = [1, 2, 3]',
      'con_coma = [1, 2, 3,]',
      'matriz = [[1, 2], [3, 4]]',
      'mixtos = ["a", true, 4]',
    ].join('\n'),
  );

  assert.deepEqual(table.vacio, []);
  assert.deepEqual(table.numeros, [1, 2, 3]);
  assert.deepEqual(table.con_coma, [1, 2, 3]);
  assert.deepEqual(table.matriz, [
    [1, 2],
    [3, 4],
  ]);
  assert.deepEqual(table.mixtos, ['a', true, 4]);
});

test('admite saltos de línea y comentarios dentro de un array', () => {
  const table = parseTable(['lista = [', '  1, # uno', '  2,', ']'].join('\n'));
  assert.deepEqual(table.lista, [1, 2]);
});

test('parsea tablas en línea', () => {
  const table = parseTable('rand = { version = "0.8", features = ["small_rng"] }');

  const rand = table.rand as TomlTable;
  assert.equal(rand.version, '0.8');
  assert.deepEqual(rand.features, ['small_rng']);
});

test('gestiona escapes de cadenas básicas', () => {
  const table = parseTable(
    [
      'a = "tab\\there"',
      'b = "nueva\\nlínea"',
      'c = "comilla\\"dentro"',
      'd = "barra\\\\"',
      'e = "unicode \\u00E9"',
    ].join('\n'),
  );

  assert.equal(table.a, 'tab\there');
  assert.equal(table.b, 'nueva\nlínea');
  assert.equal(table.c, 'comilla"dentro');
  assert.equal(table.d, 'barra\\');
  assert.equal(table.e, 'unicode é');
});

test('las cadenas literales no interpretan escapes', () => {
  const table = parseTable("a = 'C:\\ruta\\sin\\escapes'");
  assert.equal(table.a, 'C:\\ruta\\sin\\escapes');
});

test('parsea cadenas multilínea', () => {
  const table = parseTable(
    [
      'basica = """',
      'linea 1',
      'linea 2"""',
      "literal = '''sin escapes \\n'''",
      "multilinea = '''",
      'linea 1',
      "linea 2'''",
    ].join('\n'),
  );

  assert.equal(table.basica, 'linea 1\nlinea 2');
  assert.equal(table.literal, 'sin escapes \\n');
  assert.equal(table.multilinea, 'linea 1\nlinea 2');
});

test('la barra invertida al final de línea recorta espacios en una cadena multilínea', () => {
  const table = parseTable('a = """uno \\\n    dos"""');
  assert.equal(table.a, 'uno dos');
});

test('admite claves con comillas y claves punteadas', () => {
  const table = parseTable(
    ['"clave con espacios" = 1', "a.b = 2", 'a.c = 3', '"x y".z = 4'].join('\n'),
  );

  assert.equal(table['clave con espacios'], 1);
  const a = table.a as TomlTable;
  assert.equal(a.b, 2);
  assert.equal(a.c, 3);
  assert.equal((table['x y'] as TomlTable).z, 4);
});

test('una clave punteada crea la tabla intermedia', () => {
  const table = parseTable('fruit.apple.color = "rojo"');

  const fruit = table.fruit as TomlTable;
  const apple = fruit.apple as TomlTable;
  assert.equal(apple.color, 'rojo');
});

test('rechaza las fechas con un mensaje claro', () => {
  const error = expectError('fecha = 1979-05-27');
  assert.match(error.message, /fechas/i);
  assert.equal(error.line, 1);
  assert.equal(error.column, 9);
});

test('rechaza las horas', () => {
  const error = expectError('hora = 07:32:00');
  assert.match(error.message, /fechas/i);
});

test('informa de la línea y la columna (1-based) de los errores', () => {
  const error = expectError(['a = 1', 'b = 2', 'c = "sin cerrar'].join('\n'));
  assert.equal(error.line, 3);
  assert.equal(error.column, 5);
  assert.ok(error instanceof Error);
});

test('rechaza una tabla duplicada', () => {
  const error = expectError(['[a]', 'x = 1', '[a]', 'y = 2'].join('\n'));
  assert.match(error.message, /más de una vez/i);
  assert.equal(error.line, 3);
});

test('rechaza una clave duplicada', () => {
  const error = expectError(['a = 1', 'a = 2'].join('\n'));
  assert.match(error.message, /duplicada/i);
  assert.equal(error.line, 2);
});

test('rechaza un valor inválido', () => {
  const error = expectError('a = @');
  assert.match(error.message, /valor no válido/i);
  assert.equal(error.line, 1);
  assert.equal(error.column, 5);
});

test('rechaza una cadena sin cerrar', () => {
  const error = expectError('a = "abc');
  assert.match(error.message, /no está cerrada/i);
});

test('rechaza un número inválido', () => {
  const error = expectError('a = 1__0');
  assert.match(error.message, /número no válido/i);
});

test('rechaza un escape desconocido', () => {
  const error = expectError('a = "\\q"');
  assert.match(error.message, /escape desconocido/i);
});

test('rechaza redefinir una tabla creada con claves punteadas', () => {
  const error = expectError(['a.b = 1', '[a]'].join('\n'));
  assert.match(error.message, /claves punteadas/i);
});

test('acepta definir después una super-tabla creada por una cabecera', () => {
  const table = parseTable(['[a.b]', 'x = 1', '[a]', 'y = 2'].join('\n'));

  const a = table.a as TomlTable;
  assert.equal(a.y, 2);
  assert.equal((a.b as TomlTable).x, 1);
});

test('acepta arrays de tablas anidados', () => {
  const table = parseTable(
    ['[[a]]', 'nombre = "uno"', '[[a]]', 'nombre = "dos"', '[[a.b]]', 'x = 1'].join('\n'),
  );

  const list = table.a as TomlValue[];
  assert.equal(list.length, 2);
  assert.equal((list[1] as TomlTable).nombre, 'dos');
});

test('el resultado es una tabla raíz', () => {
  const value = parseToml('a = 1');
  assert.ok(typeof value === 'object' && !Array.isArray(value));
});
