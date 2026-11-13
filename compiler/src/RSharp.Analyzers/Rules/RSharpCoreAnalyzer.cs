using System.Collections.Immutable;
using System.Linq;

using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;

using RSharp.Runtime;

namespace RSharp.Analyzers.Rules
{
    /// <summary>
    /// Rechaza las construcciones que el núcleo v1 de R# no soporta.
    /// </summary>
    /// <remarks>
    /// La spec §17 fija los códigos de diagnóstico:
    /// <list type="bullet">
    /// <item><description><c>R#0042</c>: el código exige un <em>sugar</em> apagado.</description></item>
    /// <item><description><c>R#0101</c>: API no soportada en el destino.</description></item>
    /// <item><description><c>R#0150</c>: destino sin soporte de librerías dinámicas.</description></item>
    /// </list>
    /// La decisión 0003 añade <c>R#0001</c>: construcción fuera del núcleo v1.
    /// </remarks>
    [DiagnosticAnalyzer(LanguageNames.CSharp)]
    public sealed class RSharpCoreAnalyzer : DiagnosticAnalyzer
    {
        /// <summary>ID del diagnóstico: construcción fuera del núcleo v1.</summary>
        public const string NotInCoreId = "R#0001";

        private static readonly DiagnosticDescriptor NotInCore = new DiagnosticDescriptor(
            NotInCoreId,
            "Construcción fuera del núcleo v1",
            "El núcleo v1 de R# no admite «{0}»",
            "RSharp.Núcleo",
            DiagnosticSeverity.Error,
            isEnabledByDefault: true,
            description: "Consulta la lista de construcciones del núcleo en docs/decisions/0003-core-v1-subset.md.");

        /// <inheritdoc />
        public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics
        {
            get { return ImmutableArray.Create(NotInCore); }
        }

        /// <inheritdoc />
        public override void Initialize(AnalysisContext context)
        {
            context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
            context.EnableConcurrentExecution();
            context.RegisterSyntaxNodeAction(AnalyzeDynamic, SyntaxKind.DynamicKeyword);
            context.RegisterSyntaxNodeAction(AnalyzeAwait, SyntaxKind.AwaitExpression);
        }

        /// <summary>
        /// `dynamic` no tiene equivalente en el núcleo v1 (spec §6.1).
        /// </summary>
        private static void AnalyzeDynamic(SyntaxNodeAnalysisContext context)
        {
            var node = (DynamicExpressionSyntax)context.Node;
            context.ReportDiagnostic(Diagnostic.Create(NotInCore, node.GetLocation(), "dynamic"));
        }

        /// <summary>
        /// `await` exige el runtime asíncrono; el núcleo v1 solo lo admite con
        /// `tokio` (spec §5 y §8.1).
        /// </summary>
        private static void AnalyzeAwait(SyntaxNodeAnalysisContext context)
        {
            var node = (AwaitExpressionSyntax)context.Node;
            context.ReportDiagnostic(Diagnostic.Create(NotInCore, node.GetLocation(), "await"));
        }
    }
}
