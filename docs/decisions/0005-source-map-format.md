# 0005 · Formato del source map

- **Estado:** ACEPTADA
- **Fecha:** 2026-11-13
- **Sección de la spec:** §14.4 · §19.5 (decisión ABIERTA)
- **Sustituye a:** nada (la decisión sigue abierta en la spec)

## Contexto

La spec §14.4 exige «Traduce errores de `rustc` a líneas de R# con source maps»
y §17 que «Cada diagnóstico apunta a la línea de R#, no a la de Rust». Pero no
fija el formato, y el formato es un **contrato entre el compilador y la
extensión**: si cambia, hay que cambiar las dos partes a la vez.

## Decisión

El formato es el que ya implementa la extensión (`RSharpSourceMap` en
`extension/src/types.ts`):

```json
{
  "rustFile": "main.rs",
  "rshFile": "src/Program.rsh",
  "entries": [
    { "rustLine": 12, "rshLine": 9 },
    { "rustLine": 13, "rshLine": 10 }
  ]
}
```

### Reglas

| Regla | Detalle |
|---|---|
| Unidad | La **línea**, no el rango. El rango se deriva del archivo. |
| Origen | `rshFile` es la ruta del `.rsh` **relativa a la raíz del proyecto**. |
| Destino | `rustFile` es la ruta del `.rs` **relativa a la carpeta de salida**. |
| Entradas | Una por línea de Rust que procede de una línea de R#. |
| Coherencia | Las entradas van **en orden creciente** de `rustLine`. |
| Resolución | La línea de R# de una línea de Rust es la de la entrada más cercana **anterior**; si no hay ninguna, la de la primera entrada. |
| Ausencia | Si no hay source map para un fichero, el error **no se ancla**: se muestra en el panel de salida, sin inventar una posición (spec §17). |

### Por qué línea y no rango

- El error de `rustc` da línea y columna; la columna se conserva tal cual.
- Un rango exigiría que el compilador emitiese columnas de origen, lo que
  multiplicaría el tamaño del source map sin ganancia real.
- La resolución «más cercana anterior» es la misma que usan los depuradores
  cuando el código generado no tiene una correspondencia exacta.

### El caso alineado

Cuando el compilador puede emitir **una línea de Rust por línea de C#** (por
ejemplo, dejando las líneas sobrantes como comentarios), el source map es
trivial y además vale para el remapeo de rutas de LLDB
(`target.source-map remap`), que solo entiende de ficheros, no de líneas.

Esa es la razón por la que el mini-transpilador de ejemplo
(`extension/tools/transpile.mjs`) emite Rust alineado: con la alineación, un
punto de parada puesto en el `.rsh` resuelve en la línea correcta.

## Consecuencias

- El contrato queda fijado en `docs/CLI-CONTRACT.md` y en
  `extension/src/types.ts`; ambos deben cambiar a la vez.
- La extensión guarda la sesión (source maps incluidos) en
  `target/rsharp/.rsharp-session.json`, de modo que los errores se siguen
  traduciendo tras reiniciar VSCode.
- La CLI de simulación ya produce este formato.

## Cómo se usa este documento

Es la referencia del contrato que debe cumplir `RSharp.Cli` y la que consume
la extensión para traducir los errores de `rustc`.
