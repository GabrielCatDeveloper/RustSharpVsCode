using System;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace RSharp.Runtime
{
    /// <summary>
    /// El hash de la configuración de <em>sugar</em>.
    /// </summary>
    /// <remarks>
    /// La spec §9 dice que «<c>rsharp.lock</c> guarda el hash de la
    /// configuración de sugar» y que «un cambio de valor invalida los bloqueos
    /// afectados».
    /// <para>
    /// El hash se calcula sobre la forma <b>canónica</b> (claves ordenadas y
    /// sin espacios), de modo que reordenar el <c>rsharp.toml</c> no lo
    /// invalida: solo lo hace cambiar un valor.
    /// </para>
    /// <para>
    /// La extensión calcula exactamente el mismo hash (en
    /// <c>extension/src/lock.ts</c>): los dos tienen que coincidir.
    /// </para>
    /// </remarks>
    public static class SugarHash
    {
        /// <summary>
        /// Calcula el hash del <em>sugar</em> vigente.
        /// </summary>
        /// <param name="sugar">Los valores de <em>sugar</em>.</param>
        /// <returns>El hash, con el prefijo <c>sha256:</c>.</returns>
        public static string Compute(IReadOnlyDictionary<string, string> sugar)
        {
            string canonical = Canonical(sugar);
            byte[] digest;
            using (SHA256 sha = SHA256.Create())
            {
                digest = sha.ComputeHash(Encoding.UTF8.GetBytes(canonical));
            }

            var builder = new StringBuilder("sha256:", 72);
            foreach (byte value in digest)
            {
                builder.Append(value.ToString("x2", CultureInfo.InvariantCulture));
            }

            return builder.ToString();
        }

        /// <summary>
        /// Forma canónica del <em>sugar</em>: las mismas claves, ordenadas y
        /// sin espacios.
        /// </summary>
        private static string Canonical(IReadOnlyDictionary<string, string> sugar)
        {
            string Value(string key)
            {
                return sugar.TryGetValue(key, out string? value) ? value : string.Empty;
            }

            return "{" +
                   "\"cycles\":\"" + Value("cycles") + "\"," +
                   "\"finalizers\":\"" + Value("finalizers") + "\"," +
                   "\"overflow\":\"" + Value("overflow") + "\"," +
                   "\"reentrancy\":\"" + Value("reentrancy") + "\"," +
                   "\"strings\":\"" + Value("strings") + "\"" +
                   "}";
        }
    }
}
