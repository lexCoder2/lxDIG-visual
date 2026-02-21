import {
  useMemo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  CANVAS,
  NODE_HEIGHT_BY_KIND,
  NODE_WIDTH_BY_KIND,
} from "../config/constants";
import { getDepthVisual, getStructuredNodeLabel } from "../lib/graphVisuals";
import type { LayoutFrame } from "../lib/layoutEngine";
import type {
  PositionedNode,
  SemanticNodeType,
  ViewportState,
} from "../types/graph";
import { EdgeCanvas } from "./EdgeCanvas";

function getKindIndicator(kind: PositionedNode["kind"]): {
  icon: string;
  label: string;
} {
  switch (kind) {
    case "layer":
      return { icon: "🗂️", label: "Layer" };
    case "module":
      return { icon: "📁", label: "Module" };
    case "service":
      return { icon: "⚙️", label: "Service" };
    case "file":
      return { icon: "📄", label: "File" };
    default:
      return { icon: "•", label: "Node" };
  }
}

function getSemanticIndicator(semanticType?: SemanticNodeType): {
  icon: string;
  label: string;
} | null {
  if (!semanticType) return null;

  switch (semanticType) {
    case "function":
      return { icon: "ƒ", label: "Function" };
    case "class":
      return { icon: "C", label: "Class" };
    case "import":
      return { icon: "↘", label: "Import" };
    case "export":
      return { icon: "↗", label: "Export" };
    case "variable":
      return { icon: "𝑥", label: "Variable" };
    default:
      return null;
  }
}

type GraphCanvasProps = {
  frame: LayoutFrame;
  viewport: ViewportState;
  selectedNodeId: string | null;
  lastVisitedNodeId: string | null;
  depthById: Record<string, number>;
  loopBridgeNodeById: Record<string, boolean>;
  selectedRelativeNodeById: Record<string, boolean>;
  selectedRelativeEdgeById: Record<string, boolean>;
  activeDraggedNodeId: string | null;
  controlsOverlay?: ReactNode;
  setCanvasRef: (node: HTMLElement | null) => void;
  onCanvasContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onCanvasWheel: (event: ReactWheelEvent<HTMLElement>) => void;
  onCanvasPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onCanvasPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onCanvasPointerUp: () => void;
  onCanvasPointerCancel: () => void;
  onCanvasPointerLeave: () => void;
  onNodePointerDown: (
    nodeId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onNodePointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onNodePointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onNodeClick: (nodeId: string) => void;
  onNodeDoubleClick: (nodeId: string) => void;
};

function isVisible(
  nodeX: number,
  nodeY: number,
  halfW: number,
  halfH: number,
  viewport: ViewportState,
): boolean {
  const sx = nodeX * viewport.scale + viewport.x;
  const sy = nodeY * viewport.scale + viewport.y;
  const sw = halfW * viewport.scale + 8;
  const sh = halfH * viewport.scale + 8;
  return (
    sx + sw > 0 &&
    sx - sw < CANVAS.width &&
    sy + sh > 0 &&
    sy - sh < CANVAS.height
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  const {
    frame,
    viewport,
    selectedNodeId,
    lastVisitedNodeId,
    depthById,
    loopBridgeNodeById,
    selectedRelativeNodeById,
    selectedRelativeEdgeById,
    activeDraggedNodeId,
    controlsOverlay,
    setCanvasRef,
    onCanvasContextMenu,
    onCanvasWheel,
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerCancel,
    onCanvasPointerLeave,
    onNodePointerDown,
    onNodePointerUp,
    onNodePointerCancel,
    onNodeClick,
    onNodeDoubleClick,
  } = props;

  const worldBounds = useMemo(() => {
    if (frame.nodes.length === 0) {
      return {
        left: 0,
        top: 0,
        width: CANVAS.width,
        height: CANVAS.height,
      };
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    frame.nodes.forEach((node) => {
      const visual = getDepthVisual(node.depth);
      const halfWidth = (NODE_WIDTH_BY_KIND[node.kind] * visual.scale) / 2;
      const halfHeight = (NODE_HEIGHT_BY_KIND[node.kind] * visual.scale) / 2;

      minX = Math.min(minX, node.x - halfWidth);
      minY = Math.min(minY, node.y - halfHeight);
      maxX = Math.max(maxX, node.x + halfWidth);
      maxY = Math.max(maxY, node.y + halfHeight);
    });

    const padding = 360;
    const left = Math.min(0, minX - padding);
    const top = Math.min(0, minY - padding);
    const right = Math.max(CANVAS.width, maxX + padding);
    const bottom = Math.max(CANVAS.height, maxY + padding);

    return {
      left,
      top,
      width: Math.max(CANVAS.width, right - left),
      height: Math.max(CANVAS.height, bottom - top),
    };
  }, [frame.nodes]);

  // Keep edge geometry in sync with rendered node positions.
  const nodeGeometryById = useMemo(
    () =>
      frame.nodes.reduce<
        Record<
          string,
          {
            x: number;
            y: number;
            halfWidth: number;
            halfHeight: number;
            depth: number;
          }
        >
      >((acc, node) => {
        const visual = getDepthVisual(node.depth);
        const width = NODE_WIDTH_BY_KIND[node.kind] * visual.scale;
        const height = NODE_HEIGHT_BY_KIND[node.kind] * visual.scale;

        acc[node.id] = {
          x: node.x,
          y: node.y,
          halfWidth: width / 2,
          halfHeight: height / 2,
          depth: node.depth,
        };

        return acc;
      }, {}),
    [frame.nodes],
  );

  return (
    <section
      ref={setCanvasRef}
      className="canvas"
      role="application"
      aria-label="Project architecture graph"
      onContextMenu={onCanvasContextMenu}
      onWheel={onCanvasWheel}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerUp}
      onPointerCancel={onCanvasPointerCancel}
      onPointerLeave={onCanvasPointerLeave}
    >
      {controlsOverlay ? (
        <div className="canvas-controls-wrap">{controlsOverlay}</div>
      ) : null}
      <div
        className="graph-layer"
        style={{
          transform: `translate(${viewport.x + worldBounds.left * viewport.scale}px, ${viewport.y + worldBounds.top * viewport.scale}px) scale(${viewport.scale})`,
          width: `${worldBounds.width}px`,
          height: `${worldBounds.height}px`,
        }}
      >
        <EdgeCanvas
          edges={frame.edges}
          nodeGeometryById={nodeGeometryById}
          depthById={depthById}
          selectedRelativeEdgeById={selectedRelativeEdgeById}
          width={Math.ceil(worldBounds.width)}
          height={Math.ceil(worldBounds.height)}
          offsetX={worldBounds.left}
          offsetY={worldBounds.top}
        />

        {frame.nodes.map((node: PositionedNode) => {
          const width = NODE_WIDTH_BY_KIND[node.kind];
          const height = NODE_HEIGHT_BY_KIND[node.kind];
          const visual = getDepthVisual(node.depth);

          // I: skip off-screen nodes
          if (!isVisible(node.x, node.y, width / 2, height / 2, viewport)) {
            return null;
          }

          const structuredLabel = getStructuredNodeLabel(node.label, node.kind);
          const kindIndicator = getKindIndicator(node.kind);
          const semanticIndicator = getSemanticIndicator(node.semanticType);

          return (
            <button
              key={node.id}
              type="button"
              className={`node ${node.kind} ${node.id === selectedNodeId ? "active" : ""} ${node.id === lastVisitedNodeId ? "visited" : ""} ${loopBridgeNodeById[node.id] ? "loop-bridge" : ""} ${selectedRelativeNodeById[node.id] ? "relative" : ""} ${activeDraggedNodeId === node.id ? "dragging" : ""} ${node.depth >= 3 ? "far" : ""}`}
              style={{
                width: `${width}px`,
                height: `${height}px`,
                transform: `translate(${node.x - worldBounds.left - width / 2}px, ${node.y - worldBounds.top - height / 2}px) scale(${visual.scale})`,
                opacity: visual.opacity,
                zIndex: Math.max(1, 12 - node.depth),
                transformOrigin: "center center",
              }}
              onPointerDown={(event) => onNodePointerDown(node.id, event)}
              onPointerUp={onNodePointerUp}
              onPointerCancel={onNodePointerCancel}
              onClick={() => onNodeClick(node.id)}
              onDoubleClick={() => onNodeDoubleClick(node.id)}
            >
              <span className="node-indicators" aria-hidden="true">
                <span
                  className="node-kind-indicator"
                  title={kindIndicator.label}
                >
                  <span className="node-indicator-icon">
                    {kindIndicator.icon}
                  </span>
                  <span className="node-indicator-text">
                    {kindIndicator.label}
                  </span>
                </span>
                {semanticIndicator ? (
                  <span
                    className="node-semantic-indicator"
                    title={semanticIndicator.label}
                  >
                    <span className="node-indicator-icon">
                      {semanticIndicator.icon}
                    </span>
                    <span className="node-indicator-text">
                      {semanticIndicator.label}
                    </span>
                  </span>
                ) : null}
              </span>
              <span className="node-label-row">
                <span className="node-label-main">
                  {structuredLabel.primary}
                </span>
                {structuredLabel.extension ? (
                  <span className="node-label-ext">
                    .{structuredLabel.extension}
                  </span>
                ) : null}
              </span>
              {structuredLabel.secondary ? (
                <span className="node-label-sub">
                  {structuredLabel.secondary}
                </span>
              ) : null}
              {node.loading ? <small>Loading…</small> : null}
              {node.error ? (
                <small className="error">{node.error}</small>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
