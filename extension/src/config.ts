/**
 * Resolución de la configuración de un proyecto R#.
 *
 * Combina el archivo `rsharp.toml` con los ajustes de VSCode respetando la
 * prioridad de la spec §9 y §14.4:
 * - `rsharp.toml` tiene prioridad sobre los ajustes de VSCode;
 * - el ajuste de VSCode solo se usa si el toml no define el valor;
 * - si no hay ninguno de los dos, se usan los valores por defecto.
 *
 * Este módulo no importa `vscode`: es testeable en Node puro.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseToml, type TomlTable, type TomlValue } from './toml';
import {
  RSPHARP_PROFILES,
  RSPHARP_TARGETS,
  type AiConfig,
  type ForeignBindingConfig,
  type RSharpProfile,
  type RSharpTarget,
  type RSharpToml,
  type SugarConfig,
} from './types';

/** Ajustes de VSCode equivalentes a la sección `configuration` del paquete. */
export interface VSCodeLikeSettings {
  outputDir?: string | null;
  distDir?: string | null;
  target?: string;
  profile?: string;
}

/** Configuración final de un proyecto, con rutas absolutas. */
export interface ResolvedConfig {
  /** Raíz del proyecto (absoluta). */
  projectRoot: string;
  /** Contenido de `rsharp.toml` si se pudo leer y validar; `null` si no. */
  toml: RSharpToml | null;
  /** Carpeta donde se genera el Rust (absoluta). */
  outputDir: string;
  /** Carpeta donde se compila el binario (absoluta). */
  distDir: string;
  /** Destino de compilación. */
  target: RSharpTarget;
  /** Perfil de compilación. */
  profile: RSharpProfile;
  /**
   * Origen de los valores resueltos, con la precedencia
   * `toml` > `vscode` > `default`: si el toml aportó algún valor, `source` es
   * `'toml'`; si no, pero los ajustes de VSCode aportaron alguno, `'vscode'`;
   * y `'default'` si todo salió de los valores por defecto.
   */
  source: 'toml' | 'vscode' | 'default';
  /** Avisos no fatales (configuración inválida, rutas iguales, etc.). */
  warnings: string[];
}

/** Nombre del archivo de configuración del proyecto. */
const TOML_FILE_NAME = 'rsharp.toml';

/** Carpeta de salida por defecto, relativa a la raíz del proyecto. */
const DEFAULT_OUTPUT_RELATIVE = path.join('target', 'rsharp');

/** Carpeta de distribución por defecto, relativa a la raíz del proyecto. */
const DEFAULT_DIST_RELATIVE = 'dist';

/** Valores por defecto de la sección `[sugar]`. */
const DEFAULT_SUGAR: SugarConfig = {
  strings: 'utf8',
  overflow: 'panic',
  reentrancy: 'panic',
  finalizers: 'deterministic',
  cycles: 'weak-attribute',
};

/** Valores por defecto de la sección `[sugar.ai]`. */
const DEFAULT_AI: AiConfig = {
  enabled: false,
  provider: 'none',
  endpoint: '',
  model: '',
  lock: 'rsharp.lock',
  maxTokensPerBlock: 4000,
};

/** Tipos de binding admitidos en `[foreign.*]`. */
const FOREIGN_KINDS: readonly ForeignBindingConfig['kind'][] = [
  'native',
  'c-header',
  'dotnet',
  'python',
  'java',
];

/** Modos de enlazado admitidos en `[foreign.*].link`. */
const FOREIGN_LINKS: readonly NonNullable<ForeignBindingConfig['link']>[] = [
  'static',
  'dynamic',
  'auto',
];

/** Proveedores de IA admitidos en `[sugar.ai].provider`. */
const AI_PROVIDERS: readonly AiConfig['provider'][] = ['ollama', 'openai-compatible', 'none'];

/** Datos auxiliares que no caben en `RSharpToml` (qué valores eran explícitos). */
interface TomlFacts {
  /** `[paths].output` estaba presente en el archivo. */
  hasOutput: boolean;
  /** `[paths].dist` estaba presente en el archivo. */
  hasDist: boolean;
  /** `[build].target` estaba presente y era válido. */
  hasTarget: boolean;
  /** `[build].profile` estaba presente y era válido. */
  hasProfile: boolean;
}

/** Resultado interno del análisis de un `rsharp.toml`. */
interface TomlAnalysis {
  toml: RSharpToml;
  facts: TomlFacts;
  warnings: string[];
}

/** Lanza un error de configuración con mensaje en español. */
function fail(message: string): never {
  throw new Error(message);
}

/** Indica si el valor es una tabla TOML. */
function isTable(value: TomlValue): value is TomlTable {
  return typeof value === 'object' && !Array.isArray(value);
}

/** Lee una clave de una tabla sin asumir que exista. */
function tableGet(table: TomlTable, key: string): TomlValue | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** Devuelve la tabla de `table[key]` o `undefined` si no existe o no es tabla. */
function optionalTable(
  table: TomlTable,
  key: string,
  context: string,
): TomlTable | undefined {
  const value = tableGet(table, key);
  if (value === undefined) return undefined;
  if (!isTable(value)) fail(`\`${context}\` debe ser una tabla`);
  return value;
}

/** Devuelve una cadena obligatoria o `undefined` si la clave no existe. */
function optionalString(
  table: TomlTable,
  key: string,
  context: string,
): string | undefined {
  const value = tableGet(table, key);
  if (value === undefined) return undefined;
  if (typeof value !== 'string') fail(`\`${context}\` debe ser una cadena`);
  return value;
}

/** Devuelve un booleano obligatorio o `undefined` si la clave no existe. */
function optionalBoolean(
  table: TomlTable,
  key: string,
  context: string,
): boolean | undefined {
  const value = tableGet(table, key);
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') fail(`\`${context}\` debe ser un booleano`);
  return value;
}

/** Devuelve un número obligatorio o `undefined` si la clave no existe. */
function optionalNumber(
  table: TomlTable,
  key: string,
  context: string,
): number | undefined {
  const value = tableGet(table, key);
  if (value === undefined) return undefined;
  if (typeof value !== 'number') fail(`\`${context}\` debe ser un número`);
  return value;
}

/**
 * Lee un valor de un conjunto cerrado de cadenas.
 * Un valor desconocido genera un aviso y se sustituye por el valor por defecto.
 */
function readEnum<T extends string>(
  value: TomlValue | undefined,
  context: string,
  allowed: readonly T[],
  fallback: T,
  warnings: string[],
): T {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') fail(`\`${context}\` debe ser una cadena`);
  if (!(allowed as readonly string[]).includes(value)) {
    warnings.push(
      `Valor desconocido "${value}" en \`${context}\`; se usa "${fallback}". Valores válidos: ${allowed.join(', ')}.`,
    );
    return fallback;
  }
  return value as T;
}

/** Normaliza una ruta: absoluta y sin barra final. */
function normalizePath(target: string): string {
  return path.resolve(target);
}

/** Compara dos rutas ya resueltas de forma tolerante al sistema de archivos. */
function samePath(a: string, b: string): boolean {
  const left = path.normalize(a);
  const right = path.normalize(b);
  if (process.platform === 'win32') {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

/** Traduce un error desconocido a un mensaje legible. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Analiza un `rsharp.toml` y devuelve la configuración tipada más los avisos.
 * Lanza si el archivo es sintácticamente inválido o tiene una estructura inválida.
 */
function analyzeRSharpToml(text: string, filePath: string): TomlAnalysis {
  const warnings: string[] = [];
  const absolutePath = path.resolve(filePath);
  const baseDir = path.dirname(absolutePath);

  const parsed = parseToml(text);
  if (!isTable(parsed)) fail('el archivo TOML debe contener una tabla raíz');
  const root = parsed;

  // --- schema -------------------------------------------------------------
  let schema = 1;
  const schemaValue = tableGet(root, 'schema');
  if (schemaValue !== undefined) {
    if (typeof schemaValue !== 'number') fail('`schema` debe ser un número');
    schema = schemaValue;
  }
  if (schema !== 1) {
    warnings.push(
      `El esquema de "${TOML_FILE_NAME}" es ${schema} y se esperaba 1; se continúa con el esquema actual.`,
    );
  }

  // --- project ------------------------------------------------------------
  const projectTable = optionalTable(root, 'project', 'project');
  let projectName = path.basename(baseDir) || 'proyecto';
  if (projectTable) {
    const name = optionalString(projectTable, 'name', 'project.name');
    if (name !== undefined) projectName = name;
  }

  // --- paths --------------------------------------------------------------
  const pathsTable = optionalTable(root, 'paths', 'paths');
  let output = DEFAULT_OUTPUT_RELATIVE;
  let dist = DEFAULT_DIST_RELATIVE;
  let hasOutput = false;
  let hasDist = false;
  if (pathsTable) {
    const outputValue = optionalString(pathsTable, 'output', 'paths.output');
    if (outputValue !== undefined) {
      output = outputValue;
      hasOutput = true;
    }
    const distValue = optionalString(pathsTable, 'dist', 'paths.dist');
    if (distValue !== undefined) {
      dist = distValue;
      hasDist = true;
    }
  }

  // --- build --------------------------------------------------------------
  const buildTable = optionalTable(root, 'build', 'build');
  let target: RSharpTarget = 'native';
  let hasTarget = false;
  let profile: RSharpProfile | undefined;
  let hasProfile = false;
  if (buildTable) {
    const targetValue = tableGet(buildTable, 'target');
    if (targetValue !== undefined) {
      if (typeof targetValue !== 'string') fail('`build.target` debe ser una cadena');
      const resolved = readEnum<RSharpTarget>(
        targetValue,
        'build.target',
        RSPHARP_TARGETS,
        'native',
        warnings,
      );
      target = resolved;
      hasTarget = resolved === targetValue;
    }
    const profileValue = tableGet(buildTable, 'profile');
    if (profileValue !== undefined) {
      if (typeof profileValue !== 'string') fail('`build.profile` debe ser una cadena');
      const resolved = readEnum<RSharpProfile>(
        profileValue,
        'build.profile',
        RSPHARP_PROFILES,
        'debug',
        warnings,
      );
      profile = resolved;
      hasProfile = resolved === profileValue;
    }
  }

  // --- sugar --------------------------------------------------------------
  const sugarTable = optionalTable(root, 'sugar', 'sugar');
  const sugar: SugarConfig = { ...DEFAULT_SUGAR };
  if (sugarTable) {
    sugar.strings = readEnum(
      tableGet(sugarTable, 'strings'),
      'sugar.strings',
      ['utf8', 'utf16'] as const,
      DEFAULT_SUGAR.strings,
      warnings,
    );
    sugar.overflow = readEnum(
      tableGet(sugarTable, 'overflow'),
      'sugar.overflow',
      ['panic', 'wrap', 'checked'] as const,
      DEFAULT_SUGAR.overflow,
      warnings,
    );
    sugar.reentrancy = readEnum(
      tableGet(sugarTable, 'reentrancy'),
      'sugar.reentrancy',
      ['panic', 'serialize'] as const,
      DEFAULT_SUGAR.reentrancy,
      warnings,
    );
    sugar.finalizers = readEnum(
      tableGet(sugarTable, 'finalizers'),
      'sugar.finalizers',
      ['deterministic', 'gc-like'] as const,
      DEFAULT_SUGAR.finalizers,
      warnings,
    );
    sugar.cycles = readEnum(
      tableGet(sugarTable, 'cycles'),
      'sugar.cycles',
      ['weak-attribute', 'leak'] as const,
      DEFAULT_SUGAR.cycles,
      warnings,
    );
  }

  // --- sugar.ai -----------------------------------------------------------
  const aiTable =
    (sugarTable ? optionalTable(sugarTable, 'ai', 'sugar.ai') : undefined) ??
    optionalTable(root, 'ai', 'ai');
  const ai: AiConfig = { ...DEFAULT_AI };
  if (aiTable) {
    const enabled = optionalBoolean(aiTable, 'enabled', 'sugar.ai.enabled');
    if (enabled !== undefined) ai.enabled = enabled;
    ai.provider = readEnum(
      tableGet(aiTable, 'provider'),
      'sugar.ai.provider',
      AI_PROVIDERS,
      DEFAULT_AI.provider,
      warnings,
    );
    const endpoint = optionalString(aiTable, 'endpoint', 'sugar.ai.endpoint');
    if (endpoint !== undefined) ai.endpoint = endpoint;
    const model = optionalString(aiTable, 'model', 'sugar.ai.model');
    if (model !== undefined) ai.model = model;
    const lock = optionalString(aiTable, 'lock', 'sugar.ai.lock');
    if (lock !== undefined) ai.lock = lock;
    const maxTokens =
      optionalNumber(aiTable, 'max_tokens_per_block', 'sugar.ai.max_tokens_per_block') ??
      optionalNumber(aiTable, 'maxTokensPerBlock', 'sugar.ai.maxTokensPerBlock');
    if (maxTokens !== undefined) ai.maxTokensPerBlock = maxTokens;
  }

  // --- plugins ------------------------------------------------------------
  const plugins: string[] = [];
  const pluginsValue = tableGet(root, 'plugins');
  if (pluginsValue !== undefined) {
    const list = Array.isArray(pluginsValue)
      ? pluginsValue
      : isTable(pluginsValue) && Array.isArray(tableGet(pluginsValue, 'list'))
        ? (tableGet(pluginsValue, 'list') as TomlValue[])
        : undefined;
    if (list === undefined) {
      // La spec muestra `[plugins]` como tabla vacía: se acepta sin avisos.
      const esTablaVacia =
        isTable(pluginsValue) && Object.keys(pluginsValue).length === 0;
      if (!esTablaVacia) {
        warnings.push('`plugins` debe ser una lista de cadenas; se usa una lista vacía.');
      }
    } else {
      for (const item of list) {
        if (typeof item === 'string') {
          plugins.push(item);
        } else {
          warnings.push('Se ignoró un elemento no textual de la lista `plugins`.');
        }
      }
    }
  }

  // --- dependencies -------------------------------------------------------
  const dependencies: Record<string, string | Record<string, unknown>> = {};
  const dependenciesTable = optionalTable(root, 'dependencies', 'dependencies');
  if (dependenciesTable) {
    for (const [name, value] of Object.entries(dependenciesTable)) {
      if (typeof value === 'string') {
        dependencies[name] = value;
      } else if (isTable(value)) {
        dependencies[name] = value;
      } else {
        warnings.push(
          `La dependencia "${name}" debe ser una cadena o una tabla en línea; se ignora.`,
        );
      }
    }
  }

  // --- foreign ------------------------------------------------------------
  const foreign: Record<string, ForeignBindingConfig> = {};
  const foreignTable = optionalTable(root, 'foreign', 'foreign');
  if (foreignTable) {
    for (const [name, value] of Object.entries(foreignTable)) {
      if (!isTable(value)) {
        warnings.push(`La sección "[foreign.${name}]" debe ser una tabla; se ignora.`);
        continue;
      }
      const kindValue = tableGet(value, 'kind');
      let kind: ForeignBindingConfig['kind'] = 'native';
      if (kindValue === undefined) {
        warnings.push(`Falta "kind" en "[foreign.${name}]"; se asume "native".`);
      } else if (typeof kindValue !== 'string') {
        fail(`\`foreign.${name}.kind\` debe ser una cadena`);
      } else {
        kind = readEnum<ForeignBindingConfig['kind']>(
          kindValue,
          `foreign.${name}.kind`,
          FOREIGN_KINDS,
          'native',
          warnings,
        );
      }

      const config: ForeignBindingConfig = { kind };
      const pathValue = optionalString(value, 'path', `foreign.${name}.path`);
      if (pathValue !== undefined) config.path = pathValue;
      const headerValue = optionalString(value, 'header', `foreign.${name}.header`);
      if (headerValue !== undefined) config.header = headerValue;
      const versionValue = optionalString(value, 'version', `foreign.${name}.version`);
      if (versionValue !== undefined) config.version = versionValue;
      const linkValue = tableGet(value, 'link');
      if (linkValue !== undefined) {
        if (typeof linkValue !== 'string') fail(`\`foreign.${name}.link\` debe ser una cadena`);
        config.link = readEnum<NonNullable<ForeignBindingConfig['link']>>(
          linkValue,
          `foreign.${name}.link`,
          FOREIGN_LINKS,
          'auto',
          warnings,
        );
      }
      foreign[name] = config;
    }
  }

  // --- profile.<nombre>.sugar ---------------------------------------------
  const profiles: Record<string, Partial<SugarConfig>> = {};
  const profileTable = optionalTable(root, 'profile', 'profile');
  if (profileTable) {
    for (const [name, value] of Object.entries(profileTable)) {
      if (!isTable(value)) {
        warnings.push(`La sección "[profile.${name}]" debe ser una tabla; se ignora.`);
        continue;
      }
      const sugarSection = tableGet(value, 'sugar');
      if (sugarSection === undefined) continue;
      if (!isTable(sugarSection)) {
        warnings.push(`La sección "[profile.${name}.sugar]" debe ser una tabla; se ignora.`);
        continue;
      }
      const overrides: Partial<SugarConfig> = {};
      const strings = tableGet(sugarSection, 'strings');
      if (strings !== undefined) {
        overrides.strings = readEnum(
          strings,
          `profile.${name}.sugar.strings`,
          ['utf8', 'utf16'] as const,
          DEFAULT_SUGAR.strings,
          warnings,
        );
      }
      const overflow = tableGet(sugarSection, 'overflow');
      if (overflow !== undefined) {
        overrides.overflow = readEnum(
          overflow,
          `profile.${name}.sugar.overflow`,
          ['panic', 'wrap', 'checked'] as const,
          DEFAULT_SUGAR.overflow,
          warnings,
        );
      }
      const reentrancy = tableGet(sugarSection, 'reentrancy');
      if (reentrancy !== undefined) {
        overrides.reentrancy = readEnum(
          reentrancy,
          `profile.${name}.sugar.reentrancy`,
          ['panic', 'serialize'] as const,
          DEFAULT_SUGAR.reentrancy,
          warnings,
        );
      }
      const finalizers = tableGet(sugarSection, 'finalizers');
      if (finalizers !== undefined) {
        overrides.finalizers = readEnum(
          finalizers,
          `profile.${name}.sugar.finalizers`,
          ['deterministic', 'gc-like'] as const,
          DEFAULT_SUGAR.finalizers,
          warnings,
        );
      }
      const cycles = tableGet(sugarSection, 'cycles');
      if (cycles !== undefined) {
        overrides.cycles = readEnum(
          cycles,
          `profile.${name}.sugar.cycles`,
          ['weak-attribute', 'leak'] as const,
          DEFAULT_SUGAR.cycles,
          warnings,
        );
      }
      profiles[name] = overrides;
    }
  }

  const build: { target: RSharpTarget; profile?: RSharpProfile } = { target };
  if (profile !== undefined) build.profile = profile;

  const toml: RSharpToml = {
    schema,
    project: { name: projectName },
    paths: { output, dist },
    build,
    sugar,
    ai,
    plugins,
    dependencies,
    foreign,
    profiles,
    filePath: absolutePath,
  };

  return {
    toml,
    facts: { hasOutput, hasDist, hasTarget, hasProfile },
    warnings,
  };
}

/**
 * Parsea un `rsharp.toml` y devuelve la configuración tipada.
 * Todos los campos ausentes se rellenan con valores por defecto sensatos.
 * @throws {Error} si el TOML es inválido o su estructura no es válida.
 */
export function parseRSharpToml(text: string, filePath: string): RSharpToml {
  return analyzeRSharpToml(text, filePath).toml;
}

/**
 * Resuelve la configuración completa de un proyecto.
 *
 * Nunca lanza: los problemas del `rsharp.toml` se devuelven en `warnings`.
 */
export function loadProjectConfig(
  projectRoot: string,
  vscodeSettings: VSCodeLikeSettings,
): ResolvedConfig {
  const root = path.resolve(projectRoot);
  const warnings: string[] = [];
  const sources: Array<'toml' | 'vscode' | 'default'> = [];

  const tomlPath = path.join(root, TOML_FILE_NAME);
  const tomlDir = path.dirname(tomlPath);

  let toml: RSharpToml | null = null;
  let facts: TomlFacts = { hasOutput: false, hasDist: false, hasTarget: false, hasProfile: false };

  let text: string | null = null;
  try {
    text = fs.readFileSync(tomlPath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      warnings.push(
        `No se encontró "${TOML_FILE_NAME}" en ${root}; se usan los valores por defecto.`,
      );
    } else {
      warnings.push(
        `No se pudo leer "${tomlPath}": ${describeError(error)}. Se usan los valores por defecto.`,
      );
    }
  }

  if (text !== null) {
    try {
      const analysis = analyzeRSharpToml(text, tomlPath);
      toml = analysis.toml;
      facts = analysis.facts;
      warnings.push(...analysis.warnings);
    } catch (error) {
      toml = null;
      warnings.push(
        `"${tomlPath}" no es válido: ${describeError(error)}. Se usan los valores por defecto.`,
      );
    }
  }

  // --- outputDir ----------------------------------------------------------
  let outputDir: string;
  if (toml !== null && facts.hasOutput) {
    outputDir = normalizePath(path.resolve(tomlDir, toml.paths.output));
    sources.push('toml');
  } else if (vscodeSettings.outputDir !== undefined && vscodeSettings.outputDir !== null) {
    const setting = vscodeSettings.outputDir.trim();
    if (setting.length > 0) {
      outputDir = normalizePath(path.resolve(root, setting));
      sources.push('vscode');
    } else {
      outputDir = normalizePath(path.resolve(root, DEFAULT_OUTPUT_RELATIVE));
      sources.push('default');
    }
  } else {
    outputDir = normalizePath(path.resolve(root, DEFAULT_OUTPUT_RELATIVE));
    sources.push('default');
  }

  // --- distDir ------------------------------------------------------------
  let distDir: string;
  if (toml !== null && facts.hasDist) {
    distDir = normalizePath(path.resolve(tomlDir, toml.paths.dist));
    sources.push('toml');
  } else if (vscodeSettings.distDir !== undefined && vscodeSettings.distDir !== null) {
    const setting = vscodeSettings.distDir.trim();
    if (setting.length > 0) {
      distDir = normalizePath(path.resolve(root, setting));
      sources.push('vscode');
    } else {
      distDir = normalizePath(path.resolve(root, DEFAULT_DIST_RELATIVE));
      sources.push('default');
    }
  } else {
    distDir = normalizePath(path.resolve(root, DEFAULT_DIST_RELATIVE));
    sources.push('default');
  }

  // --- target -------------------------------------------------------------
  let target: RSharpTarget = 'native';
  if (toml !== null && facts.hasTarget) {
    target = toml.build.target;
    sources.push('toml');
  } else if (vscodeSettings.target !== undefined && vscodeSettings.target.trim().length > 0) {
    const setting = vscodeSettings.target.trim();
    if ((RSPHARP_TARGETS as readonly string[]).includes(setting)) {
      target = setting as RSharpTarget;
      sources.push('vscode');
    } else {
      warnings.push(
        `El ajuste de VSCode "rsharp.target" tiene un valor desconocido ("${setting}"); se usa "native".`,
      );
      sources.push('default');
    }
  } else {
    sources.push('default');
  }

  // --- profile ------------------------------------------------------------
  let profile: RSharpProfile = 'debug';
  if (toml !== null && facts.hasProfile && toml.build.profile !== undefined) {
    profile = toml.build.profile;
    sources.push('toml');
  } else if (vscodeSettings.profile !== undefined && vscodeSettings.profile.trim().length > 0) {
    const setting = vscodeSettings.profile.trim();
    if ((RSPHARP_PROFILES as readonly string[]).includes(setting)) {
      profile = setting as RSharpProfile;
      sources.push('vscode');
    } else {
      warnings.push(
        `El ajuste de VSCode "rsharp.profile" tiene un valor desconocido ("${setting}"); se usa "debug".`,
      );
      sources.push('default');
    }
  } else {
    sources.push('default');
  }

  // --- comprobaciones finales --------------------------------------------
  if (samePath(outputDir, distDir)) {
    warnings.push(
      `La carpeta de salida y la de distribución son la misma ("${outputDir}"); la spec §14.4 lo prohíbe.`,
    );
  }

  const source: ResolvedConfig['source'] = sources.includes('toml')
    ? 'toml'
    : sources.includes('vscode')
      ? 'vscode'
      : 'default';

  return {
    projectRoot: root,
    toml,
    outputDir,
    distDir,
    target,
    profile,
    source,
    warnings,
  };
}
