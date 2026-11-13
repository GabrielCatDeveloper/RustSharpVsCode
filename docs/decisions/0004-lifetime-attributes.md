# 0004 · Sintaxis de `[Weak]`, `[Borrowed]` y `[Owned]`

- **Estado:** ACEPTADA
- **Fecha:** 2026-11-13
- **Sección de la spec:** §12 · §13 · §19.4 (decisión ABIERTA)
- **Sustituye a:** nada (la decisión sigue abierta en la spec)

## Contexto

La spec menciona tres atributos en distintos sitios:

- §8.2: «Restricción de estilo · Campo `[Weak]` para ciclos».
- §12: «Usa `[Borrowed]` o `clone` para lifetimes ligados a argumentos».
- §13: «Marca punteros devueltos con `[Owned]` o `[Borrowed]`».

Pero no fija su sintaxis, su ámbito ni su semántica exacta. Como el núcleo
debe ser determinista (§2.4), hace falta una forma única y no ambigua.

## Decisión

**Los tres son atributos sin argumentos**, declarados en `RSharp.Attributes`
(`netstandard2.0`, spec §4.2) y con el ámbito fijado por `AttributeUsage`:

| Atributo | Ámbito | Se aplica a | Efecto en Rust |
|---|---|---|---|
| `[Weak]` | Campo | Campos de tipo referencia y anulables | `Option<std::rc::Weak<RefCell<T>>>` |
| `[Borrowed]` | Parámetro y valor de retorno | Parámetros y retornos | `&T` en vez de `T` |
| `[Owned]` | Parámetro y valor de retorno | Parámetros y retornos | `Box<T>` / `OwnedPtr<T>` con `Drop` |

### `[Weak]`

```csharp
public class Nodo
{
    [Weak]                         // solo en campos
    public Nodo? Siguiente;        // -> Option<Weak<RefCell<Nodo>>>
}
```

Reglas:

- Solo en **campos** de tipo referencia, y el tipo debe ser anulable (`T?`).
- Exige el sugar `cycles = "weak-attribute"` (spec §8.2). Con el sugar
  apagado se rechaza con `R#0042`.
- Un campo `[Weak]` sin `?` es un error: debilitar una referencia que no puede
  ser nula no tiene sentido.
- El ciclo se rompe con `Weak`; el compilador **no** decide los ciclos por su
  cuenta (spec §5.2).

### `[Borrowed]`

```csharp
public static int Longitud([Borrowed] string texto) => texto.Length;
// -> pub fn longitud(texto: &str) -> i32

[return: Borrowed] string Alias(string origen);
// -> pub fn alias(origen: &str) -> &str
```

Reglas:

- Marca que el valor **no** es propiedad del receptor: se pasa por referencia.
- En un **retorno**, el lifetime se ata al primer argumento compatible del
  mismo tipo. Si no hay un candidato único, el compilador **no adivina**:
  rechaza con `R#0001` (construcción fuera del núcleo v1, ver §17 y la
  decisión 0003).
- En un **parámetro**, se combina con `clone` si el valor debe sobrevivir a la
  llamada (spec §12).

### `[Owned]`

```csharp
[return: Owned] IntPtr NativeAlloc(int n);
// -> OwnedPtr<u8> (con Drop)

void Libera([Owned] IntPtr p);
// -> p: Box<u8>
```

Reglas:

- Marca que el receptor **es** el dueño del valor: se pasa por valor y se
  libera con `Drop` (spec §13: «Copia los `string` al cruzar. Libera con
  `Drop`»).
- `[Owned]` y `[Borrowed]` son excluyentes en el mismo sitio.
- Toda llamada a una función nativa exige `unsafe` (spec §13).

### Por qué atributos y no sintaxis nueva

- Es **C# válido**: el fichero se abre, compila y depura con las herramientas
  estándar sin que el analizador tenga que inventar una gramática.
- El ámbito es inequívoco por el sitio donde aparece el atributo.
- Coincide con lo que la spec ya escribe («Campo `[Weak]` para ciclos»,
  §8.2) y con el estilo de los demás atributos de R# (`[Export]`,
  `[Extern]`, `[WasmExport]`).

## Consecuencias

- `RSharp.Attributes` declara los tres atributos con `AttributeUsage` para que
  Roslyn los resuelva sin preprocesador.
- La gramática TextMate de la extensión ya los resalta
  (`support.function.attribute.rsharp`).
- La extensión puede avisar en el editor cuando un campo `[Weak]` no es
  anulable o cuando falta el sugar: es un caso de `R#0042`.

## Cómo se usa este documento

Es la referencia para implementar `RSharp.Attributes` y para que el analizador
y el compilador apliquen las mismas reglas.
