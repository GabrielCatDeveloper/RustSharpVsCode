# RSharp — el compilador de R#

El compilador de **R# (Rust#)**: toma C# válido (archivos `.rsh`) y genera
Rust. Es la contraparte de la extensión de VSCode, que es un cliente delgado
de esta CLI (spec §4.1, §14.1).

## Estructura

```
compiler/
├── RSharp.slnx                     Solución .NET
├── Directory.Build.props            Propiedades comunes
└── src/
    ├── RSharp.Attributes/           netstandard2.0 — los atributos de R#
    ├── RSharp.Runtime/             netstandard2.0 — diagnóstico, TOML, configuración
    ├── RSharp.Compiler/            netstandard2.0 — el transpilador (Roslyn)
    ├── RSharp.Analyzers/           netstandard2.0 — reglas del núcleo
    └── RSharp.Cli/                 net8.0 — la ejecutable `rsharp`
```

## Compilar

```bash
cd compiler
dotnet build RSharp.slnx
```

Necesitas el SDK de .NET. La CLI resultante queda en
`src/RSharp.Cli/bin/Debug/net8.0/rsharp` (o `Release`).

> La CLI tiene como destino `net8.0` (spec §4.2) y `RollForward=Major`, así
> que también funciona con un runtime más reciente.

## Uso

```bash
rsharp transpile --project . [--output <dir>] [--json]
rsharp build     --project . [--profile debug|release] [--target <t>] [--dist <dir>] [--json]
rsharp run       --project . [--target <t>] [--profile <p>] [--json]
rsharp clean     --project . [--output <dir>] [--dist <dir>] [--json]
rsharp --version
```

Con `--json` se imprime un único objeto con la forma `RSharpCliEnvelope`, que
es la que consume la extensión de VSCode (ver `docs/CLI-CONTRACT.md`).

Destinos: `native`, `wasm32-unknown-unknown`, `wasm32-wasip1`.

## La API pública

La spec §4.3 la fija así, y así está implementada:

```csharp
public static TranspileResult Run(
    IReadOnlyDictionary<string, string> sources,
    TranspileOptions options);
```

- La entrada es un diccionario de nombre de archivo y texto.
- La salida contiene los archivos Rust, los diagnósticos y los source maps.
- El transpilador **no** usa `System.IO`, red ni reloj: recibe texto y
  devuelve texto (spec §4.2).

## Cómo funciona

1. **Roslyn analiza** cada `.rsh` como C# válido (`CSharpSyntaxTree`).
2. Se crea una `CSharpCompilation` para obtener el **modelo semántico**: los
   tipos, los símbolos y el punto de entrada salen de ahí, no de inferencias
   propias. La spec §4.1 dice que el transpilador no implementa un verificador
   de tipos: usa el de Roslyn.
3. El **emisor** (`RustEmitter`) recorre la sintaxis y escribe Rust **alineado
   línea a línea** con el `.rsh` de origen.
4. Se emiten los **source maps** (decisión 0005): línea de Rust ↔ línea de R#.

El Rust alineado tiene dos ventajas: el source map es trivial y el remapeo de
rutas de LLDB (`target.source-map remap`) hace que los puntos de parada en el
`.rsh` resuelvan en la línea correcta.

## Estado

| Área | Estado |
|---|---|
| API pública, atributos, runtime, CLI | Hecho |
| Frontend con Roslyn | Hecho |
| `enum`, `struct`, `class`, `interface`, `Box<dyn Trait>` | Hecho |
| `try`/`catch`/`throw` como `Result` interno | Hecho |
| LINQ (`Where`, `Select`, `ToList`, `Sum`) | Hecho |
| `for`, `foreach`, `if`, `while` | Hecho |
| Auto-propiedades, constructores, métodos estáticos | Hecho |
| Herencia de clases con `virtual`/`override` | Pendiente |
| Genéricos, `record`, `operator`, eventos, `async` | Pendiente |
| `unsafe`, punteros, `fixed`, `stackalloc` | Pendiente |
| Analizadores `R#0101` (BCL) y `R#0150` (WASM) | Pendiente |

El subconjunto exacto está en `docs/decisions/0003-core-v1-subset.md`.

## Pruebas

El proyecto de ejemplo es la prueba de extremo a extremo:

```bash
cd ../examples/rsharp-demo
node tests/run-tests.mjs
```

Comprueba que la transpilación, la compilación con `cargo` y la ejecución
producen la salida esperada, que la salida de .NET y la de Rust coinciden
(prueba diferencial, spec §4.1) y que el mini-transpilador y este
compilador dan el mismo resultado.
