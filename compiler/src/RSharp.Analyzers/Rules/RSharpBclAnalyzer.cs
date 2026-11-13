using System.Collections.Immutable;
using System.Linq;

using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;

namespace RSharp.Analyzers.Rules
{
    /// <summary>
    /// Rechaza las APIs de la BCL que el destino no soporta.
    /// </summary>
    /// <remarks>
    /// La spec §10 define una lista **cerrada** de tipos de <c>System.*</c>:
    /// lo que no está en la lista se rechaza. El diagnóstico es <c>R#0101</c>.
    /// <para>
    /// El destino se lee de la propiedad de MSBuild <c>RSHARP_TARGET</c>
    /// (o del archivo <c>.editorconfig</c> con
    /// <c>dotnet_diagnostic.RSHARP_TARGET.severity = target</c>). Si no se
    /// indica, se asume <c>native</c>.
    /// </para>
    /// <para>
    /// La lista completa está en <c>docs/decisions/0002-bcl-v1-types.md</c>.
    /// </para>
    /// </remarks>
    [DiagnosticAnalyzer(LanguageNames.CSharp)]
    public sealed class RSharpBclAnalyzer : DiagnosticAnalyzer
    {
        /// <summary>
        /// ID interno del diagnóstico (Roslyn exige un identificador válido; el
        /// código de la spec, «R#0001», se aplica al traducir el resultado).
        /// </summary>
        /// <summary>ID del diagnóstico: API no soportada en el destino.</summary>
        public const string UnsupportedApiId = "RS0101";

        private static readonly DiagnosticDescriptor UnsupportedApi = new DiagnosticDescriptor(
            UnsupportedApiId,
            "API no soportada en este destino",
            "«{0}» no existe en el destino «{1}»",
            "RSharp.BCL",
            DiagnosticSeverity.Error,
            isEnabledByDefault: true,
            description: "La lista de APIs soportadas está en docs/decisions/0002-bcl-v1-types.md.");

        /// <summary>
        /// APIs que no existen en ningún destino.
        /// </summary>
        private static readonly string[] AlwaysUnsupported =
        {
            "System.Reflection.Emit",
            "System.Reflection.Emit.AssemblyBuilder",
            "System.Runtime.Loader.AssemblyLoadContext",
        };

        /// <summary>
        /// APIs que no existen en el destino WebAssembly.
        /// </summary>
        private static readonly string[] UnsupportedInWasm =
        {
            "System.IO.File",
            "System.IO.Directory",
            "System.IO.FileStream",
            "System.Threading.Thread",
        };

        /// <inheritdoc />
        public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics
        {
            get { return ImmutableArray.Create(UnsupportedApi); }
        }

        /// <inheritdoc />
        public override void Initialize(AnalysisContext context)
        {
            context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
            context.EnableConcurrentExecution();
            context.RegisterSyntaxNodeAction(AnalyzeInvocation, SyntaxKind.InvocationExpression);
            context.RegisterSyntaxNodeAction(AnalyzeObjectCreation, SyntaxKind.ObjectCreationExpression);
        }

        /// <summary>Target de la compilación: <c>native</c> o <c>wasm32-*</c>.</summary>
        private static string Target(AnalyzerOptions options)
        {
            return options.AnalyzerConfigOptionsProvider
                .GlobalOptions.TryGetValue("build_property.RSHARP_TARGET", out string? target) &&
                !string.IsNullOrEmpty(target)
                ? target!
                : "native";
        }

        private static void AnalyzeInvocation(SyntaxNodeAnalysisContext context)
        {
            var invocation = (InvocationExpressionSyntax)context.Node;
            string name = FullName(context, invocation.Expression);
            if (name.Length == 0)
            {
                return;
            }

            if (AlwaysUnsupported.Any(unsupported => name.StartsWith(unsupported, System.StringComparison.Ordinal)))
            {
                context.ReportDiagnostic(Diagnostic.Create(UnsupportedApi, invocation.GetLocation(), name, Target(context.Options)));
                return;
            }

            if (Target(context.Options).StartsWith("wasm32", System.StringComparison.Ordinal) &&
                UnsupportedInWasm.Any(unsupported => name.StartsWith(unsupported, System.StringComparison.Ordinal)))
            {
                context.ReportDiagnostic(Diagnostic.Create(UnsupportedApi, invocation.GetLocation(), name, Target(context.Options)));
            }
        }

        private static void AnalyzeObjectCreation(SyntaxNodeAnalysisContext context)
        {
            var creation = (ObjectCreationExpressionSyntax)context.Node;
            string name = FullName(context, creation.Type);
            if (name.Length == 0)
            {
                return;
            }

            if (AlwaysUnsupported.Any(unsupported => name.StartsWith(unsupported, System.StringComparison.Ordinal)))
            {
                context.ReportDiagnostic(Diagnostic.Create(UnsupportedApi, creation.GetLocation(), name, Target(context.Options)));
                return;
            }

            if (Target(context.Options).StartsWith("wasm32", System.StringComparison.Ordinal) &&
                UnsupportedInWasm.Any(unsupported => name.StartsWith(unsupported, System.StringComparison.Ordinal)))
            {
                context.ReportDiagnostic(Diagnostic.Create(UnsupportedApi, creation.GetLocation(), name, Target(context.Options)));
            }
        }

        /// <summary>
        /// Nombre completo del tipo o del método invocado.
        /// </summary>
        private static string FullName(SyntaxNodeAnalysisContext context, ExpressionSyntax expression)
        {
            SemanticModel model = context.SemanticModel;
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
    }
}
