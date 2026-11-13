using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Demo;

public class Program
{
    public static void Main(string[] args)
    {
        // Rust formatea los números siempre con la cultura invariante
        // (punto decimal). En .NET hay que pedirlo explícitamente para que
        // las dos salidas coincidan.
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

        Console.WriteLine("=== R# demo ===");

        List<IShape> shapes = new List<IShape>();
        shapes.Add(new Circle(1.5));
        shapes.Add(new Square(2.0));
        shapes.Add(new Rect(3.0, 4.0));

        Console.WriteLine("-- formas --");
        for (int index = 0; index < shapes.Count; index++)
        {
            Console.WriteLine(shapes[index].Describe());
        }

        List<double> areas = new List<double>();
        foreach (IShape shape in shapes)
        {
            areas.Add(shape.Area());
        }

        Console.WriteLine("-- areas --");
        double total = 0.0;
        for (int index = 0; index < areas.Count; index++)
        {
            total = total + areas[index];
            Console.WriteLine(index.ToString() + ": " + areas[index].ToString("F2"));
        }
        Console.WriteLine("total=" + total.ToString("F2"));

        Console.WriteLine("-- linq --");
        List<int> numbers = new List<int>();
        numbers.Add(3);
        numbers.Add(1);
        numbers.Add(4);
        numbers.Add(1);
        numbers.Add(5);

        List<int> big = numbers.Where(n => n > 2).Select(n => n * 10).ToList();
        for (int index = 0; index < big.Count; index++)
        {
            Console.Write(big[index].ToString());
            Console.Write(" ");
        }
        Console.WriteLine("");

        Console.WriteLine("suma=" + Utilities.Sum(numbers).ToString());
        Console.WriteLine("promedio=" + Utilities.Average(areas).ToString("F2"));

        Console.WriteLine("-- pedidos --");
        List<Order> orders = new List<Order>();
        orders.Add(new Order("A-001", Status.Pending, 25.0));
        orders.Add(new Order("A-002", Status.Active, 150.0));
        orders.Add(new Order("A-003", Status.Done, 99.5));

        for (int index = 0; index < orders.Count; index++)
        {
            Order order = orders[index];
            string flag = order.IsBig() ? "GRANDE" : "normal";
            Console.WriteLine(order.Reference + " " + order.State.ToString() + " " + Utilities.Money(order.Amount) + " " + flag);
        }

        Console.WriteLine("-- estados --");
        for (int index = 0; index < orders.Count; index++)
        {
            Console.WriteLine(orders[index].Reference + " -> " + Utilities.Next(orders[index].State).ToString());
        }

        Console.WriteLine("-- errores --");
        try
        {
            int value = Utilities.ParseInt("abc");
            Console.WriteLine(value.ToString());
        }
        catch (Exception error)
        {
            Console.WriteLine("capturado: " + error.Message);
        }

        Point origin = new Point(0, 0);
        Point corner = new Point(3, 4);
        Console.WriteLine("punto=" + origin.ToString() + " esquina=" + corner.ToString());
        Console.WriteLine("clamp=" + Utilities.Clamp(150.0, 0.0, 100.0).ToString("F2"));

        Console.WriteLine("fin");
    }
}
