import { useEffect, useRef } from "react";

export interface HourlyBucket {
  label: string;
  amount: number;
}

interface Props {
  data: HourlyBucket[];
  color?: string;
  height?: number;
  highlightPeak?: boolean; // dot on peak bucket instead of last non-zero
  topLabel?: string;       // small text at top-left, e.g. "峰 12 次"
}

export function SpendingChart({
  data,
  color = "#0066CC",
  height = 80,
  highlightPeak = false,
  topLabel,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const PAD_T = 8, PAD_B = 32, PAD_L = 4, PAD_R = 4;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    const rawMax = Math.max(...data.map(d => d.amount));
    const hasData = rawMax > 0;
    const maxVal  = hasData ? rawMax * 1.15 : 1;
    const n       = data.length;

    ctx.clearRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = "rgba(185,150,95,0.18)";
    ctx.lineWidth   = 1;
    for (let i = 0; i <= 3; i++) {
      const y = PAD_T + (plotH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(W - PAD_R, y);
      ctx.stroke();
    }

    if (n < 2) return;

    const getX = (i: number) => PAD_L + i * (plotW / (n - 1));
    const getY = (v: number) => hasData
      ? PAD_T + plotH * (1 - v / maxVal)
      : PAD_T + plotH;

    // Gradient fill
    ctx.beginPath();
    ctx.moveTo(getX(0), H - PAD_B);
    for (let i = 0; i < n; i++) ctx.lineTo(getX(i), getY(data[i].amount));
    ctx.lineTo(getX(n - 1), H - PAD_B);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, PAD_T, 0, H - PAD_B);
    grad.addColorStop(0, color + "38");
    grad.addColorStop(1, color + "00");
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      i === 0
        ? ctx.moveTo(getX(i), getY(data[i].amount))
        : ctx.lineTo(getX(i), getY(data[i].amount));
    }
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.lineJoin    = "round";
    ctx.lineCap     = "round";
    ctx.stroke();

    // Highlight dot
    if (hasData) {
      let dotIdx = -1;
      if (highlightPeak) {
        // peak bucket
        let peak = 0;
        for (let i = 0; i < n; i++) {
          if (data[i].amount > peak) { peak = data[i].amount; dotIdx = i; }
        }
      } else {
        // last non-zero bucket
        for (let i = n - 1; i >= 0; i--) {
          if (data[i].amount > 0) { dotIdx = i; break; }
        }
      }
      if (dotIdx >= 0) {
        const dx = getX(dotIdx);
        const dy = getY(data[dotIdx].amount);
        // Outer ring (subtle glow)
        ctx.beginPath();
        ctx.arc(dx, dy, 8, 0, Math.PI * 2);
        ctx.fillStyle = color + "22";
        ctx.fill();
        // Filled dot
        ctx.beginPath();
        ctx.arc(dx, dy, 5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        // White inner
        ctx.beginPath();
        ctx.arc(dx, dy, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = "#FAF7EE";
        ctx.fill();

        // Callout label above peak dot
        if (highlightPeak && data[dotIdx].amount > 0) {
          const label = `${data[dotIdx].amount}`;
          ctx.font      = "bold 24px -apple-system, system-ui, sans-serif";
          ctx.textAlign = dotIdx > n * 0.75 ? "right" : "left";
          ctx.textBaseline = "alphabetic";
          ctx.fillStyle = color;
          const lx = dotIdx > n * 0.75 ? dx - 12 : dx + 12;
          ctx.fillText(label, lx, dy - 10);
        }
      }
    }

    // X-axis time labels
    ctx.fillStyle    = "rgba(17,17,20,0.30)";
    ctx.font         = "bold 22px -apple-system, system-ui, sans-serif";
    ctx.textBaseline = "alphabetic";
    const labelIdxs: [number, "left" | "center" | "right"][] = [
      [0, "left"],
      [6, "center"],
      [12, "center"],
      [18, "center"],
      [n - 1, "right"],
    ];
    for (const [i, align] of labelIdxs) {
      if (i < n) {
        ctx.textAlign = align;
        const x = align === "left" ? getX(i) + 2 : align === "right" ? getX(i) - 2 : getX(i);
        ctx.fillText(data[i].label, x, H - 6);
      }
    }

    // Optional top-left label
    if (topLabel) {
      ctx.font         = "600 20px -apple-system, system-ui, sans-serif";
      ctx.textAlign    = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle    = "rgba(17,17,20,0.28)";
      ctx.fillText(topLabel, PAD_L + 2, PAD_T + 2);
    }
  }, [data, color, highlightPeak, topLabel]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={height * 2}
      style={{ width: "100%", height, display: "block" }}
    />
  );
}
