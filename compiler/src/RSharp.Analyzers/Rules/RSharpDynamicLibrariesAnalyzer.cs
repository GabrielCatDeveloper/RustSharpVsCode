using System.Collections.Immutable;
using System.Linq;

using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;

namespace RSharp.Analyzers.Rules
{
    /// <summary>
    /// Rechaza las librerías dinámicas en el destino WebAssembly.
    /// </summary>
    /// <remarks>
    /// La spec §11 dice: «Las DLL dinámicas no cargan en
    /// <c>wasm32-unknown-unknown</c>» y la §17 fija el código <c>R#0150</c>.
    /// </remarks>
    [DiagnosticAnalyzer(LanguageNames.CSharp)]
    public sealed class RSharpDynamicLibrariesAnalyzer : DiagnosticAnalyzer
    {
        /// <summary>
        /// ID interno del diagnóstico (Roslyn exige un identificador válido; el
        /// código de la spec, «R#0001», se aplica al traducir el resultado).
        /// </summary>
        /// <summary>ID del diagnóstico: el destino no admite librerías dinámicas.</summary>
        public const string NoDynamicLibrariesId = "RS0150";

        private static readonly DiagnosticDescriptor NoDynamicLibraries = new DiagnosticDescriptor(
            NoDynamicLibrariesId,
            "El destino no admite librerías dinámicas",
            "El destino «{0}» no puede cargar la librería «{1}»",
            "RSharp.Enlace",
            DiagnosticSeverity.Error,
            isEnabledByDefault: true,
            description: "En WebAssembly no hay enlace dinámico: usa un destino nativo o enlaza estáticamente.");

        /// <inheritdoc />
        public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics
        {
            get { return ImmutableArray.Create(NoDynamicLibraries); }
        }

        /// <inheritdoc />
        public override void Initialize(AnalysisContext context)
        {
            context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
            context.EnableConcurrentExecution();
            context.RegisterSyntaxNodeAction(AnalyzeAttribute, SyntaxKind.Attribute);
        }

        private static void AnalyzeAttribute(SyntaxNodeAnalysisContext context)
        {
            var attribute = (AttributeSyntax)context.Node;
            string name = attribute.Name.ToString();
            if (!name.EndsWith("DllImport", System.StringComparison.Ordinal) &&
                !name.EndsWith("ForeignAssembly", System.StringComparison.Ordinal))
            {
                return;
            }

            string target = context.Options.AnalyzerConfigOptionsProvider
                .GlobalOptions.TryGetValue("build_property.RSHARP_TARGET", out string? value) &&
                !string.IsNullOrEmpty(value)
                ? value!
                : "native";

            if (!target.StartsWith("wasm32", System.StringComparison.Ordinal))
            {
                return;
            }

            string library = "la biblioteca";
            if (attribute.ArgumentList != null && attribute.ArgumentList.Arguments.Count > 0)
            {
                string argument = attribute.ArgumentList.Arguments[0].Expression.ToString().Trim('"');
                library = "«" + argument + "»";
            }

            context.ReportDiagnostic(Diagnostic.Create(NoDynamicLibraries, attribute.GetLocation(), target, library));
        }
    }
}
