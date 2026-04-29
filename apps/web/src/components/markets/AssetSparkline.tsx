import { cn } from "@/lib/utils";

interface AssetSparklineProps {
  data: number[];
  positive?: boolean;
  width?: number;
  height?: number;
  className?: string;
}

export function AssetSparkline({ data, positive = true, width = 120, height = 40, className }: AssetSparklineProps) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const path = data
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  // Area fill
  const areaPath = `${path} L${(data.length - 1) * stepX},${height} L0,${height} Z`;

  const stroke = positive ? "#34d399" : "#f87171";
  const fill = positive ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)";

  return (
    <svg width={width} height={height} className={cn(className)} preserveAspectRatio="none">
      <path d={areaPath} fill={fill} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
