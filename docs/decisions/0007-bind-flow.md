# 0007 · Flujo de `rsharp bind` por cada origen

- **Estado:** ACEPTADA
- **Fecha:** 2026-11-13
- **Sección de la spec:** §12 · §13 · §19.7 (decisión ABIERTA)
- **Sustituye a:** nada (la decisión sigue abierta en la spec)

## Contexto

La spec §12 dice que los bindings de Rust se pueden obtener de tres fuentes
(manual, generados con `rsharp bind <crate>` desde rustdoc JSON, y paquetes
NuGet preenlazados), y §13 añade las librerías externas (DLL nativas, C con
cabecera, DLL de .NET, Python, Java). La spec deja sin definir **cómo se hace
cada flujo**.

Hay una decisión de fondo que condiciona a todas: **cómo se usa una librería
ajena desde R#**.

## Decisión de fondo: el FFI se parece al de C#

R# usa las librerías de otros lenguajes **igual que lo hace C#**: se declara
el enlace y se usa, no se reescribe la librería.

| En C# | En R# | Qué genera |
|---|---|---|
| `[DllImport("mylib")]` | `[DllImport("mylib")]` | `extern "C"` + `libloading` |
| `extern` de C# | `extern` | FFI declarado a mano |
| Ensamblado .NET referenciado | `[ForeignAssembly("Mi.dll")]` | `netcorehost` |
| Referencia a un paquete NuGet | paquete NuGet preenlazado | bindings en `bindings/` |
| Python vía `Python.NET` | `[PythonModule("numpy")]` | `pyo3` |
| Java vía JNI | `[JavaClass("com.ejemplo.Clase")]` | crate `jni` |

Es decir: **la superficie de usuario es la de C#**, y el trabajo del
compilador es traducir esa declaración a Rust. El programador no escribe
`extern "C"` ni llama a `libloading` a mano.

Esto tiene dos consecuencias:

1. Un programador de C# que ya conoce `[DllImport]` y los ensamblados .NET
   **no tiene que aprender nada nuevo** para usar una DLL nativa.
2. El programador **no ve Rust** en el punto de uso: el enlace es una
   declaración, no una llamada a una función de bajo nivel.

El resto de esta decisión define los flujos concretos. **FFI y bindings de
crates son trabajo de la Fase 5 del roadmap**: la interfaz queda fijada aquí,
la implementación es posterior.

## Los siete orígenes

### 1. Manual — `[Extern("ruta::del::item")]`

```csharp
using Rand;

public static class Rng
{
    [Extern("rand::rngs::ThreadRng::new")]
    public static object New();

    [Extern("rand::rngs::ThreadRng::next_u32")]
    public static uint Next(object rng);
}
```

Reglas:

- La ruta es la del **crust de Rust** (`crate::ruta::al::item`), no la de C#.
- El enlace usa el tipo real de Rust: `object` es `Box<dyn Any>` y exige
  `downcast` (spec §5).
- Todo crate con `unsafe` o FFI se rechaza salvo que el bloque sea `unsafe`
  explícito (spec §12).
- Un crate con `async` exige el runtime elegido en `rsharp.toml` (spec §12).
- Un crate sin soporte de `wasm32` se rechaza en ese destino (spec §12).

**No requiere `rsharp bind`**: es la forma manual que la spec ya describe.

### 2. Bindings desde `rustdoc JSON`

```bash
rsharp bind rand --version 0.8 --output bindings/
```

Requisito: el crate debe publicar su API en JSON.

```bash
cargo rustdoc -p rand -- -Z unstable-options --output-format json
```

Proceso:

1. Se ejecuta `cargo rustdoc` con la salida JSON.
2. Se genera `bindings/rand.rsh` con una clase estática por item público.
3. Se guarda el **hash de la API** en `rsharp.lock`.
4. Se verifica con `cargo check` (spec §12).

Si una versión nueva del crate cambia la API, el hash no coincide: la
extensión **avisa** (spec §12: «Avisa si una versión nueva cambia la API») y
el binding se regenera; hasta entonces se usa el fijado.

### 3. Paquetes NuGet preenlazados

```bash
rsharp pkg add Mi.Bindings --version 1.2.0
```

Un paquete NuGet preenlazado contiene:

- los `.rsh` de los bindings,
- un manifiesto con la versión del crate, el hash de su API y las
  dependencias.

**Por qué no se puede compilar un NuGet arbitrario**: la spec §18 lo dice
claro: «Las bibliotecas NuGet de terceros no tienen versión Rust». El binding
debe existir, y su versión debe estar fijada.

### 4. C con cabecera — `rsharp bind --c lib.h`

```bash
rsharp bind --c libs/mylib.h --output bindings/
```

Usa `bindgen` (spec §13). Advertencias: los encabezados del sistema, las
macros y las funciones `inline` no se traducen bien; el binding generado
puede necesitar ajustes manuales.

### 5. DLL de .NET — `[ForeignAssembly]`

La spec §13 da tres rutas, y la decisión es **usarlas en ese orden**:

| Ruta | Cuándo | Coste |
|---|---|---|
| 1. Transpilar el código fuente | Si se tiene el fuente | Es la mejor opción |
| 2. NativeAOT con exportaciones C | Si solo se tiene el ensamblado | Hay que recompilarlo |
| 3. Host .NET desde Rust (`netcorehost`) | Si no se puede tocar el ensamblado | Exige .NET instalado |

### 6. Python — `[PythonModule]`

**Rechazado en la v1** (`R#0150` y `R#0101`, spec §11 y §13). Cuando se
implemente: `pyo3`, el GIL se toma en cada llamada y los errores de Python se
convierten en `Result` (spec §13).

### 7. Java — `[JavaClass]`

**Rechazado en la v1.** Cuando se implemente: crate `jni` (spec §13).

## Resumen

| # | Origen | Comando | Genera | En la v1 | Bloqueo en `rsharp.lock` |
|---|---|---|---|---|---|
| 1 | Manual | — | `bindings/*.rsh` a mano | Sí | No |
| 2 | Crate de Rust | `rsharp bind <crate>` | `bindings/<crate>.rsh` | Sí | Hash de la API |
| 3 | NuGet preenlazado | `rsharp pkg add <id>` | `bindings/` del paquete | Sí | Versión + hash |
| 4 | C con cabecera | `rsharp bind --c <h>` | `bindings/<lib>.rsh` | Sí | Hash de la cabecera |
| 5 | DLL de .NET | `[ForeignAssembly]` | Enlace `netcorehost` | Sí (ruta 3) | Hash de la DLL |
| 6 | Python | `[PythonModule]` | — | **No** | — |
| 7 | Java | `[JavaClass]` | — | **No** | — |

## `rsharp.lock`

El archivo de bloqueo guarda:

- el **hash de la configuración de sugar** (un cambio invalida los bloqueos
  afectados, spec §9);
- la **versión y el hash de la API** de cada crate enlazado;
- la **versión y el hash** de cada librería externa.

Se **confirma en git** (spec §3): es la forma de que dos personas compilen lo
mismo.

## Consecuencias

- El FFI de R# se parece al de C#, así que el coste de aprender es bajo.
- La superficie visible para el programador es siempre C#; el Rust de los
  bindings queda en `bindings/`, que el usuario puede editar (spec §3).
- Los bindings generados se verifican con `cargo check` antes de usarse.
- Los orígenes 6 y 7 no están en la v1 y su error está fijado.

## Cómo se usa este documento

Es la referencia para implementar `rsharp bind` (Fase 5 del roadmap) y para
mantener la coherencia entre la superficie de C# y el Rust generado.
