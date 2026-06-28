import { useEffect, useRef } from "react";

export interface HourlyBucket {
  label: string;
  amount: number;
}

interface Props {
  data: HourlyBucket[];
  color?: string;
  height?: number;
}

export function SpendingChart({
  data,
  color = "#2C68B5",
  height = 84,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cssWidth = canvas.clientWidth || 320;
    const cssHeight = height;
    const dpr = Math.max(window.devicePixelRatio || 1, 1);

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = cssWidth;
    const H = cssHeight;
    const PAD_T = 14;
    const PAD_R = 10;
    const PAD_B = 22;
    const PAD_L = 10;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    ctx.clearRect(0, 0, W, H);

    const n = data.length;
    const rawMax = Math.max(0, ...data.map((d) => d.amount));
    const hasData = rawMax > 0;
    const maxVal = hasData ? Math.max(3, rawMax) : 1;

    const getX = (i: number) => PAD_L + (plotW * i) / Math.max(1, n - 1);
    const getY = (v: number) => PAD_T + plotH * (1 - v / maxVal);

    // Background plot wash
    const bg = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + plotH);
    bg.addColorStop(0, "rgba(44,104,181,0.05)");
    bg.addColorStop(1, "rgba(44,104,181,0.00)");
    ctx.fillStyle = bg;
    ctx.fillRect(PAD_L, PAD_T, plotW, plotH);

    // Grid
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = PAD_T + (plotH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(W - PAD_R, y);
      ctx.strokeStyle = i === 3 ? "rgba(135,118,92,0.16)" : "rgba(135,118,92,0.10)";
      ctx.stroke();
    }
    for (let i = 1; i <= 2; i++) {
      const x = PAD_L + (plotW / 3) * i;
      ctx.beginPath();
      ctx.moveTo(x, PAD_T);
      ctx.lineTo(x, PAD_T + plotH);
      ctx.strokeStyle = "rgba(135,118,92,0.07)";
      ctx.stroke();
    }

    if (n < 2) return;

    const points = data.map((d, i) => ({ x: getX(i), y: getY(d.amount), v: d.amount }));

    const tracePath = () => {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 0; i < points.length - 1; i++) {
        const p = points[i];
        const next = points[i + 1];
        const mx = (p.x + next.x) / 2;
        const my = (p.y + next.y) / 2;
        ctx.quadraticCurveTo(p.x, p.y, mx, my);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
    };

    // Area
    tracePath();
    ctx.lineTo(points[points.length - 1].x, PAD_T + plotH);
    ctx.lineTo(points[0].x, PAD_T + plotH);
    ctx.closePath();
    const area = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + plotH);
    area.addColorStop(0, "rgba(44,104,181,0.24)");
    area.addColorStop(0.6, "rgba(44,104,181,0.08)");
    area.addColorStop(1, "rgba(44,104,181,0.00)");
    ctx.fillStyle = area;
    ctx.fill();

    // Line shadow
    tracePath();
    ctx.strokeStyle = "rgba(44,104,181,0.16)";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    // Main line
    tracePath();
    const line = ctx.createLinearGradient(PAD_L, 0, W - PAD_R, 0);
    line.addColorStop(0, "rgba(44,104,181,0.78)");
    line.addColorStop(1, color);
    ctx.strokeStyle = line;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    // Latest marker
    const latestIdx = data.length - 1;

    const drawDot = (idx: number, fill: string, ring: string, radius: number) => {
      const p = points[idx];
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + 4, 0, Math.PI * 2);
      ctx.fillStyle = ring;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
    };

    if (hasData) {
      drawDot(latestIdx, color, "rgba(44,104,181,0.18)", 4.2);
    }

    // Max label
    if (hasData) {
      ctx.fillStyle = "rgba(17,17,20,0.30)";
      ctx.font = "600 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(`${rawMax} 次`, W - PAD_R, PAD_T + 1);
    }

    // X-axis labels
    ctx.fillStyle = "rgba(17,17,20,0.34)";
    ctx.font = "600 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textBaseline = "alphabetic";
    const ticks: [number, CanvasTextAlign][] = [
      [0, "left"],
      [Math.floor((n - 1) / 2), "center"],
      [n - 1, "right"],
    ];
    for (const [idx, align] of ticks) {
      const p = points[idx];
      ctx.textAlign = align;
      ctx.fillText(data[idx].label, p.x, H - 5);
    }

    // Empty-state label
    if (!hasData) {
      ctx.fillStyle = "rgba(17,17,20,0.24)";
      ctx.font = "600 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("近 24 小时暂无请求", W / 2, PAD_T + plotH / 2);
    }
  }, [data, color, height]);

  return <canvas ref={canvasRef} style={{ width: "100%", height, display: "block" }} />;
}
