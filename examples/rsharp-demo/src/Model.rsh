using System;
using System.Collections.Generic;

namespace Demo;

public enum Status
{
    Pending = 0,
    Active = 1,
    Done = 2
}

public interface IShape
{
    double Area();
    string Describe();
}

public struct Point
{
    public int X;
    public int Y;

    public Point(int x, int y)
    {
        X = x;
        Y = y;
    }

    public override string ToString()
    {
        return "(" + X + "," + Y + ")";
    }
}

public class Circle : IShape
{
    private readonly double Radius;

    public Circle(double radius)
    {
        Radius = radius;
    }

    public double Area()
    {
        return Math.PI * Radius * Radius;
    }

    public string Describe()
    {
        return "circle r=" + Radius.ToString("F2") + " area=" + Area().ToString("F2");
    }
}

public class Square : IShape
{
    private readonly double Side;

    public Square(double side)
    {
        Side = side;
    }

    public double Area()
    {
        return Side * Side;
    }

    public string Describe()
    {
        return "square s=" + Side.ToString("F2") + " area=" + Area().ToString("F2");
    }
}

public class Rect : IShape
{
    private readonly double Width;
    private readonly double Height;

    public Rect(double width, double height)
    {
        Width = width;
        Height = height;
    }

    public double Area()
    {
        return Width * Height;
    }

    public string Describe()
    {
        return "rect " + Width.ToString("F2") + "x" + Height.ToString("F2") + " area=" + Area().ToString("F2");
    }
}

public class Order
{
    public string Reference { get; set; }
    public Status State { get; set; }
    public double Amount { get; set; }

    public Order(string reference, Status state, double amount)
    {
        Reference = reference;
        State = state;
        Amount = amount;
    }

    public bool IsBig()
    {
        return Amount >= 100.0;
    }
}
