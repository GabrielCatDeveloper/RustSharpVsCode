# 0008 · Estrategia de pruebas diferenciales entre .NET y Rust

- **Estado:** ACEPTADA
- **Fecha:** 2026-11-13
- **Sección de la spec:** §4.1 · §18 · §19.8 (decisión ABIERTA)
- **Sustituye a:** nada (la decisión sigue abierta en la spec)

## Contexto

La spec §4.1 dice: «La prueba diferencial compara la salida de .NET con la del
Rust generado». Es la única forma de comprobar que el transpilador no cambia
la semántica del programa, porque R# **debe** imitar a C# (spec §2.1).

Pero la spec no dice cómo se monta ese banco de pruebas, y no puede hacerlo
todavía: el transpilador no existe.

## Decisión

El banco de pruebas tiene **tres niveles**, y cada uno puede existir antes que
los demás.

### Nivel 1 — Banco de casos (el que ya existe)

Un directorio de casos, cada uno con:

| Fichero | Contenido |
|---|---|
| `caso.rsh` | El caso, escrito en C# válido (es C# válido por definición, spec §3). |
| `esperado.txt` | La salida esperada, fijada a mano. |
| `caso.cs` | Opcional: la versión C# del caso, si difiere (p. ej. para probar una API no soportada por R#). |

El banco **no necesita transpilador**: basta con compilar el `.rsh` como C#
(con Roslyn) y comparar con la salida esperada. Sirve para fijar la semántica
de referencia.

Ejemplo real: `examples/rsharp-demo/` es un caso completo.

### Nivel 2 — Diferencial automático (el que ya existe)

El mismo `.rsh` se ejecuta **dos veces**:

1. Como C#, con el SDK de .NET.
2. Como Rust, transpilado y compilado con `cargo`.

Si las salidas no coinciden byte a byte, **el transpilador ha cambiado la
semántica** y es un error.

Implementación de referencia: `examples/rsharp-demo/tests/run-tests.mjs`.

#### Reglas de comparación

| Regla | Detalle |
|---|---|
| Normalización | Se normalizan los finales de línea (`\r\n` → `\n`) y los espacios finales. |
| Byte a byte | Todo lo demás se compara tal cual: el orden, los separadores, los números. |
| Formato numérico | La cultura debe ser la invariante en los dos lados: en C#, `CultureInfo.InvariantCulture`; en Rust, siempre. |
| Separadores decimales | Es la diferencia más habitual y ya la ha encontrado el banco (§18: «Pueden diferir casos límite entre .NET y Rust (UTF-16, desbordamiento)»). |

#### Lo que ya ha encontrado

El banco no es un formality: en la primera ejecución encontró dos fallos
reales.

| Hallazgo | Corrección |
|---|---|
| Faltaba `using System.Linq;` → el caso no era C# válido | Añadido al caso. |
| .NET imprimía `1,50` (cultura local) y Rust `1,50` → `1.50` (invariante) | El caso fija `CultureInfo.InvariantCulture`. |

### Nivel 3 — Casos generados

Cuando haya suficientes casos a mano, se generan casos aleatorios
(programables) para explorar el espacio: números en el borde del
desbordamiento, `null`, cadenas Unicode,addleColecciones vacías.

Este nivel **depende del Nivel 2** y no se activa hasta que la comparación
sea fiable.

## Criterios de aceptación del banco

1. Cada caso se ejecuta en los dos motores y las salidas se comparan.
2. Un caso que falla en un motor y no en el otro es un **error del
   transpilador**, salvo que esté marcado como diferencia conocida.
3. Las diferencias conocidas se documentan en el caso, con su motivo
   (cultura, desbordamiento, `finalizers`).
4. El banco corre en integración continua, sin red.

## Consecuencias

- El banco **no depende del transpilador** para fijar la semántica: el Nivel 1
  ya funciona y es el que se ha usado hasta ahora.
- La diferencia entre .NET y Rust está **documentada caso a caso**, no
  escondida.
- Cuando exista `RSharp.Cli`, el Nivel 2 pasa a ser la prueba de regresión
  principal del compilador.

## Cómo se usa este documento

Es la referencia para montar el banco de pruebas del proyecto y para añadir
casos nuevos.
