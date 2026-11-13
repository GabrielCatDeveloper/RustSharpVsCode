# R# (Rust#) — extensión de VSCode

Cliente delgado del compilador R#: transpila C# a Rust, compila a nativo o
WASM y ejecuta, **sin mostrarte el Rust generado**.

- Tutorial completo (qué se puede y qué no): [`../docs/EXTENSION.md`](../docs/EXTENSION.md)
- Arquitectura: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
- Contrato de la CLI: [`../docs/CLI-CONTRACT.md`](../docs/CLI-CONTRACT.md)

## Desarrollo

```bash
npm install
npm run compile     # compila a out/
npm run watch       # compilación en continuo
npm test            # 183 pruebas (node:test)
npm run package     # genera rsharp.vsix
```

En VSCode, abre la **raíz del repositorio** y pulsa `F5` para lanzar la
extensión en modo desarrollo.

## Módulos

| Módulo | Responsabilidad |
|---|---|
| `src/extension.ts` | Activación: cablea comandos, barra de estado, vista, diagnósticos y sesión |
| `src/commands.ts` | Los 8 comandos de la spec §14.2 |
| `src/config.ts` | `rsharp.toml` + ajustes de VSCode (prioridad de la spec §9/§14.4) |
| `src/toml.ts` | Parser TOML propio, sin dependencias |
| `src/toolchain.ts` | Descubrimiento de `dotnet`, `cargo` y `rsharp` |
| `src/cli.ts` | Cliente de la CLI con salida JSON, timeout y modo degradado |
| `src/diagnostics.ts` | Diagnósticos de R# → diagnósticos de VSCode |
| `src/rustc-parser.ts` | Salida de `rustc`/`cargo` → diagnósticos de Rust |
| `src/sourcemap.ts` | Línea de Rust ↔ línea de `.rsh` |
| `src/errors.ts` | Formato de error al estilo TypeScript |
| `src/panic.ts` | Pánicos de Rust en tiempo de ejecución |
| `src/publish.ts` | Publicación de diagnósticos en el editor |
| `src/terminal.ts` | Seudoterminal para ejecutar el programa |
| `src/debug.ts` | CodeLLDB y traducción de puntos de parada |
| `src/session.ts` | Estado de la sesión (source maps, artefacto) |
| `src/statusbar.ts` | Barra de estado con menú de acciones |
| `src/treeview.ts` | Vista lateral "R# Project" |
| `src/types.ts` | Contratos compartidos (fuente de verdad) |

## Probando sin el compilador

```bash
node tools/mock-rsharp.mjs transpile --project . --output /tmp/out --json
```

Y en VSCode: `"rsharp.cliPath": "/ruta/al/repo/extension/tools/mock-rsharp.mjs"`.
