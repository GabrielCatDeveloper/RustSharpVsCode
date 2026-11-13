using System;
using System.Collections.Generic;
using System.Linq;

using Microsoft.CodeAnalysis;

namespace RSharp.Compiler.Emit
{
    /// <summary>
    /// Traduce los tipos de C# a sus equivalentes en Rust.
    /// </summary>
    /// <remarks>
    /// Reglas de la spec §5:
    /// <list type="bullet">
    /// <item><description><c>T?</c> y <c>null</c> &rarr; <c>Option&lt;T&gt;</c>.</description></item>
    /// <item><description><c>List&lt;T&gt;</c> &rarr; <c>Vec&lt;T&gt;</c>.</description></item>
    /// <item><description><c>Dictionary&lt;K,V&gt;</c> &rarr; <c>HashMap&lt;K,V&gt;</c>.</description></item>
    /// <item><description><c>interface</c> &rarr; <c>trait</c>, y su uso como valor &rarr; <c>Box&lt;dyn Trait&gt;</c>.</description></item>
    /// <item><description><c>enum</c> &rarr; <c>enum</c> con <c>#[repr(i32)]</c>.</description></item>
    /// </list>
    /// </remarks>
    internal sealed class RustTypeMapper
    {
        private readonly Compilation _compilation;

        public RustTypeMapper(Compilation compilation)
        {
            _compilation = compilation;
        }

        /// <summary>
        /// Traduce un tipo de C# al tipo de Rust correspondiente.
        /// </summary>
        /// <param name="type">Tipo de C#, o <c>null</c>.</param>
        /// <param name="asValue">
        /// <c>true</c> cuando el tipo se usa como valor: las interfaces del
        /// proyecto se envuelven en <c>Box&lt;dyn Trait&gt;</c>.
        /// </param>
        public string Map(ITypeSymbol? type, bool asValue = true)
        {
            if (type == null)
            {
                return "()";
            }

            if (type is IArrayTypeSymbol array)
            {
                return "Vec<" + Map(array.ElementType) + ">";
            }

            if (type is INamedTypeSymbol named)
            {
                // Tipos especiales: el nombre depende del idioma, así que se
                // usa `SpecialType` en lugar de comparar cadenas.
                switch (named.SpecialType)
                {
                    case SpecialType.System_Int32:
                    case SpecialType.System_Int64:
                    case SpecialType.System_Int16:
                    case SpecialType.System_Byte:
                    case SpecialType.System_UInt32:
                        return "i32";
                    case SpecialType.System_Double:
                    case SpecialType.System_Single:
                    case SpecialType.System_Decimal:
                        return "f64";
                    case SpecialType.System_Boolean:
                        return "bool";
                    case SpecialType.System_String:
                        return "String";
                    case SpecialType.System_Void:
                        return "()";
                    case SpecialType.System_Object:
                        return "String";
                    case SpecialType.System_Char:
                        return "char";
                }

                string definition = named.ConstructedFrom.ToDisplayString();
                string generic = definition;

                if (generic == "System.Collections.Generic.List<T>")
                {
                    return "Vec<" + Map(named.TypeArguments[0]) + ">";
                }

                if (generic == "System.Collections.Generic.Dictionary<TKey, TValue>")
                {
                    return "HashMap<" + Map(named.TypeArguments[0]) + ", " + Map(named.TypeArguments[1]) + ">";
                }

                if (generic == "System.Collections.Generic.HashSet<T>")
                {
                    return "HashSet<" + Map(named.TypeArguments[0]) + ">";
                }

                if (generic == "System.Nullable<T>")
                {
                    return "Option<" + Map(named.TypeArguments[0]) + ">";
                }

                if (named.TypeKind == TypeKind.Interface && IsProjectType(named))
                {
                    // Una interfaz del proyecto, usada como valor: hay que
                    // convertirla en `Box<dyn Trait>` para el despacho dinámico.
                    return asValue ? "Box<dyn " + named.Name + ">" : named.Name;
                }

                if (named.TypeKind == TypeKind.Interface && !IsProjectType(named))
                {
                    // Interfaces externas (IEnumerable<T>, IDisposable…) no
                    // tienen equivalente directo en el núcleo v1.
                    return named.Name;
                }

                return named.Name;
            }

            return "_";
        }

        /// <summary>Devuelve el tipo sin envolver en <c>Box</c>.</summary>
        public string MapBare(ITypeSymbol? type)
        {
            return Map(type, asValue: false);
        }

        /// <summary><c>true</c> si el tipo está definido en el proyecto.</summary>
        public bool IsProjectType(ITypeSymbol type)
        {
            return SymbolEqualityComparer.Default.Equals(type.ContainingAssembly, _compilation.Assembly);
        }

        /// <summary><c>true</c> si el tipo es una interfaz del proyecto.</summary>
        public bool IsProjectInterface(ITypeSymbol? type)
        {
            return type != null && type.TypeKind == TypeKind.Interface && IsProjectType(type);
        }
    }
}
