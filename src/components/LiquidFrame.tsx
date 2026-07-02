import LiquidGlass from "liquid-glass-react";
import { useRef } from "react";
import type { CSSProperties, ReactNode } from "react";

type LiquidVariant = "shell" | "rail" | "panel" | "card" | "stat";

interface LiquidFrameProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  variant?: LiquidVariant;
  radius?: number;
}

const glassConfig: Record<LiquidVariant, {
  displacementScale: number;
  blurAmount: number;
  saturation: number;
  aberrationIntensity: number;
  elasticity: number;
  mode: "standard" | "polar" | "prominent" | "shader";
}> = {
  shell: {
    displacementScale: 82,
    blurAmount: 0.085,
    saturation: 155,
    aberrationIntensity: 2.35,
    elasticity: 0.34,
    mode: "prominent",
  },
  rail: {
    displacementScale: 100,
    blurAmount: 0.095,
    saturation: 155,
    aberrationIntensity: 2.65,
    elasticity: 0.40,
    mode: "prominent",
  },
  panel: {
    displacementScale: 90,
    blurAmount: 0.085,
    saturation: 150,
    aberrationIntensity: 2.35,
    elasticity: 0.34,
    mode: "prominent",
  },
  card: {
    displacementScale: 118,
    blurAmount: 0.105,
    saturation: 150,
    aberrationIntensity: 3.05,
    elasticity: 0.46,
    mode: "prominent",
  },
  stat: {
    displacementScale: 128,
    blurAmount: 0.11,
    saturation: 150,
    aberrationIntensity: 3.2,
    elasticity: 0.48,
    mode: "prominent",
  },
};

export function LiquidFrame({
  children,
  className = "",
  style,
  variant = "card",
  radius = 14,
}: LiquidFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const config = glassConfig[variant];
  const resolvedRadius = variant === "card" || variant === "stat"
    ? Math.max(radius, 16)
    : radius;

  return (
    <div ref={frameRef} className={`liquid-frame liquid-frame-${variant} ${className}`.trim()} style={style}>
      <div className="liquid-frame-effect" aria-hidden="true">
        <LiquidGlass
          className={`liquid-root liquid-root-${variant}`}
          cornerRadius={resolvedRadius}
          padding="0"
          overLight={false}
          mouseContainer={frameRef}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: "100%",
            height: "100%",
          }}
          {...config}
        >
          <span className="liquid-frame-fill" />
        </LiquidGlass>
      </div>
      <div className="liquid-frame-content">{children}</div>
    </div>
  );
}
