# 0006 · Esquema JSON completo de `rsharp.toml`

- **Estado:** ACEPTADA
- **Fecha:** 2026-11-13
- **Sección de la spec:** §9 · §19.6 (decisión ABIERTA)
- **Sustituye a:** nada (la decisión sigue abierta en la spec)

## Contexto

La spec §9 define el contenido de `rsharp.toml` y dice «Un esquema JSON
valida el archivo». Falta el esquema, y sin él nadie puede escribir un
`rsharp.toml` válido sin leer la spec entera.

## Decisión

El esquema vive en **`extension/schemas/rsharp.schema.json`** (JSON Schema
draft-07) y la extensión lo publica para que VSCode lo aplique al abrir el
fichero:

```json
"jsonValidation": [
  { "fileMatch": ["rsharp.toml"], "url": "./schemas/rsharp.schema.json" }
]
```

### Efectos directos en el editor

| Efecto | Detalle |
|---|---|
| Validación | Las claves desconocidas en las sub-tablas estrictas se marcan como error. |
| Autocompletado | Al escribir `[sugar.` el editor ofrece `strings`, `overflow`, `reentrancy`, `finalizers` y `cycles`. |
| Documentación en línea | Cada propiedad muestra su descripción y su valor por defecto al pasar el ratón. |
| Sin red | El esquema viaja dentro de la extensión: funciona sin conexión. |

### Estructura del esquema

| Sección | Propiedades |
|---|---|
| Raíz | `schema` (const 1), `project`, `paths`, `build`, `sugar`, `ai`, `plugins`, `dependencies`, `foreign`, `profile` |
| `[project]` | `name` |
| `[paths]` | `output`, `dist` |
| `[build]` | `target`, `profile` |
| `[sugar]` | `strings`, `overflow`, `reentrancy`, `finalizers`, `cycles` |
| `[sugar.ai]` | `enabled`, `provider`, `endpoint`, `model`, `lock`, `max_tokens_per_block` |
| `[plugins]` | Lista ordenada de nombres |
| `[dependencies]` | Crate → versión (string) o tabla en línea |
| `[foreign.<nombre>]` | `kind`, `path`, `header`, `link`, `version` |
| `[profile.<nombre>.sugar]` | Sobrescritura de los valores de sugar |

### Reglas

| Regla | Detalle |
|---|---|
| Raíz permisiva | Se permiten claves desconocidas en la raíz: el proyecto puede llevar extensiones propias. |
| Sub-tablas estrictas | Las sub-tablas tienen `additionalProperties: false`: una errata se ve enseguida. |
| `[ai]` en la raíz | Se acepta como **alias** de `[sugar.ai]`, porque el código ya lo leía así. La forma canónica es `[sugar.ai]`. |
| `[plugins]` | Acepta las tres formas que tolera el lector: lista, `{ list = [...] }` y tabla vacía. |
| `foreign.kind` | Obligatorio: es el discriminante del tipo de enlace. |
| `profile` | Tabla dinámica: cada clave es un perfil y contiene `sugar`. |

### Dónde vive la validación real

El esquema sirve para **el editor**; la validación **definitiva** la hace el
compilador al leer la configuración (`RSharp.Compiler`), que además comprueba
las reglas que el esquema no puede expresar:

- que `outputDir` y `distDir` **no sean la misma carpeta** (spec §14.4);
- que las rutas relativas se resuelvan contra la carpeta del `.toml`;
- que los perfiles existentos.

La extensión ya avisa de esas tres cosas en el panel de salida.

## Consecuencias

- `rsharp.toml` se puede escribir sin consultar la spec.
- El esquema y `extension/src/config.ts` deben mantenerse sincronizados: el
  agente principal lo verifica comparando el esquema con el TOML real del
  ejemplo y con el de la spec.
- Cuando la spec añada una clave, hay que actualizar el esquema.

## Cómo se usa este documento

Es la referencia del esquema y de su publicación en la extensión.
