---
name: rsharp-core-transpiler
description: Úsala cuando el usuario pida implementar, corregir o extender una construcción del núcleo del transpilador de R# (RSharp) en C#: clases, structs, interfaces, herencia, genéricos, sobrecargas, eventos, excepciones, async, hilos, unsafe o punteros, y también cuando pida mapear un concepto de C# a Rust, ampliar el modo seguro Rc<RefCell>, derivar Clone/Copy, resolver lifetimes o resolver un rechazo del analizador del núcleo.
---

# Núcleo del transpilador de R# (C# → Rust)

## Cuándo usar esta skill

- Hay que **añadir soporte** de una construcción del núcleo (una de §8.1) en
  `RSharp.Compiler`.
- Hay que **corregir** una construcción ya emitida (herencia, genéricos,
  sobrecarga, eventos, excepciones...).
- El analizador (`RSharp.Analyzers`) rechaza algo que debería admitirse.
- Hay que decidir cómo se mapea un concepto de C# a Rust (§5) sin contradecir
  la especificación.

## Contexto del proyecto

- **Spec:** `rsharp-spec.md` (§5 mapeo, §5.1 reglas de `struct`, §5.2 otras
  reglas, §6 lo imposible o costoso, §8.1 núcleo v1, §18 riesgos).
- **Decisiones abiertas que bloquean este trabajo:** `T-OPEN-003` (subconjunto
  exacto de C# del núcleo v1) y `T-OPEN-004` (sintaxis de `[Weak]`,
  `[Borrowed]`, `[Owned]`). Si la construcción depende de una de ellas, la
  tarea queda `BLOCKED` hasta que se cierren.
- **Proyectos:** `src/RSharp.Compiler` (netstandard2.0, referencia Roslyn,
  **sin** `System.IO`, red ni reloj), `src/RSharp.Attributes`,
  `src/RSharp.Analyzers`, `src/RSharp.Cli`, `src/RSharp.Runtime`.
- **Contrato público** (§4.3):

```csharp
public static class Transpiler {
    public static TranspileResult Run(
        IReadOnlyDictionary<string, string> sources,
        TranspileOptions options);
}
```

- **Punto de entrada del pipeline:** `src/RSharp.Compiler/Emit/`. Cada
  construcción tiene su emisor (`ClassEmitter`, `StructEmitter`, ...).
- **Skills vecinas:** `ai/skills/rsharp-bcl-mapping/SKILL.md` (mapeo de
  `System.*`), `ai/skills/rsharp-wasm-and-ffi/SKILL.md` (bordes y FFI).

## Procedimiento

### Paso 1 · Confirmar que la construcción está en el subconjunto

1. Busca la construcción en §8.1 y en la decisión `T-OPEN-003`.
2. Si **no** está: no la implementes. Escribe el rechazo en
   `RSharp.Analyzers` (error, nunca silencio) y abre una `T-OPEN-*` si la
   decisión está pendiente.
3. Si está: anota en el resumen de la tarea las secciones de la spec que la
   respaldan.

### Paso 2 · Fijar el mapeo exacto antes de escribir código

Escribe el par C# → Rust en el resumen. Ejemplos de §5:

| C# | Rust |
|---|---|
| `class` | `Rc<RefCell<T>>` (modo seguro) |
| `struct` | `struct` por valor |
| `T?` / `null` | `Option<T>` |
| `interface` | `trait` |
| `ref` / `in` / `out` | `&mut` / `&` / `&mut` |
| `event` | `Vec<(u32, Box<dyn FnMut>)>` |
| `delegate` / lambda | `Box<dyn Fn>` o `impl Fn` |
| `try/catch`, `throw` | `Result` interno, `panic` en el resto |
| `async/await` | `async fn` con `tokio` |
| hilos | `Arc<Mutex<T>>` |

Si el mapeo no está en la tabla de §5, es una decisión de diseño: documéntala
y pide revisión. No la decidas en silencio.

### Paso 3 · Emitir en modo seguro

El **modo seguro es la referencia** (§7). Reglas de §5.1 para `struct`:

```csharp
public struct Point { public int X; public int Y; }   // class → Rc<RefCell<T>>
public class  Node  { public Node? Next; }            // class → Rc<RefCell<T>>
```

```rust
#[derive(Clone, Copy)]
pub struct Point { pub x: i32, pub y: i32 }            // Copy: todos los campos son Copy

#[derive(Clone)]
pub struct Node { pub next: Option<Rc<RefCell<Node>>> } // Rc<RefCell<T>> en modo seguro
```

- Deriva **siempre** `Clone`.
- Deriva `Copy` **solo** si todos los campos son `Copy` (§5.1).
- En una asignación de un `struct` sin `Copy` inserta `.clone()` (§5.1).
- Conserva `class` y `struct` como en C#: un `struct` **nunca** se envuelve en
  `Rc<RefCell<...>>`.
- No generes `unsafe` si el fuente no lo marca (§5.2).

### Paso 4 · Resolver la firma (sobrecarga, opcionales, conversiones)

Las tres reglas de §5.2 que afectan a las llamadas:

```csharp
int  suma(int a, int b);      // → fn suma_i32(a: i32, b: i32) -> i32
double suma(double a, double b); // → fn suma_f64(a: f64, b: f64) -> f64
void guarda(int x, int y = 0); // → guarda(x: i32, y: i32)
```

- Sobrecarga: **renombra** cada método con el sufijo del tipo
  (`suma_i32`, `suma_f64`).
- Argumentos opcionales y con nombre: **rellena en el sitio de la llamada**,
  no en la declaración.
- Conversiones implícitas: inserta una llamada `From` en la llamada.
- La resolución de sobrecargas debe ser determinista ante empate.

### Paso 5 · Resolver genéricos y herencia

```csharp
public interface IShape { double Area(); }
public class  Circle : IShape { public double R; public double Area() => 3.14 * R * R; }
public class  Box<T> where T : IShape, new() { public T Make() => new T(); }
```

```rust
pub trait Shape { fn area(&self) -> f64; }

pub struct Circle { pub r: f64 }
impl Shape for Circle { fn area(&self) -> f64 { 3.14 * self.r * self.r } }

pub struct Box<T: Shape + Default> { /* ... */ }
```

- `where T : IFoo` → `where T: Foo`; `where T : new()` → `where T: Default` (§5).
- Herencia de clase: campo `base` más un `trait` (§5).
- `virtual`/`override` → métodos de `trait`; `abstract class` → `trait` más
  `struct` de datos (§5).
- Estado `static` por genérico: guarda un mapa por `TypeId` (§5.2).

### Paso 6 · Emitir, registrar el source map y probar

1. El emisor devuelve texto Rust **y** las líneas de origen, para que el
   source map traduzca los errores de `rustc` a líneas `.rsh` (formato fijado
   en `T-OPEN-005`).
2. Añade el caso al corpus de pruebas diferenciales (`T-OPEN-008`): el mismo
   programa en .NET y en Rust debe dar **la misma salida**.
3. Verifica que el modo seguro y el modo optimizado coinciden (§7).

### Paso 7 · Cerrar la tarea

- `dotnet build src/RSharp.sln` sin errores ni advertencias.
- `dotnet test src/RSharp.sln` en verde.
- Actualiza `ai/TASKS.md` a `REVIEW` y deja el resumen con el par C# → Rust
  usado.

## Reglas

1. El núcleo **no** usa IA (§8.1) y **no** cambia comportamiento en silencio
   (§2.7): lo que no se soporta se rechaza con error.
2. El núcleo es determinista: la misma entrada produce la misma salida (§2.4).
3. `RSharp.Compiler` no usa `System.IO`, red ni reloj (§4.2).
4. El código Rust generado es un producto intermedio: **nadie lo lee**, pero
   puede ser largo si mejora el rendimiento o la corrección (§1).
5. R# imita C#: lo que C# omite, R# lo omite (§2.1). R# **oculta**
   ownership, borrowing y lifetimes: el transpilador los decide (§2.2).
6. No inventes reglas que contradigan la spec. Si un punto está ABIERTO,
   escribe "ABIERTO" y referencia la decisión.
7. Identificadores en inglés; comentarios y textos de error en español.
8. `unsafe` solo si el fuente lo marca (§5.2).

## Salida esperada

- Un par C# → Rust documentado para cada construcción tocada.
- El emisor nuevo o modificado en `src/RSharp.Compiler/Emit/`, con source map.
- El rechazo en `RSharp.Analyzers` si la construcción no está soportada.
- Tests: equivalencia con .NET, equivalencia entre modo seguro y optimizado y
  un caso negativo para el analizador.
- Resumen de la tarea con el par C# → Rust, los archivos tocados y los comandos
  de verificación ejecutados con su resultado.
