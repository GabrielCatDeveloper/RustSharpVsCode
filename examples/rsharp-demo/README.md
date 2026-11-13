# rsharp-demo — proyecto de ejemplo de R#

Proyecto de ejemplo que usa **todo lo que la extensión de VSCode puede hacer**
con un proyecto R#.

```
rsharp-demo/
├── rsharp.toml            configuración del proyecto (spec §9)
├── src/
│   ├── Model.rsh           enumeración, interfaz, estructura, clases
│   ├── Utilities.rsh       clase estática con utilidades
│   └── Program.rsh         punto de entrada: consola, LINQ, try/catch
└── tests/
    ├── expected-output.txt salida esperada del binario
    └── run-tests.mjs       arnés de pruebas del flujo completo
```

## Qué demuestra

| Construcción de R# | Dónde | Qué se genera en Rust |
|---|---|---|
| `enum` | `Model.rsh` | `#[repr(i32)] enum Status` con `Display` |
| `interface` | `Model.rsh` | `trait IShape` |
| `class` que implementa una interfaz | `Model.rsh` | `struct Circle` + `impl IShape for Circle` (`Box<dyn IShape>`) |
| `struct` | `Model.rsh` | `struct Point` por valor |
| Auto-propiedades | `Model.rsh` | campo + `get`/`set` |
| Clase estática | `Utilities.rsh` | `impl Utilities` con funciones asociadas |
| `List<T>` | `Program.rsh` | `Vec<T>` |
| LINQ (`Where`, `Select`, `ToList`) | `Program.rsh` | cadena de iteradores |
| `try` / `catch` / `throw` | `Program.rsh`, `Utilities.rsh` | `Result<T, String>` con `?` |
| `Math.PI`, `ToString("F2")` | varios | `std::f64::consts::PI`, `format!("{:.2}", …)` |
| Bucle `for` / `foreach` / `if` | varios | `for … in`, `if` |

## Cómo probarlo

```bash
# El arnés completo (transpila, compila, ejecuta y compara con .NET)
node tests/run-tests.mjs

# A mano, con la CLI de simulación
node ../../extension/tools/mock-rsharp.mjs transpile --project .
node ../../extension/tools/mock-rsharp.mjs build --project .
node ../../extension/tools/mock-rsharp.mjs run --project .
```

## La prueba diferencial (spec §4.1)

El arnés compila **el mismo `.rsh` como C#** con el SDK de .NET y compara la
salida de los dos binarios:

```
✓ el mismo código compila como C#
✓ la salida de .NET coincide con la de Rust
```

Esa comparación ya ha encontrado dos problemas reales:

1. **Faltaba `using System.Linq;`**: el código del ejemplo no era C# válido.
2. **La cultura numérica**: .NET formatea `1,50` (cultura local) y Rust
   siempre `1.50`. El ejemplo fija `CultureInfo.InvariantCulture` para que las
   dos salidas coincidan; es el tipo de diferencia de casos límite que avisa la
   spec §18.

> Cuando exista el compilador real (`RSharp.Cli`), este arnés pasa a ser la
> prueba diferencial del proyecto: el mismo código, ejecutado por .NET y por
> Rust, debe dar la misma salida.

## Nota sobre el transpilador

El proyecto se compila con `extension/tools/mock-rsharp.mjs`, que usa
`extension/tools/transpile.mjs`: un **mini-transpilador** escrito para este
ejemplo, no el compilador R# (que todavía no existe). Está limitado al
subconjunto que usa el ejemplo y **falla con un error claro** (`R#0101`) si
encuentra algo que no soporta.
