---
name: rsharp-wasm-and-ffi
description: Úsala cuando el usuario pida añadir el destino WASM de R# (WasmExport, wasm-bindgen, web-sys, wasm-bindgen-futures, console_error_panic_hook), enlazar una librería externa o un crate de Rust (Extern, DllImport, extern "C", libloading, bindgen, pyo3, netcorehost, jni), generar bindings de crates, o resolver el diagnóstico R#0150 de destino sin soporte de librerías dinámicas.
---

# WASM y FFI en R#: destinos externos y librerías nativas

## Cuándo usar esta skill

- Hay que **emitir** para el destino WASM (`wasm32-unknown-unknown`,
  `wasm32-wasip1`).
- Hay que **enlazar** una librería externa: C/C++ nativo, Python, .NET, Java, o
  un crate de Rust.
- Hay que **generar bindings** (`rsharp bind <crate>`, `rsharp bind --c lib.h`).
- Aparece `R#0150` (destino sin soporte de librerías dinámicas) o hay que
  respetar el **límite de punteros y `string`**.

## Contexto del proyecto

- **Spec:** §11 (destino WASM), §12 (crates de Rust), §13 (librerías externas),
  §9 (`rsharp.toml`), §17 (`R#0150`), §15 (proyectos mixtos Rust y R#).
- **Decisiones abiertas que bloquean este trabajo:** `T-OPEN-007` (flujo de
  `rsharp bind` por cada origen) y `T-OPEN-004` (sintaxis de `[Borrowed]` y
  `[Owned]`). Sin cerrarlas, la tarea queda `BLOCKED` para el diseño del flujo
  de bindings.
- **Orden de soporte (§13):** C, luego Python, luego host .NET.
- **Límites de §11:** el transpilador **no** corre en WASM (§4.4); WASM es un
  destino del programa generado; `[PythonModule]` se rechaza en la v1 con
  `R#0150`; los hilos se evitan en la v1; las DLL dinámicas no cargan en
  `wasm32-unknown-unknown`.

## Procedimiento

### Parte A · Destino WASM

**A1 · Activar el destino.** `build.target` en `rsharp.toml`:

```toml
[build]
target = "wasm32-unknown-unknown"   # native | wasm32-unknown-unknown | wasm32-wasip1
```

El `Cargo.toml` generado incluye el perfil WASM y las dependencias
(`wasm-bindgen`, `web-sys` cuando se usan `Console` o el DOM).

**A2 · Exportar funciones.** Solo lo marcado con `[WasmExport]` se exporta y el
nombre exportado es único en el módulo (§11):

```csharp
[WasmExport]
public static int Suma(int a, int b) => a + b;
```

```rust
#[wasm_bindgen]
pub fn suma(a: i32, b: i32) -> i32 { a + b }
```

**A3 · Cruzar el borde.** Un `string` cruza el límite como `String`; una
`class` exportada usa una **estructura envoltorio**, porque `Rc<RefCell<T>>` no
es válido en el borde (§11):

```rust
#[wasm_bindgen]                       // envoltorio, no Rc<RefCell<T>>
pub struct Contador { valor: i32 }
```

**A4 · Runtime y límites.** `async` → `wasm-bindgen-futures`; `panic` →
`console_error_panic_hook`; hilos fuera de la v1 (diagnóstico explicativo);
`[PythonModule]` → `R#0150`; `wasm32-wasip1` tiene sistema de ficheros y usa
enlace estático para el C compilado a WASM (§11).

### Parte B · Librerías externas (FFI, §13)

| Origen | Sintaxis R# | Rust generado |
|---|---|---|
| DLL nativa (C, C++) | `[DllImport]` | `extern "C"` y `libloading` |
| C con cabecera | `rsharp bind --c lib.h` | `bindgen` |
| DLL de .NET | `[ForeignAssembly]` | `netcorehost` |
| Python | `[PythonModule]` | `pyo3` |
| Java | `[JavaClass]` | crate `jni` |
| Go, Zig, otros | `[DllImport]` | ABI de C |

**B1 · DLL nativa.** La llamada nativa exige `unsafe` y se envuelve en un
método seguro (§13):

```csharp
[DllImport("libs/mylib.dll")]
public static extern int suma(int a, int b);
```

```rust
extern "C" { fn suma(a: i32, b: i32) -> i32; }
pub fn suma_segura(a: i32, b: i32) -> i32 { unsafe { suma(a, b) } }
```

Con `libloading` cuando la DLL se carga en tiempo de ejecución:

```rust
let lib = unsafe { libloading::Library::new("libs/mylib.dll") }?;
let f: Symbol<unsafe extern "C" fn(i32, i32) -> i32> = unsafe { lib.get(b"suma") }?;
```

Configuración en `rsharp.toml` (§9): `[foreign.mylib]` con `kind = "native"`,
`path`, `header` y `link = "dynamic"`.

**B2 · C con cabecera.** `rsharp bind --c libs/mylib.h` → `bindgen` →
`bindings/`.

**B3 · Python (`pyo3`).**

```csharp
[PythonModule("numpy")]
public static extern double Suma(double[] valores);
```

```rust
// el GIL se toma en cada llamada y los errores se convierten a Result (§13)
Python::with_gil(|py| { /* ... */ })?;
```

Lee stubs `.pyi`; sin stubs, usa `#codeGenAI` (§13). En `rsharp.toml`,
`[foreign.numpy]` con `kind = "python"` y `version = ">=1.26"` (§9).

**B4 · Host .NET (`netcorehost`).** `[ForeignAssembly("libs/mi.dll")]` genera
la llamada; los metadatos se leen con `System.Reflection.Metadata`; exige .NET
instalado y el error lo dice con claridad (§13). Rutas para una DLL de .NET, en
orden de preferencia (§13):

1. **Transpilar el código fuente R#** (la mejor opción).
2. NativeAOT con exportaciones C.
3. Host .NET desde Rust (exige .NET instalado).

**B5 · Crates de Rust (§12).** Fuentes de bindings: manual con
`[Extern("ruta::del::item")]`, generado con `rsharp bind <crate>` desde el
JSON de `rustdoc`, o NuGet preenlazado. Los bindings van a `bindings/` (el
usuario puede editarlos, §3) y su hash a `rsharp.lock`; avisa si una versión
nueva cambia la API; se verifican con `cargo check`. Se rechazan los crates
con `unsafe` o FFI salvo bloque `unsafe` explícito; un crate con `async` exige
el runtime elegido en `rsharp.toml`; un crate sin soporte `wasm32` se rechaza
en ese destino (§12).

### Parte C · El límite: punteros y `string`

Reglas del límite (§13), obligatorias en todos los casos:

1. **Copia los `string` al cruzar** y **libera con `Drop`**.
2. Marca los punteros devueltos con **`[Owned]`** (el destino lo libera) o
   **`[Borrowed]`** (no lo libera).
3. Convierte los callbacks en `extern "C" fn` **con contexto**.
4. Convierte los errores de Python a `Result`.
5. Exige `unsafe` en las llamadas nativas y **envuélvelas en métodos seguros**.
6. Toma el GIL de Python en cada llamada.
7. Guarda el hash de cada librería en `rsharp.lock`.
8. Una DLL nativa exige un binario por plataforma.

```csharp
[DllImport("libs/mylib.dll")]
[Owned]                       // el llamante libera
public static extern IntPtr Reservar(int bytes);
```

## Reglas

1. El transpilador **no** corre en WASM (§4.4): todo lo de WASM es un destino
   del programa generado.
2. Ninguna llamada nativa puede quedar suelta en `unsafe`: se envuelve en un
   método seguro (§13).
3. `Rc<RefCell<T>>` no cruza el borde de WASM (§11).
4. `string` se copia al cruzar y se libera (§13).
5. `wasm32-unknown-unknown` no carga DLL dinámicas: `R#0150` (§11, §17).
6. Los bindings se guardan en `bindings/` y su hash en `rsharp.lock` (§3, §12).
7. El orden de soporte de §13 se respeta: C, luego Python, luego host .NET.
8. Si el flujo de `rsharp bind` no está decidido (`T-OPEN-007`), no lo inventes:
   implementa la parte que no dependa de él y deja constancia del bloqueo.
9. Identificadores en inglés; comentarios y mensajes en español.

## Salida esperada

- El código Rust generado para el borde, con `unsafe` acotado y envuelto.
- La configuración de `rsharp.toml` (`[foreign.*]`) o de `[build].target`.
- Los bindings en `bindings/` y el hash correspondiente en `rsharp.lock`.
- El diagnóstico `R#0150` donde corresponda, con su `help`.
- Tests: llamada real a la librería (o a un doble), liberación comprobada y
  rechazo en el destino sin soporte.
- Resumen con la tabla de equivalencias usada y los comandos de verificación.
