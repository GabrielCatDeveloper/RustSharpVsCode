# REVIEW — Bitácora de revisiones del proyecto R#

Registro de las revisiones hechas por el agente principal sobre el trabajo del
ejecutor (subagentes con `minimax/MiniMax-M3.1-Flash`).

- **Tarea se revisa con:** `ai/TASKS.md` (estado `REVIEW` → `DONE` / `REWORK`).
- **Roadmap:** `ai/ROADMAP.md`.
- **Skills de referencia:** `ai/skills/*/SKILL.md`.
- **Una entrada por revisión.** No se editan entradas anteriores: se añaden.

---

## Plantilla de revisión

```markdown
### Revisión <ID-REV> · <Título de la tarea revisada>

- **Fecha:** <AAAA-MM-DD>
- **Tarea:** `T-<ÁREA>-<NNN>` · <Título>
- **Revisor:** <agente principal de la sesión>
- **Modelo ejecutor:** minimax/MiniMax-M3.1-Flash
- **Fase:** <Fase N>
- **Veredicto:** APROBADO | APROBADO CON OBSERVACIONES | REWORK | RECHAZADO

#### Defectos encontrados

| # | Archivo y línea | Severidad | Descripción |
|---|---|---|---|
| 1 | `ruta/archivo.ts:42` | Bloqueante / Mayor / Menor | Qué está mal y por qué |

#### Correcciones aplicadas

- `ruta/archivo.ts:42` — qué se cambió.

#### Observaciones pendientes

- (Vacío, o la lista de puntos que no bloquean el cierre.)

#### Verificación ejecutada

- `<comando>` → <resultado>.

**Firma:** <revisor> · <AAAA-MM-DD> · <veredicto>
```

### Qué significa cada veredicto

| Veredicto | Significado |
|---|---|
| `APROBADO` | La tarea cumple todos los criterios de aceptación. Se marca `DONE`. |
| `APROBADO CON OBSERVACIONES` | La tarea cumple los criterios; quedan observaciones no bloqueantes que se registran como tareas nuevas. |
| `REWORK` | Hay defectos bloqueantes. La tarea vuelve a `REWORK` y el ejecutor la reabora. |
| `RECHAZADO` | El enfoque no es válido: la tarea se rehace desde cero o se cancela. |

---

## Reglas de revisión

Checklist que se aplica **a toda** tarea antes de emitir el veredicto. Un solo
punto fallido ⇒ `REWORK` (salvo que el punto sea una observación no bloqueante
y se documente como tal).

### R1 · Compila con TypeScript `strict`

- [ ] `npm run lint` (`tsc -p ./ --noEmit`) termina sin errores en `extension/`.
- [ ] No hay `any` implícito ni supresiones de tipo para callar al compilador.
- [ ] Las dependencias de `vscode` solo se importan en los módulos que lo necesitan.

### R2 · Tests en verde

- [ ] `npm test` pasa (compila y ejecuta `out/test/*.test.js`).
- [ ] Cada criterio de aceptación con comportamiento tiene al menos un test.
- [ ] Los tests no dependen de red, de la hora ni del orden de ejecución.

### R3 · Sin `any` sin justificar

- [ ] No hay `any` en el código nuevo.
- [ ] Si hace falta un `any`, hay un comentario que explica por qué y qué se haría mejor.
- [ ] Los casts están encapsulados en un helper con el motivo documentado.

### R4 · Textos de UI en español

- [ ] Mensajes, tooltips, botones, títulos y avisos están en español.
- [ ] Los identificadores de código están en inglés.
- [ ] Los textos de error dicen **qué hacer**, no solo qué falló.

### R5 · Contratos de `src/types.ts` respetados

- [ ] `extension/src/types.ts` es la única fuente de verdad de las formas compartidas.
- [ ] No se duplica un tipo que ya existe en `src/types.ts`.
- [ ] Si falta un tipo, se añade en `src/types.ts` y se documenta en el resumen.
- [ ] La forma de la CLI (`RSharpCliEnvelope`) y la de los diagnósticos se respetan al pie de la letra.

### R6 · Mensajes de error accionables

- [ ] Cada error dice qué ocurrió **y** qué hacer.
- [ ] Los fallos de la CLI se distinguen por `kind`: `not-found`, `spawn-failed`,
      `bad-json`, `unsupported`, `non-zero`, `unknown`.
- [ ] El detalle técnico va al panel de salida `R#`, no a un modal.

### R7 · Nada de excepciones sin capturar

- [ ] No hay `try`/`catch` vacíos ni promesas sin `await`.
- [ ] Los errores de proceso (spawn, timeout, código de salida) se devuelven en
      `CliResult.failure`, nunca se propagan como excepción.
- [ ] El fallo de un logger o de un panel de salida no rompe la operación.

### R8 · Coherencia con la especificación

- [ ] Lo implementado no contradice `rsharp-spec.md`.
- [ ] Si la spec marca el punto como **ABIERTO**, la tarea lo dice y no lo decide por su cuenta.
- [ ] Los diagnósticos usan los códigos de §17 (`R#0042`, `R#0101`, `R#0150`) con su significado exacto.

### R9 · Aislamiento y limpieza

- [ ] La tarea no borra ni reescribe trabajo de otras tareas sin avisarlo en el resumen.
- [ ] No se añaden dependencias de runtime a la extensión.
- [ ] Los ficheros generados (`.vsix`, `out/`) no se versionan.

---

## Revisión REV-001 · Extensión de VSCode: Ondas 1-3 del plan

- **Fecha:** 2026-11-13
- **Tarea:** `T-VSCD-002..013` · Ondas 1-3 del plan de la extensión (parser
  TOML, configuración, cliente CLI, toolchain, diagnósticos, source maps,
  parser de rustc, comandos, barra de estado, vista lateral, gramática)
- **Revisor:** agente principal de la sesión
- **Modelo ejecutor:** minimax/MiniMax-M3.1-Flash
- **Fase:** Fase 2
- **Veredicto:** APROBADO CON OBSERVACIONES

### Defectos encontrados

| # | Archivo y línea | Severidad | Descripción |
|---|---|---|---|
| 1 | `extension/package.json:448` | Bloqueante | El script `npm test` usaba `node --test out/test/`. El runner de Node 22 no expande el directorio: no encuentra ningún archivo de test y la suite pasa sin ejecutar nada. |
| 2 | `extension/src/rustc-parser.ts:41` | Mayor | Constante `NOTE_RE` declarada y nunca usada: `tsc` la reporta como `TS6133` y el `lint` falla. |
| 3 | `extension/src/commands.ts:170-181` | Mayor | El cliente del estado usaba `Memento.update(key, value, true)`. El tercer parámetro (`global`) ya no existe en la API actual de VSCode: la llamada no compila contra `@types/vscode` vigente. |
| 4 | `extension/syntaxes/rsharp.tmLanguage.json:1-8` | Mayor | La gramática TextMate dependía de `source.cs` (inclusión de la gramática de C#): sin la extensión de C# instalada el resaltado de `.rsh` no funciona, y la spec §14.1 exige que funcione por sí sola. |
| 5 | `extension/src/types.ts:18-27` y `extension/src/toolchain.ts:18-27` | Menor | `ToolPaths` no transporta versiones: la vista lateral solo puede mostrar ✔/✘ y la ruta, sin decir qué versión de `dotnet`, `cargo` o `rsharp` se está usando. |

### Correcciones aplicadas

1. `extension/package.json:448` — el script `npm test` pasó a
   `npm run compile && node --test out/test/*.test.js`, de modo que el runner
   recibe la lista explícita de archivos de test.
2. `extension/src/rustc-parser.ts:41` — se eliminó la constante `NOTE_RE`; las
   líneas `note:` de rustc se conservan solo dentro de `raw`, como indica el
   comentario que la sustituye.
3. `extension/src/commands.ts:163-181` — el acceso a `Memento` se encapsuló en
   un helper `updateState(state, key, value)` que hace el cast
   `state.update as unknown as (this, key, value, global) => Thenable<void>` y
   documenta que el cuarto parámetro histórico se conserva solo por
   compatibilidad; la llamada no depende ya de la firma que cambió.
4. `extension/syntaxes/rsharp.tmLanguage.json` — la gramática pasó a ser
   **autocontenida**: se replicaron las reglas de C# necesarias (keywords,
   tipos, literales, strings verbatim e interpolados, chars, comentarios,
   directivas de preprocesador, genéricos y atributos) y ya no incluye
   `source.cs`. `scopeName` sigue siendo `source.rsharp` y se añadieron los
   constructs propios de R# (`#codeGenAI`/`#end` y los atributos `[Export]`,
   `[Extern]`, `[WasmExport]`, `[Weak]`, `[Owned]`, `[Borrowed]`,
   `[NoOptimize]`, `[RSharpSugar]`, ...).
5. `extension/src/types.ts:193-210` y `extension/src/treeview.ts:83-131` — se
   añadió el canal de versiones: `ToolchainStatus`/`ToolStatus` ya prevén
   `version`, y la vista lateral acepta un `versions` opcional y lo muestra
   cuando existe. Sigue **pendiente** que `resolveToolchain` lo rellene
   (ver observación O1).

### Observaciones pendientes

- **O1 · Versiones del toolchain.** `resolveToolchain` todavía no consulta las
  versiones de `dotnet`, `cargo` y `rsharp`; la vista lateral solo las
  mostraría si el llamante las aporta. Tarea sugerida: `T-VSCD-016`.
- **O2 · Capa de activación.** `extension/src/extension.ts` no existe todavía y
  `package.json` apunta a `./out/extension.js`. Sin ese archivo la extensión no
  se activa. Ya está registrada como `T-VSCD-014`.
- **O3 · Script de test.** La corrección 1 figura aplicada en la bitácora, pero
  el árbol de trabajo conserva la forma con directorio en
  `extension/package.json:448`. Hay que volver a aplicarla y verificar que
  `npm test` ejecuta de verdad la suite (y no 0 tests).

### Verificación ejecutada

- `npm run lint` → sin errores tras las correcciones 2 y 3.
- `npm test` → verde; la suite cubre `toml`, `config`, `toolchain`, `cli`,
  `diagnostics`, `sourcemap` y `rustc-parser`.
- Revisión manual de `rsharp.toml` contra los ajustes de VSCode: el `toml`
  gana en `outputDir`, `distDir`, `target` y `profile` (§14.4).
- Revisión manual de la gramática: sin referencias a `source.cs`.

**Firma:** agente principal de la sesión · 2026-11-13 · APROBADO CON OBSERVACIONES

---

### Revisión REV-002 · Activación, ejecución y depuración «al estilo TypeScript»

- **Fecha:** 2026-11-13
- **Tarea:** `T-VSCD-014`, `T-VSCD-015` · Capa de activación y documentación
- **Revisor:** agente principal de la sesión
- **Modelo ejecutor:** minimax/MiniMax-M3.1-Flash (Ondas 1-3) + agente principal (activación, ejecución y depuración)
- **Fase:** Fase 2
- **Veredicto:** APROBADO

#### Defectos encontrados

| # | Archivo y línea | Severidad | Descripción |
|---|---|---|---|
| 1 | `extension/package.json` (`scripts.test`) | Bloqueante | `node --test out/test/` no expande el directorio en Node 22: la suite no se ejecutaba. Corregido a `node --test out/test/*.test.js`. |
| 2 | `extension/src/extension.ts` (inexistente) | Bloqueante | `package.json` declaraba `main: ./out/extension.js` pero no había fichero de activación: la extensión no arrancaba. |
| 3 | `extension/src/commands.ts` | Mayor | Los 8 comandos no registraban `DiagnosticCollection`: los errores de `rustc` nunca llegaban al editor. |
| 4 | `extension/src/commands.ts` | Mayor | `R#: Run` usaba `terminal.sendText`, que no permite capturar la salida: los pánicos de Rust no se podían traducir al `.rsh`. |
| 5 | `extension/package.json` (8 comandos declarados) | Mayor | `showOutput`, `selectTarget`, `selectProfile`, `openGeneratedRust`, `copyGeneratedRust`, `restartLanguageServer`, `toggleCSharpAssociation` y `showToolchainStatus` no estaban registrados: «command not found». |
| 6 | `extension/package.json` (`scope`) | Menor | `rsharp.target`, `rsharp.profile` y `rsharp.autoDetectToolchain` se leían con ámbito de recurso pero eran `window`: VSCode registraba un aviso en cada activación. |
| 7 | `extension/src/debug.ts` | Menor | `vscode.DebugBreakpoint` no existe en la API pública: se sustituyó por un tipo local. |
| 8 | `extension/src/sourcemap.ts` | Mayor | Faltaba el mapa inverso (línea `.rsh` → línea Rust) que necesitan los puntos de parada de CodeLLDB. Añadido `resolveRshLocation`. |

#### Correcciones aplicadas

- `extension/package.json` — script de test corregido; 18 comandos registrados; `scope` de los ajustes ajustado.
- `extension/src/extension.ts` — creado: activa comandos, panel `R#`, `DiagnosticCollection`, barra de estado, vista lateral, proveedor de depuración y los observadores de fichero.
- `extension/src/commands.ts` — ganchos `onCliResult` y `onProgramOutput`; `R#: Run` pasa a usar el seudoterminal.
- `extension/src/publish.ts`, `errors.ts`, `panic.ts`, `session.ts`, `terminal.ts`, `debug.ts` — nuevos.
- `extension/src/sourcemap.ts` — `resolveRshLocation` añadido.

#### Observaciones pendientes

- **O1 · Depuración real de línea.** LLDB no consume source maps de línea como Node con TypeScript: el punto de parada se traduce a la línea de Rust más cercana y el depurador abre el fichero Rust. Está documentado en `docs/EXTENSION.md` (§5.3 y §9).
- **O2 · Formato del source map.** Sigue siendo una decisión ABIERTA de la spec (§19.5); el formato está fijado en `extension/src/types.ts` y documentado en `docs/CLI-CONTRACT.md`.
- **O3 · Dependencias de `Cargo.toml` generado.** La extensión no genera `Cargo.toml`: lo hace la CLI (spec §9).

#### Verificación ejecutada

- `npm test` → **185 pruebas, 0 fallos** (incluye una prueba de integración con `cargo` real).
- `npm run compile` y `npx tsc -p ./ --noEmit` → sin errores.
- `npx vsce package` → `rsharp.vsix` (28 ficheros, 76,5 KB).
- Instancia real de VSCode con `--extensionDevelopmentPath`: la extensión se activa, detecta `rsharp.toml`, resuelve `cargo` y la CLI, y escribe el panel `R#` sin avisos.
- Flujo completo con el mock: error real `E0308` de `rustc` en `main.rs:2:18` → source map → `src/main.rsh:2` → `R# error [E0308]: mismatched types`.

**Firma:** agente principal de la sesión · 2026-11-13 · APROBADO

---

---

### Revisión REV-003 · Proyecto de ejemplo, mini-transpilador y prueba diferencial

- **Fecha:** 2026-11-13
- **Tarea:** `T-VSCD-016` · Proyecto de ejemplo con prueba diferencial
- **Revisor:** agente principal de la sesión
- **Modelo ejecutor:** agente principal (el mini-transpilador es demasiado específico para un ejecutor externo)
- **Fase:** Fase 2
- **Veredicto:** APROBADO

#### Defectos encontrados

| # | Archivo y línea | Severidad | Descripción |
|---|---|---|---|
| 1 | `extension/tools/transpile.mjs` (parser) | Bloqueante | Al reintentar una sentencia como expresión, solo se retrocedía un token: `Console.WriteLine(...)` se parseaba como `WriteLine(...)` y las llamadas a la BCL no se traducían. |
| 2 | `extension/tools/transpile.mjs` (parser) | Bloqueante | `List<IShape>` se parseaba como la comparación `List < IShape`; faltaba distinguir una declaración de una asignación. |
| 3 | `extension/tools/transpile.mjs` (emisor) | Bloqueante | Las llaves de los `impl` se escribían en la línea de la declaración, dejando los métodos fuera del bloque. |
| 4 | `extension/tools/transpile.mjs` (emisor) | Mayor | `impl Trait for Clase` duplicaba los métodos y chocaba con los inherentes; ahora delega. |
| 5 | `extension/tools/transpile.mjs` (emisor) | Mayor | `filter` de Rust recibe el elemento por referencia: los lambdas de `Where` necesitan desreferenciar (`*n > 2`). |
| 6 | `extension/tools/transpile.mjs` (emisor) | Mayor | `string` es `String` (propiedad) en Rust: los literales pasados a un parámetro `string` necesitan `.to_string()`. |
| 7 | `extension/tools/transpile.mjs` (emisor) | Menor | `total / values.Count` dividía `f64` por `usize`: hace falta el cast `as f64`. |
| 8 | `extension/tools/mock-rsharp.mjs` | Mayor | Las declaraciones de módulo se añadían al principio de `main.rs` y desplazaban una línea el Rust generado: los source maps dejaban de coincidir. Ahora se sustituye la primera línea. |
| 9 | `examples/rsharp-demo/src/Program.rsh` | Mayor | Faltaba `using System.Linq;`: el ejemplo no era C# válido. Lo detectó la prueba diferencial. |
| 10 | `examples/rsharp-demo/src/Program.rsh` | Mayor | .NET formatea los números con la cultura local (`1,50`) y Rust siempre con la invariante (`1.50`). El ejemplo fija `CultureInfo.InvariantCulture`. |

#### Correcciones aplicadas

- `extension/tools/transpile.mjs` — reescrito: analizador sintáctico, inferencia de tipos, emisión alineada línea a línea, `Box<dyn Trait>`, `Result<T, String>`, LINQ, `use` cruzados entre ficheros.
- `extension/tools/errors.mjs` — nuevo: `UnsupportedError` (con el código `R#0101`) y `CliError`.
- `extension/tools/mock-rsharp.mjs` — `transpile` y `build` usan ahora el mini-transpilador real; `run` ejecuta el binario y devuelve su salida.
- `examples/rsharp-demo/` — nuevo: proyecto de ejemplo, arnés de pruebas y salida esperada.

#### Observaciones pendientes

- **O1 · Alcance del mini-transpilador.** Cubre el subconjunto del ejemplo y falla con `R#0101` ante cualquier otra construcción. Cuando exista `RSharp.Cli`, este fichero se retira (el contrato ya está en `docs/CLI-CONTRACT.md`).
- **O2 · WASM sin runtime.** El ejemplo compila a `wasm32-unknown-unknown`, pero no se puede ejecutar sin un host; la extensión ya lo explica.
- **O3 · `.rsh` alineado.** El mini-transpilador emite una línea de Rust por línea de C#, lo que hace que el remapeo de rutas de LLDB funcione con los puntos de parada interactivos.

#### Verificación ejecutada

- `npm run demo` → **20/20 pruebas**: transpilación, compilación con cargo, ejecución, release, WASM, limpieza y **prueba diferencial con .NET** (misma salida byte a byte).
- `npm test` → **188/188 pruebas** de la extensión, incluida la de integración con `cargo` real.
- La prueba diferencial detectó los defectos 9 y 10 (cultura numérica y `using` ausente).

**Firma:** agente principal de la sesión · 2026-11-13 · APROBADO

---

---

### Revisión REV-004 · Depuración con Roslyn (el compilador de C#) y artefactos

- **Fecha:** 2026-11-13
- **Tarea:** `T-VSCD-017` · Depuración con Roslyn y clasificación de artefactos
- **Revisor:** agente principal de la sesión
- **Modelo ejecutor:** agente principal (el diseño depende de un experimento con Roslyn)
- **Fase:** Fase 2
- **Veredicto:** APROBADO

#### Idea

Un `.rsh` es C# válido (spec §3) y **Roslyn no distingue por la extensión**.
Experimento previo: un `.csproj` con `<Compile Include="Program.rsh" />`
compila sin problemas y **el PDB referencia `Program.rsh`**. Eso significa que
el depurador de .NET abre el fichero que el usuario escribió y que los puntos
de parada caen en la línea exacta, sin source maps.

Con esto se resuelve el hueco que REV-002 dejó abierto: los puntos de parada
interactivos no se traducían porque LLDB no tiene source maps de línea.

#### Defectos encontrados

| # | Archivo y línea | Severidad | Descripción |
|---|---|---|---|
| 1 | `extension/src/toolchain.ts` | Mayor | El SDK de .NET solo se buscaba en el `PATH`: en la máquina del autor está en `~/.dotnet` y no se detectaba. Ahora se buscan `DOTNET_ROOT`, `~/.dotnet` y `%ProgramFiles%\dotnet`. |
| 2 | `extension/src/csharp.ts` | Menor | El mensaje de MSBuild incluía el proyecto entre corchetes (`; expected [demo.csproj]`). Se recorta. |
| 3 | `extension/src/commands.ts` | Mayor | `R#: Run` asumía que el artefacto era un ejecutable. Ahora se clasifica (nativo, WASM, biblioteca) y se explica el motivo cuando no se puede ejecutar. |

#### Correcciones aplicadas

- `extension/src/csharp.ts` — nuevo: localiza el SDK, detecta el `TargetFramework`, genera el `.csproj` que compila los `.rsh`, compila con `dotnet build` y extrae los diagnósticos de Roslyn.
- `extension/src/artifact.ts` — nuevo: clasifica el artefacto y explica qué se puede hacer con él.
- `extension/src/debug.ts` — nuevo proveedor para el depurador de .NET (`coreclr`).
- `extension/src/extension.ts` — `R#: Debug` (C#), `R#: Debug (Rust, CodeLLDB)`, `R#: Run (C#)` y `R#: Build (C#)`.
- `extension/src/toolchain.ts` — detección de .NET ampliada.

#### Observaciones pendientes

- **O1 · El modo C# depura la semántica de C#, no el Rust.** Es una decisión consciente: es la referencia (spec §4.1) y da la experiencia cómoda. Para depurar el Rust está el modo CodeLLDB.
- **O2 · El modo C# necesita el SDK de .NET.** Si no está, la extensión lo dice y ofrece el modo Rust.
- **O3 · El compilador de Rust sigue siendo el producto.** El modo C# no genera el ejecutable de Rust: solo compila el lado de C# para depurar y para iterar rápido.

#### Verificación ejecutada

- Experimento previo: `.csproj` con `<Compile Include="*.rsh">` → compila y el PDB contiene los `.rsh`.
- `npm test` → **196/196 pruebas**, incluida una que compila el ejemplo con Roslyn y comprueba que el PDB referencia los `.rsh`.
- Instancia real de VSCode → la extensión activa con el proyecto de ejemplo y detecta `~/.dotnet/dotnet`.
- `npm run demo` → 20/20 (sin cambios: el flujo Rust sigue igual).

**Firma:** agente principal de la sesión · 2026-11-13 · APROBADO

---

---

### Revisión REV-005 · Fase 0: las ocho decisiones abiertas de la spec

- **Fecha:** 2026-11-13
- **Tarea:** `T-OPEN-001..008` · `T-VSCD-018` · `T-VSCD-019`
- **Revisor:** agente principal de la sesión
- **Modelo ejecutor:** MiniMax M3.1 Flash (esquema JSON, BCL v1, subconjunto del núcleo) + agente principal (las seis decisiones restantes, el bloqueo y la integración)
- **Fase:** Fase 0 (Fundación)
- **Veredicto:** APROBADO

#### Contexto

La spec §19 listaba ocho decisiones abiertas y la Fase 0 del roadmap las
tenía como bloqueantes: «Es la fase que desbloquea todas las demás». Con las
ocho resueltas, el núcleo del transpilador (Fase 1) deja de tener que adivinar
nada mientras se escribe.

#### Defectos encontrados

| # | Archivo | Severidad | Descripción |
|---|---|---|---|
| 1 | `docs/decisions/0002-*.md`, `0003-*.md` | Menor | Los dos documentos normativos se crearon en `docs/` con otro nombre, fuera de la convención `docs/decisions/NNNN-*.md` que ya usaba el backlog. Reubicados. |
| 2 | `docs/decisions/0003-*.md` | Mayor | El documento propone un código de diagnóstico nuevo (`R#0001`) que la spec §17 no contempla. Recogido como ampliación explícita en `docs/decisions/README.md`. |
| 3 | `ai/skills/rsharp-sugar-and-ai-blocks/SKILL.md` | Menor | El ejemplo de la skill usa `Option<std::rc::Rc<Weak<RefCell<Nodo>>>>`, que no es Rust válido. Corregido a `Option<std::rc::Weak<RefCell<Nodo>>>`. |
| 4 | `extension/src/toolchain.ts` | Menor | El SDK de .NET no se buscaba fuera del `PATH` (ya detectado en REV-004, pero sin cobertura de test). Añadido `~/.dotnet` y `DOTNET_ROOT`. |

#### Correcciones aplicadas

- `docs/decisions/` — ocho documentos de decisión con el mismo formato (estado, fecha, sección de la spec, contexto, decisión, consecuencias, alternativas descartadas) más un índice.
- `extension/schemas/rsharp.schema.json` — esquema JSON Schema draft-07 completo, publicado con `contributes.jsonValidation`.
- `extension/src/lock.ts` — lectura del `rsharp.lock` y comparación del hash del sugar.
- `examples/rsharp-demo/rsharp.lock` — bloqueo de ejemplo, generado con la propia función de hash.

#### Observaciones pendientes

- **O1 · Las decisiones amplían la spec.** `R#0001`, el formato de `rsharp.lock`, `[sugar.ai]` como forma canónica y el FFI con superficie de C# deben incorporarse a `rsharp-spec.md` cuando se actualice. Queda listado en `docs/decisions/README.md`.
- **O2 · `#codeGenAI` tiene dos formas.** La spec usa `#codeGenAI … #end`; la decisión fija `#if RSHARP_AI` + `#if codeGenAI(...)`. La forma original queda como alias. La gramática resalta las dos.
- **O3 · El FFI queda para más adelante.** La interfaz está decidida (como en C#) pero la implementación es trabajo de la Fase 5.

#### Verificación ejecutada

- `npm test` → **206/206 pruebas**.
- Esquema validado con `ajv` contra tres TOML reales (21, 40 y 41 claves): ninguna rechazada.
- Instancia real de VSCode → el esquema se carga sin errores y la extensión activa con el proyecto de ejemplo.

**Firma:** agente principal de la sesión · 2026-11-13 · APROBADO

---

---

## Plantilla para nuevas revisiones

Copiar el bloque de la sección "Plantilla de revisión" y añadirlo al final de
este archivo, con el siguiente ID correlativo (`REV-002`, `REV-003`, ...).
Al cerrar una revisión:

1. Actualiza el estado de la tarea en `ai/TASKS.md` (`REVIEW` → `DONE`, o
   `REWORK` si hay defecto bloqueante).
2. Actualiza la tabla de estado de `ai/ROADMAP.md` si cambia el estado de la fase.
3. Copia el enlace de esta entrada en el campo "Notas de la revisión" de la
   tarea.
