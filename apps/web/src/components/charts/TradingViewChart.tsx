"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";

interface TradingViewChartProps {
  data?: Array<{ time: Time; value: number }>;
  height?: number;
  type?: "area" | "line";
}

function generateSeries(): Array<{ time: Time; value: number }> {
  const points = 90;
  const start = Date.now() - points * 60 * 60_000;
  let v = 48_320;
  return Array.from({ length: points }, (_, i) => {
    const drift = (Math.random() - 0.48) * 280;
    v = Math.max(35_000, v + drift + Math.sin(i / 8) * 90);
    return {
      time: Math.floor((start + i * 60 * 60_000) / 1000) as Time,
      value: +v.toFixed(2),
    };
  });
}

export function TradingViewChart({ data, height = 320, type = "area" }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area" | "Line"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#64748b",
        fontFamily: "Inter, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(30,41,59,0.5)" },
        horzLines: { color: "rgba(30,41,59,0.5)" },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: "#22d3ee", style: 3, width: 1, labelBackgroundColor: "#0891b2" },
        horzLine: { color: "#22d3ee", style: 3, width: 1, labelBackgroundColor: "#0891b2" },
      },
      rightPriceScale: { borderColor: "rgba(30,41,59,0.6)" },
      timeScale: {
        borderColor: "rgba(30,41,59,0.6)",
        timeVisible: true,
        secondsVisible: false,
      },
      width: containerRef.current.clientWidth,
      height,
      handleScroll: { vertTouchDrag: false },
    });

    chartRef.current = chart;

    const series =
      type === "area"
        ? chart.addAreaSeries({
            lineColor: "#22d3ee",
            topColor: "rgba(34,211,238,0.25)",
            bottomColor: "rgba(34,211,238,0)",
            lineWidth: 2,
            priceLineColor: "#22d3ee",
            priceLineStyle: 3,
          })
        : chart.addLineSeries({ color: "#22d3ee", lineWidth: 2 });

    seriesRef.current = series;
    series.setData(data ?? generateSeries());
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.resize(containerRef.current.clientWidth, height);
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data, height, type]);

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}
