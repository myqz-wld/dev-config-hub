import type { CSSProperties } from "react";

type PressurePath = {
  path: string;
  dashArray: string;
  dashOffset: string;
  opacity: number;
  strokeWidth: number;
};

type TextureDot = {
  cx: number;
  cy: number;
  r: number;
  opacity: number;
};

type TextureDash = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  strokeWidth: number;
  opacity: number;
};

export type NavCircleVariant = {
  loopPath: string;
  tailPath: string;
  grainLoopPath: string;
  grainTailPath: string;
  hasTail: boolean;
  pressurePaths: PressurePath[];
  textureDots: TextureDot[];
  textureDashes: TextureDash[];
  loopStrokeWidth: number;
  tailStrokeWidth: number;
  style: CSSProperties & {
    "--nav-circle-x": string;
    "--nav-circle-y": string;
    "--nav-circle-rotate": string;
    "--nav-circle-scale-x": string;
    "--nav-circle-scale-y": string;
  };
};

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const fmt = (n: number) => n.toFixed(2);

const REF_LOOP = [
  "M 36 118",
  "C 13 88 28 55 69 34",
  "C 111 12 184 16 209 49",
  "C 232 79 204 116 154 138",
  "C 108 158 58 148 36 118",
].join(" ");

const REF_TAIL = "M 184 109 C 165 146 130 174 88 191";

function jitterPath(path: string, amount: number) {
  return path.replace(/-?\d+(?:\.\d+)?/g, (value) => fmt(Number(value) + rand(-amount, amount)));
}

function ovalPoint(t: number, noise: number) {
  const centerX = 117;
  const centerY = 87;
  const rx = 96 + rand(-noise, noise);
  const ry = 61 + rand(-noise, noise);
  const tilt = -0.38;
  const x = Math.cos(t) * rx;
  const y = Math.sin(t) * ry;
  return {
    x: centerX + x * Math.cos(tilt) - y * Math.sin(tilt),
    y: centerY + x * Math.sin(tilt) + y * Math.cos(tilt),
    dx: -Math.sin(t) * Math.cos(tilt) - Math.cos(t) * Math.sin(tilt),
    dy: -Math.sin(t) * Math.sin(tilt) + Math.cos(t) * Math.cos(tilt),
  };
}

function tailPoint(t: number) {
  const x = 184 * (1 - t) ** 3 + 3 * 165 * (1 - t) ** 2 * t + 3 * 130 * (1 - t) * t ** 2 + 88 * t ** 3;
  const y = 109 * (1 - t) ** 3 + 3 * 146 * (1 - t) ** 2 * t + 3 * 174 * (1 - t) * t ** 2 + 191 * t ** 3;
  return { x, y, dx: -96, dy: 82 };
}

function textureDot(onTail = false): TextureDot {
  const p = onTail ? tailPoint(rand(0.08, 0.96)) : ovalPoint(rand(0, Math.PI * 2), 6);
  const spread = onTail ? rand(-6.5, 6.5) : rand(-5.5, 5.5);
  const len = Math.hypot(p.dx, p.dy) || 1;
  const nx = -p.dy / len;
  const ny = p.dx / len;
  const heavy = onTail || p.x > 164 || p.y < 45;
  return {
    cx: p.x + nx * spread + rand(-2.4, 2.4),
    cy: p.y + ny * spread + rand(-2.2, 2.2),
    r: rand(0.62, heavy ? 2.35 : 1.68),
    opacity: rand(0.18, heavy ? 0.82 : 0.58),
  };
}

function textureDash(onTail = false): TextureDash {
  const p = onTail ? tailPoint(rand(0.1, 0.95)) : ovalPoint(rand(0, Math.PI * 2), 4);
  const len = Math.hypot(p.dx, p.dy) || 1;
  const tx = p.dx / len;
  const ty = p.dy / len;
  const dashLen = rand(2.8, onTail ? 9.2 : 6.6);
  const jitter = rand(-4.2, 4.2);
  const nx = -ty;
  const ny = tx;
  const x = p.x + nx * jitter + rand(-1.3, 1.3);
  const y = p.y + ny * jitter + rand(-1.3, 1.3);
  return {
    x1: x - tx * dashLen / 2,
    y1: y - ty * dashLen / 2,
    x2: x + tx * dashLen / 2,
    y2: y + ty * dashLen / 2,
      strokeWidth: rand(0.95, onTail ? 3.1 : 2.45),
    opacity: rand(0.24, 0.76),
  };
}

export function createNavCircleVariant(): NavCircleVariant {
  const loopStrokeWidth = rand(4.2, 6.4);
  const tailStrokeWidth = loopStrokeWidth * rand(1.18, 1.95);
  const hasTail = Math.random() > 0.34;
  const tailPressure = hasTail
    ? [
      jitterPath(REF_TAIL, 3.2),
      jitterPath(REF_TAIL, 4.5),
    ]
    : [];
  return {
    loopPath: jitterPath(REF_LOOP, 2.4),
    tailPath: jitterPath(REF_TAIL, 2.8),
    grainLoopPath: jitterPath(REF_LOOP, 4.2),
    grainTailPath: jitterPath(REF_TAIL, 4.8),
    hasTail,
    pressurePaths: [
      jitterPath(REF_LOOP, 2.8),
      jitterPath(REF_LOOP, 3.4),
      ...tailPressure,
    ].map((path, i) => ({
      path,
      dashArray: i < 2
        ? `${fmt(rand(42, 84))} ${fmt(rand(26, 58))} ${fmt(rand(12, 30))} ${fmt(rand(44, 82))}`
        : `${fmt(rand(18, 44))} ${fmt(rand(12, 38))}`,
      dashOffset: fmt(rand(0, 170)),
      opacity: rand(0.22, 0.64),
      strokeWidth: loopStrokeWidth * rand(0.78, i < 2 ? 1.9 : 2.35),
    })),
    textureDots: [
      ...Array.from({ length: 120 }, () => textureDot(false)),
      ...Array.from({ length: hasTail ? 48 : 0 }, () => textureDot(true)),
    ],
    textureDashes: [
      ...Array.from({ length: 30 }, () => textureDash(false)),
      ...Array.from({ length: hasTail ? 18 : 0 }, () => textureDash(true)),
    ],
    loopStrokeWidth,
    tailStrokeWidth,
    style: {
      "--nav-circle-x": `${fmt(rand(-4.5, 4.5))}px`,
      "--nav-circle-y": `${fmt(rand(-4, 3.5))}px`,
      "--nav-circle-rotate": `${fmt(rand(-5.5, 5.5))}deg`,
      "--nav-circle-scale-x": fmt(rand(0.94, 1.1)),
      "--nav-circle-scale-y": fmt(rand(0.9, 1.12)),
    },
  };
}

export function NavPencilCircle({ checked, variant }: {
  checked: boolean;
  variant: NavCircleVariant;
}) {
  if (!checked) return null;
  return (
    <svg className="nav-pencil-circle" style={variant.style} viewBox="0 0 234 216" focusable="false" aria-hidden="true">
      <path className="nav-pencil-circle-shadow" d={variant.loopPath} strokeWidth={variant.loopStrokeWidth} />
      {variant.hasTail && <path className="nav-pencil-circle-shadow" d={variant.tailPath} strokeWidth={variant.tailStrokeWidth} />}
      {variant.textureDots.map((dot, i) => (
        <circle key={`dot-${i}`} className="nav-pencil-circle-dot" cx={dot.cx} cy={dot.cy} r={dot.r} opacity={dot.opacity} />
      ))}
      {variant.textureDashes.map((dash, i) => (
        <line
          key={`dash-${i}`}
          className="nav-pencil-circle-dash"
          x1={dash.x1}
          y1={dash.y1}
          x2={dash.x2}
          y2={dash.y2}
          opacity={dash.opacity}
          strokeWidth={dash.strokeWidth}
        />
      ))}
      <path className="nav-pencil-circle-main" d={variant.loopPath} strokeWidth={variant.loopStrokeWidth} />
      {variant.hasTail && <path className="nav-pencil-circle-tail" d={variant.tailPath} strokeWidth={variant.tailStrokeWidth} />}
      {variant.pressurePaths.map((pressure, i) => (
        <path
          key={i}
          className="nav-pencil-circle-pressure"
          d={pressure.path}
          opacity={pressure.opacity}
          strokeDasharray={pressure.dashArray}
          strokeDashoffset={pressure.dashOffset}
          strokeWidth={pressure.strokeWidth}
        />
      ))}
      <path className="nav-pencil-circle-grain" d={variant.grainLoopPath} strokeWidth={Math.max(1, variant.loopStrokeWidth * 0.52)} />
      {variant.hasTail && <path className="nav-pencil-circle-grain" d={variant.grainTailPath} strokeWidth={Math.max(1, variant.tailStrokeWidth * 0.44)} />}
    </svg>
  );
}
