using System;

namespace RSharp.Runtime
{
    /// <summary>
    /// Severidad de un diagnóstico del compilador de R#.
    /// </summary>
    public enum RSharpSeverity
    {
        /// <summary>Error: impide generar el Rust.</summary>
        Error = 0,

        /// <summary>Aviso: el Rust se genera, pero conviene revisar.</summary>
        Warning = 1,

        /// <summary>Información.</summary>
        Info = 2,

        /// <summary>Sugerencia.</summary>
        Hint = 3,
    }

    /// <summary>
    /// Un diagnóstico emitido por el compilador de R#.
    /// </summary>
    /// <remarks>
    /// La spec §17 fija los códigos <c>R#0042</c> (falta <em>sugar</em>),
    /// <c>R#0101</c> (API no soportada en el destino) y <c>R#0150</c> (el
    /// destino no admite librerías dinámicas). La decisión 0003 añade
    /// <c>R#0001</c> (construcción fuera del núcleo v1).
    /// </remarks>
    public sealed class RSharpDiagnostic
    {
        public RSharpDiagnostic(
            string code,
            RSharpSeverity severity,
            string message,
            string? file = null,
            int line = 0,
            int column = 0,
            int length = 0,
            string? help = null)
        {
            Code = code ?? throw new ArgumentNullException(nameof(code));
            Severity = severity;
            Message = message ?? throw new ArgumentNullException(nameof(message));
            File = file;
            Line = line;
            Column = column;
            Length = length;
            Help = help;
        }

        /// <summary>Código del diagnóstico, por ejemplo <c>R#0042</c>.</summary>
        public string Code { get; }

        /// <summary>Severidad.</summary>
        public RSharpSeverity Severity { get; }

        /// <summary>Descripción del problema.</summary>
        public string Message { get; }

        /// <summary>Fichero R# donde está el problema (ruta relativa al proyecto).</summary>
        public string? File { get; }

        /// <summary>Línea 1-based dentro del fichero R#.</summary>
        public int Line { get; }

        /// <summary>Columna 1-based dentro del fichero R#.</summary>
        public int Column { get; }

        /// <summary>Longitud del rango resaltado, en caracteres.</summary>
        public int Length { get; }

        /// <summary>Qué hacer para resolverlo.</summary>
        public string? Help { get; }

        public override string ToString()
        {
            return Code + ": " + Message;
        }
    }

    /// <summary>
    /// Excepción de R#: la versión en C# de <c>panic!</c> de Rust.
    /// </summary>
    /// <remarks>
    /// La spec §5 mapea <c>try/catch</c> y <c>throw</c> a un <c>Result</c>
    /// interno; en el lado de C# esta excepción es la que ve el programador.
    /// </remarks>
    public class RSharpException : Exception
    {
        public RSharpException(string message) : base(message)
        {
        }

        public RSharpException(string message, Exception? innerException)
            : base(message, innerException)
        {
        }
    }

    /// <summary>
    /// Código de salida del proceso de la CLI.
    /// </summary>
    public static class RSharpExitCode
    {
        /// <summary>Todo correcto.</summary>
        public const int Success = 0;

        /// <summary>La operación falló (errores de compilación, por ejemplo).</summary>
        public const int Failure = 1;

        /// <summary>Uso incorrecto de la CLI.</summary>
        public const int Usage = 2;

        /// <summary>La herramienta o el compilador no se encontraron.</summary>
        public const int NotFound = 127;
    }
}
