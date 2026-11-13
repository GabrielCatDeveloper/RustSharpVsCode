/**
 * Clasificación del artefacto generado.
 *
 * El resultado de R# es Rust, y Rust es flexible: un mismo proyecto puede
 * producir un ejecutable nativo, un módulo WebAssembly, una biblioteca
 * compartida... La extensión **no debe** asumir que siempre hay un `.exe`.
 *
 * Este módulo decide qué se puede hacer con el artefacto y por qué, para que
 * la interfaz pueda explicarlo en lugar de fallar.
 */

import * as path from 'node:path';

import type { RSharpTarget } from './types';

/** Tipos de artefacto que la extensión sabe reconocer. */
export type ArtifactKind = 'native' | 'wasm' | 'library' | 'unknown';

/**
 * Clasifica un artefacto por su extensión y por el destino de la compilación.
 */
export function classifyArtifact(
  artifactPath: string,
  target?: RSharpTarget,
): ArtifactKind {
  if (target !== undefined && target.startsWith('wasm32')) {
    return 'wasm';
  }

  const extension = path.extname(artifactPath).toLowerCase();
  switch (extension) {
    case '.wasm':
      return 'wasm';
    case '.dll':
    case '.so':
    case '.dylib':
    case '.a':
    case '.lib':
      return 'library';
    case '.exe':
    case '':
      return 'native';
    default:
      return 'unknown';
  }
}

/**
 * Explicación, en español, de qué se puede hacer con el artefacto.
 *
 * Se usa en los avisos para que el usuario entienda el motivo y no vea un
 * error genérico.
 */
export function describeArtifact(kind: ArtifactKind): string {
  switch (kind) {
    case 'native':
      return 'Es un ejecutable nativo: se puede ejecutar y depurar.';
    case 'wasm':
      return (
        'Es un módulo WebAssembly: no se ejecuta como programa. ' +
        'Se puede abrir con un navegador o servirlo con un servidor estático.'
      );
    case 'library':
      return (
        'Es una biblioteca: no se ejecuta. Se puede enlazar desde otro ' +
        'proyecto Rust con `[Extern]` o desde un lenguaje con FFI.'
      );
    default:
      return 'No se reconoce el tipo de artefacto generado.';
  }
}

/**
 * `true` si el artefacto se puede ejecutar directamente.
 */
export function isRunnable(kind: ArtifactKind): boolean {
  return kind === 'native';
}
