---
name: rsharp-sugar-and-ai-blocks
description: Úsala cuando el usuario pida implementar el sugar de R# (interruptores de rsharp.toml, [Weak], [Borrowed], [Owned], [RSharpSugar], R#0042), el bloque #codeGenAI con su proveedor de IA, el bloqueo de resultados de IA en rsharp.lock con hash, o cuando haya que decidir la sintaxis del bloque con IA compatible con Roslyn.
---

# Sugar y bloques con IA (`#codeGenAI`) en R#

## Cuándo usar esta skill

- Hay que implementar un **sugar**: una concesión explícita del programador
  (§8.2), o el bloque **`#codeGenAI`** (§8.3) con su proveedor.
- Hay que **bloquear** resultados de IA en `rsharp.lock` con su hash (§8.3).
- Hay que **decidir** la sintaxis del bloque con IA: está **ABIERTA** (§8.3).
- Aparece el diagnóstico `R#0042` (el código exige un sugar apagado).

## Contexto del proyecto

- **Spec:** §8.2 (sugar), §8.3 (bloques con IA), §9 (`rsharp.toml` y scopes de
  sobrescritura), §3 (`rsharp.lock`), §17 (`R#0042`), §2.6 (el sugar exige que
  el programador acepte una condición por escrito).
- **Decisiones abiertas:** `T-OPEN-001` (sintaxis de `#codeGenAI` compatible
  con Roslyn) y `T-OPEN-004` (sintaxis de `[Weak]`, `[Borrowed]`, `[Owned]`).
  Mientras no se cierren, estas tareas están **BLOCKED**.
- **Configuración (§9):** `[sugar]` con `strings`, `overflow`, `reentrancy`,
  `finalizers`, `cycles`; `[sugar.ai]` con `enabled`, `provider`, `endpoint`,
  `model`, `lock`, `max_tokens_per_block`.

## Procedimiento

### Parte A · Sugar (§8.2)

**A1 · Definir qué es sugar.** Sugar es lo que **exige una condición del
programador**: una restricción de estilo (campo `[Weak]` para ciclos), una
pérdida de semántica (desbordamiento con pánico) o un bloque con IA
(`#codeGenAI`).

Reglas de §8.2, sin excepción:

- Sin configuración, el sugar queda **apagado**.
- Un programador **no** debe activar sugar sin escribir algo (un atributo, una
  línea de configuración o un bloque visible).
- Cada concesión queda **visible** en el código o en `rsharp.toml`.
- El compilador **avisa** cuando el código exige sugar.

**A2 · Interruptores y ámbito.**

```toml
[sugar]
strings = "utf8"              # utf8 | utf16
overflow = "panic"            # panic | wrap | checked
reentrancy = "panic"          # panic | serialize
finalizers = "deterministic"  # deterministic | gc-like
cycles = "weak-attribute"     # weak-attribute | leak
```

- Los valores por defecto son **estrictos** (§9).
- Sobrescritura por archivo (`[assembly: RSharpSugar("overflow", "wrap")]`) y
  por método (el mismo atributo sobre el método); **gana el ámbito más cercano
  al código** (§9).
- `[profile.release.sugar]` aplica con `rsharp build --profile release`.
- El hash de la configuración de sugar va a `rsharp.lock`; un cambio de valor
  **invalida los bloqueos afectados** (§9).

**A3 · Atributos de concesión.**

```csharp
public class Nodo {
    [Weak]                       // evita el ciclo: el campo es Weak<RefCell<T>>
    public Nodo? Siguiente;
}
```

```rust
pub struct Nodo {
    pub siguiente: Option<std::rc::Weak<RefCell<Nodo>>>,
}
```

> **ABIERTO:** la sintaxis exacta de `[Weak]`, `[Borrowed]` y `[Owned]` está
> pendiente de `T-OPEN-004`. Usa la que fije esa decisión y **no** la
> inventes. Si la decisión no existe todavía, implementa el comportamiento con
> la sintaxis parametrizada y márcala como pendiente.

**A4 · `R#0042`.** Texto exacto de §8.2/§17:

```text
R#0042: usa [Weak] en este campo o activa #codeGenAI
```

- Indica la **directiva o el ajuste** necesario (§17).
- Apunta a la **línea del `.rsh`** (§17).
- El diagnóstico **desaparece** cuando el sugar está habilitado.

### Parte B · Bloques con IA (§8.3)

**B1 · Resolver la sintaxis (decisión ABIERTA).** §8.3 dice textualmente que
`#codeGenAI` y `#end` **no son directivas C# válidas** y que **Roslyn las
rechaza**. Hay que elegir **una** de estas tres opciones:

| Opción | Forma | Ventaja | Coste |
|---|---|---|---|
| **1. Preprocesador de C#** | `#if RSHARP_AI` … `#endif` | Roslyn lo acepta tal cual | El bloque no se ve como `#codeGenAI`; se ve el contenido, no la llamada a la IA |
| **2. Atributo sobre el método** | `[CodeGenAI(mode: "dynamic", cost: "tokens")]` | Compatible con Roslyn sin preprocesar | La IA no puede actuar sobre una región arbitraria |
| **3. Preprocesado de `.rsh` antes de Roslyn** | El preprocesador convierte `#codeGenAI(...)` … `#end` en algo que Roslyn acepte | Conserva la sintaxis de §8.3 | Añade una etapa al pipeline; hay que definir la reescritura |

**Estado:** la decisión está **ABIERTA** en §19.1 y es la tarea `T-OPEN-001`. **No
la decidas dentro de una tarea de implementación**: documenta las tres opciones
con sus criterios (compatibilidad con Roslyn, IntelliSense, visibilidad del
bloque como contrato, coste de la etapa extra) y deja la tarea `BLOCKED` hasta
que la decisión se cierre. La forma ilustrativa de §8.3 es:

```csharp
#codeGenAI(mode: "dynamic", cost: "tokens") "convierte esta reflection a tabla estática"
var props = obj.GetType().GetProperties();
#end
```

**B2 · Aplicar las reglas de §8.3.** La IA actúa **solo dentro del bloque**; el
resultado y el **hash del bloque** se guardan en `rsharp.lock`; se regenera
**solo si cambia el hash**; el resultado **DEBE** compilar con `rustc`; se
**muestra el coste en tokens antes de generar**; el bloque queda **visible
como contrato**; se **rechaza** `#codeGenAI` si el proyecto no lo habilita; el
modelo es **local por defecto** (Ollama en `localhost`) y una URL remota es
una opción; el **núcleo no usa IA** (§8.1).

**B3 · Configurar el proveedor.**

```toml
[sugar.ai]
enabled = true
provider = "ollama"                 # ollama | openai-compatible | none
endpoint = "http://localhost:11434"
model = "qwen2.5-coder"
lock = "rsharp.lock"
max_tokens_per_block = 4000
```

La clave de API, si la hay, vive en una **variable de entorno** (§9). Con
`enabled = false` (por defecto) el bloque se rechaza: "activa
`[sugar.ai].enabled`".

**B4 · Bloquear el resultado con hash.** `rsharp.lock` guarda, por bloque:

```json
{
  "id": "src/Main.rsh#12",
  "hash": "sha256:9f2c...",
  "model": "qwen2.5-coder",
  "promptHash": "sha256:41ab...",
  "tokens": 812,
  "output": "static readonly PropertyInfo[] Props = ..."
}
```

- El hash cubre el **contenido del bloque**, el **modelo** y el **prompt**: si
  cambia cualquiera, se regenera (§8.3).
- Con el hash intacto **no se llama al proveedor** (ni red, ni coste, ni
  tokens); un cambio en la configuración de sugar invalida los bloqueos
  afectados (§9) y `rsharp.lock` se confirma en git (§3).

**B5 · Validar el resultado.** El resultado se compila con **`rustc`** (§8.3);
si no compila, se regenera con el error como contexto o se devuelve el error al
usuario, y **nunca** se guarda un resultado que no compila. El resultado
aceptado se guarda en `rsharp.lock` junto a su hash y el consumo real de tokens
se registra.

### Parte C · Verificación

`dotnet build src/RSharp.sln` y `dotnet test src/RSharp.sln` en verde, con:
- test del hash: con el bloque intacto, la segunda ejecución **no** llama al
  proveedor (comprueba con un doble inyectado);
- test del coste: la estimación se muestra **antes** de generar y el
  `max_tokens_per_block` corta la generación;
- test del rechazo: sin `enabled = true`, el bloque produce un error claro;
- test de `R#0042`: con sugar apagado, el código que exige `[Weak]` avisa; con
  el atributo puesto, ya no avisa.

## Reglas

1. El sugar está **apagado por defecto** y cada concesión es **visible** (§8.2).
2. El núcleo **no** usa IA (§8.1). La IA solo actúa dentro de `#codeGenAI`.
3. `#codeGenAI` y `#end` **no son C# válido**: la sintaxis es una decisión
   **ABIERTA** (§8.3, `T-OPEN-001`). No la decidas aquí.
4. El resultado de la IA **DEBE** compilar con `rustc` antes de aceptarse.
5. Se regenera **solo** si cambia el hash del bloque.
6. El coste en tokens se muestra **antes** de generar.
7. `rsharp.lock` guarda hashes y versiones fijas; se confirma en git (§3).
8. Identificadores en inglés; comentarios, avisos y textos de UI en español; si
   una regla depende de una decisión abierta, dilo y marca la tarea `BLOCKED`.

## Salida esperada

- La tabla de interruptores de sugar con su ámbito y su precedencia.
- El texto exacto de `R#0042` y el punto del código al que apunta.
- El análisis de las tres opciones de sintaxis de §8.3 (o la implementación
  **parametrizada** por la decisión que ya exista).
- El formato de la entrada de `rsharp.lock` con su hash.
- Los tests de hash, coste, rechazo y validación con `rustc`, y el resumen con
  las decisiones asumidas, las **ABIERTAS** y los comandos ejecutados.
