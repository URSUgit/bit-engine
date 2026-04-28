"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, type IChartApi } from "lightweight-charts";

interface TradingViewChartProps {
  data?: Array<{ time: string; value: number }>;
  height?: number;
}

const defaultData = Array.from({ length: 60 }, (_, i) => {
  const base = 3400;
  const val = base + Math.sin(i / 8) * 200 + Math.random() * 100 - 50 + i * 4;
  const date = new Date(Date.now() - (60 - i) * 60_000);
  return {
    time: Math.floor(date.getTime() / 1000) as any,
    value: +val.toFixed(2),
  };
});

export function TradingViewChart({ data = defaultData, height = 300 }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#71717a",
      },
      grid: {
        vertLines: { color: "#27272a" },
        horzLines: { color: "#27272a" },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "#27272a" },
      timeScale: { borderColor: "#27272a", timeVisible: true, secondsVisible: false },
      width: containerRef.current.clientWidth,
      height,
    });

    chartRef.current = chart;

    const series = chart.addAreaSeries({
      lineColor: "#06b6d4",
      topColor: "rgba(6,182,212,0.15)",
      bottomColor: "rgba(6,182,212,0)",
      lineWidth: 2,
    });

    series.setData(data);
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.resize(containerRef.current.clientWidth, height);
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data, height]);

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}
