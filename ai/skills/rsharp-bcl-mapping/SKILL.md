---
name: rsharp-bcl-mapping
description: Úsala cuando el usuario pida mapear una API de System.* a Rust, ampliar o cambiar la lista cerrada de tipos de la BCL, decidir el comportamiento de una API según el destino nativo o WASM, emitir o corregir el diagnóstico R#0101 de API no soportada, o resolver el rechazo de un tipo de System por el analizador del núcleo de R#.
---

# BCL de R#: `System.*` → Rust por destino

## Cuándo usar esta skill

- Hay que **mapear** un tipo o un método de `System.*` a Rust.
- Hay que decidir si una API existe en un destino (`native`, `wasm32-unknown-unknown`,
  `wasm32-wasip1`).
- Aparece el diagnóstico `R#0101` (API no soportada en el destino) y hay que
  emitirlo bien o corregir un rechazo indebido.
- Hay que **crecer** la lista cerrada de tipos (§10).

## Contexto del proyecto

- **Spec:** `rsharp-spec.md` §10 (BCL), §17 (diagnósticos), §9 (configuración) y
  §18 (riesgos: "Las bibliotecas NuGet de terceros no tienen versión Rust").
- **Decisión abierta que bloquea este trabajo:** `T-OPEN-002` (lista exacta de
  tipos de la BCL de la v1). Sin ella, la lista "inicial" de §10 es la única
  referencia y las tareas de esta área quedan `BLOCKED` para ampliarse.
- **Lista inicial (§10):** `List<T>`, `Dictionary<K,V>`, `string`, `Math`,
  `Console`, `File`.
- **Códigos de diagnóstico (§17):** `R#0042` (sugar apagado), `R#0101` (API no
  soportada en el destino), `R#0150` (destino sin soporte de librerías
  dinámicas).
- **Contrato de la CLI:** el diagnóstico viaja en
  `RSharpCliEnvelope.diagnostics` con `RSharpDiagnostic`
  (`extension/src/types.ts`): `code`, `severity`, `message`, `file`, `line`
  (1-based), `column` (1-based), `help`.

## Procedimiento

### Paso 1 · Comprobar la lista cerrada

1. ¿El tipo está en la lista cerrada (§10 y `T-OPEN-002`)?
2. **No** → el analizador lo rechaza con un error que nombre el tipo y la lista
   admitida. No se "mapea de momento".
3. **Sí** → sigue.

### Paso 2 · Fijar la tabla de destinos

El mapeo **depende del `target`** (§10). La tabla de referencia es:

| BCL | Rust nativo | Rust WASM navegador |
|---|---|---|
| `Console.WriteLine` | `println!` | `console.log` vía `web-sys` |
| `File.ReadAllText` | `std::fs::read_to_string` | no soportado |
| `Thread.Sleep` | `std::thread::sleep` | rechazado |

Reglas derivadas:

- Una API no soportada en el destino produce `R#0101` (§10).
- `wasm32-wasip1` tiene sistema de ficheros: no hereda el rechazo de
  `wasm32-unknown-unknown`; decide por capacidad, no por nombre de destino.
- La capacidad se decide por **feature**, no por lista negra: cada API declara
  `RequiresNativeFs`, `RequiresThreads`, `RequiresDynamicLibrary`, etc.

### Paso 3 · Escribir el mapeo por destino

Ejemplo, `Console`:

```csharp
Console.WriteLine("hola");   // → println!("hola");
Console.Write("hola");       // → print!("hola");   (sin salto de línea)
```

```rust
// nativo
println!("hola");
// wasm32-unknown-unknown (vía web-sys)
web_sys::console::log_1(&"hola".into());
```

Ejemplo, `File` (solo nativo):

```csharp
var texto = File.ReadAllText("datos.txt");
File.WriteAllText("datos.txt", texto);
```

```rust
// nativo
let texto = std::fs::read_to_string("datos.txt").unwrap();
std::fs::write("datos.txt", texto).unwrap();
```

### Paso 4 · Emitir `R#0101` con el texto correcto

El mensaje sigue el patrón de §10:

```
R#0101: File.ReadAllText no existe en wasm32-unknown-unknown
```

Reglas del diagnóstico (§17):

- Indica la **directiva o el ajuste** necesario (aquí: cambiar `build.target`
  o usar una API equivalente).
- Apunta a la **línea del `.rsh`**, nunca a la del Rust generado.
- `line` y `column` son 1-based en el contrato (`extension/src/types.ts`) y la
  extensión los convierte a 0-based al publicarlos.

### Paso 5 · Tratar `string` como caso especial

`string` no es un tipo más (§5, §6.2, §9):

- Modo seguro: `Rc<str>`.
- Modo optimizado: `&str` o `String` cuando **no** hay indexación UTF-16 (§7.8).
- Con `sugar.strings = "utf16"` el análisis desactiva esa optimización.
- `Length` y `s[i]` difieren entre UTF-16 y UTF-8: es una diferencia
  conocida y documentada, no un bug (§6.2).

### Paso 6 · Crecer la lista (procedimiento de versión)

Cuando se añade un tipo nuevo (§10):

1. Añadir el tipo a la lista cerrada (`SupportedTypes`) con sus miembros.
2. Añadir su mapeo por destino (nativo / WASM navegador / WASI).
3. Si no existe en algún destino, **documentarlo en la tabla** y emitir
   `R#0101`; no omitirlo.
4. Un test por destino: el mismo `.rsh` debe dar la misma salida en .NET y en
   Rust, y el rechazo en el destino no soportado debe ser correcto.
5. Actualizar la decisión `T-OPEN-002`.

### Paso 7 · Verificar

```bash
dotnet build src/RSharp.sln
dotnet test src/RSharp.sln
```

- El test de .NET y el de Rust dan la misma salida (corpus de `T-OPEN-008`).
- En el destino no soportado, el error es `R#0101` y no un error de compilación
  de Rust.

## Reglas

1. La BCL es una **lista cerrada**: lo que no está, se rechaza (§10).
2. El diagnóstico `R#0101` es el único camino para una API no soportada en un
   destino: nunca un `panic` ni un error de Rust sin traducir.
3. El mensaje nombra la API, el destino y la acción posible.
4. No amplíes la lista sin la decisión `T-OPEN-002` actualizada.
5. Lo que no es `System.*` (crates, librerías nativas, Python, .NET) es trabajo
   de FFI: ver `ai/skills/rsharp-wasm-and-ffi/SKILL.md`.
6. Identificadores en inglés; comentarios y mensajes en español.

## Salida esperada

- Una fila nueva en la tabla de destinos, o la decisión explícita de no
  soportarlo.
- El mapeo en `src/RSharp.Compiler/Bcl/` con una implementación por destino.
- El diagnóstico `R#0101` emitido en el destino no soportado, con su `help`.
- Tests: equivalencia con .NET en el destino soportado, rechazo correcto en el
  no soportado.
- Resumen con la tabla de destinos actualizada y los comandos de verificación.
