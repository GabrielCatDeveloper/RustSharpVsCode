using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;

namespace RSharp.Runtime
{
    /// <summary>
    /// La configuración de un proyecto R#, leída de <c>rsharp.toml</c>.
    /// </summary>
    /// <remarks>
    /// Spec §9: «Los valores por defecto son estrictos», «Se sobrescribe por
    /// archivo con <c>[assembly: RSharpSugar("overflow", "wrap")]</c>» y «Gana
    /// el ámbito más cercano al código».
    /// </remarks>
    public sealed class RSharpConfig
    {
        /// <summary>Nombre del fichero de configuración.</summary>
        public const string FileName = "rsharp.toml";

        /// <summary>Carpeta de salida por defecto (spec §3).</summary>
        public const string DefaultOutputRelative = "target/rsharp";

        /// <summary>Carpeta de distribución por defecto (spec §3).</summary>
        public const string DefaultDistRelative = "dist";

        /// <summary>Valores de <em>sugar</em> leídos.</summary>
        public readonly Dictionary<string, string> Sugar = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            { "strings", "utf8" },
            { "overflow", "panic" },
            { "reentrancy", "panic" },
            { "finalizers", "deterministic" },
            { "cycles", "weak-attribute" },
        };

        /// <summary>Nombre del proyecto.</summary>
        public string ProjectName { get; set; } = "rsharp_app";

        /// <summary>Carpeta donde se genera el Rust (ruta absoluta).</summary>
        public string OutputDirectory { get; set; } = string.Empty;

        /// <summary>Carpeta donde se compila el binario (ruta absoluta).</summary>
        public string DistDirectory { get; set; } = string.Empty;

        /// <summary>Destino de compilación.</summary>
        public string Target { get; set; } = "native";

        /// <summary>Perfil de compilación.</summary>
        public string Profile { get; set; } = "debug";

        /// <summary>Avisos producidos al leer el fichero.</summary>
        public List<string> Warnings { get; } = new List<string>();

        /// <summary>True si se ha encontrado y podido leer <c>rsharp.toml</c>.</summary>
        public bool Found { get; private set; }

        /// <summary>
        /// Carga la configuración de un proyecto.
        /// </summary>
        /// <param name="projectRoot">Raíz del proyecto.</param>
        /// <returns>La configuración; nunca lanza: los problemas van en <see cref="Warnings"/>.</returns>
        public static RSharpConfig Load(string projectRoot)
        {
            var config = new RSharpConfig();
            string path = Path.Combine(projectRoot, FileName);

            Dictionary<string, object>? table = null;
            try
            {
                if (File.Exists(path))
                {
                    table = Toml.Parse(File.ReadAllText(path));
                    config.Found = true;
                }
            }
            catch (Exception error)
            {
                config.Warnings.Add("\"" + path + "\" no es válido: " + error.Message);
            }

            string output = Toml.GetString(table ?? new Dictionary<string, object>(), "paths.output") ?? DefaultOutputRelative;
            string dist = Toml.GetString(table ?? new Dictionary<string, object>(), "paths.dist") ?? DefaultDistRelative;
            string name = Toml.GetString(table ?? new Dictionary<string, object>(), "project.name");
            string target = Toml.GetString(table ?? new Dictionary<string, object>(), "build.target");
            string profile = Toml.GetString(table ?? new Dictionary<string, object>(), "build.profile");

            if (!string.IsNullOrEmpty(name))
            {
                config.ProjectName = name!;
            }

            config.OutputDirectory = Path.GetFullPath(Path.Combine(projectRoot, output));
            config.DistDirectory = Path.GetFullPath(Path.Combine(projectRoot, dist));

            if (!string.IsNullOrEmpty(target))
            {
                config.Target = target!;
            }

            if (!string.IsNullOrEmpty(profile))
            {
                config.Profile = profile!;
            }

            foreach (string key in new[] { "strings", "overflow", "reentrancy", "finalizers", "cycles" })
            {
                string? value = Toml.GetString(table ?? new Dictionary<string, object>(), "sugar." + key);
                if (!string.IsNullOrEmpty(value))
                {
                    config.Sugar[key] = value!;
                }
            }

            if (string.Equals(config.OutputDirectory, config.DistDirectory, StringComparison.Ordinal))
            {
                config.Warnings.Add(
                    "La carpeta de salida y la de distribución son la misma: la spec §14.4 lo prohíbe.");
            }

            return config;
        }

        /// <summary>Devuelve el valor de <em>sugar</em> vigente.</summary>
        public string SugarValue(string key, string scope = null!)
        {
            if (scope != null && Sugar.TryGetValue(scope + "." + key, out string? scoped))
            {
                return scoped;
            }

            return Sugar.TryGetValue(key, out string? value) ? value : string.Empty;
        }
    }
}
