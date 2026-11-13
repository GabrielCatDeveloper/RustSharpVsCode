/**
 * El archivo de bloqueo: `rsharp.lock`.
 *
 * La spec §3 lo define como el fichero que guarda «resultados de IA, hashes y
 * versiones fijas», y §9 añade que guarda «el hash de la configuración de
 * sugar» y que «un cambio de valor invalida los bloqueos afectados».
 *
 * Formato: JSON (como `package-lock.json`), porque es un fichero de estado
 * generado, no de configuración escrito a mano.
 *
 * ```json
 * {
 *   "version": 1,
 *   "sugar": { "hash": "sha256:…" },
 *   "crates": { "rand": { "version": "0.8", "apiHash": "sha256:…" } },
 *   "libraries": { "mylib": { "version": "1.0.0", "hash": "sha256:…" } }
 * }
 * ```
 *
 * Este módulo NO importa `vscode`: es lógica pura y se prueba en Node.
 */

import { createHash } from 'node:crypto';

import type { SugarConfig } from './types';

/** Versión del formato del archivo de bloqueo. */
export const LOCK_FILE_VERSION = 1;

/** Nombre del archivo de bloqueo. */
export const LOCK_FILE_NAME = 'rsharp.lock';

/** Contenido del archivo de bloqueo. */
export interface LockFile {
  /** Versión del formato. */
  version: number;
  /** Hash de la configuración de sugar vigente. */
  sugar?: { hash: string };
  /** Versión y hash de la API de cada crate enlazado. */
  crates?: Record<string, { version: string; apiHash: string }>;
  /** Versión y hash de cada librería externa. */
  libraries?: Record<string, { version?: string; hash: string }>;
  /** Hash del resultado de cada bloque con IA. */
  ai?: Record<string, { hash: string }>;
}

/** Estado del bloqueo respecto al proyecto actual. */
export type LockStatus = 'ok' | 'stale' | 'missing' | 'invalid';

/** Resultado de inspeccionar el bloqueo. */
export interface LockInspection {
  status: LockStatus;
  /** Mensaje para el usuario, en español. */
  message: string;
  /** Rutas de lo que ha quedado invalidado. */
  affected: string[];
  /** Contenido analizado, si se pudo leer. */
  lock?: LockFile;
}

/**
 * Analiza el texto de un `rsharp.lock`.
 *
 * Devuelve `undefined` si el contenido no es un bloqueo válido: un bloqueo
 * corrupto no debe impedir usar la extensión.
 */
export function parseLockFile(text: string): LockFile | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    const candidate = parsed as Partial<LockFile>;
    return {
      version: typeof candidate.version === 'number' ? candidate.version : LOCK_FILE_VERSION,
      sugar: candidate.sugar,
      crates: candidate.crates,
      libraries: candidate.libraries,
      ai: candidate.ai,
    };
  } catch {
    return undefined;
  }
}

/**
 * Calcula el hash de la configuración de sugar.
 *
 * El hash se calcula sobre la forma **canónica** (claves ordenadas), de modo
 * que reordenar el `rsharp.toml` no invalide el bloqueo: solo lo hace
 * cambiar un valor.
 */
export function hashSugar(sugar: SugarConfig): string {
  const canonical = JSON.stringify({
    cycles: sugar.cycles,
    finalizers: sugar.finalizers,
    overflow: sugar.overflow,
    reentrancy: sugar.reentrancy,
    strings: sugar.strings,
  });
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

/**
 * Compara el bloqueo con el estado actual del proyecto.
 *
 * Reglas (spec §9):
 * - si el fichero no está, no hay nada que invalidar;
 * - si el hash del sugar no coincide, el cambio **invalida los bloqueos
 *   afectados**: crates, librerías y bloques con IA.
 */
export function inspectLock(
  text: string | undefined,
  sugar: SugarConfig,
): LockInspection {
  if (text === undefined) {
    return {
      status: 'missing',
      message: `No hay "${LOCK_FILE_NAME}": todavía no se ha fijado ninguna versión.`,
      affected: [],
    };
  }

  const lock = parseLockFile(text);
  if (!lock) {
    return {
      status: 'invalid',
      message: `"${LOCK_FILE_NAME}" no se puede leer: el formato no es válido.`,
      affected: [],
    };
  }

  const current = hashSugar(sugar);
  const stored = lock.sugar?.hash;

  if (stored === undefined) {
    return {
      status: 'ok',
      message: `"${LOCK_FILE_NAME}" no fija el hash del sugar vigente.`,
      affected: [],
      lock,
    };
  }

  if (stored === current) {
    return {
      status: 'ok',
      message: `"${LOCK_FILE_NAME}" está al día.`,
      affected: [],
      lock,
    };
  }

  const affected: string[] = [];
  if (lock.crates && Object.keys(lock.crates).length > 0) {
    affected.push(...Object.keys(lock.crates).map((name) => `el crate «${name}»`));
  }
  if (lock.libraries && Object.keys(lock.libraries).length > 0) {
    affected.push(...Object.keys(lock.libraries).map((name) => `la librería «${name}»`));
  }
  if (lock.ai && Object.keys(lock.ai).length > 0) {
    affected.push(...Object.keys(lock.ai).map((name) => `el bloque con IA «${name}»`));
  }

  return {
    status: 'stale',
    message:
      `El sugar cambió desde que se fijó "${LOCK_FILE_NAME}": ` +
      'los bloqueos afectados quedan invalidados y hay que regenerarlos.',
    affected,
    lock,
  };
}
