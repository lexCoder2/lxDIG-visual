import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  CAMERA_VISUAL,
  CANVAS,
  MAX_VISIBLE_SIBLINGS,
  NODE_WIDTH_BY_KIND,
} from "./config/constants";
import { CanvasControls } from "./components/controls/CanvasControls";
import { ProjectControl } from "./components/controls/ProjectControl";
import { GraphCanvas } from "./components/GraphCanvas";
import { GraphFooter } from "./components/GraphFooter";
import { useGraphController } from "./hooks/useGraphController";
import { getDepthVisual } from "./lib/graphVisuals";
import { computeLayoutTopology } from "./lib/layoutEngine";
import type { LayoutFrame, LayoutTopology } from "./lib/layoutEngine";
import { useGraphStore } from "./state/graphStore";
import type {
  GraphNodeEntity,
  PositionedNode,
  SemanticNodeType,
} from "./types/graph";
import { LogoIcon } from "./assets/LogoIcon";

const NODE_TYPE_FILTERS: SemanticNodeType[] = [
  "function",
  "class",
  "import",
  "export",
  "variable",
];

const STORAGE_KEYS = {
  motionSpeedFactor: "code-visual:motionSpeedFactor",
  connectionDepth: "code-visual:connectionDepth",
  nodeTypeFilters: "code-visual:nodeTypeFilters",
} as const;

const EMPTY_FRAME: LayoutFrame = { nodes: [], edges: [] };

type PendingLayout = {
  topology: LayoutTopology;
  filteredNodesById: Record<string, GraphNodeEntity>;
};

type WorkerResponse = {
  type: "POSITIONS";
  requestId: number;
  positionedById: Record<string, { x: number; y: number }>;
};

function readStoredNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function readStoredNodeTypeFilters(): Record<SemanticNodeType, boolean> {
  const fallback: Record<SemanticNodeType, boolean> = {
    function: true,
    class: true,
    import: true,
    export: true,
    variable: true,
  };

  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.nodeTypeFilters);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<
      Record<SemanticNodeType, boolean>
    >;
    return {
      function: parsed.function ?? true,
      class: parsed.class ?? true,
      import: parsed.import ?? true,
      export: parsed.export ?? true,
      variable: parsed.variable ?? true,
    };
  } catch {
    return fallback;
  }
}

function App() {
  const {
    mode,
    projectsQuery,
    graphState,
    selectedNode,
    selectProject,
    expandNode,
    changeSiblingPage,
    increaseDepth,
    decreaseDepth,
    autoRefreshEnabled,
    setAutoRefreshEnabled,
    isSyncing,
  } = useGraphController();
  const [motionSpeedFactor, setMotionSpeedFactor] = useState(() =>
    readStoredNumber(STORAGE_KEYS.motionSpeedFactor, 1.6),
  );
  const [nodeTypeFilters, setNodeTypeFilters] = useState(() =>
    readStoredNodeTypeFilters(),
  );

  // G: stable target frame (async, set by worker response)
  const [filteredLayoutFrame, setFilteredLayoutFrame] =
    useState<LayoutFrame>(EMPTY_FRAME);
  // animated interpolation frame (drives node positions during transitions)
  const [renderFrame, setRenderFrame] = useState<LayoutFrame>(EMPTY_FRAME);
  const [activeDraggedNodeId, setActiveDraggedNodeId] = useState<string | null>(
    null,
  );

  const renderFrameRef = useRef<LayoutFrame>(EMPTY_FRAME);
  const canvasRef = useRef<HTMLElement | null>(null);
  const cameraAnimationRef = useRef<number | null>(null);
  const layoutAnimationRef = useRef<number | null>(null);
  const draggingRef = useRef<{ active: boolean; x: number; y: number }>({
    active: false,
    x: 0,
    y: 0,
  });
  const nodeDragRef = useRef<{
    active: boolean;
    nodeId: string | null;
    x: number;
    y: number;
    moved: boolean;
  }>({
    active: false,
    nodeId: null,
    x: 0,
    y: 0,
    moved: false,
  });
  const suppressClickRef = useRef<string | null>(null);

  // B: ref to stable layout frame for camera effect — avoids positionById dep
  const layoutFrameRef = useRef<LayoutFrame>(EMPTY_FRAME);
  layoutFrameRef.current = filteredLayoutFrame;

  // G: worker refs
  const workerRef = useRef<Worker | null>(null);
  const workerRequestIdRef = useRef(0);
  const pendingLayoutRef = useRef<PendingLayout | null>(null);

  const stopAllDragging = () => {
    draggingRef.current.active = false;
    if (
      nodeDragRef.current.active &&
      nodeDragRef.current.nodeId &&
      nodeDragRef.current.moved
    ) {
      suppressClickRef.current = nodeDragRef.current.nodeId;
    }
    setActiveDraggedNodeId(null);
    nodeDragRef.current = {
      active: false,
      nodeId: null,
      x: 0,
      y: 0,
      moved: false,
    };
  };

  const stopCameraAnimation = () => {
    if (cameraAnimationRef.current !== null) {
      cancelAnimationFrame(cameraAnimationRef.current);
      cameraAnimationRef.current = null;
    }
  };

  const stopLayoutAnimation = () => {
    if (layoutAnimationRef.current !== null) {
      cancelAnimationFrame(layoutAnimationRef.current);
      layoutAnimationRef.current = null;
    }
  };

  useEffect(() => {
    const handlePointerRelease = () => {
      stopAllDragging();
    };

    window.addEventListener("pointerup", handlePointerRelease);
    window.addEventListener("pointercancel", handlePointerRelease);
    return () => {
      window.removeEventListener("pointerup", handlePointerRelease);
      window.removeEventListener("pointercancel", handlePointerRelease);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        STORAGE_KEYS.motionSpeedFactor,
        String(motionSpeedFactor),
      );
    } catch {
      // ignore storage failures
    }
  }, [motionSpeedFactor]);

  useEffect(() => {
    const storedDepth = Math.round(
      readStoredNumber(
        STORAGE_KEYS.connectionDepth,
        graphState.connectionDepth,
      ),
    );
    if (storedDepth !== graphState.connectionDepth) {
      graphState.setConnectionDepth(storedDepth);
    }
    // run once at init
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        STORAGE_KEYS.connectionDepth,
        String(graphState.connectionDepth),
      );
    } catch {
      // ignore storage failures
    }
  }, [graphState.connectionDepth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        STORAGE_KEYS.nodeTypeFilters,
        JSON.stringify(nodeTypeFilters),
      );
    } catch {
      // ignore storage failures
    }
  }, [nodeTypeFilters]);

  // G: initialize the layout worker once
  useEffect(() => {
    const worker = new Worker(
      new URL("./lib/layoutWorker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    worker.addEventListener(
      "message",
      (event: MessageEvent<WorkerResponse>) => {
        const { type, requestId, positionedById } = event.data;
        if (type !== "POSITIONS") return;
        // discard stale responses from superseded requests
        if (requestId !== workerRequestIdRef.current) return;

        const pending = pendingLayoutRef.current;
        if (!pending) return;

        const { topology, filteredNodesById } = pending;
        const manualPositions = useGraphStore.getState().manualPositions;
        const centerX = CANVAS.width / 2;
        const centerY = CANVAS.height / 2;

        const positionedNodes = topology.visibleNodeIds.reduce<
          PositionedNode[]
        >((acc, id) => {
          const node = filteredNodesById[id];
          if (!node) return acc;
          const pos = positionedById[id];
          acc.push({
            id: node.id,
            label: node.label,
            kind: node.kind,
            semanticType: node.semanticType,
            depth: topology.depthByNodeId[id] ?? 0,
            x: manualPositions[id]?.x ?? pos?.x ?? centerX,
            y: manualPositions[id]?.y ?? pos?.y ?? centerY,
            loading: node.loading,
            error: node.error,
          });
          return acc;
        }, []);

        // same sort order as layoutEngine.ts depthSort
        positionedNodes.sort(
          (a, b) => a.depth - b.depth || a.label.localeCompare(b.label),
        );

        setFilteredLayoutFrame({
          nodes: positionedNodes,
          edges: topology.visibleEdges,
        });
      },
    );

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []); // run once

  // C: narrow deps — exclude viewport so pan/zoom don't trigger layout
  // A: use explicit store fields, not the full graphState object
  const pendingLayout = useMemo((): PendingLayout | null => {
    const rootNodeId = graphState.focusedNodeId ?? graphState.rootNodeId;
    if (!rootNodeId) return null;

    const excludedNodeIds = new Set<string>();

    const excludeSubtree = (nodeId: string) => {
      if (excludedNodeIds.has(nodeId)) return;
      excludedNodeIds.add(nodeId);
      (graphState.childIdsByParent[nodeId] ?? []).forEach((childId) => {
        excludeSubtree(childId);
      });
    };

    Object.values(graphState.nodesById).forEach((node) => {
      const semanticType = node.semanticType;
      if (!semanticType) return;
      if (nodeTypeFilters[semanticType]) return;
      excludeSubtree(node.id);
    });

    const filteredNodesById = Object.entries(graphState.nodesById).reduce<
      Record<string, GraphNodeEntity>
    >((acc, [nodeId, node]) => {
      if (!excludedNodeIds.has(nodeId)) {
        acc[nodeId] = node;
      }
      return acc;
    }, {});

    const visibleNodeIds = new Set(Object.keys(filteredNodesById));

    const filteredEdgesById = Object.entries(graphState.edgesById).reduce<
      typeof graphState.edgesById
    >((acc, [edgeId, edge]) => {
      if (visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)) {
        acc[edgeId] = edge;
      }
      return acc;
    }, {});

    const filteredChildrenByParent = Object.entries(
      graphState.childIdsByParent,
    ).reduce<typeof graphState.childIdsByParent>(
      (acc, [parentId, childIds]) => {
        if (!visibleNodeIds.has(parentId)) return acc;
        acc[parentId] = childIds.filter((childId) =>
          visibleNodeIds.has(childId),
        );
        return acc;
      },
      {},
    );

    // topology = synchronous BFS only, no force simulation (G)
    const topology = computeLayoutTopology({
      rootNodeId,
      connectionDepth: graphState.connectionDepth,
      nodesById: filteredNodesById,
      edgesById: filteredEdgesById,
      childIdsByParent: filteredChildrenByParent,
      siblingPageByParent: graphState.siblingPageByParent,
      manualPositions: {}, // not used by topology BFS
    });

    if (!topology) return null;

    return { topology, filteredNodesById };
  }, [
    // C: explicit fields — viewport excluded
    graphState.nodesById,
    graphState.edgesById,
    graphState.childIdsByParent,
    graphState.focusedNodeId,
    graphState.rootNodeId,
    graphState.connectionDepth,
    graphState.siblingPageByParent,
    nodeTypeFilters,
  ]);

  // G: post to worker whenever topology changes
  useEffect(() => {
    if (!pendingLayout || !workerRef.current) return;

    const requestId = ++workerRequestIdRef.current;
    pendingLayoutRef.current = pendingLayout;

    const { topology, filteredNodesById } = pendingLayout;
    workerRef.current.postMessage({
      type: "LAYOUT",
      requestId,
      visibleNodeIds: topology.visibleNodeIds,
      depthByNodeId: topology.depthByNodeId,
      nodesById: filteredNodesById,
      childIdsByParent: topology.childIdsByParent,
      edges: topology.visibleEdges,
      rootNodeId: topology.rootNodeId,
    });
  }, [pendingLayout]);

  // D: depthById from filteredLayoutFrame (not store's removed frame field)
  const depthById = useMemo(() => {
    const map: Record<string, number> = {};
    filteredLayoutFrame.nodes.forEach((node) => {
      map[node.id] = node.depth;
    });
    return map;
  }, [filteredLayoutFrame.nodes]);

  const activeProjectId = graphState.projectId ?? "";
  const selectedNodeId = graphState.selectedNodeId;
  const lastVisitedNodeId = graphState.lastVisitedNodeId;
  const focusedNodeId = graphState.focusedNodeId;
  const connectionChip =
    mode === "mock"
      ? { label: "Mock Data", tone: "mock" as const }
      : graphState.syncStatus === "error"
        ? { label: "Disconnected", tone: "disconnected" as const }
        : { label: "Connected", tone: "connected" as const };

  // A: depend on filteredLayoutFrame.edges (stable target), not renderFrame.edges
  const loopBridgeNodeById = useMemo(() => {
    const neighborById: Record<string, string[]> = {};
    filteredLayoutFrame.edges.forEach((edge) => {
      neighborById[edge.source] = neighborById[edge.source] ?? [];
      neighborById[edge.target] = neighborById[edge.target] ?? [];
      neighborById[edge.source].push(edge.target);
      neighborById[edge.target].push(edge.source);
    });

    const result: Record<string, boolean> = {};

    Object.entries(neighborById).forEach(([nodeId, neighbors]) => {
      const nodeDepth = depthById[nodeId] ?? 0;
      const lowerDepthCount = neighbors.filter(
        (neighborId) => (depthById[neighborId] ?? 0) < nodeDepth,
      ).length;
      const sameDepthCount = neighbors.filter(
        (neighborId) => (depthById[neighborId] ?? 0) === nodeDepth,
      ).length;
      const jumpDepthCount = neighbors.filter(
        (neighborId) => Math.abs((depthById[neighborId] ?? 0) - nodeDepth) > 1,
      ).length;

      if (lowerDepthCount > 1 || sameDepthCount > 0 || jumpDepthCount > 0) {
        result[nodeId] = true;
      }
    });

    return result;
  }, [depthById, filteredLayoutFrame.edges]);

  // A: depend on filteredLayoutFrame.edges (stable target), not renderFrame.edges
  const selectedRelativeNodeById = useMemo(() => {
    const result: Record<string, boolean> = {};
    const selectedId = selectedNodeId;
    if (!selectedId) return result;

    filteredLayoutFrame.edges.forEach((edge) => {
      if (edge.source === selectedId) {
        result[edge.target] = true;
      }
      if (edge.target === selectedId) {
        result[edge.source] = true;
      }
    });

    return result;
  }, [filteredLayoutFrame.edges, selectedNodeId]);

  // A: depend on filteredLayoutFrame.edges (stable target), not renderFrame.edges
  const selectedRelativeEdgeById = useMemo(() => {
    const result: Record<string, boolean> = {};
    const selectedId = selectedNodeId;
    if (!selectedId) return result;

    filteredLayoutFrame.edges.forEach((edge) => {
      if (edge.source === selectedId || edge.target === selectedId) {
        result[edge.id] = true;
      }
    });

    return result;
  }, [filteredLayoutFrame.edges, selectedNodeId]);

  // F: collectDragPropagationUpdates reads adjacency from store (no useMemo rebuild)
  const collectDragPropagationUpdates = (params: {
    nodeId: string;
    deltaX: number;
    deltaY: number;
    sourcePosition: { x: number; y: number };
    basePositionsById: Record<string, { x: number; y: number }>;
  }): Record<string, { x: number; y: number }> => {
    const { nodeId, deltaX, deltaY, sourcePosition, basePositionsById } =
      params;

    const currentNodes = renderFrameRef.current.nodes;
    const sourceNode = currentNodes.find((node) => node.id === nodeId);
    if (!sourceNode) return {};

    const snapshot = useGraphStore.getState();
    const sourceScale = getDepthVisual(sourceNode.depth).scale;
    const sourceCanvasWidth =
      NODE_WIDTH_BY_KIND[sourceNode.kind] *
      sourceScale *
      snapshot.viewport.scale;
    const sourceDepth = depthById[nodeId] ?? sourceNode.depth;
    const maxCanvasDistancePx = Math.max(
      72,
      sourceCanvasWidth *
        (2.4 + Math.max(0, snapshot.connectionDepth - 1) * 0.55),
    );

    // F: read adjacency from store, not a rebuilt useMemo
    const storeAdjacency = snapshot.adjacencyByNode;

    const updates: Record<string, { x: number; y: number }> = {};
    const queue: Array<{ id: string; transmission: number; depth: number }> = [
      { id: nodeId, transmission: 1, depth: sourceDepth },
    ];
    const visited = new Set<string>([nodeId]);
    const minInfluence = 0.004;

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;

      const neighbors = storeAdjacency[current.id] ?? [];
      neighbors.forEach((neighborId) => {
        if (visited.has(neighborId)) return;
        visited.add(neighborId);

        const neighborPosition = basePositionsById[neighborId];
        if (!neighborPosition) return;

        const neighborDepth = depthById[neighborId] ?? current.depth;
        const depthDeltaFromSource = Math.max(0, neighborDepth - sourceDepth);
        const isDeeperThanCurrent = neighborDepth > current.depth;
        const isShallowerThanCurrent = neighborDepth < current.depth;

        const distX = neighborPosition.x - sourcePosition.x;
        const distY = neighborPosition.y - sourcePosition.y;
        const worldDistance = Math.hypot(distX, distY);
        const canvasDistance = worldDistance * snapshot.viewport.scale;
        if (canvasDistance > maxCanvasDistancePx) return;

        const normalizedDistance = Math.min(
          1,
          Math.max(0, canvasDistance / maxCanvasDistancePx),
        );
        const squareFalloff = Math.pow(1 - normalizedDistance, 2);
        const depthUniformBoost =
          1 + Math.min(0.55, depthDeltaFromSource * 0.14);
        const directionBias = isDeeperThanCurrent
          ? 1.12
          : isShallowerThanCurrent
            ? 0.82
            : 1;
        const influence = Math.min(
          1,
          1 *
            squareFalloff *
            current.transmission *
            depthUniformBoost *
            directionBias,
        );
        if (influence < minInfluence) return;

        const smoothFactor = Math.min(0.99, 0.96 + depthDeltaFromSource * 0.01);
        const moveX = deltaX * influence * smoothFactor;
        const moveY = deltaY * influence * smoothFactor;

        updates[neighborId] = {
          x: neighborPosition.x + moveX,
          y: neighborPosition.y + moveY,
        };

        queue.push({
          id: neighborId,
          transmission:
            current.transmission * (isShallowerThanCurrent ? 0.86 : 0.95),
          depth: neighborDepth,
        });
      });
    }

    return updates;
  };

  // layout animation: interpolate renderFrame toward filteredLayoutFrame
  useEffect(() => {
    const targetFrame = filteredLayoutFrame;
    const currentFrame = renderFrameRef.current;
    const commitFrame = (frame: typeof targetFrame) => {
      layoutAnimationRef.current = requestAnimationFrame(() => {
        setRenderFrame(frame);
        renderFrameRef.current = frame;
        layoutAnimationRef.current = null;
      });
    };

    if (draggingRef.current.active || nodeDragRef.current.active) {
      stopLayoutAnimation();
      commitFrame(targetFrame);
      return;
    }

    if (targetFrame.nodes.length === 0 || currentFrame.nodes.length === 0) {
      stopLayoutAnimation();
      commitFrame(targetFrame);
      return;
    }

    const currentById = currentFrame.nodes.reduce<
      Record<string, { x: number; y: number }>
    >((acc, node) => {
      acc[node.id] = { x: node.x, y: node.y };
      return acc;
    }, {});

    const shouldAnimate = targetFrame.nodes.some((node) => {
      const current = currentById[node.id];
      if (!current) return false;
      return (
        Math.abs(current.x - node.x) > 0.5 || Math.abs(current.y - node.y) > 0.5
      );
    });

    if (!shouldAnimate) {
      stopLayoutAnimation();
      commitFrame(targetFrame);
      return;
    }

    stopLayoutAnimation();

    const durationMs = 280;
    const start = performance.now();

    const tick = (timestamp: number) => {
      const elapsed = timestamp - start;
      const t = Math.min(1, elapsed / durationMs);
      // L: cubic ease-in-out instead of linear
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      const interpolatedNodes = targetFrame.nodes.map((targetNode) => {
        const current = currentById[targetNode.id];
        if (!current) return targetNode;

        return {
          ...targetNode,
          x: current.x + (targetNode.x - current.x) * k,
          y: current.y + (targetNode.y - current.y) * k,
        };
      });

      setRenderFrame({
        nodes: interpolatedNodes,
        edges: targetFrame.edges,
      });
      renderFrameRef.current = {
        nodes: interpolatedNodes,
        edges: targetFrame.edges,
      };

      if (t < 1) {
        layoutAnimationRef.current = requestAnimationFrame(tick);
      } else {
        layoutAnimationRef.current = null;
      }
    };

    layoutAnimationRef.current = requestAnimationFrame(tick);

    return () => {
      stopLayoutAnimation();
    };
  }, [filteredLayoutFrame]);

  useEffect(() => {
    return () => {
      stopLayoutAnimation();
    };
  }, []);

  const selectedNodeTotal = selectedNode
    ? (graphState.childTotalByParent[selectedNode.id] ?? 0)
    : 0;
  const selectedPage = selectedNode
    ? (graphState.siblingPageByParent[selectedNode.id] ?? 0)
    : 0;
  const selectedPageCount = Math.max(
    1,
    Math.ceil(selectedNodeTotal / MAX_VISIBLE_SIBLINGS),
  );

  // B: camera reads position from layoutFrameRef (always current, no positionById dep)
  // filteredLayoutFrame dep added to handle initial data load (fires once per worker result)
  useEffect(() => {
    const focusId = focusedNodeId;
    if (!focusId) return;

    const focusNode = layoutFrameRef.current.nodes.find(
      (n) => n.id === focusId,
    );
    if (!focusNode || !canvasRef.current) return;
    if (draggingRef.current.active || nodeDragRef.current.active) return;

    stopCameraAnimation();

    const snapshot = useGraphStore.getState();
    const rect = canvasRef.current.getBoundingClientRect();
    const scale = snapshot.viewport.scale;
    const startX = snapshot.viewport.x;
    const startY = snapshot.viewport.y;
    const targetX = rect.width / 2 - focusNode.x * scale;
    const targetY = rect.height / 2 - focusNode.y * scale;
    const duration = CAMERA_VISUAL.focusDurationMs * motionSpeedFactor * 0.7;
    const start = performance.now();

    const animate = (timestamp: number) => {
      const elapsed = timestamp - start;
      const t = Math.min(1, elapsed / duration);
      // L: cubic ease-in-out
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      useGraphStore.getState().setViewport({
        scale,
        x: startX + (targetX - startX) * k,
        y: startY + (targetY - startY) * k,
      });

      if (t < 1) {
        cameraAnimationRef.current = requestAnimationFrame(animate);
      } else {
        cameraAnimationRef.current = null;
      }
    };

    cameraAnimationRef.current = requestAnimationFrame(animate);

    return () => {
      stopCameraAnimation();
    };
  }, [focusedNodeId, motionSpeedFactor, filteredLayoutFrame]); // B: no positionById

  return (
    <main className="app-shell theme-neumorph">
      <header className="app-header">
        <div className="app-header-title-wrap">
          <LogoIcon size={26} className="app-header-logo" />
          <h1 className="app-header-title">Code Visual</h1>
          <span className={`app-header-chip ${connectionChip.tone}`}>
            {connectionChip.label}
          </span>
        </div>
        <ProjectControl
          activeProjectId={activeProjectId}
          projects={projectsQuery.data ?? []}
          disabled={projectsQuery.isLoading || projectsQuery.isError}
          onSelectProject={selectProject}
        />
      </header>

      {projectsQuery.isError ? (
        <p className="hint error-text">Failed to load projects.</p>
      ) : null}

      <GraphCanvas
        frame={renderFrame}
        viewport={graphState.viewport}
        selectedNodeId={selectedNodeId}
        lastVisitedNodeId={lastVisitedNodeId}
        depthById={depthById}
        loopBridgeNodeById={loopBridgeNodeById}
        selectedRelativeNodeById={selectedRelativeNodeById}
        selectedRelativeEdgeById={selectedRelativeEdgeById}
        activeDraggedNodeId={activeDraggedNodeId}
        controlsOverlay={
          <CanvasControls
            syncStatus={graphState.syncStatus}
            isSyncing={isSyncing}
            autoRefreshEnabled={autoRefreshEnabled}
            connectionDepth={graphState.connectionDepth}
            motionSpeedFactor={motionSpeedFactor}
            nodeTypeFilters={nodeTypeFilters}
            nodeTypeFilterOrder={NODE_TYPE_FILTERS}
            onToggleAutoRefresh={() => setAutoRefreshEnabled((value) => !value)}
            onDepthUp={increaseDepth}
            onDepthDown={decreaseDepth}
            onChangeMotion={setMotionSpeedFactor}
            onToggleNodeTypeFilter={(type) => {
              setNodeTypeFilters((current) => ({
                ...current,
                [type]: !current[type],
              }));
            }}
          />
        }
        setCanvasRef={(node) => {
          canvasRef.current = node;
        }}
        onCanvasContextMenu={(event) => {
          event.preventDefault();
        }}
        onCanvasWheel={(event) => {
          event.preventDefault();
          graphState.zoom(
            event.deltaY < 0 ? 1 : -1,
            event.clientX,
            event.clientY,
          );
        }}
        onCanvasPointerDown={(event) => {
          if (event.button !== 2) return;
          stopCameraAnimation();
          event.currentTarget.setPointerCapture(event.pointerId);
          draggingRef.current = {
            active: true,
            x: event.clientX,
            y: event.clientY,
          };
        }}
        onCanvasPointerMove={(event) => {
          if (nodeDragRef.current.active && nodeDragRef.current.nodeId) {
            const nodeId = nodeDragRef.current.nodeId;
            const snapshot = useGraphStore.getState();
            const currentNodes = renderFrameRef.current.nodes;
            const currentNode = currentNodes.find((n) => n.id === nodeId);
            const currentPosition =
              snapshot.manualPositions[nodeId] ??
              (currentNode ? { x: currentNode.x, y: currentNode.y } : null);
            if (!currentPosition) return;

            const deltaX =
              (event.clientX - nodeDragRef.current.x) /
              graphState.viewport.scale;
            const deltaY =
              (event.clientY - nodeDragRef.current.y) /
              graphState.viewport.scale;
            nodeDragRef.current.x = event.clientX;
            nodeDragRef.current.y = event.clientY;

            if (Math.abs(deltaX) > 0.1 || Math.abs(deltaY) > 0.1) {
              nodeDragRef.current.moved = true;
            }

            const sourceNextPosition = {
              x: currentPosition.x + deltaX,
              y: currentPosition.y + deltaY,
            };

            const basePositionsById = currentNodes.reduce<
              Record<string, { x: number; y: number }>
            >((acc, node) => {
              const manualPosition = snapshot.manualPositions[node.id];
              acc[node.id] = manualPosition ?? { x: node.x, y: node.y };
              return acc;
            }, {});

            basePositionsById[nodeId] = sourceNextPosition;

            const neighborUpdates = collectDragPropagationUpdates({
              nodeId,
              deltaX,
              deltaY,
              sourcePosition: sourceNextPosition,
              basePositionsById,
            });

            const allPositionUpdates = {
              [nodeId]: sourceNextPosition,
              ...neighborUpdates,
            };

            graphState.setManualPositionsBatch(allPositionUpdates);

            // Directly update filteredLayoutFrame for edge anchors during drag
            setFilteredLayoutFrame((prev) => {
              if (prev.nodes.length === 0) return prev;
              return {
                nodes: prev.nodes.map((n) => {
                  const pos = allPositionUpdates[n.id];
                  return pos ? { ...n, x: pos.x, y: pos.y } : n;
                }),
                edges: prev.edges,
              };
            });

            return;
          }

          if (!draggingRef.current.active) return;
          const deltaX = event.clientX - draggingRef.current.x;
          const deltaY = event.clientY - draggingRef.current.y;
          draggingRef.current = {
            active: true,
            x: event.clientX,
            y: event.clientY,
          };
          graphState.pan(deltaX, deltaY);
        }}
        onCanvasPointerUp={stopAllDragging}
        onCanvasPointerCancel={stopAllDragging}
        onCanvasPointerLeave={stopAllDragging}
        onNodePointerDown={(nodeId, event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          stopCameraAnimation();
          event.currentTarget.setPointerCapture(event.pointerId);
          nodeDragRef.current = {
            active: true,
            nodeId,
            x: event.clientX,
            y: event.clientY,
            moved: false,
          };
          setActiveDraggedNodeId(nodeId);
        }}
        onNodePointerUp={(event) => {
          event.stopPropagation();
          stopAllDragging();
        }}
        onNodePointerCancel={(event) => {
          event.stopPropagation();
          stopAllDragging();
        }}
        onNodeClick={(nodeId) => {
          if (suppressClickRef.current === nodeId) {
            suppressClickRef.current = null;
            return;
          }

          graphState.setSelectedNode(nodeId);
        }}
        onNodeDoubleClick={(nodeId) => {
          graphState.setNodeExpanded(nodeId, true);
          expandNode(nodeId);
        }}
      />

      <GraphFooter
        selectedNode={selectedNode}
        selectedNodeTotal={selectedNodeTotal}
        selectedPage={selectedPage}
        selectedPageCount={selectedPageCount}
        isSyncing={isSyncing}
        onChangeSiblingPage={changeSiblingPage}
      />
    </main>
  );
}

export default App;
