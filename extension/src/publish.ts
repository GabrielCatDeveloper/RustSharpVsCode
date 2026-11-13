/**
 * Publicación de diagnósticos en el editor.
 *
 * Aquí se materializa la idea central de R#: el usuario escribe C# en `.rsh` y
 * los errores se muestran en el `.rsh`. El Rust generado es un producto
 * intermedio (§1) y su código no aparece en el editor salvo que el usuario
 * lo pida de forma explícita.
 *
 * Flujo:
 * 1. La CLI devuelve diagnósticos de R# (`envelope.diagnostics`) con
 *    coordenadas del `.rsh`.
 * 2. La CLI devuelve la salida de `cargo` (`envelope.cargo.stderr`), que
 *    contiene errores de `rustc` en el Rust generado.
 * 3. `rustc-parser` los convierte en diagnósticos de Rust.
 * 4. `sourcemap` los traduce a la línea del `.rsh`.
 * 5. Aquí se publican como `vscode.Diagnostic`.
 */

import * as path from 'node:path';

import * as vscode from 'vscode';

import type { CleanDiagnostic } from './errors';
import { formatCleanDiagnostic, mapRustDiagnostic } from './errors';
import type { RSharpDiagnostic, RSharpSourceMap, RustDiagnostic } from './types';

/** Identificador de la colección de diagnósticos de R#. */
export const DIAGNOSTIC_COLLECTION_NAME = 'rsharp';

/** Convierte un diagnóstico de R# en un `vscode.Diagnostic`. */
export function toVscodeDiagnostic(diagnostic: RSharpDiagnostic): vscode.Diagnostic {
  const line = Math.max(0, (diagnostic.line ?? 1) - 1);
  const character = Math.max(0, (diagnostic.column ?? 1) - 1);
  const length = Math.max(1, diagnostic.length ?? 1);

  const range = new vscode.Range(
    new vscode.Position(line, character),
    new vscode.Position(line, character + length),
  );

  const severity = toSeverity(diagnostic.severity);
  const result = new vscode.Diagnostic(
    range,
    diagnostic.help ? `${diagnostic.message}\n\n${diagnostic.help}` : diagnostic.message,
    severity,
  );
  result.source = 'R#';
  result.code = diagnostic.code;
  return result;
}

/** Convierte un diagnóstico limpio (ya traducido al `.rsh`) en `vscode.Diagnostic`. */
export function cleanToVscodeDiagnostic(diagnostic: CleanDiagnostic): vscode.Diagnostic {
  const location = diagnostic.location;
  const line = Math.max(0, (location?.line ?? 1) - 1);
  const character = Math.max(0, (location?.column ?? 1) - 1);

  const range = new vscode.Range(
    new vscode.Position(line, character),
    new vscode.Position(line, character + 1),
  );

  const message = diagnostic.help
    ? `${diagnostic.message}\n\n${diagnostic.help}`
    : diagnostic.message;

  const result = new vscode.Diagnostic(
    range,
    message,
    diagnostic.severity === 'warning'
      ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Error,
  );
  result.source = 'R#';
  if (diagnostic.code) {
    result.code = diagnostic.code;
  }
  return result;
}

/** Traduce la severidad de R# a la de VSCode. */
function toSeverity(severity: RSharpDiagnostic['severity']): vscode.DiagnosticSeverity {
  switch (severity) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    case 'info':
      return vscode.DiagnosticSeverity.Information;
    case 'hint':
      return vscode.DiagnosticSeverity.Hint;
    default:
      return vscode.DiagnosticSeverity.Error;
  }
}

/**
 * Publica un conjunto de diagnósticos y devuelve el número publicado.
 *
 * Los diagnósticos sin fichero se descartan: no hay a qué línea anclarlos.
 */
export function publish(
  collection: vscode.DiagnosticCollection,
  diagnostics: vscode.Diagnostic[],
  files: Map<string, vscode.Diagnostic[]>,
): number {
  collection.clear();
  for (const [file, items] of files) {
    collection.set(vscode.Uri.file(file), items);
  }
  return diagnostics.length;
}

/**
 * Publica los diagnósticos de R# que llegan en el sobre JSON.
 *
 * Los ficheros se resuelven contra la raíz del proyecto, de modo que el
 * editor los abre sin problemas.
 */
export function publishRSharpDiagnostics(
  collection: vscode.DiagnosticCollection,
  diagnostics: RSharpDiagnostic[],
  root: string,
): number {
  const files = new Map<string, vscode.Diagnostic[]>();
  let count = 0;

  for (const diagnostic of diagnostics) {
    if (!diagnostic.file) {
      continue;
    }
    const absolute = path.isAbsolute(diagnostic.file)
      ? diagnostic.file
      : path.resolve(root, diagnostic.file);
    const item = toVscodeDiagnostic(diagnostic);
    const bucket = files.get(absolute);
    if (bucket) {
      bucket.push(item);
    } else {
      files.set(absolute, [item]);
    }
    count += 1;
  }

  return publish(collection, Array.from(files.values()).flat(), files);
}

/**
 * Publica los errores de `rustc` traducidos a la línea del `.rsh`.
 *
 * Es la parte que hace que R# se sienta como TypeScript: el error aparece en
 * el fichero que el usuario ha escrito, con el código de rustc (`E0308`) y su
 * ayuda, pero sin el fragmento de Rust.
 */
export function publishRustDiagnostics(
  collection: vscode.DiagnosticCollection,
  rustDiagnostics: RustDiagnostic[],
  maps: RSharpSourceMap[],
  root: string,
): number {
  const files = new Map<string, vscode.Diagnostic[]>();
  let count = 0;

  for (const rustDiagnostic of rustDiagnostics) {
    const clean = mapRustDiagnostic(rustDiagnostic, maps);
    const location = clean.location;
    if (!location) {
      // Sin source map no se puede anclar al `.rsh`: se queda en el panel de
      // salida en lugar de inventar una posición.
      continue;
    }
    const absolute = path.isAbsolute(location.file)
      ? location.file
      : path.resolve(root, location.file);
    const item = cleanToVscodeDiagnostic(clean);
    const bucket = files.get(absolute);
    if (bucket) {
      bucket.push(item);
    } else {
      files.set(absolute, [item]);
    }
    count += 1;
  }

  return publish(collection, Array.from(files.values()).flat(), files);
}

/** Publica diagnósticos limpios ya calculados (p.ej. pánicos en runtime). */
export function publishCleanDiagnostics(
  collection: vscode.DiagnosticCollection,
  diagnostics: CleanDiagnostic[],
  root: string,
): number {
  const files = new Map<string, vscode.Diagnostic[]>();
  let count = 0;

  for (const diagnostic of diagnostics) {
    const location = diagnostic.location;
    if (!location) {
      continue;
    }
    const absolute = path.isAbsolute(location.file)
      ? location.file
      : path.resolve(root, location.file);
    const item = cleanToVscodeDiagnostic(diagnostic);
    const bucket = files.get(absolute);
    if (bucket) {
      bucket.push(item);
    } else {
      files.set(absolute, [item]);
    }
    count += 1;
  }

  return publish(collection, Array.from(files.values()).flat(), files);
}

/** Formatea un diagnóstico limpio para el panel de salida. */
export { formatCleanDiagnostic };
