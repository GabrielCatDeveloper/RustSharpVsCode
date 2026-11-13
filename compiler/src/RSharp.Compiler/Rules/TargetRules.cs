using System.Collections.Generic;
using System.Linq;

using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

using RSharp.Runtime;

namespace RSharp.Compiler.Rules
{
    /// <summary>
    /// Reglas que dependen del destino de compilación.
    /// </summary>
    /// <remarks>
    /// El compilador conoce el destino (viene en <see cref="TranspileOptions"/>),
    /// así que las comprueba aquí. Los analizadores de
    /// <c>RSharp.Analyzers</c> hacen lo mismo desde el IDE, leyendo el destino
    /// de la configuración de MSBuild.
    /// <para>
    /// Spec §10: la BCL es una lista cerrada y lo que no está se rechaza con
    /// <c>R#0101</c>. Spec §11 y §17: en WebAssembly no hay enlace dinámico,
    /// y se avisa con <c>R#0150</c>.
    /// </para>
    /// </remarks>
    public static class TargetRules
    {
        /// <summary>APIs que no existen en el destino WebAssembly.</summary>
        private static readonly string[] UnsupportedInWasm =
        {
            "System.IO.File",
            "System.IO.Directory",
            "System.IO.FileStream",
            "System.Threading.Thread",
        };

        /// <summary>
        /// Aplica las reglas del destino a los árboles de sintaxis.
        /// </summary>
        /// <param name="trees">Los árboles analizados.</param>
        /// <param name="compilation">La compilación, para resolver los símbolos.</param>
        /// <param name="options">Las opciones, con el destino.</param>
        /// <param name="diagnostics">Dónde se añaden los diagnósticos.</param>
        public static void Apply(
            IReadOnlyList<SyntaxTree> trees,
            Compilation compilation,
            TranspileOptions options,
            List<RSharpDiagnostic> diagnostics)
        {
            bool isWasm = options.Target.StartsWith("wasm32", System.StringComparison.Ordinal);

            foreach (SyntaxTree tree in trees)
            {
                SemanticModel model = compilation.GetSemanticModel(tree);
                SyntaxNode root = tree.GetRoot();

                // `File.ReadAllText` y compañía no existen en WebAssembly.
                if (isWasm)
                {
                    foreach (var invocation in root.DescendantNodes().OfType<InvocationExpressionSyntax>())
                    {
                        string name = ContainingType(model, invocation.Expression);
                        if (name.Length == 0)
                        {
                            continue;
                        }

                        if (UnsupportedInWasm.Any(item => name.StartsWith(item, System.StringComparison.Ordinal)))
                        {
                            diagnostics.Add(new RSharpDiagnostic(
                                "R#0101",
                                RSharpSeverity.Error,
                                name + " no existe en el destino \"" + options.Target + "\".",
                                tree.FilePath,
                                LineOf(invocation),
                                ColumnOf(invocation),
                                0,
                                "La lista de APIs por destino está en docs/decisions/0002-bcl-v1-types.md."));
                        }
                    }
                }

                // El enlace dinámico no existe en WebAssembly.
                if (isWasm)
                {
                    foreach (var attribute in root.DescendantNodes().OfType<AttributeSyntax>())
                    {
                        string name = attribute.Name.ToString();
                        if (!name.EndsWith("DllImport", System.StringComparison.Ordinal) &&
                            !name.EndsWith("ForeignAssembly", System.StringComparison.Ordinal))
                        {
                            continue;
                        }

                        diagnostics.Add(new RSharpDiagnostic(
                            "R#0150",
                            RSharpSeverity.Error,
                            "El destino \"" + options.Target + "\" no admite librerías dinámicas.",
                            tree.FilePath,
                            LineOf(attribute),
                            ColumnOf(attribute),
                            0,
                            "Compila para un destino nativo, o enlaza la biblioteca estáticamente."));
                    }
                }
            }
        }

        /// <summary>Tipo que contiene el símbolo invocado.</summary>
        private static string ContainingType(SemanticModel model, ExpressionSyntax expression)
        {
            ISymbol? symbol = model.GetSymbolInfo(expression).Symbol;
            if (symbol is IMethodSymbol method)
            {
                return method.ContainingType?.ToDisplayString() ?? string.Empty;
            }

            if (symbol is INamedTypeSymbol type)
            {
                return type.ToDisplayString();
            }

            return string.Empty;
        }

        private static int LineOf(SyntaxNode node)
        {
            return node.GetLocation().GetLineSpan().StartLinePosition.Line + 1;
        }

        private static int ColumnOf(SyntaxNode node)
        {
            return node.GetLocation().GetLineSpan().StartLinePosition.Character + 1;
        }
    }
}
