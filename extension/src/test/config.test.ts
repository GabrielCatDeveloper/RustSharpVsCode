import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { loadProjectConfig, parseRSharpToml } from '../config';

/** Crea una carpeta temporal para un proyecto de pruebas. */
function makeProject(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsharp-config-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

/** Configuración de ejemplo válida y completa. */
const FULL_TOML = [
  'schema = 1',
  'plugins = ["uno", "dos"]',
  '',
  '[project]',
  'name = "mi_app"',
  '',
  '[paths]',
  'output = "gen"',
  'dist = "bin"',
  '',
  '[build]',
  'target = "wasm32-unknown-unknown"',
  'profile = "release"',
  '',
  '[sugar]',
  'strings = "utf16"',
  'overflow = "wrap"',
  'reentrancy = "serialize"',
  'finalizers = "gc-like"',
  'cycles = "leak"',
  '',
  '[sugar.ai]',
  'enabled = true',
  'provider = "ollama"',
  'endpoint = "http://localhost:11434"',
  'model = "qwen2.5-coder"',
  'lock = "mi.lock"',
  'max_tokens_per_block = 1234',
  '',
  '[dependencies]',
  'serde_json = "1.0"',
  'rand = { version = "0.8", features = ["small_rng"] }',
  '',
  '[foreign.mylib]',
  'kind = "native"',
  'path = "libs/mylib.dll"',
  'header = "libs/mylib.h"',
  'link = "dynamic"',
  '',
  '[foreign.numpy]',
  'kind = "python"',
  'version = ">=1.26"',
  '',
  '[profile.release.sugar]',
  'overflow = "wrap"',
].join('\n');

test('parseRSharpToml rellena todos los campos con valores por defecto', () => {
  const filePath = path.join(os.tmpdir(), 'proyecto', 'rsharp.toml');
  const toml = parseRSharpToml('', filePath);

  assert.equal(toml.schema, 1);
  assert.equal(toml.project.name, 'proyecto');
  assert.equal(toml.paths.output, path.join('target', 'rsharp'));
  assert.equal(toml.paths.dist, 'dist');
  assert.equal(toml.build.target, 'native');
  assert.equal(toml.build.profile, undefined);
  assert.deepEqual(toml.sugar, {
    strings: 'utf8',
    overflow: 'panic',
    reentrancy: 'panic',
    finalizers: 'deterministic',
    cycles: 'weak-attribute',
  });
  assert.equal(toml.ai.enabled, false);
  assert.equal(toml.ai.provider, 'none');
  assert.equal(toml.ai.lock, 'rsharp.lock');
  assert.equal(toml.ai.maxTokensPerBlock, 4000);
  assert.deepEqual(toml.plugins, []);
  assert.deepEqual(toml.dependencies, {});
  assert.deepEqual(toml.foreign, {});
  assert.deepEqual(toml.profiles, {});
  assert.equal(toml.filePath, path.resolve(filePath));
});

test('parseRSharpToml lee un archivo completo', () => {
  const toml = parseRSharpToml(FULL_TOML, path.join(os.tmpdir(), 'mi_app', 'rsharp.toml'));

  assert.equal(toml.schema, 1);
  assert.equal(toml.project.name, 'mi_app');
  assert.equal(toml.paths.output, 'gen');
  assert.equal(toml.paths.dist, 'bin');
  assert.equal(toml.build.target, 'wasm32-unknown-unknown');
  assert.equal(toml.build.profile, 'release');
  assert.equal(toml.sugar.strings, 'utf16');
  assert.equal(toml.sugar.overflow, 'wrap');
  assert.equal(toml.sugar.reentrancy, 'serialize');
  assert.equal(toml.sugar.finalizers, 'gc-like');
  assert.equal(toml.sugar.cycles, 'leak');
  assert.equal(toml.ai.enabled, true);
  assert.equal(toml.ai.provider, 'ollama');
  assert.equal(toml.ai.endpoint, 'http://localhost:11434');
  assert.equal(toml.ai.model, 'qwen2.5-coder');
  assert.equal(toml.ai.lock, 'mi.lock');
  assert.equal(toml.ai.maxTokensPerBlock, 1234);
  assert.deepEqual(toml.plugins, ['uno', 'dos']);
  assert.equal(toml.dependencies['serde_json'], '1.0');
  assert.deepEqual(toml.dependencies['rand'], { version: '0.8', features: ['small_rng'] });
  assert.equal(toml.foreign['mylib'].kind, 'native');
  assert.equal(toml.foreign['mylib'].path, 'libs/mylib.dll');
  assert.equal(toml.foreign['mylib'].header, 'libs/mylib.h');
  assert.equal(toml.foreign['mylib'].link, 'dynamic');
  assert.equal(toml.foreign['numpy'].kind, 'python');
  assert.equal(toml.foreign['numpy'].version, '>=1.26');
  assert.deepEqual(toml.profiles['release'], { overflow: 'wrap' });
});

test('parseRSharpToml lanza si el TOML es inválido', () => {
  assert.throws(() => parseRSharpToml('a = "sin cerrar', 'rsharp.toml'), /cadena/i);
  assert.throws(() => parseRSharpToml('paths = "no es una tabla"', 'rsharp.toml'), /tabla/i);
});

test('loadProjectConfig usa los valores por defecto si no hay rsharp.toml', (t) => {
  const root = makeProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const config = loadProjectConfig(root, {});

  assert.equal(config.projectRoot, path.resolve(root));
  assert.equal(config.toml, null);
  assert.equal(config.outputDir, path.join(path.resolve(root), 'target', 'rsharp'));
  assert.equal(config.distDir, path.join(path.resolve(root), 'dist'));
  assert.equal(config.target, 'native');
  assert.equal(config.profile, 'debug');
  assert.equal(config.source, 'default');
  assert.equal(config.warnings.length, 1);
  assert.match(config.warnings[0], /rsharp\.toml/);
});

test('loadProjectConfig da prioridad al rsharp.toml sobre los ajustes de VSCode', (t) => {
  const root = makeProject({ 'rsharp.toml': FULL_TOML });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const config = loadProjectConfig(root, {
    outputDir: 'ajustes/salida',
    distDir: 'ajustes/binario',
    target: 'native',
    profile: 'debug',
  });

  assert.notEqual(config.toml, null);
  assert.equal(config.outputDir, path.join(path.resolve(root), 'gen'));
  assert.equal(config.distDir, path.join(path.resolve(root), 'bin'));
  assert.equal(config.target, 'wasm32-unknown-unknown');
  assert.equal(config.profile, 'release');
  assert.equal(config.source, 'toml');
  assert.deepEqual(config.warnings, []);
});

test('las rutas relativas del toml se resuelven contra la carpeta del toml', (t) => {
  const root = makeProject({
    'rsharp.toml': ['[paths]', 'output = "gen/nested"', 'dist = "../dist-externo"'].join('\n'),
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const config = loadProjectConfig(root, {});

  assert.equal(config.outputDir, path.join(path.resolve(root), 'gen', 'nested'));
  assert.equal(config.distDir, path.resolve(root, '..', 'dist-externo'));
  assert.ok(!config.outputDir.startsWith(process.cwd()));
});

test('las rutas absolutas del toml se respetan', (t) => {
  const absolute = path.join(os.tmpdir(), 'rsharp-salida-absoluta');
  const root = makeProject({ 'rsharp.toml': `[paths]\noutput = ${JSON.stringify(absolute)}\n` });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const config = loadProjectConfig(root, {});
  assert.equal(config.outputDir, absolute);
});

test('los ajustes de VSCode se usan cuando el toml no define [paths]', (t) => {
  const root = makeProject({ 'rsharp.toml': '[project]\nname = "x"\n' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const config = loadProjectConfig(root, {
    outputDir: 'mi-salida',
    distDir: 'mi-binario',
    target: 'wasm32-wasip1',
    profile: 'release',
  });

  assert.equal(config.outputDir, path.join(path.resolve(root), 'mi-salida'));
  assert.equal(config.distDir, path.join(path.resolve(root), 'mi-binario'));
  assert.equal(config.target, 'wasm32-wasip1');
  assert.equal(config.profile, 'release');
  assert.equal(config.source, 'vscode');
});

test('un rsharp.toml mal formado no lanza: avisa y usa los valores por defecto', (t) => {
  const root = makeProject({ 'rsharp.toml': 'esto = "no es toml válido' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const config = loadProjectConfig(root, { outputDir: 'ajustes' });

  assert.equal(config.toml, null);
  assert.equal(config.outputDir, path.join(path.resolve(root), 'ajustes'));
  assert.equal(config.source, 'vscode');
  assert.ok(config.warnings.some((w) => /no es válido/i.test(w)));
});

test('avisa si outputDir y distDir son la misma carpeta', (t) => {
  const root = makeProject({ 'rsharp.toml': '[paths]\noutput = "igual"\ndist = "igual"\n' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const config = loadProjectConfig(root, {});

  assert.equal(config.outputDir, config.distDir);
  assert.ok(config.warnings.some((w) => /misma/i.test(w)));
});

test('avisa si el esquema no es 1, pero no es un error', (t) => {
  const root = makeProject({ 'rsharp.toml': 'schema = 2\n' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const config = loadProjectConfig(root, {});

  assert.notEqual(config.toml, null);
  assert.equal(config.toml?.schema, 2);
  assert.ok(config.warnings.some((w) => /esquema/i.test(w)));
});

test('avisa si el destino del toml no es válido y usa "native"', (t) => {
  const root = makeProject({ 'rsharp.toml': '[build]\ntarget = "no-existe"\n' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const config = loadProjectConfig(root, {});

  assert.equal(config.target, 'native');
  assert.ok(config.warnings.some((w) => /build\.target/i.test(w)));
});

test('avisa si el destino de VSCode no es válido y usa "native"', (t) => {
  const root = makeProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const config = loadProjectConfig(root, { target: 'no-existe' });

  assert.equal(config.target, 'native');
  assert.ok(config.warnings.some((w) => /rsharp\.target/i.test(w)));
});

test('avisa si el perfil de VSCode no es válido y usa "debug"', (t) => {
  const root = makeProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const config = loadProjectConfig(root, { profile: 'optimizado' });

  assert.equal(config.profile, 'debug');
  assert.ok(config.warnings.some((w) => /rsharp\.profile/i.test(w)));
});

test('el perfil del toml tiene prioridad sobre el de VSCode', (t) => {
  const root = makeProject({ 'rsharp.toml': '[build]\nprofile = "release"\n' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const config = loadProjectConfig(root, { profile: 'debug' });

  assert.equal(config.profile, 'release');
  assert.equal(config.source, 'toml');
});

test('los perfiles del toml recogen los overrides de sugar', (t) => {
  const root = makeProject({ 'rsharp.toml': FULL_TOML });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const config = loadProjectConfig(root, {});

  assert.deepEqual(config.toml?.profiles['release'], { overflow: 'wrap' });
});

test('las rutas de salida no llevan barra final', (t) => {
  const root = makeProject({ 'rsharp.toml': '[paths]\noutput = "gen/"\ndist = "bin/"\n' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const config = loadProjectConfig(root, {});

  assert.equal(config.outputDir, path.join(path.resolve(root), 'gen'));
  assert.equal(config.distDir, path.join(path.resolve(root), 'bin'));
  assert.ok(!config.outputDir.endsWith(path.sep));
  assert.ok(!config.distDir.endsWith(path.sep));
});

test('acepta el ejemplo de la spec §9 tal cual', (t) => {
  const root = makeProject({
    'rsharp.toml': [
      'schema = 1',
      '',
      '[project]',
      'name = "mi_app"',
      '',
      '[paths]',
      'output = "gen"',
      'dist = "bin"',
      '',
      '[build]',
      'target = "native"',
      '',
      '[sugar]',
      'strings = "utf8"',
      'overflow = "panic"',
      'reentrancy = "panic"',
      'finalizers = "deterministic"',
      'cycles = "weak-attribute"',
      '',
      '[sugar.ai]',
      'enabled = true',
      'provider = "ollama"',
      'endpoint = "http://localhost:11434"',
      'model = "qwen2.5-coder"',
      'lock = "rsharp.lock"',
      'max_tokens_per_block = 4000',
      '',
      '[plugins]',
      '# lista ordenada',
      '',
      '[dependencies]',
      'serde_json = "1.0"',
      'rand = { version = "0.8", features = ["small_rng"] }',
      '',
      '[foreign.mylib]',
      'kind = "native"',
      'path = "libs/mylib.dll"',
      'header = "libs/mylib.h"',
      'link = "dynamic"',
      '',
      '[foreign.numpy]',
      'kind = "python"',
      'version = ">=1.26"',
      '',
      '[profile.release.sugar]',
      'overflow = "wrap"',
    ].join('\n'),
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const config = loadProjectConfig(root, {});

  assert.notEqual(config.toml, null);
  assert.deepEqual(config.warnings, []);
  assert.equal(config.toml?.project.name, 'mi_app');
  assert.equal(config.toml?.ai.maxTokensPerBlock, 4000);
  assert.equal(config.toml?.ai.provider, 'ollama');
  assert.deepEqual(config.toml?.plugins, []);
  assert.deepEqual(config.toml?.profiles['release'], { overflow: 'wrap' });
  assert.equal(config.outputDir, path.join(path.resolve(root), 'gen'));
  assert.equal(config.distDir, path.join(path.resolve(root), 'bin'));
  assert.equal(config.target, 'native');
  assert.equal(config.profile, 'debug');
  assert.equal(config.source, 'toml');
});

test('los ajustes vacíos o nulos se ignoran', (t) => {
  const root = makeProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const config = loadProjectConfig(root, { outputDir: null, distDir: '   ' });

  assert.equal(config.outputDir, path.join(path.resolve(root), 'target', 'rsharp'));
  assert.equal(config.distDir, path.join(path.resolve(root), 'dist'));
  assert.equal(config.source, 'default');
});
