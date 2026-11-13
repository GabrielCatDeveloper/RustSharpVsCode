using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace RSharp.Compiler.Emit
{
    /// <summary>
    /// Acumulador de líneas de Rust alineadas con las del <c>.rsh</c> de origen.
    /// </summary>
    /// <remarks>
    /// La alineación (una línea de Rust por línea de C#) hace que el source map
    /// sea trivial y que el remapeo de rutas de LLDB funcione con los puntos
    /// de parada. Decisión 0005.
    /// </remarks>
    internal sealed class RustFileBuilder
    {
        private readonly List<string> _lines = new List<string>();
        private readonly List<string> _tail = new List<string>();

        /// <summary>Escribe un fragmento en la línea indicada (1-based).</summary>
        public void Write(int line, string text)
        {
            int index = Math.Max(0, line - 1);
            while (_lines.Count <= index)
            {
                _lines.Add(string.Empty);
            }

            string current = _lines[index];
            _lines[index] = current.Length == 0 ? text : current + " " + text;
        }

        /// <summary>
        /// Escribe al final del fichero (implementaciones sin línea propia).
        /// </summary>
        /// <remarks>
        /// El contenido de la cola se añade **después** de todo el fichero:
        /// si se insertara en el momento de escribirlo, quedaría intercalado
        /// entre los tipos y rompería los bloques `impl`.
        /// </remarks>
        public void WriteTail(string text)
        {
            _tail.Add(text);
        }

        /// <summary>
        /// Añade texto al principio de la primera línea.
        /// </summary>
        /// <remarks>
        /// Se usa para los `use` cruzados entre ficheros: deben ir en la
        /// primera línea para no desplazar la alineación con el `.rsh`.
        /// </remarks>
        public void PrependToFirstLine(string text)
        {
            if (text.Length == 0)
            {
                return;
            }

            while (_lines.Count == 0)
            {
                _lines.Add(string.Empty);
            }

            _lines[0] = _lines[0].Length == 0 ? text : text + " " + _lines[0];
        }

        /// <summary>Líneas del fichero generado (sin la cola).</summary>
        public IReadOnlyList<string> Lines
        {
            get { return _lines; }
        }

        /// <summary>Contenido final, con salto de línea.</summary>
        public string ToText()
        {
            var all = new List<string>(_lines);
            all.AddRange(_tail);
            return string.Join("\n", all) + "\n";
        }
    }

    /// <summary>
    /// Utilidades de nombres para el Rust generado.
    /// </summary>
    internal static class RustNames
    {
        /// <summary>Convierte un nombre de C# a <c>snake_case</c>.</summary>
        public static string SnakeCase(string name)
        {
            if (string.IsNullOrEmpty(name))
            {
                return name;
            }

            var builder = new StringBuilder(name.Length + 8);
            for (int index = 0; index < name.Length; index++)
            {
                char current = name[index];
                char previous = index > 0 ? name[index - 1] : '\0';

                bool previousIsLower = previous != '\0' && (char.IsLower(previous) || char.IsDigit(previous));
                bool startsWord = previousIsLower && char.IsUpper(current);

                if (index > 0 && previousIsLower && char.IsUpper(current))
                {
                    builder.Append('_');
                }
                else if (index > 0 && char.IsUpper(previous) && char.IsUpper(current) &&
                         index + 1 < name.Length && char.IsLower(name[index + 1]))
                {
                    builder.Append('_');
                }

                builder.Append(char.ToLowerInvariant(current));
            }

            return builder.ToString();
        }

        /// <summary>Convierte un nombre de C# a <c>UpperCamelCase</c>.</summary>
        public static string PascalCase(string name)
        {
            if (string.IsNullOrEmpty(name))
            {
                return name;
            }

            return char.ToUpperInvariant(name[0]) + name.Substring(1);
        }
    }
}
