# ROADMAP — Proyecto R# (RSharp)

Roadmap completo del **proyecto R#**, no solo de la extensión de VSCode.

- **Especificación:** `rsharp-spec.md` (raíz del repositorio). Este roadmap la
  traduce a fases y entregables; cuando algo no está decidido en la spec,
  se marca como **ABIERTO** y remite a `§19`.
- **Ejecutor por defecto:** subagentes con modelo `minimax/MiniMax-M3.1-Flash`.
- **Revisor:** agente principal (sesión padre). Revisa cada tarea antes de
  darla por cerrada (ver `ai/REVIEW.md`).
- **Backlog ejecutable:** `ai/TASKS.md`. Cada fase de este roadmap tiene su
  bloque de tareas `T-<ÁREA>-<NNN>`.
- **Skills:** `ai/skills/*/SKILL.md` (guías accionables por área).

## 0. Cómo leer este roadmap

1. Cada fase indica **objetivo**, **entregables**, **dependencias**,
   **criterios de aceptación** y **riesgos**.
2. Los riesgos se citan de `rsharp-spec.md` §18 ("Riesgos conocidos").
3. Lo que la spec marca como **ABIERTO** no se decide aquí: se convierte en
   una tarea `T-OPEN-00N` que hay que resolver antes de desbloquear la fase
   dependiente.
4. El estado de cada fase se resume en la tabla de la sección 1.

---

## 1. Estado por fase

| Fase | Nombre | Estado | Progreso | Tareas |
|---|---|---|---|---|
| 0 | Fundación | **In progress** | Spec y decisiones abiertas identificadas; falta cerrar §19 | `T-FND-001..006`, `T-OPEN-001..008` |
| 1 | Núcleo del transpilador | **Todo** | Sin implementar | `T-CORE-001..016` |
| 2 | Extensión de VSCode | **In progress** | Ondas 1-3 revisadas y aprobadas; falta capa de activación y documentación | `T-VSCD-001..015` |
| 3 | BCL por destino | **Todo** | — | `T-BCL-001..006` |
| 4 | Destino WASM | **Todo** | — | `T-WASM-001..005` |
| 5 | Bindings de crates y FFI | **Todo** | — | `T-FFI-001..009` |
| 6 | Optimizaciones | **Todo** | — | `T-OPT-000..015` |
| 7 | Plugins, sugar y `#codeGenAI` | **Todo** | — | `T-PLG-001..004`, `T-SUGAR-001..005`, `T-AI-001..005` |
| 8 | Python y host .NET | **Todo** | — | `T-PY-001..006` |
| 9 | Depuración completa (CodeLLDB) | **Todo** | — | `T-DBG-001..004` |

**Leyenda:** `Done` = entregables aceptados y criteria cumplidos · `In progress` =
en curso, con partes aceptadas · `Todo` = sin empezar.

Detalle del estado interno de la Fase 2 (la única con trabajo real hoy):

| Entregable de Fase 2 | Estado |
|---|---|
| Parser de `rsharp.toml` (`src/toml.ts`) | Done |
| Resolución de configuración (`src/config.ts`) | Done |
| Descubrimiento del toolchain (`src/toolchain.ts`) | Done |
| Cliente de la CLI (`src/cli.ts`) | Done |
| Diagnósticos (`src/diagnostics.ts`) | Done |
| Source maps (`src/sourcemap.ts`) | Done |
| Parser de `rustc` (`src/rustc-parser.ts`) | Done |
| Comandos (`src/commands.ts`) | Done |
| Barra de estado (`src/statusbar.ts`) | Done |
| Vista lateral (`src/treeview.ts`) | Done |
| Gramática TextMate (`syntaxes/rsharp.tmLanguage.json`) | Done |
| Snippets (`snippets/rsharp.json`) | Done |
| Capa de activación (`src/extension.ts`) | Todo |
| Documentación (README, CHANGELOG, LICENSE, `docs/EXTENSION.md`) | Todo |

---

## 2. Fase 0 — Fundación

**Objetivo.** Convertir la especificación en artefactos verificables: esquema
de configuración, formato del source map, lista cerrada de tipos de la BCL,
subconjunto de C# del núcleo, formato de `rsharp.lock` y estrategia de
pruebas diferenciales. Resolver las 8 decisiones abiertas de §19.

**Entregables.**
- Esquema JSON de `rsharp.toml` (spec §9, §19.6) y validador.
- Formato del source map (spec §19.5) alineado con `RSharpSourceMap` de
  `extension/src/types.ts`.
- Lista cerrada de tipos de `System.*` de la v1 (spec §10, §19.2).
- Subconjunto exacto de C# del núcleo v1 (spec §8.1, §19.3).
- Formato de `rsharp.lock`: hashes de sugar, de API de crates y de librerías
  (spec §3, §9, §12, §13).
- Sintaxis final de `[Weak]`, `[Borrowed]` y `[Owned]` (spec §19.4).
- Harness de pruebas diferenciales .NET ↔ Rust (spec §4.1, §19.8).

**Dependencias.** Ninguna. Es la fase que desbloquea todas las demás.

**Criterios de aceptación.**
- Las 8 decisiones de §19 tienen una respuesta escrita y firmada, o una
  tarea que las implementa (`T-OPEN-001..008` en `ai/TASKS.md`).
- El esquema JSON valida el `rsharp.toml` de ejemplo de la spec §9 sin
  errores y rechaza claves desconocidas con un mensaje accionable.
- El formato del source map es el mismo que consume `src/sourcemap.ts` de la
  extensión (sin cambios en el contrato de `src/types.ts`).
- Existe un proyecto de pruebas que ejecuta el mismo caso en .NET y en Rust y
  compara salidas.

**Riesgos (§18).** "El núcleo debe ser estable. Cambiarlo rompe los plugins":
fijar el subconjunto de C# antes de escribir el transpilador evita romper los
plugins después. "Los source maps deben ser precisos": un formato improvisado
en la Fase 2 obliga a migrar diagnósticos en la Fase 9.

---

## 3. Fase 1 — Núcleo del transpilador

**Objetivo.** Implementar `RSharp.Attributes`, `RSharp.Runtime`,
`RSharp.Compiler`, `RSharp.Analyzers` y `RSharp.Cli` según §4.2 y el orden de
construcción de §20, empezando por el **modo seguro** (`Rc<RefCell>`).

**Entregables.**
- `RSharp.Attributes` (netstandard2.0): `[Export]`, `[Extern]`, `[WasmExport]`,
  `[DllImport]`, `[ForeignAssembly]`, `[PythonModule]`, `[JavaClass]`,
  `[RustMacro]`, `[Weak]`, `[Borrowed]`, `[Owned]`, `[NoOptimize]`,
  `[RSharpSugar]`.
- `RSharp.Runtime` (netstandard2.0): tipos de apoyo.
- `RSharp.Compiler` (netstandard2.0): referencia a Roslyn; **sin** `System.IO`,
  red ni reloj (§4.2); recibe texto y devuelve texto.
- `RSharp.Analyzers` (netstandard2.0): rechazan lo que el núcleo no soporta.
- `RSharp.Cli` (net8.0): `transpile`, `build`, `run`, `clean`, `bind`, con
  salida `--json` compatible con `RSharpCliEnvelope`.
- Mapeo de C# a Rust de §5, con las reglas de `struct` (§5.1) y el resto de
  reglas del núcleo (§5.2).
- API pública `Transpiler.Run` (§4.3) con diagnósticos y source maps.

**Dependencias.** Fase 0 (subconjunto de C#, formato de source map, esquema).

**Criterios de aceptación.**
- Un `.rsh` de cada construcción de §5 se transpila a Rust que compila con
  `cargo build`.
- El núcleo **rechaza con error** lo que no soporta (§8.1), nunca lo ignora
  en silencio (§2.7).
- `RSharp.Compiler` no importa `System.IO`, `System.Net` ni reloj: verificable
  con un analizador de referencias de ensamblado.
- Dos ejecuciones sobre la misma entrada producen **el mismo** texto Rust
  (§2.4).
- La salida `--json` de la CLI valida contra `RSharpCliEnvelope`.

**Riesgos (§18).** "Roslyn y .NET deben estar instalados para transpilar":
el CLI debe dar un mensaje accionable si falta el SDK. "El núcleo debe ser
estable": cada construcción entra con pruebas antes de pasar a la siguiente.

---

## 4. Fase 2 — Extensión de VSCode

**Objetivo.** Cliente delgado de VSCode (spec §14.1) que ejecuta `dotnet` para
transpilar y `cargo` para compilar, con comandos, gramática, diagnósticos,
source maps, ejecución y depuración básica.

**Entregables.**
- Comandos de §14.2 con sus identificadores exactos: `rsharp.transpile`,
  `rsharp.build`, `rsharp.buildRelease`, `rsharp.buildWasm`, `rsharp.run`,
  `rsharp.clean`, `rsharp.chooseOutputFolder`, `rsharp.chooseDistFolder`.
- `rsharp.toml` con prioridad sobre los ajustes de VSCode (§14.4).
- Source maps: los errores de `rustc` se traducen a líneas `.rsh` (§14.4).
- Gramática TextMate autocontenida para `.rsh` (`scopeName: source.rsharp`).
- `src/types.ts` como contrato único entre módulos.
- Barra de estado, vista lateral, panel de salida `R#` y capa de activación.

**Dependencias.** Fase 2 depende de la Fase 1 solo para **probar** contra la
CLI real; el desarrollo de la extensión es paralelo (ya está en marcha).

**Criterios de aceptación.**
- `npm run lint` (tsc `strict`) sin errores y `npm test` en verde.
- `rsharp.toml` gana a los ajustes de VSCode; `outputDir !== distDir` siempre
  (§14.4).
- Las rutas fuera del workspace requieren confirmación (§14.4).
- Todo diagnóstico de Rust se ancla en la línea del `.rsh`, no en la del
  `.rs` (§17).
- El usuario **nunca** ve el Rust transpilado salvo por acción explícita.

**Riesgos (§18).** "Los source maps deben ser precisos": depende del formato
cerrado en la Fase 0. "Roslyn y .NET deben estar instalados": la extensión
debe degradar sin romper.

---

## 5. Fase 3 — Biblioteca estándar (BCL) por destino

**Objetivo.** Soportar una **lista cerrada** de tipos de `System.*`, con el
mapeo dependiente del `target` (spec §10).

**Entregables.**
- Lista inicial: `List<T>`, `Dictionary<K,V>`, `string`, `Math`, `Console`,
  `File` (spec §10).
- Analizador Roslyn que rechaza tipos fuera de la lista.
- Tabla de destinos nativo / WASM navegador, con `R#0101` cuando una API no
  existe en el destino.
- Procedimiento documentado para **crecer** la lista en cada versión.

**Dependencias.** Fase 1 (para emitir código) y Fase 0 (lista cerrada,
`T-OPEN-002`).

**Criterios de aceptación.**
- `Console.WriteLine` → `println!` en nativo y `console.log` vía `web-sys` en
  WASM.
- `File.ReadAllText` → `std::fs::read_to_string` en nativo y **rechazado** en
  `wasm32-unknown-unknown` con `R#0101`.
- `Thread.Sleep` → `std::thread::sleep` en nativo y **rechazado** en WASM.
- Cada API fuera de la lista produce un diagnóstico que dice qué hacer.

**Riesgos (§18).** "Las bibliotecas NuGet de terceros no tienen versión Rust":
esta fase solo cubre `System.*`; lo demás pasa a la Fase 5.

---

## 6. Fase 4 — Destino WASM

**Objetivo.** Compilar el mismo `.rsh` a `.wasm` siguiendo §11 (y §4.4: el
transpilador **no** corre en WASM).

**Entregables.**
- Activación por `build.target` en `rsharp.toml`.
- `[WasmExport]` → `#[wasm_bindgen]`.
- `string` cruza el límite como `String`; las clases exportadas usan una
  estructura envoltorio (`Rc<RefCell>` no es válido en el borde).
- `async` con `wasm-bindgen-futures`.
- `panic` con `console_error_panic_hook`.
- `[PythonModule]` rechazado en la v1 con `R#0150`.
- Destino `wasm32-wasip1` con enlace estático.

**Dependencias.** Fase 3 (el mapeo BCL depende del destino) y Fase 1.

**Criterios de aceptación.**
- `rsharp build --target wasm32-unknown-unknown` produce un `.wasm` que
  carga en un navegador y llama a una función `[WasmExport]`.
- Las clases exportadas no usan `Rc<RefCell>` en el borde.
- Los hilos están rechazados en la v1 con un diagnóstico explicativo.
- Las DLL dinámicas producen `R#0150`.

**Riesgos (§18).** "Compilar Rust grande tarda": el destino WASM duplica el
trabajo de compilación. La diferencia de casos límite con .NET (UTF-16,
desbordamiento) puede aparecer aquí.

---

## 7. Fase 5 — Bindings de crates y FFI

**Objetivo.** Abrir R# al ecosistema Rust y a librerías externas (§12, §13).

**Entregables.**
- Tres fuentes de bindings: manual con `[Extern("ruta::del::item")]`,
  generado con `rsharp bind <crate>` desde el JSON de `rustdoc`, y paquetes
  NuGet preenlazados (§12).
- Tabla de equivalencias Rust ↔ R# de §12 (`Option<T>`↔`T?`,
  `Result<T,E>`↔excepción, `&str`/`String`↔`string`, `&[T]`/`Vec<T>`↔
  `Span<T>`/`List<T>`, `trait`↔`interface`, etc.).
- Bindings en `bindings/`, hash de la API de cada crate en `rsharp.lock`,
  verificación con `cargo check` (§12).
- FFI: `[DllImport]` → `extern "C"` + `libloading`; `rsharp bind --c lib.h` →
  `bindgen`; `[ForeignAssembly]` → `netcorehost`; `[PythonModule]` → `pyo3`;
  `[JavaClass]` → `jni` (§13).
- Reglas del límite: copiar `string`, `[Owned]`/`[Borrowed]`, callbacks
  `extern "C" fn` con contexto, `unsafe` en llamadas nativas, GIL en Python,
  hashes en `rsharp.lock`.

**Dependencias.** Fases 1, 3 y 4 (el destino decide si un crate es
aceptable).

**Criterios de aceptación.**
- `using Rand; new ThreadRng(); rng.NextInt(1, 100);` se transpila y compila.
- Un crate con `unsafe` o FFI se rechaza salvo bloque `unsafe` explícito.
- Un crate sin soporte `wasm32` se rechaza en ese destino.
- Los punteros devueltos se marcan con `[Owned]` o `[Borrowed]`.
- Una DLL nativa exige un binario por plataforma.

**Riesgos (§18).** "Las bibliotecas NuGet de terceros no tienen versión Rust":
los bindings se fijan por versión y por hash. El flujo de `rsharp bind` por
origen es una decisión **ABIERTA** (`T-OPEN-007`).

---

## 8. Fase 6 — Optimizaciones

**Objetivo.** Implementar los 15 pasos de §7, **uno por tarea**, sin cambiar
la semántica observable del programa.

**Entregables.**
- Infraestructura: grafo de llamadas, flujo de datos, análisis de escape y de
  aliasing (§7 "Requisitos").
- Los 15 pasos: escape, último uso, aliasing, hilos, desvirtualización,
  `sealed`, arena, strings, aritmética, LINQ, bucles, async, excepciones,
  layout y eventos.
- `[NoOptimize]` para desactivar pasos en un método.
- Modo seguro como referencia; el modo optimizado se compara contra él (§7).

**Dependencias.** Fase 1 (el núcleo debe estar estable antes de optimizar).

**Criterios de aceptación.**
- El mismo programa se ejecuta en modo seguro y en modo optimizado con
  **la misma salida** (comparación byte a byte en las pruebas diferenciales).
- `[NoOptimize]` devuelve un método al modo seguro.
- Cada paso tiene su propia tarea, su propio test y su propio veredicto de
  revisión.

**Riesgos (§18).** "Un análisis de optimización incorrecto genera Rust
inseguro": cada paso entra solo con el test de equivalencia en verde, y el
`[NoOptimize]` ofrece una salida de emergencia.

---

## 9. Fase 7 — Plugins, sugar y `#codeGenAI`

**Objetivo.** Añadir las extensiones que el núcleo no cubre, con las
condiciones de §8.

**Entregables.**
- Plugins (§16): declaran las construcciones que reescriben, las que producen,
  su coste (rendimiento, tamaño, tokens) y sus dependencias; orden explícito
  en `rsharp.toml`; cada plugin exige pruebas propias; la optimización de
  programa completo corre **después** de los plugins.
- Sugar (§8.2): apagado por defecto; cada concesión queda visible en el
  código o en `rsharp.toml`; aviso `R#0042` cuando el código exige un sugar
  apagado (p. ej. `usa [Weak] en este campo o activa #codeGenAI`).
- `#codeGenAI` (§8.3): la IA actúa solo dentro del bloque; el resultado y su
  hash se guardan en `rsharp.lock`; se regenera solo si cambia el hash; el
  resultado debe compilar con `rustc`; se muestra el coste en tokens antes de
  generar; el bloque queda visible como contrato; se rechaza si el proyecto no
  lo habilita; modelo local por defecto (Ollama en `localhost`) con URL
  remota opcional.

**Dependencias.** Fase 1 (núcleo), Fase 6 (los plugins se ejecutan antes de
optimizar) y `T-OPEN-001` (sintaxis de `#codeGenAI` compatible con Roslyn).

**Criterios de aceptación.**
- Un plugin externo reescribe una construcción del núcleo a núcleo y sus
  pruebas pasan.
- Con sugar apagado, el código que exige `[Weak]` produce `R#0042` con el
  texto del aviso.
- Con `#codeGenAI` habilitado, el bloque se regenera **solo** si cambia el
  hash, y el resultado se compila con `rustc`.
- El núcleo **no** usa IA (§8.1).

**Riesgos (§18).** "Dos plugins pueden reescribir la misma construcción": el
orden es explícito y el analizador avisa. La sintaxis de `#codeGenAI` es una
decisión **ABIERTA** (`T-OPEN-001`): las tres opciones de §8.3 deben quedar
evaluadas antes de implementar.

---

## 10. Fase 8 — Python y host .NET

**Objetivo.** Interoperabilidad con Python y con .NET desde el programa
generado (§13), en el orden C → Python → host .NET.

**Entregables.**
- Python: `[PythonModule]` → `pyo3`; el GIL se toma en cada llamada; los
  errores de Python se convierten a `Result`; se leen stubs `.pyi`; sin stubs
  se usa `#codeGenAI`.
- Host .NET: `[ForeignAssembly]` → `netcorehost`; metadatos con
  `System.Reflection.Metadata`; exige .NET instalado.
- Rutas de una DLL de .NET: 1) transpilar el código R# (mejor opción),
  2) NativeAOT con exportaciones C, 3) host .NET desde Rust.
- Hash de cada librería en `rsharp.lock`.

**Dependencias.** Fase 5 (FFI) y Fase 4 (WASM, donde `[PythonModule]` se
rechaza en la v1 con `R#0150`).

**Criterios de aceptación.**
- Un módulo Python se importa y se llama desde `.rsh` con el GIL tomado.
- Un error de Python llega al código R# como excepción (no como `panic`).
- Una DLL de .NET se carga y se llama desde Rust.
- El hash de cada librería cambia cuando cambia la versión.

**Riesgos (§18).** "Una DLL nativa exige un binario por plataforma": la
distribución multiplataforma se documenta por librería. El orden de soporte
de §13 (C, luego Python, luego host .NET) es obligatorio.

---

## 11. Fase 9 — Depuración completa con CodeLLDB

**Objetivo.** Depurar el programa generado con CodeLLDB y **source maps**, de
modo que los breakpoints caigan en las líneas del `.rsh` (§14.5).

**Entregables.**
- Integración con CodeLLDB usando los source maps del compilador.
- `launch.json` de ejemplo para un proyecto R#.
- Breakpoints, ejecución paso a paso y pila de llamadas traducidos a `.rsh`.
- Mensajes accionables cuando el símbolo no se puede traducir.

**Dependencias.** Fases 1, 2 (source maps) y 4/5 (destinos y librerías).

**Criterios de aceptación.**
- Un breakpoint en una línea del `.rsh` se detiene en esa línea.
- La pila de llamadas muestra archivos `.rsh`.
- Un error sin source map no rompe la sesión de depuración.

**Riesgos (§18).** "Los source maps deben ser precisos": es la fase que más
sufre de un formato flojo (Fase 0). La spec §14.5 ya la marca como
"posterior": no bloquea las fases anteriores.

---

## 12. Orden de construcción (§20) y correspondencia con las fases

| §20 | Paso | Fase |
|---|---|---|
| 1 | Definir el subconjunto de C# del núcleo v1 | 0 (`T-OPEN-003`) |
| 2 | `RSharp.Attributes` y `RSharp.Analyzers` | 1 (`T-CORE-002`, `T-CORE-003`) |
| 3 | `RSharp.Compiler` en modo seguro (`Rc<RefCell>`) | 1 (`T-CORE-005..015`) |
| 4 | `RSharp.Cli` con `transpile` y `build` | 1 (`T-CORE-014`) |
| 5 | `rsharp.toml`, `rsharp.lock` y source maps | 0-1 (`T-FND-004`, `T-FND-005`) |
| 6 | Extensión de VSCode con los comandos | 2 (`T-VSCD-008`) |
| 7 | Mapeo de la BCL por destino | 3 (`T-BCL-001..006`) |
| 8 | Destino WASM | 4 (`T-WASM-001..005`) |
| 9 | Bindings de crates y FFI de C | 5 (`T-FFI-001..009`) |
| 10 | Optimizaciones, una por una | 6 (`T-OPT-001..015`) |
| 11 | Plugins, sugar y `#codeGenAI` | 7 (`T-PLG-*`, `T-SUGAR-*`, `T-AI-*`) |
| 12 | Python y host .NET | 8 (`T-PY-001..006`) |
| 13 | Depuración | 9 (`T-DBG-001..004`) |

## 13. Decisiones abiertas que bloquean fases

| Decisión (§19) | Tarea | Bloquea |
|---|---|---|
| 1. Sintaxis de `#codeGenAI` compatible con Roslyn | `T-OPEN-001` | Fase 7 |
| 2. Lista exacta de tipos de la BCL v1 | `T-OPEN-002` | Fase 3 |
| 3. Subconjunto exacto de C# del núcleo v1 | `T-OPEN-003` | Fase 1 |
| 4. Sintaxis de `[Weak]`, `[Borrowed]`, `[Owned]` | `T-OPEN-004` | Fase 7 |
| 5. Formato del source map | `T-OPEN-005` | Fases 1, 2 y 9 |
| 6. Esquema JSON completo de `rsharp.toml` | `T-OPEN-006` | Fase 1 |
| 7. Flujo de `rsharp bind` por cada origen | `T-OPEN-007` | Fase 5 |
| 8. Estrategia de pruebas diferenciales .NET ↔ Rust | `T-OPEN-008` | Fases 1 y 6 |
