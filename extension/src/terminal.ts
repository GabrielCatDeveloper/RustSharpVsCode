/**
 * Terminal seudoterminal para ejecutar el programa generado.
 *
 * A diferencia de `vscode.Terminal.sendText`, un seudoterminal permite
 * capturar la salida del proceso. Eso es lo que permite traducir un pánico de
 * Rust a la línea del `.rsh` y mostrarlo como un error normal del archivo que
 * el usuario ha escrito.
 *
 * Es laequivalentede "ejecutar y ver errores" de TypeScript, pero sin que
 * aparezca el Rust generado.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import * as vscode from 'vscode';

/** Opciones para ejecutar un programa en un seudoterminal. */
export interface TerminalRunOptions {
  /** Ejecutable (normalmente el binario generado). */
  command: string;
  /** Argumentos del ejecutable. */
  args?: string[];
  /** Directorio de trabajo. */
  cwd: string;
  /** Variables de entorno adicionales. */
  env?: NodeJS.ProcessEnv;
  /** Recibe cada fragmento de salida. */
  onOutput?(text: string, stream: 'stdout' | 'stderr'): void;
  /** Se invoca cuando el proceso termina. */
  onExit?(code: number | null): void;
}

/**
 * Seudoterminal que ejecuta un proceso y reenvía su salida.
 */
export class RSharpPseudoterminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<number | void>();
  private child: ChildProcess | undefined;
  private closed = false;

  constructor(private readonly options: TerminalRunOptions) {}

  /** Flujo de escritura hacia la terminal. */
  readonly onDidWrite = this.writeEmitter.event;

  /** Flujo de cierre de la terminal. */
  readonly onDidClose = this.closeEmitter.event;

  /** `true` cuando el proceso se ha cerrado. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** Arranca el proceso. Lo llama VSCode al abrir la terminal. */
  open(): void {
    const { command, args = [], cwd, env } = this.options;

    try {
      this.child = spawn(command, args, {
        cwd,
        env: env ?? process.env,
        windowsHide: true,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.writeEmitter.fire(`R#: no se pudo ejecutar «${command}»: ${detail}\r\n`);
      this.closeEmitter.fire(1);
      return;
    }

    const child = this.child;
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', (chunk: string | Buffer) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      this.writeEmitter.fire(text);
      this.options.onOutput?.(text, 'stdout');
    });

    child.stderr?.on('data', (chunk: string | Buffer) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      this.writeEmitter.fire(text);
      this.options.onOutput?.(text, 'stderr');
    });

    child.on('error', (error: Error) => {
      this.writeEmitter.fire(`R#: ${error.message}\r\n`);
      this.closeEmitter.fire(1);
    });

    child.on('close', (code: number | null) => {
      this.closed = true;
      this.options.onExit?.(code);
      this.closeEmitter.fire(code ?? 0);
    });
  }

  /** Cierra la terminal y termina el proceso. */
  close(): void {
    this.closed = true;
    try {
      this.child?.kill();
    } catch {
      // El proceso ya terminó.
    }
  }

  /** Reenvía la entrada del usuario al proceso. */
  write(data: string): void {
    try {
      this.child?.stdin?.write(data);
    } catch {
      // El proceso ya terminó o no lee de stdin.
    }
  }

  /** Libera los emisores. */
  dispose(): void {
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }
}

/**
 * Ejecuta un programa en una terminal integrada y devuelve la terminal.
 *
 * La terminal se reutiliza si ya existe una con el mismo nombre y está
 * viva, de modo que varias ejecuciones consecutivas no acumulen pestañas.
 */
export function runInTerminal(options: TerminalRunOptions): vscode.Terminal {
  const name = 'R#';
  const pseudoterminal = new RSharpPseudoterminal(options);

  const terminal = vscode.window.createTerminal({ name, pty: pseudoterminal });
  terminal.show(true);
  return terminal;
}
