import { useEffect, useRef } from "react";

interface Props {
  active: boolean;
  color?: string;
  height?: number;
}

export function ActivityGraph({ active, color = "#0A84FF", height = 64 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef   = useRef<number[]>(new Array(80).fill(0));
  const rafRef    = useRef(0);
  const frameRef  = useRef(0);
  const tickRef   = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    let cancelled = false;

    const draw = () => {
      if (cancelled) return;
      const f = ++frameRef.current;

      if (f % 5 === 0) {
        const data = dataRef.current;
        if (active) {
          const t = tickRef.current++;
          const v = 0.22 + Math.sin(t * 0.14) * 0.24 + Math.random() * 0.42;
          data.push(Math.max(0.05, Math.min(1, v)));
        } else {
          data.push(0.01 + Math.random() * 0.025);
        }
        data.shift();
      }

      const data  = dataRef.current;
      const step  = W / (data.length - 1);
      const PAD_T = 10, PAD_B = 10;
      const range = H - PAD_T - PAD_B;

      ctx.clearRect(0, 0, W, H);

      // Faint grid lines
      ctx.strokeStyle = "rgba(185,150,95,0.18)";
      ctx.lineWidth = 1;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(0, PAD_T + (range / 4) * i);
        ctx.lineTo(W, PAD_T + (range / 4) * i);
        ctx.stroke();
      }

      // Gradient fill under curve
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < data.length; i++) {
        ctx.lineTo(i * step, H - PAD_B - data[i] * range);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, color + "30");
      grad.addColorStop(1, color + "00");
      ctx.fillStyle = grad;
      ctx.fill();

      // Line
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = i * step;
        const y = H - PAD_B - data[i] * range;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [active, color]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={128}
      style={{ width: "100%", height, display: "block", borderRadius: 6 }}
    />
  );
}
