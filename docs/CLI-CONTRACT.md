# Contrato de la CLI `rsharp` (compilador R# / Rust#)

> **Documento de requisitos para el equipo del compilador (`RSharp.Cli`).**
> Especifica exactamente qué espera la extensión de VSCode (`extension/src/`)
> de la CLI `rsharp`. Todo lo que aquí aparece como «obligatorio» está
> verificado contra el código real de la extensión, no contra suposiciones.
>
> - Extensión: [`ARCHITECTURE.md`](./ARCHITECTURE.md)
> - Especificación del lenguaje: [`../rsharp-spec.md`](../rsharp-spec.md)
> - Referencia ejecutable del contrato: `extension/tools/mock-rsharp.mjs`

---

## 1. Resumen

1. La extensión **no compila R#**: invoca la CLI `rsharp` como proceso externo
   y traduce su salida. (spec §14.1, §14.4)
2. La CLI **corre en .NET** (`RSharp.Cli`, `net8.0`, spec §4.2). **No corre en
   WASM**: WASM es un *destino* del Rust generado (spec §4.4, que reemplaza
   explícitamente las decisiones anteriores sobre Blazor, Web Worker y
   `RSharp.Wasm`).
3. Todas las órdenes de proyecto se lanzan **con `--json`** y deben imprimir
   **un único objeto JSON** con la forma `RSharpCliEnvelope` (`types.ts`).
4. La salida de la CLI es la **única** fuente de diagnósticos del compilador:
   la extensión no verifica tipos (spec §4.1).
5. La CLI es también la que produce los **source maps**, que son lo que permite
   que un error de `rustc` aparezca en la línea del `.rsh` y no en la del
   `.rs` generado (spec §14.4, §17).

> **Advertencia importante sobre el estado del contrato.** La spec §19 deja
> «el formato del source map» como **decisión abierta**. El formato descrito
> aquí es el que la extensión implementa hoy (`src/types.ts`,
> `src/sourcemap.ts`); si el compilador necesita otro formato, hay que
> cambiar **las dos partes a la vez** (extensión y compilador), porque el
> formato del source map está *hardcodeado* en el cliente.

---

## 2. Tabla de comandos

### 2.1 Cómo se invoca

| Forma | Cuándo |
|---|---|
| `<rsharp> <comando> [opciones] [--json]` | `rsharp.cliPath` apunta a un ejecutable (o está en el `PATH`). |
| `dotnet <rsharp.dll> <comando> [opciones] [--json]` | `rsharp.cliPath` termina en `.dll` (detección por sufijo, sin distinguir mayúsculas: `toolchain.ts::isDllPath`). |

* El directorio de trabajo del proceso es **la raíz del proyecto** (`cwd`).
* El entorno es el del proceso de VSCode, heredado sin modificar (`env: process.env`).
* La extensión **no** usa `shell`: los argumentos se pasan tal cual, sin comillas.
* La extensión espera como máximo **10 minutos** por proceso (`cli.ts`,
  `DEFAULT_TIMEOUT_MS = 600000`). Si se supera, mata el proceso con `SIGKILL`.

### 2.2 Comandos

| Comando | Línea de órdenes exacta que envía la extensión | Opcionales que puede enviar | Qué debe hacer la CLI |
|---|---|---|---|
| `transpile` | `transpile --project <dir> [--output <dir>] --json` | `--output <dir>` (la envía siempre que la extensión tenga `outputDir` resuelto) | Transpila los `.rsh` del proyecto a Rust en `<dir>` (o en `target/rsharp/` si no se indica). Devuelve `files`, `diagnostics`, `sourceMaps` y `summary`. |
| `build` | `build --project <dir> [--profile <p>] [--target <t>] [--dist <dir>] --json` | `--profile debug\|release`, `--target native\|wasm32-unknown-unknown\|wasm32-wasip1`, `--dist <dir>` | Transpila y compila. Ejecuta `cargo build --target-dir <distDir>` (spec §14.4) y devuelve `cargo` (comando, código, stdout, stderr), `artifact`, `diagnostics` y `sourceMaps`. |
| `run` | `run --project <dir> [--target <t>] [--profile <p>] --json` | `--target <t>`, `--profile <p>` | Compila y ejecuta el programa. La extensión **no** le pasa `--dist` en este comando: debe deducirlo de `rsharp.toml` (`[paths].dist`) o usar el valor por defecto `dist/`. Devuelve `artifact` y `summary`. |
| `clean` | `clean --project <dir> [--output <dir>] [--dist <dir>] --json` | `--output <dir>`, `--dist <dir>` | Borra las carpetas de salida y de distribución. La extensión los borra también por su cuenta si la CLI falla. |
| `--version` | `--version` (**sin** `--json`) | — | Imprime la versión. La extensión extrae el primer número tipo `1.2.3` de la salida (regex `(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.]+)?)`), buscando primero en stdout y luego en stderr. Ejemplo válido: `rsharp 0.1.0`. |

### 2.3 Reglas de la línea de órdenes

* Las **opciones son opcionales**: la CLI debe aceptarlas ausentes y usar los
  valores de `rsharp.toml` o los de la spec §3
  (`target/rsharp/` para salida, `dist/` para distribución).
* La CLI debe aceptar también la forma `--opcion=valor` (el mock la acepta;
  la extensión nunca la usa).
* La CLI debe rechazar con un error controlado cualquier opción o comando
  desconocido (el mock usa `kind: "unsupported"`).
* `rsharp --version` debe devolver código de salida `0`.
* La CLI **debe** admitir `--json` en los cuatro comandos de proyecto. La
  extensión lo añade siempre automáticamente (`cli.ts::run`).

---

## 3. Formato de salida JSON: el sobre `RSharpCliEnvelope`

### 3.1 Definición real (copia de `extension/src/types.ts`)

```typescript
/** Envoltorio estándar de salida JSON de la CLI. */
export interface RSharpCliEnvelope {
  ok: boolean;
  command: string;
  /** Duración en milisegundos. */
  durationMs?: number;
  files?: RSharpGeneratedFile[];
  diagnostics?: RSharpDiagnostic[];
  sourceMaps?: RSharpSourceMap[];
  /** Mensaje corto para la barra de estado. */
  summary?: string;
  /** Binario final producido (build). */
  artifact?: string;
  /** Comando `cargo` ejecutado, para mostrarlo en el panel de salida. */
  cargo?: {
    command: string;
    exitCode: number;
    stdout?: string;
    stderr?: string;
  };
  error?: {
    message: string;
    kind:
      | 'not-found'
      | 'spawn-failed'
      | 'bad-json'
      | 'unsupported'
      | 'non-zero'
      | 'unknown';
  };
}
```

### 3.2 Campo por campo

| Campo | Tipo | Obligatorio | Significado | Cómo lo usa la extensión |
|---|---|:--:|---|---|
| `ok` | `boolean` | **Sí** | El comando tuvo éxito. | **Es la única comprobación de forma**: si el JSON no tiene `ok` booleano, la extensión lo rechaza como `bad-json` (`cli.ts::isEnvelope`). |
| `command` | `string` | **Sí** | Nombre del comando: `transpile`, `build`, `run` o `clean`. | Informativo. |
| `durationMs` | `number` | No | Duración en milisegundos. | Se muestra en el panel: *«Duración: N ms»*. |
| `files` | `RSharpGeneratedFile[]` | No | Archivos generados. Cada uno: `path` (relativo a la carpeta de salida), `language` (`'rust' \| 'toml' \| 'other'`), `lines` (nº de líneas, opcional). | Se listan en el panel: *«main.rs (rust)»*. |
| `diagnostics` | `RSharpDiagnostic[]` | No | Diagnósticos del compilador de R#. Ver §4. | Se imprimen en el panel `R#` con su código (`R#0042`, `R#0101`, `R#0150`) y su ubicación. |
| `sourceMaps` | `RSharpSourceMap[]` | No | Mapas línea-Rust → línea-R#. Ver §5. | Necesarios para traducir los errores de `rustc` a líneas de R#. |
| `summary` | `string` | No | Mensaje corto (una línea) para el usuario. | Se muestra en el panel y, si `ok` es `false` y no hay `error`, se usa como mensaje de fallo. |
| `artifact` | `string` | No | Ruta del binario producido. | En `build`/`run`, `commands.ts::findBinary` la prueba **primero**: si es absoluta se usa tal cual; si es relativa se resuelve contra la raíz del proyecto y contra `distDir`. Si no existe, se buscan `<project.name>` en `distDir`, `distDir/<perfil>` y `distDir/<perfil>/<destino>`. |
| `cargo` | `{command, exitCode, stdout?, stderr?}` | No | Datos de la invocación de `cargo`. | Se imprimen en el panel: la línea de órdenes, el código y la salida completa. `stdout`/`stderr` son además la entrada de `rustc-parser.ts`. |
| `error` | `{message, kind}` | No | Descripción del fallo, con el `kind` de la lista cerrada. | `kind` se copia directamente a `CliResult.failure.kind` y decide el mensaje que ve el usuario. |

### 3.3 Ejemplo completo y válido (`build` con un error de `rustc`)

Este ejemplo es la salida **real** del mock `extension/tools/mock-rsharp.mjs`
sobre un proyecto con un `.rsh` (el proyecto de ejemplo genera
`main.rs` con un `E0308` deliberado):

```json
{
  "ok": false,
  "command": "build",
  "durationMs": 67,
  "files": [
    {
      "path": "Cargo.toml",
      "language": "toml",
      "lines": 11
    },
    {
      "path": "main.rs",
      "language": "rust",
      "lines": 4
    }
  ],
  "diagnostics": [
    {
      "severity": "error",
      "message": "mismatched types",
      "source": "rustc",
      "code": "E0308",
      "file": "main.rs",
      "line": 2,
      "column": 18
    },
    {
      "severity": "error",
      "message": "could not compile `mockproj` (bin \"mockproj\") due to 1 previous error",
      "source": "rustc"
    }
  ],
  "sourceMaps": [
    {
      "rustFile": "main.rs",
      "rshFile": "main.rsh",
      "entries": [
        { "rustLine": 1, "rshLine": 1 },
        { "rustLine": 2, "rshLine": 2 },
        { "rustLine": 3, "rshLine": 3 },
        { "rustLine": 4, "rshLine": 4 }
      ]
    }
  ],
  "summary": "La compilación falló (101) con 2 diagnóstico(s).",
  "cargo": {
    "command": "cargo build --target-dir /tmp/opencode/mockproj/dist",
    "exitCode": 101,
    "stdout": "",
    "stderr": "   Compiling mockproj v0.1.0 (/tmp/opencode/mockproj/target/rsharp)\nerror[E0308]: mismatched types\n --> main.rs:2:18\n  |\n2 |     let x: i32 = \"hola\";\n  |            ---   ^^^^^^ expected `i32`, found `&str`\n  |            |\n  |            expected due to this\n\nFor more information about this error, try `rustc --explain E0308`.\nerror: could not compile `mockproj` (bin \"mockproj\") due to 1 previous error\n"
  },
  "error": {
    "message": "cargo build terminó con código 101.",
    "kind": "non-zero"
  }
}
```

### 3.4 Ejemplo de éxito (`transpile` sin errores)

```json
{
  "ok": true,
  "command": "transpile",
  "durationMs": 12,
  "files": [
    {
      "path": "main.rs",
      "language": "rust",
      "lines": 13
    }
  ],
  "diagnostics": [],
  "sourceMaps": [
    {
      "rustFile": "main.rs",
      "rshFile": "main.rsh",
      "entries": [
        { "rustLine": 1, "rshLine": 1 },
        { "rustLine": 2, "rshLine": 2 },
        { "rustLine": 3, "rshLine": 3 }
      ]
    }
  ],
  "summary": "Transpilado: 1 archivo(s), 3 línea(s) mapeadas."
}
```

### 3.5 Reglas del sobre

1. **Un único objeto JSON** en stdout. Nada más: ni banners, ni texto de
   progreso, ni `Console.WriteLine` intercalados.
2. Los logs van a **stderr** (la extensión los muestra en el panel de salida
   y los usa como detalle del error).
3. `ok: false` **debe** ir acompañado de `error` con un `kind` de la lista
   cerrada. `ok: true` y `error` son incompatibles.
4. Los diagnósticos van **siempre** en `diagnostics`, tanto si `ok` es `true`
   como si es `false`: una compilación puede terminar bien con avisos.
5. `command` debe reflejar el comando ejecutado, no el último ejecutado con
   éxito.
6. El JSON puede ir **sin colorear ni tabulaciones**: la extensión lo parsea
   con `JSON.parse`.

---

## 4. Formato de los diagnósticos (`RSharpDiagnostic`)

### 4.1 Definición real (`extension/src/types.ts`)

```typescript
export interface RSharpDiagnostic {
  /** Código de diagnóstico de R#, p.ej. `R#0042`. */
  code: string;
  severity: DiagnosticSeverity;   // 'error' | 'warning' | 'info' | 'hint'
  message: string;
  /** Ruta del archivo R# (relativa al proyecto si es posible). */
  file?: string;
  /** Línea 1-based dentro del archivo R#. */
  line?: number;
  /** Columna 1-based dentro del archivo R#. */
  column?: number;
  /** Longitud del rango en caracteres (opcional). */
  length?: number;
  /** Texto de ayuda: qué hacer para resolverlo. */
  help?: string;
  /** Fuente del diagnóstico. */
  source?: string;
}
```

| Campo | Obligatorio | Notas para el implementador |
|---|:--:|---|
| `code` | **Sí** | Texto exacto del código, con `#`: `R#0042`, `R#0101`, `R#0150`. Para diagnósticos de `rustc`, el código de rustc (`E0308`). |
| `severity` | **Sí** | Uno de `error`, `warning`, `info`, `hint`. |
| `message` | **Sí** | Texto legible, sin el código (la extensión lo antepone al imprimir). |
| `file` | No | **Ruta del archivo `.rsh`**, relativa a la raíz del proyecto si es posible. Si se omite, el diagnóstico se agrupa bajo la clave `''` (sin archivo). |
| `line` | No | **1-based**. Si se omite, la extensión resalta la primera línea. |
| `column` | No | **1-based**. Si se omite, la extensión resalta el primer carácter. |
| `length` | No | Longitud del rango en caracteres. Si se omite y el archivo se puede leer, la extensión resalta hasta el final de la línea; si no, 1 carácter. |
| `help` | No | Qué hacer para resolverlo (spec §17: *«Cada diagnóstico indica la directiva o ajuste necesario»*). Se imprime como línea `  Ayuda: …`. |
| `source` | No | Fuente del diagnóstico. La extensión **ignora** este valor y siempre publica `source = "R#"`. |

> **Regla de la spec §17:** *«Cada diagnóstico apunta a la línea de R#, no a la
> de Rust.»* → `file` debe ser siempre el `.rsh` **origen**, no el `.rs`
> generado. Para un diagnóstico que venga de `rustc`, el `file` debe ser el `.rsh`
> equivalente (traducido con el source map) o bien omitir `file` y dejar que
> la extensión traduzca el error de `rustc` (ver §5.3).

### 4.2 Los tres códigos de la spec §17

| Código | Significado (spec §17) | Cuándo se emite |
|---|---|---|
| `R#0042` | El código exige un sugar apagado. | Cuando el programa usa una construcción que solo es posible con una concesión explícita (sugar apagado por defecto, spec §8.2). |
| `R#0101` | API no soportada en el destino. | Cuando se usa una API de la BCL que no existe en el destino elegido (spec §10: *«R#0101: `File.ReadAllText` no existe en `wasm32-unknown-unknown`»*). |
| `R#0150` | Destino sin soporte de librerías dinámicas. | Cuando el destino no puede enlazar librerías dinámicas (spec §11: *«Las DLL dinámicas no cargan en `wasm32-unknown-unknown`»* y *«`[PythonModule]` se rechaza en la v1 (`R#0150`)»*). |

### 4.3 Un ejemplo por cada código

**`R#0042` — el código exige un sugar apagado**

```json
{
  "code": "R#0042",
  "severity": "error",
  "message": "El código requiere un «sugar» que está apagado en el perfil activo.",
  "file": "main.rsh",
  "line": 10,
  "column": 31,
  "length": 5,
  "help": "Activa el sugar en `rsharp.toml` ([sugar]) o compila con `rsharp build --profile release`.",
  "source": "R#"
}
```

**`R#0101` — API no soportada en el destino** (ejemplo para `wasm32-unknown-unknown`, cf. spec §10)

```json
{
  "code": "R#0101",
  "severity": "error",
  "message": "File.ReadAllText no existe en wasm32-unknown-unknown.",
  "file": "src/lector.rsh",
  "line": 12,
  "column": 5,
  "length": 18,
  "help": "En el destino wasm32-unknown-unknown no hay sistema de archivos. Usa un recurso embebido o compila con [build].target = \"native\".",
  "source": "R#"
}
```

**`R#0150` — destino sin soporte de librerías dinámicas** (ejemplo para `[PythonModule]`, cf. spec §11 y §13)

```json
{
  "code": "R#0150",
  "severity": "error",
  "message": "El destino wasm32-unknown-unknown no admite librerías dinámicas: [PythonModule] está rechazado en la v1.",
  "file": "src/calculo.rsh",
  "line": 8,
  "column": 1,
  "length": 16,
  "help": "Elimina el atributo [PythonModule] o usa [build].target = \"native\". El soporte de Python está planificado para una versión posterior.",
  "source": "R#"
}
```

Los tres ejemplos son **formatos de referencia** escritos a mano: el mock
actual solo emite `R#0042` (cuando el `.rsh` menciona «sugar») y diagnósticos
de `rustc`. `R#0101` y `R#0150` deben emitirlos la CLI real.

---

## 5. Formato de los source maps (`RSharpSourceMap`)

### 5.1 Definición real (`extension/src/types.ts`)

```typescript
export interface RSharpSourceMapEntry {
  /** Línea 1-based en el archivo Rust generado. */
  rustLine: number;
  /** Línea 1-based en el archivo R# origen. */
  rshLine: number;
}

export interface RSharpSourceMap {
  /** Ruta del archivo Rust generado, relativa al directorio de salida. */
  rustFile: string;
  /** Ruta del archivo R# origen, relativa al proyecto. */
  rshFile: string;
  entries: RSharpSourceMapEntry[];
}
```

| Campo | Obligatorio | Notas |
|---|:--:|---|
| `rustFile` | **Sí** | Ruta del `.rs` generado. **Relativa al directorio de salida** (`outputDir`), con `/` como separador. |
| `rshFile` | **Sí** | Ruta del `.rsh` origen. **Relativa a la raíz del proyecto**. |
| `entries` | **Sí** | Pares `rustLine → rshLine`. Las líneas son **1-based** en ambos lados. |

### 5.2 Ejemplo

```json
{
  "rustFile": "main.rs",
  "rshFile": "main.rsh",
  "entries": [
    { "rustLine": 1, "rshLine": 1 },
    { "rustLine": 2, "rshLine": 2 },
    { "rustLine": 3, "rshLine": 3 },
    { "rustLine": 4, "rshLine": 4 },
    { "rustLine": 5, "rshLine": 9 }
  ]
}
```

### 5.3 Regla de resolución (la implementa `extension/src/sourcemap.ts`)

1. **Buscar el mapa.** Se compara `rustFile` con el `rustFile` de cada mapa:
   * Primero coincidencia **exacta** tras normalizar la ruta (se cambian `\`
     por `/`, se eliminan barras duplicadas, el prefijo `./` y la barra final).
   * Si no hay coincidencia exacta, se acepta que **una ruta sea el final de
     la otra** (p. ej. `gen/main.rs` frente a
     `/abs/proyecto/target/rsharp/gen/main.rs`).
   * Si ningún mapa coincide → no hay traducción posible: el error se muestra
     tal cual (en el `.rs`).
2. **Elegir la entrada.** Se toma la **entrada anterior más cercana**: la
   última cuyo `rustLine <= línea` del error. A igualdad de distancia **gana la
   última entrada** encontrada.
3. **Si no hay ninguna entrada anterior** (por ejemplo, el error está en la
   línea 1 y la primera entrada empieza en la 5), se usa **la primera entrada
   del mapa**.
4. **Si el mapa no tiene entradas**, no hay traducción (`undefined`).
5. **Varias entradas para la misma línea Rust**: `buildLineMap` deja ganar a
   **la última** del array.

> **Consecuencia para el compilador.** Basta con emitir entradas para las
> líneas del Rust que **proceden** de una línea del `.rsh` (las líneas
> generadas sin correspondencia —`fn main`, `use`, cierre de llaves— se pueden
> omitir). Cuanto más densas sean las entradas, más precisa será la
> traducción; el algoritmo de «entrada anterior más cercana» tolera huecos.

### 5.4 Diagnósticos de `rustc` dentro del sobre

La extensión tiene dos caminos para los errores de Rust:

* **Camino A (el que ya funciona):** la CLI los analiza y los devuelve ya
  traducidos dentro de `diagnostics`, con `file` = `.rsh` y `line` = línea de
  R#. Es el que usa hoy `commands.ts`.
* **Camino B (el que está en construcción):** la CLI devuelve `cargo.stdout` /
  `cargo.stderr` con el texto crudo de `rustc` y los `sourceMaps`; la
  extensión lo parsea con `rustc-parser.ts` y lo traduce con `sourcemap.ts`.
  **Pendiente**: el cableado en `commands.ts` y la publicación en el
  `DiagnosticCollection` todavía no existen.

Para no depender de (B), la opción recomendada es **(A)**: que la CLI analice
la salida de `cargo` y emita un `RSharpDiagnostic` por error, con el `file` y
la `line` ya traducidos al `.rsh`. El código del diagnóstico puede ser el de
`rustc` (`E0308`) o un código de R#; en ambos casos la extensión lo muestra
literalmente.

---

## 6. Códigos de salida del proceso

### 6.1 Qué hace la extensión con cada código

| Código de salida | Interpretación en la extensión | `CliResult.failure.kind` |
|---:|---|---|
| `0` | Éxito. Se parsea el sobre. Si no hay JSON válido → `bad-json`. Si `ok` es `false` → `unknown` (mensaje = `summary`). | — (o `bad-json` / `unknown`) |
| `!= 0` (cualquier otro) | Fallo. **La comprobación del JSON no se llega a hacer**: el mensaje se construye con `envelope.error.message`, o con `stderr`, o con `stdout` (en ese orden). El texto íntegro se conserva en `raw`/`stderr` y se vuelca en el panel. | `non-zero` |
| `127` | **Código sintético de la extensión**, no del proceso: significa *«el proceso ni siquiera arrancó»* (CLI ausente, `dotnet` ausente con CLI en DLL, o `ENOENT` al lanzar). Si la CLI devuelve `127` por su cuenta, la extensión lo trata como un `non-zero` normal. | `not-found` (si no arrancó) / `non-zero` (si lo devolvió la CLI) |
| `-1` | **Código sintético de la extensión**: el proceso se cerró sin código (por ejemplo, lo mató el timeout de 10 min). | `non-zero` (mensaje: *«La CLI de R# superó el tiempo de espera de … y fue terminada.»*) |

### 6.2 Resumen de la precedencia de los fallos

`cli.ts::buildResult` evalúa **en este orden**:

1. `timedOut` → `non-zero` (mensaje de tiempo de espera).
2. `exitCode !== 0` → `non-zero` (mensaje con el código y el detalle).
3. `--json` pedido pero **no** hay sobre → `bad-json`.
4. El sobre trae `error` → se copia su `kind` y su `message` tal cual.
5. El sobre trae `ok: false` sin `error` → `unknown` (mensaje = `summary`).

> **Consecuencia práctica:** una CLI que falla **debe** salir con código `!= 0`
> **y** printing un sobre con `error`. Si sale con `0` y `ok: false`, la
> extensión lo mostrará como fallo genérico (`unknown`) con el `summary`.
> Si sale con `!= 0` y sin JSON, el usuario verá el texto de `stderr` tal cual.

### 6.3 Códigos de salida recomendados para la CLI

| Situación | Código | `error.kind` |
|---|---:|---|
| Todo correcto | `0` | — |
| Error del programa (diagnósticos con `severity: "error"`) | `1` | `non-zero` |
| Opción o comando desconocido | `1` | `unsupported` |
| `rsharp.toml` inválido o proyecto inexistente | `1` | `unsupported` |
| Falta una dependencia externa (`cargo` no instalado) | `1` | `not-found` |
| Error interno del compilador | `1` | `unknown` |

El mock usa exactamente esta convención (`0` si `envelope.ok`, `1` si no), y el
valor `127` lo reserva para el error de `cargo` que se mete **dentro** de
`cargo.exitCode`, nunca como código del proceso.

---

## 7. Modo degradado

La extensión está diseñada para **no romperse nunca** por culpa de la CLI.
Estos son los escenarios y lo que hace exactamente.

### 7.1 La CLI no devuelve JSON

* Si el **código de salida es `0`** y el `--json` estaba pedido → fallo
  `bad-json` con el mensaje *«La salida de la CLI de R# no es JSON válido: …»*.
  El texto original se conserva en `CliResult.raw` y `commands.ts::reportFailure`
  lo vuelca entero en el panel de salida.
* Si el **código de salida es `!= 0`** → el caso anterior **no se evalúa**: el
  fallo es `non-zero` y el detalle se toma de `stderr`/`stdout`.
* Si el JSON es válido pero **no tiene `ok` booleano** → `bad-json` con el
  mensaje *«el JSON no tiene la forma de un sobre RSharpCliEnvelope (falta "ok")»*.

**Requisito para la CLI:** con `--json`, la salida **debe** ser un único objeto
JSON válido con `ok` booleano. Como la extensión **siempre** pide `--json`, no
existe un modo «sin JSON» desde su punto de vista: si la CLI no puede cumplir
el contrato, lo correcto es **salir con código `!= 0`** (el usuario verá el
texto de `stderr` tal cual) o imprimir un sobre con `ok: false` y `error`.

### 7.2 La CLI no existe

| Situación | Qué hace la extensión |
|---|---|
| `rsharp.cliPath` no configurado y no hay `rsharp` en el `PATH` ni en `~/.dotnet/tools`, `./.rsharp/bin` o junto a la extensión | `cli.ts::preflight` **no lanza el proceso**: devuelve `not-found`, `exitCode` `127`, mensaje *«Falta la CLI de R# (rsharp). Instala RSharp.Cli o configura `rsharp.cliPath`.»* |
| `rsharp.cliPath` configurado pero la ruta no existe | El `preflight` no lo detecta (las rutas configuradas se usan tal cual, sin comprobarlas). El `spawn` falla con `ENOENT` → `not-found`, mensaje *«No se encontró «<ruta>». Revisa `rsharp.cliPath` o instala RSharp.Cli.»* |
| La ruta existe pero no es ejecutable | El `spawn` falla con `EACCES` → `spawn-failed`, mensaje *«No se pudo ejecutar «<ruta>»: …»*. |

### 7.3 El binario es una DLL

* `toolchain.ts` detecta el sufijo `.dll` y `buildRSharpCommand` construye
  `dotnet <rsharp.dll> <args>` (usa `rsharp.dotnetPath` si está configurado; si
  no, el nombre genérico `dotnet`).
* Si `dotnet` **no** está disponible → `preflight` devuelve `not-found` con el
  mensaje *«Falta .NET SDK (dotnet), necesario para ejecutar la CLI de R#.»*
  y **no** lanza el proceso.
* Por tanto, la DLL debe ser un ensamblado de .NET ejecutable con
  `dotnet <rsharp.dll> …`, es decir `RSharp.Cli` publicado como
  *framework-dependent* (`net8.0`, spec §4.2) **con** punto de entrada.

### 7.4 La salida incluye líneas de log antes del JSON

**Esto está tolerado.** `cli.ts::parseEnvelope` intenta primero parsear la
salida completa; si falla, **reintenta** con el trozo que va del primer `{`
al último `}`:

```text
aviso: compilando
{"ok": true, "command": "transpile", "durationMs": 12}
```

Funciona, pero es frágil: si las líneas de log contienen `{` o `}`, el trozo
extraído puede no ser el sobre. **Recomendación:** el sobre JSON va **solo**
en stdout y los logs van a **stderr**. Así el contrato se cumple sin depender
de la tolerancia.

### 7.5 Otros casos

| Caso | Comportamiento |
|---|---|
| La CLI tarda más de 10 min | Se mata con `SIGKILL`; fallo `non-zero` con mensaje de tiempo de espera; `exitCode` `-1`. |
| `cargo` no está instalado | La CLI debe devolverlo como `error.kind = "not-found"` y, si puede, en `cargo.exitCode = 127`. La extensión ya omite la fase de compilación cuando no encuentra `cargo` (`commands.ts::commandBuild` con `toolchain.ts`). |
| La CLI escribe en `stderr` sin motivo | No rompe nada: `stderr` se muestra en el panel y se usa como detalle del fallo. |

---

## 8. Requisitos por destino: WASM (§11) y FFI (§13)

### 8.1 Destino WASM (spec §11)

La extensión pide el destino así:

* `R#: Build WASM` → `--target wasm32-unknown-unknown` por defecto, o el
  destino guardado en `rsharp.runTarget` (`wasm32-wasip1`).
* `rsharp.runTarget` **no** es un ajuste de `rsharp.toml`: se guarda en el
  estado de VSCode y solo afecta a `Build WASM` y a `Run`.

**Lo que la CLI debe hacer** (todo del lado del compilador; la extensión solo
pasa `--target`):

| Requisito (spec §11) | Cómo debe reflejarse en el sobre |
|---|---|
| Generar `#[wasm_bindgen]` para `[WasmExport]` | Aparece en `files` (con `language: "rust"`) y en `sourceMaps` para que sus errores apunten al `.rsh`. |
| `string` cruza el límite como `String`; `class` exportada usa una estructura envoltorio | Afecta al Rust generado, no al sobre. |
| `async` con `wasm-bindgen-futures` | Idem. |
| Hilos: evitarlos en la v1 | Rechazo del código que use hilos → `R#0101` con `file`/`line` del `.rsh`. |
| `panic` con `console_error_panic_hook` | Idem. |
| **Las DLL dinámicas no cargan en `wasm32-unknown-unknown`** | `R#0150` (ver §4.3) con la línea del `.rsh` que usa la DLL. |
| **`[PythonModule]` se rechaza en la v1** | `R#0150` con la línea del atributo. |
| APIs de la BCL no soportadas en el destino (spec §10) | `R#0101` (ej. `File.ReadAllText`). |
| El artefacto final es un `.wasm` | `artifact` con la ruta del `.wasm`. **Aviso importante**: la vista de la extensión busca el `.wasm` por su **nombre**, no por `artifact` (§8.2). |

### 8.2 Requisito práctico del artefacto WASM

A diferencia del binario nativo, el `.wasm` **no** se busca por
`envelope.artifact`: `commands.ts::findWasmArtifact` busca, en este orden:

1. `<distDir>/<[project].name>.wasm`
2. `<distDir>/<perfil>/<[project].name>.wasm`

donde `<[project].name>` es `rsharp.toml → [project].name` (y, si no hay
toml, el nombre de la carpeta del proyecto). **Para que «R#: Run» pueda
informar de dónde está el módulo, el `.wasm` debe llamarse
`<[project].name>.wasm`** y estar en `distDir` o en `distDir/<perfil>`.

Para el **binario nativo** sí vale `envelope.artifact` (ruta absoluta, o
relativa a la raíz del proyecto o a `distDir`).

### 8.3 FFI / librerías externas (spec §13)

| Requisito (spec §13) | Reflejo en el sobre |
|---|---|
| Orden de soporte: C → Python → host .NET | La CLI decide y **rechaza** lo que aún no soporta: cada rechazo es un `RSharpDiagnostic` con código de la spec §17 (`R#0150` para lo que no puede enlazar en el destino, `R#0101` para APIs no soportadas, `R#0042` para lo que exigiría un sugar). |
| `extern "C"` + `libloading` para DLL nativas | El Rust generado aparece en `files` (`language: "rust"`) y **debe estar cubierto por `sourceMaps`**: los errores del código FFI generado deben traducirse a la línea del `.rsh` que lo pidió. |
| `bindgen` para C con cabecera (`rsharp bind --c lib.h`) | El comando `rsharp bind` **no lo invoca la extensión hoy** (pendiente). Cuando exista, debería usar el mismo sobre. |
| Copiar los `string` al cruzar y liberar con `Drop` | Detalle del Rust generado. |
| Marcar punteros devueltos con `[Owned]`/`[Borrowed]` | Errores de contrato → diagnósticos con línea del `.rsh`. |
| Exigir `unsafe` en llamadas nativas | Rechazo del código que use FFI sin `unsafe` explícito → `R#0101` o `R#0042` según el caso. |
| Guardar el hash de cada librería en `rsharp.lock` | **El sobre no tiene ningún campo para esto** (no existe en `RSharpCliEnvelope`). Se resuelve con el archivo `rsharp.lock` (spec §3, §13). |
| Una DLL nativa exige un binario por plataforma | Mensaje de error con la plataforma en `error.message` / en el `help` del diagnóstico. |

### 8.4 Lo que el sobre **no** tiene (pendiente)

No inventar campos: si la CLI necesita transmitir más información, hay que
**añadir el campo a `extension/src/types.ts` y a esta tabla** (y al mock).
Actualmente **no** existe ningún campo para:

* el contenido o el hash de `rsharp.lock`;
* los *bindings* generados (`bindings/`) más allá de la lista `files`;
* los valores de *sugar* efectivos que se aplicaron;
* el progreso o las etapas intermedias;
* la versión del formato del sobre (no hay campo `schema`).

---

## 9. Cómo probar la extensión sin compilar R#

El repositorio incluye una **CLI simulada** que implementa este mismo
contrato: `extension/tools/mock-rsharp.mjs` (Node puro, sin dependencias).

### 9.1 Configurar la extensión

El ajuste es `rsharp.cliPath` (ajuste de máquina, con valor por defecto
`null`). Apunta directamente al fichero del mock:

```json
{
  "rsharp.cliPath": "/home/gabriel/Proyectos/GabrielCatDev/Rust#ExtVsCode/extension/tools/mock-rsharp.mjs"
}
```

* El mock **ya es ejecutable** (`-rwxrwxr-x`) y lleva el *shebang*
  `#!/usr/bin/env node`, así que se puede lanzar directamente: `node` debe
  estar en el `PATH`.
* En Windows, o si `node` no está en el `PATH`, hay que crear un envoltorio
  (`.cmd` o un `.sh`) y apuntar `rsharp.cliPath` a él.
* Ojo: la ruta de este repositorio contiene un `#`. En `settings.json` (JSON)
  no hay problema; en una **terminal** hay que entrecomillarla siempre.

### 9.2 Probar la CLI a mano (sin VSCode)

```bash
# versión
node "/home/gabriel/Proyectos/GabrielCatDev/Rust#ExtVsCode/extension/tools/mock-rsharp.mjs" --version

# transpilación con JSON
node "/home/gabriel/Proyectos/GabrielCatDev/Rust#ExtVsCode/extension/tools/mock-rsharp.mjs" \
  transpile --project /tmp/demo --output /tmp/demo/target/rsharp --json

# compilación (el mock ejecuta `cargo build` de verdad, con un error E0308 deliberado)
node "/home/gabriel/Proyectos/GabrielCatDev/Rust#ExtVsCode/extension/tools/mock-rsharp.mjs" \
  build --project /tmp/demo --profile debug --target native --dist /tmp/demo/dist --json

# sin --json: salida legible en español
node "/home/gabriel/Proyectos/GabrielCatDev/Rust#ExtVsCode/extension/tools/mock-rsharp.mjs" \
  transpile --project /tmp/demo
```

### 9.3 Qué hace el mock (para saber qué esperar)

| Comando | Comportamiento del mock |
|---|---|
| `transpile` | Busca el **primer** `.rsh` del proyecto (orden alfabético). Genera `main.rs` con una correspondencia **1:1** de líneas, para poder probar el mapeo. Si no hay ningún `.rsh`, usa un ejemplo embebido (virtual, no se escribe en disco). Emite `R#0042` si el `.rsh` menciona «sugar». |
| `build` | Escribe `Cargo.toml` y un `main.rs` con un error **deliberado** (`let x: i32 = "hola";`) y ejecuta `cargo build --target-dir <distDir>` **de verdad**. Así se puede probar la traducción de errores de Rust a líneas de R#. |
| `run` | **No** compila: simula la ejecución e imprime *«Hola desde R# (mock)»*. |
| `clean` | Borra las carpetas de salida y de distribución (se niega a borrar la raíz del proyecto). |
| `--version` | Imprime `rsharp 0.1.0-mock`. |
| Error de sintaxis | Imprime el sobre con `ok: false` y `error.kind = "unsupported"`, y sale con código `1`. |

> **Aviso**: con el mock, `R#: Build` **falla a propósito** en la fase de
> compilación (el `E0308` deliberado). Es exactamente lo que se quiere para
> probar el camino de errores.

### 9.4 Probar la extensión real (sin la CLI)

Cuando no hay `rsharp` en el sistema, la extensión debe:
1. Mostrar `$(warning) R#` en la barra de estado (sin toolchain).
2. Al pulsar un comando, avisar *«Falta la CLI de R# (rsharp). Instala
   RSharp.Cli o configura `rsharp.cliPath`.»* y **no** lanzar ningún proceso.

---

## 10. Lista de verificación para el implementador de la CLI

### Contrato de proceso

- [ ] `rsharp transpile --project <dir> [--output <dir>] [--json]` funciona.
- [ ] `rsharp build --project <dir> [--profile <p>] [--target <t>] [--dist <dir>] [--json]` funciona.
- [ ] `rsharp run --project <dir> [--target <t>] [--profile <p>] [--json]` funciona **sin** `--dist` (la extensión no lo envía).
- [ ] `rsharp clean --project <dir> [--output <dir>] [--dist <dir>] [--json]` funciona.
- [ ] `rsharp --version` imprime una versión con formato `X.Y.Z` y sale con `0`.
- [ ] Todos los comandos de proyecto aceptan `--json` y **solo entonces** imprimen el sobre.
- [ ] La CLI se puede ejecutar como `dotnet <rsharp.dll> …` (ensamblado `net8.0` con punto de entrada).
- [ ] Los valores por defecto coinciden con la spec §3: salida `target/rsharp/`, distribución `dist/`.
- [ ] Los valores por defecto se pueden cambiar con `rsharp.toml` (`[paths]`).

### Sobre JSON

- [ ] Con `--json` se imprime **un único** objeto JSON válido en stdout (nada más).
- [ ] El objeto tiene `ok` booleano (obligatorio: sin él la extensión lo rechaza).
- [ ] `command` refleja el comando ejecutado.
- [ ] `durationMs` es un entero ≥ 0.
- [ ] `files[]` usa `path` relativo a la carpeta de salida, `language` ∈ {`rust`,`toml`,`other`}, `lines` opcional.
- [ ] `summary` es una línea breve.
- [ ] `artifact` apunta al binario (o al `.wasm`) producido.
- [ ] `cargo.command`, `cargo.exitCode`, `cargo.stdout` y `cargo.stderr` reflejan **la invocación real** de `cargo`.
- [ ] `error` (cuando `ok` es `false`) trae `message` y un `kind` de la lista cerrada.
- [ ] Los logs van a stderr, nunca intercalados en el stdout con `--json`.

### Diagnósticos

- [ ] Cada diagnóstico trae `code`, `severity` y `message`.
- [ ] Las líneas y columnas son **1-based**.
- [ ] `file` es la ruta del `.rsh` (relativa a la raíz del proyecto), **nunca** la del `.rs` generado.
- [ ] `help` explica qué ajuste o directiva hay que cambiar (spec §17).
- [ ] `R#0042` se emite cuando el código exige un sugar apagado.
- [ ] `R#0101` se emite cuando la API no existe en el destino (ej. `File.ReadAllText` en `wasm32-unknown-unknown`).
- [ ] `R#0150` se emite en destinos sin soporte de librerías dinámicas (ej. `[PythonModule]` en la v1).
- [ ] Los errores de `rustc` se devuelven traducidos a líneas de R# (o, en su defecto, con `cargo.stdout`/`cargo.stderr` crudos **y** los source maps, para que la extensión los traduzca).

### Source maps

- [ ] Un `RSharpSourceMap` por cada `.rs` generado.
- [ ] `rustFile` es relativo a la carpeta de salida; `rshFile` es relativo a la raíz del proyecto.
- [ ] `entries` usa líneas **1-based** en ambos lados.
- [ ] Hay entradas para las líneas del Rust que proceden de una línea del `.rsh`.
- [ ] Los errores del código generado (FFI, `wasm_bindgen`, `unsafe`) quedan dentro del mapa.

### WASM (§11)

- [ ] `--target wasm32-unknown-unknown` y `--target wasm32-wasip1` funcionan.
- [ ] `#[wasm_bindgen]` se genera para `[WasmExport]`.
- [ ] Las APIs no soportadas en el destino producen `R#0101`.
- [ ] Las DLL dinámicas y `[PythonModule]` producen `R#0150`.
- [ ] El `.wasm` producido se llama `<[project].name>.wasm` y queda en `distDir` o `distDir/<perfil>`.
- [ ] `artifact` apunta al `.wasm`.

### FFI (§13)

- [ ] `extern "C"` + `libloading` para DLL nativas; `bindgen` para C con cabecera.
- [ ] `unsafe` es obligatorio en las llamadas nativas y el código R# que lo evade se rechaza con diagnóstico.
- [ ] Los punteros devueltos se marcan con `[Owned]`/`[Borrowed]` y su incumplimiento se rechaza con diagnóstico.
- [ ] El hash de cada librería se guarda en `rsharp.lock` (no hay campo en el sobre).

### Robustez

- [ ] Un proyecto inexistente o un `rsharp.toml` inválido devuelven `ok: false` + `error` y código de salida `!= 0`, sin romperse.
- [ ] Una opción desconocida devuelve `error.kind = "unsupported"`.
- [ ] La CLI no tarda más de 10 minutos (límite del cliente) en una compilación normal.
- [ ] La CLI funciona con el directorio de trabajo = raíz del proyecto y con el entorno heredado.

### Antes de dar el contrato por cerrado

- [ ] `extension/tools/mock-rsharp.mjs` se actualiza para reflejar cualquier cambio del contrato.
- [ ] `docs/CLI-CONTRACT.md` y `extension/src/types.ts` se actualizan **a la vez** si cambia una forma de datos.
- [ ] Se ejecuta `npm test` en `extension/` (las 7 suites siguen en verde).

---

## 11. Referencia rápida

```text
rsharp transpile --project <dir> [--output <dir>] --json
rsharp build     --project <dir> [--profile debug|release] [--target native|wasm32-unknown-unknown|wasm32-wasip1] [--dist <dir>] --json
rsharp run       --project <dir> [--target <t>] [--profile <p>] --json
rsharp clean     --project <dir> [--output <dir>] [--dist <dir>] --json
rsharp --version
```

| Símbolo | Dónde está |
|---|---|
| `RSharpCliEnvelope` | `extension/src/types.ts` |
| `RSharpDiagnostic` | `extension/src/types.ts` |
| `RSharpSourceMap` | `extension/src/types.ts` |
| `RSPHARP_DIAGNOSTIC_CODES` (`R#0042`, `R#0101`, `R#0150`) | `extension/src/types.ts` |
| Cliente de la CLI (spawn, parseo, timeout) | `extension/src/cli.ts` |
| Descubrimiento del toolchain y DLL | `extension/src/toolchain.ts` |
| Resolución de source maps | `extension/src/sourcemap.ts` |
| Referencia ejecutable del contrato | `extension/tools/mock-rsharp.mjs` |
| Spec §4.4 (WASM), §9 (config), §11 (WASM), §13 (FFI), §14 (VSCode), §17 (diagnósticos) | `rsharp-spec.md` |
