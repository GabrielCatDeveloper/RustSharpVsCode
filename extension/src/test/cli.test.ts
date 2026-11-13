import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import { RSharpCli } from '../cli';
import type { ToolPaths } from '../toolchain';
import type { RSharpCliEnvelope } from '../types';

/** Doble de `Readable` (solo necesita `on` y opcionalmente `setEncoding`). */
class FakeStream extends EventEmitter {
  setEncoding(): void {
    // No-op: el doble entrega cadenas.
  }
}

/** Doble de `ChildProcess`. */
class FakeChild extends EventEmitter {
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();

  kill(signal?: NodeJS.Signals): boolean {
    this.emit('close', null, signal ?? 'SIGKILL');
    return true;
  }
}

/** Opciones del doble de `spawn`. */
interface FakeSpawnOptions {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: NodeJS.ErrnoException;
  /** Si es `true`, el proceso nunca se cierra (para probar el timeout). */
  neverCloses?: boolean;
}

/** Llamadas registradas por el doble de `spawn`. */
interface SpawnCall {
  command: string;
  args: string[];
}

/** Crea un `spawnFn` falso y un registro de llamadas. */
function createSpawn(options: FakeSpawnOptions = {}): {
  spawnFn: typeof import('child_process').spawn;
  calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  const spawnFn = ((command: string, args: readonly string[] = []) => {
    calls.push({ command, args: [...args] });
    const child = new FakeChild();
    setImmediate(() => {
      if (options.error) {
        child.emit('error', options.error);
        return;
      }
      if (options.stdout !== undefined) {
        child.stdout.emit('data', Buffer.from(options.stdout, 'utf8'));
      }
      if (options.stderr !== undefined) {
        child.stderr.emit('data', Buffer.from(options.stderr, 'utf8'));
      }
      if (!options.neverCloses) {
        child.emit('close', options.exitCode ?? 0, null);
      }
    });
    return child;
  }) as unknown as typeof import('child_process').spawn;
  return { spawnFn, calls };
}

/** Toolchain con la CLI disponible como ejecutable nativo. */
const TOOL_OK: ToolPaths = {
  rsharp: '/usr/bin/rsharp',
  dotnet: '/usr/bin/dotnet',
  cargo: '/usr/bin/cargo',
  rsharpIsDll: false,
};

/** Sobre JSON de ejemplo (misma forma que `RSharpCliEnvelope`). */
const ENVELOPE: RSharpCliEnvelope = {
  ok: true,
  command: 'transpile',
  durationMs: 12,
  files: [{ path: 'src/main.rs', language: 'rust', lines: 42 }],
  diagnostics: [],
  sourceMaps: [],
  summary: '1 archivo generado',
};

describe('RSharpCli.run', () => {
  it('ejecuta la CLI y devuelve el sobre JSON', async () => {
    const { spawnFn, calls } = createSpawn({ stdout: JSON.stringify(ENVELOPE) });
    const cli = new RSharpCli({ tool: TOOL_OK, cwd: '/p', spawnFn });

    const result = await cli.run(['transpile', '--project', '/p'], { json: true });

    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.failure, undefined);
    assert.deepEqual(result.envelope, ENVELOPE);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, '/usr/bin/rsharp');
    assert.deepEqual(calls[0].args, ['transpile', '--project', '/p', '--json']);
  });

  it('no añade --json cuando no se pide', async () => {
    const { spawnFn, calls } = createSpawn({ stdout: 'texto plano' });
    const cli = new RSharpCli({ tool: TOOL_OK, cwd: '/p', spawnFn });

    const result = await cli.run(['--version']);

    assert.equal(result.ok, true);
    assert.deepEqual(calls[0].args, ['--version']);
    assert.equal(result.raw, 'texto plano');
  });

  it('devuelve non-zero conservando el sobre cuando el proceso falla', async () => {
    const { spawnFn } = createSpawn({
      stdout: JSON.stringify({ ...ENVELOPE, ok: false }),
      stderr: 'error grave',
      exitCode: 3,
    });
    const cli = new RSharpCli({ tool: TOOL_OK, cwd: '/p', spawnFn });

    const result = await cli.run(['build', '--project', '/p'], { json: true });

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 3);
    assert.equal(result.failure?.kind, 'non-zero');
    assert.match(result.failure?.message ?? '', /3/);
    assert.equal(result.envelope?.ok, false);
  });

  it('devuelve bad-json sin reventar cuando la salida no es JSON', async () => {
    const { spawnFn } = createSpawn({ stdout: 'esto no es json' });
    const cli = new RSharpCli({ tool: TOOL_OK, cwd: '/p', spawnFn });

    const result = await cli.run(['transpile', '--project', '/p'], { json: true });

    assert.equal(result.ok, false);
    assert.equal(result.failure?.kind, 'bad-json');
    assert.equal(result.raw, 'esto no es json');
    assert.equal(result.envelope, undefined);
  });

  it('tolera líneas de log antes del JSON', async () => {
    const { spawnFn } = createSpawn({
      stdout: `aviso: compilando\n${JSON.stringify(ENVELOPE)}\n`,
    });
    const cli = new RSharpCli({ tool: TOOL_OK, cwd: '/p', spawnFn });

    const result = await cli.run(['transpile', '--project', '/p'], { json: true });

    assert.equal(result.ok, true);
    assert.deepEqual(result.envelope, ENVELOPE);
  });

  it('devuelve not-found cuando el binario no existe', async () => {
    const error: NodeJS.ErrnoException = new Error('spawn ENOENT');
    error.code = 'ENOENT';
    const { spawnFn } = createSpawn({ error });
    const cli = new RSharpCli({ tool: TOOL_OK, cwd: '/p', spawnFn });

    const result = await cli.run(['transpile', '--project', '/p'], { json: true });

    assert.equal(result.ok, false);
    assert.equal(result.failure?.kind, 'not-found');
  });

  it('devuelve spawn-failed cuando el proceso no se puede lanzar', async () => {
    const error: NodeJS.ErrnoException = new Error('permiso denegado');
    error.code = 'EACCES';
    const { spawnFn } = createSpawn({ error });
    const cli = new RSharpCli({ tool: TOOL_OK, cwd: '/p', spawnFn });

    const result = await cli.run(['transpile', '--project', '/p'], { json: true });

    assert.equal(result.ok, false);
    assert.equal(result.failure?.kind, 'spawn-failed');
  });

  it('no lanza el proceso si falta la CLI', async () => {
    const { spawnFn, calls } = createSpawn();
    const cli = new RSharpCli({ tool: { rsharpIsDll: false }, cwd: '/p', spawnFn });

    const result = await cli.run(['transpile', '--project', '/p'], { json: true });

    assert.equal(result.ok, false);
    assert.equal(result.failure?.kind, 'not-found');
    assert.match(result.failure?.message ?? '', /rsharp/);
    assert.equal(calls.length, 0);
  });

  it('no lanza el proceso si la CLI es una DLL y falta dotnet', async () => {
    const { spawnFn, calls } = createSpawn();
    const tool: ToolPaths = { rsharp: '/opt/rsharp/RSharp.Cli.dll', rsharpIsDll: true };
    const cli = new RSharpCli({ tool, cwd: '/p', spawnFn });

    const result = await cli.run(['transpile', '--project', '/p'], { json: true });

    assert.equal(result.ok, false);
    assert.equal(result.failure?.kind, 'not-found');
    assert.match(result.failure?.message ?? '', /dotnet/);
    assert.equal(calls.length, 0);
  });

  it('ejecuta la DLL con dotnet', async () => {
    const { spawnFn, calls } = createSpawn({ stdout: JSON.stringify(ENVELOPE) });
    const tool: ToolPaths = {
      rsharp: '/opt/rsharp/RSharp.Cli.dll',
      dotnet: '/usr/bin/dotnet',
      rsharpIsDll: true,
    };
    const cli = new RSharpCli({ tool, cwd: '/p', spawnFn });

    const result = await cli.run(['transpile', '--project', '/p'], { json: true });

    assert.equal(result.ok, true);
    assert.equal(calls[0].command, '/usr/bin/dotnet');
    assert.deepEqual(calls[0].args, [
      '/opt/rsharp/RSharp.Cli.dll',
      'transpile',
      '--project',
      '/p',
      '--json',
    ]);
  });

  it('propaga stdout y stderr al logger', async () => {
    const { spawnFn } = createSpawn({
      stdout: 'salida estandar',
      stderr: 'salida de error',
    });
    const logs: string[] = [];
    const cli = new RSharpCli({ tool: TOOL_OK, cwd: '/p', spawnFn, logger: (m) => logs.push(m) });

    await cli.run(['transpile', '--project', '/p']);

    assert.ok(logs.some((line) => line.includes('salida estandar')));
    assert.ok(logs.some((line) => line.includes('salida de error')));
  });

  it('mata el proceso y falla cuando se agota el tiempo de espera', async () => {
    const { spawnFn } = createSpawn({ neverCloses: true, stdout: 'trabajando...' });
    const cli = new RSharpCli({ tool: TOOL_OK, cwd: '/p', spawnFn, timeoutMs: 20 });

    const result = await cli.run(['build', '--project', '/p'], { json: true });

    assert.equal(result.ok, false);
    assert.equal(result.failure?.kind, 'non-zero');
    assert.match(result.failure?.message ?? '', /tiempo de espera/);
  });
});

describe('RSharpCli comandos', () => {
  it('transpile construye los argumentos esperados', async () => {
    const { spawnFn, calls } = createSpawn({ stdout: JSON.stringify(ENVELOPE) });
    const cli = new RSharpCli({ tool: TOOL_OK, cwd: '/p', spawnFn });

    await cli.transpile('/p', '/p/target/rsharp');

    assert.deepEqual(calls[0].args, [
      'transpile',
      '--project',
      '/p',
      '--output',
      '/p/target/rsharp',
      '--json',
    ]);
  });

  it('build construye los argumentos esperados', async () => {
    const { spawnFn, calls } = createSpawn({ stdout: JSON.stringify(ENVELOPE) });
    const cli = new RSharpCli({ tool: TOOL_OK, cwd: '/p', spawnFn });

    await cli.build('/p', {
      profile: 'release',
      target: 'wasm32-unknown-unknown',
      distDir: '/p/dist',
    });

    assert.deepEqual(calls[0].args, [
      'build',
      '--project',
      '/p',
      '--profile',
      'release',
      '--target',
      'wasm32-unknown-unknown',
      '--dist',
      '/p/dist',
      '--json',
    ]);
  });

  it('runProgram construye los argumentos esperados', async () => {
    const { spawnFn, calls } = createSpawn({ stdout: JSON.stringify(ENVELOPE) });
    const cli = new RSharpCli({ tool: TOOL_OK, cwd: '/p', spawnFn });

    await cli.runProgram('/p', { target: 'native', profile: 'debug' });

    assert.deepEqual(calls[0].args, [
      'run',
      '--project',
      '/p',
      '--target',
      'native',
      '--profile',
      'debug',
      '--json',
    ]);
  });

  it('clean construye los argumentos esperados', async () => {
    const { spawnFn, calls } = createSpawn({ stdout: JSON.stringify(ENVELOPE) });
    const cli = new RSharpCli({ tool: TOOL_OK, cwd: '/p', spawnFn });

    await cli.clean('/p', { outputDir: '/p/target/rsharp', distDir: '/p/dist' });

    assert.deepEqual(calls[0].args, [
      'clean',
      '--project',
      '/p',
      '--output',
      '/p/target/rsharp',
      '--dist',
      '/p/dist',
      '--json',
    ]);
  });
});

describe('RSharpCli.version', () => {
  it('devuelve el número de versión de la primera línea que lo tiene', async () => {
    const { spawnFn, calls } = createSpawn({ stdout: 'rsharp 0.1.0 (abc1234)\n' });
    const cli = new RSharpCli({ tool: TOOL_OK, cwd: '/p', spawnFn });

    const version = await cli.version();

    assert.equal(version, '0.1.0');
    assert.deepEqual(calls[0].args, ['--version']);
  });

  it('devuelve undefined si la salida no tiene número de versión', async () => {
    const { spawnFn } = createSpawn({ stdout: 'sin versión\n' });
    const cli = new RSharpCli({ tool: TOOL_OK, cwd: '/p', spawnFn });

    assert.equal(await cli.version(), undefined);
  });

  it('devuelve undefined si falta la CLI', async () => {
    const { spawnFn, calls } = createSpawn();
    const cli = new RSharpCli({ tool: { rsharpIsDll: false }, cwd: '/p', spawnFn });

    assert.equal(await cli.version(), undefined);
    assert.equal(calls.length, 0);
  });
});
