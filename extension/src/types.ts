/**
 * R# (Rust#) — contratos compartidos de la extensión de VSCode.
 *
 * Este archivo es la ÚNICA fuente de verdad para las formas de datos que
 * comparten varios módulos. No importa nada de `vscode` para que pueda
 * usarse desde tests en Node puro.
 *
 * Ver rsharp-spec.md §14 (Integración con VSCode).
 */

// ---------------------------------------------------------------------------
// Targets y perfiles
// ---------------------------------------------------------------------------

/** Destinos soportados por el compilador R# (spec §9 `[build].target`). */
export type RSharpTarget = 'native' | 'wasm32-unknown-unknown' | 'wasm32-wasip1';

export const RSPHARP_TARGETS: readonly RSharpTarget[] = [
  'native',
  'wasm32-unknown-unknown',
  'wasm32-wasip1',
];

/** Perfiles de compilación (spec §9 `[profile.release.sugar]`). */
export type RSharpProfile = 'debug' | 'release';

export const RSPHARP_PROFILES: readonly RSharpProfile[] = ['debug', 'release'];

// ---------------------------------------------------------------------------
// Configuración del proyecto (`rsharp.toml`)
// ---------------------------------------------------------------------------

export type SugarOverflow = 'panic' | 'wrap' | 'checked';
export type SugarStrings = 'utf8' | 'utf16';
export type SugarReentrancy = 'panic' | 'serialize';
export type SugarFinalizers = 'deterministic' | 'gc-like';
export type SugarCycles = 'weak-attribute' | 'leak';

export interface SugarConfig {
  strings: SugarStrings;
  overflow: SugarOverflow;
  reentrancy: SugarReentrancy;
  finalizers: SugarFinalizers;
  cycles: SugarCycles;
}

export interface AiConfig {
  enabled: boolean;
  provider: 'ollama' | 'openai-compatible' | 'none';
  endpoint: string;
  model: string;
  lock: string;
  maxTokensPerBlock: number;
}

export interface ForeignBindingConfig {
  kind: 'native' | 'c-header' | 'dotnet' | 'python' | 'java';
  path?: string;
  header?: string;
  link?: 'static' | 'dynamic' | 'auto';
  version?: string;
}

export interface RSharpToml {
  schema: number;
  project: { name: string };
  paths: { output: string; dist: string };
  build: { target: RSharpTarget; profile?: RSharpProfile };
  sugar: SugarConfig;
  ai: AiConfig;
  plugins: string[];
  dependencies: Record<string, string | Record<string, unknown>>;
  foreign: Record<string, ForeignBindingConfig>;
  /** Rutas de la tabla `[profile.<name>.sugar]`, indexadas por perfil. */
  profiles: Record<string, Partial<SugarConfig>>;
  /** Ruta absoluta del archivo de configuración leído. */
  filePath: string;
}

// ---------------------------------------------------------------------------
// Contrato JSON de la CLI `rsharp`
// ---------------------------------------------------------------------------

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface RSharpDiagnostic {
  /** Código de diagnóstico de R#, p.ej. `R#0042`. */
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  /** Ruta del archivo R# (relativa al proyecto si es posible). */
  file?: string;
  /** Línea 1-based dentro del archivo R#. */
  line?: number;
  /** Columna 1-based dentro del archivo R#. */
  column?: number;
  /** Longitud del rango en caracteres (opcional). */
  length?: number;
  /** Texto de ayuda: qué hacer para resolverlo. */
  help?: string;
  /** Fuente del diagnóstico. */
  source?: string;
}

export interface RSharpSourceMapEntry {
  /** Línea 1-based en el archivo Rust generado. */
  rustLine: number;
  /** Línea 1-based en el archivo R# origen. */
  rshLine: number;
}

export interface RSharpSourceMap {
  /** Ruta del archivo Rust generado, relativa al directorio de salida. */
  rustFile: string;
  /** Ruta del archivo R# origen, relativa al proyecto. */
  rshFile: string;
  entries: RSharpSourceMapEntry[];
}

export interface RSharpGeneratedFile {
  /** Ruta relativa al directorio de salida. */
  path: string;
  language: 'rust' | 'toml' | 'other';
  /** Número de líneas del archivo generado (opcional). */
  lines?: number;
}

/** Envoltorio estándar de salida JSON de la CLI. */
export interface RSharpCliEnvelope {
  ok: boolean;
  command: string;
  /** Duración en milisegundos. */
  durationMs?: number;
  files?: RSharpGeneratedFile[];
  diagnostics?: RSharpDiagnostic[];
  sourceMaps?: RSharpSourceMap[];
  /** Mensaje corto para la barra de estado. */
  summary?: string;
  /** Binario final producido (build). */
  artifact?: string;
  /** Comando `cargo` ejecutado, para mostrarlo en el panel de salida. */
  cargo?: {
    command: string;
    exitCode: number;
    stdout?: string;
    stderr?: string;
  };
  error?: {
    message: string;
    kind:
      | 'not-found'
      | 'spawn-failed'
      | 'bad-json'
      | 'unsupported'
      | 'non-zero'
      | 'unknown';
  };
}

/** Códigos de diagnóstico definidos en la spec §17. */
export const RSPHARP_DIAGNOSTIC_CODES = {
  /** El código exige un sugar apagado. */
  SUGAR_REQUIRED: 'R#0042',
  /** API no soportada en el destino. */
  UNSUPPORTED_API: 'R#0101',
  /** Destino sin soporte de librerías dinámicas. */
  NO_DYNAMIC_LIBRARIES: 'R#0150',
} as const;

// ---------------------------------------------------------------------------
// Resultados de errores de `cargo` / `rustc`
// ---------------------------------------------------------------------------

export interface RustDiagnostic {
  /** Código de rustc, p.ej. `E0308`. */
  code?: string;
  severity: DiagnosticSeverity;
  message: string;
  /** Ruta del archivo Rust. */
  file?: string;
  line?: number;
  column?: number;
  /** Texto de ayuda de rustc. */
  help?: string;
  /** Bloque completo de texto tal cual lo emitió rustc. */
  raw: string;
}

// ---------------------------------------------------------------------------
// Estado de la extensión
// ---------------------------------------------------------------------------

export interface ToolchainStatus {
  /** `dotnet` localizable. */
  dotnet: ToolStatus;
  /** `cargo` localizable. */
  cargo: ToolStatus;
  /** CLI `rsharp` localizable. */
  rsharp: ToolStatus;
}

export interface ToolStatus {
  found: boolean;
  /** Ruta absoluta del ejecutable encontrado. */
  path?: string;
  /** Versión reportada, si se pudo leer. */
  version?: string;
  /** Mensaje corto con el motivo cuando `found` es false. */
  reason?: string;
}

/** Resultado de una operación de la CLI (éxito o fallo controlado). */
export interface CliResult {
  ok: boolean;
  envelope?: RSharpCliEnvelope;
  /** Salida en crudo cuando la CLI no devolvió JSON. */
  raw?: string;
  stderr?: string;
  exitCode: number;
  /** Error de ejecución (no se pudo lanzar el proceso). */
  failure?: {
    kind: 'not-found' | 'spawn-failed' | 'bad-json' | 'unsupported' | 'non-zero' | 'unknown';
    message: string;
  };
}
