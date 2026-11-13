# Subconjunto de C# del núcleo v1 de R#

> **Documento normativo.** Define el **subconjunto exacto de C#** que el
> núcleo v1 de R# transpila a Rust. Resuelve la **decisión abierta 3** de
> `rsharp-spec.md` (§19.3) y fija la **decisión abierta 4** (§19.4): la
> sintaxis de `[Weak]`, `[Borrowed]` y `[Owned]`.
>
> - Especificación: [`../rsharp-spec.md`](../rsharp-spec.md)
> - Biblioteca estándar: [`BCL-V1.md`](./BCL-V1.md)
> - Contrato de la CLI: [`CLI-CONTRACT.md`](./CLI-CONTRACT.md)
> - Fases de trabajo: [`../ai/ROADMAP.md`](../ai/ROADMAP.md)

---

## 1. Resumen en seis líneas

1. El **núcleo v1** es el conjunto de construcciones de C# que R# transpila a
   Rust de forma **determinista**: la misma entrada produce la misma salida
   (spec §2.4, §8.1).
2. La lista es **cerrada**: lo que no aparece en la tabla de la sección 4 no se
   transpila; el analizador Roslyn lo **rechaza con un error** que dice qué
   hacer (spec §8.1, §4.2, §17).
3. El núcleo cubre lo que la spec enumera en §8.1: `struct`, `class`, `enum`,
   `interface`, genéricos, herencia, `virtual`/`override`, sobrecargas,
   argumentos opcionales, eventos, delegados, excepciones, conversiones
   implícitas, `partial`, `async`/`await`, hilos, `unsafe` y punteros.
4. Lo que Rust no puede dar —reflexión, `dynamic`, carreras de datos, GC de
   ciclos— está **rechazado**, nunca aproximado (spec §6.1).
5. Lo que Rust solo puede dar **con una concesión escrita** del programador
   (ciclos, desbordamiento, finalizadores, reentrada, cadenas UTF-8) exige
   *sugar*; sin él, el compilador avisa con `R#0042` (spec §8.2, §17).
6. Donde la spec no decide, este documento decide de forma explícita o marca la
   construcción como pendiente: no hay filas «a medio hacer».

---

## 2. Principio: el núcleo es determinista

El núcleo es **transpilación determinista** (spec §0, §8.1). De ahí se
derivan las cinco reglas que gobiernan la tabla de la sección 4.

| Regla | Qué significa | Spec |
|---|---|---|
| **Determinista** | La misma entrada produce el mismo texto Rust. Sin IA (§8.1), sin reloj, sin red, sin `System.IO` en el compilador. | §2.4, §2.5, §4.2, §8.1 |
| **Cerrado** | Si una construcción no está en la sección 4, no se transpila: se rechaza con **error**, nunca con un aviso ni con una degradación silenciosa. | §2.7, §8.1, §17 |
| **Sin aproximaciones** | R# no «se parece» a C#: o reproduce la semántica observable, o rechaza el código. Convertir un `stackalloc` variable en un `Vec` sería una aproximación: no se hace. | §1, §2.1, §2.7 |
| **R# imita C#** | Se conserva lo observable: orden de evaluación, excepciones, aritmética con envoltorio, igualdad de `record`. Lo que C# omite, R# lo omite. | §2.1, §18 |
| **El transpilador decide el ownership** | El programador escribe C#: nunca escribe `&`, `&mut`, `mut`, `Rc`, `Box` ni lifetimes. Los decide el transpilador (§2.2). El Rust generado es un producto intermedio que nadie lee (§1). | §1, §2.2, §6.3 |

Consecuencias prácticas:

- El **modo seguro** (`Rc<RefCell<T>>` en todas partes) es la **referencia**
  (spec §7). El modo optimizado debe producir el mismo comportamiento
  observable; si no, es un error del optimizador, no del núcleo (§7).
- Todo rechazo apunta a la **línea del `.rsh`**, nunca a la del Rust generado
  (spec §17), y **nunca** degrada la salida: si el analizador no puede
  decidir, es un error.

### 2.1 Códigos de diagnóstico

| Código | Significado | Cuándo | Spec |
|---|---|---|---|
| `R#0042` | El código exige un *sugar* apagado. | Ciclos sin `[Weak]`, desbordamiento con pánico, finalizadores, reentrada, cadenas UTF-8 (sección 6). | §8.2, §17 |
| `R#0101` | API no soportada en el destino. | Tipos o métodos de `System.*` fuera de la lista cerrada de la BCL. | §10, §17 |
| `R#0150` | Destino sin soporte de librerías dinámicas. | `[PythonModule]`, DLL dinámicas en WASM. | §11, §13, §17 |
| `R#0001` | **Construcción fuera del núcleo v1.** | Cualquier construcción de C# que no esté en la sección 4. **Código nuevo**: la spec §17 solo fija tres códigos y `R#0101` está reservado para la BCL, así que este documento amplía §17 y la ampliación debe incorporarse a la spec al cerrar esta decisión. | §17, §8.1 |

Formato de `R#0001` (fijo en este documento): `R#0001: <construcción> no está en el núcleo v1 de R# (docs/CORE-SUBSET.md §<sección>)`, seguido de una línea `Ayuda: <qué escribir o cómo cambiarlo>`.

Los tres códigos de la spec §17 **no se reutilizan** para otros significados
(son reservados): `R#0101` es de la BCL, no del lenguaje.

---

## 3. Convenciones de la tabla

| Convención | Significado |
|---|---|
| **soportada** | Entra en el núcleo v1. El transpilador **debe** traducirla. |
| **parcial** | Entra una parte acotada, indicada en «Notas». El resto se rechaza con `R#0001`. |
| **rechazada** | No entra en el núcleo v1. El analizador la rechaza con `R#0001` (o `R#0101` si es una API de la BCL) y dice por qué. |
| **pendiente (Fase N)** | La spec no lo resuelve y la construcción no entra todavía: se rechaza con `R#0001` hasta que llegue la fase N del [roadmap](../ai/ROADMAP.md) (§1). |
| `§2.4` | Principio 4 de la sección 2 de la spec (la spec numera sus principios 1..8). |
| `§7 (paso 9)` | Paso 9 de la lista de optimizaciones de la sección 7 de la spec. |
| Fases 0..9 | Fases del [roadmap](../ai/ROADMAP.md) §1: 1 = núcleo del transpilador, 3 = BCL, 4 = WASM, 5 = bindings y FFI, 6 = optimizaciones, 7 = plugins y sugar, 8 = Python y host .NET, 9 = depuración. |

Cuando la spec no contiene una fila para una construcción, este documento
**no la da por soportada**: o la resuelve aquí de forma explícita y citada, o
la marca como pendiente o rechazada, con su motivo.

---

## 4. Construcciones soportadas

### 4.1 Tipos

| Construcción de C# | Estado | Equivalente en Rust | Notas |
|---|---|---|---|
| `class` | soportada | `Rc<RefCell<T>>` (modo seguro) | §5. El modo optimizado la baja a `struct` en el stack si no escapa (§7 paso 1) y elimina el `RefCell` si el análisis de aliasing lo permite (§7 paso 3). |
| `struct` | soportada | `struct` por valor | §5, §5.1. Deriva siempre `Clone`; `Copy` solo si todos los campos son `Copy`; se inserta `.clone()` en asignaciones sin `Copy`. Un `struct` nunca se envuelve en `Rc<RefCell<…>>`. |
| `enum` | soportada | `enum` con `#[repr(i32)]` | §5. El tipo subyacente por defecto de C# es `int`; con `long` subyacente, `#[repr(i64)]`. |
| `enum` con `[Flags]` | parcial | `enum` con `#[repr(i32)]` | Las combinaciones con `\|`, `&` y `^` funcionan. `Enum.ToString("F")` y `Enum.HasFlag` no están en la BCL: se rechazan con `R#0101` (BCL-V1 §5). |
| `interface` | soportada | `trait` | §5. El despacho es `Box<dyn Trait>` (§12). |
| `record` posicional | soportada | `struct` con `PartialEq` y `Clone` | §5. El `Deconstruct` implícito genera `fn deconstruct(self) -> (T1, T2)`. |
| `record` de clase | parcial | `struct` con `PartialEq` y `Clone` | §5. En C# es una **referencia** con igualdad por valor; en Rust es un **valor** y se copia al asignar. La diferencia es observable y no se oculta (§2.7). |
| `record struct` | soportada | `struct` con `PartialEq` y `Clone` | §5. Igualdad por valor, `ToString` y `with` como en C#. |
| `delegate` | soportada | `Box<dyn Fn>` o `impl Fn` | §5. `Action` y `Func<…>` son tipos de la BCL: su API es la de BCL-V1 §4.15. |
| `abstract class` | soportada | `trait` más `struct` de datos | §5. Los miembros abstractos son métodos de `trait` sin cuerpo; la clase concreta implementa el `trait`. |
| `static class` | soportada | `struct` unitario más `impl` | §5. Sin campos ni constructores de instancia. |
| `namespace` | soportada | `mod` | §5. Un `namespace` anidado produce `mod` anidados; los nombres se califican con `::`. |
| `string` | soportada | `Rc<str>` o `String` según análisis | §5. La API de `string` es la de BCL-V1 §4.3. |
| `object` | parcial | `Any` / `Display` | §5, §6.3. **No hay boxing**: un `struct` dentro de un `object` no se puede volver a desenvolver (BCL-V1 §5, §7). |

### 4.2 Herencia, modificadores y estáticos

| Construcción de C# | Estado | Equivalente en Rust | Notas |
|---|---|---|---|
| Herencia de clase | soportada | campo `base` más `trait` | §5. Una sola clase base, como en C#. El `trait` lleva los métodos virtuales y el `struct` lleva el campo `base`. |
| `virtual` | soportada | método de `trait` | §5. |
| `override` | soportada | método de `trait` | §5. La clase base define el método por defecto; la derivada lo implementa. |
| `sealed` | soportada | sin equivalente directo | Permite desvirtualizar: llamada directa con `#[inline]` (§7 paso 6). `sealed override` es equivalente a un método final. |
| `abstract` (miembro) | soportada | miembro sin cuerpo del `trait` | §5. |
| `new` (ocultar un miembro de la base) | parcial | el método derivado prevalece | Rust da prioridad al método inherente sobre el del `trait`, así que el ocultamiento se reproduce. Pero `base.Miembro()` no puede llamar al miembro oculto: **esa forma se rechaza** con `R#0001`. |
| `static` | soportada | función asociada en `impl` | §5. El estado `static` dentro de un tipo genérico se guarda en un mapa por `TypeId` (§5.2, §6.2). |
| `const` | soportada | `const` de Rust | Solo con inicializador constante en tiempo de compilación. Si el valor depende del entorno, se rechaza con `R#0001`: no se puede «aproximar» con un `static`. |
| `readonly` | soportada | campo que no se reasigna | Como en C#, `readonly` bloquea la reasignación del campo, no la mutación del objeto referenciado: un `readonly` que apunta a un `Rc<RefCell<T>>` sigue permitiendo mutar el interior. |
| `partial` | soportada | las partes se unen antes de generar | §5.2. Se unen campos, métodos, constructores y atributos antes de emitir. Los modificadores de accesibilidad se unifican con el **más restrictivo**. |
| Accesibilidad (`public`, `internal`, `private`, `protected`, `protected internal`) | soportada | `pub`, `pub(crate)`, privado | Rust no tiene `protected`: `protected` y `protected internal` se traducen a `pub(crate)`, la única aproximación que no cambia la visibilidad hacia fuera del crate. Los tipos de un `namespace` son visibles según su `mod` (§5). |
| `unsafe` | soportada | `unsafe`, `*mut i32` y bloque `unsafe` | §5. **Solo se genera `unsafe` si el fuente lo marca** (§5.2). |
| `fixed` | parcial | bloque `unsafe` con `&raw mut` | §5. Solo tiene sentido con punteros: `fixed (int* p = &arr[0])` → `let p = &raw mut arr[0];` dentro de `unsafe`. Sobre un objeto `Rc<RefCell<T>>` el `fixed` es un no-op (no hay GC que mueva objetos): el analizador lo omite con un aviso, nunca lo cambia en silencio (§2.7). |
| `stackalloc` | parcial | arreglo en el stack | §5. Con **tamaño constante** → `[T; N]`. Con **tamaño variable** → **rechazado** con `R#0001`: Rust no reserva en el stack con un tamaño en tiempo de ejecución, y convertirlo en `Vec` cambiaría el comportamiento sin permiso (§2.7). |
| `params` | parcial | `&[T]` en el parámetro | §6.3, §12. `params T[]` → `p: &[T]`; el sitio de llamada agrupa los argumentos finales en un array: `f(a, b, c)` → `f(&[a, b, c])`. |

### 4.3 Miembros

| Construcción de C# | Estado | Equivalente en Rust | Notas |
|---|---|---|---|
| Constructores | soportada | `fn new(...) -> Self` | El cuerpo del constructor se emite tras inicializar los campos. |
| Métodos de instancia | soportada | método con `&self` o `&mut self` | §5. El receptor es `&mut self` si el método muta el estado. |
| Métodos de extensión | soportada | `trait` más `impl` para el tipo | §5. Un `static class` con métodos de extensión se emite como un `trait` aparte más un `impl` del tipo. |
| Sobrecarga y argumentos opcionales | soportada | nombre con sufijo de tipo; los argumentos se rellenan en la llamada | §5.2. Sobrecarga: `suma_i32(a: i32, b: i32)` y `suma_f64(a: f64, b: f64)`. Los argumentos opcionales y con nombre se completan en el **sitio de la llamada**, nunca en la declaración. |
| `: base(...)` | soportada | inicialización del campo `base` | §5. El orden de inicialización es el de C#: base y después la clase derivada. |
| `: this(...)` | soportada | encadenado al constructor de la misma clase | Se emite `fn new(...)` que delega en un `fn new_inner(...)`. |
| Finalizadores (`~Tipo()`) | parcial (sugar) | `impl Drop` | §5, §6.2, §9. **Exige el sugar** `finalizers = "deterministic"`: `Drop` se ejecuta al final del ámbito, no en un GC, así que el orden respecto a C# es distinto y visible. Sin el sugar: `R#0042` (sección 6). |
| Propiedades automáticas | soportada | métodos `get` y `set` | §5. `get` → `fn x(&self) -> T`; `set` → `fn set_x(&mut self, value: T)`. El backing field es privado. |
| Propiedades calculadas | soportada | método `get` con cuerpo | §5. Si el `get` muta el estado, el receptor pasa a `&mut self`. |
| `init` (accesor de solo inicialización) | pendiente (Fase 1) | — | §5 no lo decide. Se rechaza con `R#0001` hasta que tenga fila propia: un `set` restringido al constructor cambia la semántica de la inicialización de objetos. |
| `required` (miembros obligatorios) | pendiente (Fase 1) | — | §5 no lo decide. Se rechaza con `R#0001`. |
| Indexadores (`this[i]`) | parcial | `impl std::ops::Index<usize>` y `IndexMut` | §5 no los lista: propuesta de este documento. Solo un indexador de índice `int` en la v1. Varios indexadores, `Index`/`Range` y otros tipos de índice → `R#0001`. |
| `operator` (sobrecarga) | soportada | `impl Add` (y `Sub`, `Mul`, `Div`, `Rem`, `BitAnd`, `BitOr`, `BitXor`, `Shl`, `Shr`, `Neg`, `Not`, `PartialEq`, `PartialOrd`) | §5. C# no deja sobrecargar `&&`, `\|\|`, `??` ni `?:`: tampoco se pueden declarar. El nombre generado lleva sufijo de tipo (§5.2) para no chocar con el método del `trait`. |
| Conversión (`op_Implicit`, `op_Explicit`) | soportada | `impl From<T>` y `impl TryFrom<T>` | §5.2: la conversión implícita inserta `From` en el sitio de la llamada; la explícita exige `try_into()` en el sitio de la llamada. |
| `event` | soportada | `Vec<(u32, Box<dyn FnMut>)>` con ids | §5. `+=` y `-=` se traducen a alta y baja de suscriptor; un solo suscriptor usa `Option<Box<dyn FnMut>>` (§7 paso 15). |
| Genéricos de clase y de método | soportada | `struct Foo<T>` y `fn f<T>(…)` | §5, §8.1. |
| `where` (restricciones) | soportada | `where T: Foo` | §5. `where T : IFoo` → `where T: Foo`; `where T : new()` → `where T: Default`. La covarianza se resuelve insertando conversiones explícitas (§6.2). |
| Genéricos reificados y estado estático por genérico | parcial | `TypeId` | §5.2, §6.2. Exige `'static`. |
| `dynamic` | rechazada | — | §6.1: el despacho *late binding* no existe en Rust. Detalle en la sección 5. |

### 4.4 Control de flujo, expresiones y concurrencia

| Construcción de C# | Estado | Equivalente en Rust | Notas |
|---|---|---|---|
| `if`/`else`, `while`, `do`, `for`, `foreach` | soportada | `if`, `while`, `loop`, `for`, iterador | §5, §7 paso 11. Un `for` con índice se reescribe como iterador (§7 paso 11). |
| `break`, `continue`, `return` | soportada | `break`, `continue`, `return` | Directo. |
| `goto` | rechazada | — | Rust no tiene `goto` ni etiquetas. `break`, `continue` y `return` cubren el núcleo de C#. |
| `switch` (sentencia) | soportada | `match` | §5. `default` → `_`; casos agrupados (`case 1: case 2:`) → `1 \| 2`. No hay *fall-through* en C#: tampoco en Rust. |
| `switch` (expresión) | soportada | `match` como expresión | §5. Si alguna rama no devuelve valor, Roslyn ya lo rechaza. |
| *Pattern matching* (`is T`, constantes, `var`, `_`, `when`, patrones de propiedad y de lista) | parcial | `match` con guardas | §5 no lo lista: propuesta de este documento. Las formas que el `match` de Rust expresa de forma directa entran; los patrones `not`, `or` y `and` anidados → `R#0001` (pendiente, Fase 1). |
| `is` / `as` | soportada | `downcast` con `Any` | §5. `as` devuelve `null` cuando no encaja → `Option<T>`. |
| `throw` | soportada | `Err` del `Result` interno | §5, §7 paso 13. Si todos los `throw` del método son conocidos, el método devuelve `Result` y el error se propaga con `?`; si no, se usa `panic!` (§5). |
| `try` / `catch` / `finally` | soportada | `Result` interno, `panic` en el resto | §5. `finally` se traduce a una guardia de ámbito (`Drop`) que corre al salir del bloque, tanto en el camino normal como en el de error. `catch` con filtro `when` → `R#0001` (pendiente, Fase 1). `catch (Exception)` genérico: el tipo de error es la unión de los tipos lanzados en el bloque. |
| `using` / `IDisposable` | soportada | `impl Drop` y bloque de ámbito | §5. `using var x = …;` y `using (a) { … }` funcionan; varios recursos → bloques anidados. |
| `lock` | soportada | `Mutex` o `RefCell` según el análisis de hilos | §5, §7 paso 4. `RefCell` entra en pánico con un segundo `borrow_mut` (§6.2): es el sugar `reentrancy = "panic"` (sección 6). |
| `async` / `await` | soportada | `async fn` con `tokio` | §5, §8.1. En WASM, `wasm-bindgen-futures` (§11). La máquina de estados sin `Box` es una optimización (§7 paso 12). `async void` → `R#0001`. |
| Hilos (`Thread`, `Task.Run`) | soportada (nativo) | `Arc<Mutex<T>>` | §5, §8.1. En el destino WASM se rechazan: no hay hilos (§11). |
| `volatile` | parcial | `AtomicI32`, `AtomicBool`, `AtomicU64`… | §5 no lo lista: propuesta de este documento. Solo campos de tipo primitivo; en un `class` (modo seguro) el campo pasa a `Rc<AtomicI32>`. `volatile` sobre un campo de referencia o de tipo `struct` → `R#0001`. |
| `checked` / `unchecked` | parcial | `checked_*` / `wrapping_*` | §7 paso 9. `unchecked` reproduce el envoltorio de C# y es del núcleo. `checked` **entra en pánico** en vez de lanzar `OverflowException`: es el sugar `overflow = "panic"` y, con el sugar apagado, el bloque `checked` se rechaza con `R#0042` (sección 6). Fuera de ambos bloques, el núcleo usa `wrapping_*` (semántica de C#) para no depender del perfil de compilación (§2.4, §6.2). |
| `nameof` | soportada | literal de cadena | Determinista: el analizador lo resuelve en tiempo de compilación. §5 no lo lista, pero no tiene coste ni ambigüedad. |
| `typeof` | parcial | `TypeId::of::<T>()` | §6.2. Solo como **comparación** (`typeof(A) == typeof(B)`). Como valor (`Type`) → `R#0001`: no hay metadatos en tiempo de ejecución (BCL-V1 §7). `x.GetType()` → `R#0101`. |
| `sizeof` | parcial | `std::mem::size_of::<T>()` | Solo tipos no gestionados y dentro de `unsafe`. `sizeof` de un tipo gestionado (que en C# lanza `ArgumentException` en tiempo de ejecución) → `R#0001`. |
| `default` / `default(T)` | soportada | `Default::default()` | `T?` → `None`; `string` → `String::new()`; `List<T>` → `Vec::new()`; los numéricos → su valor cero. |
| Nulos y tipos anulables (`T?`) | soportada | `Option<T>` | §5. `?.` → `as_ref().map(…)`; `??` → `map_or(…)` / `unwrap_or(…)`. `null` en un tipo no anulable ya lo rechaza Roslyn. |
| Interpolación de strings (`$"…"`) | soportada | `format!(…)` | §5, BCL-V1 §4.3. Los huecos `{0}` → `{}` y `{0:F2}` → `{:.2}`. El formato es siempre invariante (§18). |
| Concatenación de strings (`+`) | soportada | `format!` o `push_str` | §5. |
| Expresiones `with` | soportada | `Tipo { campo: nuevo, ..anterior }` | §5. Solo en `record` (§5). |
| Deconstrucción (`var (a, b) = x`, `Deconstruct`) | parcial | patrón de tupla: `let (a, b) = x;` | El `record` posicional genera `fn deconstruct(self) -> (…)`. Un `Deconstruct` escrito a mano → `R#0001` (pendiente, Fase 1). |
| `out var` | soportada | `let mut x;` más `&mut x` | §5. |
| `ref` / `out` / `in` | soportada | `&mut` / `&mut` / `&` | §5. `out` exige asignación antes de salir; `in` es una referencia de solo lectura. |
| Lambdas y funciones locales | soportada | `impl Fn` / `Box<dyn Fn>` | §5. Una lambda local `static` se convierte en una `fn` anidada. |
| LINQ | soportada (lista cerrada) | iteradores | §5. Los operadores son **exactamente** los de BCL-V1 §4.9; cualquier otro se rechaza con `R#0101`. Las cadenas se fusionan en un solo iterador (§7 paso 10). |
| Iteradores (`yield return`, `yield break`) | parcial | `impl Iterator<Item = T>` | §5 no lo lista: propuesta de este documento. Se genera una máquina de estados explícita; `yield break` → `return None`. Las variables locales `ref`/`out` que cruzan un `yield` → `R#0001`. `IAsyncEnumerable` → pendiente (Fase 1). |
| Punteros (`int*`, `void*`) | soportada | `*mut i32`, `*const u8` | §5. Solo dentro de `unsafe`. |
| `Span<T>` / `ReadOnlySpan<T>` | rechazada (como tipo de BCL) | `&[T]` / `&mut [T]` | §6.3, §12: la **noción** de slice sí está (`Span<T>` ↔ `&[T]`, §12). Pero `System.Span<T>` **no está en la lista cerrada de la BCL** (BCL-V1 §2, §5) → `R#0101`. El tipo entra por bindings en Fase 5. |
| `extern` / `[DllImport]` | pendiente (Fase 5) | `extern "C"` | §13. |
| `[Extern]` (binding de un crate) | pendiente (Fase 5) | el item de Rust | §12. |
| `[Export]` / `[WasmExport]` | pendiente (Fase 4) | `#[wasm_bindgen]` | §11, §15. |

---

## 5. Rechazados en la v1

### 5.1 Imposible en Rust (spec §6.1)

Estas construcciones **no** se pueden transpilar de ninguna manera: no hay
aproximación posible, así que se rechazan siempre, con o sin sugar.

| Construcción | Estado | Motivo | Spec |
|---|---|---|---|
| `System.Reflection.Emit` | rechazada | Rust no genera código en tiempo de ejecución: no hay IL que emitir ni dónde emitirlo. | §6.1 |
| `System.Reflection.Assembly.Load` | rechazada | Cargo compila antes de ejecutar: no hay carga de ensamblados en tiempo de ejecución. | §6.1 |
| `dynamic` nativo | rechazada | El despacho *late binding* no existe en Rust. `Box<dyn Any>` no sustituye a `dynamic`: no hay conversión implícita ni resolución en tiempo de ejecución. | §6.1 |
| Reflexión completa sin tablas generadas | rechazada | Exige metadatos de tipos en tiempo de ejecución. La única salida es **generar las tablas** en tiempo de compilación, que es un bloque `#codeGenAI` (§8.3) y no pertenece al núcleo (§8.1). | §6.1, §8.3 |
| Carreras de datos permitidas en código seguro | rechazada | `Rc` y `RefCell` no son `Send` ni `Sync`. El código seguro de Rust no puede tener carreras: la v1 no ofrece un modo inseguro para permitirlas. | §6.1, §6.3 |
| GC automático de ciclos con `Rc` | rechazada | `Rc` no tiene recolector: un ciclo se queda vivo para siempre. Los ciclos se rompen con `Weak` (atributo `[Weak]`, sección 8) o se acepta la fuga con el sugar `cycles = "leak"`. | §6.1, §18 |

### 5.2 Rechazado por no estar resuelto

Todo lo que no está en la tabla de la sección 4 se rechaza con `R#0001`. Los
casos más frecuentes:

| Construcción | Motivo |
|---|---|
| `goto` y etiquetas; `stackalloc` de tamaño variable | No existen en Rust y no hay reserva en el stack con tamaño en tiempo de ejecución (secciones 4.2 y 4.4). |
| `Span<T>` / `ReadOnlySpan<T>` como tipos | No están en la lista cerrada de la BCL: `R#0101` (BCL-V1 §2, §5). |
| Reflection completa, `dynamic`, `Assembly.Load`, `Reflection.Emit` | Imposibles en Rust (sección 5.1). |
| Cualquier tipo o método de `System.*` fuera de BCL-V1 | `R#0101` (BCL-V1 §2, §6). |
| `init`, `required`, `Deconstruct` manual, patrones `not`/`or`/`and`, `async void`, `catch` con `when`, `IAsyncEnumerable` | Pendientes (Fase 1) o no resueltos por la spec: se marcan en la sección 4.4. |

### 5.3 Lo que no se rechaza nunca en silencio

- Una construcción **rechazada** detiene la transpilación del archivo con un
  error: no hay modo «degradado» ni avisos que el compilador acepte.
- Una **parcial** se rechaza en la parte no soportada, nombra la parte exacta
  que no entra, y todo diagnóstico señala **siempre** la línea del `.rsh` (§17).

---

## 6. Requiere sugar (spec §8.2)

*Sugar* es lo que exige una condición del programador (§8.2). El sugar está
**apagado** si no hay configuración: sin `[sugar]` en `rsharp.toml`, sin
`[RSharpSugar]` en el código y sin el atributo que lo concede (§8.2, §9).

| Concesión | Construcción que la exige | Qué cambia | Interruptor (§9) | Con el sugar apagado |
|---|---|---|---|---|
| Ciclos rompibles | Un campo que apunta a un tipo que puede apuntar de vuelta | El campo pasa a `Weak`: el objeto puede morir antes y la lectura devuelve `None` | `cycles = "weak-attribute"` (o `"leak"`) | `R#0042` en el campo, con el mensaje exacto de la spec (abajo) |
| Desbordamiento con pánico | Aritmética que desborda dentro de `checked` | Deja de envolver y lanza un pánico en vez de `OverflowException` | `overflow = "panic"` | `R#0042`: usa `unchecked` o `overflow = "wrap"` |
| Finalizadores deterministas | `~Tipo()` | `Drop` corre al final del ámbito, no en un GC: el orden cambia | `finalizers = "deterministic"` | `R#0042`: el finalizador exige el sugar `finalizers` |
| Reentrada con pánico | `lock` o `RefCell` reentrante | El segundo `borrow_mut` entra en pánico en vez de bloquear (§6.2) | `reentrancy = "panic"` | `R#0042`: la reentrada exige el sugar `reentrancy` |
| Cadenas UTF-8 | `s[i]` (índice por unidad de código UTF-16) | El almacenamiento pasa a UTF-8: el índice deja de coincidir con C# | `strings = "utf8"` | `R#0042`: `s[i]` exige el sugar `strings` |

`string.Length` **no** exige concesión: se calcula como
`s.encode_utf16().count()`, que reproduce exactamente a C# (BCL-V1 §4.3).
El sugar `strings` solo afecta al **almacenamiento** y al **índice**.

### 6.1 Mensaje exacto de `R#0042`

Para el caso de los ciclos, el texto es el literal de la spec §8.2. Para los
demás casos, el formato es el mismo, con la concesión nombrada:

```text
R#0042: usa [Weak] en este campo o activa #codeGenAI
R#0042: <construcción> exige el sugar "<clave>" apagado
  Ayuda: <qué escribir o qué poner en rsharp.toml>.
```

Reglas del mensaje:

1. Apunta a la **línea del `.rsh`** (§17).
2. Nombra el **ajuste necesario**: el atributo a escribir o la clave de
   `rsharp.toml` (§17, §9).
3. **Desaparece** cuando el sugar está habilitado, con o sin alcance de
   archivo o de método (§9).
4. Nunca se emite un `R#0042` sin una concesión que lo resuelva: si el
   constructor no puede resolverlo, es un `R#0001`.

### 6.2 Visibilidad de la concesión

Cada concesión queda **visible** en el código o en `rsharp.toml` (§8.2):

- El atributo `[Weak]` es la concesión escrita en el código (sección 8).
- `[RSharpSugar("overflow", "wrap")]` concede el desbordamiento por archivo
  o por método (§9).
- El interruptor de `rsharp.toml` concede el resto; su hash va a
  `rsharp.lock` y un cambio invalida los bloqueos afectados (§9).

---

## 7. Lo que Rust impone (spec §6.3)

Rust tiene exigencias que C# no tiene. R# **oculta** el ownership, el
borrowing y los lifetimes (§2.2): el transpilador los decide. Estas son las
reglas que decide y su coste.

| Exigencia de Rust | Qué implica | Qué hace R# | Spec |
|---|---|---|---|
| **Lifetimes** | Una referencia no puede outlivar su dueño | El transpilador los infiere o los elimina con `Rc` y `clone`; el programador no los escribe. Los ligados a un argumento usan `[Borrowed]` o `clone`. | §6.3, §12 |
| **Movimientos** | Usar un valor después de moverlo es un error de compilación | El análisis detecta los usos posteriores al movimiento e inserta `.clone()` en las asignaciones de `struct` sin `Copy`. | §6.3, §5.1 |
| **`&` contra `&mut`** | No se puede pedir `&mut` sobre algo ya prestado | Se decide en cada `ref`: `ref` y `out` → `&mut`; `in` → `&`. `out var` genera `let mut` + `&mut`. | §6.3, §5 |
| **`mut` en variables** | Una variable reasignada debe declararse `mut` | El transpilador detecta las modificaciones y marca `mut`; el programador no lo escribe. | §6.3 |
| **`Copy` contra `Clone`** | Mover un valor no copiable cambia su contenido | Se deriva `Copy` **solo** si todos los campos son `Copy`; si no, `Clone` y `.clone()` explícito. | §6.3, §5.1 |
| **`Box<dyn T>` contra genéricos** | No se puede elegir el tipo de una variable en tiempo de ejecución | Una interfaz se traduce por `Box<dyn Trait>`; un genérico, por un parámetro de tipo. El análisis elige el despacho. | §6.3, §12 |
| **`Send` y `Sync`** | Un valor que cruza un hilo debe ser seguro | El análisis calcula la seguridad entre hilos: `Rc<RefCell<T>>` no es `Send`, así que un hilo obliga a `Arc<Mutex<T>>`. | §6.3, §5, §6.2 |
| **`Rc` contra `Arc`** | `Rc` no cruza hilos | `Rc` por defecto en el modo seguro; `Arc` cuando el análisis de hilos lo pide (§7 paso 4). | §6.3, §6.2 |
| **`Span<T>` contra `&[T]`** | Un slice es una vista con vida limitada | Los slices se pasan por referencia: `&[T]` y `&mut [T]`. `System.Span<T>` no es un tipo de la v1 (§4.4). | §6.3, §12 |
| **Interior mutability** | `RefCell` entra en pánico con un doble `borrow_mut` | Es el comportamiento del modo seguro (§5) y la razón del sugar `reentrancy = "panic"` (sección 6). | §6.2, §5 |

Coste de estas reglas: el Rust generado puede ser **más largo** (§8.1,
§1) y el modo optimizado (§7) puede eliminar `RefCell`, bajar `class` a
`struct` o desvirtualizar, **siempre que el comportamiento observable no
cambie**.

---

## 8. Sintaxis de los atributos `[Weak]`, `[Borrowed]` y `[Owned]`

### 8.1 Decisión

Los tres atributos se escriben **sin argumentos**, y su ámbito lo fija
`AttributeUsage` en la clase de atributo. La forma es la que ya usa la spec
(§8.2: *«Campo `[Weak]` para ciclos»*) y la que mejor encaja con C#:

- Es **C# válido**: Roslyn lo parsea como un atributo normal, sin
  preprocesador y sin sintaxis extra (a diferencia de `#codeGenAI`, §8.3).
- No introduce ambigüedad: el compilador sabe por el sitio donde aparece
  cuál es el sentido, y no choca con nada de C#: no existe ningún tipo ni
  palabra clave `Weak`, `Borrowed` u `Owned`.
- Puede admitir extensiones después sin romper el código: añadir un
  argumento opcional es compatible con la forma sin argumentos.

Los tres atributos viven en `RSharp.Attributes` (`netstandard2.0`, §4.2) para
que Roslyn los resuelva; el transpilador los reconoce por su nombre completo
(`RSharp.Attributes.WeakAttribute`, etc.).

### 8.2 Tabla de atributos

| Atributo | Ámbito | Forma en C# | Tipo Rust generado | Efecto exacto |
|---|---|---|---|---|
| `[Weak]` | **Campo** | `[Weak] public Nodo? Siguiente;` | `Option<std::rc::Weak<RefCell<Nodo>>>` | El campo es una **referencia débil**: no mantiene vivo al objeto. Rompe el ciclo. Al leer, se hace `upgrade()` y el resultado es `Option<Rc<RefCell<Nodo>>>`: `None` si el objeto ya murió. |
| `[Borrowed]` | **Parámetro** | `f([Borrowed] string origen)` | `origen: &str` | El valor **no se clona** ni se copia: es un préstamo del argumento. El tiempo de vida lo ata al argumento (lifetimes omitidos, §6.3). Lo mismo aplica a los slices de un binding (`&[T]`, §12, Fase 5). |
| `[Borrowed]` | **Valor de retorno** | `[return: Borrowed] string Alias(string origen)` | `fn alias(origen: &str) -> &str` | El resultado es un **préstamo**: no se libera ni se clona. Se ata al primer argumento cuyo tipo encaje con el retorno; si no hay ninguno o hay varios candidatos, se rechaza con `R#0001` (nunca se adivina). |
| `[Owned]` | **Valor de retorno** | `[return: Owned] IntPtr Native()` | `-> OwnedPtr<u8>` (con `Drop`) | El **receptor** es el dueño: el valor se libera al final de su vida. El liberador lo declara el binding (§13). |
| `[Owned]` | **Parámetro** | `f([Owned] IntPtr p)` | `p: Box<u8>` | El **llamado** es el dueño: libera el valor al terminar. |

### 8.3 Ejemplos con su efecto

**`[Weak]` — rompe un ciclo de referencias**

```csharp
public class Nodo
{
    [Weak]
    public Nodo? Siguiente;
    [Weak]
    public Nodo? Anterior;
}
```

```rust
#[derive(Clone)]
pub struct Nodo {
    pub siguiente: Option<std::rc::Weak<RefCell<Nodo>>>,
    pub anterior: Option<std::rc::Weak<RefCell<Nodo>>>,
}
```

Reglas de `[Weak]`:

1. Solo en **campos** (`AttributeTargets.Field`) y solo de un tipo `class`.
2. El tipo del campo debe ser **anulable** (`T?`): si no, se rechaza con
   `R#0001` (el tipo pasaría a `Option` y eso cambiaría la semántica en
   silencio, §2.7).
3. Exige el sugar `cycles = "weak-attribute"` (§9). Con `cycles = "leak"` el
   atributo sigue siendo válido: es más estricto.
4. Si el análisis detecta un ciclo y el campo **no** lleva `[Weak]`, el
   analizador emite `R#0042` con el mensaje literal de §8.2:
   `R#0042: usa [Weak] en este campo o activa #codeGenAI`.
5. El objeto puede morir: el código C# que asumía que el campo estaba vivo
   recibe ahora `None`. La concesión es visible en el código, como exige
   §8.2.

**`[Borrowed]` — el parámetro es un préstamo**

```csharp
public static int Longitud([Borrowed] string texto) => texto.Length;
```

```rust
pub fn longitud(texto: &str) -> i32 { texto.encode_utf16().count() as i32 }
```

Reglas de `[Borrowed]`:

1. Es la forma que pide la spec para «lifetimes ligados a argumentos»
   (§12): *«Usa `[Borrowed]` o `clone` para lifetimes ligados a argumentos»*.
2. En un parámetro: el tipo pasa a referencia (`&[T]`, `&T`) y **no** se
   genera `.clone()`.
3. En un valor de retorno: se ata al primer argumento compatible. Si no hay
   candidato único, se rechaza con `R#0001`: el transpilador no adivina.
4. Con `[Borrowed]` no hay `unsafe` implícito: el bloque sigue exigiendo
   `unsafe` si el puntero lo requiere (§5.2).

**`[Owned]` — el receptor libera**

```csharp
[DllImport("mylib")]
public static extern [return: Owned] IntPtr NativeAlloc(int size);
```

```rust
extern "C" { fn mylib_native_alloc(size: i32) -> *mut u8; }

// OwnedPtr<T> (RSharp.Runtime) libera al final de su vida.
pub fn native_alloc(size: i32) -> OwnedPtr<u8> {
    OwnedPtr::from_raw(unsafe { mylib_native_alloc(size) })
}
```

Reglas de `[Owned]`:

1. Es la forma que pide la spec §13: *«Marca punteros devueltos con `[Owned]`
   o `[Borrowed]`»*.
2. En un valor de retorno: el valor se envuelve en un tipo con `Drop` que
   llama al liberador declarado por el binding. El liberador **no** se adivina:
   lo declara el binding (Fase 5, §13).
3. En un parámetro: el parámetro pasa a `Box<T>` y el llamado libera.
4. `[Owned]` y `[Borrowed]` son **excluyentes** en el mismo sitio: combinarlos
   se rechaza con `R#0001`.

### 8.4 Formas descartadas

- `[Weak(cycle)]`, `[Borrowed(arg0)]`, `[Owned(free)]`: los argumentos no
  aportan nada, porque el ámbito ya lo fija `AttributeUsage`.
- `[Lifetime("origen")]`: introduciría un cuarto atributo para lo que
  `[Borrowed]` ya resuelve (§12).
- Prefijos de tipo (`weak Nodo? Siguiente;`): no es C# válido, y el fuente
  `.rsh` debe ser C# válido (§3, §4.1). `WeakReference<Nodo>` tampoco: la BCL
  es una lista cerrada (BCL-V1 §2).

---

## 9. Cómo se usa este documento

`RSharp.Analyzers` lo usa como **tabla de consulta**: cada construcción de C#
que aparece en un `.rsh` se busca en las tablas de la sección 4 y, si no está
o excede su parte «parcial», se emite `R#0001` (o `R#0101` si es una API de la
BCL) con el mensaje de la sección 2.1. `RSharp.Compiler` lo usa como
**contrato de equivalencias**: la columna «Equivalente en Rust» es lo que el
generador debe producir, y las filas de las secciones 5 y 6 son los rechazos
y las concesiones que deben existir en el analizador.
