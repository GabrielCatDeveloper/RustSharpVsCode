using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;

using Microsoft.CodeAnalysis.Diagnostics;

using RSharp.Compiler;
using RSharp.Runtime;

namespace RSharp.Cli
{
    /// <summary>
    /// CLI del compilador de R#.
    /// </summary>
    /// <remarks>
    /// Contrato (el mismo que consume la extensión de VSCode, ver
    /// <c>docs/CLI-CONTRACT.md</c>):
    /// <code>
    /// rsharp transpile --project &lt;dir&gt; [--output &lt;dir&gt;] [--json]
    /// rsharp build     --project &lt;dir&gt; [--profile debug|release] [--target &lt;t&gt;] [--dist &lt;dir&gt;] [--json]
    /// rsharp run       --project &lt;dir&gt; [--target &lt;t&gt;] [--profile &lt;p&gt;] [--json]
    /// rsharp clean     --project &lt;dir&gt; [--output &lt;dir&gt;] [--dist &lt;dir&gt;] [--json]
    /// rsharp --version
    /// </code>
    /// Con <c>--json</c> se imprime un único objeto con la forma
    /// <c>RSharpCliEnvelope</c>.
    /// </remarks>
    public static class Program
    {
        private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions
        {
            WriteIndented = true,
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        };

        public static int Main(string[] args)
        {
            try
            {
                if (args.Length == 0)
                {
                    PrintUsage();
                    return RSharpExitCode.Usage;
                }

                string command = args[0];
                var options = ParseArguments(args);

                switch (command)
                {
                    case "--version":
                    case "-v":
                    case "version":
                        Console.WriteLine("rsharp " + Version);
                        return RSharpExitCode.Success;

                    case "transpile":
                        return CommandTranspile(options);

                    case "build":
                        return CommandBuild(options);

                    case "run":
                        return CommandRun(options);

                    case "clean":
                        return CommandClean(options);

                    case "--help":
                    case "-h":
                    case "help":
                        PrintUsage();
                        return RSharpExitCode.Success;

                    default:
                        Console.Error.WriteLine("Comando desconocido: " + command);
                        PrintUsage();
                        return RSharpExitCode.Usage;
                }
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("rsharp: " + error.Message);
                if (Environment.GetEnvironmentVariable("RSHARP_DEBUG") == "1")
                {
                    Console.Error.WriteLine(error.StackTrace);
                }

                return RSharpExitCode.Failure;
            }
        }

        /// <summary>Versión de la CLI.</summary>
        public static string Version
        {
            get { return typeof(Program).Assembly.GetName().Version?.ToString(3) ?? "0.1.0"; }
        }

        // -------------------------------------------------------------------
        // Comandos
        // -------------------------------------------------------------------

        private static int CommandTranspile(CliOptions options)
        {
            var stopwatch = Stopwatch.StartNew();
            string projectRoot = ResolveProject(options.Project);
            RSharpConfig config = RSharpConfig.Load(projectRoot);
            string outputDirectory = options.Output ?? config.OutputDirectory;

            foreach (string warning in config.Warnings)
            {
                Console.Error.WriteLine("aviso: " + warning);
            }

            var sources = LoadSources(projectRoot, outputDirectory, config.DistDirectory);
            if (sources.Count == 0)
            {
                return Fail(options, "transpile", "No se encontraron archivos .rsh en " + projectRoot, "not-found", stopwatch);
            }

            TranspileResult result = Transpiler.Run(sources, BuildOptions(config, options));

            foreach (TranspiledFile file in result.Files)
            {
                string target = Path.Combine(outputDirectory, file.FileName);
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                File.WriteAllText(target, file.Content);
            }

            WriteCargoManifest(outputDirectory, config.ProjectName);
            WriteSourceMaps(outputDirectory, result);
            WriteLockFile(projectRoot, config);

            var files = result.Files
                .Select(file => new
                {
                    path = file.FileName,
                    language = "rust",
                    lines = file.Content.Split('\n').Length - 1,
                })
                .ToArray();

            var sourceMaps = result.SourceMaps.Select(map => new
            {
                rustFile = map.RustFile,
                rshFile = map.RshFile,
                entries = map.Entries.Select(entry => new { rustLine = entry.RustLine, rshLine = entry.RshLine }).ToArray(),
            }).ToArray();

            var diagnostics = result.Diagnostics.Select(ToJson).ToArray();
            var maps = sourceMaps;
            int errorCount = result.Diagnostics.Count(diagnostic => diagnostic.Severity == RSharpSeverity.Error);
            bool ok = result.Success;
            var envelope = new
            {
                ok,
                command = "transpile",
                durationMs = stopwatch.ElapsedMilliseconds,
                files,
                diagnostics,
                sourceMaps = maps,
                summary = "Transpilado: " + files.Length + " archivo(s), " +
                          result.SourceMaps.Sum(map => map.Entries.Count) + " línea(s) mapeadas.",
                error = ok ? null : new
                {
                    message = "La transpilación produjo " + errorCount + " error(es).",
                    kind = "unknown",
                },
            };

            Emit(options, envelope, ok);
            return ok ? RSharpExitCode.Success : RSharpExitCode.Failure;
        }

        private static int CommandBuild(CliOptions options)
        {
            var stopwatch = Stopwatch.StartNew();
            string projectRoot = ResolveProject(options.Project);
            RSharpConfig config = RSharpConfig.Load(projectRoot);
            string outputDirectory = options.Output ?? config.OutputDirectory;
            string distDirectory = options.Dist ?? config.DistDirectory;

            if (options.Profile != null)
            {
                config.Profile = options.Profile;
            }

            if (options.Target != null)
            {
                config.Target = options.Target;
            }

            var sources = LoadSources(projectRoot, outputDirectory, distDirectory);
            TranspileResult result = Transpiler.Run(sources, BuildOptions(config, options));

            foreach (TranspiledFile file in result.Files)
            {
                string target = Path.Combine(outputDirectory, file.FileName);
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                File.WriteAllText(target, file.Content);
            }

            WriteCargoManifest(outputDirectory, config.ProjectName);
            WriteSourceMaps(outputDirectory, result);
            WriteLockFile(projectRoot, config);

            // Los módulos: el `main.rs` declara el resto.
            string mainFile = result.Files
                .Select(file => file.FileName)
                .FirstOrDefault(name => name == "main.rs");

            if (mainFile != null)
            {
                string mainPath = Path.Combine(outputDirectory, mainFile);
                var declarations = new List<string>();
                foreach (TranspiledFile file in result.Files)
                {
                    if (file.FileName == mainFile)
                    {
                        continue;
                    }

                    string module = Path.GetFileNameWithoutExtension(file.FileName);
                    declarations.Add("mod " + module + ";");
                    declarations.Add("pub use " + module + "::*;");
                }

                string content = File.ReadAllText(mainPath);
                string[] lines = content.Split('\n');
                lines[0] = string.Join(" ", declarations) + " " + lines[0];

                // El punto de entrada del crate: llama al `Main` del programa.
                if (result.EntryClass != null)
                {
                    content = string.Join("\n", lines) +
                              "\nfn main() { " + result.EntryClass + "::main(Vec::new()); }\n";
                }
                else
                {
                    content = string.Join("\n", lines);
                }

                File.WriteAllText(mainPath, content);
            }

            var cargoArguments = new List<string> { "build" };
            if (config.Target != "native")
            {
                cargoArguments.Add("--target");
                cargoArguments.Add(config.Target);
            }

            if (config.Profile == "release")
            {
                cargoArguments.Add("--release");
            }

            cargoArguments.Add("--target-dir");
            cargoArguments.Add(distDirectory);

            CargoResult cargo = RunCargo(cargoArguments, outputDirectory);

            string? artifact = cargo.ExitCode == 0
                ? Path.Combine(distDirectory, config.Profile == "release" ? "release" : "debug", config.ProjectName)
                : null;

            var diagnostics = result.Diagnostics.Select(ToJson).ToArray();
            bool ok = result.Success && cargo.ExitCode == 0;

            var envelope = new
            {
                ok,
                command = "build",
                durationMs = stopwatch.ElapsedMilliseconds,
                files = result.Files.Select(file => new
                {
                    path = file.FileName,
                    language = "rust",
                    lines = file.Content.Split('\n').Length - 1,
                }).ToArray(),
                diagnostics,
                sourceMaps = result.SourceMaps.Select(map => new
                {
                    rustFile = map.RustFile,
                    rshFile = map.RshFile,
                    entries = map.Entries.Select(entry => new { rustLine = entry.RustLine, rshLine = entry.RshLine }).ToArray(),
                }).ToArray(),
                summary = ok
                    ? "Compilado con cargo (" + config.Profile + ", " + config.Target + "): " + artifact
                    : "La compilación falló (" + cargo.ExitCode + ").",
                artifact,
                cargo = new
                {
                    command = "cargo " + string.Join(" ", cargoArguments),
                    exitCode = cargo.ExitCode,
                    stdout = cargo.StandardOutput,
                    stderr = cargo.StandardError,
                },
                error = ok ? null : new
                {
                    message = cargo.ExitCode == 0
                        ? "La transpilación produjo errores."
                        : "cargo build terminó con código " + cargo.ExitCode + ".",
                    kind = cargo.ExitCode == 0 ? "unknown" : "non-zero",
                },
            };

            Emit(options, envelope, ok);
            return ok ? RSharpExitCode.Success : RSharpExitCode.Failure;
        }

        private static int CommandRun(CliOptions options)
        {
            var stopwatch = Stopwatch.StartNew();
            string projectRoot = ResolveProject(options.Project);
            RSharpConfig config = RSharpConfig.Load(projectRoot);

            int buildCode = CommandBuild(options);
            if (buildCode != RSharpExitCode.Success)
            {
                return buildCode;
            }

            string distDirectory = options.Dist ?? config.DistDirectory;
            string binary = Path.Combine(
                distDirectory,
                config.Profile == "release" ? "release" : "debug",
                config.ProjectName);

            if (!File.Exists(binary))
            {
                return Fail(options, "run", "No se encontró el binario en " + binary, "not-found", stopwatch);
            }

            var execution = Run(binary, new string[0], projectRoot);
            Console.Write(execution.StandardOutput);
            if (execution.StandardError.Length > 0)
            {
                Console.Error.Write(execution.StandardError);
            }

            var envelope = new
            {
                ok = execution.ExitCode == 0,
                command = "run",
                durationMs = stopwatch.ElapsedMilliseconds,
                files = Array.Empty<object>(),
                diagnostics = Array.Empty<object>(),
                sourceMaps = Array.Empty<object>(),
                summary = "Ejecutado: " + binary,
                artifact = binary,
                error = execution.ExitCode == 0 ? null : new
                {
                    message = "El programa terminó con código " + execution.ExitCode + ".",
                    kind = "non-zero",
                },
            };

            Emit(options, envelope, execution.ExitCode == 0);
            return execution.ExitCode == 0 ? RSharpExitCode.Success : RSharpExitCode.Failure;
        }

        private static int CommandClean(CliOptions options)
        {
            var stopwatch = Stopwatch.StartNew();
            string projectRoot = ResolveProject(options.Project);
            RSharpConfig config = RSharpConfig.Load(projectRoot);
            string outputDirectory = options.Output ?? config.OutputDirectory;
            string distDirectory = options.Dist ?? config.DistDirectory;

            foreach (string directory in new[] { outputDirectory, distDirectory })
            {
                if (!Directory.Exists(directory))
                {
                    continue;
                }

                if (string.Equals(Path.GetFullPath(directory), Path.GetFullPath(projectRoot), StringComparison.Ordinal))
                {
                    return Fail(options, "clean", "No se puede borrar la raíz del proyecto.", "unsupported", stopwatch);
                }

                try
                {
                    Directory.Delete(directory, recursive: true);
                }
                catch (IOException error)
                {
                    return Fail(options, "clean", "No se pudo borrar " + directory + ": " + error.Message, "unknown", stopwatch);
                }
            }

            var envelope = new
            {
                ok = true,
                command = "clean",
                durationMs = stopwatch.ElapsedMilliseconds,
                files = Array.Empty<object>(),
                diagnostics = Array.Empty<object>(),
                sourceMaps = Array.Empty<object>(),
                summary = "Se borraron las carpetas de salida y de distribución.",
                error = (object?)null,
            };

            Emit(options, envelope, true);
            return RSharpExitCode.Success;
        }

        // -------------------------------------------------------------------
        // Proyecto
        // -------------------------------------------------------------------

        private static Dictionary<string, string> LoadSources(
            string projectRoot,
            string outputDirectory,
            string distDirectory)
        {
            var sources = new Dictionary<string, string>(StringComparer.Ordinal);
            var skip = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "target", "dist", "bin", "obj", "node_modules", ".git", ".vs", ".vscode",
            };

            foreach (string file in Directory.EnumerateFiles(projectRoot, "*.rsh", SearchOption.AllDirectories))
            {
                string relative = Path.GetRelativePath(projectRoot, file);
                string first = relative.Split(Path.DirectorySeparatorChar)[0];
                if (skip.Contains(first))
                {
                    continue;
                }

                string full = Path.GetFullPath(file);
                if (full.StartsWith(Path.GetFullPath(outputDirectory), StringComparison.Ordinal) ||
                    full.StartsWith(Path.GetFullPath(distDirectory), StringComparison.Ordinal))
                {
                    continue;
                }

                sources[relative.Replace(Path.DirectorySeparatorChar, '/')] = File.ReadAllText(file);
            }

            return sources;
        }

        private static TranspileOptions BuildOptions(RSharpConfig config, CliOptions options)
        {
            return new TranspileOptions
            {
                Target = options.Target ?? config.Target,
                Profile = config.Profile,
                Sugar = config.Sugar,
                Analyzers = Analyzers(),
            };
        }

        /// <summary>Los analizadores del núcleo que se aplican al compilar.</summary>
        private static ImmutableArray<DiagnosticAnalyzer> Analyzers()
        {
            return ImmutableArray.Create<DiagnosticAnalyzer>(
                new RSharp.Analyzers.Rules.RSharpCoreAnalyzer(),
                new RSharp.Analyzers.Rules.RSharpBclAnalyzer());
        }

        private static void WriteCargoManifest(string outputDirectory, string projectName)
        {
            string name = string.IsNullOrEmpty(projectName) ? "rsharp_app" : projectName;
            var manifest = new List<string>
            {
                "[package]",
                "name = \"" + name + "\"",
                "version = \"0.1.0\"",
                "edition = \"2021\"",
                "",
                "[[bin]]",
                "name = \"" + name + "\"",
                "path = \"main.rs\"",
                "",
                "[profile.release]",
                "opt-level = 3",
                "",
            };

            File.WriteAllText(Path.Combine(outputDirectory, "Cargo.toml"), string.Join("\n", manifest));
        }

        private static void WriteSourceMaps(string outputDirectory, TranspileResult result)
        {
            if (result.SourceMaps.Count == 0)
            {
                return;
            }

            var payload = result.SourceMaps.Select(map => new
            {
                rustFile = map.RustFile,
                rshFile = map.RshFile,
                entries = map.Entries.Select(entry => new { rustLine = entry.RustLine, rshLine = entry.RshLine }).ToArray(),
            }).ToArray();

            File.WriteAllText(
                Path.Combine(outputDirectory, "rsharp.sourcemap.json"),
                JsonSerializer.Serialize(payload, JsonOptions));
        }

        /// <summary>
        /// Escribe el archivo de bloqueo (spec §3 y §9).
        /// </summary>
        /// <remarks>
        /// Guarda el hash de la configuración de <em>sugar</em>: si cambia, los
        /// bloqueos afectados quedan invalidados y la extensión lo avisa.
        /// Se confirma en git, porque es la forma de que dos personas
        /// compilen lo mismo.
        /// </remarks>
        private static void WriteLockFile(string projectRoot, RSharpConfig config)
        {
            string hash = SugarHash.Compute(config.Sugar);
            var lockFile = new
            {
                version = 1,
                sugar = new { hash },
                crates = new Dictionary<string, object>(),
                libraries = new Dictionary<string, object>(),
                ai = new Dictionary<string, object>(),
            };

            File.WriteAllText(
                Path.Combine(projectRoot, "rsharp.lock"),
                JsonSerializer.Serialize(lockFile, JsonOptions) + "\n");
        }

        // -------------------------------------------------------------------
        // Utilidades
        // -------------------------------------------------------------------

        private static object ToJson(RSharpDiagnostic diagnostic)
        {
            return new
            {
                code = diagnostic.Code,
                severity = SeverityToString(diagnostic.Severity),
                message = diagnostic.Message,
                file = diagnostic.File,
                line = diagnostic.Line > 0 ? (int?)diagnostic.Line : null,
                column = diagnostic.Column > 0 ? (int?)diagnostic.Column : null,
                length = diagnostic.Length,
                help = diagnostic.Help,
                source = "R#",
            };
        }

        private static string SeverityToString(RSharpSeverity severity)
        {
            switch (severity)
            {
                case RSharpSeverity.Error: return "error";
                case RSharpSeverity.Warning: return "warning";
                case RSharpSeverity.Info: return "info";
                default: return "hint";
            }
        }

        private static CargoResult RunCargo(IReadOnlyList<string> arguments, string workingDirectory)
        {
            try
            {
                var startInfo = new ProcessStartInfo("cargo")
                {
                    WorkingDirectory = workingDirectory,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                };

                foreach (string argument in arguments)
                {
                    startInfo.ArgumentList.Add(argument);
                }

                using Process? process = Process.Start(startInfo);
                if (process == null)
                {
                    return new CargoResult(127, string.Empty, "No se pudo ejecutar «cargo».");
                }

                string standardOutput = process.StandardOutput.ReadToEnd();
                string standardError = process.StandardError.ReadToEnd();
                process.WaitForExit();
                return new CargoResult(process.ExitCode, standardOutput, standardError);
            }
            catch (Exception error)
            {
                return new CargoResult(127, string.Empty, error.Message);
            }
        }

        private static CargoResult Run(string fileName, IReadOnlyList<string> arguments, string workingDirectory)
        {
            var startInfo = new ProcessStartInfo(fileName)
            {
                WorkingDirectory = workingDirectory,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            };

            foreach (string argument in arguments)
            {
                startInfo.ArgumentList.Add(argument);
            }

            using Process? process = Process.Start(startInfo);
            if (process == null)
            {
                return new CargoResult(127, string.Empty, "No se pudo ejecutar " + fileName);
            }

            string standardOutput = process.StandardOutput.ReadToEnd();
            string standardError = process.StandardError.ReadToEnd();
            process.WaitForExit();
            return new CargoResult(process.ExitCode, standardOutput, standardError);
        }

        private static string ResolveProject(string? project)
        {
            return string.IsNullOrEmpty(project) ? Directory.GetCurrentDirectory() : Path.GetFullPath(project);
        }

        private static int Fail(CliOptions options, string command, string message, string kind, Stopwatch stopwatch)
        {
            var envelope = new
            {
                ok = false,
                command,
                durationMs = stopwatch.ElapsedMilliseconds,
                files = Array.Empty<object>(),
                diagnostics = Array.Empty<object>(),
                sourceMaps = Array.Empty<object>(),
                summary = message,
                error = new { message, kind },
            };

            Emit(options, envelope, false);
            return RSharpExitCode.Failure;
        }

        private static void Emit(CliOptions options, object envelope, bool ok)
        {
            if (options.Json)
            {
                Console.WriteLine(JsonSerializer.Serialize(envelope, JsonOptions));
                return;
            }

            var type = envelope.GetType();
            object? summary = type.GetProperty("summary")?.GetValue(envelope);
            if (summary != null)
            {
                Console.WriteLine(summary);
            }

            if (!ok)
            {
                object? error = type.GetProperty("error")?.GetValue(envelope);
                if (error != null)
                {
                    Console.Error.WriteLine("rsharp: " + error);
                }
            }
        }

        private static CliOptions ParseArguments(string[] args)
        {
            var options = new CliOptions();
            for (int index = 1; index < args.Length; index++)
            {
                string argument = args[index];
                switch (argument)
                {
                    case "--project":
                        options.Project = Next(args, ref index);
                        break;
                    case "--output":
                        options.Output = Next(args, ref index);
                        break;
                    case "--dist":
                        options.Dist = Next(args, ref index);
                        break;
                    case "--profile":
                        options.Profile = Next(args, ref index);
                        break;
                    case "--target":
                        options.Target = Next(args, ref index);
                        break;
                    case "--json":
                        options.Json = true;
                        break;
                    default:
                        break;
                }
            }

            return options;
        }

        private static string? Next(string[] args, ref int index)
        {
            if (index + 1 >= args.Length)
            {
                return null;
            }

            index++;
            return args[index];
        }

        private static void PrintUsage()
        {
            Console.WriteLine("rsharp — compilador de R# (C# -> Rust)");
            Console.WriteLine();
            Console.WriteLine("  rsharp transpile --project <dir> [--output <dir>] [--json]");
            Console.WriteLine("  rsharp build     --project <dir> [--profile debug|release] [--target <t>] [--dist <dir>] [--json]");
            Console.WriteLine("  rsharp run       --project <dir> [--target <t>] [--profile <p>] [--json]");
            Console.WriteLine("  rsharp clean     --project <dir> [--output <dir>] [--dist <dir>] [--json]");
            Console.WriteLine("  rsharp --version");
            Console.WriteLine();
            Console.WriteLine("Destinos: native, wasm32-unknown-unknown, wasm32-wasip1");
        }

        /// <summary>Opciones de la línea de órdenes.</summary>
        private sealed class CliOptions
        {
            public string? Project { get; set; }

            public string? Output { get; set; }

            public string? Dist { get; set; }

            public string? Profile { get; set; }

            public string? Target { get; set; }

            public bool Json { get; set; }
        }

        /// <summary>Resultado de ejecutar un proceso externo.</summary>
        private sealed class CargoResult
        {
            public CargoResult(int exitCode, string standardOutput, string standardError)
            {
                ExitCode = exitCode;
                StandardOutput = standardOutput;
                StandardError = standardError;
            }

            public int ExitCode { get; }

            public string StandardOutput { get; }

            public string StandardError { get; }
        }
    }
}
