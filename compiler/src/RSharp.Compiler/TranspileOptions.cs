using System;
using System.Collections.Generic;

namespace RSharp.Compiler
{
    /// <summary>
    /// Opciones de la transpilación.
    /// </summary>
    public sealed class TranspileOptions
    {
        /// <summary>
        /// Destino de la compilación. Affects a las APIs disponibles
        /// (spec §10 y §11).
        /// </summary>
        public string Target { get; set; } = "native";

        /// <summary>
        /// Perfil de compilación (`debug` o `release`).
        /// </summary>
        public string Profile { get; set; } = "debug";

        /// <summary>
        /// Nombre del punto de entrada (clase con <c>Main</c>). Si es
        /// <c>null</c>, se busca automáticamente.
        /// </summary>
        public string? EntryPoint { get; set; }

        /// <summary>
        /// Emite el Rust alineado línea a línea con el <c>.rsh</c> de origen.
        /// </summary>
        /// <remarks>
        /// Con la alineación, el source map es trivial y el remapeo de rutas de
        /// LLDB funciona con los puntos de parada (decisión 0005).
        /// </remarks>
        public bool LineAligned { get; set; } = true;

        /// <summary>
        /// Incluye los source maps en el resultado.
        /// </summary>
        public bool EmitSourceMaps { get; set; } = true;

        /// <summary>
        /// Hash de la configuración de <em>sugar</em> vigente, para el archivo
        /// de bloqueo (spec §9).
        /// </summary>
        public string? SugarHash { get; set; }

        /// <summary>
        /// Valores de <em>sugar</em> por ámbito, para decidir si una
        /// construcción exige concesión (spec §8.2).
        /// </summary>
        public IReadOnlyDictionary<string, string> Sugar { get; set; } =
            new Dictionary<string, string>(StringComparer.Ordinal);
    }

    /// <summary>
    /// Un fichero Rust generado.
    /// </summary>
    public sealed class TranspiledFile
    {
        public TranspiledFile(string fileName, string content, IReadOnlyList<int> lineMap)
        {
            FileName = fileName ?? throw new ArgumentNullException(nameof(fileName));
            Content = content ?? throw new ArgumentNullException(nameof(content));
            LineMap = lineMap ?? throw new ArgumentNullException(nameof(lineMap));
        }

        /// <summary>Nombre del fichero generado, por ejemplo <c>main.rs</c>.</summary>
        public string FileName { get; }

        /// <summary>Contenido del Rust generado.</summary>
        public string Content { get; }

        /// <summary>
        /// Mapa de líneas: la posición <c>i</c> es la línea de Rust y el
        /// valor es la línea del <c>.rsh</c> de origen.
        /// </summary>
        public IReadOnlyList<int> LineMap { get; }
    }

    /// <summary>
    /// Una entrada del source map (decisión 0005).
    /// </summary>
    public sealed class SourceMapEntry
    {
        public SourceMapEntry(int rustLine, int rshLine)
        {
            RustLine = rustLine;
            RshLine = rshLine;
        }

        /// <summary>Línea 1-based del Rust generado.</summary>
        public int RustLine { get; }

        /// <summary>Línea 1-based del <c>.rsh</c> de origen.</summary>
        public int RshLine { get; }
    }

    /// <summary>
    /// Source map de un fichero generado (decisión 0005).
    /// </summary>
    public sealed class SourceMap
    {
        public SourceMap(string rustFile, string rshFile, IReadOnlyList<SourceMapEntry> entries)
        {
            RustFile = rustFile ?? throw new ArgumentNullException(nameof(rustFile));
            RshFile = rshFile ?? throw new ArgumentNullException(nameof(rshFile));
            Entries = entries ?? throw new ArgumentNullException(nameof(entries));
        }

        /// <summary>Fichero Rust, relativo a la carpeta de salida.</summary>
        public string RustFile { get; }

        /// <summary>Fichero <c>.rsh</c>, relativo a la raíz del proyecto.</summary>
        public string RshFile { get; }

        /// <summary>Entradas del mapa, ordenadas por línea de Rust.</summary>
        public IReadOnlyList<SourceMapEntry> Entries { get; }
    }

    /// <summary>
    /// Resultado de una transpilación.
    /// </summary>
    public sealed class TranspileResult
    {
        public TranspileResult(
            IReadOnlyList<TranspiledFile> files,
            IReadOnlyList<RSharp.Runtime.RSharpDiagnostic> diagnostics,
            IReadOnlyList<SourceMap> sourceMaps,
            string? entryClass = null)
        {
            Files = files ?? throw new ArgumentNullException(nameof(files));
            Diagnostics = diagnostics ?? throw new ArgumentNullException(nameof(diagnostics));
            SourceMaps = sourceMaps ?? throw new ArgumentNullException(nameof(sourceMaps));
            EntryClass = entryClass;
        }

        /// <summary>Clase con el punto de entrada <c>Main</c>, si la hay.</summary>
        public string? EntryClass { get; }

        /// <summary>Ficheros Rust generados.</summary>
        public IReadOnlyList<TranspiledFile> Files { get; }

        /// <summary>Diagnósticos emitidos.</summary>
        public IReadOnlyList<RSharp.Runtime.RSharpDiagnostic> Diagnostics { get; }

        /// <summary>Source maps de los ficheros generados.</summary>
        public IReadOnlyList<SourceMap> SourceMaps { get; }

        /// <summary><c>true</c> si no hay errores.</summary>
        public bool Success
        {
            get
            {
                foreach (var diagnostic in Diagnostics)
                {
                    if (diagnostic.Severity == RSharp.Runtime.RSharpSeverity.Error)
                    {
                        return false;
                    }
                }

                return true;
            }
        }
    }
}
