"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, type IChartApi, type Time } from "lightweight-charts";

export type CandleBar = { time: Time; open: number; high: number; low: number; close: number };
export type LineBar = { time: Time; value: number };

interface TradingViewChartProps {
  data?: LineBar[];
  candleData?: CandleBar[];
  height?: number;
  type?: "area" | "line" | "candlestick";
  timeframe?: string;
}

export function TradingViewChart({
  data,
  candleData,
  height = 320,
  type = "area",
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const hasData = type === "candlestick" ? (candleData?.length ?? 0) > 0 : (data?.length ?? 0) > 0;

  useEffect(() => {
    if (!containerRef.current || !hasData) return;

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

    if (type === "candlestick" && candleData) {
      chart.addCandlestickSeries({
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderUpColor: "#22c55e",
        borderDownColor: "#ef4444",
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
      }).setData(candleData);
    } else if (type === "area" && data) {
      chart.addAreaSeries({
        lineColor: "#22d3ee",
        topColor: "rgba(34,211,238,0.25)",
        bottomColor: "rgba(34,211,238,0)",
        lineWidth: 2,
        priceLineColor: "#22d3ee",
        priceLineStyle: 3,
      }).setData(data);
    } else if (data) {
      chart.addLineSeries({ color: "#22d3ee", lineWidth: 2 }).setData(data);
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.resize(containerRef.current.clientWidth, height);
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data, candleData, height, type, hasData]);

  if (!hasData) {
    return (
      <div
        className="w-full flex items-center justify-center text-slate-600 text-sm border border-slate-800/50 rounded-lg bg-slate-900/20"
        style={{ height }}
      >
        No chart data available
      </div>
    );
  }

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}
