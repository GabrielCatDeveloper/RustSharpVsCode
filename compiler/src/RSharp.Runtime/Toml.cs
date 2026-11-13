using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace RSharp.Runtime
{
    /// <summary>
    /// Lector de TOML para el subconjunto que usa <c>rsharp.toml</c>.
    /// </summary>
    /// <remarks>
    /// El compilador no puede depender de un paquete externo (spec §4.2), así
    /// que el lector está en casa. Cubre: tablas, tablas de arrays, claves
    /// simples y con punto, cadenas (básicas y literales), enteros, flotantes,
    /// booleanos, arrays y tablas en línea.
    /// </remarks>
    public static class Toml
    {
        /// <summary>
        /// Analiza un documento TOML.
        /// </summary>
        /// <param name="text">Contenido del fichero.</param>
        /// <returns>
        /// Tabla raíz. Las tablas anidadas se guardan como
        /// <see cref="Dictionary{TKey,TValue}"/> indexadas por su ruta con
        /// punto (<c>paths.output</c>).
        /// </returns>
        /// <exception cref="TomlParseException">Si el documento no es válido.</exception>
        public static Dictionary<string, object> Parse(string text)
        {
            var root = new Dictionary<string, object>(StringComparer.Ordinal);
            if (text == null)
            {
                return root;
            }

            string currentTable = string.Empty;
            var lines = SplitLines(text);

            for (int index = 0; index < lines.Count; index++)
            {
                string line = lines[index].Trim();
                if (line.Length == 0 || line[0] == '#')
                {
                    continue;
                }

                if (line[0] == '[')
                {
                    bool isArrayTable = line.StartsWith("[[", StringComparison.Ordinal);
                    string closing = isArrayTable ? "]]" : "]";
                    int end = line.IndexOf(closing, StringComparison.Ordinal);
                    if (end < 0)
                    {
                        throw new TomlParseException("No se cierra la tabla: " + line, index + 1);
                    }

                    string name = line.Substring(isArrayTable ? 2 : 1, end - (isArrayTable ? 2 : 1)).Trim();
                    currentTable = name;

                    if (isArrayTable)
                    {
                        AppendToArrayTable(root, name);
                    }

                    continue;
                }

                int equals = FindAssignment(line);
                if (equals < 0)
                {
                    throw new TomlParseException("No se entiende la línea: " + line, index + 1);
                }

                string key = line.Substring(0, equals).Trim().Trim('"');
                string rawValue = line.Substring(equals + 1).Trim();

                // Un valor puede ocupar varias líneas (arrays multilínea).
                while (IsIncomplete(rawValue) && index + 1 < lines.Count)
                {
                    index++;
                    rawValue = rawValue + "\n" + lines[index].Trim();
                }

                object? value = ParseValue(rawValue, index + 1);
                string fullKey = currentTable.Length == 0 ? key : currentTable + "." + key;
                root[fullKey] = value;
            }

            return root;
        }

        /// <summary>Lee un valor booleano con clave de ruta con punto.</summary>
        public static bool? GetBoolean(Dictionary<string, object> table, string key)
        {
            object? value = Get(table, key);
            if (value is bool boolean)
            {
                return boolean;
            }

            return null;
        }

        /// <summary>Lee un valor de cadena.</summary>
        public static string? GetString(Dictionary<string, object> table, string key)
        {
            object? value = Get(table, key);
            if (value is string text)
            {
                return text;
            }

            return null;
        }

        /// <summary>Lee un valor entero.</summary>
        public static long? GetInteger(Dictionary<string, object> table, string key)
        {
            object? value = Get(table, key);
            if (value is long number)
            {
                return number;
            }

            if (value is int integer)
            {
                return integer;
            }

            return null;
        }

        /// <summary>Busca una clave (con o sin tabla).</summary>
        public static object? Get(Dictionary<string, object> table, string key)
        {
            if (table.TryGetValue(key, out object? value))
            {
                return value;
            }

            foreach (var pair in table)
            {
                if (pair.Key.EndsWith("." + key, StringComparison.Ordinal))
                {
                    return pair.Value;
                }
            }

            return null;
        }

        private static void AppendToArrayTable(Dictionary<string, object> root, string name)
        {
            if (!root.TryGetValue(name, out object? value))
            {
                root[name] = new List<Dictionary<string, object>>();
                return;
            }

            if (value is List<Dictionary<string, object>>)
            {
                return;
            }
        }

        private static bool IsIncomplete(string value)
        {
            int brackets = 0;
            int braces = 0;
            bool inString = false;
            char quote = '"';

            foreach (char current in value)
            {
                if (inString)
                {
                    if (current == quote)
                    {
                        inString = false;
                    }

                    continue;
                }

                switch (current)
                {
                    case '"':
                    case '\'':
                        inString = true;
                        quote = current;
                        break;
                    case '[':
                        brackets++;
                        break;
                    case ']':
                        brackets--;
                        break;
                    case '{':
                        braces++;
                        break;
                    case '}':
                        braces--;
                        break;
                }
            }

            return brackets > 0 || braces > 0 || inString;
        }

        private static int FindAssignment(string line)
        {
            bool inString = false;
            char quote = '"';

            for (int index = 0; index < line.Length; index++)
            {
                char current = line[index];
                if (inString)
                {
                    if (current == quote)
                    {
                        inString = false;
                    }

                    continue;
                }

                if (current == '"' || current == '\'')
                {
                    inString = true;
                    quote = current;
                    continue;
                }

                if (current == '=')
                {
                    return index;
                }
            }

            return -1;
        }

        private static object? ParseValue(string raw, int line)
        {
            string value = raw.Trim();
            if (value.Length == 0)
            {
                return null;
            }

            if (value[0] == '"' || value[0] == '\'')
            {
                return ParseString(value, line);
            }

            if (value[0] == '[')
            {
                return ParseArray(value, line);
            }

            if (value[0] == '{')
            {
                return ParseInlineTable(value, line);
            }

            if (value == "true")
            {
                return true;
            }

            if (value == "false")
            {
                return false;
            }

            if (long.TryParse(value.Replace("_", string.Empty), NumberStyles.Integer, CultureInfo.InvariantCulture, out long integer))
            {
                return integer;
            }

            if (double.TryParse(value.Replace("_", string.Empty), NumberStyles.Float, CultureInfo.InvariantCulture, out double number))
            {
                return number;
            }

            throw new TomlParseException("No se entiende el valor: " + value, line);
        }

        private static string ParseString(string value, int line)
        {
            char quote = value[0];
            int end = value.IndexOf(quote, 1);
            if (end < 0)
            {
                throw new TomlParseException("Cadena sin cerrar: " + value, line);
            }

            string content = value.Substring(1, end - 1);
            if (quote == '\'')
            {
                return content;
            }

            var builder = new StringBuilder(content.Length);
            for (int index = 0; index < content.Length; index++)
            {
                if (content[index] == '\\' && index + 1 < content.Length)
                {
                    index++;
                    switch (content[index])
                    {
                        case 'n': builder.Append('\n'); break;
                        case 't': builder.Append('\t'); break;
                        case 'r': builder.Append('\r'); break;
                        case '"': builder.Append('"'); break;
                        case '\\': builder.Append('\\'); break;
                        default: builder.Append(content[index]); break;
                    }

                    continue;
                }

                builder.Append(content[index]);
            }

            return builder.ToString();
        }

        private static List<object?> ParseArray(string value, int line)
        {
            var items = new List<object?>();
            int depth = 0;
            var current = new StringBuilder();
            bool inString = false;
            char quote = '"';

            foreach (char character in value)
            {
                if (inString)
                {
                    current.Append(character);
                    if (character == quote)
                    {
                        inString = false;
                    }

                    continue;
                }

                switch (character)
                {
                    case '"':
                    case '\'':
                        inString = true;
                        quote = character;
                        current.Append(character);
                        continue;
                    case '[':
                        depth++;
                        if (depth == 1)
                        {
                            continue;
                        }

                        current.Append(character);
                        continue;
                    case ']':
                        depth--;
                        if (depth == 0)
                        {
                            AddItem(items, current.ToString(), line);
                            return items;
                        }

                        current.Append(character);
                        continue;
                    case ',':
                        if (depth == 1)
                        {
                            AddItem(items, current.ToString(), line);
                            current.Clear();
                            continue;
                        }

                        current.Append(character);
                        continue;
                    default:
                        current.Append(character);
                        continue;
                }
            }

            throw new TomlParseException("Array sin cerrar", line);
        }

        private static void AddItem(List<object?> items, string text, int line)
        {
            string trimmed = text.Trim();
            if (trimmed.Length == 0)
            {
                return;
            }

            items.Add(ParseValue(trimmed, line));
        }

        private static Dictionary<string, object> ParseInlineTable(string value, int line)
        {
            var table = new Dictionary<string, object>(StringComparer.Ordinal);
            string content = value.Trim();
            if (content.EndsWith("}", StringComparison.Ordinal))
            {
                content = content.Substring(1, content.Length - 2);
            }

            foreach (string part in SplitTopLevel(content))
            {
                int equals = FindAssignment(part);
                if (equals < 0)
                {
                    continue;
                }

                string key = part.Substring(0, equals).Trim().Trim('"');
                object? item = ParseValue(part.Substring(equals + 1).Trim(), line);
                table[key] = item!;
            }

            return table;
        }

        private static IEnumerable<string> SplitTopLevel(string content)
        {
            var parts = new List<string>();
            var current = new StringBuilder();
            int depth = 0;
            bool inString = false;
            char quote = '"';

            foreach (char character in content)
            {
                if (inString)
                {
                    current.Append(character);
                    if (character == quote)
                    {
                        inString = false;
                    }

                    continue;
                }

                switch (character)
                {
                    case '"':
                    case '\'':
                        inString = true;
                        quote = character;
                        current.Append(character);
                        continue;
                    case '[':
                    case '{':
                        depth++;
                        current.Append(character);
                        continue;
                    case ']':
                    case '}':
                        depth--;
                        current.Append(character);
                        continue;
                    case ',':
                        if (depth == 0)
                        {
                            parts.Add(current.ToString());
                            current.Clear();
                            continue;
                        }

                        current.Append(character);
                        continue;
                    default:
                        current.Append(character);
                        continue;
                }
            }

            if (current.ToString().Trim().Length > 0)
            {
                parts.Add(current.ToString());
            }

            return parts;
        }

        private static List<string> SplitLines(string text)
        {
            var lines = new List<string>();
            var current = new StringBuilder();
            bool inString = false;
            char quote = '"';

            foreach (char character in text)
            {
                if (inString)
                {
                    current.Append(character);
                    if (character == quote)
                    {
                        inString = false;
                    }

                    continue;
                }

                if (character == '"' || character == '\'')
                {
                    inString = true;
                    quote = character;
                    current.Append(character);
                    continue;
                }

                if (character == '\n')
                {
                    lines.Add(current.ToString());
                    current.Clear();
                    continue;
                }

                if (character == '\r')
                {
                    continue;
                }

                current.Append(character);
            }

            if (current.Length > 0)
            {
                lines.Add(current.ToString());
            }

            return lines;
        }
    }

    /// <summary>Error de sintaxis de TOML.</summary>
    public sealed class TomlParseException : Exception
    {
        public TomlParseException(string message, int line)
            : base(message + " (línea " + line.ToString(CultureInfo.InvariantCulture) + ")")
        {
            Line = line;
        }

        /// <summary>Línea 1-based donde está el error.</summary>
        public int Line { get; }
    }
}
