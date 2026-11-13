# `ai/` — Parte de IA del proyecto R#

Esta carpeta es la **bitácora de trabajo con IA** del proyecto R# (RSharp): el
roadmap, el backlog ejecutable, el registro de revisiones y las skills que
guían a los subagentes que implementan el proyecto.

No contiene código de producción. El código vive en `extension/` (la
extensión de VSCode) y, a partir de la Fase 1, en `src/` (la solución .NET con
`RSharp.Attributes`, `RSharp.Runtime`, `RSharp.Compiler`, `RSharp.Analyzers` y
`RSharp.Cli`).

## Estructura

```
ai/
├── README.md          Este archivo: qué es la carpeta y cómo se usa.
├── ROADMAP.md         Roadmap completo del PROYECTO R# (fases 0 a 9).
├── TASKS.md           Backlog ejecutable: una entrada por tarea.
├── REVIEW.md          Bitácora de revisiones y reglas de revisión.
└── skills/
    ├── rsharp-core-transpiler/SKILL.md
    ├── rsharp-bcl-mapping/SKILL.md
    ├── rsharp-wasm-and-ffi/SKILL.md
    ├── rsharp-sugar-and-ai-blocks/SKILL.md
    └── rsharp-vscode-extension/SKILL.md
```

## Roles de cada archivo

| Archivo | Contenido | Quién lo mantiene |
|---|---|---|
| `ROADMAP.md` | Las 10 fases del proyecto (0 a 9), con objetivo, entregables, dependencias, criterios de aceptación y riesgos de la §18 de la spec. Incluye la tabla de estado por fase. | El agente principal, con los resultados de las revisiones. |
| `TASKS.md` | El backlog. Cada tarea tiene un identificador `T-<ÁREA>-<NNN>`, un estado, su fase, sus dependencias, los archivos que toca y sus criterios de aceptación. | El agente principal crea; el ejecutor mueve el estado a `WIP`/`REVIEW`. |
| `REVIEW.md` | Una entrada por revisión: defectos con archivo y línea, correcciones, observaciones pendientes y veredicto. Contiene la checklist que se aplica a toda tarea. | El revisor (agente principal). |
| `skills/*/SKILL.md` | Procedimientos accionables por área, con ejemplos de código. Es lo que el subagente lee antes de implementar. | El agente principal. |

## El flujo de trabajo: IA implementa → IA principal revisa → se acepta o se devuelve

```
   ┌──────────────┐   T-<ÁREA>-<NNN>   ┌──────────────────┐
   │  Agente      │ ─────────────────► │  Agente principal │
   │  principal   │                    │  (revisor)       │
   │  delega      │ ◄───────────────── │                  │
   └──────────────┘   REWORK + notas   └──────────────────┘
          ▲                                   │
          │                                   │ APROBADO
          │                                   ▼
          │                            Estado: DONE
          │
   Cambio de estado a WIP/REVIEW
```

1. **El agente principal elige una tarea** de `ai/TASKS.md` con estado `TODO`,
   la marca como `WIP` y se la delega a un subagente.
2. **El subagente implementa** siguiendo la skill del área y las reglas de
   ejecución del `README.md`. Al terminar marca la tarea como `REVIEW` y
   entrega un resumen: qué cambió, qué archivos tocó, qué tests se ejecutaron
   y qué queda pendiente.
3. **El agente principal revisa** el diff contra los criterios de aceptación
   de la tarea y contra las reglas de revisión de `ai/REVIEW.md`.
4. **Veredicto**:
   - `APROBADO` o `APROBADO CON OBSERVACIONES` → la tarea pasa a `DONE`, se
     añade la entrada en `ai/REVIEW.md` y se actualiza la tabla de estado de
     `ai/ROADMAP.md`.
   - `REWORK` → la tarea vuelve a `REWORK` y el subagente la reabora con la
     lista de defectos (archivo y línea) como entrada.
   - `RECHAZADO` → el enfoque se descarta; la tarea se rehace o se cancela.
5. **Las observaciones no bloqueantes se convierten en tareas nuevas** en
   `ai/TASKS.md`, nunca se dejan perdidas en el chat.

### Roles

| Rol | Modelo / quién | Qué hace |
|---|---|---|
| Ejecutor | `minimax/MiniMax-M3.1-Flash` (subagente) | Implementa la tarea, escribe los tests y deja la tarea en `REVIEW`. |
| Revisor | El agente principal de la sesión | Aplica la checklist de `ai/REVIEW.md`, emite el veredicto y decide `DONE` / `REWORK` / `RECHAZADO`. |
| Decisor | El agente principal de la sesión | Resuelve las decisiones abiertas (`T-OPEN-001..008`) y actualiza el roadmap. |

> El modelo ejecutor por defecto es **`minimax/MiniMax-M3.1-Flash`**. El
> revisor es **siempre** el agente principal de la sesión: el ejecutor no se
> auto-aprueba.

## Cómo se ejecuta una tarea concreta

Ejemplo: implementar `T-BCL-002` (mapeo por destino y diagnóstico `R#0101`).

**1. El agente principal marca la tarea y delega.**

```
T-BCL-002 · Mapeo por destino y diagnóstico R#0101
  Estado: TODO → WIP
  Skill a cargar: ai/skills/rsharp-bcl-mapping/SKILL.md
  Spec relevante: §10 y §17
```

**2. El ejecutor prepara el entorno y lee el contexto.**

```bash
cd /home/gabriel/Proyectos/GabrielCatDev/Rust#ExtVsCode

# La especificación es la fuente de verdad: leer §10 y §17.
sed -n '348,365p' rsharp-spec.md     # §10 Biblioteca estándar
sed -n '521,531p' rsharp-spec.md     # §17 Diagnósticos

# Los contratos compartidos de la extensión:
sed -n '1,120p' extension/src/types.ts
```

**3. El ejecutor implementa y verifica.**

```bash
# Núcleo en .NET (Fase 1 en curso):
dotnet build src/RSharp.sln

# Extensión de VSCode: compilación estricta y tests.
cd extension
npm run lint          # tsc -p ./ --noEmit (strict)
npm test              # node --test out/test/*.test.js
```

En un shell que no sea interactivo, o para capturar el resultado:

```bash
cd extension && npm run lint && npm test
```

**4. El ejecutor deja la tarea en `REVIEW`** con un resumen obligatorio:

```markdown
### T-BCL-002 · Mapeo por destino y diagnóstico R#0101
- **Estado:** REVIEW
- **Ejecutor:** MiniMax M3.1 Flash (implementación) + revisión del agente principal
- **Fase:** Fase 3
- **Depende de:** T-OPEN-002, T-CORE-003
- **Objetivo:** Hacer que el mapeo de la BCL dependa del target y emita R#0101 cuando no exista.
- **Archivos:** src/RSharp.Compiler/Bcl/TargetCapabilityTable.cs, src/RSharp.Analyzers/UnsupportedApiAnalyzer.cs
- **Criterios de aceptación:** ...
- **Notas de la revisión:**
  - Implementado el mapa de capacidades por destino.
  - `File.ReadAllText` se rechaza en wasm32-unknown-unknown con R#0101.
  - Tests: `dotnet test` en verde. Sin bloqueos.
```

**5. El revisor comprueba y emite el veredicto**, añadiéndolo a `ai/REVIEW.md`
con la plantilla de ese archivo y actualizando el estado de la tarea.

### Comandos de apoyo

| Comando | Para qué |
|---|---|
| `dotnet build src/RSharp.sln` | Compilar la solución del núcleo (Fase 1). |
| `dotnet test src/RSharp.sln` | Ejecutar los tests del núcleo. |
| `cd extension && npm run lint` | Comprobar TypeScript `strict` sin emitir archivos. |
| `cd extension && npm test` | Compilar y ejecutar los tests de la extensión. |
| `cd extension && npm run package` | Empaquetar la extensión en `rsharp.vsix`. |
| `node extension/tools/mock-rsharp.mjs transpile --project . --json` | Simular la CLI sin compilador instalado. |
| `grep -c '^### T-' ai/TASKS.md` | Contar las tareas del backlog. |

## Reglas de la casa

1. `rsharp-spec.md` manda. Si un punto está **ABIERTO** en la spec, la tarea
   lo dice y no lo decide: se abre una `T-OPEN-*`.
2. Nada de comportamiento silencioso: lo que el núcleo no soporta se rechaza
   con error (§2.7, §8.1).
3. El núcleo **no** usa IA (§8.1). La IA solo actúa dentro de `#codeGenAI` y
   dentro de los plugins, con las condiciones de §8.3 y §16.
4. Todo en español: identificadores de código en inglés, comentarios y textos
   de UI en español.
5. La extensión es un cliente delgado (§14.1): no reimplementa el compilador y
   **no muestra el Rust transpilado** al usuario salvo acción explícita.
6. Cada tarea deja el árbol compilando y, cuando aplique, con tests en verde.
7. Cada tarea cerrada deja una entrada en `ai/REVIEW.md`.

## Relación con la especificación

| Documento | Qué fija |
|---|---|
| `rsharp-spec.md` | El diseño completo de R#: lenguaje, transpilador, BCL, WASM, FFI, plugins, sugar, IA, diagnóstico y riesgos. |
| `ai/ROADMAP.md` | En qué orden se construye ese diseño (10 fases). |
| `ai/TASKS.md` | Qué se hace en cada fase, tarea a tarea. |
| `ai/REVIEW.md` | Cómo se comprueba lo que se hace. |
| `ai/skills/*/SKILL.md` | Cómo se hace cada tipo de trabajo. |
