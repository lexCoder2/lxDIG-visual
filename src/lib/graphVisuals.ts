import { DEPTH_VISUAL } from "../config/constants";

type Point = { x: number; y: number };
type AnchorPoint = Point & { nx: number; ny: number };

export type EdgeCurve = {
  d: string;
  labelX: number;
  labelY: number;
};

export type NodeDepthVisual = {
  scale: number;
  opacity: number;
};

export type EdgeDepthColor = {
  stroke: string;
  glow: string;
};

const EDGE_DEPTH_COLORS: EdgeDepthColor[] = [
  { stroke: "rgba(105, 122, 176, 0.94)", glow: "rgba(147, 169, 225, 0.66)" },
  { stroke: "rgba(89, 138, 176, 0.92)", glow: "rgba(129, 182, 223, 0.64)" },
  { stroke: "rgba(84, 149, 166, 0.9)", glow: "rgba(121, 194, 210, 0.62)" },
  { stroke: "rgba(111, 137, 168, 0.88)", glow: "rgba(152, 181, 214, 0.6)" },
  { stroke: "rgba(118, 130, 160, 0.86)", glow: "rgba(161, 174, 202, 0.58)" },
];

export function getEdgeDepthColor(depth: number): EdgeDepthColor {
  const index = Math.max(
    0,
    Math.min(EDGE_DEPTH_COLORS.length - 1, Math.round(depth)),
  );
  return EDGE_DEPTH_COLORS[index];
}

export function buildOrganicPath(
  source: AnchorPoint,
  target: AnchorPoint,
): EdgeCurve {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 72) {
    const midX = (source.x + target.x) / 2;
    const midY = (source.y + target.y) / 2;

    return {
      d: `M ${source.x} ${source.y} L ${target.x} ${target.y}`,
      labelX: midX,
      labelY: midY,
    };
  }

  const projectedSource = Math.abs(dx * source.nx + dy * source.ny);
  const projectedTarget = Math.abs(dx * target.nx + dy * target.ny);
  const projectionFactor = Math.max(
    0.35,
    Math.min(1.05, (projectedSource + projectedTarget) / Math.max(distance, 1)),
  );
  const handle = Math.max(
    32,
    Math.min(150, distance * 0.26 * projectionFactor),
  );
  const control1 = {
    x: source.x + source.nx * handle,
    y: source.y + source.ny * handle,
  };
  const control2 = {
    x: target.x + target.nx * handle,
    y: target.y + target.ny * handle,
  };

  const labelX = (source.x + 3 * control1.x + 3 * control2.x + target.x) / 8;
  const labelY = (source.y + 3 * control1.y + 3 * control2.y + target.y) / 8;

  return {
    d: `M ${source.x.toFixed(2)} ${source.y.toFixed(2)} C ${control1.x.toFixed(2)} ${control1.y.toFixed(2)}, ${control2.x.toFixed(2)} ${control2.y.toFixed(2)}, ${target.x.toFixed(2)} ${target.y.toFixed(2)}`,
    labelX,
    labelY,
  };
}

export function getDepthVisual(depth: number): NodeDepthVisual {
  const clampedDepth = Math.max(0, Math.min(depth, DEPTH_VISUAL.maxDepth));
  const depthRatio = clampedDepth / Math.max(1, DEPTH_VISUAL.maxDepth);
  const nonlinearFade = 1 - Math.pow(depthRatio, 1.65);
  const opacityFromRatio =
    DEPTH_VISUAL.minOpacity + nonlinearFade * (1 - DEPTH_VISUAL.minOpacity);
  const opacityFromStep = 1 - clampedDepth * DEPTH_VISUAL.opacityStep;

  return {
    scale: Math.max(
      DEPTH_VISUAL.minScale,
      1 - clampedDepth * DEPTH_VISUAL.scaleStep,
    ),
    opacity: Math.max(
      DEPTH_VISUAL.minOpacity,
      Math.min(opacityFromRatio, opacityFromStep),
    ),
  };
}

export function pointOnPerimeter(
  center: Point,
  toward: Point,
  halfWidth: number,
  halfHeight: number,
): AnchorPoint {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return { x: center.x + halfWidth, y: center.y, nx: 1, ny: 0 };
  }

  const ratioX = Math.abs(dx) / Math.max(halfWidth, 1);
  const ratioY = Math.abs(dy) / Math.max(halfHeight, 1);

  if (ratioX >= ratioY) {
    const xSign = dx >= 0 ? 1 : -1;
    const scale = Math.max(ratioX, 1);
    return {
      x: center.x + xSign * halfWidth,
      y: center.y + dy / scale,
      nx: xSign,
      ny: 0,
    };
  }

  const ySign = dy >= 0 ? 1 : -1;
  const scale = Math.max(ratioY, 1);

  return {
    x: center.x + dx / scale,
    y: center.y + ySign * halfHeight,
    nx: 0,
    ny: ySign,
  };
}
