# Extensión de VSCode para R# (Rust#) — tutorial completo

> **Estado:** versión `0.1.0`.
> **Spec de referencia:** [`rsharp-spec.md`](../rsharp-spec.md) (sección 14 y siguientes).
> **Cliente delgado:** la extensión NO transpila. Invoca la CLI `rsharp`
> (que corre en .NET, spec §4.4) y `cargo`.

---

## 1. Qué es R# y qué hace esta extensión

**R# (Rust#)** es un lenguaje con sintaxis y semántica de C# que se transpila al
100 % a Rust. Escribes C# en archivos `.rsh`; el compilador genera Rust; `cargo`
lo compila a un binario nativo o a un módulo `.wasm`.

```
src/main.rsh  ──[rsharp transpile]──▶  target/rsharp/main.rs  ──[cargo build]──▶  dist/mi_app
```

La extensión de VSCode es un **cliente delgado** (spec §14.1). Se ocupa de:

| De la extensión | Del compilador / toolchain |
|---|---|
| Editar `.rsh` con resaltado de R# | Analizar el C# con Roslyn |
| Invocar `rsharp transpile` / `rsharp build` | Transpilar a Rust |
| Invocar `cargo` | Compilar el Rust generado |
| Traducir errores de Rust a la línea del `.rsh` | Emitir source maps |
| Publicar diagnósticos en el editor | Emitir diagnósticos `R#0042`, `R#0101`, `R#0150` |
| Ejecutar el binario en una terminal | Producir el binario |

### La idea central: no ves el Rust transpilado

Igual que TypeScript nunca te enseña el JavaScript generado, **la extensión no te
enseña el Rust generado** salvo que lo pidas explícitamente. Cuando algo falla:

- el error de `rustc` aparece **en tu archivo `.rsh`**, con el código de rustc
  (`E0308`, `E0425`, ...) y su mensaje de ayuda;
- el pánico en tiempo de ejecución también aparece **en tu `.rsh`**, no en
  `target/rsharp/main.rs`;
- el fragmento de código Rust **no** se muestra.

Si quieres ver el detalle, usa `R#: Mostrar / ocultar el detalle de Rust en los
errores` o abre el Rust a mano con `R#: Open Generated Rust File`.

---

## 2. Requisitos e instalación

### Requisitos

| Herramienta | Para qué | Obligatoria |
|---|---|---|
| **.NET SDK 8 o superior** | Ejecutar la CLI `rsharp` (spec §4.4/§4.5) | Sí |
| **Rust (`rustup` + `cargo`)** | Compilar el Rust generado | Sí, para `Build` |
| **C# Dev Kit** (o el servidor de Roslyn) | Autocompletado y diagnóstico de C# en `.rsh` | No, pero recomendado |
| **CodeLLDB** | Depuración a nivel de Rust | No, solo para `R#: Debug` |

### Instalación de la extensión

```bash
git clone git@github.com:GabrielCatDeveloper/RustSharpVsCode.git
cd RustSharpVsCode
npm install            # instala las dependencias (workspaces)
npm run compile        # compila la extensión a extension/out/
cd extension
npx vscode package     # genera rsharp.vsix
code --install-extension rsharp.vsix
```

Para desarrollo, pulsa **F5** en VSCode: se abre una segunda ventana con la
extensión cargada desde el código.

### Detección automática del toolchain

Al activarse, la extensión busca:

- `dotnet`, `cargo` y `rsharp` en el `PATH`;
- la CLI `rsharp` en `~/.dotnet/tools`, en `./.rsharp/bin/` y junto a la
  extensión;
- si `rsharp.cliPath` acaba en `.dll`, se ejecuta como `dotnet <rsharp.dll>`.

Comprueba el estado en cualquier momento con **`R#: Show Toolchain Status`**.

---

## 3. Configuración inicial

Un proyecto R# necesita un `rsharp.toml` en la raíz:

```toml
schema = 1

[project]
name = "mi_app"

[paths]
output = "target/rsharp"   # Rust generado
dist = "dist"              # binario compilado

[build]
target = "native"          # native | wasm32-unknown-unknown | wasm32-wasip1

[sugar]
strings = "utf8"
overflow = "panic"
reentrancy = "panic"
finalizers = "deterministic"
cycles = "weak-attribute"
```

Ejemplo mínimo de programa:

```csharp
// src/main.rsh
using System;

namespace MiApp;

public class Program
{
    public static void Main(string[] args)
    {
        Console.WriteLine("Hola desde R#");
    }
}
```

> **`rsharp.toml` manda sobre los ajustes de VSCode** (spec §14.4). Si el
> fichero define `[paths].output`, el ajuste `rsharp.outputDir` se ignora. La
> extensión avisa en el panel de salida cuando eso ocurre.

---

## 4. Tutorial paso a paso

### 4.1 Abrir el proyecto y comprobar el estado

1. Abre la carpeta del proyecto en VSCode.
2. La extensión se activa sola (detecta `rsharp.toml`).
3. Mira la barra de estado: a la izquierda aparece `R#` con el destino activo
   (`$(tools) R# native`). Si aparece `$(warning) R#`, falta el compilador.
4. Abre la vista **R# Project** en la barra lateral para ver proyecto, rutas,
   toolchain y los ficheros Rust generados.

### 4.2 Transpilar (`R#: Transpile`)

Genera el Rust en `outputDir` (`target/rsharp` por defecto) **sin** compilarlo.

- Palette de comandos → `R#: Transpile`.
- Clic derecho sobre un `.rsh` → `R#: Transpile`.
- Botón en la barra de estado → `Transpile`.

Al terminar verás en el panel de salida `R#`:

```
Transpilando /mi/proyecto -> /mi/proyecto/target/rsharp
Transpilación: correcto (3 archivos generados).
```

Si el transpilador necesita una concesión de *sugar*, aparece un diagnóstico
`R#0042` **en la línea exacta de tu `.rsh`**:

```
R# error [R#0042]: este código exige el sugar "cycles = weak-attribute"
  src/Circulo.rsh:12:9
  help: usa [Weak] en el campo `padre` o activa #codeGenAI
```

### 4.3 Compilar (`R#: Build`)

Transpila y compila con `cargo`:

```
R#: Build            -> perfil debug,  destino native
R#: Build Release    -> perfil release, destino native
R#: Build WASM       -> perfil debug,  destino wasm32-unknown-unknown
```

- El binario aparece en `distDir` (`dist` por defecto).
- Si falta `cargo`, la extensión **transpila igual** pero avisa de que no puede
  compilar.
- `rsharp.toml` puede fijar `[build].target`; entonces manda sobre el destino
  elegido en la UI (spec §14.4).

### 4.4 Ejecutar (`R#: Run`)

Compila y ejecuta el binario en la terminal integrada **`R#`**.

Lo que verás:

- La salida normal del programa en la terminal.
- Si el programa entra en pánico, la extensión **traduce el pánico a tu `.rsh`**
  y lo marca en el editor:

```
R# error [panic]: Pánico en tiempo de ejecución: index out of bounds
  src/Lista.rsh:23:11
```

- El mensaje aparece también como notificación y en el panel de salida.

### 4.5 Elegir las carpetas de salida y de distribución

- `R#: Choose Output Folder` → dónde se genera el Rust.
- `R#: Choose Dist Folder` → dónde se compila el binario.

Ambas son independientes y **no pueden ser la misma carpeta** (spec §14.4): la
extensión avisa si lo intentas. Si eliges una carpeta fuera del espacio de
trabajo, pide confirmación.

### 4.6 Limpiar (`R#: Clean`)

Borra `outputDir` y `distDir` (con confirmación). Útil cuando el Rust generado
se queda obsoleto o hay que forzar una recompilación completa.

### 4.7 Compilar a WebAssembly

```bash
R#: Build WASM
```

- Genera un `.wasm` en `distDir`.
- El módulo **no se puede ejecutar** en la terminal (no es un programa): la
  extensión lo explica y ofrece abrir el `.wasm`.
- Según la spec §11, las DLL dinámicas no cargan en `wasm32-unknown-unknown`;
  `R#0150` avisa de ello.

---

## 5. Ejecutar y depurar sin ver el Rust

Esta es la parte que más se parece a la experiencia de TypeScript.

### 5.1 Flujo de errores (lo que hace la extensión por ti)

```
rustc                →  rustc-parser.ts   →  sourcemap.ts      →  diagnostics.ts  →  editor
"error[E0308]: ..."     extrae código,        traduce línea        construye el        línea .rsh
  --> gen/main.rs:12:5  mensaje y ayuda       Rust → R#           rango y severidad
```

El resultado en el editor:

| Qué | Dónde |
|---|---|
| Error de compilación | En la línea de tu `.rsh`, con el código de rustc |
| Pánico en runtime | En la línea de tu `.rsh`, con el texto del pánico |
| Diagnóstico de R# | En la línea de tu `.rsh`, con `R#0042`/`R#0101`/`R#0150` |
| Salida de `cargo` completa | En el panel de salida `R#` (nunca en el editor) |

### 5.2 Formato de los errores

```
R# error [E0308]: mismatched types
  src/main.rsh:12:5
  help: expected `i32`, found `&str`
```

Es el mismo esquema que usa TypeScript: severidad, código, mensaje, ubicación
y ayuda. El fragmento de Rust **no** aparece.

### 5.3 Depuración (`R#: Debug`)

La spec §14.5 pide CodeLLDB con source maps y deja la depuración para una
versión posterior. Lo que hay hoy:

1. `R#: Debug` comprueba que el binario esté compilado y que CodeLLDB esté
   instalado (ofrece instalarlo si falta).
2. Arranca una sesión `lldb` con el binario y la raíz del proyecto.
3. **Los puntos de parada que pones en un `.rsh` se traducen** a la línea
   equivalente del Rust generado usando los source maps de la última
   transpilación.

Limitación honesta: LLDB no tiene un mecanismo de source maps de línea como el
de TypeScript con Node, así que **el depurador abre el fichero Rust**. La
experiencia cómoda sin Rust es la de `R#: Run` (§5.1). Si prefieres el
depurador, usa `R#: Open Generated Rust File` para tener el Rust a mano.

### 5.4 Ajustes que afectan a esta experiencia

| Ajuste | Efecto |
|---|---|
| `rsharp.showRustDiagnostics` | `false` deja de publicar los errores de `rustc` traducidos |
| `R#: Mostrar / ocultar el detalle de Rust en los errores` | Añade la ubicación en el Rust y el texto original de `rustc` |
| `rsharp.verboseLogging` | Registra todos los comandos ejecutados en el panel de salida |

---

## 6. Referencia de comandos

| Comando | ID | Qué hace |
|---|---|---|
| R#: Transpile | `rsharp.transpile` | Genera el Rust en `outputDir` |
| R#: Build | `rsharp.build` | Transpila y compila (debug, native) |
| R#: Build Release | `rsharp.buildRelease` | Igual, con optimizaciones |
| R#: Build WASM | `rsharp.buildWasm` | Compila a `wasm32-unknown-unknown` |
| R#: Run | `rsharp.run` | Compila y ejecuta en la terminal `R#` |
| R#: Clean | `rsharp.clean` | Borra `outputDir` y `distDir` |
| R#: Choose Output Folder | `rsharp.chooseOutputFolder` | Elige dónde generar el Rust |
| R#: Choose Dist Folder | `rsharp.chooseDistFolder` | Elige dónde compilar |
| R#: Show Output | `rsharp.showOutput` | Abre el panel de salida `R#` |
| R#: Select Build Target | `rsharp.selectTarget` | Elige destino (native / wasm) |
| R#: Select Build Profile | `rsharp.selectProfile` | Elige perfil (debug / release) |
| R#: Open Generated Rust File | `rsharp.openGeneratedRust` | Abre el Rust generado (a pedido) |
| R#: Copy Generated Rust File | `rsharp.copyGeneratedRust` | Copia el Rust generado al portapapeles |
| R#: Show Toolchain Status | `rsharp.showToolchainStatus` | Muestra `dotnet`, `cargo` y `rsharp` |
| R#: Restart Roslyn / C# Language Server | `rsharp.restartLanguageServer` | Reinicia el servidor de C# |
| R#: Toggle C# Language Association for .rsh | `rsharp.toggleCSharpAssociation` | Alterna `*.rsh` ↔ `csharp` |
| R#: Debug (CodeLLDB) | `rsharp.debug` | Inicia la depuración nativa |
| R#: Mostrar / ocultar el detalle de Rust | `rsharp.toggleRustDetail` | Alterna el detalle de Rust |

---

## 7. Referencia de ajustes

| Ajuste | Tipo | Por defecto | Qué hace |
|---|---|---|---|
| `rsharp.cliPath` | `string` | `null` | Ruta de la CLI `rsharp`. Si es `.dll`, se ejecuta con `dotnet` |
| `rsharp.dotnetPath` | `string` | `null` | Ruta de `dotnet` |
| `rsharp.cargoPath` | `string` | `null` | Ruta de `cargo` |
| `rsharp.outputDir` | `string` | `null` | Carpeta del Rust generado (renta si `rsharp.toml` no la define) |
| `rsharp.distDir` | `string` | `null` | Carpeta del binario (renta si `rsharp.toml` no la define) |
| `rsharp.target` | `native \| wasm32-unknown-unknown \| wasm32-wasip1` | `native` | Destino de compilación |
| `rsharp.profile` | `debug \| release` | `debug` | Perfil de compilación |
| `rsharp.runTarget` | `auto \| native \| wasm*` | `auto` | Destino usado por `Build WASM` y `Run` |
| `rsharp.autoDetectToolchain` | `boolean` | `true` | Busca las herramientas al activarse |
| `rsharp.csharpLanguageAssociation` | `boolean` | `false` | Asocia `*.rsh` con el lenguaje `csharp` (Roslyn) |
| `rsharp.showRustDiagnostics` | `boolean` | `true` | Publica los errores de `rustc` traducidos |
| `rsharp.verboseLogging` | `boolean` | `false` | Log detallado en el panel de salida |
| `rsharp.cleanBeforeBuild` | `boolean` | `false` | Limpia antes de compilar |
| `rsharp.confirmOutsideWorkspace` | `boolean` | `true` | Pide confirmación si la ruta está fuera del workspace |

---

## 8. Qué SÍ se puede hacer hoy

### Editor y lenguaje

- Resaltado completo de C# en `.rsh` **con la gramática propia de la
  extensión** (no depende de que tengas la extensión de C# instalada).
- Resaltado de las construcciones de R#: bloque `#codeGenAI ... #end` y los
  atributos `[Export]`, `[Extern]`, `[WasmExport]`, `[PythonModule]`,
  `[JavaClass]`, `[DllImport]`, `[ForeignAssembly]`, `[RustMacro]`, `[Weak]`,
  `[Borrowed]`, `[Owned]`, `[NoOptimize]`, `[RSharpSugar]`.
- Snippets: `class`, `namespace`, `main`, `export`, `codeGenAI`, `extern`,
  `wasmExport`.
- Autocompletado y diagnóstico de C# REAL si instalas **C# Dev Kit** y activas
  `R#: Toggle C# Language Association for .rsh` (o `files.associations`).
- Reinicio del servidor de Roslyn desde la paleta.

### Proyecto y configuración

- Lectura de `rsharp.toml` (parser TOML propio, sin dependencias): tablas,
  arrays, arrays de tablas, cadenas multilínea, números, booleanos.
- Validación suave: un `rsharp.toml` inválido **no rompe** la extensión; los
  avisos aparecen en el panel de salida y se usan los valores por defecto.
- Prioridad de `rsharp.toml` sobre los ajustes de VSCode (spec §9/§14.4),
  con aviso explícito cuando el fichero manda.
- Aviso si `outputDir` y `distDir` son la misma carpeta (prohibido por §14.4).
- Confirmación si la carpeta elegida está fuera del espacio de trabajo.
- Elección de destino y de perfil desde la UI.

### Construir y ejecutar

- Transpilar, compilar (debug/release), compilar a WASM y ejecutar.
- Traducción de los errores de `rustc` a la línea del `.rsh` mediante source
  maps, con el formato `R# error [E0308]: ...`.
- Traducción de los pánicos en tiempo de ejecución a la línea del `.rsh`.
- Publicación de diagnósticos de R# (`R#0042`, `R#0101`, `R#0150`) en el
  editor, con su ayuda.
- Ejecución en un seudoterminal: la salida se ve en la terminal y se puede
  capturar para detectar pánicos.
- Sesión persistente: los source maps se guardan en
  `target/rsharp/.rsharp-session.json` y sobreviven a un reinicio de VSCode.
- Modo degradado: si la CLI no devuelve JSON o no existe, la extensión sigue
  funcionando y muestra la salida literal en el panel.

### Depuración

- Plantilla de `launch.json` para CodeLLDB.
- Traducción de los puntos de parada de `.rsh` a Rust con los source maps.
- Detección e instalación asistida de CodeLLDB.

### Calidad

- 183 pruebas automáticas (`npm test`), sin dependencias de runtime.
- CLI de simulación (`tools/mock-rsharp.mjs`) para probar todo el flujo sin el
  compilador R#.

---

## 9. Qué NO se puede hacer todavía

| Lo que no funciona | Por qué | Referencia |
|---|---|---|
| **Transpilar sin la CLI `rsharp`** | La extensión es un cliente delgado; el transpilador corre en .NET | spec §4.1, §4.4 |
| **Depurar sin ver Rust** | LLDB no consume source maps de línea como Node con TypeScript; la depuración completa está diferida | spec §14.5 |
| **Puntos de parada exactos en `.rsh`** | Se traducen a la línea de Rust más cercana anterior, no a la exacta | — |
| **Ejecutar un `.wasm` desde la terminal** | Un módulo WASM no es un programa; necesita un host o un navegador | spec §11 |
| **Cargar DLLs dinámicas en WASM** | `wasm32-unknown-unknown` no admite enlace dinámico | spec §11, `R#0150` |
| **Usar `File.ReadAllText` en WASM** | No existe en ese destino; la extensión lo señala con `R#0101` | spec §10 |
| **Hilos en WASM** | El runtime de WASM no los soporta en la v1 | spec §11 |
| **Bloques `#codeGenAI` desde la extensión** | Es una función del compilador; la extensión solo muestra el resultado y sus diagnósticos | spec §8.3 |
| **Python (`[PythonModule]`)** | Rechazado en la v1 del compilador | spec §11, `R#0150` |
| **Host .NET desde Rust** | Fase tardía del proyecto | spec §13, §20 |
| **Plugins** | Fase tardía; el orden se define en `rsharp.toml` | spec §16 |
| **Optimizaciones de programa completo** | Se aplican una a una en fases posteriores; hoy se usa el modo seguro `Rc<RefCell>` | spec §7 |
| **Carga de `rsharp.toml` desde carpetas padre** | Solo se busca en la raíz del workspace | — |
| **Sintaxis definitiva de `#codeGenAI`** | La spec la deja ABIERTA (3 opciones); la gramática resalta las dos formas | spec §8.3, §19.1 |
| **Errores de rustc sin source maps** | Sin source maps no hay traducción: el error se queda en el panel de salida | spec §14.4 |

---

## 10. Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `$(warning) R#` en la barra de estado | No se encuentra la CLI `rsharp` | Instala `RSharp.Cli` o configura `rsharp.cliPath` |
| `Falta .NET SDK (dotnet), necesario para ejecutar la CLI de R#` | `rsharp.cliPath` es una `.dll` y no hay `dotnet` | Instala .NET 8+ o configura `rsharp.dotnetPath` |
| `Falta el toolchain de Rust (cargo), necesario para compilar` | No hay `cargo` en el PATH | Instala rustup o configura `rsharp.cargoPath` |
| `La carpeta de salida y la de distribución son la misma` | `outputDir == distDir` | Cambia una de las dos (spec §14.4) |
| `rsharp.toml define la ruta; se usa ...` | El fichero manda sobre los ajustes | Edítalo o quita el ajuste |
| `No se encontró rsharp.toml en el workspace` | No hay proyecto R# abierto | Crea el `rsharp.toml` en la raíz |
| El error sale en Rust y no en `.rsh` | El compilador no devolvió source maps | Revisa el contrato en [`CLI-CONTRACT.md`](CLI-CONTRACT.md) |
| `La salida de la CLI de R# no es JSON válido` | La CLI no soporta `--json` o escribe logs antes | La extensión funciona en modo degradado; revisa el contrato |
| `La CLI de R# superó el tiempo de espera` | Compilación muy lenta | Normal hasta 10 minutos; si falla, revisa `cargo` |

---

## 11. Probar la extensión sin el compilador R#

El repositorio incluye una CLI de simulación que respeta el mismo contrato y
un **mini-transpilador** (limitado al subconjunto del ejemplo) que genera Rust
real a partir de los `.rsh`:

```bash
cd extension
node tools/mock-rsharp.mjs --version
node tools/mock-rsharp.mjs transpile --project ../examples/rsharp-demo --json
node tools/mock-rsharp.mjs build --project ../examples/rsharp-demo
node tools/mock-rsharp.mjs run --project ../examples/rsharp-demo
```

Para usarla desde VSCode:

```jsonc
// .vscode/settings.json
{
  "rsharp.cliPath": "/ruta/al/repo/extension/tools/mock-rsharp.mjs"
}
```

El proyecto de ejemplo (`examples/rsharp-demo`) tiene su propio arnés de
pruebas, que además hace la **prueba diferencial** de la spec §4.1 (el mismo
código ejecutado por .NET y por Rust debe dar la misma salida):

```bash
npm run demo
```

> El mini-transpilador es un sustituto del compilador `RSharp.Cli`, que aún no
> existe. Cuando exista, la CLI real implementará el contrato de
> [`CLI-CONTRACT.md`](CLI-CONTRACT.md) y este ejemplo pasó a ser la prueba
> diferencial del proyecto.

---

## 12. Documentos relacionados

| Documento | Contenido |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Módulos, capas, flujo de build y de traducción de errores |
| [`CLI-CONTRACT.md`](CLI-CONTRACT.md) | Contrato que debe cumplir la CLI `rsharp` |
| [`../ai/ROADMAP.md`](../ai/ROADMAP.md) | Roadmap completo del proyecto R# |
| [`../ai/TASKS.md`](../ai/TASKS.md) | Backlog de tareas |
| [`../rsharp-spec.md`](../rsharp-spec.md) | Especificación técnica de R# |
