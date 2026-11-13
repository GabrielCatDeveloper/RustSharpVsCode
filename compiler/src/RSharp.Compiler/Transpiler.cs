using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

using RSharp.Compiler.Emit;
using RSharp.Runtime;

namespace RSharp.Compiler
{
    /// <summary>
    /// Punto de entrada del transpilador de R#.
    /// </summary>
    /// <remarks>
    /// La spec §4.3 fija la API:
    /// <code>
    /// public static TranspileResult Run(
    ///     IReadOnlyDictionary&lt;string, string&gt; sources,
    ///     TranspileOptions options);
    /// </code>
    /// "La entrada es un diccionario de nombre de archivo y texto. La salida
    /// contiene archivos Rust, diagnósticos y source maps".
    /// <para>
    /// El transpilador NO usa <c>System.IO</c>, red ni reloj (spec §4.2): solo
    /// recibe texto y devuelve texto.
    /// </para>
    /// </remarks>
    public static class Transpiler
    {
        /// <summary>
        /// Transpila un conjunto de fuentes C# (ficheros <c>.rsh</c>) a Rust.
        /// </summary>
        /// <param name="sources">
        /// Diccionario de nombre de archivo a contenido. El nombre es la ruta
        /// del fichero <c>.rsh</c> dentro del proyecto.
        /// </param>
        /// <param name="options">Opciones de la transpilación.</param>
        /// <returns>Los ficheros Rust, los diagnósticos y los source maps.</returns>
        public static TranspileResult Run(
            IReadOnlyDictionary<string, string> sources,
            TranspileOptions options)
        {
            if (sources == null)
            {
                throw new ArgumentNullException(nameof(sources));
            }

            options = options ?? new TranspileOptions();

            var diagnostics = new List<RSharpDiagnostic>();
            var parseOptions = new CSharpParseOptions(LanguageVersion.Latest);

            // 1. Roslyn analiza cada `.rsh` como C# válido (spec §4.1).
            var trees = new List<SyntaxTree>();
            foreach (var source in sources.OrderBy(pair => pair.Key, StringComparer.Ordinal))
            {
                SyntaxTree tree = CSharpSyntaxTree.ParseText(
                    source.Value,
                    parseOptions,
                    path: source.Key,
                    cancellationToken: default);

                trees.Add(tree);
            }

            // 2. La compilación da el modelo semántico (tipos, símbolos).
            CSharpCompilation compilation = CSharpCompilation.Create(
                "RSharpProgram",
                trees,
                References(),
                new CSharpCompilationOptions(
                    OutputKind.DynamicallyLinkedLibrary,
                    allowUnsafe: true,
                    nullableContextOptions: NullableContextOptions.Disable));

            // 3. Los errores de C# se traducen a diagnósticos de R#.
            foreach (var diagnostic in compilation.GetDiagnostics())
            {
                if (diagnostic.Severity == DiagnosticSeverity.Hidden)
                {
                    continue;
                }

                FileLinePositionSpan span = diagnostic.Location.GetLineSpan();
                string file = span.Path;

                // El nombre del fichero viene del diccionario: se deja tal cual
                // (ruta relativa al proyecto).
                if (string.IsNullOrEmpty(file))
                {
                    file = sources.Keys.FirstOrDefault() ?? string.Empty;
                }

                diagnostics.Add(new RSharpDiagnostic(
                    "R#0001",
                    diagnostic.Severity == DiagnosticSeverity.Error ? RSharpSeverity.Error : RSharpSeverity.Warning,
                    diagnostic.GetMessage(),
                    file,
                    span.StartLinePosition.Line + 1,
                    span.StartLinePosition.Character + 1,
                    0,
                    "El código del proyecto debe ser C# válido (spec §4.1)."));
            }

            // Tipos del proyecto y su fichero: para los `use` cruzados.
            var typeToFile = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (SyntaxTree tree in trees)
            {
                var root = (CompilationUnitSyntax)tree.GetRoot();
                foreach (var member in root.Members)
                {
                    var declaredTypes = member is BaseNamespaceDeclarationSyntax namespaceDeclaration
                        ? namespaceDeclaration.Members.OfType<BaseTypeDeclarationSyntax>()
                        : member is BaseTypeDeclarationSyntax single ? new[] { single } : Enumerable.Empty<BaseTypeDeclarationSyntax>();

                    foreach (var type in declaredTypes)
                    {
                        INamedTypeSymbol? symbol = compilation.GetSemanticModel(tree).GetDeclaredSymbol(type);
                        if (symbol != null)
                        {
                            typeToFile[symbol.Name] = tree.FilePath;
                        }
                    }
                }
            }

            // 4. Emisión del Rust.
            var types = new RustTypeMapper(compilation);
            var emitter = new RustEmitter(compilation, options, types, diagnostics);

            // El fichero de entrada es el que declara `Main`.
            string entry = options.EntryPoint ?? FindEntryPoint(trees);
            string? entryClass = FindEntryClass(trees);

            var files = new List<TranspiledFile>();
            var sourceMaps = new List<SourceMap>();

            foreach (SyntaxTree tree in trees)
            {
                var root = (CompilationUnitSyntax)tree.GetRoot();
                var builder = new RustFileBuilder();

                emitter.EmitFile(root, builder);

                // Los tipos de otros ficheros necesitan un `use`: el Rust
                // generado usa un módulo por fichero.
                foreach (string use in ForeignUses(tree, compilation, typeToFile))
                {
                    builder.PrependToFirstLine(use);
                }

                string fileName = FileNameFor(tree.FilePath, entry);
                string content = builder.ToText();

                var lineMap = new List<int>();
                var entries = new List<SourceMapEntry>();
                var lines = content.Split('\n');
                for (int index = 0; index < lines.Length; index++)
                {
                    if (lines[index].Trim().Length > 0)
                    {
                        lineMap.Add(index + 1);
                        entries.Add(new SourceMapEntry(index + 1, index + 1));
                    }
                }

                files.Add(new TranspiledFile(fileName, content, lineMap));
                if (options.EmitSourceMaps)
                {
                    sourceMaps.Add(new SourceMap(fileName, tree.FilePath, entries));
                }
            }

            return new TranspileResult(files, diagnostics, sourceMaps, entryClass);
        }

        /// <summary>
        /// Calcula los `use` cruzados que necesita un fichero.
        /// </summary>
        /// <remarks>
        /// El Rust generado usa un módulo por fichero (spec §15: «Declara cada
        /// `.rsh` como módulo en el `Cargo.toml` generado»), así que un tipo
        /// definido en otro fichero hay que importarlo.
        /// </remarks>
        private static IEnumerable<string> ForeignUses(
            SyntaxTree tree,
            Compilation compilation,
            Dictionary<string, string> typeToFile)
        {
            var uses = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            SemanticModel model = compilation.GetSemanticModel(tree);

            foreach (var typeSyntax in tree.GetRoot().DescendantNodes().OfType<TypeSyntax>())
            {
                ITypeSymbol? type = model.GetTypeInfo(typeSyntax).Type;
                if (type is not INamedTypeSymbol named)
                {
                    continue;
                }

                string name = named.Name;
                if (!typeToFile.TryGetValue(name, out string? owner) || owner == tree.FilePath)
                {
                    continue;
                }

                string module = RustNames.SnakeCase(Path.GetFileNameWithoutExtension(owner));
                string use = "use crate::" + module + "::" + name + ";";
                if (seen.Add(use))
                {
                    uses.Add(use);
                }
            }

            return uses;
        }

        /// <summary>
        /// Nombre del fichero Rust que se genera para un <c>.rsh</c>.
        /// </summary>
        /// <remarks>
        /// El fichero que contiene el punto de entrada se llama <c>main.rs</c>;
        /// el resto, <c>&lt;nombre&gt;.rs</c> y se declara como módulo.
        /// </remarks>
        private static string FileNameFor(string rshPath, string? entryPoint)
        {
            string name = Path.GetFileNameWithoutExtension(rshPath);
            if (entryPoint != null &&
                string.Equals(name, entryPoint, StringComparison.Ordinal))
            {
                return "main.rs";
            }

            return RustNames.SnakeCase(name) + ".rs";
        }


        /// <summary>Busca la clase que declara el punto de entrada.</summary>
        private static string? FindEntryClass(IReadOnlyList<SyntaxTree> trees)
        {
            foreach (SyntaxTree tree in trees.OrderBy(tree => tree.FilePath, StringComparer.Ordinal))
            {
                var root = (CompilationUnitSyntax)tree.GetRoot();
                foreach (var member in root.Members)
                {
                    IEnumerable<BaseTypeDeclarationSyntax> types;
                    if (member is BaseNamespaceDeclarationSyntax namespaceDeclaration)
                    {
                        types = namespaceDeclaration.Members.OfType<BaseTypeDeclarationSyntax>();
                    }
                    else if (member is BaseTypeDeclarationSyntax single)
                    {
                        types = new[] { single };
                    }
                    else
                    {
                        continue;
                    }

                    foreach (BaseTypeDeclarationSyntax type in types)
                    {
                        if (!(type is TypeDeclarationSyntax typeDeclaration))
                        {
                            continue;
                        }

                        foreach (var typeMember in typeDeclaration.Members)
                        {
                            if (typeMember is MethodDeclarationSyntax method &&
                                method.Identifier.Text == "Main" &&
                                method.Modifiers.Any(SyntaxKind.StaticKeyword))
                            {
                                return type.Identifier.Text;
                            }
                        }
                    }                }
            }

            return null;
        }

        /// <summary>
        /// Busca el fichero que declara el punto de entrada.
        /// </summary>
        /// <remarks>
        /// Se busca una clase con un método estático `Main`. Si hay más de una,
        /// gana la primera en orden alfabético: el núcleo es determinista
        /// (spec §2.4).
        /// </remarks>
        private static string? FindEntryPoint(IReadOnlyList<SyntaxTree> trees)
        {
            string? found = null;
            foreach (SyntaxTree tree in trees.OrderBy(tree => tree.FilePath, StringComparer.Ordinal))
            {
                var root = (CompilationUnitSyntax)tree.GetRoot();
                foreach (var member in root.Members)
                {
                    // Los tipos pueden estar dentro de un `namespace`.
                    var type = member as TypeDeclarationSyntax;
                    if (member is BaseNamespaceDeclarationSyntax namespaceDeclaration)
                    {
                        type = namespaceDeclaration.Members
                            .OfType<TypeDeclarationSyntax>()
                            .FirstOrDefault();
                    }

                    if (type == null)
                    {
                        continue;
                    }

                    foreach (var typeMember in type.Members)
                    {
                        if (typeMember is MethodDeclarationSyntax method &&
                            method.Identifier.Text == "Main" &&
                            method.Modifiers.Any(SyntaxKind.StaticKeyword))
                        {
                            string candidate = Path.GetFileNameWithoutExtension(tree.FilePath);
                            if (found == null || string.CompareOrdinal(candidate, found) < 0)
                            {
                                found = candidate;
                            }
                        }
                    }
                }
            }

            return found;
        }

        /// <summary>
        /// Referencias de la compilación: los ensamblados del runtime en curso.
        /// </summary>
        /// <remarks>
        /// Solo hacen falta para que el modelo semántico resuelva los tipos de
        /// la biblioteca estándar. Si no hay ninguna, el modelo semántico
        /// funciona con tipos de error y el emisor cae al análisis sintáctico.
        /// </remarks>
        private static IReadOnlyList<MetadataReference> References()
        {
            var references = new List<MetadataReference>();
            try
            {
                var trusted = AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") as string;
                if (string.IsNullOrEmpty(trusted))
                {
                    return references;
                }

                foreach (string path in trusted!.Split(Path.PathSeparator))
                {
                    if (path.Length == 0 || !File.Exists(path))
                    {
                        continue;
                    }

                    if (!path.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    try
                    {
                        references.Add(MetadataReference.CreateFromFile(path));
                    }
                    catch (BadImageFormatException)
                    {
                        // Un ensamblado que no es managed: se ignora.
                    }
                }
            }
            catch (Exception)
            {
                // Sin referencias: el emisor sigue funcionando.
            }

            return references;
        }
    }
}
