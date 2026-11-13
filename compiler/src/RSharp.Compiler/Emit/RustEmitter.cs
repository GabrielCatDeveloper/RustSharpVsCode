using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

using RSharp.Runtime;

namespace RSharp.Compiler.Emit
{
    /// <summary>
    /// Emite Rust a partir de una sintaxis de C# (un fichero <c>.rsh</c>).
    /// </summary>
    /// <remarks>
    /// El emisor trabaja sobre el modelo semántico de Roslyn: los tipos se
    /// resuelven con la información real del programa, no con inferencias
    /// propias. La spec §4.1 dice que el transpilador NO implementa un
    /// verificador de tipos: usa el de Roslyn.
    /// </remarks>
    internal sealed class RustEmitter
    {
        private readonly Compilation _compilation;
        private readonly TranspileOptions _options;
        private readonly RustTypeMapper _types;
        private readonly List<RSharpDiagnostic> _diagnostics;

        /// <summary>Nombre del tipo que contiene el método que se está emitiendo.</summary>
        private ITypeSymbol? _currentType;

        /// <summary>Nombre de la variable que representa <c>this</c>.</summary>
        private string _selfName = "self";

        /// <summary><c>true</c> si el método actual devuelve <c>Result</c>.</summary>
        private bool _currentThrows;

        /// <summary><c>true</c> si se está emitiendo el cuerpo de un <c>try</c>.</summary>
        private bool _inTry;

        /// <summary>Parámetros del lambda que hay que desreferenciar.</summary>
        private HashSet<string>? _dereference;

        public RustEmitter(
            Compilation compilation,
            TranspileOptions options,
            RustTypeMapper types,
            List<RSharpDiagnostic> diagnostics)
        {
            _compilation = compilation;
            _options = options;
            _types = types;
            _diagnostics = diagnostics;
        }

        /// <summary>Emite un fichero completo.</summary>
        public void EmitFile(CompilationUnitSyntax root, RustFileBuilder builder)
        {
            foreach (var member in root.Members)
            {
                if (member is BaseNamespaceDeclarationSyntax namespaceDeclaration)
                {
                    // El espacio de nombres se aplana: sus tipos se emiten en
                    // el módulo. Los tipos de un `namespace` de bloque también.
                    foreach (var inner in namespaceDeclaration.Members)
                    {
                        // `EnumDeclarationSyntax` no deriva de
                        // `TypeDeclarationSyntax`: se usa la base común.
                        if (inner is BaseTypeDeclarationSyntax nested)
                        {
                            EmitType(nested, builder);
                        }
                    }

                    continue;
                }

                if (member is BaseTypeDeclarationSyntax typeDeclaration)
                {
                    EmitType(typeDeclaration, builder);
                }
            }
        }

        // -------------------------------------------------------------------
        // Tipos
        // -------------------------------------------------------------------

        private void EmitType(BaseTypeDeclarationSyntax declaration, RustFileBuilder builder)
        {
            INamedTypeSymbol? symbol = _compilation.GetSemanticModel(declaration.SyntaxTree)
                .GetDeclaredSymbol(declaration);

            if (symbol == null)
            {
                return;
            }

            ITypeSymbol? previousType = _currentType;
            _currentType = symbol;

            try
            {
                if (declaration is EnumDeclarationSyntax enumDeclaration)
                {
                    EmitEnum(enumDeclaration, symbol, builder);
                }
                else if (declaration is InterfaceDeclarationSyntax interfaceDeclaration)
                {
                    EmitInterface(interfaceDeclaration, symbol, builder);
                }
                else if (declaration is StructDeclarationSyntax structDeclaration)
                {
                    EmitClassLike(structDeclaration, symbol, builder);
                }
                else if (declaration is ClassDeclarationSyntax classDeclaration)
                {
                    EmitClassLike(classDeclaration, symbol, builder);
                }
            }
            finally
            {
                _currentType = previousType;
            }
        }

        private void EmitEnum(EnumDeclarationSyntax declaration, INamedTypeSymbol symbol, RustFileBuilder builder)
        {
            var members = new List<string>();
            foreach (var member in declaration.Members)
            {
                var value = member.EqualsValue;
                string literal = value == null
                    ? members.Count.ToString(CultureInfo.InvariantCulture)
                    : value.Value.ToString();

                members.Add(member.Identifier.Text + " = " + literal + ",");
            }

            builder.Write(
                LineOf(declaration),
                "#[repr(i32)] #[derive(PartialEq, Eq, Clone, Copy, Debug)] pub enum " + symbol.Name +
                " { " + string.Join(" ", members) + " }");

            builder.WriteTail("impl " + symbol.Name + " {");
            builder.WriteTail("pub fn as_str(&self) -> &'static str {");
            builder.WriteTail("match self {");
            foreach (var member in declaration.Members)
            {
                builder.WriteTail(symbol.Name + "::" + member.Identifier.Text + " => \"" + member.Identifier.Text + "\",");
            }

            builder.WriteTail("}");
            builder.WriteTail("}");
            builder.WriteTail("}");
            builder.WriteTail("impl std::fmt::Display for " + symbol.Name + " {");
            builder.WriteTail("fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {");
            builder.WriteTail("write!(f, \"{}\", self.as_str())");
            builder.WriteTail("}");
            builder.WriteTail("}");
        }

        private void EmitInterface(InterfaceDeclarationSyntax declaration, INamedTypeSymbol symbol, RustFileBuilder builder)
        {
            SemanticModel model = _compilation.GetSemanticModel(declaration.SyntaxTree);
            var members = new List<string>();
            foreach (var member in declaration.Members)
            {
                var method = member as MethodDeclarationSyntax;
                if (method == null)
                {
                    continue;
                }

                string signature = "fn " + RustNames.SnakeCase(method.Identifier.Text) + "(" +
                                    Parameters(method, includeSelf: true) + ") -> " +
                                    _types.Map(symbolOf(model, method).ReturnType) + ";";
                members.Add(signature);
            }

            builder.Write(
                LineOf(declaration),
                "pub trait " + symbol.Name + " { " + string.Join(" ", members) + " }");
        }

        private void EmitClassLike(TypeDeclarationSyntax declaration, INamedTypeSymbol symbol, RustFileBuilder builder)
        {
            bool isStatic = declaration.Modifiers.Any(SyntaxKind.StaticKeyword);
            var fields = new List<string>();

            foreach (var member in declaration.Members)
            {
                if (member is FieldDeclarationSyntax field)
                {
                    foreach (var variable in field.Declaration.Variables)
                    {
                        // El compilador genera un campo de respaldo para cada
                        // auto-propiedad: no es parte del programa.
                        if (variable.Identifier.Text.StartsWith("<", StringComparison.Ordinal))
                        {
                            continue;
                        }

                        ITypeSymbol? type = _compilation.GetSemanticModel(declaration.SyntaxTree)
                            .GetTypeInfo(field.Declaration.Type).Type;
                        fields.Add(RustNames.SnakeCase(variable.Identifier.Text) + ": " + _types.Map(type));
                    }
                }
                else if (member is PropertyDeclarationSyntax property)
                {
                    ITypeSymbol? type = _compilation.GetSemanticModel(declaration.SyntaxTree)
                        .GetTypeInfo(property.Type).Type;
                    fields.Add(RustNames.SnakeCase(property.Identifier.Text) + ": " + _types.Map(type));
                }
            }

            if (isStatic)
            {
                builder.Write(LineOf(declaration), "pub struct " + symbol.Name + ";");
                builder.Write(LineOf(declaration), "impl " + symbol.Name + " {");
                foreach (var member in declaration.Members)
                {
                    EmitMember(member, symbol, builder, isStatic: true);
                }

                builder.Write(ClosingLine(declaration), "}");
                return;
            }

            builder.Write(
                LineOf(declaration),
                "#[derive(Clone)] pub struct " + symbol.Name + " { " + string.Join(", ", fields) + " }");
            builder.Write(LineOf(declaration), "impl " + symbol.Name + " {");
            foreach (var member in declaration.Members)
            {
                EmitMember(member, symbol, builder, isStatic: false);
            }

            builder.Write(ClosingLine(declaration), "}");

            // `impl Trait for Tipo`: delega en los métodos inherentes.
            foreach (var baseType in declaration.BaseList?.Types ?? Enumerable.Empty<BaseTypeSyntax>())
            {
                ITypeSymbol? baseSymbol = _compilation.GetSemanticModel(declaration.SyntaxTree)
                    .GetTypeInfo(baseType.Type).Type;

                if (!_types.IsProjectInterface(baseSymbol))
                {
                    continue;
                }

                builder.WriteTail("impl " + baseSymbol!.Name + " for " + symbol.Name + " {");
                foreach (var member in baseSymbol!.GetMembers().OfType<IMethodSymbol>())
                {
                    string parameters = string.Join(
                        ", ",
                        member.Parameters.Select(p => RustNames.SnakeCase(p.Name)).ToArray());

                    builder.WriteTail(
                        "fn " + RustNames.SnakeCase(member.Name) + "(&self" +
                        (parameters.Length > 0 ? ", " + parameters : "") + ") -> " +
                        _types.Map(member.ReturnType) + " { " + symbol.Name + "::" +
                        RustNames.SnakeCase(member.Name) + "(self" +
                        (parameters.Length > 0 ? ", " + parameters : "") + ") }");
                }

                builder.WriteTail("}");
            }
        }

        // -------------------------------------------------------------------
        // Miembros
        // -------------------------------------------------------------------

        private void EmitMember(MemberDeclarationSyntax member, INamedTypeSymbol owner, RustFileBuilder builder, bool isStatic)
        {
            var method = member as MethodDeclarationSyntax;
            if (method != null)
            {
                EmitMethod(method, owner, builder, isStatic);
                return;
            }

            var constructor = member as ConstructorDeclarationSyntax;
            if (constructor != null)
            {
                EmitConstructor(constructor, owner, builder);
                return;
            }

            var property = member as PropertyDeclarationSyntax;
            if (property != null)
            {
                ITypeSymbol? type = _compilation.GetSemanticModel(property.SyntaxTree)
                    .GetTypeInfo(property.Type).Type;
                string rustType = _types.Map(type);
                string name = RustNames.SnakeCase(property.Identifier.Text);
                string clone = rustType == "String" ? ".clone()" : string.Empty;

                bool hasGetter = property.AccessorList?.Accessors.Any(a => a.IsKind(SyntaxKind.GetAccessorDeclaration)) == true;
                bool hasSetter = property.AccessorList?.Accessors.Any(a => a.IsKind(SyntaxKind.SetAccessorDeclaration)) == true;

                if (hasGetter)
                {
                    builder.Write(LineOf(property), "pub fn " + name + "(&self) -> " + rustType + " { self." + name + clone + " }");
                }

                if (hasSetter)
                {
                    builder.Write(
                        LineOf(property),
                        "pub fn set_" + name + "(&mut self, value: " + rustType + ") { self." + name + " = value; }");
                }
            }
        }

        private void EmitConstructor(ConstructorDeclarationSyntax constructor, INamedTypeSymbol owner, RustFileBuilder builder)
        {
            string parameters = Parameters(constructor, includeSelf: false);
            builder.Write(LineOf(constructor), "pub fn new(" + parameters + ") -> Self {");

            var defaults = new List<string>();
            foreach (var member in owner.GetMembers())
            {
                if (member is IFieldSymbol field && !field.IsStatic && !field.Name.StartsWith("<", StringComparison.Ordinal))
                {
                    defaults.Add(RustNames.SnakeCase(field.Name) + ": " + DefaultValue(field.Type));
                }
                else if (member is IPropertySymbol property)
                {
                    defaults.Add(RustNames.SnakeCase(property.Name) + ": " + DefaultValue(property.Type));
                }
            }

            builder.Write(
                LineOf(constructor),
                "let mut instance = Self { " + string.Join(", ", defaults) + " };");

            if (constructor.Body != null)
            {
                _currentType = owner;
                string previousSelf = _selfName;
                _selfName = "instance";
                foreach (var statement in constructor.Body.Statements)
                {
                    EmitStatement(statement, builder, owner);
                }

                _selfName = previousSelf;
            }

            builder.Write(ClosingLine(constructor), "instance }");
        }

        private void EmitMethod(MethodDeclarationSyntax method, INamedTypeSymbol owner, RustFileBuilder builder, bool isStatic)
        {
            if (method.AttributeLists.Any(list => list.Attributes.Any(attribute => attribute.Name.ToString().Contains("NoOptimize"))))
            {
                // El atributo solo afecta a las optimizaciones: no cambia el
                // Rust generado en el modo seguro.
            }

            SemanticModel model = _compilation.GetSemanticModel(method.SyntaxTree);
            IMethodSymbol? symbol = model.GetDeclaredSymbol(method);
            if (symbol == null)
            {
                return;
            }

            bool methodIsStatic = isStatic || symbol.IsStatic;
            string name = RustNames.SnakeCase(method.Identifier.Text);
            // El receptor se añade aparte: `Parameters` solo con los argumentos.
            string parameters = Parameters(method, includeSelf: false);
            string receiver = methodIsStatic ? string.Empty : "&self";
            string returns = _types.Map(symbol.ReturnType);

            bool throws = symbol.DeclaringSyntaxReferences
                .Select(reference => reference.GetSyntax())
                .OfType<MethodDeclarationSyntax>()
                .Any(declaration => declaration.DescendantNodes().OfType<ThrowStatementSyntax>().Any());

            _currentThrows = throws;

            builder.Write(
                LineOf(method),
                "pub fn " + name + "(" + (receiver.Length > 0 ? (parameters.Length > 0 ? receiver + ", " + parameters : receiver) : parameters) +
                ") -> " + (throws ? "Result<" + returns + ", String>" : returns) + " {");

            if (method.Body != null)
            {
                _currentType = owner;
                foreach (var statement in method.Body.Statements)
                {
                    EmitStatement(statement, builder, owner);
                }
            }

            builder.Write(ClosingLine(method), "}");
            _currentThrows = false;
        }

        private string Parameters(BaseMethodDeclarationSyntax method, bool includeSelf)
        {
            var parameters = new List<string>();
            if (includeSelf)
            {
                parameters.Add("&self");
            }

            foreach (var parameter in method.ParameterList.Parameters)
            {
                ITypeSymbol? type = _compilation.GetSemanticModel(parameter.SyntaxTree)
                    .GetTypeInfo(parameter.Type).Type;
                parameters.Add(RustNames.SnakeCase(parameter.Identifier.Text) + ": " + _types.Map(type));
            }

            return string.Join(", ", parameters);
        }

        private string DefaultValue(ITypeSymbol? type)
        {
            if (type == null)
            {
                return "String::new()";
            }

            switch (type.SpecialType)
            {
                case SpecialType.System_Int32:
                case SpecialType.System_Int64:
                    return "0";
                case SpecialType.System_Double:
                case SpecialType.System_Single:
                    return "0.0";
                case SpecialType.System_Boolean:
                    return "false";
                case SpecialType.System_String:
                    return "String::new()";
            }

            if (type.TypeKind == TypeKind.Enum)
            {
                var members = type.GetMembers().OfType<IFieldSymbol>().ToList();
                if (members.Count > 0)
                {
                    return type.Name + "::" + members[0].Name;
                }
            }

            if (_types.IsProjectInterface(type))
            {
                return "None";
            }

            return "String::new()";
        }

        // -------------------------------------------------------------------
        // Sentencias
        // -------------------------------------------------------------------

        private void EmitStatement(StatementSyntax statement, RustFileBuilder builder, INamedTypeSymbol owner, string catchVariable)
        {
            switch (statement)
            {
                case ExpressionStatementSyntax expression:
                {
                    string text = EmitExpression(expression.Expression, builder, owner, catchVariable);
                    builder.Write(LineOf(expression), text + ";");
                    return;
                }

                default:
                    EmitStatement(statement, builder, owner);
                    return;
            }
        }

        private void EmitStatement(StatementSyntax statement, RustFileBuilder builder, INamedTypeSymbol owner)
        {
            switch (statement)
            {
                case BlockSyntax block:
                    builder.Write(LineOf(block), "{");
                    foreach (var inner in block.Statements)
                    {
                        EmitStatement(inner, builder, owner);
                    }

                    builder.Write(BodyClosingLine(block), "}");
                    return;

                case LocalDeclarationStatementSyntax local:
                {
                    SemanticModel model = _compilation.GetSemanticModel(local.SyntaxTree);
                    ITypeSymbol? type = model.GetTypeInfo(local.Declaration.Type).Type;
                    string rustType = _types.Map(type);
                    string name = RustNames.SnakeCase(local.Declaration.Variables[0].Identifier.Text);

                    string value = local.Declaration.Variables[0].Initializer == null
                        ? DefaultValue(type)
                        : EmitExpression(local.Declaration.Variables[0].Initializer!.Value, builder, owner, null, type);

                    // `orden[i]` en C# copia la referencia; en Rust hay que
                    // clonar el valor para no moverlo fuera del `Vec`.
                    if (local.Declaration.Variables[0].Initializer?.Value is ElementAccessExpressionSyntax)
                    {
                        value += ".clone()";
                    }

                    builder.Write(LineOf(local), "let mut " + name + ": " + rustType + " = " + value + ";");
                    return;
                }

                case ExpressionStatementSyntax expression:
                {
                    string text = EmitExpression(expression.Expression, builder, owner);
                    builder.Write(LineOf(expression), text + ";");
                    return;
                }

                case IfStatementSyntax ifStatement:
                {
                    string condition = EmitExpression(ifStatement.Condition, builder, owner);
                    builder.Write(LineOf(ifStatement), "if " + condition + " {");
                    EmitStatement(ifStatement.Statement, builder, owner);
                    if (ifStatement.Else != null)
                    {
                        builder.Write(BodyClosingLine(ifStatement.Statement), "} else {");
                        EmitStatement(ifStatement.Else.Statement, builder, owner);
                        builder.Write(BodyClosingLine(ifStatement.Else.Statement), "}");
                        return;
                    }

                    builder.Write(BodyClosingLine(ifStatement.Statement), "}");
                    return;
                }

                case WhileStatementSyntax whileStatement:
                {
                    string condition = EmitExpression(whileStatement.Condition, builder, owner);
                    builder.Write(LineOf(whileStatement), "while " + condition + " {");
                    EmitStatement(whileStatement.Statement, builder, owner);
                    builder.Write(BodyClosingLine(whileStatement.Statement), "}");
                    return;
                }

                case ForStatementSyntax forStatement:
                {
                    EmitFor(forStatement, builder, owner);
                    return;
                }

                case ForEachStatementSyntax forEach:
                {
                    SemanticModel model = _compilation.GetSemanticModel(forEach.SyntaxTree);
                    ITypeSymbol? elementType = model.GetTypeInfo(forEach.Type).Type;
                    string source = EmitExpression(forEach.Expression, builder, owner);
                    string iterator = IterationStrategy(elementType);
                    builder.Write(
                        LineOf(forEach),
                        "for " + RustNames.SnakeCase(forEach.Identifier.Text) + " in " + source + "." + iterator + " {");
                    EmitStatement(forEach.Statement, builder, owner);
                    builder.Write(BodyClosingLine(forEach.Statement), "}");
                    return;
                }

                case ReturnStatementSyntax returnStatement:
                {
                    if (returnStatement.Expression == null)
                    {
                        builder.Write(LineOf(returnStatement), _currentThrows ? "return Ok(());" : "return;");
                        return;
                    }

                    string value = EmitExpression(returnStatement.Expression, builder, owner);
                    builder.Write(LineOf(returnStatement), _currentThrows ? "return Ok(" + value + ");" : "return " + value + ";");
                    return;
                }

                case ThrowStatementSyntax throwStatement:
                {
                    string message = throwStatement.Expression == null
                        ? "\"error\""
                        : EmitExpression(throwStatement.Expression, builder, owner);
                    builder.Write(LineOf(throwStatement), "return Err(format!(\"{}\", " + message + "));");
                    return;
                }

                case BreakStatementSyntax:
                    builder.Write(LineOf(statement), "break;");
                    return;

                case ContinueStatementSyntax:
                    builder.Write(LineOf(statement), "continue;");
                    return;

                case TryStatementSyntax tryStatement:
                {
                    EmitTry(tryStatement, builder, owner);
                    return;
                }

                default:
                    Unsupported(statement, "sentencia");
                    return;
            }
        }

        private void EmitFor(ForStatementSyntax forStatement, RustFileBuilder builder, INamedTypeSymbol owner)
        {
            string variable = string.Empty;
            string rustType = "i32";
            string start = "0";

            if (forStatement.Declaration != null)
            {
                var declarator = forStatement.Declaration.Variables[0];
                SemanticModel model = _compilation.GetSemanticModel(forStatement.SyntaxTree);
                ITypeSymbol? type = model.GetTypeInfo(forStatement.Declaration.Type).Type;
                rustType = _types.Map(type);
                variable = RustNames.SnakeCase(declarator.Identifier.Text);
                start = declarator.Initializer == null
                    ? "0"
                    : EmitExpression(declarator.Initializer.Value, builder, owner);
            }

            string condition = forStatement.Condition == null
                ? "true"
                : EmitExpression(forStatement.Condition, builder, owner);

            string update = string.Empty;
            if (forStatement.Incrementors.Count > 0)
            {
                var increment = forStatement.Incrementors[0];
                if (increment is PostfixUnaryExpressionSyntax postfix &&
                    (postfix.IsKind(SyntaxKind.PostIncrementExpression) || postfix.IsKind(SyntaxKind.PostDecrementExpression)))
                {
                    string operand = EmitExpression(postfix.Operand, builder, owner);
                    update = operand + (postfix.IsKind(SyntaxKind.PostIncrementExpression) ? " += 1" : " -= 1");
                }
                else if (increment is PrefixUnaryExpressionSyntax prefix &&
                         (prefix.IsKind(SyntaxKind.PreIncrementExpression) || prefix.IsKind(SyntaxKind.PreDecrementExpression)))
                {
                    string operand = EmitExpression(prefix.Operand, builder, owner);
                    update = operand + (prefix.IsKind(SyntaxKind.PreIncrementExpression) ? " += 1" : " -= 1");
                }
            }

            // `for (int i = 0; i < n; i++)` se traduce a un bucle de rango.
            string bound = string.Empty;
            if (forStatement.Condition is BinaryExpressionSyntax binary &&
                binary.IsKind(SyntaxKind.LessThanExpression) &&
                binary.Left is IdentifierNameSyntax identifier &&
                identifier.Identifier.Text == variable)
            {
                bound = EmitExpression(binary.Right, builder, owner);
            }

            if (bound.Length > 0)
            {
                builder.Write(LineOf(forStatement), "for " + variable + " in " + start + "..(" + bound + ") {");
            }
            else
            {
                builder.Write(LineOf(forStatement), "let mut " + variable + ": " + rustType + " = " + start + ";");
                builder.Write(LineOf(forStatement), "while " + condition + " {");
            }

            EmitStatement(forStatement.Statement, builder, owner);

            if (bound.Length > 0)
            {
                builder.Write(BodyClosingLine(forStatement.Statement), "}");
            }
            else
            {
                builder.Write(BodyClosingLine(forStatement.Statement), "}" + (update.Length > 0 ? " " + update + ";" : string.Empty));
            }
        }

        private void EmitTry(TryStatementSyntax tryStatement, RustFileBuilder builder, INamedTypeSymbol owner)
        {
            var body = new List<string>();
            var temporary = new RustFileBuilder();
            if (tryStatement.Block != null)
            {
                bool previousInTry = _inTry;
                _inTry = true;
                foreach (var statement in tryStatement.Block.Statements)
                {
                    EmitStatement(statement, temporary, owner);
                }

                _inTry = previousInTry;
            }

            foreach (string line in temporary.Lines)
            {
                if (line.Trim().Length > 0)
                {
                    body.Add(line.Trim());
                }
            }

            var catchBody = new List<string>();
            string catchVariable = "__error";
            if (tryStatement.Catches.Count > 0)
            {
                catchVariable = RustNames.SnakeCase(tryStatement.Catches[0].Declaration!.Identifier.Text);

                var catchTemporary = new RustFileBuilder();
                if (tryStatement.Catches[0].Block != null)
                {
                    foreach (var statement in tryStatement.Catches[0].Block!.Statements)
                    {
                        EmitStatement(statement, catchTemporary, owner, catchVariable);
                    }
                }

                foreach (string line in catchTemporary.Lines)
                {
                    if (line.Trim().Length > 0)
                    {
                        catchBody.Add(line.Trim());
                    }
                }
            }

            builder.Write(
                LineOf(tryStatement),
                "let __result = (|| -> Result<(), String> { " + string.Join(" ", body) + " Ok(()) })(); " +
                "match __result { Ok(_) => {}, Err(__error) => { " + string.Join(" ", catchBody) + " } }");
        }

        private string EmitAssignmentTarget(ExpressionSyntax target, RustFileBuilder builder, INamedTypeSymbol owner, string? catchVariable = null)
        {
            if (target is IdentifierNameSyntax identifier)
            {
                string name = identifier.Identifier.Text;
                if (catchVariable != null && name == catchVariable)
                {
                    return "__error";
                }

                ITypeSymbol? type = _compilation.GetSemanticModel(identifier.SyntaxTree)
                    .GetTypeInfo(identifier).Type;
                if (type != null && _currentType != null)
                {
                    var member = _currentType.GetMembers(name).FirstOrDefault();
                    if (member is IPropertySymbol property)
                    {
                        return _selfName + ".set_" + RustNames.SnakeCase(name) + "(...)";
                    }

                    if (member is IFieldSymbol field)
                    {
                        return _selfName + "." + RustNames.SnakeCase(name);
                    }
                }

                return RustNames.SnakeCase(name);
            }

            return EmitExpression(target, builder, owner);
        }

        private string IterationStrategy(ITypeSymbol? elementType)
        {
            if (elementType == null)
            {
                return "iter()";
            }

            string name = elementType.ToDisplayString();
            switch (name)
            {
                case "System.String":
                    return "iter().cloned()";
                case "System.Int32":
                case "System.Double":
                case "System.Boolean":
                    return "iter().copied()";
            }

            return "iter()";
        }

        // -------------------------------------------------------------------
        // Expresiones
        // -------------------------------------------------------------------

        private string EmitExpression(ExpressionSyntax expression, RustFileBuilder builder, INamedTypeSymbol owner, string? catchVariable = null, ITypeSymbol? expectedType = null)
        {
            switch (expression)
            {
                case LiteralExpressionSyntax literal:
                    return EmitLiteral(literal, expectedType);

                case ParenthesizedExpressionSyntax parenthesized:
                    return EmitExpression(parenthesized.Expression, builder, owner, catchVariable);

                case ThisExpressionSyntax:
                    return _selfName;

                case IdentifierNameSyntax identifier:
                {
                    if (catchVariable != null && identifier.Identifier.Text == catchVariable)
                    {
                        return "__error";
                    }

                    if (_dereference != null && _dereference.Contains(identifier.Identifier.Text))
                    {
                        return "*" + RustNames.SnakeCase(identifier.Identifier.Text);
                    }

                    string name = identifier.Identifier.Text;

                    // Miembro del tipo actual: campo, propiedad o método.
                    if (_currentType != null)
                    {
                        var members = _currentType.GetMembers(name);
                        var property = members.OfType<IPropertySymbol>().FirstOrDefault();
                        if (property != null)
                        {
                            return _selfName + "." + RustNames.SnakeCase(name) + "()";
                        }

                        var field = members.OfType<IFieldSymbol>().FirstOrDefault();
                        if (field != null)
                        {
                            return _selfName + "." + RustNames.SnakeCase(name);
                        }

                        var method = members.OfType<IMethodSymbol>().FirstOrDefault();
                        if (method != null)
                        {
                            return method.IsStatic
                                ? _currentType.Name + "::" + RustNames.SnakeCase(name)
                                : _selfName + "." + RustNames.SnakeCase(name);
                        }
                    }

                    return RustNames.SnakeCase(name);
                }

                case MemberAccessExpressionSyntax memberAccess:
                    return EmitMemberAccess(memberAccess, builder, owner, catchVariable);

                case InvocationExpressionSyntax invocation:
                    return EmitInvocation(invocation, builder, owner, catchVariable);

                case ObjectCreationExpressionSyntax creation:
                    return EmitObjectCreation(creation, builder, owner, expectedType);

                case ElementAccessExpressionSyntax elementAccess:
                {
                    string target = EmitExpression(elementAccess.Expression, builder, owner, catchVariable);
                    string index = elementAccess.ArgumentList.Arguments.Count > 0
                        ? EmitExpression(elementAccess.ArgumentList.Arguments[0].Expression, builder, owner)
                        : "0";
                    return target + "[" + index + "]";
                }

                case BinaryExpressionSyntax binary:
                    return EmitBinary(binary, builder, owner, catchVariable);

                case PrefixUnaryExpressionSyntax prefix:
                {
                    string operand = EmitExpression(prefix.Operand, builder, owner, catchVariable);
                    if (prefix.IsKind(SyntaxKind.UnaryMinusExpression))
                    {
                        return "-" + operand;
                    }

                    if (prefix.IsKind(SyntaxKind.UnaryPlusExpression))
                    {
                        return operand;
                    }

                    return "!" + operand;
                }

                case PostfixUnaryExpressionSyntax postfix:
                {
                    string operand = EmitExpression(postfix.Operand, builder, owner, catchVariable);
                    if (postfix.IsKind(SyntaxKind.PostIncrementExpression))
                    {
                        return operand + " += 1";
                    }

                    return operand + " -= 1";
                }

                case ConditionalExpressionSyntax conditional:
                {
                    string condition = EmitExpression(conditional.Condition, builder, owner, catchVariable);
                    string whenTrue = EmitExpression(conditional.WhenTrue, builder, owner, catchVariable, expectedType);
                    string whenFalse = EmitExpression(conditional.WhenFalse, builder, owner, catchVariable, expectedType);
                    return "if " + condition + " { " + whenTrue + " } else { " + whenFalse + " }";
                }

                case CastExpressionSyntax cast:
                    return EmitExpression(cast.Expression, builder, owner, catchVariable);

                case AssignmentExpressionSyntax assignment:
                {
                    string value = EmitExpression(assignment.Right, builder, owner, catchVariable);

                    // `CultureInfo.CurrentCulture = ...` no tiene equivalente:
                    // en Rust el formato de los números es siempre invariante.
                    if (assignment.Left is MemberAccessExpressionSyntax cultureAccess &&
                        cultureAccess.Expression is IdentifierNameSyntax cultureIdentifier &&
                        cultureIdentifier.Identifier.Text == "CultureInfo")
                    {
                        return "// CultureInfo.CurrentCulture = " + value +
                               "; // en Rust el formato numérico es siempre invariante";
                    }

                    // Asignación a una propiedad: se llama al setter.
                    if (assignment.Left is IdentifierNameSyntax assigned &&
                        _currentType != null &&
                        catchVariable == null)
                    {
                        var property = _currentType.GetMembers(assigned.Identifier.Text)
                            .OfType<IPropertySymbol>()
                            .FirstOrDefault();
                        if (property != null)
                        {
                            return _selfName + ".set_" + RustNames.SnakeCase(assigned.Identifier.Text) + "(" + value + ")";
                        }
                    }

                    string target = EmitAssignmentTarget(assignment.Left, builder, owner, catchVariable);
                    return target + " = " + value;
                }

                case LambdaExpressionSyntax lambda:
                {
                    string[] parameters;
                    string body;
                    if (lambda is SimpleLambdaExpressionSyntax simple)
                    {
                        parameters = new[] { RustNames.SnakeCase(simple.Parameter.Identifier.Text) };
                        body = EmitExpression((ExpressionSyntax)simple.Body, builder, owner, catchVariable);
                    }
                    else if (lambda is ParenthesizedLambdaExpressionSyntax parenthesized)
                    {
                        parameters = parenthesized.ParameterList.Parameters
                            .Select(p => RustNames.SnakeCase(p.Identifier.Text)).ToArray();
                        body = EmitExpression((ExpressionSyntax)parenthesized.Body, builder, owner, catchVariable);
                    }
                    else
                    {
                        Unsupported(lambda, "lambda");
                        parameters = Array.Empty<string>();
                        body = "()";
                    }

                    return "|" + string.Join(", ", parameters) + "| " + body;
                }

                case DefaultExpressionSyntax:
                    return "Default::default()";

                default:
                    Unsupported(expression, "expresión");
                    return "()";
            }
        }

        private string EmitLiteral(LiteralExpressionSyntax literal, ITypeSymbol? expectedType = null)
        {
            switch (literal.Kind())
            {
                case SyntaxKind.StringLiteralExpression:
                {
                    string value = literal.Token.ValueText;
                    string text = "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
                    return expectedType != null && expectedType.SpecialType == SpecialType.System_String
                        ? text + ".to_string()"
                        : text;
                }

                case SyntaxKind.CharacterLiteralExpression:
                    return "'" + literal.Token.ValueText + "'";
                case SyntaxKind.TrueLiteralExpression:
                    return "true";
                case SyntaxKind.FalseLiteralExpression:
                    return "false";
                case SyntaxKind.NullLiteralExpression:
                    return "None";
                case SyntaxKind.NumericLiteralExpression:
                {
                    string text = literal.Token.ValueText;
                    bool isFloat = literal.Token.Value is double || literal.Token.Value is float ||
                                  literal.Token.Value is decimal;
                    if (isFloat && !text.Contains("."))
                    {
                        text += ".0";
                    }

                    return text.Replace("m", string.Empty).Replace("M", string.Empty);
                }

                default:
                    Unsupported(literal, "literal");
                    return "()";
            }
        }

        private string EmitMemberAccess(MemberAccessExpressionSyntax access, RustFileBuilder builder, INamedTypeSymbol owner, string? catchVariable)
        {
            SemanticModel model = _compilation.GetSemanticModel(access.SyntaxTree);
            ISymbol? symbol = model.GetSymbolInfo(access).Symbol;

            // `Console.WriteLine` y compañía.
            if (access.Expression is IdentifierNameSyntax consoleIdentifier &&
                consoleIdentifier.Identifier.Text == "Console")
            {
                if (access.Name.Identifier.Text == "WriteLine")
                {
                    return "__CONSOLE_WRITE_LINE__";
                }

                if (access.Name.Identifier.Text == "Write")
                {
                    return "__CONSOLE_WRITE__";
                }
            }

            // `Math.PI`.
            if (access.Expression is IdentifierNameSyntax mathIdentifier &&
                mathIdentifier.Identifier.Text == "Math" &&
                access.Name.Identifier.Text == "PI")
            {
                return "std::f64::consts::PI";
            }

            // Miembro de una instancia.
            string target = EmitExpression(access.Expression, builder, owner, catchVariable);
            ITypeSymbol? targetType = model.GetTypeInfo(access.Expression).Type;

            // `catch (Exception error)` -> el error es el valor del `Result`.
            if (catchVariable != null &&
                access.Expression is IdentifierNameSyntax catchIdentifier &&
                catchIdentifier.Identifier.Text == catchVariable)
            {
                return "__error";
            }

            // Miembro de un enum: `Status.Pending`. Se comprueba antes que
            // los miembros de instancia: los miembros de un enum son campos.
            if (targetType != null && targetType.TypeKind == TypeKind.Enum)
            {
                return targetType.Name + "::" + access.Name.Identifier.Text;
            }

            // Propiedad `Count` de una colección.
            if (access.Name.Identifier.Text == "Count" && targetType != null &&
                targetType.ToDisplayString().StartsWith("System.Collections.Generic.List", StringComparison.Ordinal))
            {
                return target + ".len()";
            }

            // Propiedad `Length` de una cadena.
            if (access.Name.Identifier.Text == "Length" && targetType != null &&
                targetType.ToDisplayString() == "System.String")
            {
                return target + ".len()";
            }

            // Propiedad de un tipo del proyecto.
            if (targetType != null && _types.IsProjectType(targetType))
            {
                var property = targetType.GetMembers(access.Name.Identifier.Text).OfType<IPropertySymbol>().FirstOrDefault();
                if (property != null)
                {
                    return target + "." + RustNames.SnakeCase(access.Name.Identifier.Text) + "()";
                }

                var field = targetType.GetMembers(access.Name.Identifier.Text).OfType<IFieldSymbol>().FirstOrDefault();
                if (field != null)
                {
                    return target + "." + RustNames.SnakeCase(access.Name.Identifier.Text);
                }
            }

            // Miembro estático de una clase del proyecto: `Utilities.Sum`.
            if (access.Expression is IdentifierNameSyntax staticIdentifier &&
                model.GetSymbolInfo(staticIdentifier).Symbol is INamedTypeSymbol)
            {
                ITypeSymbol? staticType = model.GetTypeInfo(staticIdentifier).Type;
                if (staticType != null && _types.IsProjectType(staticType))
                {
                    var method = staticType.GetMembers(access.Name.Identifier.Text).OfType<IMethodSymbol>().FirstOrDefault();
                    if (method != null)
                    {
                        return staticType.Name + "::" + RustNames.SnakeCase(access.Name.Identifier.Text);
                    }
                }
            }

            if (symbol is IFieldSymbol constant && constant.ContainingType?.ToDisplayString() == "System.Math")
            {
                return "std::f64::consts::PI";
            }

            return target + "." + RustNames.SnakeCase(access.Name.Identifier.Text);
        }

        private string EmitInvocation(InvocationExpressionSyntax invocation, RustFileBuilder builder, INamedTypeSymbol owner, string? catchVariable)
        {
            // `Console.WriteLine(...)` y `Console.Write(...)`.
            if (invocation.Expression is MemberAccessExpressionSyntax access &&
                access.Expression is IdentifierNameSyntax identifier &&
                identifier.Identifier.Text == "Console")
            {
                bool isWrite = access.Name.Identifier.Text == "Write";
                var consoleArguments = invocation.ArgumentList.Arguments
                    .Select(argument => EmitExpression(argument.Expression, builder, owner, catchVariable))
                    .ToArray();

                string macro = isWrite ? "print!" : "println!";
                if (consoleArguments.Length == 0)
                {
                    return macro + "(\"\")";
                }

                if (consoleArguments.Length == 1)
                {
                    return macro + "(\"{}\", " + consoleArguments[0] + ")";
                }

                string placeholders = string.Join(", ", consoleArguments.Select(_ => "{}").ToArray());
                return macro + "(\"" + placeholders + "\", " + string.Join(", ", consoleArguments) + ")";
            }

            // `Math.Sqrt(x)` y compañía.
            if (invocation.Expression is MemberAccessExpressionSyntax mathAccess &&
                mathAccess.Expression is IdentifierNameSyntax mathIdentifier &&
                mathIdentifier.Identifier.Text == "Math")
            {
                var mathArguments = invocation.ArgumentList.Arguments
                    .Select(argument => EmitExpression(argument.Expression, builder, owner, catchVariable))
                    .ToArray();

                string first = mathArguments.Length > 0 ? mathArguments[0] : "0.0";
                string method;
                switch (mathAccess.Name.Identifier.Text)
                {
                    case "Sqrt": method = "sqrt"; break;
                    case "Abs": method = "abs"; break;
                    case "Floor": method = "floor"; break;
                    case "Ceiling": method = "ceil"; break;
                    case "Round": method = "round"; break;
                    case "Min": method = "min"; break;
                    case "Max": method = "max"; break;
                    case "Pow": method = "powf"; break;
                    default:
                        Unsupported(invocation, "Math." + mathAccess.Name.Identifier.Text);
                        return "()";
                }

                string rest = mathArguments.Length > 1
                    ? string.Join(", ", mathArguments.Skip(1).ToArray())
                    : string.Empty;
                return "(" + first + ")." + method + "(" + rest + ")";
            }

            // Métodos de una lista: Add, ToList, Sum, Where, Select.
            if (invocation.Expression is MemberAccessExpressionSyntax listAccess)
            {
                SemanticModel model = _compilation.GetSemanticModel(invocation.SyntaxTree);
                ITypeSymbol? receiverType = model.GetTypeInfo(listAccess.Expression).Type;
                string receiver = EmitExpression(listAccess.Expression, builder, owner, catchVariable);

                if (receiverType != null && receiverType.ToDisplayString().StartsWith("System.Collections.Generic", StringComparison.Ordinal))
                {
                    // Si el receptor es un `Vec` hay que consumirlo como
                    // iterador. Si ya viene de otra llamada de LINQ, la cadena
                    // sigue siendo un iterador y no hay que clonarlo otra vez.
                    bool isVector = receiverType is INamedTypeSymbol listType &&
                        listType.OriginalDefinition.ToDisplayString() == "System.Collections.Generic.List<T>";
                    string chain = isVector ? receiver + ".clone().into_iter()" : receiver;
                    switch (listAccess.Name.Identifier.Text)
                    {
                        case "Add":
                        {
                            string argument = string.Empty;
                            if (invocation.ArgumentList.Arguments.Count > 0)
                            {
                                // El elemento puede ser una interfaz del
                                // proyecto: entonces hay que envolverlo en
                                // `Box<dyn Trait>`.
                                ITypeSymbol? elementType = null;
                                if (receiverType is INamedTypeSymbol namedList &&
                                    namedList.TypeArguments.Length > 0)
                                {
                                    elementType = namedList.TypeArguments[0];
                                }

                                argument = EmitExpression(
                                    invocation.ArgumentList.Arguments[0].Expression,
                                    builder,
                                    owner,
                                    catchVariable,
                                    elementType);
                            }

                            return receiver + ".push(" + argument + ")";
                        }

                        case "ToList":
                            return chain + ".collect::<Vec<_>>()";
                        case "Sum":
                            return chain + ".sum::<f64>()";
                        case "Count":
                            return receiver + ".len()";
                        case "Where":
                        case "Select":
                        {
                            // `filter` recibe el elemento por referencia: si el
                            // elemento es primitivo hay que desreferenciar.
                            var parameters = new HashSet<string>(StringComparer.Ordinal);
                            if (listAccess.Name.Identifier.Text == "Where" &&
                                receiverType is INamedTypeSymbol elementList &&
                                elementList.TypeArguments.Length > 0 &&
                                IsPrimitive(elementList.TypeArguments[0]) &&
                                invocation.ArgumentList.Arguments.Count > 0 &&
                                invocation.ArgumentList.Arguments[0].Expression is SimpleLambdaExpressionSyntax simpleLambda)
                            {
                                parameters.Add(simpleLambda.Parameter.Identifier.Text);
                            }

                            string argument = string.Empty;
                            if (invocation.ArgumentList.Arguments.Count > 0)
                            {
                                HashSet<string>? previous = _dereference;
                                _dereference = parameters;
                                argument = EmitExpression(
                                    invocation.ArgumentList.Arguments[0].Expression,
                                    builder,
                                    owner,
                                    catchVariable);
                                _dereference = previous;
                            }

                            string method = listAccess.Name.Identifier.Text == "Where" ? "filter" : "map";
                            return chain + "." + method + "(" + argument + ")";
                        }
                    }
                }
            }

            // `ToString("F2")` y `ToString()`.
            if (invocation.Expression is MemberAccessExpressionSyntax toStringAccess &&
                toStringAccess.Name.Identifier.Text == "ToString")
            {
                SemanticModel model = _compilation.GetSemanticModel(invocation.SyntaxTree);
                string receiver = EmitExpression(toStringAccess.Expression, builder, owner, catchVariable);
                ITypeSymbol? receiverType = model.GetTypeInfo(toStringAccess.Expression).Type;
                string receiverName = receiverType?.ToDisplayString() ?? string.Empty;

                if (invocation.ArgumentList.Arguments.Count > 0)
                {
                    string format = "F2";
                    var argument = invocation.ArgumentList.Arguments[0].Expression;
                    if (argument is LiteralExpressionSyntax literal)
                    {
                        format = literal.Token.ValueText;
                    }

                    string spec = format == "F1" ? "{:.1}" : format == "F2" ? "{:.2}" : "{}";
                    return "format!(\"" + spec + "\", " + receiver + ")";
                }

                if (receiverName == "System.String")
                {
                    return receiver + ".clone()";
                }

                if (receiverType != null && receiverType.TypeKind == TypeKind.Enum)
                {
                    return receiver + ".as_str()";
                }

                return receiver + ".to_string()";
            }

            // Método normal.
            string target = EmitExpression(invocation.Expression, builder, owner, catchVariable);

            SemanticModel invocationModel = _compilation.GetSemanticModel(invocation.SyntaxTree);
            ISymbol? calledSymbol = invocationModel.GetSymbolInfo(invocation).Symbol;

            // Los tipos de los parámetros: un literal `string` necesita
            // `.to_string()` porque en Rust el `string` es un `String` (propio).
            ITypeSymbol?[] parameterTypes = Array.Empty<ITypeSymbol?>();
            if (calledSymbol is IMethodSymbol calledMethod)
            {
                parameterTypes = calledMethod.Parameters.Select(parameter => parameter.Type).ToArray();
            }

            var arguments = new List<string>();
            for (int index = 0; index < invocation.ArgumentList.Arguments.Count; index++)
            {
                ExpressionSyntax argumentSyntax = invocation.ArgumentList.Arguments[index].Expression;
                string text = EmitExpression(argumentSyntax, builder, owner, catchVariable);

                ITypeSymbol? parameterType = index < parameterTypes.Length ? parameterTypes[index] : null;
                if (parameterType?.SpecialType == SpecialType.System_String &&
                    argumentSyntax is LiteralExpressionSyntax literal && literal.IsKind(SyntaxKind.StringLiteralExpression))
                {
                    text += ".to_string()";
                }

                arguments.Add(text);
            }

            // Un método que lanza excepciones devuelve un `Result`: dentro de
            // un `try` se desenvuelve con `?` (spec §5).
            if (calledSymbol is IMethodSymbol throwingMethod && MethodThrows(throwingMethod))
            {
                string call = target + "(" + string.Join(", ", arguments) + ")";
                return _inTry
                    ? call + "?"
                    : call + ".unwrap_or_else(|__error| panic!(\"{}\", __error))";
            }

            return target + "(" + string.Join(", ", arguments) + ")";
        }

        private string EmitObjectCreation(ObjectCreationExpressionSyntax creation, RustFileBuilder builder, INamedTypeSymbol owner, ITypeSymbol? expectedType = null)
        {
            SemanticModel model = _compilation.GetSemanticModel(creation.SyntaxTree);
            ITypeSymbol? type = model.GetTypeInfo(creation).Type;
            string typeName = type?.Name ?? creation.Type.ToString();

            // Los tipos de los parámetros: un literal `string` necesita
            // `.to_string()` porque en Rust el `string` es un `String` (propio).
            ITypeSymbol?[] parameterTypes = Array.Empty<ITypeSymbol?>();
            if (type is INamedTypeSymbol namedType)
            {
                IMethodSymbol? constructor = namedType.ConstructedFrom.Constructors
                    .FirstOrDefault(candidate => candidate.Parameters.Length == creation.ArgumentList?.Arguments.Count);
                if (constructor != null)
                {
                    parameterTypes = constructor.Parameters.Select(parameter => parameter.Type).ToArray();
                }
            }

            var arguments = new List<string>();
            if (creation.ArgumentList != null)
            {
                for (int index = 0; index < creation.ArgumentList.Arguments.Count; index++)
                {
                    ExpressionSyntax argumentSyntax = creation.ArgumentList.Arguments[index].Expression;
                    string text = EmitExpression(argumentSyntax, builder, owner);

                    ITypeSymbol? parameterType = index < parameterTypes.Length ? parameterTypes[index] : null;
                    if (parameterType?.SpecialType == SpecialType.System_String &&
                        argumentSyntax is LiteralExpressionSyntax literal && literal.IsKind(SyntaxKind.StringLiteralExpression))
                    {
                        text += ".to_string()";
                    }

                    arguments.Add(text);
                }
            }

            // `new Exception("mensaje")`: el mensaje es el error del `Result`.
            if (type?.SpecialType == SpecialType.None && typeName == "Exception")
            {
                return arguments.Count > 0 ? arguments[0] : "\"error\"";
            }

            if (type is INamedTypeSymbol named && named.ConstructedFrom.SpecialType == SpecialType.None &&
                named.ConstructedFrom.ToDisplayString() == "System.Collections.Generic.List<T>")
            {
                return "Vec::<" + _types.Map(named.TypeArguments[0]) + ">::new()";
            }

            string call = typeName + "::new(" + string.Join(", ", arguments) + ")";

            // Si el destino es una interfaz, hay que envolver en `Box<dyn Trait>`:
            // el tipo esperado lo dice el sitio donde se crea el objeto.
            if (expectedType != null && _types.IsProjectInterface(expectedType))
            {
                return "Box::new(" + call + ")";
            }

            if (type != null && _types.IsProjectInterface(type))
            {
                return "Box::new(" + call + ")";
            }

            return call;
        }

        private string EmitBinary(BinaryExpressionSyntax binary, RustFileBuilder builder, INamedTypeSymbol owner, string? catchVariable)
        {
            SemanticModel model = _compilation.GetSemanticModel(binary.SyntaxTree);
            string left = EmitExpression(binary.Left, builder, owner, catchVariable);
            string right = EmitExpression(binary.Right, builder, owner, catchVariable);

            ITypeSymbol? leftType = model.GetTypeInfo(binary.Left).Type;
            ITypeSymbol? rightType = model.GetTypeInfo(binary.Right).Type;

            if (binary.IsKind(SyntaxKind.AddExpression))
            {
                bool leftIsString = leftType?.SpecialType == SpecialType.System_String;
                bool rightIsString = rightType?.SpecialType == SpecialType.System_String;
                if (leftIsString || rightIsString)
                {
                    return "format!(\"{}{}\", " + left + ", " + right + ")";
                }
            }

            if (binary.IsKind(SyntaxKind.DivideExpression))
            {
                bool leftIsDouble = leftType?.SpecialType == SpecialType.System_Double;
                bool rightIsInt = rightType?.SpecialType == SpecialType.System_Int32;
                if (leftIsDouble && rightIsInt)
                {
                    right = "(" + right + ") as f64";
                }
            }

            if (binary.IsKind(SyntaxKind.LogicalAndExpression))
            {
                return "(" + left + " && " + right + ")";
            }

            if (binary.IsKind(SyntaxKind.LogicalOrExpression))
            {
                return "(" + left + " || " + right + ")";
            }

            string op = binary.Kind().ToString().Replace("Expression", string.Empty);
            switch (op)
            {
                case "Equals": return left + " == " + right;
                case "NotEquals": return left + " != " + right;
                case "LessThan": return left + " < " + right;
                case "LessThanOrEqual": return left + " <= " + right;
                case "GreaterThan": return left + " > " + right;
                case "GreaterThanOrEqual": return left + " >= " + right;
                case "Add": return "(" + left + " + " + right + ")";
                case "Subtract": return "(" + left + " - " + right + ")";
                case "Multiply": return "(" + left + " * " + right + ")";
                case "Divide": return "(" + left + " / " + right + ")";
                case "Modulo": return "(" + left + " % " + right + ")";
            }

            return "(" + left + " " + op + " " + right + ")";
        }

        /// <summary>Símbolo declarado de un miembro.</summary>
        private static IMethodSymbol? symbolOf(SemanticModel model, MethodDeclarationSyntax method)
        {
            return model.GetDeclaredSymbol(method);
        }

        /// <summary>Línea de la llave de cierre de un miembro o de un tipo.</summary>
        private static int ClosingLine(SyntaxNode node)
        {
            if (node is TypeDeclarationSyntax type)
            {
                return LineOf(type.CloseBraceToken);
            }

            if (node is MethodDeclarationSyntax method)
            {
                return method.Body is BlockSyntax block ? LineOf(block.CloseBraceToken) : LineOf(method);
            }

            if (node is ConstructorDeclarationSyntax constructor)
            {
                return constructor.Body is BlockSyntax block ? LineOf(block.CloseBraceToken) : LineOf(constructor);
            }

            return LineOf(node);
        }

        /// <summary>Línea de cierre del bloque de un cuerpo.</summary>
        private static int BodyClosingLine(SyntaxNode body)
        {
            return body is BlockSyntax block ? LineOf(block.CloseBraceToken) : LineOf(body);
        }

        /// <summary><c>true</c> si el tipo es un primitivo copiable.</summary>
        private static bool IsPrimitive(ITypeSymbol? type)
        {
            if (type == null)
            {
                return false;
            }

            switch (type.SpecialType)
            {
                case SpecialType.System_Int32:
                case SpecialType.System_Int64:
                case SpecialType.System_Double:
                case SpecialType.System_Single:
                case SpecialType.System_Boolean:
                    return true;
                default:
                    return false;
            }
        }

        /// <summary>
        /// Indica si un método lanza excepciones (y por tanto devuelve un
        /// <c>Result</c>).
        /// </summary>
        private static bool MethodThrows(IMethodSymbol method)
        {
            foreach (SyntaxReference reference in method.DeclaringSyntaxReferences)
            {
                SyntaxNode syntax = reference.GetSyntax();
                if (syntax.DescendantNodes().OfType<ThrowStatementSyntax>().Any())
                {
                    return true;
                }
            }

            return false;
        }

        /// <summary>Línea 1-based de un nodo de sintaxis.</summary>
        private static int LineOf(SyntaxNode node)
        {
            return node.GetLocation().GetLineSpan().StartLinePosition.Line + 1;
        }

        /// <summary>Línea 1-based de un token.</summary>
        private static int LineOf(SyntaxToken token)
        {
            return token.GetLocation().GetLineSpan().StartLinePosition.Line + 1;
        }

        /// <summary>Registra una construcción que el núcleo v1 no soporta.</summary>
        private void Unsupported(SyntaxNode node, string what)
        {
            string text = node.ToString().Split('\n')[0].Trim();
            if (text.Length > 80)
            {
                text = text.Substring(0, 77) + "...";
            }

            _diagnostics.Add(new RSharpDiagnostic(
                "R#0001",
                RSharpSeverity.Error,
                "El núcleo v1 no soporta esta " + what + ": " + text,
                null,
                LineOf(node),
                node.SpanStart + 1,
                0,
                "Consulta la lista de construcciones del núcleo en docs/decisions/0003-core-v1-subset.md."));
        }
    }
}
