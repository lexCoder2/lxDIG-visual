import { DEPTH_VISUAL } from "../config/constants";

type Point = { x: number; y: number };
type AnchorPoint = Point & { nx: number; ny: number };

export type EdgeCurve = {
  d: string;
  labelX: number;
  labelY: number;
};

// H: control-point form for canvas drawing
export type CurveControlPoints = {
  x1: number;
  y1: number;
  cx1: number;
  cy1: number;
  cx2: number;
  cy2: number;
  x2: number;
  y2: number;
  labelX: number;
  labelY: number;
  isLine: boolean;
};

export type NodeDepthVisual = {
  scale: number;
  opacity: number;
};

export type EdgeDepthColor = {
  stroke: string;
  glow: string;
};

// K: structured label type and module-level cache
export type StructuredLabel = {
  primary: string;
  extension?: string;
  secondary?: string;
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

// H: returns control points directly for canvas drawing
export function buildOrganicCurve(
  source: AnchorPoint,
  target: AnchorPoint,
): CurveControlPoints {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.hypot(dx, dy);
  const midX = (source.x + target.x) / 2;
  const midY = (source.y + target.y) / 2;

  if (distance < 72) {
    return {
      x1: source.x,
      y1: source.y,
      cx1: midX,
      cy1: midY,
      cx2: midX,
      cy2: midY,
      x2: target.x,
      y2: target.y,
      labelX: midX,
      labelY: midY,
      isLine: true,
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
  const cx1 = source.x + source.nx * handle;
  const cy1 = source.y + source.ny * handle;
  const cx2 = target.x + target.nx * handle;
  const cy2 = target.y + target.ny * handle;
  const labelX = (source.x + 3 * cx1 + 3 * cx2 + target.x) / 8;
  const labelY = (source.y + 3 * cy1 + 3 * cy2 + target.y) / 8;

  return {
    x1: source.x,
    y1: source.y,
    cx1,
    cy1,
    cx2,
    cy2,
    x2: target.x,
    y2: target.y,
    labelX,
    labelY,
    isLine: false,
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

  const safeHalfWidth = Math.max(halfWidth, 1);
  const safeHalfHeight = Math.max(halfHeight, 1);
  const norm = Math.hypot(dx, dy);
  const ux = dx / norm;
  const uy = dy / norm;

  const denominator = Math.sqrt(
    (ux * ux) / (safeHalfWidth * safeHalfWidth) +
      (uy * uy) / (safeHalfHeight * safeHalfHeight),
  );
  const distanceToPerimeter = 1 / Math.max(denominator, 1e-6);

  const localX = ux * distanceToPerimeter;
  const localY = uy * distanceToPerimeter;
  const x = center.x + localX;
  const y = center.y + localY;

  const normalX = localX / (safeHalfWidth * safeHalfWidth);
  const normalY = localY / (safeHalfHeight * safeHalfHeight);
  const normalLength = Math.hypot(normalX, normalY);

  return {
    x,
    y,
    nx: normalLength > 1e-6 ? normalX / normalLength : ux,
    ny: normalLength > 1e-6 ? normalY / normalLength : uy,
  };
}

// K: label cache keyed by "label:kind" — stable since labels don't change between renders
const labelCache = new Map<string, StructuredLabel>();

export function getStructuredNodeLabel(
  label: string,
  kind: string,
): StructuredLabel {
  const key = `${label}:${kind}`;
  const cached = labelCache.get(key);
  if (cached) return cached;

  const result = computeStructuredLabel(label, kind);
  labelCache.set(key, result);
  return result;
}

function computeStructuredLabel(label: string, kind: string): StructuredLabel {
  const normalizedLabel = label.trim();

  if (kind === "file") {
    const slashIndex = Math.max(
      normalizedLabel.lastIndexOf("/"),
      normalizedLabel.lastIndexOf("\\"),
    );
    const tail =
      slashIndex >= 0 ? normalizedLabel.slice(slashIndex + 1) : normalizedLabel;
    const hashIndex = tail.indexOf("#");
    const fileName = hashIndex >= 0 ? tail.slice(0, hashIndex) : tail;
    const anchorSuffix = hashIndex >= 0 ? tail.slice(hashIndex) : "";
    const dotIndex = fileName.lastIndexOf(".");

    if (dotIndex > 0 && dotIndex < fileName.length - 1) {
      return {
        primary: fileName.slice(0, dotIndex),
        extension: fileName.slice(dotIndex + 1),
        secondary: anchorSuffix || undefined,
      };
    }

    return {
      primary: fileName || tail,
      secondary: anchorSuffix || undefined,
    };
  }

  const segments = normalizedLabel.split(":").filter(Boolean);
  const isImportLike =
    normalizedLabel.toLowerCase().startsWith("import:") ||
    normalizedLabel.includes(":") ||
    kind === "service";

  if (!isImportLike || segments.length < 2) {
    return { primary: normalizedLabel };
  }

  const [head, ...tailSegments] = segments;
  return {
    primary: head,
    secondary: tailSegments.join(" › "),
  };
}
