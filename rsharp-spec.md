# Especificación técnica de R# (RSharp)

Documento para lectura por una IA. Contiene todas las decisiones de diseño acordadas.

## 0. Cómo leer este documento

- Las reglas usan los verbos DEBE, NO DEBE y PUEDE.
- "Núcleo" significa transpilación determinista.
- "Sugar" significa una concesión explícita del programador.
- Una decisión marcada como REEMPLAZADA ya no vale.
- Una decisión marcada como ABIERTA exige resolución.

## 1. Objetivo

- R# es un lenguaje con sintaxis y semántica de C#.
- R# se transpila a Rust al 100%.
- El programador escribe C#. No escribe Rust.
- El código Rust generado es un producto intermedio. Nadie lo lee.
- El código generado PUEDE ser largo si eso mejora el rendimiento o la corrección.
- El mismo código `.rsh` produce un ejecutable nativo o un `.wasm`.

## 2. Principios de diseño

1. R# imita C#. Lo que C# omite, R# lo omite.
2. R# oculta ownership, borrowing y lifetimes. El transpilador los decide.
3. R# incluye `unsafe`, punteros, `fixed` y `stackalloc` como C#.
4. El núcleo es determinista. La misma entrada produce la misma salida.
5. Lo determinista, aunque genere más código, pertenece al núcleo.
6. El sugar exige que el programador acepte una condición por escrito.
7. Ningún comportamiento cambia en silencio.
8. Todo es local. No hay servicios de red obligatorios.

## 3. Archivos y extensiones

| Archivo | Función |
|---|---|
| `*.rsh` | Código fuente R#. Es C# válido. |
| `rsharp.toml` | Configuración única del proyecto. |
| `rsharp.lock` | Resultados de IA, hashes y versiones fijas. |
| `bindings/` | Bindings generados. El programador PUEDE editarlos. |
| `target/rsharp/` | Rust generado por defecto. |
| `dist/` | Binario compilado por defecto. |

- La extensión `.rsh` evita el conflicto con rust-analyzer.
- Un proyecto PUEDE mezclar `.rs` escritos a mano y `.rsh`.
- Confirma `rsharp.toml` y `rsharp.lock` en git.

## 4. Arquitectura

### 4.1 Frontend: C# con Roslyn

- Cada `.rsh` se trata como C# válido.
- Roslyn parsea y ofrece el modelo semántico.
- El transpilador NO implementa un verificador de tipos propio.
- Analizadores Roslyn rechazan lo que el núcleo no soporta.
- Se compila un binario de referencia con `dotnet build`.
- La prueba diferencial compara la salida de .NET con la del Rust generado.

### 4.2 Solución de proyectos

| Proyecto | Destino | Contenido |
|---|---|---|
| `RSharp.Attributes` | netstandard2.0 | Atributos como `[Export]` y `[Extern]`. |
| `RSharp.Runtime` | netstandard2.0 | Tipos de apoyo. |
| `RSharp.Compiler` | netstandard2.0 | Transpilador. Referencia Roslyn. |
| `RSharp.Analyzers` | netstandard2.0 | Reglas Roslyn del núcleo. |
| `RSharp.Cli` | net8.0 | Ejecutable de línea de comandos. |

- `RSharp.Compiler` NO DEBE usar `System.IO`, red ni reloj.
- `RSharp.Compiler` recibe texto y devuelve texto.
- Se publica `RSharp.Attributes` como paquete NuGet.

### 4.3 API del compilador

```csharp
public static class Transpiler {
    public static TranspileResult Run(
        IReadOnlyDictionary<string, string> sources,
        TranspileOptions options);
}
```

- La entrada es un diccionario de nombre de archivo y texto.
- La salida contiene archivos Rust, diagnósticos y source maps.

### 4.4 Aclaración sobre WASM (REEMPLAZA decisiones previas)

- El transpilador NO corre en WASM.
- El transpilador corre como DLL o CLI en .NET.
- WASM es un destino del programa generado.
- Ruta: `.rsh` → Rust → `cargo build --target wasm32-*` → `.wasm`.
- REEMPLAZADO: Blazor WebAssembly, Web Worker y `RSharp.Wasm`.
- REEMPLAZADO: transpilador en Rust compilado a `wasm32-wasip1`.

### 4.5 Dependencias del usuario

- .NET SDK o runtime para ejecutar el transpilador.
- Toolchain de Rust (`rustup`, `cargo`) para compilar.
- Ollama u otro modelo, solo si se usa `#codeGenAI`.

## 5. Mapeo de C# a Rust (núcleo)

| R# (C#) | Rust generado |
|---|---|
| `class` | `Rc<RefCell<T>>` (modo seguro) |
| `struct` | `struct` por valor |
| `ref`, `in`, `out` | `&mut`, `&`, `&mut` |
| `T?`, `null` | `Option<T>` |
| `interface` | `trait` |
| propiedades | métodos `get` y `set` |
| método `static` | función asociada en `impl` |
| método de instancia | método con `&self` o `&mut self` |
| método de extensión | `trait` más `impl` para el tipo |
| `event` | `Vec<(u32, Box<dyn FnMut>)>` con ids |
| `delegate`, lambda | `Box<dyn Fn>` o `impl Fn` |
| herencia de clase | campo `base` más `trait` |
| `virtual`, `override` | métodos de `trait` |
| `abstract class` | `trait` más `struct` de datos |
| `where T : IFoo` | `where T: Foo` |
| `where T : new()` | `where T: Default` |
| `is`, `as` | `downcast` con `Any` |
| `enum` | `enum` con `#[repr(i32)]` |
| `record` | `struct` con `PartialEq` y `Clone` |
| `operator +` | `impl Add` |
| `IDisposable`, `using` | `impl Drop` y bloque de ámbito |
| `namespace` | `mod` |
| LINQ | iteradores |
| `switch` | `match` |
| `string` | `Rc<str>` o `String` según análisis |
| `List<T>` | `Vec<T>` |
| `Dictionary<K,V>` | `HashMap<K,V>` |
| `try/catch`, `throw` | `Result` interno, `panic` en el resto |
| `async/await` | `async fn` con `tokio` |
| hilos | `Arc<Mutex<T>>` |
| `unsafe`, `int*`, `fixed` | `unsafe`, `*mut i32`, bloque `unsafe` |
| `stackalloc` | arreglo en el stack |

### 5.1 Reglas de `struct`

- Un `struct` de Rust es un valor. No es una referencia.
- Deriva siempre `Clone`.
- Deriva `Copy` si todos los campos son `Copy`.
- Inserta `.clone()` en asignaciones de `struct` sin `Copy`.
- Conserva `class` y `struct` como en C#.

### 5.2 Otras reglas del núcleo

- Sobrecarga: renombra cada método (`suma_i32`, `suma_f64`).
- Argumentos opcionales y con nombre: rellena en el sitio de llamada.
- Conversiones implícitas: inserta `From` en la llamada.
- Clases `partial`: une las partes antes de generar.
- Estado `static` por genérico: guarda un mapa por `TypeId`.
- Referencias circulares: usa `Weak` donde el análisis lo exija.
- Genera `unsafe` solo si el código fuente lo marca.

## 6. Lo imposible o costoso

### 6.1 Imposible en Rust

- `Reflection.Emit` y `Assembly.Load`.
- `dynamic` nativo.
- Reflection completa sin tablas generadas.
- Carreras de datos permitidas en código seguro.
- GC automático de ciclos con `Rc`.

### 6.2 Posible con costo

- Reentrada en objetos: `RefCell` entra en pánico con doble `borrow_mut`.
- Genéricos reificados: usa `TypeId` y exige `'static`.
- Covarianza de genéricos: inserta conversiones explícitas.
- Strings UTF-16: `Length` y `s[i]` difieren en UTF-8.
- Aritmética: C# envuelve el desbordamiento. Rust usa pánico en debug.
- Finalizadores: `Drop` es determinista. El GC no lo es.
- Hilos: `Rc` no cruza hilos. Usa `Arc`.

### 6.3 Rust necesita lo que C# no tiene

- Lifetimes: infiere o elimina con `Rc` y `clone`.
- Movimiento: detecta usos tras el movimiento.
- `&` contra `&mut`: decide en cada `ref`.
- `mut` en variables: detecta modificaciones.
- `Copy` contra `Clone`: deriva según los campos.
- `Box<dyn T>` contra genéricos: elige despacho.
- `Send` y `Sync`: calcula seguridad entre hilos.
- `Rc` contra `Arc`: elige según el uso de hilos.
- Slices: mapea `Span<T>` a `&[T]`.

## 7. Estrategia de optimización

- El modo seguro usa `Rc<RefCell>` en todas partes. Es la referencia.
- El modo optimizado aplica análisis de programa completo.
- Las pruebas comparan ambos modos.
- `[NoOptimize]` desactiva pasos en un método.

Pasos de optimización:

1. Análisis de escape: objeto local pasa a `struct` en el stack.
2. Último uso: genera movimiento en lugar de `.clone()`.
3. Análisis de aliasing: genera `&mut` y elimina `RefCell`.
4. Análisis de hilos: genera `Rc` o `Arc`.
5. Desvirtualización: una sola implementación genera despacho estático.
6. Clases `sealed`: llamadas directas con `#[inline]`.
7. Arena: grafos de vida común usan índices en un `Vec`.
8. Strings: usa `&str` o `String` si no hay indexación UTF-16.
9. Aritmética: `unchecked` genera `wrapping_*`. `checked` genera `checked_*`.
10. LINQ: fusiona cadenas en un solo iterador.
11. Bucles: reescribe `for` con índice como iteradores.
12. Async: genera máquina de estados sin `Box`.
13. Excepciones: genera `Result` con `?` si todos los `throw` son conocidos.
14. Layout: reordena campos. Respeta `StructLayout`.
15. Eventos: un solo suscriptor usa `Option<Box<dyn FnMut>>`.

Requisitos: grafo de llamadas, flujo de datos, escape y aliasing.
Riesgo: un análisis incorrecto genera Rust incorrecto bajo `unsafe`.

## 8. Núcleo y sugar

### 8.1 Núcleo v1

Incluye todo lo determinista:

- `struct`, `class`, `enum`, `interface`, genéricos.
- Herencia, `virtual`, `override`.
- Sobrecarga y argumentos opcionales.
- Eventos y delegados.
- Excepciones con `Result` interno.
- Conversiones implícitas.
- Clases `partial`.
- `async/await` con `tokio`.
- Hilos con `Arc<Mutex>`.
- `unsafe` y punteros.

Reglas:

- El núcleo NO DEBE usar IA.
- El núcleo rechaza con error lo que no soporta.
- El código generado PUEDE ser más largo.

### 8.2 Sugar

Sugar es lo que exige una condición del programador.

| Tipo | Ejemplo |
|---|---|
| Restricción de estilo | Campo `[Weak]` para ciclos. |
| Pérdida de semántica | Desbordamiento con pánico. |
| Bloque con IA | `#codeGenAI`. |

Reglas:

- Sin configuración, el sugar queda apagado.
- Un programador NO DEBE activar sugar sin escribir algo.
- Cada concesión queda visible en el código o en `rsharp.toml`.
- El compilador avisa cuando el código exige sugar.
- Ejemplo de aviso: `R#0042: usa [Weak] en este campo o activa #codeGenAI`.

### 8.3 Bloques con IA

```csharp
#codeGenAI(mode: "dynamic", cost: "tokens") "convierte esta reflection a tabla estática"
var props = obj.GetType().GetProperties();
#end
```

Reglas:

- La IA actúa solo dentro del bloque.
- Guarda el resultado y el hash del bloque en `rsharp.lock`.
- Regenera solo si cambia el hash.
- El resultado DEBE compilar con `rustc`.
- Muestra el coste en tokens antes de generar.
- Deja el bloque visible como contrato.
- Rechaza `#codeGenAI` si el proyecto no lo habilita.
- Usa un modelo local por defecto (Ollama en `localhost`).
- Permite una URL remota como opción.

ABIERTO: `#codeGenAI` y `#end` no son directivas C# válidas.
Roslyn las rechaza. Elige una de estas opciones:

1. Usa `#if RSHARP_AI` y `#endif`.
2. Usa un atributo sobre el método.
3. Preprocesa los `.rsh` antes de Roslyn.

## 9. Configuración: `rsharp.toml`

```toml
schema = 1

[project]
name = "mi_app"

[paths]
output = "gen"
dist = "bin"

[build]
target = "native"            # native | wasm32-unknown-unknown | wasm32-wasip1

[sugar]
strings = "utf8"
overflow = "panic"
reentrancy = "panic"
finalizers = "deterministic"
cycles = "weak-attribute"

[sugar.ai]
enabled = true
provider = "ollama"
endpoint = "http://localhost:11434"
model = "qwen2.5-coder"
lock = "rsharp.lock"
max_tokens_per_block = 4000

[plugins]
# lista ordenada

[dependencies]
serde_json = "1.0"
rand = { version = "0.8", features = ["small_rng"] }

[foreign.mylib]
kind = "native"
path = "libs/mylib.dll"
header = "libs/mylib.h"
link = "dynamic"

[foreign.numpy]
kind = "python"
version = ">=1.26"

[profile.release.sugar]
overflow = "wrap"
```

Reglas:

- Los valores por defecto son estrictos.
- Se sobrescribe por archivo con `[assembly: RSharpSugar("overflow", "wrap")]`.
- Se sobrescribe por método con el mismo atributo.
- Gana el ámbito más cercano al código.
- La clave de API vive en una variable de entorno.
- Un esquema JSON valida el archivo.
- `rsharp.lock` guarda el hash de la configuración de sugar.
- Un cambio de valor invalida los bloqueos afectados.
- Selecciona el perfil con `rsharp build --profile release`.
- Genera `Cargo.toml` desde `rsharp.toml`.

## 10. Biblioteca estándar (BCL)

- R# soporta una lista cerrada de tipos de `System.*`.
- Lista inicial: `List<T>`, `Dictionary<K,V>`, `string`, `Math`, `Console`, `File`.
- Un analizador Roslyn rechaza tipos fuera de la lista.
- La lista crece con cada versión.
- El mapeo depende del destino (`target`).

| BCL | Rust nativo | Rust WASM navegador |
|---|---|---|
| `Console.WriteLine` | `println!` | `console.log` vía `web-sys` |
| `File.ReadAllText` | `std::fs::read_to_string` | no soportado |
| `Thread.Sleep` | `std::thread::sleep` | rechazado |

- Emite diagnóstico para APIs no soportadas.
- Ejemplo: `R#0101: File.ReadAllText no existe en wasm32-unknown-unknown`.

## 11. Destino WASM

- Se activa con `build.target` en `rsharp.toml`.
- `[WasmExport]` marca funciones visibles desde JavaScript.
- El transpilador genera `#[wasm_bindgen]` para ellas.
- `string` cruza el límite como `String`.
- Una `class` exportada usa una estructura envoltorio. `Rc<RefCell>` no es válido ahí.
- `async` usa `wasm-bindgen-futures`.
- Hilos: evítalos en la v1.
- `panic` usa `console_error_panic_hook`.
- Las DLL dinámicas no cargan en `wasm32-unknown-unknown`.
- Compila C a WASM con enlace estático.
- `[PythonModule]` se rechaza en la v1 (`R#0150`).

## 12. Crates de Rust

Uso en R#:

```csharp
using Rand;
var rng = new ThreadRng();
int n = rng.NextInt(1, 100);
```

Fuentes de bindings:

1. Manual con `[Extern("ruta::del::item")]`.
2. Generado con `rsharp bind <crate>` desde `rustdoc` JSON.
3. Paquetes NuGet preenlazados.

| Rust | R# |
|---|---|
| `Option<T>` | `T?` |
| `Result<T, E>` | `T` con excepción `E` |
| `&str`, `String` | `string` |
| `&[T]`, `Vec<T>` | `Span<T>`, `List<T>` |
| `&mut T` | `ref T` |
| `trait` | `interface` |
| `enum` con datos | jerarquía de `record` |
| `impl Trait` | genérico con `where` |
| `Box<dyn T>` | interfaz |
| macros | método con `[RustMacro]` |
| lifetimes | se infieren u omiten |

Reglas:

- Guarda los bindings en `bindings/`.
- Guarda el hash de la API de cada crate en `rsharp.lock`.
- Avisa si una versión nueva cambia la API.
- Verifica los bindings con `cargo check`.
- Usa `[Borrowed]` o `clone` para lifetimes ligados a argumentos.
- Rechaza crates con `unsafe` o FFI, salvo bloque `unsafe` explícito.
- Un crate con `async` exige el runtime elegido en `rsharp.toml`.
- Rechaza crates sin soporte `wasm32` en ese destino.
- Usa `#codeGenAI` para crates sin binding automático.

## 13. Librerías externas (FFI)

| Origen | Sintaxis R# | Rust generado |
|---|---|---|
| DLL nativa (C, C++) | `[DllImport]` | `extern "C"` y `libloading` |
| C con cabecera | `rsharp bind --c lib.h` | `bindgen` |
| DLL de .NET | `[ForeignAssembly]` | `netcorehost` |
| Python | `[PythonModule]` | `pyo3` |
| Java | `[JavaClass]` | crate `jni` |
| Go, Zig, otros | `[DllImport]` | ABI de C |

Rutas para una DLL de .NET:

1. Transpilar el código fuente R#. Es la mejor opción.
2. NativeAOT con exportaciones C.
3. Host .NET desde Rust. Exige .NET instalado.

Reglas del límite:

- Copia los `string` al cruzar. Libera con `Drop`.
- Marca punteros devueltos con `[Owned]` o `[Borrowed]`.
- Convierte callbacks a `extern "C" fn` con contexto.
- Convierte errores de Python a `Result`.
- Exige `unsafe` en llamadas nativas. Envuélvelas en métodos seguros.
- Toma el GIL de Python en cada llamada.
- Lee metadatos .NET con `System.Reflection.Metadata`.
- Lee stubs `.pyi` de Python. Sin stubs, usa `#codeGenAI`.
- Guarda el hash de cada librería en `rsharp.lock`.
- Una DLL nativa exige un binario por plataforma.

Orden de soporte: C, luego Python, luego host .NET.

## 14. Integración con VSCode

### 14.1 Piezas

- Extensión de VSCode como cliente delgado.
- Gramática TextMate para `.rsh`.
- Para empezar, asocia `.rsh` al resaltado de C#.
- Autocompletado y diagnósticos vienen de C# Dev Kit y Roslyn.
- Un servidor LSP propio es opcional y posterior.
- La extensión ejecuta `dotnet` para transpilar.
- La extensión ejecuta `cargo` para compilar.

### 14.2 Comandos

| Comando | Acción |
|---|---|
| `R#: Transpile` | Genera Rust en `outputDir`. |
| `R#: Build` | Transpila y compila en `distDir`. |
| `R#: Build Release` | Compila con optimizaciones. |
| `R#: Build WASM` | Compila a `.wasm`. |
| `R#: Run` | Compila y ejecuta. |
| `R#: Choose Output Folder` | Selecciona `outputDir`. |
| `R#: Choose Dist Folder` | Selecciona `distDir`. |
| `R#: Clean` | Borra `outputDir` y `distDir`. |

### 14.3 Interfaz

- Botones `Transpile`, `Build` y `Run` en la barra de estado.
- Submenú R# en el clic derecho de archivos `.rsh`.
- Vista lateral con las rutas actuales.

### 14.4 Rutas de salida

- `outputDir` y `distDir` son independientes.
- `outputDir` y `distDir` NO DEBEN ser la misma carpeta.
- `rsharp.toml` tiene prioridad sobre los ajustes de VSCode.
- Rechaza rutas fuera del workspace sin confirmación.
- Crea `outputDir` con su `Cargo.toml` y `.gitignore`.
- Verifica que `rustc` exista antes de `Build`.
- Ejecuta `cargo build --target-dir <distDir>`.
- Muestra el progreso en el panel de salida `R#`.
- Traduce errores de `rustc` a líneas de R# con source maps.

### 14.5 Depuración

- Usa CodeLLDB con source maps.
- Entrega la depuración en una versión posterior.

## 15. Proyectos mixtos Rust y R#

- Declara cada `.rsh` como módulo en el `Cargo.toml` generado.
- Un `.rsh` PUEDE llamar a un `.rs` escrito a mano con `[Extern]`.
- Un `.rs` PUEDE llamar a un tipo `.rsh` marcado con `[Export]`.
- `[Export]` genera una API estable.
- Documenta que una `class` exportada es `Rc<RefCell<T>>`.
- Excluye `target/rsharp/` de rust-analyzer si molesta.

## 16. Plugins

- Un plugin reescribe R# avanzado a R# del núcleo.
- Un plugin declara las construcciones que reescribe.
- Un plugin declara las construcciones que produce.
- Un plugin declara su coste en rendimiento, tamaño y tokens.
- Un plugin declara sus dependencias.
- `rsharp.toml` define el orden explícito de los plugins.
- Cada plugin exige pruebas propias.
- La optimización de programa completo corre después de los plugins.

## 17. Diagnósticos

| Código | Significado |
|---|---|
| `R#0042` | El código exige un sugar apagado. |
| `R#0101` | API no soportada en el destino. |
| `R#0150` | Destino sin soporte de librerías dinámicas. |

- Cada diagnóstico indica la directiva o ajuste necesario.
- Cada diagnóstico apunta a la línea de R#, no a la de Rust.

## 18. Riesgos conocidos

- El núcleo debe ser estable. Cambiarlo rompe los plugins.
- Dos plugins pueden reescribir la misma construcción.
- Un análisis de optimización incorrecto genera Rust inseguro.
- Compilar Rust grande tarda.
- Los source maps deben ser precisos.
- Las bibliotecas NuGet de terceros no tienen versión Rust.
- Los ciclos funcionan en .NET y filtran memoria en Rust.
- Pueden diferir casos límite entre .NET y Rust (UTF-16, desbordamiento).
- Roslyn y .NET deben estar instalados para transpilar.

## 19. Decisiones abiertas

1. Sintaxis final de `#codeGenAI` compatible con Roslyn (sección 8.3).
2. Lista exacta de tipos de la BCL de la v1.
3. Subconjunto exacto de C# del núcleo v1.
4. Sintaxis de `[Weak]`, `[Borrowed]` y `[Owned]`.
5. Formato del source map.
6. Esquema JSON completo de `rsharp.toml`.
7. Flujo de `rsharp bind` por cada origen.
8. Estrategia de pruebas diferenciales entre .NET y Rust.

## 20. Orden de construcción sugerido

1. Define el subconjunto de C# del núcleo v1.
2. Escribe `RSharp.Attributes` y `RSharp.Analyzers`.
3. Escribe `RSharp.Compiler` en modo seguro (`Rc<RefCell>`).
4. Escribe `RSharp.Cli` con `transpile` y `build`.
5. Añade `rsharp.toml`, `rsharp.lock` y source maps.
6. Escribe la extensión de VSCode con los comandos.
7. Añade el mapeo de la BCL por destino.
8. Añade el destino WASM.
9. Añade bindings de crates y FFI de C.
10. Añade las optimizaciones una por una.
11. Añade plugins, sugar y `#codeGenAI`.
12. Añade Python y el host .NET.
13. Añade depuración.
