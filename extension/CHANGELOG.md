# Changelog

Todas las novedades de la extensión R# (Rust#).

## [0.1.0] — 2026-11-13

### Añadido

- Extensión de VSCode como cliente delgado del compilador R# (spec §14.1).
- Gramática TextMate autocontenida para `.rsh`, con las construcciones propias
  de R# (`#codeGenAI`, atributos `[Export]`, `[Extern]`, `[WasmExport]`, ...).
- Comandos de la spec §14.2: `R#: Transpile`, `R#: Build`, `R#: Build Release`,
  `R#: Build WASM`, `R#: Run`, `R#: Clean`, `R#: Choose Output Folder` y
  `R#: Choose Dist Folder`.
- Lectura de `rsharp.toml` con un parser TOML propio (sin dependencias) y
  prioridad de la spec §9/§14.4 sobre los ajustes de VSCode.
- Barra de estado con menú de acciones y vista lateral "R# Project".
- Traducción de los errores de `rustc` a la línea del `.rsh` mediante source maps,
  con el formato de TypeScript (`R# error [E0308]: ...`).
- Traducción de los pánicos en tiempo de ejecución a la línea del `.rsh`.
- Ejecución del programa en un seudoterminal: el Rust generado no se muestra.
- Integración con CodeLLDB: plantilla de `launch.json` y traducción de los puntos
  de parada de `.rsh` a Rust.
- CLI de simulación (`extension/tools/mock-rsharp.mjs`) para probar la extensión
  sin el compilador R#.
- 183 pruebas automáticas.
