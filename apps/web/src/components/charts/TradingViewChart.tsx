"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, type IChartApi, type Time } from "lightweight-charts";

type CandleBar = { time: Time; open: number; high: number; low: number; close: number };
type LineBar = { time: Time; value: number };

interface TradingViewChartProps {
  data?: LineBar[];
  candleData?: CandleBar[];
  height?: number;
  type?: "area" | "line" | "candlestick";
  timeframe?: string;
  basePrice?: number;
}

const TF_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1D": 86400,
};

function seededRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateAreaSeries(intervalSec: number, basePrice: number): LineBar[] {
  const r = seededRng(intervalSec * 7 + Math.floor(basePrice));
  const points = 90;
  const start = Date.now() - points * intervalSec * 1000;
  let v = basePrice;
  return Array.from({ length: points }, (_, i) => {
    v = Math.max(basePrice * 0.4, v + (r() - 0.48) * v * 0.011 + Math.sin(i / 9) * v * 0.002);
    return { time: Math.floor((start + i * intervalSec * 1000) / 1000) as Time, value: +v.toFixed(2) };
  });
}

function generateCandleSeries(intervalSec: number, basePrice: number): CandleBar[] {
  const r = seededRng(intervalSec * 13 + Math.floor(basePrice));
  const points = 100;
  const start = Date.now() - points * intervalSec * 1000;
  let v = basePrice;
  return Array.from({ length: points }, (_, i) => {
    const open = +v.toFixed(2);
    const move = (r() - 0.478) * v * 0.013 + Math.sin(i / 11) * v * 0.002;
    const close = Math.max(basePrice * 0.3, v + move);
    const wick = r() * v * 0.004;
    v = close;
    return {
      time: Math.floor((start + i * intervalSec * 1000) / 1000) as Time,
      open,
      high: +(Math.max(open, close) + wick).toFixed(2),
      low: +(Math.min(open, close) - wick * r()).toFixed(2),
      close: +close.toFixed(2),
    };
  });
}

export function TradingViewChart({
  data,
  candleData,
  height = 320,
  type = "area",
  timeframe = "1h",
  basePrice = 48_320,
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

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
    const intervalSec = TF_SECONDS[timeframe] ?? 3600;

    if (type === "candlestick") {
      const series = chart.addCandlestickSeries({
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderUpColor: "#22c55e",
        borderDownColor: "#ef4444",
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
      });
      series.setData(candleData ?? generateCandleSeries(intervalSec, basePrice));
    } else if (type === "area") {
      const series = chart.addAreaSeries({
        lineColor: "#22d3ee",
        topColor: "rgba(34,211,238,0.25)",
        bottomColor: "rgba(34,211,238,0)",
        lineWidth: 2,
        priceLineColor: "#22d3ee",
        priceLineStyle: 3,
      });
      series.setData(data ?? generateAreaSeries(intervalSec, basePrice));
    } else {
      const series = chart.addLineSeries({ color: "#22d3ee", lineWidth: 2 });
      series.setData(data ?? generateAreaSeries(intervalSec, basePrice));
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
  }, [data, candleData, height, type, timeframe, basePrice]);

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}
