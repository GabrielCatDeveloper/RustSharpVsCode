# BCL de la v1: lista cerrada de tipos y API de `System.*`

> **Documento normativo.** Define la lista cerrada de la biblioteca estándar de
> R# y **resuelve la decisión abierta 2** de `rsharp-spec.md` (§19).
>
> - Especificación: [`../rsharp-spec.md`](../rsharp-spec.md)
> - Subconjunto de lenguaje: [`CORE-SUBSET.md`](./CORE-SUBSET.md)
> - Contrato de la CLI: [`CLI-CONTRACT.md`](./CLI-CONTRACT.md)

---

## 1. Resumen en seis líneas

1. La BCL de la v1 es una **lista cerrada**: lo que no está en este documento, el analizador Roslyn lo rechaza con `R#0101` (spec §10, §17).
2. Cada API se declara **por destino**: el equivalente en Rust nativo y el equivalente en Rust WASM son a veces distintos, y hay API que no existen en WASM (`File.ReadAllText`, spec §10).
3. El destino WASM de referencia es `wasm32-unknown-unknown` (navegador, con `web-sys`). El destino `wasm32-wasip1` (spec §9) se marca aparte cuando la spec no lo decide.
4. Lo que depende de hilos, del sistema de archivos o del entorno **no existe en WASM**: se rechaza, no se degrada en silencio (spec §2.7).
5. Lo que existe pero cambia de semántica (UTF-16, cultura, redondeo, colecciones no ordenadas) queda en la columna «Notas y límites».
6. Este documento **no** define crates de terceros: `rand`, `uuid`, `time`, `chrono` y `tokio` entran como dependencias declaradas en `rsharp.toml` (spec §9) y se enlazan con `rsharp bind` (spec §12).

---

## 2. Principio: la lista es cerrada

- La lista de tipos de `System.*` que R# soporta es **exactamente** la de este documento (spec §10: *«R# soporta una lista cerrada de tipos de `System.*`»*).
- Lo que no está en la lista **NO** se transpila: el analizador Roslyn de `RSharp.Analyzers` (spec §4.2) emite `R#0101` (spec §17) y la transpilación no continúa.
- La lista **crece** con cada versión (spec §10). Ampliarla es un cambio normativo de este documento, no una decisión del compilador.
- La lista no incluye las bibliotecas de terceros ni los crates de Rust: esos entran por el mecanismo de bindings (spec §12) o por FFI (spec §13).
- Excepción: una API de la lista puede faltar en un destino concreto. En ese caso el rechazo es `R#0101` y nombra el destino (spec §10).

> La lista inicial que la spec menciona (spec §10: `List<T>`, `Dictionary<K,V>`, `string`, `Math`, `Console`, `File`) es el **mínimo** histórico. Este documento la amplía y la fija; es la resolución de la decisión abierta 2 (spec §19).

---

## 3. Convenciones

| Convención | Significado |
|---|---|
| **«Rust nativo»** | Destino `native` de `rsharp.toml` (`build.target = "native"`, spec §9). |
| **«Rust WASM»** | Destino `wasm32-unknown-unknown` (navegador, con `web-sys`, spec §10 y §11), salvo que la fila diga otra cosa. |
| **«No soportada»** | La API no existe en ese destino: el analizador emite `R#0101` (spec §10, §17). |
| **«Pendiente»** | La spec no lo decide: queda para una fase posterior (spec §19, §20). No se puede usar en la v1. |
| Crates citados (`rand`, `uuid`, `time`, `chrono`, `tokio`) | **No** son BCL: son dependencias de `rsharp.toml` (spec §9) con bindings generados (spec §12). |
| Citas `§2.3`, `§7 (paso 3)`, `§19 (decisión 2)` | La spec numera los principios de §2 como 1..8, los pasos de §7 como 1..15 y las decisiones abiertas de §19 como 1..8. |

---

## 4. Tablas por categoría

### 4.1 `System.Console`

| API de C# | Rust nativo | Rust WASM | Notas y límites |
|---|---|---|---|
| `Console.WriteLine(string)` | `println!` | `web_sys::console::Console::log_1` vía `web-sys` | Spec §10 lo fija así. Añade salto de línea. |
| `Console.WriteLine()` | `println!("")` | `log_1("")` | Línea vacía. |
| `Console.Write(string)` | `print!` | `log_1` sin salto | En el navegador el salto lo añade el host: el runtime no lo añade. |
| `Console.ReadLine()` | `std::io::stdin().read_line(&mut s)` | **No soportada** | El navegador no tiene entrada estándar. Devuelve `Option<String>` (sección 4.15). |
| `Console.ReadKey()` | **No soportada** | **No soportada** | Exige modo raw de terminal: no hay equivalente en la `std` de Rust. Queda para un binding `[Extern]` (§12). |

### 4.2 `System.Math`

| API de C# | Rust nativo | Rust WASM | Notas y límites |
|---|---|---|---|
| `Math.Abs(int)` / `Math.Abs(double)` | `i32::abs` / `f64::abs` | Igual | Un overload por tipo: el transpilador renombra (spec §5.2). |
| `Math.Min(a, b)` / `Math.Max(a, b)` | `a.min(b)` / `a.max(b)` | Igual | Ambos operandos del mismo tipo; si no, se inserta la conversión `From` (spec §5.2). |
| `Math.Sqrt(double)` | `f64::sqrt` | Igual | |
| `Math.Pow(double, double)` | `f64::powf` | Igual | |
| `Math.Floor(double)` | `f64::floor` | Igual | |
| `Math.Ceiling(double)` | `f64::ceil` | Igual | |
| `Math.Round(double)` | `f64::round_ties_even` | Igual | C# redondea a par; `f64::round` redondea hacia el infinito: hay que usar `round_ties_even` para igualar a .NET (spec §18). |
| `Math.Truncate(double)` | `f64::trunc` | Igual | |
| `Math.Sign(int)` / `Math.Sign(double)` | `i32::signum` / `f64::signum` | Igual | |
| `Math.PI` | `std::f64::consts::PI` | Igual | Constante, no método. |
| `Math.E` | `std::f64::consts::E` | Igual | Constante, no método. |
| `Math.Sin/Cos/Tan(double)` | `f64::sin` / `cos` / `tan` | Igual | Tres sobrecargas del mismo grupo. |
| `Math.Atan2(y, x)` | `f64::atan2` | Igual | |
| `Math.Log(x)` | `f64::ln` | Igual | Logaritmo natural, como en C#. |
| `Math.Log10(x)` | `f64::log10` | Igual | |
| `Math.Exp(x)` | `f64::exp` | Igual | |
| `Math.Clamp(v, min, max)` | `v.clamp(min, max)` | Igual | `clamp` entra en pánico si `min > max`; C# lanza `ArgumentException`. |

### 4.3 `System.String`

El tipo `string` es el equivalente de `String` o `Rc<str>` según el análisis (spec §5). En la v1 el transpilador elige `String` cuando el texto se indexa o se muta, y `&str` en los demás casos.

| API de C# | Rust nativo | Rust WASM | Notas y límites |
|---|---|---|---|
| `string.Length` | `s.encode_utf16().count()` | Igual | C# cuenta unidades de código UTF-16; `s.len()` cuenta bytes y `chars().count()` cuenta escalares: ambos difieren (spec §6.2, §18). |
| `string.Substring(int)` | `s[start..].to_string()` | Igual | Índice fuera de rango: pánico en Rust, `ArgumentOutOfRangeException` en C#. |
| `string.Substring(int, int)` | `s[start..start + len].to_string()` | Igual | Ídem. |
| `string.IndexOf(string)` | `s.find(&needle)` + conversión a UTF-16 | Igual | Rust devuelve un offset en bytes: hay que convertirlo a unidades UTF-16 para igualar a C#. |
| `string.Contains(string)` | `s.contains(&needle)` | Igual | Solo la sobrecarga sin `StringComparison` (sección 5). |
| `string.StartsWith(string)` | `s.starts_with(&prefix)` | Igual | Solo la sobrecarga sin `StringComparison` (sección 5). |
| `string.EndsWith(string)` | `s.ends_with(&suffix)` | Igual | Solo la sobrecarga sin `StringComparison` (sección 5). |
| `string.ToUpper()` | `s.to_uppercase()` | Igual | C# usa la cultura activa; Rust usa el valor por defecto de Unicode. |
| `string.ToLower()` | `s.to_lowercase()` | Igual | Ídem. |
| `string.Replace(string, string)` | `s.replace(&from, &to)` | Igual | Sustituye todas las apariciones. |
| `string.Trim()` | `s.trim()` | Igual | Recorta el conjunto `White_Space` de Unicode, como `char.IsWhiteSpace`. |
| `string.Split(char)` | `s.split(sep).map(str::to_string)` | Igual | `Split(string, StringSplitOptions)` solo admite `None` y `RemoveEmptyEntries` en la v1. |
| `string.Format(string, params object[])` | `format!(<traducido>, args…)` | Igual | El formato compuesto se traduce: `{0}` → `{}` y `{0:F2}` → `{:.2}`. Solo se traducen literales. |
| `string.Concat(...)` | `String::concat` / `format!` | Igual | Sobrecargas de `string` y de `IEnumerable<string>`. |
| `string.Join(string, IEnumerable<string>)` | `v.join(sep)` | Igual | También la sobrecarga genérica `Join<T>`. |
| `string.IsNullOrEmpty(string)` | `s.map_or(true, str::is_empty)` | Igual | Método estático: el argumento puede ser `null`. |
| `$"…"` (interpolación) | `format!(…)` / `write!(…)` | Igual | Los huecos de formato se traducen como en `string.Format`. |
| `string.ToString()` | `s.clone()` | Igual | Idempotente. |

### 4.4 `System.Text.StringBuilder`

| API de C# | Rust nativo | Rust WASM | Notas y límites |
|---|---|---|---|
| `new StringBuilder()` | `String::new()` | Igual | |
| `StringBuilder.Append(string)` | `s.push_str(&value)` | Igual | En C# devuelve `this`; en Rust devuelve `&mut String`. |
| `StringBuilder.AppendLine(string)` | `s.push_str(&value)` + `s.push('\n')` | Igual | El salto es `Environment.NewLine` → `"\n"` (sección 4.12). |
| `StringBuilder.ToString()` | `s.clone()` | Igual | |
| `StringBuilder.Length` | `s.len()` | Igual | Bytes, no unidades UTF-16: difiere de `string.Length` (spec §6.2). |
| `StringBuilder.Clear()` | `s.clear()` | Igual | |

### 4.5 `System.Collections.Generic.List<T>`

Equivalente en Rust: `Vec<T>` (spec §5).

| API de C# | Rust nativo | Rust WASM | Notas y límites |
|---|---|---|---|
| `new List<T>()` | `Vec::<T>::new()` | Igual | |
| `List<T>.Add(T)` | `v.push(x)` | Igual | |
| `List<T>.AddRange(IEnumerable<T>)` | `v.extend(other)` | Igual | |
| `List<T>.Insert(int, T)` | `v.insert(i, x)` | Igual | Índice fuera de rango: pánico en Rust, `ArgumentOutOfRangeException` en C#. |
| `List<T>.Remove(T)` | `v.retain(|e| e != &x)` | Igual | Elimina la primera coincidencia. |
| `List<T>.RemoveAt(int)` | `v.remove(i)` | Igual | |
| `List<T>.RemoveAll(Predicate<T>)` | `v.retain(…)` | Igual | |
| `List<T>.Clear()` | `v.clear()` | Igual | |
| `List<T>.Contains(T)` | `v.contains(&x)` | Igual | |
| `List<T>.IndexOf(T)` | `v.iter().position(|e| e == &x)` | Igual | Devuelve `-1` si no está, como en C#. |
| `List<T>.Count` | `v.len()` | Igual | Propiedad, no método. |
| `List<T>[int]` | `v[i]` | Igual | Índice fuera de rango: pánico en Rust, `ArgumentOutOfRangeException` en C#. |
| `List<T>.ToArray()` | `v.as_slice().to_vec()` | Igual | |
| `List<T>.ForEach(Action<T>)` | `v.iter().for_each(f)` | Igual | |
| `List<T>.Find(Predicate<T>)` | `v.iter().find(…).cloned()` | Igual | Devuelve el valor por defecto si no hay coincidencia, como en C#. |
| `List<T>.Sort()` | `v.sort_by(…)` | Igual | Solo para `T: Ord`. La sobrecarga con `Comparison<T>` propio no está en la v1. |

### 4.6 `System.Collections.Generic.Dictionary<K, V>`

Equivalente en Rust: `HashMap<K, V>` (spec §5). Exige `K: Eq + Hash`.

| API de C# | Rust nativo | Rust WASM | Notas y límites |
|---|---|---|---|
| `new Dictionary<K, V>()` | `HashMap::new()` | Igual | |
| `Dictionary<K, V>.Add(K, V)` | `map.insert(k, v)` | Igual | En C# una clave repetida lanza excepción; Rust sobrescribe: el analizador avisa. |
| `Dictionary<K, V>.TryGetValue(K, out V)` | `map.get(&k).copied()` | Igual | El parámetro `out` pasa a `Option<T>` (spec §5). |
| `Dictionary<K, V>.ContainsKey(K)` | `map.contains_key(&k)` | Igual | |
| `Dictionary<K, V>.Remove(K)` | `map.remove(&k)` | Igual | |
| `Dictionary<K, V>.Clear()` | `map.clear()` | Igual | |
| `Dictionary<K, V>.Count` | `map.len()` | Igual | |
| `Dictionary<K, V>.Keys` | `map.keys().copied().collect()` | Igual | El orden de iteración **no** es el de inserción: el código R# no puede depender de él. |
| `Dictionary<K, V>.Values` | `map.values().cloned().collect()` | Igual | Ídem. |
| `Dictionary<K, V>[K]` | `map[&k]` | Igual | Clave ausente: pánico en Rust, `KeyNotFoundException` en C#. |

### 4.7 `System.Collections.Generic.HashSet<T>`, `Queue<T>` y `Stack<T>`

| API de C# | Rust nativo | Rust WASM | Notas y límites |
|---|---|---|---|
| `new HashSet<T>()` | `HashSet::new()` | Igual | Exige `T: Eq + Hash`. |
| `HashSet<T>.Add(T)` | `set.insert(x)` | Igual | Devuelve `bool` en ambos. |
| `HashSet<T>.Contains(T)` | `set.contains(&x)` | Igual | |
| `HashSet<T>.Remove(T)` | `set.remove(&x)` | Igual | |
| `HashSet<T>.Count` | `set.len()` | Igual | |
| `HashSet<T>.Clear()` | `set.clear()` | Igual | |
| `HashSet<T>.UnionWith/IntersectWith/ExceptWith` | `union` / `intersection` / `difference` | Igual | Tres operaciones del mismo grupo. |
| `new Queue<T>()` | `VecDeque::new()` | Igual | |
| `Queue<T>.Enqueue(T)` | `q.push_back(x)` | Igual | |
| `Queue<T>.Dequeue()` | `q.pop_front()` | Igual | Vacía: `Option<T>` en Rust, `InvalidOperationException` en C#: el transpilador genera el pánico equivalente. |
| `Queue<T>.TryDequeue()` | `q.pop_front()` | Igual | `Option<T>` en ambos. |
| `Queue<T>.Peek()` | `q.front()` | Igual | Vacía: mismo criterio que `Dequeue`. |
| `Queue<T>.Count` | `q.len()` | Igual | |
| `Queue<T>.Clear()` | `q.clear()` | Igual | |
| `new Stack<T>()` | `Vec::new()` | Igual | |
| `Stack<T>.Push(T)` | `s.push(x)` | Igual | |
| `Stack<T>.Pop()` | `s.pop()` | Igual | Vacía: mismo criterio que `Queue<T>.Dequeue`. |
| `Stack<T>.TryPop()` | `s.pop()` | Igual | `Option<T>` en ambos. |
| `Stack<T>.Peek()` | `s.last()` | Igual | Vacía: mismo criterio que `Queue<T>.Dequeue`. |
| `Stack<T>.Count` | `s.len()` | Igual | |
| `Stack<T>.Clear()` | `s.clear()` | Igual | |

### 4.8 Interfaces de colección

Una `interface` de C# es un `trait` de Rust (spec §5).

| Tipo de C# | Rust nativo | Rust WASM | Notas y límites |
|---|---|---|---|
| `IEnumerable<T>` | `trait` con `IntoIterator` | Igual | El cuerpo de un `foreach` se genera como iterador (spec §5, §7 paso 11). |
| `IEnumerator<T>` | `trait` con `next()` | Igual | Equivale a `Iterator`. |
| `ICollection<T>` | `trait` con `len()` y `contains()` | Igual | |
| `IList<T>` | `trait` con `len()`, `Index` e `IndexMut` | Igual | |

### 4.9 `System.Linq`

LINQ se traduce a iteradores (spec §5); las cadenas se fusionan en un solo iterador (spec §7 paso 10). La lista de operadores es **cerrada**: los que no están aquí se rechazan con `R#0101`.

| Operador | Rust nativo | Rust WASM | Notas y límites |
|---|---|---|---|
| `Where` | `iter().filter(f)` | Igual | |
| `Select` | `iter().map(f)` | Igual | |
| `ToList` | `iter().collect::<Vec<_>>()` | Igual | |
| `ToArray` | `iter().collect::<Vec<_>>()` + caja | Igual | |
| `OrderBy` | `iter().sort_by_key(k)` | Igual | Estable, como `List<T>.Sort`. |
| `OrderByDescending` | `iter().sort_by_key(\|e\| Reverse(e.k))` | Igual | Requiere un envoltorio `Reverse` para conservar la estabilidad. |
| `Sum` | `iter().sum()` | Igual | Secuencia vacía: C# lanza `InvalidOperationException`, Rust devuelve `0`: el transpilador debe insertar la comprobación. |
| `Min` | `iter().min()` | Igual | Vacía: C# lanza; Rust devuelve `None`: hay que insertar la comprobación. |
| `Max` | `iter().max()` | Igual | Ídem. |
| `Count` | `iter().count()` | Igual | `List<T>.Count` es `len()` y no itera. |
| `Any` | `iter().any(f)` | Igual | |
| `All` | `iter().all(f)` | Igual | |
| `First` | `iter().next().unwrap_or_else(…)` | Igual | Vacía: C# lanza `InvalidOperationException`: se genera el pánico equivalente. |
| `FirstOrDefault` | `iter().next()` | Igual | En tipos de valor C# devuelve `0`: el transpilador genera `unwrap_or_default()`. En tipos de referencia devuelve `null`: el tipo pasa a `Option<T>`. |
| `Take` | `iter().take(n)` | Igual | |
| `Skip` | `iter().skip(n)` | Igual | |
| `GroupBy` | `iter().fold(HashMap, …)` → `Vec<(K, Vec<T>)>` | Igual | El resultado se ordena por clave para no romper el determinismo (spec §2.4, §2.7). |

### 4.10 `System.IO.File`

| API de C# | Rust nativo | Rust WASM | Notas y límites |
|---|---|---|---|
| `File.ReadAllText(string)` | `std::fs::read_to_string` | **No soportada** | Spec §10 lo fija: *«`File.ReadAllText` → no soportado»* en el navegador. |
| `File.ReadAllLines(string)` | `std::fs::read_to_string` + división en líneas | **No soportada** | El navegador no tiene sistema de archivos. |
| `File.WriteAllText(string, string)` | `std::fs::write` | **No soportada** | Ídem. |
| `File.WriteAllLines(string, IEnumerable<string>)` | `std::fs::write` + unión con `\n` | **No soportada** | Ídem. |
| `File.AppendAllText(string, string)` | `OpenOptions::new().append(true)` | **No soportada** | Ídem. |
| `File.Exists(string)` | `Path::new(p).is_file()` | **No soportada** | Ídem. |
| `File.Delete(string)` | `std::fs::remove_file` | **No soportada** | Ídem. |

> Para el destino `wasm32-wasip1` (spec §9) el sistema de archivos **sí** existe, pero la spec no dice qué hacer con estas API: **pendiente de la fase N**. Hasta entonces, la regla de la v1 es rechazar el uso de `System.IO` en cualquier destino WASM.

### 4.11 `System.IO.Directory`

| API de C# | Rust nativo | Rust WASM | Notas y límites |
|---|---|---|---|
| `Directory.Exists(string)` | `Path::new(p).is_dir()` | **No soportada** | Sin sistema de archivos en el navegador. |
| `Directory.GetFiles(string)` | `std::fs::read_dir` | **No soportada** | Ídem. |
| `Directory.CreateDirectory(string)` | `std::fs::create_dir_all` | **No soportada** | Ídem. |

### 4.12 `System.Environment`

| API de C# | Rust nativo | Rust WASM | Notas y límites |
|---|---|---|---|
| `Environment.NewLine` | `"\n"` | `"\n"` | En Windows, C# da `"\r\n"`: la diferencia está documentada (spec §18). |
| `Environment.Exit(int)` | `std::process::exit(code)` | **No soportada** | El navegador no tiene proceso que termine. |
| `Environment.GetEnvironmentVariable(string)` | `std::env::var(name)` | **No soportada** | WASM no tiene variables de entorno. |

### 4.13 `System.DateTime`, `System.Guid` y `System.Random`

| API de C# | Rust nativo | Rust WASM | Notas y límites |
|---|---|---|---|
| `DateTime.UtcNow` | `std::time::SystemTime::now()` + crate de calendario | `web_sys` → `Date::now()` (epoch ms) | El calendario (`time` o `chrono`) es una dependencia declarada (spec §9, §12). |
| `DateTime.Now` | Hora local del crate de calendario | **Parcial**: solo UTC | El navegador no expone una zona horaria fiable: el transpilador avisa y usa UTC. |
| `DateTime.Parse(string)` | `OffsetDateTime::parse` | Igual | La v1 solo acepta ISO-8601; los formatos de cultura de C# se rechazan con `R#0101`. Entrada inválida: `FormatException`. |
| `DateTime.ToString()` y formatos | **Pendiente** | **Pendiente** | La v1 no reproduce los formatos de cultura: solo salida ISO-8601. |
| `Guid.NewGuid()` | `uuid::Uuid::new_v4()` | Igual (con la característica `js` de `getrandom`) | `uuid` es una dependencia declarada (spec §9, §12). |
| `new Random()` | `rand::rngs::SmallRng` o `ThreadRng` | Igual | `rand` es una dependencia declarada (spec §9, §12); el ejemplo de la spec usa `ThreadRng` (spec §12). |
| `new Random(int seed)` | `rand::rngs::StdRng::seed_from_u64(seed)` | Igual | La secuencia **no** coincide con la de .NET (algoritmo distinto): está permitido (spec §18). |
| `Random.Next(int max)` | `rng.random_range(0..max)` | Igual | |
| `Random.Next(int min, int max)` | `rng.random_range(min..max)` | Igual | `max` es exclusivo, como en C#. |
| `Random.NextDouble()` | `rng.random::<f64>()` | Igual | |

### 4.14 `System.Threading` y `System.Threading.Tasks`

| API de C# | Rust nativo | Rust WASM | Notas y límites |
|---|---|---|---|
| `Thread.Sleep(int)` | `std::thread::sleep` | **Rechazada** | Spec §10 lo fija: *«`Thread.Sleep` → rechazado»* en WASM. |
| `Task` (tarea iniciada) | `tokio::task::JoinHandle<()>` | `wasm_bindgen_futures` | `async`/`await` → `async fn` con `tokio` (spec §5, §8.1); en WASM, `wasm-bindgen-futures` (spec §11). |
| `Task<T>` | `tokio::task::JoinHandle<T>` | Igual | |
| `Task.Run(Action)` | `tokio::spawn` / `std::thread::spawn` | **No soportada** | En WASM se evitan los hilos (spec §11) y `Rc` no cruza hilos (spec §6.2). |
| `Task.Delay(int)` | `tokio::time::sleep` | Igual | |
| `Task.Wait()` | `handle.await` | Igual | |
| `Task.WaitAll(Task[])` | `JoinSet` + `join` | Igual | En WASM solo se pueden unir futures ya iniciados, no hilos. |
| `Task.WhenAll(...)` | `futures::future::join_all` | Igual | |
| `Task.Result` | El valor esperado | Igual | Leerlo antes de terminar: pánico. |

### 4.15 `System.Action`, `System.Func<T>`, `System.Nullable<T>` y `System.ValueTuple`

| Tipo de C# | Rust nativo | Rust WASM | Notas y límites |
|---|---|---|---|
| `Action` | `Box<dyn Fn()>` | Igual | `delegate` y lambda → `Box<dyn Fn>` o `impl Fn` (spec §5). |
| `Action<T>` | `Box<dyn Fn(T)>` | Igual | |
| `Func<TResult>` | `Box<dyn Fn() -> TResult>` | Igual | |
| `Func<T, TResult>` | `Box<dyn Fn(T) -> TResult>` | Igual | |
| `Nullable<T>` / `T?` | `Option<T>` | Igual | `T?`, `null` → `Option<T>` (spec §5). |
| Tuplas `(int, string)` | `(i32, String)` | Igual | `ValueTuple` no tiene tipo propio en Rust: se pierde el nombre de los elementos. |

### 4.16 `System.Exception` y sus derivadas

`try`/`catch` y `throw` se traducen a un `Result` interno, con `panic` en el resto (spec §5); el paso 13 de §7 genera `Result` con `?` cuando todos los `throw` son conocidos.

| API de C# | Rust nativo | Rust WASM | Notas y límites |
|---|---|---|---|
| `Exception` | Tipo de error de `RSharp.Runtime` | Igual | `RSharp.Runtime` es un proyecto de la solución (spec §4.2). |
| `Exception.Message` | Campo `String` | Igual | |
| `Exception.InnerException` | `Option<Box<dyn std::error::Error>>` | Igual | |
| `ArgumentException` (+ `ParamName`) | Variante del tipo de error | Igual | `ParamName` es un campo `Option<String>`. |
| `InvalidOperationException` | Variante del tipo de error | Igual | Es la que lanzan los operadores LINQ sobre secuencias vacías (sección 4.9). |
| `NotSupportedException` | Variante del tipo de error | Igual | |

---

## 5. APIs explícitamente excluidas

Ninguna de estas API se transpila en la v1. El analizador emite `R#0101` (sección 6).

| API o tipo excluido | Motivo | Spec |
|---|---|---|
| `System.Reflection` (completo) | *«Reflection completa sin tablas generadas»* es imposible en Rust. Solo se admite dentro de un bloque `#codeGenAI` (spec §8.3). | §6.1, §8.3 |
| `System.Reflection.Emit` | *«`Reflection.Emit` y `Assembly.Load`»* son imposibles en Rust. | §6.1 |
| `System.Reflection.Assembly.Load` | Ídem. | §6.1 |
| `dynamic` nativo | *«`dynamic` nativo»* es imposible en Rust. | §6.1 |
| `System.Threading.Thread` (creación) y `Task.Run` en WASM | *«`Rc` no cruza hilos»* y en WASM *«Hilos: evítalos en la v1»*. | §6.2, §11 |
| `System.Net.*` (`HttpClient`, `Socket`, …) | *«Todo es local. No hay servicios de red obligatorios»*. | §2.8 |
| `System.IO.Stream`, `FileStream`, `StreamReader`, `StreamWriter` | Solo entran las API estáticas de `File` y `Directory` (secciones 4.10 y 4.11). | §10 |
| `System.Text.RegularExpressions` | No está en la lista: requeriría un binding de `regex` (spec §12). | §10, §12 |
| `System.Globalization.CultureInfo` | No está en la lista: Rust formatea siempre con la cultura invariante. El ejemplo `examples/rsharp-demo` la usa solo para forzar la cultura invariante de .NET; el mini-transpilador descarta esa asignación. | §18, §10 |
| `System.Array` (helpers estáticos), `System.Collections.Concurrent.*`, `SortedDictionary`, `SortedSet` | No están en la lista. | §10 |
| `System.Environment.CurrentDirectory`, `OSVersion`, `ProcessorCount` | No están en la lista: solo `NewLine`, `Exit` y `GetEnvironmentVariable` (sección 4.12). | §10 |
| `System.Guid.Parse`, `Guid.ToString("N")` | Solo `Guid.NewGuid()` está en la lista (sección 4.13). | §10 |
| `System.DateTimeOffset`, `TimeSpan`, formatos de cultura de `DateTime` | No están en la lista (sección 4.13). | §10 |
| `System.Security.Cryptography.*` | No están en la lista: se usa el crate `rand` declarado como dependencia. | §9, §12 |
| `Console.SetIn`, `SetOut`, `RedirectStandardOutput` | El Rust generado no tiene redirección de la consola. | §10 |
| `Console.ReadKey` | Exige modo raw de terminal: no hay equivalente en la `std` (sección 4.1). | §10 |
| Sobrecargas con `StringComparison` o `StringComparer` | Solo las sobrecargas sin cultura de `string` (sección 4.3). | §10 |
| Operadores de LINQ fuera de la lista de la sección 4.9 | La lista de operadores es cerrada (spec §5). | §10 |
| Boxing (`object` con un tipo de valor dentro) | Rust no tiene boxing: `object` se traduce por `Any`/`Display` (spec §5, §6.3). | §6.3 |

---

## 6. Cómo se rechaza

- **Quién rechaza.** El analizador Roslyn del proyecto `RSharp.Analyzers` (spec §4.2), sobre el modelo semántico que da Roslyn (spec §4.1). El transpilador no implementa un verificador de tipos propio (spec §4.1).
- **Código.** `R#0101` — *«API no soportada en el destino»* (spec §17).
- **Dónde apunta.** A la línea del `.rsh`, nunca a la del Rust generado (spec §17).
- **Mensaje.** El formato literal es `R#0101: <API> no existe en <destino>` (spec §10). Si la API no está en la lista de la v1, se añade el motivo: `R#0101: <API> no está en la BCL de la v1 (docs/BCL-V1.md §<sección>)`.
- **Ayuda.** Cada diagnóstico indica la directiva o el ajuste necesario (spec §17): segunda línea `Ayuda: …`.

| Situación | Mensaje | Ayuda obligatoria |
|---|---|---|
| API de la lista, pero no en el destino | `R#0101: File.ReadAllText no existe en wasm32-unknown-unknown` | `Ayuda: cambia build.target a "native" en rsharp.toml (§9) o expón la lectura con un binding [Extern] (§12).` |
| API de la lista, pero no en el destino (hilos) | `R#0101: Thread.Sleep no existe en wasm32-unknown-unknown` | `Ayuda: en WASM no hay hilos (§11); usa Task.Delay (BCL-V1 §4.14).` |
| API fuera de la lista | `R#0101: Console.ReadKey no está en la BCL de la v1 (docs/BCL-V1.md §4.1)` | `Ayuda: la lista de la BCL es cerrada (§10); usa un binding [Extern] si el crate lo permite (§12).` |
| Tipo fuera de la lista | `R#0101: System.Net.Http.HttpClient no está en la BCL de la v1 (docs/BCL-V1.md §5)` | `Ayuda: R# no usa red (§2.8).` |
| Formato no soportado por una API de la lista | `R#0101: DateTime.Parse no acepta el formato "dd/MM/yyyy" (BCL-V1 §4.13)` | `Ayuda: usa el formato ISO-8601.` |
| Operador de LINQ fuera de la lista | `R#0101: System.Linq.Enumerable.Distinct no está en la BCL de la v1 (BCL-V1 §4.9)` | `Ayuda: los operadores de LINQ de la v1 son los de BCL-V1 §4.9.` |

> La lista de la v1 es la referencia normativa: cuando el texto de esta tabla y el código del analizador discrepen, **manda esta tabla** y el analizador debe corregirse.

---

## 7. Reglas transversales

1. **Cadenas.** `string` es `String` o `Rc<str>` según el análisis (spec §5). Los literales se traducen con la cultura invariante (spec §18).
2. **Enteros.** `int` → `i32`, `long` → `i64`, `short` → `i16`, `byte` → `u8`, `bool` → `bool`, `double` → `f64`, `float` → `f32`. `decimal` **no** está en la lista: se rechaza.
3. **Colecciones.** `List<T>` → `Vec<T>`, `Dictionary<K,V>` → `HashMap<K,V>` (spec §5). `Queue<T>` → `VecDeque<T>` y `Stack<T>` → `Vec<T>`.
4. **Nulos.** `null` y `T?` → `Option<T>` (spec §5). `string` nulo es `Option<String>`.
5. **Excepciones.** `throw` → `Err` del `Result` interno cuando todos los `throw` son conocidos; `panic` en el resto (spec §5, §7 paso 13).
6. **Concurrencia.** `Arc<Mutex<T>>` en modo seguro; los hilos no cruzan un `Rc` (spec §5, §6.2).
7. **Sin metadatos.** Esta lista no incluye metadatos de ejecución: no hay `Type` en tiempo de ejecución, ni atributos de .NET, ni serialización (spec §6.1).
8. **Ampliación.** Añadir una API obliga a: (a) añadir su fila aquí, (b) añadir su equivalente en WASM o marcarlo como no soportado, (c) añadir el caso al analizador, (d) añadir una prueba diferencial frente a .NET (spec §4.1).

---

## 8. Cómo se usa este documento

`RSharp.Analyzers` lo usa como **tabla de consulta**: cada API de `System.*` que aparece en un `.rsh` se busca en las tablas de la sección 4 y, si no está, se emite `R#0101` con el mensaje de la sección 6. El compilador lo usa como **contrato de equivalencias**: la columna «Rust nativo» y la columna «Rust WASM» son lo que el generador debe producir.
