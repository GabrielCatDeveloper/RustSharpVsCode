/**
 * Tests de `src/session.ts`: estado de la última sesión de R#.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RSharpSession, SESSION_FILE_NAME } from '../session';
import type { SessionState } from '../session';
import type { RSharpSourceMap } from '../types';

const SOURCE_MAPS: RSharpSourceMap[] = [
  {
    rustFile: 'gen/main.rs',
    rshFile: 'src/main.rsh',
    entries: [
      { rustLine: 1, rshLine: 1 },
      { rustLine: 12, rshLine: 12 },
    ],
  },
];

test('get: devuelve undefined antes de la primera actualización', () => {
  const session = new RSharpSession();

  assert.equal(session.get(), undefined);
});

test('update: crea el estado inicial con los valores por defecto', () => {
  const session = new RSharpSession();

  const state = session.update({ projectRoot: '/workspace/proyecto' });

  assert.equal(state.projectRoot, '/workspace/proyecto');
  assert.equal(state.outputDir, '');
  assert.equal(state.distDir, '');
  assert.equal(state.target, 'native');
  assert.equal(state.profile, 'debug');
  assert.deepEqual(state.sourceMaps, []);
  assert.deepEqual(state.generatedFiles, []);
});

test('update: fusiona campos parciales con el estado anterior', () => {
  const session = new RSharpSession();

  session.update({
    projectRoot: '/workspace/proyecto',
    outputDir: '/workspace/proyecto/target/rsharp',
    sourceMaps: SOURCE_MAPS,
  });
  const state = session.update({ target: 'wasm32-unknown-unknown', profile: 'release' });

  assert.equal(state.projectRoot, '/workspace/proyecto');
  assert.equal(state.outputDir, '/workspace/proyecto/target/rsharp');
  assert.equal(state.target, 'wasm32-unknown-unknown');
  assert.equal(state.profile, 'release');
  assert.deepEqual(state.sourceMaps, SOURCE_MAPS);
});

test('update: actualiza updatedAt', async () => {
  const session = new RSharpSession();

  const first = session.update({ projectRoot: '/workspace/proyecto' });
  assert.ok(first.updatedAt > 0);
  assert.ok(Math.abs(Date.now() - first.updatedAt) < 60_000);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = session.update({ projectRoot: '/workspace/otro' });

  assert.ok(second.updatedAt > first.updatedAt);
});

test('update: el estado devuelto es el mismo que guarda la sesión', () => {
  const session = new RSharpSession();

  const state = session.update({ projectRoot: '/workspace/proyecto' });

  assert.deepEqual(session.get(), state);
});

test('serialize + deserialize: conserva projectRoot, sourceMaps, target y profile', () => {
  const session = new RSharpSession();
  session.update({
    projectRoot: '/workspace/proyecto',
    outputDir: '/workspace/proyecto/target/rsharp',
    distDir: '/workspace/proyecto/dist',
    target: 'wasm32-unknown-unknown',
    profile: 'release',
    artifact: 'dist/mi_app.wasm',
    sourceMaps: SOURCE_MAPS,
  });

  const restored = new RSharpSession().deserialize(session.serialize());

  assert.ok(restored);
  assert.equal(restored.projectRoot, '/workspace/proyecto');
  assert.equal(restored.target, 'wasm32-unknown-unknown');
  assert.equal(restored.profile, 'release');
  assert.deepEqual(restored.sourceMaps, SOURCE_MAPS);
  assert.equal(restored.outputDir, '/workspace/proyecto/target/rsharp');
  assert.equal(restored.distDir, '/workspace/proyecto/dist');
  assert.equal(restored.artifact, 'dist/mi_app.wasm');
});

test('serialize + deserialize: el estado completo sobrevive al viaje de ida y vuelta', () => {
  const session = new RSharpSession();
  const original = session.update({
    projectRoot: '/workspace/proyecto',
    outputDir: '/workspace/proyecto/target/rsharp',
    distDir: '/workspace/proyecto/dist',
    target: 'wasm32-unknown-unknown',
    profile: 'release',
    artifact: 'dist/mi_app.wasm',
    sourceMaps: SOURCE_MAPS,
    generatedFiles: [{ path: 'gen/main.rs', language: 'rust', lines: 42 }],
  });

  const restored = new RSharpSession().deserialize(session.serialize());

  assert.deepEqual(restored, original);
});

test('serialize: sin estado devuelve "null"', () => {
  const session = new RSharpSession();

  assert.strictEqual(session.serialize(), 'null');
});

test('deserialize: con texto inválido devuelve undefined y no lanza', () => {
  const session = new RSharpSession();

  assert.equal(session.deserialize('esto no es json'), undefined);
  assert.equal(session.deserialize(''), undefined);
  assert.equal(session.get(), undefined);
});

test('deserialize: un JSON que no es un estado válido devuelve undefined', () => {
  const session = new RSharpSession();

  assert.equal(session.deserialize('null'), undefined);
  assert.equal(session.deserialize('42'), undefined);
  assert.equal(session.deserialize('"texto"'), undefined);
  assert.equal(session.deserialize('{}'), undefined);
});

test('deserialize: un deserialize inválido no borra el estado anterior', () => {
  const session = new RSharpSession();
  session.update({ projectRoot: '/workspace/proyecto' });

  assert.equal(session.deserialize('{ roto'), undefined);
  assert.equal(session.get()?.projectRoot, '/workspace/proyecto');
});

test('deserialize: rellena los campos ausentes con valores por defecto', () => {
  const session = new RSharpSession();

  const state = session.deserialize(JSON.stringify({ projectRoot: '/workspace/proyecto' }));

  assert.ok(state);
  assert.equal(state.outputDir, '');
  assert.equal(state.distDir, '');
  assert.equal(state.target, 'native');
  assert.equal(state.profile, 'debug');
  assert.deepEqual(state.sourceMaps, []);
  assert.deepEqual(state.generatedFiles, []);
});

test('deserialize: el estado cargado queda disponible en la sesión', () => {
  const session = new RSharpSession();

  const state = session.deserialize(
    JSON.stringify({ projectRoot: '/workspace/proyecto', sourceMaps: SOURCE_MAPS }),
  );

  assert.deepEqual(session.get(), state);
});

test('clear: vacía el estado', () => {
  const session = new RSharpSession();
  session.update({ projectRoot: '/workspace/proyecto' });

  session.clear();

  assert.equal(session.get(), undefined);
});

test('clear: después de limpiar, update vuelve a crear el estado', () => {
  const session = new RSharpSession();
  session.update({ projectRoot: '/workspace/proyecto', target: 'wasm32-unknown-unknown' });

  session.clear();
  const state = session.update({ projectRoot: '/workspace/otro' });

  assert.equal(state.projectRoot, '/workspace/otro');
  assert.equal(state.target, 'native');
});

test('SESSION_FILE_NAME: es el nombre del fichero de sesión', () => {
  assert.strictEqual(SESSION_FILE_NAME, '.rsharp-session.json');
});

test('SessionState: el estado serializado es JSON válido', () => {
  const session = new RSharpSession();
  session.update({ projectRoot: '/workspace/proyecto' });

  const parsed: unknown = JSON.parse(session.serialize());

  assert.equal(typeof parsed, 'object');
  assert.ok(parsed !== null);
  const state = parsed as Partial<SessionState>;
  assert.equal(state.projectRoot, '/workspace/proyecto');
});
