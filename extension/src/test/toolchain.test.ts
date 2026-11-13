import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import { buildRSharpCommand, describeMissingTools, resolveToolchain } from '../toolchain';

/** Crea un `exists` inyectable que solo acepta las rutas indicadas. */
function existsIn(...paths: string[]): (p: string) => boolean {
  const accepted = new Set(paths.map((p) => path.normalize(p)));
  return (candidate: string) => accepted.has(path.normalize(candidate));
}

/** Entorno con un PATH compuesto por las carpetas indicadas. */
function envWithPath(...dirs: string[]): NodeJS.ProcessEnv {
  return { PATH: dirs.join(path.delimiter) };
}

describe('resolveToolchain', () => {
  it('usa el cliPath configurado tal cual, sin comprobar si existe', () => {
    const tool = resolveToolchain({
      cliPath: '/opt/rsharp/bin/rsharp',
      autoDetect: true,
      env: envWithPath('/usr/bin'),
      exists: () => false,
    });
    assert.equal(tool.rsharp, '/opt/rsharp/bin/rsharp');
    assert.equal(tool.rsharpIsDll, false);
  });

  it('marca rsharpIsDll cuando la ruta termina en .dll', () => {
    const tool = resolveToolchain({
      cliPath: '/opt/rsharp/bin/RSharp.Cli.DLL',
      autoDetect: false,
    });
    assert.equal(tool.rsharpIsDll, true);
  });

  it('ignora las rutas configuradas vacías o nulas', () => {
    const tool = resolveToolchain({
      cliPath: '   ',
      dotnetPath: null,
      cargoPath: undefined,
      autoDetect: false,
    });
    assert.equal(tool.rsharp, undefined);
    assert.equal(tool.dotnet, undefined);
    assert.equal(tool.cargo, undefined);
    assert.equal(tool.rsharpIsDll, false);
  });

  it('no autodetecta nada con autoDetect: false', () => {
    const tool = resolveToolchain({
      autoDetect: false,
      env: envWithPath('/usr/bin'),
      exists: () => true,
    });
    assert.equal(tool.rsharp, undefined);
    assert.equal(tool.dotnet, undefined);
    assert.equal(tool.cargo, undefined);
  });

  it('busca rsharp, dotnet y cargo en el PATH', () => {
    const dir = path.join(path.sep, 'usr', 'local', 'bin');
    const other = path.join(path.sep, 'opt', 'bin');
    const tool = resolveToolchain({
      autoDetect: true,
      env: envWithPath(other, dir),
      exists: existsIn(
        path.join(dir, 'rsharp'),
        path.join(dir, 'dotnet'),
        path.join(dir, 'cargo'),
      ),
    });
    assert.equal(tool.rsharp, path.join(dir, 'rsharp'));
    assert.equal(tool.dotnet, path.join(dir, 'dotnet'));
    assert.equal(tool.cargo, path.join(dir, 'cargo'));
    assert.equal(tool.rsharpIsDll, false);
  });

  it('busca también las variantes .exe en el PATH', () => {
    const dir = path.join(path.sep, 'tools');
    const tool = resolveToolchain({
      autoDetect: true,
      env: envWithPath(dir),
      exists: existsIn(
        path.join(dir, 'rsharp.exe'),
        path.join(dir, 'dotnet.exe'),
        path.join(dir, 'cargo.exe'),
      ),
    });
    assert.equal(tool.rsharp, path.join(dir, 'rsharp.exe'));
    assert.equal(tool.dotnet, path.join(dir, 'dotnet.exe'));
    assert.equal(tool.cargo, path.join(dir, 'cargo.exe'));
  });

  it('da prioridad a las rutas configuradas sobre la autodetección', () => {
    const dir = path.join(path.sep, 'usr', 'bin');
    const tool = resolveToolchain({
      cliPath: '/custom/rsharp',
      dotnetPath: '/custom/dotnet',
      cargoPath: '/custom/cargo',
      autoDetect: true,
      env: envWithPath(dir),
      exists: existsIn(
        path.join(dir, 'rsharp'),
        path.join(dir, 'dotnet'),
        path.join(dir, 'cargo'),
      ),
    });
    assert.equal(tool.rsharp, '/custom/rsharp');
    assert.equal(tool.dotnet, '/custom/dotnet');
    assert.equal(tool.cargo, '/custom/cargo');
  });

  it('busca la CLI en ~/.dotnet/tools', () => {
    const home = path.join(path.sep, 'home', 'usuario');
    const tools = path.join(home, '.dotnet', 'tools');
    const tool = resolveToolchain({
      autoDetect: true,
      env: { HOME: home },
      exists: existsIn(path.join(tools, 'rsharp')),
    });
    assert.equal(tool.rsharp, path.join(tools, 'rsharp'));
  });

  it('busca la CLI en ./.rsharp/bin', () => {
    const local = path.resolve(process.cwd(), '.rsharp', 'bin', 'rsharp');
    const tool = resolveToolchain({
      autoDetect: true,
      env: envWithPath(),
      exists: existsIn(local),
    });
    assert.equal(tool.rsharp, local);
  });

  it('busca la CLI junto al binario de la extensión', () => {
    const beside = path.join(path.dirname(process.execPath), 'rsharp');
    const tool = resolveToolchain({
      autoDetect: true,
      env: envWithPath(),
      exists: existsIn(beside),
    });
    assert.equal(tool.rsharp, beside);
  });

  it('marca rsharpIsDll si la CLI encontrada es una DLL', () => {
    const home = path.join(path.sep, 'home', 'usuario');
    const tools = path.join(home, '.dotnet', 'tools');
    const tool = resolveToolchain({
      autoDetect: true,
      env: { HOME: home },
      exists: existsIn(path.join(tools, 'rsharp.dll')),
    });
    assert.equal(tool.rsharp, path.join(tools, 'rsharp.dll'));
    assert.equal(tool.rsharpIsDll, true);
  });
});

describe('buildRSharpCommand', () => {
  it('usa la CLI directamente cuando no es una DLL', () => {
    const built = buildRSharpCommand({ rsharp: '/usr/bin/rsharp', rsharpIsDll: false }, [
      'transpile',
      '--project',
      '/p',
    ]);
    assert.equal(built.command, '/usr/bin/rsharp');
    assert.deepEqual(built.args, ['transpile', '--project', '/p']);
  });

  it('usa dotnet con la DLL como primer argumento', () => {
    const built = buildRSharpCommand(
      { rsharp: '/opt/rsharp/RSharp.Cli.dll', dotnet: '/usr/bin/dotnet', rsharpIsDll: true },
      ['build', '--project', '/p'],
    );
    assert.equal(built.command, '/usr/bin/dotnet');
    assert.deepEqual(built.args, ['/opt/rsharp/RSharp.Cli.dll', 'build', '--project', '/p']);
  });

  it('usa "dotnet" por defecto cuando la CLI es una DLL y no hay dotnet', () => {
    const built = buildRSharpCommand(
      { rsharp: '/opt/rsharp/RSharp.Cli.dll', rsharpIsDll: true },
      ['--version'],
    );
    assert.equal(built.command, 'dotnet');
    assert.deepEqual(built.args, ['/opt/rsharp/RSharp.Cli.dll', '--version']);
  });

  it('no modifica los argumentos recibidos', () => {
    const args = ['clean'];
    buildRSharpCommand({ rsharp: '/usr/bin/rsharp', rsharpIsDll: false }, args);
    assert.deepEqual(args, ['clean']);
  });
});

describe('describeMissingTools', () => {
  it('avisa cuando falta la CLI', () => {
    const missing = describeMissingTools({ rsharpIsDll: false });
    assert.ok(
      missing.some((m) => m.includes('CLI de R#') && m.includes('rsharp.cliPath')),
      `mensajes: ${missing.join(' | ')}`,
    );
  });

  it('avisa cuando la CLI es una DLL y falta dotnet', () => {
    const missing = describeMissingTools({ rsharp: '/opt/rsharp.dll', rsharpIsDll: true });
    assert.ok(
      missing.some((m) => m.includes('.NET SDK') && m.includes('dotnet')),
      `mensajes: ${missing.join(' | ')}`,
    );
  });

  it('avisa cuando falta cargo', () => {
    const missing = describeMissingTools({ rsharp: '/usr/bin/rsharp', rsharpIsDll: false });
    assert.ok(
      missing.some((m) => m.includes('cargo')),
      `mensajes: ${missing.join(' | ')}`,
    );
  });

  it('no avisa de nada cuando todo está presente', () => {
    const missing = describeMissingTools({
      rsharp: '/usr/bin/rsharp',
      dotnet: '/usr/bin/dotnet',
      cargo: '/usr/bin/cargo',
      rsharpIsDll: false,
    });
    assert.deepEqual(missing, []);
  });
});
