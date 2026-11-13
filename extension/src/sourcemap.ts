/**
 * Source maps de R#: traducción de líneas de Rust generado a líneas del
 * archivo `.rsh` original.
 *
 * Ver rsharp-spec.md §14.4 ("Traduce errores de `rustc` a líneas de R# con
 * source maps") y §17 ("Cada diagnóstico apunta a la línea de R#, no a la de
 * Rust").
 *
 * Este módulo no importa `vscode` ni `node:fs`: es lógica pura y se puede
 * probar en Node puro.
 */

import * as path from 'node:path';

import type { RSharpSourceMap, RSharpSourceMapEntry } from './types';

/**
 * Construye el mapa línea-Rust -> línea-R# de un source map.
 *
 * Si hay varias entradas para la misma línea de Rust, gana la última
 * (la más reciente del mapa).
 */
export function buildLineMap(map: RSharpSourceMap): Map<number, number> {
  const lines = new Map<number, number>();
  for (const entry of map.entries ?? []) {
    lines.set(entry.rustLine, entry.rshLine);
  }
  return lines;
}

/**
 * Resuelve una posición de un archivo Rust generado a la línea del archivo
 * R# de origen.
 *
 * - Busca el source map cuyo `rustFile` coincide con `rustFile`. La
 *   comparación es por ruta normalizada (barras invertidas y `/`), y también
 *   acepta que uno sea el final del otro (p. ej. `gen/main.rs` frente a
 *   `/abs/proyecto/target/rsharp/gen/main.rs`).
 * - Devuelve la entrada más cercana ANTERIOR (la última con
 *   `rustLine <= line`).
 * - Si no hay ninguna entrada anterior, usa la primera entrada del mapa.
 * - Devuelve `undefined` si ningún mapa coincide o si el mapa no tiene
 *   entradas.
 */
export function resolveRustLocation(
  rustFile: string,
  line: number,
  maps: RSharpSourceMap[],
): { rshFile: string; rshLine: number } | undefined {
  const map = findMap(rustFile, maps);
  if (!map) {
    return undefined;
  }

  const entries = map.entries ?? [];
  if (entries.length === 0) {
    return undefined;
  }

  let best: RSharpSourceMapEntry | undefined;
  for (const entry of entries) {
    if (entry.rustLine <= line) {
      // `>=` hace que, a igual distancia, gane la última entrada.
      if (!best || entry.rustLine >= best.rustLine) {
        best = entry;
      }
    }
  }

  const chosen = best ?? entries[0];
  return { rshFile: map.rshFile, rshLine: chosen.rshLine };
}

/**
 * Busca el source map que corresponde a `rustFile`: primero una coincidencia
 * exacta (tras normalizar) y, si no hay, una coincidencia por final de ruta.
 */
function findMap(rustFile: string, maps: RSharpSourceMap[]): RSharpSourceMap | undefined {
  const target = normalizePath(rustFile);

  for (const map of maps) {
    if (normalizePath(map.rustFile) === target) {
      return map;
    }
  }

  for (const map of maps) {
    if (tailMatches(normalizePath(map.rustFile), target)) {
      return map;
    }
  }

  return undefined;
}

/**
 * Resuelve una posición del archivo R# original a la línea del Rust generado.
 *
 * Es la operación inversa de {@link resolveRustLocation} y se usa para
 * traducir los puntos de parada que el usuario pone en un `.rsh` a las líneas
 * del Rust que ejecuta el depurador.
 *
 * - Busca el source map cuyo `rshFile` coincide con `rshFile`.
 * - Devuelve la entrada más cercana ANTERIOR (la última con `rshLine <= line`).
 * - Si no hay ninguna anterior, usa la primera entrada del mapa.
 */
export function resolveRshLocation(
  rshFile: string,
  line: number,
  maps: RSharpSourceMap[],
): { rustFile: string; rustLine: number } | undefined {
  const map = findMapByRsh(rshFile, maps);
  if (!map) {
    return undefined;
  }

  const entries = map.entries ?? [];
  if (entries.length === 0) {
    return undefined;
  }

  let best: RSharpSourceMapEntry | undefined;
  for (const entry of entries) {
    if (entry.rshLine <= line) {
      if (!best || entry.rshLine >= best.rshLine) {
        best = entry;
      }
    }
  }

  const chosen = best ?? entries[0];
  return { rustFile: map.rustFile, rustLine: chosen.rustLine };
}

/**
 * Busca el source map que corresponde al archivo R# `rshFile`.
 *
 * Primero exige coincidencia exacta (tras normalizar) y, si no hay, acepta
 * que uno sea el final del otro (p. ej. `src/main.rsh` frente a
 * `/abs/proyecto/src/main.rsh`).
 */
function findMapByRsh(rshFile: string, maps: RSharpSourceMap[]): RSharpSourceMap | undefined {
  const target = normalizePath(rshFile);

  for (const map of maps) {
    if (normalizePath(map.rshFile) === target) {
      return map;
    }
  }

  for (const map of maps) {
    if (tailMatches(normalizePath(map.rshFile), target)) {
      return map;
    }
  }

  return undefined;
}

/**
 * Construye el remapeo de rutas que entiende LLDB (`target.source-map remap`).
 *
 * Devuelve un diccionario `{ rutaDelRsh: rutaDelRust }` con rutas absolutas.
 *
 * Con este remapeo, un punto de parada puesto sobre `main.rsh` llega a LLDB
 * como un punto de parada sobre `main.rs`: el depurador deja de quejarse de
 * que el fichero no existe.
 *
 * Ojo con el alcance: el remapeo es **de fichero, no de línea**. El punto de
 * parada conservará el número de línea del `.rsh`. Por eso el punto de parada
 * cae en la línea correcta cuando el compilador emite un Rust alineado línea a
 * línea con el `.rsh` (lo recomienda el contrato de la CLI); si no está
 * alineado, hay que usar el array `breakpoints` de `launch.json`, que sí se
 * traduce línea a línea.
 */
export function buildSourcePathRemap(
  maps: RSharpSourceMap[],
  root: string,
  outputDir: string,
): Record<string, string> {
  const remap: Record<string, string> = {};
  for (const map of maps) {
    if (!map.rshFile || !map.rustFile) {
      continue;
    }
    const rshPath = path.isAbsolute(map.rshFile)
      ? map.rshFile
      : path.resolve(root, map.rshFile);
    const rustPath = path.isAbsolute(map.rustFile)
      ? map.rustFile
      : path.resolve(outputDir, map.rustFile);
    remap[rshPath] = rustPath;
  }
  return remap;
}

/**
 * Normaliza una ruta: barras invertidas -> `/`, sin barras duplicadas, sin
 * prefijo `./` y sin barra final.
 */
function normalizePath(filePath: string): string {
  let normalized = filePath.replace(/\\/g, '/');
  normalized = normalized.replace(/\/{2,}/g, '/');
  normalized = normalized.replace(/^\.\//, '');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * `true` si una ruta es el final de la otra (con `/` como separador).
 */
function tailMatches(a: string, b: string): boolean {
  if (!a || !b) {
    return false;
  }
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}
