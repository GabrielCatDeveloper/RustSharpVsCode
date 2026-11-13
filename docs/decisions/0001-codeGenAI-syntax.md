# 0001 · Sintaxis de `#codeGenAI` compatible con Roslyn

- **Estado:** ACEPTADA
- **Fecha:** 2026-11-13
- **Sección de la spec:** §8.3 (decisión ABIERTA) · §19.1
- **Sustituye a:** nada (la decisión sigue abierta en la spec)

## Contexto

La spec §8.3 describe un bloque con IA:

```csharp
#codeGenAI(mode: "dynamic", cost: "tokens") "convierte esta reflection a tabla estática"
var props = obj.GetType().GetProperties();
#end
```

Y avisa de que **eso no es C# válido**: Roslyn lo rechaza. La spec deja tres
opciones abiertas:

1. Usar `#if RSHARP_AI` y `#endif`.
2. Usar un atributo sobre el método.
3. Preprocesar los `.rsh` antes de Roslyn.

La decisión tiene tres consumidores: el compilador (`RSharp.Compiler`), la
extensión de VSCode (que resalta el bloque y muestra su coste) y el
formateador.

## Decisión

**Se adopta la opción 1: `#if RSHARP_AI` / `#endif`**, y el bloque `#codeGenAI`
de la spec se define como **una convención de preprocesador**, no como una
construcción del lenguaje:

```csharp
#if RSHARP_AI
#if codeGenAI(mode: "dynamic", cost: "tokens") "convierte esta reflection a tabla estática"
var props = obj.GetType().GetProperties();
#endif
#endif
```

El preprocesador de R# reconoce el segundo `#if` con la directiva `codeGenAI`
y lo convierte en un bloque con IA. La forma original de la spec
(`#codeGenAI ... #end`) se acepta **como alias** y se normaliza a esta.

### Reglas

| Regla | Detalle |
|---|---|
| Reconocimiento | `#if codeGenAI(...) "descripción"` … `#endif` |
| Anidamiento | No se permite un bloque con IA dentro de otro |
| Arguments | `mode` (`dynamic` \| `static` \| `cheap`), `cost` (`tokens` \| `time` \| `free`) |
| Descripción | Obligatoria: es el contrato que ve el programador |
|保 Resultado | El bloque se sustituye por su resultado antes de que Roslyn lo vea |
| Sin IA habilitada | El bloque se rechaza con `R#0042` (spec §8.2) |

### Por qué la opción 1 y no las otras

| Opción | Motivo del descarte |
|---|---|
| 2. Atributo sobre el método | Obliga a que el bloque coincida con un método completo: no permite el bloque libre de la spec, y un atributo con argumentos arbitrarios es C# válido pero con semántica propia que Roslyn no conoce. |
| 3. Preprocesar antes de Roslyn | Introduce un paso extra entre el usuario y el compilador, con su propio lenguaje de preprocesado. Es la opción más potente, pero la más cara de mantener, y no hace falta para el caso de uso. |

La opción 1 tiene una ventaja decisive: **`#if` y `#endif` son C# válido**,
así que el fichero se puede abrir, compilar y depurar con las herramientas
estándar de C# (C# Dev Kit, Roslyn, el depurador de .NET) aunque el bloque con
IA esté desactivado. Eso es exactamente lo que hace la extensión: compila los
`.rsh` con Roslyn y depura sobre ellos.

### Consecuencias

- La gramática TextMate de la extensión resalta **las dos formas**: `#if
  RSHARP_AI` como directiva de preprocesador y `#codeGenAI` como bloque con IA
  (`meta.embedded.block.rsharp`).
- El compilador define `RSHARP_AI` cuando el proyecto tiene la IA habilitada
  (`[sugar.ai].enabled = true`), de modo que el código C# ordinary sigue
  compilándose sin el bloque.
- La IA solo actúa **dentro** del bloque (spec §8.3).
- El resultado se guarda en `rsharp.lock` con el hash del bloque; solo se
  regenera si el hash cambia.

### Cómo se usa este documento

Es la referencia para implementar el bloque con IA en `RSharp.Compiler` y
para mantener el resaltado de la extensión coherente con el compilador.
