using System;

namespace RSharp.Attributes
{
    /// <summary>
    /// Marca un tipo o un método como parte de la API pública de R#.
    /// </summary>
    /// <remarks>
    /// La spec §15 dice: «Un <c>.rs</c> PUEDE llamar a un tipo <c>.rsh</c>
    /// marcado con <c>[Export]</c>». El tipo exportado es un
    /// <c>Rc&lt;RefCell&lt;T&gt;&gt;</c> (spec §5).
    /// </remarks>
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct | AttributeTargets.Method)]
    public sealed class ExportAttribute : Attribute
    {
    }

    /// <summary>
    /// Declara el enlace con un item de Rust o de una biblioteca externa.
    /// </summary>
    /// <remarks>
    /// Ejemplo: <c>[Extern("rand::rngs::ThreadRng::new")]</c>. La spec §12
    /// obliga a que el crate con <c>unsafe</c> o FFI se rechace salvo que el
    /// bloque sea <c>unsafe</c> explícito.
    /// </remarks>
    [AttributeUsage(AttributeTargets.Method | AttributeTargets.Class | AttributeTargets.Struct)]
    public sealed class ExternAttribute : Attribute
    {
        public ExternAttribute(string path)
        {
            Path = path ?? throw new ArgumentNullException(nameof(path));
        }

        /// <summary>Ruta del item enlazado, por ejemplo <c>crate::item</c>.</summary>
        public string Path { get; }
    }

    /// <summary>
    /// Marca una función como visible desde JavaScript en el destino WASM.
    /// </summary>
    /// <remarks>Spec §11: el transpilador genera <c>#[wasm_bindgen]</c>.</remarks>
    [AttributeUsage(AttributeTargets.Method)]
    public sealed class WasmExportAttribute : Attribute
    {
    }

    /// <summary>
    /// Marca un campo como referencia débil, para romper ciclos.
    /// </summary>
    /// <remarks>
    /// Solo puede aplicarse a campos de tipo referencia y anulables. Exige el
    /// <em>sugar</em> <c>cycles = "weak-attribute"</c> (spec §8.2).
    /// Decisión 0004.
    /// </remarks>
    [AttributeUsage(AttributeTargets.Field)]
    public sealed class WeakAttribute : Attribute
    {
    }

    /// <summary>
    /// Marca un parámetro o un retorno como prestado: se pasa por referencia.
    /// </summary>
    /// <remarks>Spec §12 y §13. Decisión 0004.</remarks>
    [AttributeUsage(AttributeTargets.Parameter | AttributeTargets.ReturnValue)]
    public sealed class BorrowedAttribute : Attribute
    {
    }

    /// <summary>
    /// Marca un parámetro o un retorno como propio: se pasa por valor y se
    /// libera con <c>Drop</c>.
    /// </summary>
    /// <remarks>Spec §13: «Copia los <c>string</c> al cruzar. Libera con <c>Drop</c>». Decisión 0004.</remarks>
    [AttributeUsage(AttributeTargets.Parameter | AttributeTargets.ReturnValue)]
    public sealed class OwnedAttribute : Attribute
    {
    }

    /// <summary>
    /// Marca un método para que el optimizador de programa completo no lo toque.
    /// </summary>
    /// <remarks>Spec §7: «<c>[NoOptimize]</c> desactiva pasos en un método».</remarks>
    [AttributeUsage(AttributeTargets.Method | AttributeTargets.Constructor)]
    public sealed class NoOptimizeAttribute : Attribute
    {
    }

    /// <summary>
    /// Declara una vinculación con una biblioteca nativa (C o C++).
    /// </summary>
    /// <remarks>Equivalente a <c>[DllImport]</c> de C#. Spec §13.</remarks>
    [AttributeUsage(AttributeTargets.Method)]
    public sealed class DllImportAttribute : Attribute
    {
        public DllImportAttribute(string library)
        {
            Library = library ?? throw new ArgumentNullException(nameof(library));
        }

        /// <summary>Nombre de la biblioteca.</summary>
        public string Library { get; }

        /// <summary>Nombre del punto de entrada; si falta, se usa el del método.</summary>
        public string? EntryPoint { get; set; }

        /// <summary>Forma de enlace: <c>static</c>, <c>dynamic</c> o <c>auto</c>.</summary>
        public string Link { get; set; } = "auto";
    }

    /// <summary>
    /// Declara una vinculación con un ensamblado de .NET.
    /// </summary>
    /// <remarks>Spec §13: «DLL de .NET &rarr; <c>netcorehost</c>».</remarks>
    [AttributeUsage(AttributeTargets.Assembly | AttributeTargets.Method | AttributeTargets.Class)]
    public sealed class ForeignAssemblyAttribute : Attribute
    {
        public ForeignAssemblyAttribute(string name)
        {
            Name = name ?? throw new ArgumentNullException(nameof(name));
        }

        /// <summary>Nombre del ensamblado.</summary>
        public string Name { get; }
    }

    /// <summary>
    /// Declara una vinculación con un módulo de Python.
    /// </summary>
    /// <remarks>Rechazado en la v1 (spec §11 y §13): <c>R#0150</c>.</remarks>
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct)]
    public sealed class PythonModuleAttribute : Attribute
    {
        public PythonModuleAttribute(string name)
        {
            Name = name ?? throw new ArgumentNullException(nameof(name));
        }

        /// <summary>Nombre del módulo.</summary>
        public string Name { get; }
    }

    /// <summary>
    /// Declara una vinculación con una clase de Java.
    /// </summary>
    /// <remarks>Fuera de la v1: se usaría el crate <c>jni</c> (spec §13).</remarks>
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Struct)]
    public sealed class JavaClassAttribute : Attribute
    {
        public JavaClassAttribute(string name)
        {
            Name = name ?? throw new ArgumentNullException(nameof(name));
        }

        /// <summary>Nombre de la clase.</summary>
        public string Name { get; }
    }

    /// <summary>
    /// Marca un método como equivalente a una macro de Rust.
    /// </summary>
    /// <remarks>Spec §12: «macros &rarr; método con <c>[RustMacro]</c>».</remarks>
    [AttributeUsage(AttributeTargets.Method)]
    public sealed class RustMacroAttribute : Attribute
    {
        public RustMacroAttribute(string path)
        {
            Path = path ?? throw new ArgumentNullException(nameof(path));
        }

        /// <summary>Ruta de la macro.</summary>
        public string Path { get; }
    }

    /// <summary>
    /// Sobrescribe un valor de <em>sugar</em> en el ámbito del atributo.
    /// </summary>
    /// <remarks>
    /// Spec §9: «Se sobrescribe por archivo con
    /// <c>[assembly: RSharpSugar("overflow", "wrap")]</c>. Se sobrescribe por
    /// método con el mismo atributo. Gana el ámbito más cercano al código».
    /// </remarks>
    [AttributeUsage(
        AttributeTargets.Assembly |
        AttributeTargets.Class |
        AttributeTargets.Struct |
        AttributeTargets.Method |
        AttributeTargets.Constructor)]
    public sealed class RSharpSugarAttribute : Attribute
    {
        public RSharpSugarAttribute(string key, string value)
        {
            Key = key ?? throw new ArgumentNullException(nameof(key));
            Value = value ?? throw new ArgumentNullException(nameof(value));
        }

        /// <summary>Clave del ajuste: <c>strings</c>, <c>overflow</c>, <c>reentrancy</c>, <c>finalizers</c> o <c>cycles</c>.</summary>
        public string Key { get; }

        /// <summary>Valor del ajuste.</summary>
        public string Value { get; }
    }
}
