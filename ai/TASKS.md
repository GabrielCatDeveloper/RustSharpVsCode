# TASKS — Backlog ejecutable del proyecto R#

Backlog vivo del proyecto R#. Cada tarea es autocontenida y ejecutable por un
subagente con modelo `minimax/MiniMax-M3.1-Flash`, y se cierra con la revisión
del agente principal (ver `ai/REVIEW.md`).

- **Fuente de verdad del diseño:** `rsharp-spec.md` (raíz del repositorio).
- **Roadmap:** `ai/ROADMAP.md` (fases 0 a 9).
- **Skills:** `ai/skills/<área>/SKILL.md` (procedimiento concreto del área).
- **Reglas de la revisión:** `ai/REVIEW.md` §"Reglas de revisión".

## Estados

| Estado | Significado |
|---|---|
| `TODO` | No empezada. |
| `WIP` | En curso por el ejecutor. |
| `REVIEW` | Implementada; esperando veredicto del revisor. |
| `DONE` | Aceptada por el revisor. |
| `REWORK` | Devuelta con defectos: el ejecutor vuelve a la tarea. |
| `BLOCKED` | Bloqueada por una decisión abierta (`T-OPEN-*`) o por otra tarea. |

## Reglas para el ejecutor

1. Lee `rsharp-spec.md` (la sección que indica la tarea) antes de escribir
   código. No inventes reglas que contradigan la spec.
2. Si algo está **ABIERTO** en la spec, no lo decidas: deja un `TODO` explícito
   y referencia la decisión abierta correspondiente.
3. Identificadores de código en inglés; comentarios y textos de UI en español.
4. Nada de `any` sin justificación escrita; nada de excepciones sin capturar;
   nada de `console.log` en la extensión (se usa el `OutputChannel` inyectado).
5. Cada tarea entrega código compilando y, cuando aplique, sus pruebas en
   verde.
6. No borres ni reescribas trabajo de otras tareas sin avisar en el resumen.
7. Los identificadores de código en inglés; la documentación de las skills en
   español.

---

# Fase 0 — Fundación

### T-FND-001 · Andamiaje de la solución RSharp.*
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 0
- **Depende de:** —
- **Objetivo:** Crear la solución con los cinco proyectos de §4.2 con los TFM correctos.
- **Archivos:** `src/RSharp.sln`, `src/RSharp.Attributes/RSharp.Attributes.csproj`, `src/RSharp.Runtime/RSharp.Runtime.csproj`, `src/RSharp.Compiler/RSharp.Compiler.csproj`, `src/RSharp.Analyzers/RSharp.Analyzers.csproj`, `src/RSharp.Cli/RSharp.Cli.csproj`
- **Criterios de aceptación:**
  - `RSharp.Attributes`, `RSharp.Runtime`, `RSharp.Compiler` y `RSharp.Analyzers` apuntan a `netstandard2.0`; `RSharp.Cli` a `net8.0`.
  - `dotnet build src/RSharp.sln` termina sin errores ni advertencias.
  - `RSharp.Compiler` no referencia `System.IO`, `System.Net` ni `System.DateTime` (comprobable con el analizador de referencias de ensamblado).
  - `RSharp.Attributes` está preparado para publicarse como paquete NuGet (`dotnet pack` funciona).
- **Notas de la revisión:** —

### T-FND-002 · Trazabilidad entre la spec y las tareas
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 0
- **Depende de:** T-FND-001
- **Objetivo:** Dejar cada sección de la spec enlazada con la tarea que la implementa.
- **Archivos:** `docs/TRACEABILITY.md`, `ai/ROADMAP.md`
- **Criterios de aceptación:**
  - Existe una fila por cada sección de `rsharp-spec.md` (§1 a §20) con la tarea que la cubre o la marca "sin tarea".
  - Las secciones sin cobertura quedan justificadas en una frase.
  - `ai/ROADMAP.md` §12 y este archivo no se contradicen.
- **Notas de la revisión:** —

### T-FND-003 · Esquema JSON de `rsharp.toml`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 0
- **Depende de:** T-OPEN-006
- **Objetivo:** Definir y validar el esquema JSON completo de la configuración (spec §9, §19.6).
- **Archivos:** `schema/rsharp.schema.json`, `src/RSharp.Compiler/Configuration/RSharpConfigSchema.cs`
- **Criterios de aceptación:**
  - El esquema valida el `rsharp.toml` de ejemplo de §9 sin errores.
  - Una clave desconocida se rechaza con un mensaje que nombra la clave y el archivo.
  - `schema` distinto de `1` produce aviso, no error.
  - Las claves que sobrescriben por archivo y por método (`[assembly: RSharpSugar]`) están descritas en el esquema.
- **Notas de la revisión:** —

### T-FND-004 · Formato de `rsharp.lock`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 0
- **Depende de:** T-OPEN-005
- **Objetivo:** Definir el archivo de bloqueo con hashes de sugar, de API de crates y de librerías (spec §3, §9, §12, §13).
- **Archivos:** `schema/rsharp.lock.schema.json`, `src/RSharp.Compiler/Locking/LockFile.cs`
- **Criterios de aceptación:**
  - Guarda el hash de la configuración de sugar (spec §9) y el hash de cada crate y cada librería.
  - Un cambio de valor invalida solo los bloqueos afectados.
  - El formato es determinista: el mismo estado produce el mismo archivo byte a byte.
  - `rsharp.lock` se confirma en git (spec §3).
- **Notas de la revisión:** —

### T-FND-005 · Harness de pruebas diferenciales .NET ↔ Rust
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 0
- **Depende de:** T-OPEN-008
- **Objetivo:** Montar el banco de pruebas que ejecuta el mismo caso en .NET y en Rust y compara salidas (spec §4.1, §19.8).
- **Archivos:** `tests/Differential/DifferentialRunner.cs`, `tests/Differential/cases/*.rsh`, `tests/Differential/cases/*.cs`
- **Criterios de aceptación:**
  - Un caso se ejecuta en .NET y en el Rust generado y se comparan las salidas.
  - Los casos límite de UTF-16, desbordamiento y reentrada están cubiertos (§6.2).
  - Un fallo de equivalencia informa del caso y de ambas salidas.
  - La suite es determinista y no depende de red.
- **Notas de la revisión:** —

### T-FND-006 · Pipeline de CI
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 0
- **Depende de:** T-FND-001
- **Objetivo:** Automatizar build, tests y empaquetado de la extensión y de la solución.
- **Archivos:** `.github/workflows/ci.yml`, `.github/workflows/extension.yml`
- **Criterios de aceptación:**
  - El workflow compila la solución .NET y ejecuta los tests.
  - El workflow ejecuta `npm run lint` y `npm test` de la extensión.
  - El workflow produce el `.vsix` como artefacto.
  - Falla si hay errores de compilación o tests rojos.
- **Notas de la revisión:** —

---

# Fase 0 — Decisiones abiertas (spec §19)

> Estas tareas no son de código: son decisiones que **desbloquean** fases. Cada
> una escribe un documento corto en `docs/decisions/` y actualiza la spec.

### T-OPEN-001 · Sintaxis de `#codeGenAI` compatible con Roslyn
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 0
- **Depende de:** —
- **Objetivo:** Elegir entre las tres opciones de §8.3 la sintaxis final del bloque con IA.
- **Archivos:** `docs/decisions/0001-codeGenAI-syntax.md`, `rsharp-spec.md`
- **Criterios de aceptación:**
  - El documento evalúa las tres opciones: `#if RSHARP_AI`/`#endif`, atributo sobre el método y preprocesado de `.rsh` antes de Roslyn.
  - Justifica la opción elegida con criterios de Roslyn, IntelliSense y herramientas.
  - La spec deja de marcar este punto como ABIERTO y apunta a la decisión.
  - El bloque sigue siendo visible como contrato en el código (spec §8.3).
- **Notas de la revisión:** —

### T-OPEN-002 · Lista exacta de tipos de la BCL v1
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 0
- **Depende de:** —
- **Objetivo:** Fijar la lista cerrada de tipos de `System.*` de la v1 (spec §10, §19.2).
- **Archivos:** `docs/decisions/0002-bcl-v1-types.md`, `rsharp-spec.md`
- **Criterios de aceptación:**
  - Lista los tipos y miembros concretos: `List<T>`, `Dictionary<K,V>`, `string`, `Math`, `Console`, `File`.
  - Para cada tipo indica el destino nativo y el destino WASM (soportado o no).
  - Documenta cómo crece la lista en cada versión (spec §10).
  - La spec deja de marcar este punto como ABIERTO.
- **Notas de la revisión:** —

### T-OPEN-003 · Subconjunto exacto de C# del núcleo v1
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 0
- **Depende de:** —
- **Objetivo:** Enumerar las construcciones de C# que el núcleo v1 soporta y las que rechaza (spec §8.1, §19.3).
- **Archivos:** `docs/decisions/0003-core-v1-subset.md`, `rsharp-spec.md`
- **Criterios de aceptación:**
  - La lista cubre, como mínimo, lo de §8.1: `struct`, `class`, `enum`, `interface`, genéricos, herencia, `virtual`/`override`, sobrecarga, argumentos opcionales, eventos, delegados, excepciones, conversiones implícitas, `partial`, `async`/`await`, hilos, `unsafe` y punteros.
  - Cada construcción fuera de la lista tiene una regla de rechazo (error, no silencio).
  - La spec deja de marcar este punto como ABIERTO.
- **Notas de la revisión:** —

### T-OPEN-004 · Sintaxis de `[Weak]`, `[Borrowed]` y `[Owned]`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 0
- **Depende de:** —
- **Objetivo:** Definir la sintaxis y el significado exactos de los tres atributos de ciclo de vida (spec §12, §13, §19.4).
- **Archivos:** `docs/decisions/0004-lifetime-attributes.md`, `rsharp-spec.md`
- **Criterios de aceptación:**
  - Define la sintaxis, el ámbito (campo, parámetro, retorno) y el efecto exacto de cada atributo.
  - `[Weak]` rompe los ciclos con `Weak`; `[Borrowed]` no libera; `[Owned]` libera en el destino.
  - Fija el texto del aviso `R#0042` asociado (spec §8.2).
  - La spec deja de marcar este punto como ABIERTO.
- **Notas de la revisión:** —

### T-OPEN-005 · Formato del source map
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 0
- **Depende de:** —
- **Objetivo:** Fijar el formato del source map que consume la extensión (spec §14.4, §19.5).
- **Archivos:** `docs/decisions/0005-source-map-format.md`, `rsharp-spec.md`
- **Criterios de aceptación:**
  - El formato encaja con `RSharpSourceMap` / `RSharpSourceMapEntry` de `extension/src/types.ts` sin cambiar ese contrato.
  - Cubre archivos Rust generados y archivos `.rsh` de origen, con líneas 1-based.
  - Define la granularidad mínima (línea) y si se admite columna.
  - La spec deja de marcar este punto como ABIERTO.
- **Notas de la revisión:** —

### T-OPEN-006 · Esquema JSON completo de `rsharp.toml`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 0
- **Depende de:** —
- **Objetivo:** Cerrar el esquema completo de la configuración (spec §9, §19.6).
- **Archivos:** `docs/decisions/0006-rsharp-toml-schema.md`, `rsharp-spec.md`
- **Criterios de aceptación:**
  - Cubre `[project]`, `[paths]`, `[build]`, `[sugar]`, `[sugar.ai]`, `[plugins]`, `[dependencies]`, `[foreign.*]` y `[profile.<nombre>.sugar]`.
  - Define los valores admitidos y los por defecto de cada clave.
  - La clave de API del proveedor de IA "vive en una variable de entorno" (spec §9): se documenta el nombre.
  - La spec deja de marcar este punto como ABIERTO.
- **Notas de la revisión:** —

### T-OPEN-007 · Flujo de `rsharp bind` por cada origen
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 0
- **Depende de:** —
- **Objetivo:** Definir el flujo de generación de bindings para cada origen (spec §12, §13, §19.7).
- **Archivos:** `docs/decisions/0007-bind-flow.md`, `rsharp-spec.md`
- **Criterios de aceptación:**
  - Cubre los tres orígenes de §12: manual con `[Extern]`, generado desde el JSON de `rustdoc` y paquetes NuGet preenlazados.
  - Cubre los cuatro orígenes de §13: C, Python, .NET y Java.
  - Define qué se guarda en `bindings/`, qué hash va a `rsharp.lock` y cómo se avisa de un cambio de API.
  - La spec deja de marcar este punto como ABIERTO.
- **Notas de la revisión:** —

### T-OPEN-008 · Estrategia de pruebas diferenciales
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 0
- **Depende de:** —
- **Objetivo:** Fijar cómo se comparan .NET y Rust (spec §4.1, §19.8).
- **Archivos:** `docs/decisions/0008-differential-testing.md`, `rsharp-spec.md`
- **Criterios de aceptación:**
  - Define el corpus de casos, el formato de comparación y el treatment de las diferencias conocidas (UTF-16, desbordamiento, reentrada, finalizadores).
  - Define qué se hace cuando el caso no es equivalente por diseño (sugar).
  - La spec deja de marcar este punto como ABIERTO.
- **Notas de la revisión:** —

---

# Fase 1 — Núcleo del transpilador

### T-CORE-001 · API pública del compilador y modelo de resultado
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 1
- **Depende de:** T-OPEN-003, T-OPEN-005
- **Objetivo:** Implementar `Transpiler.Run` con la forma exacta de §4.3.
- **Archivos:** `src/RSharp.Compiler/Transpiler.cs`, `src/RSharp.Compiler/TranspileResult.cs`, `src/RSharp.Compiler/TranspileOptions.cs`
- **Criterios de aceptación:**
  - `Run(IReadOnlyDictionary<string, string> sources, TranspileOptions options)` devuelve archivos Rust, diagnósticos y source maps.
  - `RSharp.Compiler` no usa `System.IO`, red ni reloj: compila con esas referencias bloqueadas.
  - La misma entrada produce el mismo texto Rust (spec §2.4).
  - Hay una prueba unitaria con una entrada mínima.
- **Notas de la revisión:** —

### T-CORE-002 · RSharp.Attributes: catálogo de atributos
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 1
- **Depende de:** T-FND-001, T-OPEN-004
- **Objetivo:** Implementar los atributos que usa el núcleo y las fases siguientes (spec §4.2, §11, §12, §13).
- **Archivos:** `src/RSharp.Attributes/ExportAttribute.cs`, `src/RSharp.Attributes/ExternAttribute.cs`, `src/RSharp.Attributes/WasmExportAttribute.cs`, `src/RSharp.Attributes/DllImportAttribute.cs`, `src/RSharp.Attributes/ForeignAssemblyAttribute.cs`, `src/RSharp.Attributes/PythonModuleAttribute.cs`, `src/RSharp.Attributes/JavaClassAttribute.cs`, `src/RSharp.Attributes/RustMacroAttribute.cs`, `src/RSharp.Attributes/WeakAttribute.cs`, `src/RSharp.Attributes/BorrowedAttribute.cs`, `src/RSharp.Attributes/OwnedAttribute.cs`, `src/RSharp.Attributes/NoOptimizeAttribute.cs`, `src/RSharp.Attributes/RSharpSugarAttribute.cs`
- **Criterios de aceptación:**
  - Todos los atributos de §4.2, §11, §12, §13 y §8.2 existen con sus propiedades documentadas.
  - `[Extern("ruta::del::item")]` guarda la ruta completa del item de Rust (spec §12).
  - `[RSharpSugar("clave", "valor")]` admite el par de cadenas de §9.
  - Los atributos no dependen de nada fuera de `netstandard2.0`.
- **Notas de la revisión:** —

### T-CORE-003 · RSharp.Analyzers: subconjunto núcleo y rechazos
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 1
- **Depende de:** T-OPEN-003, T-CORE-002
- **Objetivo:** Rechazar con error lo que el núcleo no soporta (spec §8.1).
- **Archivos:** `src/RSharp.Analyzers/UnsupportedFeatureAnalyzer.cs`, `src/RSharp.Analyzers/AnalyzerIds.cs`
- **Criterios de aceptación:**
  - Cada construcción fuera del subconjunto de `T-OPEN-003` produce un error, no un aviso.
  - El diagnóstico nombra la construcción y la tarea de la spec que la respalda.
  - Los códigos `R#0042`, `R#0101` y `R#0150` se reservan para sus significados (spec §17).
  - Hay un test por cada construcción rechazada.
- **Notas de la revisión:** —

### T-CORE-004 · Frontend: uniones `partial`, `namespace` y `using`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 1
- **Depende de:** T-CORE-001
- **Objetivo:** Resolver la vista unificada del programa y convertir `namespace` en `mod` (spec §5, §5.2).
- **Archivos:** `src/RSharp.Compiler/Semantics/ProgramModel.cs`, `src/RSharp.Compiler/Emit/ModuleEmitter.cs`
- **Criterios de aceptación:**
  - Las partes `partial` de una clase se unen antes de generar (spec §5.2).
  - Cada `namespace` produce un `mod` y los nombres se califican correctamente.
  - Los `using` que no aportan nada al Rust generado no producen imports falsos.
  - El orden de las partes `partial` es determinista.
- **Notas de la revisión:** —

### T-CORE-005 · Emisión de `struct`: `Clone`, `Copy` y reglas de §5.1
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 1
- **Depende de:** T-CORE-001
- **Objetivo:** Traducir `struct` de C# a `struct` de Rust por valor, con las reglas de §5.1.
- **Archivos:** `src/RSharp.Compiler/Emit/StructEmitter.cs`, `src/RSharp.Compiler/Emit/DerivePlanner.cs`
- **Criterios de aceptación:**
  - Se deriva `Clone` siempre y `Copy` solo si todos los campos son `Copy`.
  - En una asignación de un `struct` sin `Copy` se inserta `.clone()` (§5.1).
  - `class` y `struct` se conservan como en C#: un `struct` no se envuelve en `Rc<RefCell>`.
  - El test compara la salida con .NET para un `struct` anidado.
- **Notas de la revisión:** —

### T-CORE-006 · Emisión de `class` en modo seguro (`Rc<RefCell<T>>`)
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 1
- **Depende de:** T-CORE-005
- **Objetivo:** Traducir `class` al modo seguro de referencia (spec §5, §7).
- **Archivos:** `src/RSharp.Compiler/Emit/ClassEmitter.cs`, `src/RSharp.Compiler/Emit/FieldEmitter.cs`
- **Criterios de aceptación:**
  - Toda clase se emite como `Rc<RefCell<T>>` en el modo seguro, que es la referencia (§7).
  - Los métodos de instancia usan `&self` o `&mut self` según el análisis.
  - Los métodos `static` son funciones asociadas en `impl` (§5).
  - No se genera `unsafe` salvo que el código fuente lo marque (§5.2).
- **Notas de la revisión:** —

### T-CORE-007 · `interface`, herencia, `virtual` y `override`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 1
- **Depende de:** T-CORE-006
- **Objetivo:** Traducir interfaces y herencia de clases al modelo Rust (spec §5).
- **Archivos:** `src/RSharp.Compiler/Emit/InterfaceEmitter.cs`, `src/RSharp.Compiler/Emit/InheritanceEmitter.cs`
- **Criterios de aceptación:**
  - Una `interface` produce un `trait` y las implementaciones producen `impl Trait for Tipo`.
  - La herencia de clase produce un campo `base` más un `trait` (§5).
  - `virtual` y `override` se traducen a métodos de `trait`.
  - Una clase `abstract` produce un `trait` más un `struct` de datos (§5).
  - Hay tests de despacho por `trait` y por clase base.
- **Notas de la revisión:** —

### T-CORE-008 · `enum`, `record` y `operator`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 1
- **Depende de:** T-CORE-005
- **Objetivo:** Traducir los tres construcciones con equivalente directo en Rust (spec §5).
- **Archivos:** `src/RSharp.Compiler/Emit/EnumEmitter.cs`, `src/RSharp.Compiler/Emit/RecordEmitter.cs`, `src/RSharp.Compiler/Emit/OperatorEmitter.cs`
- **Criterios de aceptación:**
  - Un `enum` se emite como `enum` con `#[repr(i32)]`.
  - Un `record` se emite como `struct` con `PartialEq` y `Clone`.
  - `operator +` se emite como `impl Add`.
  - Los valores de `enum` conservan el orden y el valor numérico.
- **Notas de la revisión:** —

### T-CORE-009 · Sobrecarga, argumentos opcionales y conversiones implícitas
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 1
- **Depende de:** T-CORE-006
- **Objetivo:** Implementar las tres reglas de §5.2 que afectan a la firma y a la llamada.
- **Archivos:** `src/RSharp.Compiler/Semantics/OverloadResolver.cs`, `src/RSharp.Compiler/Emit/CallSiteEmitter.cs`, `src/RSharp.Compiler/Semantics/ImplicitConversionPlanner.cs`
- **Criterios de aceptación:**
  - Cada método sobrecargado se renombra con el sufijo del tipo (`suma_i32`, `suma_f64`) (§5.2).
  - Los argumentos opcionales y con nombre se rellenan en el sitio de llamada (§5.2).
  - Las conversiones implícitas insertan una llamada `From` (§5.2).
  - La resolución de sobrecargas es determinista ante empate.
- **Notas de la revisión:** —

### T-CORE-010 · Genéricos, `where` y estado estático por `TypeId`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 1
- **Depende de:** T-CORE-006, T-CORE-007
- **Objetivo:** Traducir genéricos y sus restricciones (spec §5, §5.2).
- **Archivos:** `src/RSharp.Compiler/Emit/GenericEmitter.cs`, `src/RSharp.Compiler/Semantics/GenericStaticStore.cs`
- **Criterios de aceptación:**
  - `where T : IFoo` se traduce a `where T: Foo` y `where T : new()` a `where T: Default` (§5).
  - El estado `static` por genérico se guarda en un mapa por `TypeId` (§5.2).
  - Los genéricos reificados exigen `'static` (§6.2).
  - La covarianza de genéricos inserta conversiones explícitas (§6.2).
- **Notas de la revisión:** —

### T-CORE-011 · Delegados, lambdas y eventos
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 1
- **Depende de:** T-CORE-006
- **Objetivo:** Traducir el modelo de delegados y eventos (spec §5).
- **Archivos:** `src/RSharp.Compiler/Emit/DelegateEmitter.cs`, `src/RSharp.Compiler/Emit/EventEmitter.cs`
- **Criterios de aceptación:**
  - Un `delegate` produce `Box<dyn Fn>` o `impl Fn`; una lambda seClosure captura correctamente.
  - Un `event` produce `Vec<(u32, Box<dyn FnMut>)>` con ids (§5).
  - Desuscribir un evento no invalida los ids de los demás.
  - El orden de invocación de los suscriptores es determinista.
- **Notas de la revisión:** —

### T-CORE-012 · Excepciones: `Result` interno
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 1
- **Depende de:** T-CORE-006
- **Objetivo:** Traducir `try`/`catch`/`throw` al `Result` interno (spec §5, §8.1).
- **Archivos:** `src/RSharp.Compiler/Emit/ExceptionEmitter.cs`, `src/RSharp.Compiler/Semantics/ExceptionFlowAnalyzer.cs`
- **Criterios de aceptación:**
  - Las funciones que lanzan devuelven `Result`; el resto del camino usa `?`.
  - Un `throw` fuera de un `try` alcanzable genera `panic` (§5).
  - `catch` por tipo se traduce a comparación del valor de error.
  - El texto del error conserva el mensaje de C#.
- **Notas de la revisión:** —

### T-CORE-013 · `async`/`await` con `tokio` e hilos con `Arc<Mutex<T>>`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 1
- **Depende de:** T-CORE-006, T-CORE-012
- **Objetivo:** Traducir la asincronía y el multihilo (spec §5, §8.1).
- **Archivos:** `src/RSharp.Compiler/Emit/AsyncEmitter.cs`, `src/RSharp.Compiler/Emit/ThreadEmitter.cs`
- **Criterios de aceptación:**
  - `async`/`await` produce `async fn` y usa `tokio` como runtime.
  - Los hilos compartidos usan `Arc<Mutex<T>>`; `Rc` no cruza hilos (§5, §6.2).
  - El runtime elegido se puede cambiar por `rsharp.toml` (spec §12).
  - El test comprueba que el orden de salida coincide con .NET.
- **Notas de la revisión:** —

### T-CORE-014 · `unsafe`, punteros, `fixed` y `stackalloc`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 1
- **Depende de:** T-CORE-005
- **Objetivo:** Traducir el subconjunto de C# con `unsafe` (spec §2.3, §5).
- **Archivos:** `src/RSharp.Compiler/Emit/UnsafeEmitter.cs`
- **Criterios de aceptación:**
  - `unsafe` en el fuente produce bloques `unsafe` en el Rust generado (§5.2).
  - `int*` produce `*mut i32`; `fixed` produce el bloque equivalente.
  - `stackalloc` produce un arreglo en el stack.
  - El código generado sin `unsafe` en el fuente no contiene bloques `unsafe`.
- **Notas de la revisión:** —

### T-CORE-015 · LINQ, `switch` y `using`/`IDisposable`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 1
- **Depende de:** T-CORE-006, T-CORE-012
- **Objetivo:** Traducir las construcciones con equivalente directo en Rust (spec §5).
- **Archivos:** `src/RSharp.Compiler/Emit/LinqEmitter.cs`, `src/RSharp.Compiler/Emit/SwitchEmitter.cs`, `src/RSharp.Compiler/Emit/DisposableEmitter.cs`
- **Criterios de aceptación:**
  - Las consultas LINQ se traducen a iteradores; `switch` a `match`.
  - `IDisposable` y `using` producen `impl Drop` y un bloque de ámbito (§5).
  - El orden de evaluación de los `using` anidados es el de C#.
  - La semántica de cortocircuito de `&&` y `||` se conserva.
- **Notas de la revisión:** —

### T-CORE-016 · RSharp.Cli: comandos y salida JSON
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 1
- **Depende de:** T-CORE-001, T-FND-003, T-FND-004
- **Objetivo:** Implementar el ejecutable de línea de comandos con el contrato que espera la extensión (spec §4.2, §14.4).
- **Archivos:** `src/RSharp.Cli/Program.cs`, `src/RSharp.Cli/Commands/TranspileCommand.cs`, `src/RSharp.Cli/Commands/BuildCommand.cs`, `src/RSharp.Cli/Commands/RunCommand.cs`, `src/RSharp.Cli/Commands/CleanCommand.cs`, `src/RSharp.Cli/Commands/BindCommand.cs`, `src/RSharp.Cli/Envelope.cs`
- **Criterios de aceptación:**
  - `rsharp transpile|build|run|clean|bind` funcionan con `--project` y las opciones de la extensión.
  - Con `--json` se imprime **un único** objeto con la forma `RSharpCliEnvelope` de `extension/src/types.ts`.
  - Sin `--json` la salida es texto legible.
  - `rsharp --version` imprime la versión.
  - La CLI genera el `Cargo.toml` desde `rsharp.toml` (spec §9).
- **Notas de la revisión:** —

# Fase 2 — Extensión de VSCode

### T-VSCD-001 · Empaquetado y contribuciones de la extensión
- **Estado:** DONE
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 2
- **Depende de:** —
- **Objetivo:** Que el paquete `rsharp` se instale y active en VSCode.
- **Archivos:** `extension/package.json`, `extension/media/icon.svg`, `extension/.vscodeignore`, `extension/language-configuration/rsharp.json`
- **Criterios de aceptación:**
  - El paquete declara el lenguaje `rsharp` con extensión `.rsh`.
  - Los 8 comandos de §14.2 están declarados con categoría `R#`.
  - La barra de estado, la vista lateral y el menú contextual están declarados.
  - `vsce package` produce `rsharp.vsix` sin errores.
- **Notas de la revisión:** Revisado en la entrada de 2026-11-13 de `ai/REVIEW.md`.

### T-VSCD-002 · Parser de `rsharp.toml` sin dependencias
- **Estado:** DONE
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 2
- **Depende de:** —
- **Objetivo:** Leer `rsharp.toml` con un parser propio, sin dependencias de runtime.
- **Archivos:** `extension/src/toml.ts`, `extension/src/test/toml.test.ts`
- **Criterios de aceptación:**
  - `parseToml(text: string): TomlValue` exporta el tipo `TomlValue` y `TomlTable`.
  - Soporta tablas, arrays de tablas, arrays inline, strings basic/literal/multilínea, enteros, flotantes y booleanos.
  - Las fechas dan un error explícito con línea y columna.
  - `TomlParseError` está exportado e informa de línea y columna.
  - No importa `vscode` ni ningún paquete externo.
- **Notas de la revisión:** Revisado en la entrada de 2026-11-13 de `ai/REVIEW.md`.

### T-VSCD-003 · Resolución de configuración con prioridad del `rsharp.toml`
- **Estado:** DONE
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 2
- **Depende de:** T-VSCD-002
- **Objetivo:** Combinar `rsharp.toml` y los ajustes de VSCode con la precedencia de §9 y §14.4.
- **Archivos:** `extension/src/config.ts`, `extension/src/test/config.test.ts`
- **Criterios de aceptación:**
  - `rsharp.toml` tiene prioridad sobre los ajustes de VSCode (§14.4).
  - `outputDir` y `distDir` por defecto son `target/rsharp` y `dist` (§3).
  - Si `outputDir === distDir` se genera un aviso (§14.4).
  - Un `rsharp.toml` inválido no lanza: devuelve el error en `warnings` y sigue con los valores por defecto.
  - `schema` distinto de `1` produce aviso, no error.
- **Notas de la revisión:** Revisado en la entrada de 2026-11-13 de `ai/REVIEW.md`.

### T-VSCD-004 · Descubrimiento del toolchain
- **Estado:** DONE
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 2
- **Depende de:** —
- **Objetivo:** Encontrar `dotnet`, `cargo` y la CLI `rsharp` sin fallar si faltan.
- **Archivos:** `extension/src/toolchain.ts`, `extension/src/test/toolchain.test.ts`
- **Criterios de aceptación:**
  - `resolveToolchain` busca en `PATH` (separador `:` en POSIX y `;` en Windows) y en `~/.dotnet/tools`, `./.rsharp/bin` y junto a la extensión.
  - Una CLI que acaba en `.dll` produce `rsharpIsDll = true` y el comando `dotnet <dll> ...`.
  - `buildRSharpCommand` no añade `--project`.
  - `describeMissingTools` explica en español qué falta y por qué.
  - `exists` es inyectable para poder testearlo.
- **Notas de la revisión:** Revisado en la entrada de 2026-11-13 de `ai/REVIEW.md`.

### T-VSCD-005 · Cliente de la CLI
- **Estado:** DONE
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 2
- **Depende de:** T-VSCD-004
- **Objetivo:** Ejecutar `rsharp` y consumir su salida JSON sin lanzar excepciones.
- **Archivos:** `extension/src/cli.ts`, `extension/src/test/cli.test.ts`
- **Criterios de aceptación:**
  - Implementa `transpile`, `build`, `runProgram`, `clean` y `version` con el contrato de la CLI.
  - Con `--json` se espera un `RSharpCliEnvelope`; sin JSON válido la operación falla con `kind: 'bad-json'`.
  - Los fallos se devuelven en `CliResult.failure` con `kind` ∈ `not-found`, `spawn-failed`, `bad-json`, `unsupported`, `non-zero`, `unknown`.
  - El timeout por defecto es de 10 minutos.
  - `spawnFn` es inyectable y hay un test con una CLI simulada.
- **Notas de la revisión:** Revisado en la entrada de 2026-11-13 de `ai/REVIEW.md`.

### T-VSCD-006 · Traducción de diagnósticos R# a diagnósticos de VSCode
- **Estado:** DONE
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 2
- **Depende de:** —
- **Objetivo:** Convertir `RSharpDiagnostic[]` en diagnósticos de VSCode.
- **Archivos:** `extension/src/diagnostics.ts`, `extension/src/test/diagnostics.test.ts`
- **Criterios de aceptación:**
  - `toVscodeDiagnostic` convierte línea/columna 1-based a un rango 0-based.
  - La fuente es siempre `"R#"` y el código (`R#0042`, `R#0101`, `R#0150`) se conserva literal.
  - `groupByFile` agrupa por archivo y `summarizeDiagnostics` cuenta por severidad.
  - Un diagnóstico sin archivo se ancla en el archivo activo o se descarta, nunca inventa una ruta.
- **Notas de la revisión:** Revisado en la entrada de 2026-11-13 de `ai/REVIEW.md`.

### T-VSCD-007 · Source maps y parser de la salida de `rustc`
- **Estado:** DONE
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 2
- **Depende de:** T-OPEN-005
- **Objetivo:** Traducir errores de Rust a líneas del `.rsh` original (spec §14.4).
- **Archivos:** `extension/src/sourcemap.ts`, `extension/src/rustc-parser.ts`, `extension/src/test/sourcemap.test.ts`, `extension/src/test/rustc-parser.test.ts`
- **Criterios de aceptación:**
  - `parseRustcOutput` extrae código, severidad, mensaje, archivo, línea, columna, `help` y `raw`.
  - `parseCargoOutput` delega en `parseRustcOutput` e ignora `Compiling`/`Finished`.
  - Un bloque sin línea `-->` no se publica como error de VSCode: va al panel de salida.
  - `resolveRustLocation` devuelve la entrada anterior más cercana y, si no hay, la primera.
  - Los tests usan capturas reales de `rustc`.
- **Notas de la revisión:** Revisado en la entrada de 2026-11-13 de `ai/REVIEW.md`.

### T-VSCD-008 · Comandos de §14.2
- **Estado:** DONE
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 2
- **Depende de:** T-VSCD-003, T-VSCD-005, T-VSCD-006, T-VSCD-007
- **Objetivo:** Implementar los 8 comandos con sus identificadores exactos.
- **Archivos:** `extension/src/commands.ts`
- **Criterios de aceptación:**
  - Existen `rsharp.transpile`, `rsharp.build`, `rsharp.buildRelease`, `rsharp.buildWasm`, `rsharp.run`, `rsharp.clean`, `rsharp.chooseOutputFolder` y `rsharp.chooseDistFolder`.
  - `buildWasm` usa `wasm32-unknown-unknown` por defecto.
  - `clean` pide confirmación antes de borrar.
  - Elegir una carpeta fuera del workspace pide confirmación (§14.4).
  - Los errores se muestran con el mensaje real y el detalle va al panel de salida.
- **Notas de la revisión:** Revisado en la entrada de 2026-11-13 de `ai/REVIEW.md`.

### T-VSCD-009 · Barra de estado y vista lateral
- **Estado:** DONE
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 2
- **Depende de:** T-VSCD-008
- **Objetivo:** Mostrar el estado del proyecto y las rutas activas (spec §14.3).
- **Archivos:** `extension/src/statusbar.ts`, `extension/src/treeview.ts`
- **Criterios de aceptación:**
  - La barra de estado muestra el destino activo y abre un `QuickPick` con Transpile / Build / Run / Build WASM / Select target.
  - El icono cambia a `$(warning) R#` cuando falta la herramienta.
  - La vista lateral muestra proyecto, `rsharp.toml` (target, perfil, sugar), `outputDir`, `distDir`, toolchain y los archivos Rust generados.
  - Los nodos de rutas abren la carpeta o el archivo en el explorador.
- **Notas de la revisión:** Revisado en la entrada de 2026-11-13 de `ai/REVIEW.md`.

### T-VSCD-010 · Gramática TextMate autocontenida para `.rsh`
- **Estado:** DONE
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 2
- **Depende de:** —
- **Objetivo:** Resaltar `.rsh` sin depender de la extensión de C#.
- **Archivos:** `extension/syntaxes/rsharp.tmLanguage.json`
- **Criterios de aceptación:**
  - `scopeName` es `source.rsharp` y `fileTypes` incluye `rsh`.
  - No depende de `source.cs`: la gramática es autocontenida.
  - Cubre keywords, tipos, literales, strings verbatim e interpolados, chars, comentarios y directivas.
  - Cubre los atributos R# (`[Export]`, `[Extern]`, `[WasmExport]`, `[Weak]`, `[Owned]`, `[Borrowed]`, `[NoOptimize]`, `[RSharpSugar]`, ...).
  - El bloque `#codeGenAI(...) ... #end` tiene un scope propio.
- **Notas de la revisión:** Revisado en la entrada de 2026-11-13 de `ai/REVIEW.md`.

### T-VSCD-011 · Snippets de R#
- **Estado:** DONE
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 2
- **Depende de:** T-VSCD-010
- **Objetivo:** Ofrecer atajos para las construcciones propias de R#.
- **Archivos:** `extension/snippets/rsharp.json`
- **Criterios de aceptación:**
  - Hay snippets para `class`, `namespace`, `main`, `export`, `extern`, `wasmExport` y `codeGenAI`.
  - El snippet `codeGenAI` incluye el `#end` de cierre.
  - El JSON es válido y está declarado en `package.json`.
- **Notas de la revisión:** Revisado en la entrada de 2026-11-13 de `ai/REVIEW.md`.

### T-VSCD-012 · CLI de simulación para probar sin compilador
- **Estado:** DONE
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 2
- **Depende de:** T-VSCD-005
- **Objetivo:** Poder probar la extensión sin el compilador R# instalado.
- **Archivos:** `extension/tools/mock-rsharp.mjs`
- **Criterios de aceptación:**
  - Emula `transpile`, `build`, `run`, `clean` y `--version`.
  - Devuelve un JSON con la forma `RSharpCliEnvelope`.
  - Genera un `main.rs` con errores de `rustc` para probar los source maps.
  - Se invoca con `node tools/mock-rsharp.mjs transpile --project . --json`.
- **Notas de la revisión:** Revisado en la entrada de 2026-11-13 de `ai/REVIEW.md`.

### T-VSCD-013 · Suite de tests y empaquetado
- **Estado:** DONE
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 2
- **Depende de:** T-VSCD-002, T-VSCD-003, T-VSCD-004, T-VSCD-005, T-VSCD-006, T-VSCD-007
- **Objetivo:** Dejar `npm test` en verde y `npm run package` sin errores.
- **Archivos:** `extension/package.json`, `extension/src/test/*.test.ts`
- **Criterios de aceptación:**
  - `npm test` compila y ejecuta los tests de `toml`, `config`, `toolchain`, `cli`, `diagnostics`, `sourcemap` y `rustc-parser`.
  - El runner usa un patrón de archivos (`out/test/*.test.js`), no un directorio, porque el runner de Node 22 no expande directorios.
  - `npm run package` produce `rsharp.vsix`.
  - `npm run lint` (tsc `strict`) no falla.
- **Notas de la revisión:** Revisado en la entrada de 2026-11-13 de `ai/REVIEW.md`.

### T-VSCD-014 · Capa de activación de la extensión
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 2
- **Depende de:** T-VSCD-008, T-VSCD-009
- **Objetivo:** Implementar `activate`/`deactivate` y el cableado de todos los módulos (spec §14.1).
- **Archivos:** `extension/src/extension.ts`
- **Criterios de aceptación:**
  - `activate` registra comandos, panel de salida `R#`, `DiagnosticCollection`, barra de estado y vista lateral, y devuelve los `Disposable` a `context.subscriptions`.
  - `deactivate` limpia el `DiagnosticCollection`.
  - Detecta `rsharp.toml` en la raíz y reactiva cuando aparece (`onDidChangeWorkspaceFolders` y `createFileSystemWatcher`).
  - Sin `rsharp.toml` la extensión sigue activa y avisa en el panel.
  - `rsharp.restartLanguageServer` ejecuta `C#: Restart Language Server` si existe y, si no, avisa de que falta C# Dev Kit.
  - `rsharp.toggleCSharpAssociation` alterna `files.associations` con `WorkspaceEdit` y `ConfigurationTarget.Workspace`.
- **Notas de la revisión:** —

### T-VSCD-015 · Documentación de la extensión
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 2
- **Depende de:** T-VSCD-014
- **Objetivo:** Documentar instalación, comandos, ajustes y límites actuales.
- **Archivos:** `extension/README.md`, `extension/CHANGELOG.md`, `extension/LICENSE`, `docs/EXTENSION.md`
- **Criterios de aceptación:**
  - El README cubre instalación, requisitos, comandos, ajustes y solución de problemas, con enlace a `rsharp-spec.md`.
  - `docs/EXTENSION.md` tiene las 10 secciones obligatorias del plan original, incluidas "qué SÍ" y "qué NO se puede hacer todavía" con la sección de la spec que lo respalda.
  - La depuración con CodeLLDB aparece marcada como no implementada (§14.5).
  - Los mensajes de error citados son los literales del código.
- **Notas de la revisión:** —

---

# Fase 3 — BCL por destino

### T-BCL-001 · Lista cerrada de tipos de `System.*`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 3
- **Depende de:** T-OPEN-002, T-CORE-003
- **Objetivo:** Implementar la lista inicial de tipos soportados y el analizador que rechaza el resto (spec §10).
- **Archivos:** `src/RSharp.Analyzers/BclTypeAnalyzer.cs`, `src/RSharp.Compiler/Bcl/SupportedTypes.cs`
- **Criterios de aceptación:**
  - La lista incluye `List<T>`, `Dictionary<K,V>`, `string`, `Math`, `Console` y `File`.
  - Un tipo fuera de la lista produce un error que nombra el tipo y la lista admitida.
  - La lista está en un único sitio y puede crecer por versión.
- **Notas de la revisión:** —

### T-BCL-002 · Mapeo por destino y diagnóstico `R#0101`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 3
- **Depende de:** T-BCL-001
- **Objetivo:** Hacer que el mapeo de la BCL dependa del `target` y emita `R#0101` cuando no exista (spec §10).
- **Archivos:** `src/RSharp.Compiler/Bcl/TargetCapabilityTable.cs`, `src/RSharp.Analyzers/UnsupportedApiAnalyzer.cs`
- **Criterios de aceptación:**
  - `File.ReadAllText` funciona en nativo y produce `R#0101` en `wasm32-unknown-unknown`.
  - `Thread.Sleep` funciona en nativo y se rechaza en WASM.
  - El texto del diagnóstico incluye el destino y la API, como el ejemplo de §10.
  - El diagnóstico apunta a la línea del `.rsh` (§17).
- **Notas de la revisión:** —

### T-BCL-003 · Mapeo de `Console` y `Math`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 3
- **Depende de:** T-BCL-001
- **Objetivo:** Implementar el mapeo de `Console` y `Math` en los dos destinos (spec §10).
- **Archivos:** `src/RSharp.Compiler/Bcl/ConsoleMapping.cs`, `src/RSharp.Compiler/Bcl/MathMapping.cs`
- **Criterios de aceptación:**
  - `Console.WriteLine` → `println!` en nativo y `console.log` vía `web-sys` en WASM.
  - `Console.Write` no añade salto de línea en ninguno de los dos destinos.
  - `Math.Sqrt/Abs/Min/Max/Pow` mapea a las funciones de `std` con el mismo resultado en coma flotante.
  - Hay un test por destino.
- **Notas de la revisión:** —

### T-BCL-004 · Mapeo de `File`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 3
- **Depende de:** T-BCL-002
- **Objetivo:** Implementar `File.ReadAllText` y `File.WriteAllText` solo para nativo (spec §10).
- **Archivos:** `src/RSharp.Compiler/Bcl/FileMapping.cs`
- **Criterios de aceptación:**
  - `File.ReadAllText` → `std::fs::read_to_string` en nativo.
  - `File.WriteAllText` escribe con `std::fs::write`.
  - En `wasm32-unknown-unknown` ambos se rechazan con `R#0101`.
  - El texto de la excepción conserva el mensaje de C#.
- **Notas de la revisión:** —

### T-BCL-005 · `string`: `Rc<str>` frente a `String` y sugar UTF-16
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 3
- **Depende de:** T-CORE-005, T-BCL-001
- **Objetivo:** Decidir y aplicar la representación de `string` según el análisis (spec §5, §6.2, §9).
- **Archivos:** `src/RSharp.Compiler/Bcl/StringMapping.cs`
- **Criterios de aceptación:**
  - El modo seguro usa `Rc<str>`; el optimizado usa `&str`/`String` cuando no hay indexación UTF-16 (§7.8).
  - Con `sugar.strings = "utf16"` el análisis desactiva la optimización de strings.
  - `Length` y `s[i]` con UTF-16 se documentan como diferencia conocida (§6.2).
  - El test deutf-16 con emoji documenta la diferencia con .NET.
- **Notas de la revisión:** —

### T-BCL-006 · Procedimiento para ampliar la lista de tipos
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 3
- **Depende de:** T-BCL-003, T-BCL-004
- **Objetivo:** Documentar cómo se añade un tipo nuevo a la BCL en cada versión (spec §10).
- **Archivos:** `docs/bcl/adding-a-type.md`, `src/RSharp.Compiler/Bcl/SupportedTypes.cs`
- **Criterios de aceptación:**
  - El documento enumera los pasos: añadir el tipo, sus miembros, el mapeo por destino y los tests.
  - Cada tipo nuevo necesita un test por destino y la actualización de la tabla de `T-OPEN-002`.
  - Un tipo sin soporte en un destino se documenta en la tabla, no se omite.
- **Notas de la revisión:** —

---

# Fase 4 — Destino WASM

### T-WASM-001 · Destino `wasm32-unknown-unknown`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 4
- **Depende de:** T-CORE-016, T-BCL-002
- **Objetivo:** Activar el destino WASM desde `build.target` (spec §11).
- **Archivos:** `src/RSharp.Compiler/Targets/WasmTarget.cs`, `src/RSharp.Compiler/Targets/TargetRegistry.cs`
- **Criterios de aceptación:**
  - `build.target = "wasm32-unknown-unknown"` en `rsharp.toml` selecciona el destino.
  - El `Cargo.toml` generado incluye el perfil y las dependencias de WASM.
  - La CLI compila con `cargo build --target wasm32-unknown-unknown`.
  - El transpilador **no** se compila para WASM (§4.4).
- **Notas de la revisión:** —

### T-WASM-002 · `[WasmExport]` y `wasm-bindgen`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 4
- **Depende de:** T-WASM-001, T-CORE-002
- **Objetivo:** Marcar funciones visibles desde JavaScript (spec §11).
- **Archivos:** `src/RSharp.Compiler/Emit/WasmExportEmitter.cs`
- **Criterios de aceptación:**
  - Un método con `[WasmExport]` genera `#[wasm_bindgen]`.
  - El nombre exportado es el del método y es único en el módulo.
  - Los métodos sin `[WasmExport]` no se exportan.
  - Un test en navegador o con Node + WASM comprueba que la función se llama desde JavaScript.
- **Notas de la revisión:** —

### T-WASM-003 · Strings y clases exportadas en el borde
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 4
- **Depende de:** T-WASM-002
- **Objetivo:** Resolver el paso de `string` y de objetos por el borde de WASM (spec §11).
- **Archivos:** `src/RSharp.Compiler/Emit/WasmBoundaryEmitter.cs`
- **Criterios de aceptación:**
  - Un `string` cruza el límite como `String`.
  - Una clase exportada usa una estructura envoltorio: `Rc<RefCell<T>>` no aparece en la frontera.
  - La estructura envoltorio expone getters y setters por la API exportada.
  - Hay un test que comprueba que el borde no usa `Rc<RefCell>`.
- **Notas de la revisión:** —

### T-WASM-004 · `async`, `panic` hook y `R#0150`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 4
- **Depende de:** T-WASM-001
- **Objetivo:** Cubrir las reglas de runtime y límites de WASM (spec §11).
- **Archivos:** `src/RSharp.Compiler/Emit/WasmRuntimeEmitter.cs`, `src/RSharp.Analyzers/WasmRestrictionAnalyzer.cs`
- **Criterios de aceptación:**
  - `async` usa `wasm-bindgen-futures` en el destino WASM.
  - El `panic` hook con `console_error_panic_hook` se activa en el arranque.
  - `[PythonModule]` se rechaza en la v1 con `R#0150`.
  - Los hilos se rechazan en la v1 con un diagnóstico explicativo.
- **Notas de la revisión:** —

### T-WASM-005 · Destino `wasm32-wasip1`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 4
- **Depende de:** T-WASM-001
- **Objetivo:** Añadir el destino WASI con enlace estático (spec §11, §9).
- **Archivos:** `src/RSharp.Compiler/Targets/WasiTarget.cs`, `src/RSharp.Compiler/Targets/TargetRegistry.cs`
- **Criterios de aceptación:**
  - `build.target = "wasm32-wasip1"` compila y produce un `.wasm` ejecutable con WASI.
  - El acceso a ficheros funciona (a diferencia de `wasm32-unknown-unknown`).
  - Las DLL dinámicas siguen rechazadas con `R#0150`.
  - El `Cargo.toml` generado distingue el perfil WASI del perfil navegador.
- **Notas de la revisión:** —

---

# Fase 5 — Bindings de crates y FFI

### T-FFI-001 · `[Extern]` manual
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 5
- **Depende de:** T-CORE-002, T-OPEN-007
- **Objetivo:** Permitir llamar a items de Rust desde `.rsh` con `[Extern]` (spec §12).
- **Archivos:** `src/RSharp.Compiler/Emit/ExternEmitter.cs`, `docs/ffi/extern.md`
- **Criterios de aceptación:**
  - `[Extern("ruta::del::item")]` genera la llamada al item de Rust con esa ruta.
  - Un `.rs` escrito a mano puede llamar a un tipo `.rsh` marcado con `[Export]` (§15).
  - El error si el item no existe en el crate se detecta en `cargo check` (§12).
  - Hay un ejemplo completo en `docs/ffi/extern.md`.
- **Notas de la revisión:** —

### T-FFI-002 · `rsharp bind <crate>` desde el JSON de `rustdoc`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 5
- **Depende de:** T-FFI-001, T-OPEN-007
- **Objetivo:** Generar bindings automáticos desde el JSON de `rustdoc` (spec §12).
- **Archivos:** `src/RSharp.Cli/Commands/BindCommand.cs`, `src/RSharp.Compiler/Bindings/RustDocReader.cs`, `src/RSharp.Compiler/Bindings/BindingGenerator.cs`
- **Criterios de aceptación:**
  - `rsharp bind <crate>` lee el JSON de `rustdoc` y genera los bindings.
  - Los bindings se guardan en `bindings/` (spec §12) y el usuario puede editarlos.
  - El crate se añade a `[dependencies]` del `Cargo.toml` generado.
  - Un crate con `unsafe` o FFI se rechaza salvo bloque `unsafe` explícito (§12).
- **Notas de la revisión:** —

### T-FFI-003 · Equivalencias Rust ↔ R# y lifetimes
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 5
- **Depende de:** T-FFI-002, T-OPEN-004
- **Objetivo:** Implementar la tabla de equivalencias de §12 en el generador de bindings.
- **Archivos:** `src/RSharp.Compiler/Bindings/TypeEquivalenceTable.cs`
- **Criterios de aceptación:**
  - `Option<T>` ↔ `T?`; `Result<T,E>` ↔ `T` con excepción `E`; `&str`/`String` ↔ `string`; `&[T]`/`Vec<T>` ↔ `Span<T>`/`List<T>`; `&mut T` ↔ `ref T`; `trait` ↔ `interface`; `enum` con datos ↔ jerarquía de `record`; `impl Trait` ↔ genérico con `where`; `Box<dyn T>` ↔ interfaz; macros ↔ método con `[RustMacro]` (§12).
  - Los lifetimes se infieren u omiten; los ligados a argumentos usan `[Borrowed]` o `clone` (§12).
  - Cada equivalencia tiene un test de ida y vuelta.
- **Notas de la revisión:** —

### T-FFI-004 · Hash de API y verificación con `cargo check`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 5
- **Depende de:** T-FFI-003, T-FND-004
- **Objetivo:** Fijar la API de cada crate en `rsharp.lock` y verificarla (spec §12).
- **Archivos:** `src/RSharp.Compiler/Bindings/ApiHash.cs`, `src/RSharp.Compiler/Locking/LockFile.cs`
- **Criterios de aceptación:**
  - Se guarda el hash de la API de cada crate en `rsharp.lock`.
  - Se avisa si una versión nueva cambia la API.
  - Los bindings se verifican con `cargo check`.
  - Un crate con `async` exige el runtime elegido en `rsharp.toml`; un crate sin soporte `wasm32` se rechaza en ese destino (§12).
- **Notas de la revisión:** —

### T-FFI-005 · FFI C nativo: `[DllImport]` y `libloading`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 5
- **Depende de:** T-CORE-002, T-FFI-001
- **Objetivo:** Enlazar una DLL nativa de C o C++ (spec §13).
- **Archivos:** `src/RSharp.Compiler/Emit/DllImportEmitter.cs`, `docs/ffi/native.md`
- **Criterios de aceptación:**
  - `[DllImport("libs/mylib.dll")]` genera `extern "C"` y la carga con `libloading`.
  - `[foreign.mylib]` de `rsharp.toml` con `kind = "native"` y `link = "dynamic"` genera la misma llamada (§9).
  - Las llamadas nativas exigen `unsafe` y se envuelven en métodos seguros (§13).
  - Una DLL nativa exige un binario por plataforma: el error lo dice (§13).
- **Notas de la revisión:** —

### T-FFI-006 · FFI C con cabecera: `rsharp bind --c lib.h`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 5
- **Depende de:** T-FFI-005
- **Objetivo:** Generar bindings desde una cabecera C con `bindgen` (spec §13).
- **Archivos:** `src/RSharp.Cli/Commands/BindCCommand.cs`, `docs/ffi/c-header.md`
- **Criterios de aceptación:**
  - `rsharp bind --c lib.h` invoca `bindgen` y guarda el resultado en `bindings/`.
  - Las funciones con `char*` y `string` siguen las reglas del límite: se copian y se liberan con `Drop` (§13).
  - Los punteros devueltos se marcan con `[Owned]` o `[Borrowed]` (§13).
  - Los callbacks se convierten en `extern "C" fn` con contexto (§13).
- **Notas de la revisión:** —

### T-FFI-007 · DLL de .NET: `[ForeignAssembly]` y `netcorehost`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 5
- **Depende de:** T-FFI-005, T-OPEN-007
- **Objetivo:** Llamar a una DLL de .NET desde el programa generado (spec §13).
- **Archivos:** `src/RSharp.Compiler/Emit/ForeignAssemblyEmitter.cs`, `docs/ffi/dotnet.md`
- **Criterios de aceptación:**
  - `[ForeignAssembly]` genera la llamada vía `netcorehost`.
  - Los metadatos se leen con `System.Reflection.Metadata` (§13).
  - El host exige .NET instalado y el error lo dice con claridad (§13).
  - El documento recuerda las tres rutas: transpilar el código R#, NativeAOT con exportaciones C y host .NET (§13).
- **Notas de la revisión:** —

### T-FFI-008 · Python: `[PythonModule]` y `pyo3`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 5
- **Depende de:** T-FFI-001
- **Objetivo:** Importar y llamar módulos Python desde `.rsh` (spec §13).
- **Archivos:** `src/RSharp.Compiler/Emit/PythonModuleEmitter.cs`, `docs/ffi/python.md`
- **Criterios de aceptación:**
  - `[PythonModule("numpy")]` genera el binding de `pyo3`.
  - Se toma el GIL en cada llamada (§13).
  - Los errores de Python se convierten a `Result` (§13).
  - En `wasm32-unknown-unknown` se rechaza con `R#0150` (§11).
- **Notas de la revisión:** —

### T-FFI-009 · Java: `[JavaClass]` y `jni`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 5
- **Depende de:** T-FFI-008
- **Objetivo:** Enlazar clases Java con el crate `jni` (spec §13).
- **Archivos:** `src/RSharp.Compiler/Emit/JavaClassEmitter.cs`, `docs/ffi/java.md`
- **Criterios de aceptación:**
  - `[JavaClass("com.ejemplo.Clase")]` genera el binding con `jni`.
  - Los strings Java se convierten según las reglas del límite (§13).
  - El soporte de Java se documenta como posterior a C y Python (§13).
- **Notas de la revisión:** —

# Fase 6 — Optimizaciones

### T-OPT-000 · Infraestructura de optimización
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 6
- **Depende de:** T-CORE-015, T-OPEN-008
- **Objetivo:** Montar el grafo de llamadas, el flujo de datos y los análisis de escape y aliasing que exige §7.
- **Archivos:** `src/RSharp.Compiler/Optimization/CallGraph.cs`, `src/RSharp.Compiler/Optimization/DataFlow.cs`, `src/RSharp.Compiler/Optimization/EscapeAnalysis.cs`, `src/RSharp.Compiler/Optimization/AliasAnalysis.cs`
- **Criterios de aceptación:**
  - Los cuatro análisis existen y se ejecutan sobre el modelo semántico completo.
  - Los análisis son deterministas y su resultado se puede volcar para depurar.
  - `[NoOptimize]` desactiva los pasos de un método (§7).
  - El modo seguro sigue siendo la referencia: ninguna optimización se aplica por defecto (§7).
- **Notas de la revisión:** —

### T-OPT-001 · Paso 1: análisis de escape
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 6
- **Depende de:** T-OPT-000
- **Objetivo:** Un objeto local que no escapa pasa a `struct` en el stack.
- **Archivos:** `src/RSharp.Compiler/Optimization/Passes/EscapePass.cs`
- **Criterios de aceptación:**
  - Un objeto local sin escape se emite como valor y no como `Rc<RefCell<T>>`.
  - Un objeto que escapa no cambia.
  - La salida del programa es idéntica a la del modo seguro.
  - El test de equivalencia del corpus de `T-OPEN-008` pasa.
- **Notas de la revisión:** —

### T-OPT-002 · Paso 2: último uso
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 6
- **Depende de:** T-OPT-001
- **Objetivo:** Generar movimiento en lugar de `.clone()` en el último uso.
- **Archivos:** `src/RSharp.Compiler/Optimization/Passes/LastUsePass.cs`
- **Criterios de aceptación:**
  - El `.clone()` innecesario desaparece cuando el valor ya no se usa.
  - El borrow checker de Rust no falla tras la transformación.
  - La salida del programa no cambia.
- **Notas de la revisión:** —

### T-OPT-003 · Paso 3: análisis de aliasing
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 6
- **Depende de:** T-OPT-002
- **Objetivo:** Generar `&mut` y eliminar `RefCell` cuando no hay aliasing.
- **Archivos:** `src/RSharp.Compiler/Optimization/Passes/AliasingPass.cs`
- **Criterios de aceptación:**
  - Cuando el análisis lo demuestra, el campo deja de ser `RefCell` y pasa a `&mut`.
  - El paso es conservador: si hay duda, no se aplica.
  - La reentrada detectada mantiene el `panic` de §6.2.
- **Notas de la revisión:** —

### T-OPT-004 · Paso 4: análisis de hilos
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 6
- **Depende de:** T-OPT-003
- **Objetivo:** Elegir `Rc` o `Arc` según el uso real de hilos.
- **Archivos:** `src/RSharp.Compiler/Optimization/Passes/ThreadAnalysisPass.cs`
- **Criterios de aceptación:**
  - Un valor que no cruza hilos se queda en `Rc`.
  - Un valor que cruza hilos pasa a `Arc` y `Mutex` (§5).
  - El resultado compila sin errores de `Send`/`Sync`.
- **Notas de la revisión:** —

### T-OPT-005 · Paso 5: desvirtualización
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 6
- **Depende de:** T-OPT-004
- **Objetivo:** Convertir el despacho dinámico en llamada estática cuando hay una sola implementación.
- **Archivos:** `src/RSharp.Compiler/Optimization/Passes/DevirtualizationPass.cs`
- **Criterios de aceptación:**
  - Con una única implementación, la llamada virtual se emite como llamada directa.
  - Con varias implementaciones, el despacho se mantiene.
  - El comportamiento observable no cambia (incluido el `is`/`as`).
- **Notas de la revisión:** —

### T-OPT-006 · Paso 6: clases `sealed`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 6
- **Depende de:** T-OPT-005
- **Objetivo:** Convertir las llamadas a clases `sealed` en llamadas directas con `#[inline]`.
- **Archivos:** `src/RSharp.Compiler/Optimization/Passes/SealedCallPass.cs`
- **Criterios de aceptación:**
  - Una clase `sealed` no genera `trait` de despacho.
  - Las llamadas marcadas llevan `#[inline]`.
  - El test mide una mejora real de tamaño o tiempo frente al modo seguro.
- **Notas de la revisión:** —

### T-OPT-007 · Paso 7: arena
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 6
- **Depende de:** T-OPT-006
- **Objetivo:** Reemplazar grafos de vida común por índices en un `Vec`.
- **Archivos:** `src/RSharp.Compiler/Optimization/Passes/ArenaPass.cs`
- **Criterios de aceptación:**
  - Los objetos con el mismo grafo de referencias comparten un `Vec` de arena.
  - Las referencias internas se convierten en índices.
  - El orden de destrucción es el de C#: `Drop` sigue siendo determinista (§6.2).
- **Notas de la revisión:** —

### T-OPT-008 · Paso 8: strings
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 6
- **Depende de:** T-OPT-007, T-BCL-005
- **Objetivo:** Usar `&str` o `String` cuando no hay indexación UTF-16.
- **Archivos:** `src/RSharp.Compiler/Optimization/Passes/StringOptimizationPass.cs`
- **Criterios de aceptación:**
  - Una cadena sin indexación por carácter se emite como `&str`/`String`.
  - Con indexación UTF-16 el tipo sigue siendo UTF-8 seguro y el sugar `utf16` avisa.
  - La longitud y el subíndice coinciden con .NET en los casos del corpus.
- **Notas de la revisión:** —

### T-OPT-009 · Paso 9: aritmética
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 6
- **Depende de:** T-OPT-008
- **Objetivo:** Traducir `unchecked` a `wrapping_*` y `checked` a `checked_*` (§7.9).
- **Archivos:** `src/RSharp.Compiler/Optimization/Passes/ArithmeticPass.cs`
- **Criterios de aceptación:**
  - El modo optimizado usa `wrapping_*` donde el código fuente pide `unchecked`.
  - `checked` genera `checked_*` y convierte el desbordamiento en excepción.
  - El modo seguro mantiene el pánico de Rust en debug (§6.2) y el sugar `overflow` decide (§9).
- **Notas de la revisión:** —

### T-OPT-010 · Paso 10: LINQ
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 6
- **Depende de:** T-OPT-009
- **Objetivo:** Fusionar cadenas de iteradores LINQ en un solo iterador.
- **Archivos:** `src/RSharp.Compiler/Optimization/Passes/LinqFusionPass.cs`
- **Criterios de aceptación:**
  - Una cadena `Where().Select().ToList()` se emite como un único iterador.
  - La salida y el orden de los elementos no cambian.
  - Las lambdas con efecto lateral no se fusionan.
- **Notas de la revisión:** —

### T-OPT-011 · Paso 11: bucles
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 6
- **Depende de:** T-OPT-010
- **Objetivo:** Reescribir los `for` con índice como iteradores.
- **Archivos:** `src/RSharp.Compiler/Optimization/Passes/LoopRewritePass.cs`
- **Criterios de aceptación:**
  - Un `for` con índice que no muta el índice se emite como iterador.
  - La semántica de `break`, `continue` y `return` se conserva.
  - El test compara la salida con .NET.
- **Notas de la revisión:** —

### T-OPT-012 · Paso 12: async sin `Box`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 6
- **Depende de:** T-OPT-011
- **Objetivo:** Generar la máquina de estados de `async` sin `Box` por estado.
- **Archivos:** `src/RSharp.Compiler/Optimization/Passes/AsyncStateMachinePass.cs`
- **Criterios de aceptación:**
  - La máquina de estados no usa `Box<dyn Future>` por estado.
  - El tamaño de la máquina de estados es menor que en el modo seguro.
  - El orden de las continuaciones coincide con .NET.
- **Notas de la revisión:** —

### T-OPT-013 · Paso 13: excepciones como `Result`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 6
- **Depende de:** T-OPT-012
- **Objetivo:** Generar `Result` con `?` cuando todos los `throw` son conocidos (§7.13).
- **Archivos:** `src/RSharp.Compiler/Optimization/Passes/ResultPropagationPass.cs`
- **Criterios de aceptación:**
  - Cuando el análisis conoce todos los `throw`, la función devuelve `Result` y usa `?`.
  - Cuando hay un `throw` desconocido, no se aplica el paso.
  - El texto de la excepción conservada llega igual al llamante.
- **Notas de la revisión:** —

### T-OPT-014 · Paso 14: layout de campos
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 6
- **Depende de:** T-OPT-013
- **Objetivo:** Reordenar los campos para reducir el relleno, respetando `StructLayout` (§7.14).
- **Archivos:** `src/RSharp.Compiler/Optimization/Passes/LayoutPass.cs`
- **Criterios de aceptación:**
  - Los campos se reordenan por alineación salvo que `StructLayout` lo imponga.
  - El `size_of` mejora o se mantiene igual.
  - La serialización manual respeta el orden original cuando hay `StructLayout`.
- **Notas de la revisión:** —

### T-OPT-015 · Paso 15: eventos
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 6
- **Depende de:** T-OPT-014
- **Objetivo:** Usar `Option<Box<dyn FnMut>>` cuando el evento tiene un solo suscriptor (§7.15).
- **Archivos:** `src/RSharp.Compiler/Optimization/Passes/EventOptimizationPass.cs`
- **Criterios de aceptación:**
  - Con un solo suscriptor, el evento usa `Option<Box<dyn FnMut>>`.
  - Con varios, se mantiene `Vec<(u32, Box<dyn FnMut>)>` (§5).
  - Alta y baja de suscriptores siguen funcionando y el orden no cambia.
- **Notas de la revisión:** —

---

# Fase 7 — Plugins, sugar y `#codeGenAI`

### T-PLG-001 · Contrato de plugin
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 7
- **Depende de:** T-CORE-003, T-OPEN-001
- **Objetivo:** Definir qué declara cada plugin (spec §16).
- **Archivos:** `docs/plugins/plugin-contract.md`, `src/RSharp.Compiler/Plugins/PluginManifest.cs`
- **Criterios de aceptación:**
  - El manifiesto declara las construcciones que el plugin reescribe y las que produce (§16).
  - Declara su coste en rendimiento, tamaño y tokens (§16).
  - Declara sus dependencias (§16).
  - Un plugin que reescribe una construcción del núcleo a núcleo es válido; uno que produce construcciones no soportadas se rechaza.
- **Notas de la revisión:** —

### T-PLG-002 · Registro y orden de plugins
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 7
- **Depende de:** T-PLG-001
- **Objetivo:** Cargar y aplicar los plugins en el orden explícito de `rsharp.toml` (spec §16).
- **Archivos:** `src/RSharp.Compiler/Plugins/PluginHost.cs`, `src/RSharp.Compiler/Plugins/PluginLoader.cs`
- **Criterios de aceptación:**
  - `[plugins]` de `rsharp.toml` es una lista **ordenada** (§16).
  - El orden de la lista es el orden de ejecución.
  - Un plugin que depende de otro se ejecuta después; una dependencia ausente es un error.
  - La lista vacía no cambia el resultado del núcleo.
- **Notas de la revisión:** —

### T-PLG-003 · Conflicto entre plugins
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 7
- **Depende de:** T-PLG-002
- **Objetivo:** Detectar que dos plugins reescriben la misma construcción (spec §16, §18).
- **Archivos:** `src/RSharp.Compiler/Plugins/PluginConflictDetector.cs`
- **Criterios de aceptación:**
  - La colisión produce un aviso que nombra los dos plugins y la construcción.
  - La resolución es determinista según el orden de `rsharp.toml`.
  - El aviso no impide compilar, pero el resultado es el mismo en todas las ejecuciones.
- **Notas de la revisión:** —

### T-PLG-004 · Pruebas y orden del pipeline
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 7
- **Depende de:** T-PLG-003, T-OPT-000
- **Objetivo:** Exigir pruebas propias a cada plugin y ejecutar la optimización después (spec §16).
- **Archivos:** `src/RSharp.Compiler/Plugins/PluginTestHarness.cs`, `docs/plugins/plugin-tests.md`
- **Criterios de aceptación:**
  - Cada plugin trae sus propias pruebas y sin ellas falla la compilación (§16).
  - El pipeline es: núcleo → plugins → optimización de programa completo (§16).
  - El orden es el mismo en la CLI y en la extensión.
- **Notas de la revisión:** —

### T-SUGAR-001 · Interruptores de sugar y su ámbito
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 7
- **Depende de:** T-OPEN-006, T-CORE-001
- **Objetivo:** Implementar los interruptores de sugar de §9 y su ámbito.
- **Archivos:** `src/RSharp.Compiler/Sugar/SugarSettings.cs`, `src/RSharp.Compiler/Sugar/SugarResolver.cs`
- **Criterios de aceptación:**
  - Se soportan `strings`, `overflow`, `reentrancy`, `finalizers` y `cycles` con los valores de §9.
  - Sin configuración, el sugar queda **apagado** (§8.2).
  - `[assembly: RSharpSugar("overflow", "wrap")]` sobrescribe por archivo y el mismo atributo por método sobrescribe por método; gana el ámbito más cercano (§9).
  - El perfil `[profile.release.sugar]` se aplica con `--profile release` (§9).
  - El hash de la configuración de sugar va a `rsharp.lock` (§9).
- **Notas de la revisión:** —

### T-SUGAR-002 · Atributos `[Weak]`, `[Borrowed]` y `[Owned]`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 7
- **Depende de:** T-OPEN-004, T-CORE-002
- **Objetivo:** Implementar los atributos de ciclo de vida con la sintaxis decidida en `T-OPEN-004`.
- **Archivos:** `src/RSharp.Compiler/Emit/WeakFieldEmitter.cs`, `src/RSharp.Compiler/Emit/OwnedBorrowedEmitter.cs`
- **Criterios de aceptación:**
  - `[Weak]` genera `Weak<RefCell<T>>` en el campo y evita el ciclo (§8.2).
  - `[Borrowed]` no libera el valor en el destino; `[Owned]` lo libera con `Drop` (§13).
  - La sintaxis es exactamente la que fijó `T-OPEN-004`.
  - Sin el atributo, el comportamiento es el del modo seguro.
- **Notas de la revisión:** —

### T-SUGAR-003 · Diagnóstico `R#0042` y avisos de sugar
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 7
- **Depende de:** T-SUGAR-001, T-CORE-003
- **Objetivo:** Avisar cuando el código exige un sugar apagado (spec §8.2, §17).
- **Archivos:** `src/RSharp.Analyzers/SugarRequiredAnalyzer.cs`
- **Criterios de aceptación:**
  - El código es `R#0042` y el texto sigue el patrón de §8.2: `R#0042: usa [Weak] en este campo o activa #codeGenAI`.
  - El diagnóstico indica la directiva o el ajuste necesario (§17).
  - Apunta a la línea del `.rsh` (§17).
  - El diagnóstico desaparece cuando el sugar está habilitado.
- **Notas de la revisión:** —

### T-SUGAR-004 · Sugar de desbordamiento
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 7
- **Depende de:** T-SUGAR-001
- **Objetivo:** Implementar el sugar `overflow` con los valores `panic`, `wrap` y `checked` (§9).
- **Archivos:** `src/RSharp.Compiler/Sugar/OverflowSugar.cs`
- **Criterios de aceptación:**
  - `panic` mantiene el comportamiento de Rust en debug; `wrap` usa `wrapping_*`; `checked` usa `checked_*` y lanza excepción.
  - El valor por defecto es estricto: `panic` (§9).
  - El cambio de valor invalida los bloqueos afectados (§9).
- **Notas de la revisión:** —

### T-SUGAR-005 · Sugar de strings, reentrada y finalizadores
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 7
- **Depende de:** T-SUGAR-001
- **Objetivo:** Implementar los sugar restantes de §9: `strings`, `reentrancy`, `finalizers` y `cycles`.
- **Archivos:** `src/RSharp.Compiler/Sugar/StringSugar.cs`, `src/RSharp.Compiler/Sugar/ReentrancySugar.cs`, `src/RSharp.Compiler/Sugar/FinalizerSugar.cs`, `src/RSharp.Compiler/Sugar/CycleSugar.cs`
- **Criterios de aceptación:**
  - `reentrancy = "serialize"` serializa el acceso en vez de entrar en pánico (§6.2).
  - `finalizers = "deterministic"` documenta que `Drop` es determinista y el GC no lo es (§6.2).
  - `cycles = "weak-attribute"` exige `[Weak]`; `leak` es la alternativa explícita (§9).
  - `strings = "utf16"` desactiva la optimización de strings (§9).
- **Notas de la revisión:** —

### T-AI-001 · Bloque `#codeGenAI`: preprocesado y sintaxis
- **Estado:** BLOCKED
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 7
- **Depende de:** T-OPEN-001
- **Objetivo:** Implementar el bloque con IA con la sintaxis que se decida en `T-OPEN-001` (§8.3).
- **Archivos:** `src/RSharp.Compiler/Ai/CodeGenAiBlock.cs`, `src/RSharp.Compiler/Ai/Preprocessor.cs`
- **Criterios de aceptación:**
  - El bloque se reconoce con la sintaxis decidida y se delimita con `#end`.
  - La IA actúa **solo** dentro del bloque (§8.3).
  - El bloque queda visible en el código como contrato (§8.3).
  - Si la opción elegida es el preprocesado (opción 3 de §8.3), el preprocesado ocurre antes de Roslyn y Roslyn ve C# válido.
  - La tarea sigue **BLOCKED** mientras `T-OPEN-001` no se cierre.
- **Notas de la revisión:** —

### T-AI-002 · Proveedor de IA: local por defecto y remoto opcional
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 7
- **Depende de:** T-AI-001
- **Objetivo:** Conectar el bloque con el proveedor configurado (§8.3, §9).
- **Archivos:** `src/RSharp.Compiler/Ai/AiProvider.cs`, `src/RSharp.Compiler/Ai/OllamaProvider.cs`
- **Criterios de aceptación:**
  - El proveedor por defecto es local (Ollama en `localhost`) (§8.3).
  - `[sugar.ai].provider`, `endpoint` y `model` se leen de `rsharp.toml` (§9).
  - Una URL remota es una opción explícita (§8.3).
  - Si el proyecto no habilita el sugar de IA, el bloque se rechaza (§8.3).
  - La clave de API, si la hay, se lee de una variable de entorno (§9).
- **Notas de la revisión:** —

### T-AI-003 · Bloqueo en `rsharp.lock` con hash del bloque
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 7
- **Depende de:** T-AI-002, T-FND-004
- **Objetivo:** Guardar el resultado y el hash del bloque para no regenerarlo sin necesidad (§8.3).
- **Archivos:** `src/RSharp.Compiler/Ai/AiBlockCache.cs`, `src/RSharp.Compiler/Locking/LockFile.cs`
- **Criterios de aceptación:**
  - El resultado y el hash del bloque se guardan en `rsharp.lock`.
  - El bloque solo se regenera si cambia el hash (§8.3).
  - Con el hash intacto no se llama al proveedor.
  - El hash cubre el contenido del bloque, el modelo y el prompt.
- **Notas de la revisión:** —

### T-AI-004 · Coste en tokens y límites
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 7
- **Depende de:** T-AI-002
- **Objetivo:** Mostrar el coste en tokens antes de generar y respetarlo (§8.3, §9).
- **Archivos:** `src/RSharp.Compiler/Ai/TokenBudget.cs`
- **Criterios de aceptación:**
  - Se estima el coste en tokens y se muestra **antes** de generar (§8.3).
  - `max_tokens_per_block` (por defecto 4000) limita cada bloque (§9).
  - Si la estimación supera el límite, la generación no empieza y el mensaje lo dice.
  - El consumo real se registra junto al resultado en `rsharp.lock`.
- **Notas de la revisión:** —

### T-AI-005 · Validación del resultado generado
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 7
- **Depende de:** T-AI-003, T-AI-004
- **Objetivo:** Comprobar que el resultado de la IA compila con `rustc` (§8.3).
- **Archivos:** `src/RSharp.Compiler/Ai/GeneratedCodeValidator.cs`
- **Criterios de aceptación:**
  - El resultado se compila con `rustc` antes de aceptarse (§8.3).
  - Si no compila, se regenera con el error como contexto o se devuelve el error al usuario.
  - El resultado aceptado se guarda en `rsharp.lock` junto a su hash.
  - El núcleo **no** usa IA en ningún punto (§8.1).
- **Notas de la revisión:** —

---

# Fase 8 — Python y host .NET

### T-PY-001 · Orden de soporte: C, luego Python, luego host .NET
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 8
- **Depende de:** T-FFI-005
- **Objetivo:** Fijar y hacer cumplir el orden de soporte de §13.
- **Archivos:** `docs/ffi/support-order.md`, `src/RSharp.Compiler/FFI/SupportOrder.cs`
- **Criterios de aceptación:**
  - El orden C → Python → host .NET está documentado y es el de las tareas.
  - La versión activa de cada interoperabilidad se indica en la documentación.
  - Ninguna tarea de una interoperabilidad se cierra antes que la anterior del mismo orden.
- **Notas de la revisión:** —

### T-PY-002 · Integración con Python (`pyo3`, GIL, `Result`)
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 8
- **Depende de:** T-FFI-008
- **Objetivo:** Completar la interoperabilidad con Python (spec §13).
- **Archivos:** `src/RSharp.Compiler/Emit/PythonCallEmitter.cs`, `docs/ffi/python.md`
- **Criterios de aceptación:**
  - El GIL se toma en cada llamada (§13).
  - Los errores de Python se convierten a `Result` y llegan al código R# como excepción (§13).
  - Las excepciones de Python conservan su mensaje.
  - `[foreign.numpy]` con `kind = "python"` y `version = ">=1.26"` se respeta (§9).
- **Notas de la revisión:** —

### T-PY-003 · Lectura de stubs `.pyi` y fallback con `#codeGenAI`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 8
- **Depende de:** T-PY-002
- **Objetivo:** Leer los stubs `.pyi` de Python y usar `#codeGenAI` si no hay (§13).
- **Archivos:** `src/RSharp.Compiler/Emit/PythonStubReader.cs`, `docs/ffi/python.md`
- **Criterios de aceptación:**
  - Con stubs `.pyi` los bindings se generan sin IA.
  - Sin stubs, la propuesta usa `#codeGenAI` y deja constancia en `rsharp.lock` (§13).
  - Los stubs se guardan en `bindings/`.
- **Notas de la revisión:** —

### T-PY-004 · Host .NET (`netcorehost` y metadatos)
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 8
- **Depende de:** T-FFI-007
- **Objetivo:** Completar la interoperabilidad con ensamblados .NET (spec §13).
- **Archivos:** `src/RSharp.Compiler/Emit/DotnetHostEmitter.cs`, `docs/ffi/dotnet.md`
- **Criterios de aceptación:**
  - Las llamadas usan `netcorehost` y el proceso exige .NET instalado (§13).
  - Los metadatos se leen con `System.Reflection.Metadata` (§13).
  - El error de ".NET no está instalado" es accionable.
  - Las conversiones de `string` en el límite copian y liberan con `Drop` (§13).
- **Notas de la revisión:** —

### T-PY-005 · Ruta NativeAOT con exportaciones C
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 8
- **Depende de:** T-PY-004
- **Objetivo:** Documentar y soportar la segunda ruta de §13: NativeAOT con exportaciones C.
- **Archivos:** `docs/ffi/dotnet.md`, `src/RSharp.Compiler/Emit/ForeignAssemblyEmitter.cs`
- **Criterios de aceptación:**
  - La documentación compara las tres rutas de §13 y recomienda transpilar el código R# (§13).
  - Un ensamblado con exportaciones C se puede llamar con el mismo camino que `[DllImport]`.
  - El hash de la librería cambia cuando cambia la versión (§13).
- **Notas de la revisión:** —

### T-PY-006 · Binarios por plataforma y hash de librerías
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 8
- **Depende de:** T-PY-005
- **Objetivo:** Gestionar el hash de cada librería y lavariación por plataforma (spec §13).
- **Archivos:** `src/RSharp.Compiler/Locking/LockFile.cs`, `docs/ffi/platforms.md`
- **Criterios de aceptación:**
  - El hash de cada librería se guarda en `rsharp.lock` (§13).
  - Una DLL nativa exige un binario por plataforma y el error lo dice (§13).
  - La documentación lista las plataformas soportadas por cada librería.
- **Notas de la revisión:** —

---

# Fase 9 — Depuración completa con CodeLLDB

### T-DBG-001 · Integración con CodeLLDB
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 9
- **Depende de:** T-VSCD-007, T-CORE-001
- **Objetivo:** Depurar el programa generado con CodeLLDB y source maps (spec §14.5).
- **Archivos:** `extension/src/debug/`, `docs/DEBUGGING.md`
- **Criterios de aceptación:**
  - CodeLLDB se lanza con el programa generado y los source maps (§14.5).
  - Un error sin source map no rompe la sesión de depuración.
  - La extensión detecta si CodeLLDB no está instalado y lo dice con un mensaje accionable.
- **Notas de la revisión:** —

### T-DBG-002 · `launch.json` para proyectos R#
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 9
- **Depende de:** T-DBG-001
- **Objetivo:** Entregar una configuración de depuración de ejemplo (spec §14.5).
- **Archivos:** `docs/launch.example.json`, `docs/DEBUGGING.md`
- **Criterios de aceptación:**
  - El ejemplo compila con `cargo`, lanza el binario y adjunta CodeLLDB.
  - La configuración usa `outputDir` y `distDir` de `rsharp.toml`.
  - El ejemplo funciona en los tres destinos soportados o documenta los que no.
- **Notas de la revisión:** —

### T-DBG-003 · Breakpoints y pila sobre archivos `.rsh`
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 9
- **Depende de:** T-DBG-001
- **Objetivo:** Que los breakpoints y la pila se muestren en el `.rsh` (spec §14.5, §17).
- **Archivos:** `extension/src/debug/SourceMapDebugger.ts`
- **Criterios de aceptación:**
  - Un breakpoint en una línea del `.rsh` se detiene en esa línea.
  - La pila de llamadas muestra archivos `.rsh` y no `.rs`.
  - Las líneas que no tienen correspondencia se muestran con la línea de Rust y una nota.
- **Notas de la revisión:** —

### T-DBG-004 · Documentación de la depuración
- **Estado:** TODO
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 9
- **Depende de:** T-DBG-002, T-DBG-003
- **Objetivo:** Documentar la depuración y cambiar el estado de §14.5 (spec §14.5).
- **Archivos:** `docs/DEBUGGING.md`, `rsharp-spec.md`
- **Criterios de aceptación:**
  - La documentación explica los pasos, los requisitos (CodeLLDB) y los límites.
  - `docs/EXTENSION.md` deja de marcar la depuración como "no implementada".
  - La spec §14.5 se actualiza con la decisión tomada.
- **Notas de la revisión:** —

---

# Resumen — Tareas por estado

| Estado | Nº de tareas | Tareas |
|---|---|---|
| TODO | 91 | Resto del backlog |
| WIP | 0 | — |
| REVIEW | 0 | — |
| DONE | 13 | `T-VSCD-001..013` |
| REWORK | 0 | — |
| BLOCKED | 1 | `T-AI-001` (espera a `T-OPEN-001`) |
| **Total** | **105** | — |

**Detalle de las tareas `DONE`:** `T-VSCD-001` (empaquetado), `T-VSCD-002` (parser TOML),
`T-VSCD-003` (configuración), `T-VSCD-004` (toolchain), `T-VSCD-005` (cliente CLI),
`T-VSCD-006` (diagnósticos), `T-VSCD-007` (source maps y parser de `rustc`),
`T-VSCD-008` (comandos), `T-VSCD-009` (barra de estado y vista lateral),
`T-VSCD-010` (gramática), `T-VSCD-011` (snippets), `T-VSCD-012` (CLI de simulación),
`T-VSCD-013` (suite de tests y empaquetado).

**Bloqueos abiertos:** `T-AI-001` espera a `T-OPEN-001`; las tareas de Fase 1 dependen de
`T-OPEN-003`, `T-OPEN-005` y `T-OPEN-006`; las de Fase 3 dependen de `T-OPEN-002`;
las de Fase 5 dependen de `T-OPEN-007`; las de Fase 6 dependen de `T-OPEN-008`.

