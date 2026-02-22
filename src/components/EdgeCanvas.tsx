import { memo, useEffect, useRef } from "react";
import { EDGE_VISUAL } from "../config/constants";
import {
  buildOrganicCurve,
  getEdgeDepthColor,
  pointOnPerimeter,
} from "../lib/graphVisuals";
import type { PositionedEdge } from "../types/graph";

type NodeGeometry = {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  depth: number;
};

type EdgeCanvasProps = {
  edges: PositionedEdge[];
  nodeGeometryById: Record<string, NodeGeometry>;
  depthById: Record<string, number>;
  selectedRelativeEdgeById: Record<string, boolean>;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
};

function getCubicPointAt(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const inv = 1 - t;
  return (
    inv * inv * inv * p0 +
    3 * inv * inv * t * p1 +
    3 * inv * t * t * p2 +
    t * t * t * p3
  );
}

function getCurvePoint(curve: ReturnType<typeof buildOrganicCurve>, t: number) {
  if (curve.isLine) {
    return {
      x: curve.x1 + (curve.x2 - curve.x1) * t,
      y: curve.y1 + (curve.y2 - curve.y1) * t,
    };
  }

  return {
    x: getCubicPointAt(curve.x1, curve.cx1, curve.cx2, curve.x2, t),
    y: getCubicPointAt(curve.y1, curve.cy1, curve.cy2, curve.y2, t),
  };
}

export const EdgeCanvas = memo(function EdgeCanvas({
  edges,
  nodeGeometryById,
  depthById,
  selectedRelativeEdgeById,
  width,
  height,
  offsetX,
  offsetY,
}: EdgeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Precompute curve data and visual properties for all edges
    type EdgeDrawData = {
      curve: ReturnType<typeof buildOrganicCurve>;
      edgeOpacity: number;
      edgeWidth: number;
      edgeStroke: string;
      edgeGlow: string;
      isSelectedRelative: boolean;
      label?: string;
      direction?: PositionedEdge["direction"];
      showDirectionMarker: boolean;
    };

    const edgesToDraw: EdgeDrawData[] = [];

    const directedEdgeKeySet = new Set(
      edges.map((edge) => `${edge.source}::${edge.target}`),
    );

    for (const edge of edges) {
      const srcGeom = nodeGeometryById[edge.source];
      const tgtGeom = nodeGeometryById[edge.target];
      if (!srcGeom || !tgtGeom) continue;

      const srcAnchor = pointOnPerimeter(
        { x: srcGeom.x, y: srcGeom.y },
        { x: tgtGeom.x, y: tgtGeom.y },
        srcGeom.halfWidth,
        srcGeom.halfHeight,
      );
      const tgtAnchor = pointOnPerimeter(
        { x: tgtGeom.x, y: tgtGeom.y },
        { x: srcGeom.x, y: srcGeom.y },
        tgtGeom.halfWidth,
        tgtGeom.halfHeight,
      );

      const curve = buildOrganicCurve(srcAnchor, tgtAnchor);
      const finalCurve = {
        ...curve,
        x1: curve.x1 - offsetX,
        y1: curve.y1 - offsetY,
        x2: curve.x2 - offsetX,
        y2: curve.y2 - offsetY,
        cx1: curve.cx1 - offsetX,
        cy1: curve.cy1 - offsetY,
        cx2: curve.cx2 - offsetX,
        cy2: curve.cy2 - offsetY,
      };
      const edgeDepth = Math.max(
        depthById[edge.source] ?? 0,
        depthById[edge.target] ?? 0,
      );
      const edgeOpacity = Math.max(
        EDGE_VISUAL.minOpacity,
        1 - edgeDepth * EDGE_VISUAL.opacityStep,
      );
      const edgeWidth = Math.max(
        0.95,
        EDGE_VISUAL.baseWidth - edgeDepth * EDGE_VISUAL.widthDepthDrop,
      );
      const edgeColor = getEdgeDepthColor(edgeDepth);
      const isSelectedRelative = Boolean(selectedRelativeEdgeById[edge.id]);
      const hasReverseEdge = directedEdgeKeySet.has(
        `${edge.target}::${edge.source}`,
      );
      const showDirectionMarker = Boolean(
        edge.direction && edge.direction !== "undirected" && !hasReverseEdge,
      );

      edgesToDraw.push({
        curve: finalCurve,
        edgeOpacity,
        edgeWidth,
        edgeStroke: edgeColor.stroke,
        edgeGlow: edgeColor.glow,
        isSelectedRelative,
        label: edge.label,
        direction: edge.direction,
        showDirectionMarker,
      });
    }

    // Glow pass — all edges first so glow never bleeds onto strokes
    for (const data of edgesToDraw) {
      const { curve, edgeWidth, edgeGlow, edgeOpacity, isSelectedRelative } =
        data;

      ctx.save();
      ctx.strokeStyle = edgeGlow;
      ctx.lineWidth = isSelectedRelative ? edgeWidth + 2.6 : edgeWidth + 1.7;
      ctx.globalAlpha = isSelectedRelative
        ? edgeOpacity * 0.42
        : edgeOpacity * 0.2;
      ctx.shadowBlur = 3;
      ctx.shadowColor = edgeGlow;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      if (curve.isLine) {
        ctx.moveTo(curve.x1, curve.y1);
        ctx.lineTo(curve.x2, curve.y2);
      } else {
        ctx.moveTo(curve.x1, curve.y1);
        ctx.bezierCurveTo(
          curve.cx1,
          curve.cy1,
          curve.cx2,
          curve.cy2,
          curve.x2,
          curve.y2,
        );
      }
      ctx.stroke();
      ctx.restore();
    }

    // Stroke pass
    for (const data of edgesToDraw) {
      const { curve, edgeWidth, edgeStroke, edgeOpacity, isSelectedRelative } =
        data;

      ctx.save();
      ctx.strokeStyle = edgeStroke;
      ctx.lineWidth = isSelectedRelative ? edgeWidth + 0.5 : edgeWidth;
      ctx.globalAlpha = isSelectedRelative
        ? Math.min(1, edgeOpacity + 0.2)
        : edgeOpacity * 0.78;
      ctx.shadowBlur = 0;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      if (curve.isLine) {
        ctx.moveTo(curve.x1, curve.y1);
        ctx.lineTo(curve.x2, curve.y2);
      } else {
        ctx.moveTo(curve.x1, curve.y1);
        ctx.bezierCurveTo(
          curve.cx1,
          curve.cy1,
          curve.cx2,
          curve.cy2,
          curve.x2,
          curve.y2,
        );
      }
      ctx.stroke();
      ctx.restore();
    }

    // One-way direction marker pass (open arrowhead near flow destination)
    for (const data of edgesToDraw) {
      if (!data.showDirectionMarker || !data.direction) continue;

      const forward = data.direction === "outbound";
      const markerT = forward ? 0.78 : 0.22;
      const tip = getCurvePoint(data.curve, markerT);
      const sample = getCurvePoint(
        data.curve,
        markerT + (forward ? -0.06 : 0.06),
      );
      const vx = tip.x - sample.x;
      const vy = tip.y - sample.y;
      const len = Math.hypot(vx, vy);
      if (len < 0.001) continue;

      const ux = vx / len;
      const uy = vy / len;
      const arrowLength = Math.max(7, data.edgeWidth * 5.1);
      const arrowSpread = Math.max(4, data.edgeWidth * 2.8);
      const baseX = tip.x - ux * arrowLength;
      const baseY = tip.y - uy * arrowLength;
      const px = -uy;
      const py = ux;
      const leftX = baseX + px * arrowSpread;
      const leftY = baseY + py * arrowSpread;
      const rightX = baseX - px * arrowSpread;
      const rightY = baseY - py * arrowSpread;

      ctx.save();
      ctx.strokeStyle = data.edgeStroke;
      ctx.lineWidth = Math.max(1.1, data.edgeWidth + 0.15);
      ctx.globalAlpha = data.isSelectedRelative
        ? Math.min(1, data.edgeOpacity + 0.26)
        : Math.min(1, data.edgeOpacity * 0.96);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(leftX, leftY);
      ctx.lineTo(tip.x, tip.y);
      ctx.moveTo(rightX, rightY);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      ctx.restore();
    }

    // Label pass
    ctx.save();
    ctx.fillStyle = "rgba(67, 73, 88, 0.65)";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    for (const data of edgesToDraw) {
      if (!data.label) continue;
      const { curve } = data;
      const labelX = curve.isLine
        ? (curve.x1 + curve.x2) / 2
        : getCubicPointAt(curve.x1, curve.cx1, curve.cx2, curve.x2, 0.5);
      const labelY = curve.isLine
        ? (curve.y1 + curve.y2) / 2
        : getCubicPointAt(curve.y1, curve.cy1, curve.cy2, curve.y2, 0.5);
      ctx.fillText(data.label, labelX, labelY);
    }
    ctx.restore();
  }, [
    depthById,
    edges,
    height,
    nodeGeometryById,
    offsetX,
    offsetY,
    selectedRelativeEdgeById,
    width,
  ]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="edges-canvas"
    />
  );
});
