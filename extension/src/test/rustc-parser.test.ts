/**
 * Tests de `src/rustc-parser.ts` con capturas reales de la salida de `rustc`.
 */

import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCargoOutput, parseRustcOutput } from '../rustc-parser';

/** Captura real de rustc: error con código, ubicación y bloque con gutter. */
const RUSTC_ERROR = [
  'error[E0308]: mismatched types',
  '   --> gen/main.rs:12:5',
  '    |',
  '12  |     let x: i32 = "hola";',
  '    |            ---   ^^^^ expected `i32`, found `&str`',
  '    |            |',
  '    |            expected due to this',
  '    |',
  'error: aborting due to 2 previous errors',
].join('\n');

test('parseRustcOutput: extrae código, severidad, mensaje y ubicación', () => {
  const diags = parseRustcOutput(RUSTC_ERROR);

  assert.equal(diags.length, 2);

  const first = diags[0];
  assert.equal(first.code, 'E0308');
  assert.equal(first.severity, 'error');
  assert.equal(first.message, 'mismatched types');
  assert.equal(first.file, 'gen/main.rs');
  assert.equal(first.line, 12);
  assert.equal(first.column, 5);
});

test('parseRustcOutput: el bloque completo queda en raw', () => {
  const [first] = parseRustcOutput(RUSTC_ERROR);

  assert.ok(first.raw.startsWith('error[E0308]: mismatched types'));
  assert.ok(first.raw.includes('--> gen/main.rs:12:5'));
  assert.ok(first.raw.includes('expected due to this'));
  assert.equal(first.raw.includes('error: aborting'), false);
});

test('parseRustcOutput: un bloque sin --> no tiene archivo ni línea', () => {
  const diags = parseRustcOutput(RUSTC_ERROR);

  const summary = diags[1];
  assert.equal(summary.severity, 'error');
  assert.equal(summary.message, 'aborting due to 2 previous errors');
  assert.equal(summary.file, undefined);
  assert.equal(summary.line, undefined);
  assert.equal(summary.column, undefined);
  assert.equal(summary.code, undefined);
});

test('parseRustcOutput: warning sin código', () => {
  const diags = parseRustcOutput(
    [
      "warning: unused variable: `x`",
      ' --> src/main.rs:3:9',
      '  |',
      '3 |     let x = 5;',
      '  |         ^ help: if this is intentional, prefix it with an underscore: `_x`',
      '  |',
      "  = note: `#[warn(unused_variables)]` on by default",
    ].join('\n'),
  );

  assert.equal(diags.length, 1);
  const [warning] = diags;
  assert.equal(warning.severity, 'warning');
  assert.equal(warning.code, undefined);
  assert.equal(warning.message, 'unused variable: `x`');
  assert.equal(warning.file, 'src/main.rs');
  assert.equal(warning.line, 3);
  assert.equal(warning.column, 9);
  assert.equal(warning.help, 'if this is intentional, prefix it with an underscore: `_x`');
});

test('parseRustcOutput: error sin código y sin ubicación', () => {
  const diags = parseRustcOutput("error: cannot find value `x` in this scope");

  assert.equal(diags.length, 1);
  const [error] = diags;
  assert.equal(error.code, undefined);
  assert.equal(error.severity, 'error');
  assert.equal(error.message, 'cannot find value `x` in this scope');
  assert.equal(error.file, undefined);
});

test('parseRustcOutput: recoge la línea de ayuda que sigue al error', () => {
  const diags = parseRustcOutput(
    [
      'error[E0277]: the trait bound `i32: Display` is not satisfied',
      ' --> src/main.rs:5:5',
      '  |',
      '5 |     println!("{}", x);',
      '  |            ^^^^^ `i32` cannot be formatted with the default formatter',
      '  |',
      'help: consider using `{}` to display the value',
      '  |',
      'help: `i32` implements `Debug` but not `Display`',
    ].join('\n'),
  );

  const [error] = diags;
  assert.equal(error.code, 'E0277');
  assert.ok(error.help?.includes('consider using `{}` to display the value'));
  assert.ok(error.help?.includes('`i32` implements `Debug` but not `Display`'));
});

test('parseRustcOutput: la nota no se confunde con la ayuda', () => {
  const diags = parseRustcOutput(
    [
      'error[E0433]: failed to resolve: use of undeclared type `Foo`',
      ' --> src/main.rs:2:5',
      '  |',
      '2 |     let x: Foo = y;',
      '  |             ^^^ not found in this scope',
      '  |',
      "  = note: help: if you meant to use a crate named `Foo`, use `::Foo`",
    ].join('\n'),
  );

  const [error] = diags;
  assert.equal(error.help, undefined);
});

test('parseRustcOutput: rutas de Windows con barras invertidas y espacios', () => {
  const diags = parseRustcOutput(
    [
      'error[E0308]: mismatched types',
      '  --> C:\\Users\\dev\\my project\\gen\\main.rs:12:5',
      '   |',
      '12 |     let x: i32 = "hola";',
      '   |            ---   ^^^^ expected `i32`, found `&str`',
    ].join('\n'),
  );

  const [error] = diags;
  assert.equal(error.file, 'C:\\Users\\dev\\my project\\gen\\main.rs');
  assert.equal(error.line, 12);
  assert.equal(error.column, 5);
});

test('parseRustcOutput: varios errores en la misma salida', () => {
  const diags = parseRustcOutput(
    [
      "error[E0425]: cannot find value `x` in this scope",
      ' --> src/main.rs:4:5',
      '  |',
      '4 |     x + 1',
      '  |     ^ not found in this scope',
      '',
      "error[E0308]: mismatched types",
      ' --> src/main.rs:9:13',
      '  |',
      '9 |     let y: u8 = "hola";',
      '  |                 ^^^^^^ expected `u8`, found `&str`',
      '',
      'error: aborting due to 2 previous errors',
    ].join('\n'),
  );

  assert.equal(diags.length, 3);
  assert.deepEqual(
    diags.map((d) => d.code),
    ['E0425', 'E0308', undefined],
  );
  assert.deepEqual(
    diags.map((d) => d.line),
    [4, 9, undefined],
  );
});

test('parseCargoOutput: ignora las líneas de estatus de cargo', () => {
  const diags = parseCargoOutput(
    [
      '   Compiling rsharp v0.1.0 (/home/dev/proyecto)',
      '    Finished dev [unoptimized + debuginfo] target(s) in 1.23s',
      '     Running `target/debug/rsharp`',
      '',
      'error[E0308]: mismatched types',
      '  --> gen/main.rs:3:18',
      '  |',
      '3 |     let x: i32 = "hola";',
      '  |            ---   ^^^^ expected `i32`, found `&str`',
      '',
      "error: could not compile `rsharp` (bin \"rsharp\") due to 1 previous error",
    ].join('\n'),
  );

  assert.equal(diags.length, 2);
  assert.equal(diags[0].code, 'E0308');
  assert.equal(diags[0].file, 'gen/main.rs');
  assert.equal(diags[0].line, 3);
  assert.equal(diags[0].column, 18);
  assert.equal(diags[1].message, 'could not compile `rsharp` (bin "rsharp") due to 1 previous error');
  assert.equal(diags[1].file, undefined);
});

test('parseCargoOutput: una compilación correcta no produce diagnósticos', () => {
  const diags = parseCargoOutput(
    [
      '   Compiling rsharp v0.1.0 (/home/dev/proyecto)',
      '    Finished dev [unoptimized + debuginfo] target(s) in 1.23s',
      '     Running `target/debug/rsharp`',
    ].join('\n'),
  );

  assert.deepEqual(diags, []);
});

test('parseRustcOutput: salida vacía', () => {
  assert.deepEqual(parseRustcOutput(''), []);
});
