# Decisiones abiertas de la spec (§19)

La spec §19 lista **ocho decisiones abiertas**. Este directorio las resuelve
una a una, con el mismo formato: contexto, decisión, consecuencias,
alternativas descartadas y cómo se usa el documento.

Estas decisiones son la **Fase 0** del roadmap: la spec dice que la fase 0
«desbloquea todas las demás». Con las ocho cerradas, el núcleo del transpilador
(la Fase 1) deja de tener decisiones que tomar mientras se escribe.

## Catálogo

| # | Decisión | Estado | Documento |
|---|---|---|---|
| 1 | Sintaxis de `#codeGenAI` compatible con Roslyn | ✅ Aceptada | [0001-codeGenAI-syntax.md](0001-codeGenAI-syntax.md) |
| 2 | Lista exacta de tipos de la BCL v1 | ✅ Aceptada | [0002-bcl-v1-types.md](0002-bcl-v1-types.md) |
| 3 | Subconjunto exacto de C# del núcleo v1 | ✅ Aceptada | [0003-core-v1-subset.md](0003-core-v1-subset.md) |
| 4 | Sintaxis de `[Weak]`, `[Borrowed]` y `[Owned]` | ✅ Aceptada | [0004-lifetime-attributes.md](0004-lifetime-attributes.md) |
| 5 | Formato del source map | ✅ Aceptada | [0005-source-map-format.md](0005-source-map-format.md) |
| 6 | Esquema JSON completo de `rsharp.toml` | ✅ Aceptada | [0006-rsharp-toml-schema.md](0006-rsharp-toml-schema.md) |
| 7 | Flujo de `rsharp bind` por cada origen | ✅ Aceptada | [0007-bind-flow.md](0007-bind-flow.md) |
| 8 | Estrategia de pruebas diferenciales | ✅ Aceptada | [0008-differential-testing.md](0008-differential-testing.md) |

## Resumen de lo decidido

| Decisión | En una línea |
|---|---|
| **#codeGenAI** | Se usa `#if RSHARP_AI` + `#if codeGenAI(...)` … `#endif`: es C# válido y se puede depurar con las herramientas estándar. |
| **BCL v1** | Lista cerrada de tipos y APIs de `System.*`, con su equivalente en Rust nativo y en WASM. |
| **Núcleo v1** | 82 construcciones de C# clasificadas como soportadas, parciales o rechazadas, con el coste que Rust impone. |
| **Atributos de ciclo de vida** | `[Weak]` (campos), `[Borrowed]` y `[Owned]` (parámetros y retornos), como atributos sin argumentos con `AttributeUsage` explícito. |
| **Source map** | Línea a línea: `{ rustLine, rshLine }`, con resolución por «la entrada más cercana anterior». |
| **Esquema de `rsharp.toml`** | JSON Schema draft-07 publicado por la extensión: el editor valida y autocompleta el fichero. |
| **`rsharp bind`** | Siete orígenes; el FFI se parece al de C# (`[DllImport]`, `[ForeignAssembly]`…), no al de Rust. |
| **Pruebas diferenciales** | Tres niveles: banco de casos, diferencial automático .NET ↔ Rust, y casos generados. |

## Decisiones que ha了下taken estas decisiones

Estas decisiones **amplían la spec** y habría que incorporarlas a `rsharp-spec.md`
cuando se actualice:

| Ampliación | Decisión |
|---|---|
| Nuevo código de diagnóstico `R#0001` (construcción fuera del núcleo v1) | [0003](0003-core-v1-subset.md) |
| `rsharp.lock` con hash de la API de cada crate y de cada librería | [0007](0007-bind-flow.md) |
| `[sugar.ai]` como forma canónica de la configuración de IA (la raíz `[ai]` queda como alias) | [0006](0006-rsharp-toml-schema.md) |
| El FFI de R# usa la misma superficie que C# | [0007](0007-bind-flow.md) |

## Cómo se usa este directorio

Cada decisión se escribe antes de implementar lo que afecta, para que el
código no tenga que adivinar. Cuando una decisión cambie, se edita **su
documento** (no se borra): el historial de por qué importa tanto como la
decisión.
