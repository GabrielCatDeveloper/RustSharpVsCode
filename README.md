# RustSharpVsCode

Extensión de VSCode para **R# (Rust#)**: el lenguaje con sintaxis de C# que se
transpila al 100 % a Rust.

- **Especificación del lenguaje y del compilador:** [`rsharp-spec.md`](rsharp-spec.md)
- **Tutorial completo de la extensión:** [`docs/EXTENSION.md`](docs/EXTENSION.md)

```
src/main.rsh  ──[rsharp transpile]──▶  target/rsharp/main.rs  ──[cargo build]──▶  dist/mi_app
```

La extensión es un **cliente delgado**: invoca la CLI `rsharp` (que corre en
.NET) y `cargo`, y traduce los errores de Rust a la línea de tu `.rsh`, igual
que TypeScript hace con el JavaScript generado.

---

## Estructura del repositorio

```
.
├── rsharp-spec.md          Especificación técnica de R# (fuente de verdad)
├── package.json            Raíz del monorepo (npm workspaces)
├── docs/                   Documentación
│   ├── EXTENSION.md        Tutorial: qué se puede y qué no se puede hacer
│   ├── ARCHITECTURE.md     Módulos, capas y flujos
│   ├── CLI-CONTRACT.md     Contrato que debe cumplir la CLI `rsharp`
│   └── decisions/          Las 8 decisiones abiertas de la spec (§19), resueltas
├── ai/                     Parte de IA: cómo se desarrolla el proyecto
│   ├── README.md           Flujo "IA implementa → IA principal revisa"
│   ├── ROADMAP.md          Roadmap del proyecto R# por fases
│   ├── TASKS.md            Backlog de tareas (105)
│   ├── REVIEW.md           Bitácora de revisiones
│   └── skills/             5 skills reutilizables (SKILL.md)
├── examples/
│   └── rsharp-demo/        Proyecto de ejemplo (20 pruebas, incl. diferencial)
└── extension/              La extensión de VSCode
    ├── package.json        Manifiesto de la extensión
    ├── src/                Código TypeScript (19 módulos + tests)
    ├── syntaxes/           Gramática TextMate para `.rsh`
    ├── snippets/           Snippets de R#
    ├── language-configuration/
    ├── media/              Icono de la barra lateral
    └── tools/              CLI de simulación y mini-transpilador
```

---

## Puesta en marcha

```bash
git clone git@github.com:GabrielCatDeveloper/RustSharpVsCode.git
cd RustSharpVsCode
npm install          # instala las dependencias de la extensión
npm run compile      # compila la extensión
npm test             # 183 pruebas
npm run package      # genera extension/rsharp.vsix
```

Para desarrollar en VSCode: abre la raíz del repositorio y pulsa **F5**.

### Requisitos de uso

| Herramienta | Para qué |
|---|---|
| .NET SDK 8+ | Ejecutar la CLI `rsharp` |
| Rust (`cargo`) | Compilar el Rust generado |
| C# Dev Kit (opcional) | Autocompletado y diagnóstico de C# en `.rsh` |
| CodeLLDB (opcional) | Depuración |

---

## Estado actual

| Área | Estado |
|---|---|
| Extensión de VSCode (comandos, gramática, diagnósticos, source maps, ejecución, depuración) | ✅ Implementada |
| Proyecto de ejemplo con flujo completo y prueba diferencial contra .NET | ✅ 20/20 pruebas |
| CLI `rsharp` (compilador) | 🟡 Sustituido por un mini-transpilador para el ejemplo |
| BCL por destino | ⛔ Pendiente |
| Destino WASM completo | 🟡 Parcial (la extensión ya compila a WASM) |
| Bindings de crates y FFI | ⛔ Pendiente |
| Depuración completa con CodeLLDB | 🟡 Parcial (plantilla + traducción de puntos de parada) |

La extensión se puede probar **hoy** con la CLI de simulación:

```jsonc
// .vscode/settings.json
{ "rsharp.cliPath": "/ruta/al/repo/extension/tools/mock-rsharp.mjs" }
```

Y el proyecto de ejemplo se prueba de extremo a extremo:

```bash
npm run demo        # transpila, compila, ejecuta y compara con .NET
npm test            # 186 pruebas de la extensión
```

---

## Licencia

GPL-3.0. Ver [`LICENSE`](LICENSE).
