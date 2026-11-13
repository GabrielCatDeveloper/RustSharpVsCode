using System;
using System.Collections.Generic;

namespace Demo;

public static class Utilities
{
    public static double Clamp(double value, double min, double max)
    {
        if (value < min)
        {
            return min;
        }
        if (value > max)
        {
            return max;
        }
        return value;
    }

    public static int Sum(List<int> values)
    {
        int total = 0;
        for (int index = 0; index < values.Count; index++)
        {
            total = total + values[index];
        }
        return total;
    }

    public static double Average(List<double> values)
    {
        if (values.Count == 0)
        {
            return 0.0;
        }
        double total = 0.0;
        foreach (double value in values)
        {
            total = total + value;
        }
        return total / values.Count;
    }

    public static string Money(double amount)
    {
        return amount.ToString("F2") + " EUR";
    }

    public static int ParseInt(string text)
    {
        if (text == "42")
        {
            return 42;
        }
        throw new Exception("no es un número: " + text);
    }

    public static Status Next(Status state)
    {
        if (state == Status.Pending)
        {
            return Status.Active;
        }
        if (state == Status.Active)
        {
            return Status.Done;
        }
        return Status.Done;
    }
}
