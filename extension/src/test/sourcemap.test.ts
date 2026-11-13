/**
 * Tests de `src/sourcemap.ts`.
 */

import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildLineMap, buildSourcePathRemap, resolveRshLocation, resolveRustLocation } from '../sourcemap';
import type { RSharpSourceMap } from '../types';

const MAP: RSharpSourceMap = {
  rustFile: 'gen/main.rs',
  rshFile: 'src/main.rsh',
  entries: [
    { rustLine: 1, rshLine: 1 },
    { rustLine: 10, rshLine: 4 },
    { rustLine: 20, rshLine: 9 },
  ],
};

test('buildLineMap: mapea línea Rust -> línea R#', () => {
  const map = buildLineMap(MAP);

  assert.equal(map.size, 3);
  assert.equal(map.get(1), 1);
  assert.equal(map.get(10), 4);
  assert.equal(map.get(20), 9);
});

test('buildLineMap: con líneas Rust repetidas gana la última entrada', () => {
  const map = buildLineMap({
    rustFile: 'gen/main.rs',
    rshFile: 'src/main.rsh',
    entries: [
      { rustLine: 7, rshLine: 3 },
      { rustLine: 7, rshLine: 5 },
    ],
  });

  assert.equal(map.size, 1);
  assert.equal(map.get(7), 5);
});

test('buildLineMap: mapa sin entradas', () => {
  assert.equal(buildLineMap({ rustFile: 'gen/main.rs', rshFile: 'src/main.rsh', entries: [] }).size, 0);
});

test('resolveRustLocation: devuelve la entrada anterior más cercana', () => {
  const location = resolveRustLocation('gen/main.rs', 15, [MAP]);

  assert.deepEqual(location, { rshFile: 'src/main.rsh', rshLine: 4 });
});

test('resolveRustLocation: línea exacta', () => {
  const location = resolveRustLocation('gen/main.rs', 20, [MAP]);

  assert.deepEqual(location, { rshFile: 'src/main.rsh', rshLine: 9 });
});

test('resolveRustLocation: sin entrada anterior usa la primera', () => {
  const location = resolveRustLocation('gen/main.rs', 0, [MAP]);

  assert.deepEqual(location, { rshFile: 'src/main.rsh', rshLine: 1 });
});

test('resolveRustLocation: sin mapas coincidentes devuelve undefined', () => {
  assert.equal(resolveRustLocation('gen/otro.rs', 5, [MAP]), undefined);
  assert.equal(resolveRustLocation('gen/main.rs', 5, []), undefined);
});

test('resolveRustLocation: coincide por final de ruta (absoluta vs relativa)', () => {
  const location = resolveRustLocation('/home/dev/proyecto/target/rsharp/gen/main.rs', 15, [MAP]);

  assert.deepEqual(location, { rshFile: 'src/main.rsh', rshLine: 4 });
});

test('resolveRustLocation: acepta barras invertidas de Windows', () => {
  const windowsMap: RSharpSourceMap = {
    rustFile: 'target\\rsharp\\gen\\main.rs',
    rshFile: 'src\\main.rsh',
    entries: [
      { rustLine: 1, rshLine: 1 },
      { rustLine: 42, rshLine: 20 },
    ],
  };

  const location = resolveRustLocation('target/rsharp/gen/main.rs', 50, [windowsMap]);

  assert.deepEqual(location, { rshFile: 'src\\main.rsh', rshLine: 20 });
});

test('resolveRustLocation: la coincidencia exacta tiene prioridad sobre la de final de ruta', () => {
  const generic: RSharpSourceMap = {
    rustFile: 'src/gen/main.rs',
    rshFile: 'src/otro.rsh',
    entries: [{ rustLine: 1, rshLine: 100 }],
  };
  const exact: RSharpSourceMap = {
    rustFile: 'gen/main.rs',
    rshFile: 'src/main.rsh',
    entries: [{ rustLine: 1, rshLine: 1 }],
  };

  const location = resolveRustLocation('gen/main.rs', 3, [generic, exact]);

  assert.deepEqual(location, { rshFile: 'src/main.rsh', rshLine: 1 });
});

test('resolveRustLocation: un mapa sin entradas devuelve undefined', () => {
  const empty: RSharpSourceMap = { rustFile: 'gen/main.rs', rshFile: 'src/main.rsh', entries: [] };

  assert.equal(resolveRustLocation('gen/main.rs', 3, [empty]), undefined);
});

test('resolveRustLocation: busca entre varios mapas', () => {
  const other: RSharpSourceMap = {
    rustFile: 'gen/otro.rs',
    rshFile: 'src/otro.rsh',
    entries: [{ rustLine: 1, rshLine: 50 }],
  };

  const location = resolveRustLocation('gen/main.rs', 20, [other, MAP]);

  assert.deepEqual(location, { rshFile: 'src/main.rsh', rshLine: 9 });
});

test('resolveRshLocation: devuelve la entrada anterior más cercana', () => {
  const location = resolveRshLocation('src/main.rsh', 12, [MAP]);

  assert.deepEqual(location, { rustFile: 'gen/main.rs', rustLine: 20 });
});

test('resolveRshLocation: línea exacta', () => {
  const location = resolveRshLocation('src/main.rsh', 4, [MAP]);

  assert.deepEqual(location, { rustFile: 'gen/main.rs', rustLine: 10 });
});

test('resolveRshLocation: sin entrada anterior usa la primera', () => {
  const location = resolveRshLocation('src/main.rsh', 0, [MAP]);

  assert.deepEqual(location, { rustFile: 'gen/main.rs', rustLine: 1 });
});

test('resolveRshLocation: una línea posterior a todas usa la última entrada', () => {
  const location = resolveRshLocation('src/main.rsh', 900, [MAP]);

  assert.deepEqual(location, { rustFile: 'gen/main.rs', rustLine: 20 });
});

test('resolveRshLocation: sin mapas coincidentes devuelve undefined', () => {
  assert.equal(resolveRshLocation('src/otro.rsh', 5, [MAP]), undefined);
  assert.equal(resolveRshLocation('src/main.rsh', 5, []), undefined);
});

test('resolveRshLocation: un mapa sin entradas devuelve undefined', () => {
  const empty: RSharpSourceMap = { rustFile: 'gen/main.rs', rshFile: 'src/main.rsh', entries: [] };

  assert.equal(resolveRshLocation('src/main.rsh', 3, [empty]), undefined);
});

test('resolveRshLocation: coincide por final de ruta (absoluta vs relativa)', () => {
  const absolute: RSharpSourceMap = {
    rustFile: '/workspace/proyecto/target/rsharp/gen/main.rs',
    rshFile: '/workspace/proyecto/src/main.rsh',
    entries: [
      { rustLine: 1, rshLine: 1 },
      { rustLine: 42, rshLine: 20 },
    ],
  };

  const location = resolveRshLocation('src/main.rsh', 25, [absolute]);

  assert.deepEqual(location, {
    rustFile: '/workspace/proyecto/target/rsharp/gen/main.rs',
    rustLine: 42,
  });
});

test('resolveRshLocation: un mapa relativo encaja con una ruta absoluta', () => {
  const location = resolveRshLocation('/workspace/proyecto/src/main.rsh', 12, [MAP]);

  assert.deepEqual(location, { rustFile: 'gen/main.rs', rustLine: 20 });
});

test('resolveRshLocation: acepta barras invertidas de Windows', () => {
  const windowsMap: RSharpSourceMap = {
    rustFile: 'target\\rsharp\\gen\\main.rs',
    rshFile: 'src\\main.rsh',
    entries: [
      { rustLine: 1, rshLine: 1 },
      { rustLine: 42, rshLine: 20 },
    ],
  };

  const location = resolveRshLocation('src/main.rsh', 50, [windowsMap]);

  assert.deepEqual(location, { rustFile: 'target\\rsharp\\gen\\main.rs', rustLine: 42 });
});

test('resolveRshLocation: la coincidencia exacta tiene prioridad sobre la de final de ruta', () => {
  const generic: RSharpSourceMap = {
    rustFile: 'src/gen/main.rs',
    rshFile: 'src/otro.rsh',
    entries: [{ rustLine: 100, rshLine: 1 }],
  };
  const exact: RSharpSourceMap = {
    rustFile: 'gen/main.rs',
    rshFile: 'src/main.rsh',
    entries: [{ rustLine: 1, rshLine: 1 }],
  };

  const location = resolveRshLocation('src/main.rsh', 3, [generic, exact]);

  assert.deepEqual(location, { rustFile: 'gen/main.rs', rustLine: 1 });
});

test('resolveRshLocation: busca entre varios mapas', () => {
  const other: RSharpSourceMap = {
    rustFile: 'gen/otro.rs',
    rshFile: 'src/otro.rsh',
    entries: [{ rustLine: 50, rshLine: 1 }],
  };

  const location = resolveRshLocation('src/main.rsh', 12, [other, MAP]);

  assert.deepEqual(location, { rustFile: 'gen/main.rs', rustLine: 20 });
});

test('resolveRshLocation: es la operación inversa de resolveRustLocation', () => {
  for (const line of [1, 5, 9, 12, 30]) {
    const rsh = resolveRustLocation('gen/main.rs', line, [MAP]);
    assert.ok(rsh);

    const rust = resolveRshLocation(rsh.rshFile, rsh.rshLine, [MAP]);
    assert.ok(rust);

    assert.equal(rust.rustFile, 'gen/main.rs');
    assert.ok(rust.rustLine <= line);
  }
});

// ---------------------------------------------------------------------------
// Remapeo de rutas para LLDB (`target.source-map remap`)
// ---------------------------------------------------------------------------

test('buildSourcePathRemap: une cada .rsh con su .rs enrutado', () => {
  const remap = buildSourcePathRemap([MAP], '/proyecto', '/proyecto/target/rsharp');
  assert.equal(remap['/proyecto/src/main.rsh'], '/proyecto/target/rsharp/gen/main.rs');
});

test('buildSourcePathRemap: sin source maps devuelve un mapa vacío', () => {
  assert.deepEqual(buildSourcePathRemap([], '/proyecto', '/salida'), {});
});
