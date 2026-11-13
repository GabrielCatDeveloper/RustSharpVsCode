/**
 * Cliente de la CLI `rsharp` (compilador R#).
 *
 * ## Contrato de la CLI que espera la extensión
 *
 * ```text
 * rsharp transpile --project <dir> [--output <dir>] [--json]
 * rsharp build     --project <dir> [--profile debug|release] [--target <t>] [--dist <dir>] [--json]
 * rsharp run       --project <dir> [--target <t>] [--profile <p>] [--json]
 * rsharp clean     --project <dir> [--output <dir>] [--dist <dir>] [--json]
 * rsharp --version
 * ```
 *
 * - Con `--json` la CLI imprime **un único** objeto JSON con la forma
 *   `RSharpCliEnvelope` de `src/types.ts`.
 * - Sin `--json` la salida es texto libre: la extensión funciona en modo
 *   degradado y muestra el texto literal en el panel de salida.
 *
 * ## Reglas de este cliente
 *
 * - Nunca se lanzan excepciones hacia fuera: los fallos van en
 *   `CliResult.failure` con `kind` = `not-found` | `spawn-failed` | `bad-json` |
 *   `unsupported` | `non-zero` | `unknown`.
 * - Se usa `child_process.spawn` capturando stdout y stderr **completos** y se
 *   espera al cierre del proceso.
 * - Timeout por defecto de 10 minutos (600000 ms): compilar Rust es lento. Al
 *   expirar se mata el proceso y se devuelve un fallo `non-zero`.
 * - `logger` recibe los trozos de stdout/stderr para el panel de salida.
 *
 * Este módulo no importa `vscode`: se puede probar en Node puro.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { CliResult, RSharpCliEnvelope, RSharpProfile, RSharpTarget } from './types';
import { buildRSharpCommand, describeMissingTools, type ToolPaths } from './toolchain';

/** Timeout por defecto: 10 minutos. */
const DEFAULT_TIMEOUT_MS = 600_000;

/** Código de salida usado cuando el proceso ni siquiera llegó a arrancar. */
const EXIT_NOT_FOUND = 127;
/** Código de salida usado cuando el proceso se cerró sin código (p. ej. kill). */
const EXIT_NO_CODE = -1;

/** Opciones del cliente de la CLI. */
export interface CliRunnerOptions {
  /** Herramientas resueltas por `resolveToolchain`. */
  tool: ToolPaths;
  /** Directorio de trabajo del proceso (normalmente la raíz del proyecto). */
  cwd: string;
  /** Recibe la salida del proceso (stdout y stderr) para el panel de salida. */
  logger?: (message: string) => void;
  /** Timeout en milisegundos (por defecto 600000). */
  timeoutMs?: number;
  /** `child_process.spawn` inyectable para tests. */
  spawnFn?: typeof import('child_process').spawn;
}

/** Flujo compatible con `Readable` (el de los dobles de test puede ser mínimo). */
interface StreamLike {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
  setEncoding?(encoding: BufferEncoding): unknown;
}

/** Resultado interno de una ejecución: el `CliResult` más la salida cruda. */
interface ExecutionOutcome {
  result: CliResult;
  stdout: string;
  stderr: string;
}

/** Datos para construir el `CliResult` de una ejecución terminada. */
interface FinishedExecution {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  wantsJson: boolean;
}

/** Convierte un trozo de stream en texto. */
function chunkToText(chunk: unknown): string {
  if (typeof chunk === 'string') {
    return chunk;
  }
  if (Buffer.isBuffer(chunk)) {
    return chunk.toString('utf8');
  }
  return String(chunk);
}

/** Primer texto no vacío de una lista. */
function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

/** Busca un mensaje de `describeMissingTools` que contenga el texto dado. */
function pickMissing(messages: readonly string[], needle: string): string | undefined {
  return messages.find((message) => message.includes(needle));
}

/** `true` si el valor parece un `RSharpCliEnvelope` (debe tener `ok` booleano). */
function isEnvelope(value: unknown): value is RSharpCliEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return typeof (value as Record<string, unknown>).ok === 'boolean';
}

/**
 * Intenta extraer el sobre JSON de la salida.
 *
 * Se tolera que la CLI escriba líneas de log antes del JSON: si el texto
 * completo no es JSON válido se reintenta con el trozo del primer `{` al
 * último `}`.
 */
function parseEnvelope(text: string): { envelope?: RSharpCliEnvelope; error?: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { error: 'la salida está vacía' };
  }
  const attempts: string[] = [trimmed];
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const slice = trimmed.slice(first, last + 1);
    if (slice !== trimmed) {
      attempts.push(slice);
    }
  }
  let lastError = 'la salida no es JSON válido';
  for (const attempt of attempts) {
    let value: unknown;
    try {
      value = JSON.parse(attempt);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      continue;
    }
    if (isEnvelope(value)) {
      return { envelope: value };
    }
    lastError = 'el JSON no tiene la forma de un sobre RSharpCliEnvelope (falta "ok")';
  }
  return { error: lastError };
}

/** Extrae el número de versión de la primera línea que lo contiene. */
function extractVersion(text: string): string | undefined {
  const pattern = /(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.]+)?)/;
  for (const line of text.split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

/**
 * Cliente de la CLI `rsharp`.
 *
 * Todas las operaciones devuelven un `CliResult`: nunca lanzan excepciones.
 */
export class RSharpCli {
  private readonly tool: ToolPaths;
  private readonly cwd: string;
  private readonly logger?: (message: string) => void;
  private readonly timeoutMs: number;
  private readonly spawnFn: typeof import('child_process').spawn;

  constructor(options: CliRunnerOptions) {
    this.tool = options.tool;
    this.cwd = options.cwd;
    this.logger = options.logger;
    this.timeoutMs =
      typeof options.timeoutMs === 'number' && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_TIMEOUT_MS;
    this.spawnFn = options.spawnFn ?? spawn;
  }

  /**
   * Ejecuta la CLI con los argumentos dados.
   *
   * Con `opts.json` se añade `--json` a la línea de órdenes y se espera que la
   * salida sea un sobre `RSharpCliEnvelope`.
   */
  async run(args: string[], opts?: { json?: boolean }): Promise<CliResult> {
    const wantsJson = opts?.json === true;
    const finalArgs = wantsJson ? [...args, '--json'] : [...args];

    const preflight = this.preflight();
    if (preflight) {
      return preflight;
    }

    const { command, args: commandArgs } = buildRSharpCommand(this.tool, finalArgs);
    const outcome = await this.execute(command, commandArgs, wantsJson);
    return outcome.result;
  }

  /** `rsharp transpile --project <dir> [--output <dir>] [--json]` */
  async transpile(projectRoot: string, outputDir?: string): Promise<CliResult> {
    const args = ['transpile', '--project', projectRoot];
    if (outputDir) {
      args.push('--output', outputDir);
    }
    return this.run(args, { json: true });
  }

  /** `rsharp build --project <dir> [--profile p] [--target t] [--dist dir] [--json]` */
  async build(
    projectRoot: string,
    opts?: { profile?: RSharpProfile; target?: RSharpTarget; distDir?: string },
  ): Promise<CliResult> {
    const args = ['build', '--project', projectRoot];
    if (opts?.profile) {
      args.push('--profile', opts.profile);
    }
    if (opts?.target) {
      args.push('--target', opts.target);
    }
    if (opts?.distDir) {
      args.push('--dist', opts.distDir);
    }
    return this.run(args, { json: true });
  }

  /** `rsharp run --project <dir> [--target t] [--profile p] [--json]` */
  async runProgram(
    projectRoot: string,
    opts?: { target?: RSharpTarget; profile?: RSharpProfile },
  ): Promise<CliResult> {
    const args = ['run', '--project', projectRoot];
    if (opts?.target) {
      args.push('--target', opts.target);
    }
    if (opts?.profile) {
      args.push('--profile', opts.profile);
    }
    return this.run(args, { json: true });
  }

  /** `rsharp clean --project <dir> [--output dir] [--dist dir] [--json]` */
  async clean(
    projectRoot: string,
    opts?: { outputDir?: string; distDir?: string },
  ): Promise<CliResult> {
    const args = ['clean', '--project', projectRoot];
    if (opts?.outputDir) {
      args.push('--output', opts.outputDir);
    }
    if (opts?.distDir) {
      args.push('--dist', opts.distDir);
    }
    return this.run(args, { json: true });
  }

  /**
   * Ejecuta `rsharp --version` y devuelve el número de versión (p. ej. `0.1.0`)
   * de la primera línea que lo contiene. Si no hay ninguna, `undefined`.
   */
  async version(): Promise<string | undefined> {
    const preflight = this.preflight();
    if (preflight) {
      return undefined;
    }
    const { command, args } = buildRSharpCommand(this.tool, ['--version']);
    const outcome = await this.execute(command, args, false);
    return extractVersion(outcome.stdout) ?? extractVersion(outcome.stderr);
  }

  /**
   * Comprueba que hay herramientas suficientes para invocar la CLI.
   * Devuelve un `CliResult` de fallo si la CLI (o `dotnet` para una DLL) no está.
   */
  private preflight(): CliResult | undefined {
    const missing = describeMissingTools(this.tool);
    if (!this.tool.rsharp) {
      const message =
        pickMissing(missing, 'CLI de R#') ?? 'Falta la CLI de R# (rsharp). Instala RSharp.Cli.';
      return {
        ok: false,
        exitCode: EXIT_NOT_FOUND,
        failure: { kind: 'not-found', message },
      };
    }
    if (this.tool.rsharpIsDll && !this.tool.dotnet) {
      const message =
        pickMissing(missing, '.NET SDK') ??
        'Falta .NET SDK (dotnet), necesario para ejecutar la CLI de R#.';
      return {
        ok: false,
        exitCode: EXIT_NOT_FOUND,
        failure: { kind: 'not-found', message },
      };
    }
    return undefined;
  }

  /** Lanza el proceso y espera a que se cierre. */
  private execute(
    command: string,
    args: string[],
    wantsJson: boolean,
  ): Promise<ExecutionOutcome> {
    return new Promise<ExecutionOutcome>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      let child: ChildProcess;
      try {
        child = this.spawnFn(command, args, {
          cwd: this.cwd,
          env: process.env,
          windowsHide: true,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        resolve({
          result: {
            ok: false,
            exitCode: EXIT_NOT_FOUND,
            failure: {
              kind: 'spawn-failed',
              message: `No se pudo lanzar «${command}»: ${detail}`,
            },
          },
          stdout,
          stderr,
        });
        return;
      }

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGKILL');
        } catch {
          // El proceso ya había terminado: no hay nada que hacer.
        }
      }, this.timeoutMs);

      const settle = (outcome: ExecutionOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      };

      const stdoutStream = child.stdout as unknown as StreamLike | null;
      if (stdoutStream) {
        stdoutStream.setEncoding?.('utf8');
        stdoutStream.on('data', (chunk: unknown) => {
          const text = chunkToText(chunk);
          stdout += text;
          this.log(text);
        });
      }

      const stderrStream = child.stderr as unknown as StreamLike | null;
      if (stderrStream) {
        stderrStream.setEncoding?.('utf8');
        stderrStream.on('data', (chunk: unknown) => {
          const text = chunkToText(chunk);
          stderr += text;
          this.log(text);
        });
      }

      child.on('error', (error: Error) => {
        const code = (error as NodeJS.ErrnoException).code;
        const notFound = code === 'ENOENT';
        const detail = error instanceof Error ? error.message : String(error);
        settle({
          result: {
            ok: false,
            exitCode: EXIT_NOT_FOUND,
            stderr,
            failure: {
              kind: notFound ? 'not-found' : 'spawn-failed',
              message: notFound
                ? `No se encontró «${command}». Revisa ` +
                  '`rsharp.cliPath` o instala RSharp.Cli.'
                : `No se pudo ejecutar «${command}»: ${detail}`,
            },
          },
          stdout,
          stderr,
        });
      });

      child.on('close', (code: number | null) => {
        const exitCode = typeof code === 'number' ? code : EXIT_NO_CODE;
        settle(
          this.buildResult({
            command,
            exitCode,
            stdout,
            stderr,
            timedOut,
            wantsJson,
          }),
        );
      });
    });
  }

  /** Traduce la salida del proceso a un `CliResult`. */
  private buildResult(input: FinishedExecution): ExecutionOutcome {
    const parsed = parseEnvelope(input.stdout);
    const envelope = parsed.envelope;
    let failure: CliResult['failure'];

    if (input.timedOut) {
      failure = {
        kind: 'non-zero',
        message:
          `La CLI de R# superó el tiempo de espera de ${this.timeoutMs} ms ` +
          'y fue terminada.',
      };
    } else if (input.exitCode !== 0) {
      const detail = envelope?.error?.message ?? firstNonEmpty(input.stderr, input.stdout);
      failure = {
        kind: 'non-zero',
        message: detail
          ? `La CLI de R# terminó con código ${input.exitCode}: ${detail}`
          : `La CLI de R# terminó con código ${input.exitCode}.`,
      };
    } else if (input.wantsJson && !envelope) {
      failure = {
        kind: 'bad-json',
        message: `La salida de la CLI de R# no es JSON válido: ${parsed.error}`,
      };
    } else if (envelope?.error) {
      failure = { kind: envelope.error.kind, message: envelope.error.message };
    } else if (envelope && envelope.ok === false) {
      failure = {
        kind: 'unknown',
        message: envelope.summary ?? 'La CLI de R# devolvió un resultado no exitoso.',
      };
    }

    const result: CliResult = {
      ok: failure === undefined,
      exitCode: input.exitCode,
      stderr: input.stderr,
    };
    if (envelope) {
      result.envelope = envelope;
    } else {
      result.raw = input.stdout;
    }
    if (failure) {
      result.failure = failure;
    }
    return { result, stdout: input.stdout, stderr: input.stderr };
  }

  /** Escribe en el panel de salida sin dejar que un logger roto rompa la ejecución. */
  private log(message: string): void {
    if (!this.logger) {
      return;
    }
    try {
      this.logger(message);
    } catch {
      // El panel de salida no debe romper la compilación.
    }
  }
}
