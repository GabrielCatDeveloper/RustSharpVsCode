# Arquitectura de la extensión de VSCode para R# (Rust#)

> Documento de referencia del lado *extensión*. Describe el código que existe
> hoy en `extension/src/`. El contrato que la extensión exige a la CLI
> `rsharp` está en [`CLI-CONTRACT.md`](./CLI-CONTRACT.md).
> Especificación de referencia: [`../rsharp-spec.md`](../rsharp-spec.md).

---

## 1. Resumen en cinco líneas

1. La extensión es un **cliente delgado**: no sabe nada de R#, solo invoca la CLI `rsharp` (un proceso .NET) y traduce su salida a la interfaz de VSCode.
2. Todo el código se divide en dos: una **capa pura** (sin `vscode`, sin E/S, testeable en Node puro) y una **capa VSCode** (comandos, barra de estado y vista lateral).
3. La **configuración** se resuelve en `config.ts` con la precedencia `rsharp.toml` > ajustes de VSCode > valores por defecto (spec §14.4).
4. Los **errores de Rust** se traducen a líneas del `.rsh` original mediante *source maps* que produce la CLI (`rustc-parser` → `sourcemap` → `diagnostics`).
5. El **Rust generado es un producto intermedio**: la extensión lo muestra como información, nunca como algo que el usuario deba leer o corregir (spec §1).

---

## 2. Diagrama de capas

```text
╔══════════════════════════════════════════════════════════════════════════════╗
║  CAPA VSCode  (importa `vscode`)                                             ║
║                                                                              ║
║   ┌────────────────┐      ┌────────────────┐      ┌────────────────┐          ║
║   │  commands.ts   │      │  statusbar.ts  │      │  treeview.ts   │          ║
║   │  (paleta,      │      │  (barra de     │      │  (vista        │          ║
║   │   menú, ctx)   │      │   estado R#)   │      │   lateral)     │          ║
║   └───────┬────────┘      └────────┬───────┘      └────────┬───────┘          ║
╚═══════════╪═════════════════════════╪══════════════════════╪═════════════════╝
            │                          │                      │
            └──────────────────────────┴──────────────────────┘
                                       │  invocan acciones
                                       ▼
╔══════════════════════════════════════════════════════════════════════════════╗
║  CAPA DE COMANDOS  (commands.ts)                                             ║
║  Orquesta: pide configuración, pide toolchain, llama a la CLI, informa.      ║
║  NO implementa transpilación, NO compila, NO verifica tipos.                  ║
╚═══════════════════════════════════╤══════════════════════════════════════════╝
                                    │
            ┌───────────────────────┼────────────────────────┐
            ▼                       ▼                        ▼
╔══════════════════════════════════════════════════════════════════════════════╗
║  ADAPTADORES  (node:fs / node:path / node:child_process)                    ║
║                                                                              ║
║   ┌────────────────┐   ┌────────────────┐   ┌──────────────────┐              ║
║   │   config.ts    │   │  toolchain.ts  │   │     cli.ts       │              ║
║   │  (rsharp.toml  │   │  (dotnet,      │   │  (spawn de la    │              ║
║   │   + ajustes)   │   │   cargo,       │   │   CLI, parse del │              ║
║   │                │   │   rsharp)      │   │   sobre JSON)    │              ║
║   └───────┬────────┘   └────────┬───────┘   └────────┬─────────┘              ║
╚═══════════╪════════════════════╪════════════════════╪════════════════════════╝
            │                     │                    │
            ▼                     ▼                    ▼
╔══════════════════════════════════════════════════════════════════════════════╗
║  NÚCLEO PURO  (sin `vscode`, sin red, testeable con `node --test`)          ║
║                                                                              ║
║   ┌──────────┐    ┌──────────────┐    ┌───────────────┐   ┌────────────────┐ ║
║   │ toml.ts  │───▶│  config.ts   │    │ sourcemap.ts  │   │ rustc-parser.ts│ ║
║   │ (parser  │    │ (resolución  │    │ (línea Rust → │   │ (texto de      │ ║
║   │  TOML)   │    │  final)      │    │  línea R#)    │   │  rustc/cargo)  │ ║
║   └──────────┘    └──────────────┘    └───────────────┘   └────────────────┘ ║
║   ┌────────────────┐    ┌──────────┐                                          ║
║   │ diagnostics.ts │    │ types.ts │  ← contratos compartidos                ║
║   │ (R# → VSCode)  │    │          │                                          ║
║   └────────────────┘    └──────────┘                                          ║
╚═════════════════════════════════════╤════════════════════════════════════════╝
                                      │  child_process.spawn
                                      ▼
╔══════════════════════════════════════════════════════════════════════════════╗
║  PROCESO EXTERNO  (fuera de la extensión)                                    ║
║                                                                              ║
║   ┌───────────────────┐    ┌────────────────────────┐   ┌──────────────────┐ ║
║   │  rsharp (CLI)     │───▶│  RSharp.Cli (.NET 8)   │──▶│  cargo / rustc   │ ║
║   │  o `dotnet <dll>` │    │  transpilador R#→Rust  │   │  compila el Rust │ ║
║   └───────────────────┘    └────────────────────────┘   │  generado        │ ║
║                                                        └──────────────────┘ ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

**Lectura del diagrama.** Las flechas apuntan *hacia abajo* en el sentido de la
dependencia: lo de arriba usa lo de abajo. La capa de comandos es la única que
conoce a la vez la UI y los adaptadores. El núcleo puro no sabe que existe
VSCode, lo que permite probarlo con `node --test` sin el host de VSCode
(`extension/src/test/*.test.ts`).

**Nota sobre WASM.** El transpilador **no** corre en WASM: corre como proceso
.NET (spec §4.4). WASM es un *destino* del Rust generado. Por eso la capa
externa termina en `cargo build --target wasm32-*` y no en un runtime WASM.

---

## 3. Tabla de módulos de `extension/src/`

Líneas = líneas físicas (`wc -l`), incluyendo comentarios y líneas en blanco.
"Importa `vscode`" = el módulo importa el API de VSCode en tiempo de ejecución.

| Fichero | Líneas | Responsabilidad | Dependencias | Importa `vscode` |
|---|---:|---|---|:--:|
| `src/types.ts` | 225 | **Fuente de verdad de los contratos**: `RSharpToml`, `RSharpDiagnostic`, `RSharpSourceMap`, `RSharpCliEnvelope`, `CliResult`, `RustDiagnostic`, `ToolStatus`, y las constantes `RSPHARP_TARGETS`, `RSPHARP_PROFILES`, `RSPHARP_DIAGNOSTIC_CODES`. | — | **No** |
| `src/toml.ts` | 786 | Parser de TOML propio (subconjunto de TOML v1.0, sin dependencias de runtime). Tablas, arrays, cadenas multilínea, enteros, flotantes, booleanos; **fechas no soportadas** (error explícito). Errores con línea y columna 1-based (`TomlParseError`). | — | **No** |
| `src/config.ts` | 733 | Resuelve la configuración efectiva del proyecto: lee `rsharp.toml`, valida su estructura y aplica la precedencia `toml` > `vscode` > `default` para `outputDir`, `distDir`, `target` y `profile`. Devuelve `ResolvedConfig` con `source` y `warnings`. | `node:fs`, `node:path`, `toml.ts`, `types.ts` | **No** |
| `src/toolchain.ts` | 246 | Descubre `dotnet`, `cargo` y `rsharp`. Busca en el `PATH` y en rutas extra (`~/.dotnet/tools`, `./.rsharp/bin`, carpeta del binario de la extensión). Distingue ejecutable de **DLL** (`.dll` → se lanza con `dotnet`) y construye la línea de órdenes (`buildRSharpCommand`). | `node:fs`, `node:os`, `node:path` | **No** |
| `src/cli.ts` | 483 | Cliente de la CLI: `spawn`, captura stdout/stderr completos, espera al cierre, aplica timeout de 10 min, parsea el sobre JSON (`parseEnvelope`), tolera líneas de log antes del JSON y **nunca lanza excepciones**: los fallos van en `CliResult.failure`. | `node:child_process`, `types.ts`, `toolchain.ts` | **No** |
| `src/rustc-parser.ts` | 238 | Convierte la salida de texto de `rustc`/`cargo` en `RustDiagnostic[]` (código, severidad, mensaje, archivo, línea, columna, ayuda, bloque `raw` completo). `parseCargoOutput` descarta las líneas de estatus (`Compiling`, `Finished`, `Running`). | `types.ts` | **No** |
| `src/sourcemap.ts` | 116 | Resuelve una posición del Rust generado a la posición del `.rsh` original. `buildLineMap` construye el mapa `rustLine → rshLine`; `resolveRustLocation` busca el mapa por ruta (exacta o por final de ruta) y devuelve la **entrada anterior más cercana**. | `types.ts` | **No** |
| `src/diagnostics.ts` | 153 | Traduce `RSharpDiagnostic` a la estructura plana que consume `vscode.DiagnosticCollection.set`: convierte línea/columna 1-based a 0-based, calcula la longitud del rango (leyendo el archivo si hace falta), agrupa por archivo (`groupByFile`) y cuenta por severidad (`summarizeDiagnostics`). | `node:fs`, `node:path`, `types.ts` | **No** |
| `src/commands.ts` | 784 | Capa de comandos: registra los **8 comandos** de la spec §14.2, pide la configuración y el toolchain, llama a la CLI con progreso en la ventana, informa de diagnósticos y fallos en el panel `R#`, y aplica las reglas de §14.4 (rutas fuera del workspace → confirmación; `outputDir` ≠ `distDir`). | **`vscode`**, `node:fs`, `node:path`, `cli.ts`, `config.ts`, `diagnostics.ts`, `toolchain.ts`, `types.ts` | **Sí** |
| `src/statusbar.ts` | 247 | Barra de estado `$(tools) R# <destino>`, con *tooltip* en Markdown (destino, perfil, toolchain, proyecto) y menú rápido `rsharp.statusBarMenu` con las acciones Transpile / Build / Run / Build WASM / Select target / Show output. | **`vscode`**, `types.ts` | **Sí** |
| `src/treeview.ts` | 470 | Vista lateral `R# Project` con cinco secciones: Proyecto, Configuración, Rutas, Toolchain y Rust generado. Registra sus propios comandos internos (`rsharp.tree.openFolder[N]`, `rsharp.tree.openFile[N]`) para que los nodos con ruta sean clicables. | **`vscode`**, `node:path`, `config.ts`, `toolchain.ts` | **Sí** |
| **Total `src/`** | **4 481** | | | |

### 3.1 Piezas fuera de `src/`

| Ruta | Papel |
|---|---|
| `extension/package.json` | Manifiesto: comandos, menús, vista, gramática, ajustes (`rsharp.*`), *activation events* y `main: ./out/extension.js`. |
| `extension/tools/mock-rsharp.mjs` | CLI simulada (Node puro) que implementa el mismo contrato: sirve para probar la extensión sin compilar R#. Ver [`CLI-CONTRACT.md`](./CLI-CONTRACT.md#11-cómo-probar-la-extensión-sin-compilar-r). |
| `extension/src/test/*.test.ts` | 7 suites con `node --test` (sin VSCode): `cli`, `config`, `diagnostics`, `rustc-parser`, `sourcemap`, `toml`, `toolchain`. |
| `extension/syntaxes/`, `language-configuration/`, `snippets/` | Gramática TextMate, configuración de editor y *snippets* para `.rsh`. |

### 3.2 Lo que **no** existe todavía (pendiente)

| Pieza | Estado | Nota |
|---|---|---|
| `src/extension.ts` (activación) | **Pendiente** | `package.json` declara `main: ./out/extension.js`, pero no hay fichero que lo implemente. Hoy nadie construye el `CommandDependencies`, el `OutputChannel`, la `DiagnosticCollection` ni el estado (`Memento`). |
| Publicación en `DiagnosticCollection` | **Pendiente** | `diagnostics.ts` produce la estructura plana, pero ningún módulo llama a `vscode.languages.createDiagnosticCollection`. El ajuste `rsharp.showRustDiagnostics` está declarado en `package.json` y **no lo lee ningún código**. |
| Cableado `rustc-parser` → `sourcemap` → `diagnostics` | **Pendiente** | Los tres módulos existen y están probados por separado, pero `commands.ts` no los invoca: hoy los diagnósticos de Rust solo se imprimen en el panel de salida. |
| 8 comandos extra de `package.json` | **Pendiente** | `rsharp.showOutput`, `rsharp.selectTarget`, `rsharp.selectProfile`, `rsharp.openGeneratedRust`, `rsharp.copyGeneratedRust`, `rsharp.restartLanguageServer`, `rsharp.toggleCSharpAssociation` y `rsharp.showToolchainStatus` se contribuyen a la paleta pero **no están registrados**: VSCode respondería «command not found». |
| `rsharp bind` (bindings de crates / C) | **Pendiente** | La spec §12/§13 lo define, pero la extensión no lo invoca (no está en el contrato de `cli.ts`). |

---

## 4. Flujo de «R#: Build» paso a paso

Comando registrado: `rsharp.build` (`commands.ts::RSPHARP_COMMANDS.build`).
Se puede lanzar desde la paleta, desde `editor/context` y `explorer/context` de
un `.rsh`, desde el título de la vista lateral o con `ctrl+shift+b`.

| # | Paso | Módulos que intervienen | Qué ocurre |
|---:|---|---|---|
| 1 | **Lanzamiento** | `commands.ts::registerCommands` | VSCode entrega el evento a `commandBuild(deps, { profile: 'debug', target: 'native' })`. Cada comando va envuelto en un `try/catch`: una excepción nunca sale hacia VSCode, se muestra con `showErrorMessage` y se escribe en el panel `R#`. |
| 2 | **Resolución de la raíz** | `commands.ts::requireRoot` | Si el workspace no tiene un `rsharp.toml`, se avisa *«No se encontró rsharp.toml en el workspace»* y el comando termina sin hacer nada. La búsqueda de la raíz la hace la capa de activación (`getRoot()`), **pendiente**. |
| 3 | **Resolución de la configuración** | `config.ts::loadProjectConfig`, `toml.ts::parseToml` | Se lee `rsharp.toml`, se valida (con avisos, nunca excepciones hacia fuera) y se calculan `outputDir`, `distDir`, `target` y `profile` con la precedencia **toml > VSCode > default**. `ResolvedConfig.source` indica de dónde salió cada valor. Si `outputDir == distDir` se emite un aviso (§14.4 lo prohíbe). |
| 4 | **Comprobación del toolchain** | `toolchain.ts` (vía `deps.getToolchain()`) | Si falta `cargo`, se informa con `describeMissingTools` y **la transpilación se hace igual**: solo se omite la compilación (§14.4: transpilar no requiere Rust). Si falta la CLI `rsharp`, el `preflight` de `cli.ts` cortará la ejecución antes de lanzar nada. |
| 5 | **Transpilación** | `commands.ts::runTranspile` → `cli.ts::RSharpCli.transpile` → `toolchain.ts::buildRSharpCommand` | Con `vscode.window.withProgress` se lanza `rsharp transpile --project <raíz> --output <outputDir> --json`. `cli.ts` captura stdout/stderr, los reenvía al `logger` (panel `R#`) y parsea el sobre con `parseEnvelope` (tolera líneas de log antes del JSON). |
| 6 | **Diagnósticos de la transpilación** | `commands.ts::reportDiagnostics`, `diagnostics.ts::diagnosticText` | Cada `RSharpDiagnostic` del sobre se imprime como `R#0042: mensaje` más una línea `  Ayuda: ...` y la ubicación `archivo:línea:columna`. Si el `CliResult` falla, `reportFailure` muestra el error en la UI y vuelca `raw`/`stderr` en el panel de salida. |
| 7 | **Compilación** | `commands.ts::runCompile` → `cli.ts::RSharpCli.build` | Se lanza `rsharp build --project <raíz> --profile <debug|release> --target <native|wasm32-*> --dist <distDir> --json`. La CLI ejecuta `cargo build --target-dir <distDir>` (§14.4) y devuelve en el sobre `cargo.command`, `cargo.exitCode`, `cargo.stdout`, `cargo.stderr`, `artifact` y los `diagnostics` de `rustc`. |
| 8 | **Informe y refresco** | `commands.ts::reportSuccess`, `deps.refresh()` | Se escribe el resumen, la duración (`durationMs`), la lista de archivos generados (`files`) y la salida de `cargo`; se avisa por UI («Compilación completada (perfil debug, destino native)») y se refrescan la barra de estado y la vista lateral. |

> **Variantes.** `rsharp.buildRelease` usa `{ profile: 'release', target: 'native' }`.
> `rsharp.buildWasm` usa el destino WASM guardado (`rsharp.runTarget`) o
> `wasm32-unknown-unknown` por defecto. `rsharp.run` encadena transpilación →
> compilación → búsqueda del binario (`findBinary`: primero `envelope.artifact`,
> luego `<project.name>` en `distDir`, `distDir/<perfil>` y
> `distDir/<perfil>/<destino>`) → ejecución en una terminal integrada llamada
> `R#`. Si el destino no es `native`, `R#: Run` **no** ejecuta nada: informa de
> que el módulo WASM no se ejecuta en la terminal.

---

## 5. Flujo de traducción de errores (Rust → R#)

Este es el mecanismo que exige la spec §14.4 (*«Traduce errores de `rustc` a
líneas de R# con source maps»*) y §17 (*«Cada diagnóstico apunta a la línea de
R#, no a la de Rust»*).

```text
   rustc / cargo                CLI `rsharp`                  extensión
   ─────────────                ───────────                  ─────────
   error[E0308]: mismatched  →  cargo.stdout / cargo.stderr  →  rustc-parser.ts
   types                         (texto crudo, sin traducir)     parseCargoOutput()
   --> main.rs:2:18                                                  │
                                                                       ▼
   sourceMaps (rustLine↔rshLine)  ─────────────────────────→  sourcemap.ts
   en el mismo envelope                                                 resolveRustLocation()
                                                                       │
                                                                       ▼
   RSharpDiagnostic {file:'main.rsh', line:2}               →  diagnostics.ts
                                                                       toVscodeDiagnostic()
                                                                       │
                                                                       ▼
                                                            vscode.DiagnosticCollection
                                                            (PENDIENTE: no existe todavía)
```

> **Camino alterno, el que ya funciona hoy.** La CLI puede analizar ella
> misma la salida de `cargo` y devolver los diagnósticos **ya traducidos** en
> `envelope.diagnostics` (`file` = `.rsh`, `line` = línea de R#). En ese caso
> la extensión no necesita `rustc-parser` ni `sourcemap`: basta con
> `commands.ts::reportDiagnostics`, que los imprime en el panel `R#`. Es el
> camino que usa el mock. Ver
> [`CLI-CONTRACT.md`](./CLI-CONTRACT.md#54-diagnósticos-de-rustc-dentro-del-sobre).

### 5.1 Ejemplo real (datos literales del mock)

Salida de `cargo build` (extracto, tal cual lo emite `rustc`):

```text
error[E0308]: mismatched types
 --> main.rs:2:18
  |
2 |     let x: i32 = "hola";
  |            ---   ^^^^^^ expected `i32`, found `&str`
  |            |
  |            expected due to this

For more information about this error, try `rustc --explain E0308`.
error: could not compile `mockproj` (bin "mockproj") due to 1 previous error
```

**Paso 1 — `rustc-parser.ts::parseCargoOutput(text)`.** Filtra las líneas de
estatus de cargo (`Compiling`, `Finished`, `Running`) y delega el resto en
`parseRustcOutput`, que agrupa por bloques (empieza en `error…`/`warning…` y
termina en la siguiente cabecera). Del bloque extrae:

```json
{
  "code": "E0308",
  "severity": "error",
  "message": "mismatched types",
  "file": "main.rs",
  "line": 2,
  "column": 18,
  "raw": "error[E0308]: mismatched types\n --> main.rs:2:18\n  |\n2 |     let x: i32 = \"hola\";\n  |            ---   ^^^^^^ expected `i32`, found `&str`\n  |            |\n  |            expected due to this\n"
}
```

**Paso 2 — `sourcemap.ts::resolveRustLocation('main.rs', 2, maps)`.** Busca el
source map cuyo `rustFile` coincide con `main.rs` (comparación por ruta
normalizada: `\` → `/`, sin `./`, sin barra final; si no hay coincidencia
exacta, acepta que una ruta sea el final de la otra). Del mapa elige **la
entrada anterior más cercana** (`rustLine <= 2`; a igualdad de distancia gana
la última). Con el mapa lineal que produce el mock:

```json
{ "rustFile": "main.rs", "rshFile": "main.rsh", "entries": [ { "rustLine": 1, "rshLine": 1 }, { "rustLine": 2, "rshLine": 2 } ] }
```

el resultado es:

```json
{ "rshFile": "main.rsh", "rshLine": 2 }
```

**Paso 3 — `diagnostics.ts::toVscodeDiagnostic(d, root)`.** Convierte línea y
columna de 1-based (R#) a 0-based (VSCode), fija `source = "R#"` y conserva el
código exacto (`E0308`):

```json
{
  "range": {
    "start": { "line": 1, "character": 17 },
    "end": { "line": 1, "character": 23 }
  },
  "severity": "error",
  "source": "R#",
  "code": "E0308",
  "message": "mismatched types"
}
```

*OJO con `end.character`:* `end = start + length`. La `length` sale de
`d.length` si la CLI la envía; si no, `diagnostics.ts` **lee el `.rsh`** y
resalta hasta el final de la línea; si el archivo no se puede leer, resalta
**1 carácter** (`end.character = start.character + 1`). En el ejemplo anterior
se ha supuesto una `length` de 6 (la de `^^^^^^` en el mensaje de `rustc`),
que es lo que la CLI debería enviar para que el resaltado sea exacto.

**Paso 4 — publicación (pendiente).** El `DiagnosticCollection` de VSCode
(`vscode.languages.createDiagnosticCollection('rsharp')`) **todavía no se
crea**: `diagnostics.ts` devuelve la estructura plana precisamente para que esa
capa sea trivial de escribir, pero falta el módulo que la conecte con
`commands.ts`. El ajuste `rsharp.showRustDiagnostics` ya está declarado en
`package.json` a la espera de ese cableado.

### 5.2 Estado actual frente al diseño

| Etapa | Módulo | Estado |
|---|---|---|
| Extraer diagnósticos de `rustc`/`cargo` | `rustc-parser.ts` | **Implementado y probado** |
| Resolver línea Rust → línea R# | `sourcemap.ts` | **Implementado y probado** |
| Convertir a la estructura de VSCode | `diagnostics.ts` | **Implementado y probado** |
| Publicar en el `DiagnosticCollection` | — | **Pendiente** |
| Conectar la traducción con `commands.ts` | — | **Pendiente** |

Mientras tanto, los diagnósticos que la CLI devuelve en el sobre
(`RSharpDiagnostic`) **sí** llegan al usuario: `commands.ts::reportDiagnostics`
los imprime en el panel de salida `R#` con su código (`R#0042`, `R#0101`,
`R#0150`) y su ubicación, que es ya una línea de R# (spec §17).

---

## 6. Decisiones de diseño y sus motivos

### D1 · La extensión es un cliente delgado

**Qué.** La extensión no transpila, no compila Rust y no analiza C#. Solo
invoca procesos y traduce su salida.

**Por qué.** La spec lo dice explícitamente en §14.1: *«Extensión de VSCode
como cliente delgado»*, *«Autocompletado y diagnósticos vienen de C# Dev Kit y
Roslyn»*, *«Un servidor LSP propio es opcional y posterior»*, *«La extensión
ejecuta `dotnet` para transpilar»* y *«La extensión ejecuta `cargo` para
compilar»*. Además, §4.1 sitúa el frontend en Roslyn y §4.4 exige que el
transpilador corra en .NET, no en WASM: la única forma de que la extensión sea
independiente del compilador es hablar con él por proceso.

**Cómo se ve en el código.** `cli.ts` no sabe qué significa `transpile` ni
`build`: solo lanza `spawn` y parsea un sobre JSON. Ninguna regla de R# está
implementada en TypeScript.

### D2 · `rsharp.toml` tiene prioridad sobre los ajustes de VSCode

**Qué.** La precedencia es `rsharp.toml` > ajuste de VSCode > valor por
defecto, y el valor por defecto del proyecto es *estricto* (§9).

**Por qué.** §14.4: *«`rsharp.toml` tiene prioridad sobre los ajustes de
VSCode»*. §9: *«Los valores por defecto son estrictos»* y *«Gana el ámbito más
cercano al código»*. El `rsharp.toml` se versiona en git (§3), así que es la
fuente de verdad del proyecto; un ajuste local de VSCode no puede cambiarlo.

**Cómo se ve en el código.** `config.ts::loadProjectConfig` distingue
*«la clave estaba presente»* de *«la clave vale el mismo que el defecto»*
(`TomlFacts.hasOutput`, `hasDist`, `hasTarget`, `hasProfile`), lo que evita
que un valor por defecto del toml se confunda con uno ausente. El resultado
`ResolvedConfig.source` dice de dónde salió la configuración. En la UI,
`commands.ts::commandChooseFolder` guarda la carpeta elegida en el `Memento` y
después **informa** de que el toml manda: *«`rsharp.toml` define la ruta; se
usa …»*.

### D3 · La extensión no implementa un verificador de tipos

**Qué.** No hay ningún análisis de tipos, de resolución de nombres ni de
sobrecargas en el código de la extensión.

**Por qué.** §4.1: *«El transpilador NO implementa un verificador de tipos
propio»* y *«Analizadores Roslyn rechazan lo que el núcleo no soporta»*.
Roslyn (C# Dev Kit) da el modelo semántico; los analizadores de
`RSharp.Analyzers` (spec §4.2) rechazan lo no soportado. Duplicar eso en la
extensión sería trabajo infinito y divergente.

**Cómo se ve en el código.** `types.ts` define los tres códigos en
`RSPHARP_DIAGNOSTIC_CODES` (`R#0042`, `R#0101`, `R#0150`), que **emite la
CLI**, no la extensión. La extensión solo formatea
(`diagnostics.ts::diagnosticText`) y traduce.

### D4 · El Rust generado es un producto intermedio que el usuario no debe leer

**Qué.** La extensión no ofrece «editar el Rust generado» como flujo de
trabajo. La vista lateral lo muestra como información (sección «Rust
generado») y el proyecto se configura siempre desde `.rsh` + `rsharp.toml`.

**Por qué.** §1: *«El programador escribe C#. No escribe Rust.»* y *«El código
Rust generado es un producto intermedio. Nadie lo lee.»* §2.4–§2.5: el núcleo
es determinista y el código generado *puede* ser largo. §15: un `.rs` escrito a
mano se integra con `[Extern]`, no se edita el generado.

**Cómo se ve en el código.** `treeview.ts` lista los `.rs` generados con su
ruta relativa dentro de `outputDir` y su *tooltip* con la ruta absoluta; no hay
comando «editar». Los comandos `rsharp.openGeneratedRust` y
`rsharp.copyGeneratedRust` están declarados en `package.json` pero **no
registrados** (quedan *pendientes*), precisamente porque abrirlos es
contrario a esta decisión.

### D5 · El núcleo puro no importa `vscode`

**Qué.** `types.ts`, `toml.ts`, `config.ts`, `toolchain.ts`, `cli.ts`,
`rustc-parser.ts`, `sourcemap.ts` y `diagnostics.ts` no importan `vscode`.

**Por qué.** Es la condición para que la lógica se pueda probar en Node puro
(`node --test`, sin host de VSCode) y para que la extensión sea un cliente
delgado de verdad: la lógica no depende de la UI. Además, el transpilador es
otro proceso (§4.4), así que la frontera natural es el proceso, no el módulo.

**Cómo se ve en el código.** Los módulos puros devuelven estructuras planas
(`diagnostics.ts` devuelve un objeto con `range`/`severity`/`source`/`code`/
`message` en vez de un `vscode.Diagnostic`), de modo que la conversión a
objetos de VSCode queda aislada en la capa de UI.

### D6 · `outputDir` y `distDir` son independientes y nunca iguales

**Por qué.** §14.4: *«`outputDir` y `distDir` son independientes»* y *«`outputDir`
y `distDir` NO DEBEN ser la misma carpeta»*. §3 fija los valores por defecto:
`target/rsharp/` para el Rust y `dist/` para el binario.

**Cómo se ve en el código.** `config.ts` emite un aviso si coinciden;
`commands.ts::commandChooseFolder` muestra un *warning* si se elige la carpeta
de la otra; `commands.ts::removeDirectory` se niega a borrar la raíz del
proyecto o una carpeta que la contenga.

### D7 · Las rutas fuera del workspace exigen confirmación

**Por qué.** §14.4: *«Rechaza rutas fuera del workspace sin confirmación»* y
§2.8 (*«Todo es local»*). Además, `package.json` declara
`capabilities.untrustedWorkspaces.supported = "limited"`: el transpilador
ejecuta código del proyecto, así que una ruta externa es una decisión
deliberada del usuario.

**Cómo se ve en el código.** `commands.ts::isInsideWorkspace` +
`showWarningMessage` modal antes de guardar la carpeta.

### D8 · Todo local, sin red obligatoria

**Por qué.** §2.8: *«Todo es local. No hay servicios de red obligatorios»*;
§4.5: el modelo de IA solo hace falta si se usa `#codeGenAI`.

**Cómo se ve en el código.** La extensión solo usa `spawn` de procesos
locales; la única dirección de red que aparece en el código es
`https://rustup.rs`, en el mensaje que sugiere instalar Rust
(`toolchain.ts`). El `endpoint` del proveedor de IA (`sugar.ai.endpoint`) solo
se transcribe en `config.ts`: la extensión **no** lo consume.

### D9 · La extensión no implementa el destino WASM: solo lo pide

**Por qué.** §4.4: WASM es un destino del programa generado, no del
transpilador. §11: *«Se activa con `build.target` en `rsharp.toml`»*,
*«Las DLL dinámicas no cargan en `wasm32-unknown-unknown`»*,
*«`[PythonModule]` se rechaza en la v1 (`R#0150`)»*.

**Cómo se ve en el código.** `RSPHARP_TARGETS` lista los tres destinos; la
extensión solo pasa `--target`; `commands.ts::reportWasmTarget` explica que un
`.wasm` no se ejecuta en la terminal. Toda la lógica de `wasm_bindgen`,
`wasm-bindgen-futures` o `console_error_panic_hook` es del compilador.

### D10 · Timeout generoso y sin excepciones hacia fuera

**Por qué.** §18: *«Compilar Rust grande tarda»*. §2.7: *«Ningún
comportamiento cambia en silencio»*: un fallo debe ser visible y con causa.

**Cómo se ve en el código.** `cli.ts` usa 600 000 ms (10 min) de timeout, mata
el proceso con `SIGKILL` y devuelve un fallo `non-zero` explicando que se
superó el tiempo. `cli.ts` nunca lanza: todo fallo viaja en
`CliResult.failure` con un `kind` cerrado (`not-found`, `spawn-failed`,
`bad-json`, `unsupported`, `non-zero`, `unknown`). `commands.ts` envuelve cada
comando en `try/catch` y `statusbar.ts`/`treeview.ts` usan `guard()` para que
un rechazo de promesa no quede sin atender.

---

## 7. Índice de referencias a `rsharp-spec.md`

| Sección de la spec | Qué fija | Dónde se aplica |
|---|---|---|
| §1 · Objetivo | R# es C# transpilado a Rust; el Rust es un producto intermedio | D4; `treeview.ts` |
| §2 · Principios | Determinismo, sin red, nada cambia en silencio | D8, D10 |
| §3 · Archivos | `.rsh`, `rsharp.toml`, `target/rsharp/`, `dist/` | `config.ts` (defectos de rutas) |
| §4.1 · Frontend Roslyn | El transpilador no verifica tipos; los analizadores rechazan lo no soportado | D3 |
| §4.2 · Solución de proyectos | `RSharp.Cli` es `net8.0` | `CLI-CONTRACT.md` |
| §4.4 · WASM | El transpilador corre en .NET; WASM es destino | D1, D9 |
| §4.5 · Dependencias | .NET para transpilar, Rust para compilar | `toolchain.ts` |
| §8 · Núcleo y sugar | El núcleo rechaza con error lo que no soporta; el sugar está apagado por defecto | `RSPHARP_DIAGNOSTIC_CODES` |
| §9 · `rsharp.toml` | Defaults estrictos, perfiles, `build.target` | `config.ts`, `types.ts` |
| §10 · BCL | `R#0101` para APIs no soportadas en el destino | `types.ts` |
| §11 · WASM | `[WasmExport]`, `R#0150`, `File.ReadAllText` no soportado | `types.ts`, `commands.ts` |
| §12/§13 · Crates y FFI | `bindings/`, `rsharp.lock`, `extern "C"`, `pyo3` | `CLI-CONTRACT.md` (§8) |
| §14.1 · Piezas | Cliente delgado; ejecuta `dotnet` y `cargo` | D1 |
| §14.2 · Comandos | Los 8 comandos con su identificador | `commands.ts`, `package.json` |
| §14.3 · Interfaz | Botones en la barra de estado, vista lateral | `statusbar.ts`, `treeview.ts` |
| §14.4 · Rutas | `outputDir` ≠ `distDir`, prioridad del toml, confirmación fuera del workspace, `cargo build --target-dir`, panel `R#`, traducción con source maps | D2, D6, D7; §4 y §5 de este documento |
| §14.5 · Depuración | CodeLLDB con source maps (posterior) | Pendiente |
| §17 · Diagnósticos | `R#0042`, `R#0101`, `R#0150`; apuntan a la línea de R# | `types.ts`, §5 de este documento |
| §18 · Riesgos | Compilar Rust tarda; los source maps deben ser precisos | D10; timeout de 10 min |
| §19 · Decisiones abiertas | Formato del source map, esquema JSON de `rsharp.toml` | `CLI-CONTRACT.md` (contrato provisional) |

---

## 8. Glosario mínimo

| Término | Significado en este repositorio |
|---|---|
| **Sobre / envelope** | Objeto JSON `RSharpCliEnvelope` que la CLI imprime con `--json`. |
| **Diagnóstico R#** | `RSharpDiagnostic`: error o aviso del compilador de R#, con código `R#XXXX`. |
| **Source map** | `RSharpSourceMap`: tabla que relaciona líneas del Rust generado con líneas del `.rsh`. |
| **Toolchain** | Conjunto `dotnet` + `cargo` + CLI `rsharp`, resuelto por `toolchain.ts`. |
| **Sugar** | Concesión explícita del programador (§8.2). Apagada por defecto. |
| **`outputDir` / `distDir`** | Carpeta del Rust generado / carpeta del binario compilado. |
