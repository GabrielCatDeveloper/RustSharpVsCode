/**
 * Pruebas del lado de .NET (compilación con Roslyn y clasificación de
 * artefactos).
 */

import * as path from 'node:path';

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyArtifact, describeArtifact, isRunnable } from '../artifact';
import { parseDotnetDiagnostics } from '../csharp';

test('parseDotnetDiagnostics: extrae el error con su .rsh y su línea', () => {
  const text = [
    '/proyecto/src/Program.rsh(12,5): error CS1002: ; expected [/proyecto/demo.csproj]',
    '/proyecto/src/Program.rsh(20,1): warning CS0168: variable declared but never used [/proyecto/demo.csproj]',
    'Compilación correcta.',
  ].join('\n');

  const diagnostics = parseDotnetDiagnostics(text, '/proyecto');
  assert.equal(diagnostics.length, 2);

  const error = diagnostics[0];
  assert.equal(error.code, 'CS1002');
  assert.equal(error.severity, 'error');
  assert.equal(error.message, '; expected');
  assert.equal(error.file, '/proyecto/src/Program.rsh');
  assert.equal(error.line, 12);
  assert.equal(error.column, 5);

  const warning = diagnostics[1];
  assert.equal(warning.severity, 'warning');
  assert.equal(warning.code, 'CS0168');
});

test('parseDotnetDiagnostics: una salida sin errores no produce diagnósticos', () => {
  const diagnostics = parseDotnetDiagnostics('Compilación correcta.\n', '/proyecto');
  assert.deepEqual(diagnostics, []);
});

test('classifyArtifact: reconoce ejecutables, módulos y bibliotecas', () => {
  assert.equal(classifyArtifact('/dist/mi_app'), 'native');
  assert.equal(classifyArtifact('/dist/mi_app.exe'), 'native');
  assert.equal(classifyArtifact('/dist/mi_app.wasm'), 'wasm');
  assert.equal(classifyArtifact('/dist/libmi_app.so'), 'library');
  assert.equal(classifyArtifact('/dist/libmi_app.dylib'), 'library');
  assert.equal(classifyArtifact('/dist/mi_app.dll'), 'library');
});

test('classifyArtifact: el destino manda sobre la extensión', () => {
  assert.equal(classifyArtifact('/dist/salida', 'wasm32-unknown-unknown'), 'wasm');
  assert.equal(classifyArtifact('/dist/salida', 'wasm32-wasip1'), 'wasm');
  assert.equal(classifyArtifact('/dist/salida', 'native'), 'native');
});

test('isRunnable: solo los ejecutables nativos se ejecutan', () => {
  assert.equal(isRunnable('native'), true);
  assert.equal(isRunnable('wasm'), false);
  assert.equal(isRunnable('library'), false);
});

test('describeArtifact: explica qué se puede hacer con cada tipo', () => {
  assert.match(describeArtifact('native'), /ejecutable nativo/);
  assert.match(describeArtifact('wasm'), /WebAssembly/);
  assert.match(describeArtifact('library'), /biblioteca/);
});

test('las rutas del artefacto no dependen del sistema de ficheros', () => {
  const unix = classifyArtifact('/dist/mi_app');
  const windows = classifyArtifact(path.join('C:', 'dist', 'mi_app.exe'));
  assert.equal(unix, 'native');
  assert.equal(windows, 'native');
});
