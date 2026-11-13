---
name: rsharp-vscode-extension
description: Úsala cuando el usuario pida trabajar en la extensión de VSCode de R# (carpeta extension/): añadir o corregir comandos, resolver rutas outputDir/distDir, dar prioridad a rsharp.toml sobre los ajustes, traducir errores de rustc a líneas .rsh con source maps, tocar la gramática TextMate o los snippets, el panel de salida, la barra de estado, la vista lateral o los tests de la extensión.
---

# Extensión de VSCode de R# (`extension/`)

## Cuándo usar esta skill

- Hay que tocar **cualquier** módulo de `extension/src/`.
- Hay que añadir o corregir un **comando**, un ajuste o un mensaje de UI.
- Hay que resolver la **precedencia** entre `rsharp.toml` y los ajustes de
  VSCode, o las rutas `outputDir`/`distDir`.
- Hay que **traducir errores de `rustc`** a líneas del `.rsh`.
- Hay que tocar la **gramática** o los **snippets** de `.rsh`.

## Contexto del proyecto

- **Spec:** §14 (integración con VSCode: §14.1 piezas, §14.2 comandos, §14.3
  interfaz, §14.4 rutas de salida, §14.5 depuración), §17 (diagnostics).
- **Contratos:** `extension/src/types.ts` es la **única** fuente de verdad de
  las formas compartidas (`RSharpToml`, `RSharpDiagnostic`, `RSharpSourceMap`,
  `RSharpCliEnvelope`, `RustDiagnostic`, `ToolPaths`, `CliResult`, `RSharpTarget`).
- **Módulos y su regla de imports:**

| Módulo | Importa `vscode` | Nota |
|---|---|---|
| `src/types.ts` | no | Contratos puros |
| `src/toml.ts` | no | Parser propio, sin dependencias |
| `src/config.ts` | no | Precedencia `toml` > `vscode` > `default` |
| `src/toolchain.ts` | no | `exists` y `env` inyectables |
| `src/cli.ts` | no | `spawnFn` inyectable |
| `src/sourcemap.ts` | no | Lógica pura |
| `src/rustc-parser.ts` | no | Lógica pura |
| `src/diagnostics.ts` | no | Conversión a rango 0-based |
| `src/commands.ts` | **sí** | Orquesta la CLI |
| `src/statusbar.ts` | **sí** | Barra de estado y `QuickPick` |
| `src/treeview.ts` | **sí** | Vista lateral "R# Project" |
| `src/extension.ts` | **sí** | Activación (pendiente, `T-VSCD-014`) |

- **Comandos (§14.2), identificadores exactos:** `rsharp.transpile`,
  `rsharp.build`, `rsharp.buildRelease`, `rsharp.buildWasm`, `rsharp.run`,
  `rsharp.clean`, `rsharp.chooseOutputFolder`, `rsharp.chooseDistFolder`.
- **Contrato de la CLI:** `rsharp transpile|build|run|clean --project <dir>
  [--output|--dist|--profile|--target] [--json]`; con `--json` devuelve **un
  único** objeto `RSharpCliEnvelope`.

## Procedimiento

### Paso 1 · Localiza el contrato y no lo inventes

1. Lee `extension/src/types.ts` antes de escribir nada.
2. Si el tipo que necesitas **ya existe**, úsalo.
3. Si falta, **añádelo en `src/types.ts`** (no en el módulo que lo necesita) y
   anótalo en el resumen.
4. No dupliques formas: dos definiciones de `RSharpDiagnostic` rompen el
   contrato.

### Paso 2 · Configuración: `rsharp.toml` gana

```ts
// src/config.ts — precedencia: toml > vscode > default
export interface ResolvedConfig {
  projectRoot: string;
  toml: RSharpToml | null;
  outputDir: string;   // absoluta
  distDir: string;     // absoluta
  target: RSharpTarget;
  profile: RSharpProfile;
  source: 'toml' | 'vscode' | 'default';
  warnings: string[];
}
```

- `rsharp.toml` **tiene prioridad** sobre los ajustes de VSCode (§14.4).
- El ajuste de VSCode solo se usa si el `toml` no define `[paths]`.
- Por defecto: `target/rsharp` (salida) y `dist` (distribución) (§3).
- `outputDir` y `distDir` **no** pueden ser la misma carpeta (§14.4): es un
  aviso, no un fallo silencioso.
- Un `rsharp.toml` inválido **no** lanza: el error va a `warnings` y se sigue con
  los valores por defecto.
- `schema` distinto de `1` → aviso, no error.

### Paso 3 · Comandos: una acción, un resultado visible

```ts
export const RSPHARP_COMMANDS = {
  transpile: 'rsharp.transpile',
  build: 'rsharp.build',
  buildRelease: 'rsharp.buildRelease',
  buildWasm: 'rsharp.buildWasm',
  run: 'rsharp.run',
  clean: 'rsharp.clean',
  chooseOutputFolder: 'rsharp.chooseOutputFolder',
  chooseDistFolder: 'rsharp.chooseDistFolder',
} as const;
```

- `build` transpila y compila en `distDir`; `buildRelease` usa `--profile release`;
  `buildWasm` usa `--target wasm32-unknown-unknown`.
- `run` compila y ejecuta; **WASM no se ejecuta**: mensaje explicativo de que
  hace falta un servidor.
- `clean` **pide confirmación** antes de borrar.
- Elegir carpeta fuera del workspace **pide confirmación** (§14.4).
- Antes de `Build` se comprueba que exista `rustc`/`cargo` (§14.4).
- El progreso va al panel de salida `R#`; el error se muestra con el mensaje
  real y el detalle técnico se queda en el panel.

### Paso 4 · Source maps: el error de Rust se ve en el `.rsh`

```ts
// src/sourcemap.ts
export function buildLineMap(map: RSharpSourceMap): Map<number, number>;
export function resolveRustLocation(
  rustFile: string,
  line: number,
  maps: RSharpSourceMap[],
): { rshFile: string; rshLine: number } | undefined;
```

- `parseRustcOutput` (`src/rustc-parser.ts`) extrae código, severidad,
  mensaje, archivo, línea, columna, `help` y `raw`.
- Un bloque de `rustc` **sin** línea `-->` no se publica como error de VSCode:
  va al panel de salida (§17).
- La posición se resuelve con la entrada **anterior más cercana**; si no hay
  ninguna, con la primera del mapa.
- El diagnóstico final apunta a la línea del `.rsh`, nunca a la del Rust
  generado (§17).
- `line`/`column` viajan 1-based en el contrato y se restan 1 al convertirlos
  a rango de VSCode (`src/diagnostics.ts`).

### Paso 5 · Gramática y snippets

- La gramática (`syntaxes/rsharp.tmLanguage.json`) es **autocontenida**: no
  depende de `source.cs`. `scopeName` es `source.rsharp` y `fileTypes` incluye
  `rsh`.
- Cubre keywords, tipos, literales, strings verbatim (`@"..."`) e interpolados
  (`$"..."`), chars, comentarios, directivas, genéricos y atributos.
- Cubre las construcciones propias de R#: `#codeGenAI(...)` … `#end`,
  `#region`, `#endregion` y los atributos `[Export]`, `[Extern]`,
  `[WasmExport]`, `[DllImport]`, `[ForeignAssembly]`, `[PythonModule]`,
  `[JavaClass]`, `[RustMacro]`, `[Weak]`, `[Borrowed]`, `[Owned]`,
  `[NoOptimize]`, `[RSharpSugar]`.

### Paso 6 · Verifica

```bash
cd extension
npm run lint      # tsc -p ./ --noEmit (strict)
npm test          # compila y ejecuta out/test/*.test.js
npm run package   # genera rsharp.vsix
```

Prueba manual sin compilador instalado:

```bash
node extension/tools/mock-rsharp.mjs transpile --project . --json
```

### Paso 7 · Cierra la tarea

- Tarea en `REVIEW` con el resumen: qué cambió, qué archivos, qué tests.
- Si tocaste `src/types.ts`, dilo explícitamente en el resumen.

## Reglas

1. **No muestres el Rust transpilado al usuario.** El código Rust generado es un
   producto intermedio (§1): el usuario escribe C# y ve errores en sus `.rsh`.
   Solo se abre o se copia si el usuario lo pide **explícitamente** (comandos
   `rsharp.openGeneratedRust` / `rsharp.copyGeneratedRust`).
2. `src/types.ts` es el contrato único: nada de formas duplicadas.
3. Todo el código de `src/` es TypeScript `strict`, CommonJS (`module: Node16`),
   **sin dependencias de runtime**.
4. No uses `any` salvo con un comentario que lo justifique; los casts van
   encapsulados en un helper con el motivo documentado.
5. Nada de `console.log`: se usa el `OutputChannel` inyectado.
6. No uses `vscode` en los módulos que se prueban en Node puro (`config.ts`,
   `sourcemap.ts`, `rustc-parser.ts`, `toml.ts`, `toolchain.ts`, `cli.ts`).
7. Ninguna excepción escapa: los fallos de la CLI van en `CliResult.failure`
   con `kind` ∈ `not-found`, `spawn-failed`, `bad-json`, `unsupported`,
   `non-zero`, `unknown`.
8. Textos de UI en **español**; identificadores en **inglés**.
9. Todo diagnóstico señala la línea del `.rsh` (§17).

## Salida esperada

- El módulo tocado con tipos strict, sin `vscode` donde no toca y sin
  excepciones sin capturar.
- Tests nuevos o ampliados en `extension/src/test/*.test.ts` para el
  comportamiento cambiado.
- `npm run lint` y `npm test` en verde, con la salida de ambos comandos.
- Resumen con los archivos tocados, los contratos de `src/types.ts` usados o
  añadidos, y una captura del texto exacto de los mensajes nuevos.
