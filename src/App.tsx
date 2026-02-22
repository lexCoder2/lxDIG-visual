import { useEffect, useMemo, useRef, useState } from "react";
import { FaMoon, FaSun } from "react-icons/fa";
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
import { NodeViewer } from "./components/NodeViewer";
import { useGraphController } from "./hooks/useGraphController";
import { getDepthVisual } from "./lib/graphVisuals";
import { computeLayoutTopology } from "./lib/layoutEngine";
import type { LayoutFrame, LayoutTopology } from "./lib/layoutEngine";
import { useGraphStore } from "./state/graphStore";
import type {
  GraphEdgeEntity,
  GraphNodeEntity,
  PositionedNode,
} from "./types/graph";
import { LogoIcon } from "./assets/LogoIcon";

const STORAGE_KEYS = {
  motionSpeedFactor: "code-visual:motionSpeedFactor",
  connectionDepth: "code-visual:connectionDepth",
  themeMode: "code-visual:themeMode",
} as const;

type ThemeMode = "light" | "dark";

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

function readStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "light";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.themeMode);
    return raw === "dark" ? "dark" : "light";
  } catch {
    return "light";
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

  // View mode and filters from store
  const viewMode = useGraphStore((state) => state.viewMode);
  const structureFilters = useGraphStore((state) => state.structureFilters);
  const architectureFilters = useGraphStore(
    (state) => state.architectureFilters,
  );
  const planFilters = useGraphStore((state) => state.planFilters);
  const documentationFilters = useGraphStore(
    (state) => state.documentationFilters,
  );
  const setViewMode = useGraphStore((state) => state.setViewMode);
  const setStructureFilters = useGraphStore(
    (state) => state.setStructureFilters,
  );
  const setArchitectureFilters = useGraphStore(
    (state) => state.setArchitectureFilters,
  );
  const setPlanFilters = useGraphStore((state) => state.setPlanFilters);
  const setDocumentationFilters = useGraphStore(
    (state) => state.setDocumentationFilters,
  );

  const [motionSpeedFactor, setMotionSpeedFactor] = useState(() =>
    readStoredNumber(STORAGE_KEYS.motionSpeedFactor, 1.6),
  );
  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>
    readStoredThemeMode(),
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
      window.localStorage.setItem(STORAGE_KEYS.themeMode, themeMode);
    } catch {
      // ignore storage failures
    }
  }, [themeMode]);

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
            visualKind: node.visualKind,
            semanticType: node.semanticType,
            status: node.status,
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

    const layerLinkedNodeIds = new Set<string>();
    const planTargetNodeIds = new Set<string>();
    const docsLinkedNodeIds = new Set<string>();
    Object.values(graphState.edgesById).forEach((edge) => {
      const relation = String(edge.label ?? "").toUpperCase();
      if (relation === "BELONGS_TO_LAYER" || relation === "VIOLATES_RULE") {
        layerLinkedNodeIds.add(edge.source);
        layerLinkedNodeIds.add(edge.target);
      }
      if (relation === "TARGETS") {
        planTargetNodeIds.add(edge.source);
        planTargetNodeIds.add(edge.target);
      }
      if (relation === "DOC_DESCRIBES") {
        docsLinkedNodeIds.add(edge.source);
        docsLinkedNodeIds.add(edge.target);
      }
    });

    // Phase 1: Structure view filtering
    if (viewMode === "structure") {
      Object.values(graphState.nodesById).forEach((node) => {
        if (node.id === rootNodeId) return;

        const semanticType = node.semanticType;
        const labels = node.labels || [];

        const isStructureNode =
          node.kind === "project" ||
          node.kind === "structure" ||
          node.kind === "code" ||
          labels.some((label) => {
            const value = String(label).toUpperCase();
            return (
              value === "FILE" ||
              value === "FOLDER" ||
              value === "FUNCTION" ||
              value === "CLASS" ||
              value === "IMPORT" ||
              value === "EXPORT" ||
              value === "VARIABLE" ||
              value === "TEST_SUITE"
            );
          });

        if (!isStructureNode) {
          excludeSubtree(node.id);
          return;
        }

        // Filter imports if showImports is false
        if (semanticType === "import" && !structureFilters.showImports) {
          excludeSubtree(node.id);
          return;
        }

        // Filter exports if showExports is false
        if (semanticType === "export" && !structureFilters.showExports) {
          excludeSubtree(node.id);
          return;
        }

        if (!structureFilters.showFiles) {
          const isFileNode =
            node.visualKind === "file" ||
            labels.some((l) => String(l).toUpperCase() === "FILE");

          if (isFileNode) {
            excludeSubtree(node.id);
            return;
          }
        }

        // Filter test nodes if showTests is false
        // Tests are identified by:
        // - Labels containing "TEST", "test", "Test"
        // - Node IDs containing "test" or "spec"
        // - SemanticType indicating test relationship
        if (!structureFilters.showTests) {
          const isTestNode =
            labels.some((l) => {
              const labelStr = String(l).toLowerCase();
              return labelStr.includes("test") || labelStr.includes("spec");
            }) ||
            node.id.toLowerCase().includes("test") ||
            node.id.toLowerCase().includes("spec") ||
            node.label.toLowerCase().includes(".test.") ||
            node.label.toLowerCase().includes(".spec.");

          if (isTestNode) {
            excludeSubtree(node.id);
            return;
          }
        }
      });
    }

    if (viewMode === "architecture") {
      Object.values(graphState.nodesById).forEach((node) => {
        if (node.id === rootNodeId) return;

        const isArchitectureNode =
          node.kind === "architecture" ||
          node.kind === "system" ||
          node.kind === "code" ||
          layerLinkedNodeIds.has(node.id);

        if (!isArchitectureNode) {
          excludeSubtree(node.id);
          return;
        }

        if (
          architectureFilters.showViolationsOnly &&
          !(node.labels ?? []).some((label) =>
            String(label).toLowerCase().includes("violation"),
          )
        ) {
          excludeSubtree(node.id);
        }
      });
    }

    // Phase 4: Plan view filtering
    if (viewMode === "plan") {
      Object.values(graphState.nodesById).forEach((node) => {
        if (node.id === rootNodeId) return;

        const status = node.status;
        const kind = node.kind;
        const labels = node.labels || [];
        const isProgressNode =
          kind === "progress" ||
          labels.some((label) => {
            const value = String(label).toUpperCase();
            return value === "FEATURE" || value === "TASK";
          });

        if (!isProgressNode) {
          if (
            planFilters.showImplementingFiles &&
            planTargetNodeIds.has(node.id)
          ) {
            return;
          }
          excludeSubtree(node.id);
          return;
        }

        // Only filter progress nodes (FEATURE, TASK)
        if (status) {
          // Filter by status
          if (planFilters.statusFilter !== "all") {
            if (status !== planFilters.statusFilter) {
              excludeSubtree(node.id);
              return;
            }
          }

          // Filter by feature focus (if a specific feature is selected)
          if (planFilters.featureFocusId) {
            const isFeature = labels.includes("FEATURE");
            const isMatchingFeature = node.id === planFilters.featureFocusId;

            // Only show the selected feature and its related nodes
            // For now, we'll keep all nodes if a feature is selected
            // A more sophisticated implementation would check relationships
            if (isFeature && !isMatchingFeature) {
              excludeSubtree(node.id);
              return;
            }
          }
        }
      });
    }

    if (viewMode === "documentation") {
      Object.values(graphState.nodesById).forEach((node) => {
        if (node.id === rootNodeId) return;

        const labels = node.labels || [];
        const kind = node.kind;
        const isDocNode =
          kind === "docs" ||
          labels.some((label) => {
            const value = String(label).toUpperCase();
            return value === "DOCUMENT" || value === "SECTION";
          });
        const isLinkedCodeNode =
          documentationFilters.showLinkedCode &&
          (kind === "code" || kind === "structure") &&
          docsLinkedNodeIds.has(node.id);

        if (!isDocNode && !isLinkedCodeNode) {
          excludeSubtree(node.id);
          return;
        }

        if (documentationFilters.kindFilter !== "all" && isDocNode) {
          const matchesKind = labels.some((label) => {
            const value = String(label).toLowerCase();
            return value === documentationFilters.kindFilter;
          });
          if (!matchesKind) {
            excludeSubtree(node.id);
          }
        }
      });
    }

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
      Record<string, GraphEdgeEntity>
    >((acc, [edgeId, edge]) => {
      if (visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)) {
        acc[edgeId] = edge;
      }
      return acc;
    }, {});

    const filteredChildrenByParent = Object.entries(
      graphState.childIdsByParent,
    ).reduce<Record<string, string[]>>((acc, [parentId, childIds]) => {
      if (!visibleNodeIds.has(parentId)) return acc;
      acc[parentId] = childIds.filter((childId) => visibleNodeIds.has(childId));
      return acc;
    }, {});

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
    viewMode,
    structureFilters,
    planFilters,
    architectureFilters,
    documentationFilters,
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

  // Calculate filter stats for visual feedback
  const totalNodes = Object.keys(graphState.nodesById).length;
  const visibleNodes = pendingLayout
    ? Object.keys(pendingLayout.filteredNodesById).length
    : totalNodes;

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

  const mainParentNodeById = useMemo(() => {
    const result: Record<string, boolean> = {};
    const mainNodeId = graphState.focusedNodeId ?? graphState.rootNodeId;
    if (!mainNodeId) return result;

    filteredLayoutFrame.edges.forEach((edge) => {
      if (edge.target === mainNodeId) {
        result[edge.source] = true;
      }
    });

    return result;
  }, [
    filteredLayoutFrame.edges,
    graphState.focusedNodeId,
    graphState.rootNodeId,
  ]);

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
      NODE_WIDTH_BY_KIND[sourceNode.visualKind] *
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
    <main
      className={`app-shell ${themeMode === "dark" ? "theme-dark" : "theme-neumorph"}`}
    >
      <header className="app-header">
        <div className="app-header-title-wrap">
          <LogoIcon size={26} className="app-header-logo" />
          <h1 className="app-header-title">Code Visual</h1>
          <button
            type="button"
            role="switch"
            aria-label="Toggle dark theme"
            aria-checked={themeMode === "dark"}
            className={`app-theme-toggle ${themeMode === "dark" ? "on" : "off"}`}
            onClick={() => {
              setThemeMode((mode) => (mode === "dark" ? "light" : "dark"));
            }}
          >
            {themeMode === "dark" ? <FaMoon size={12} /> : <FaSun size={12} />}
          </button>
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

      <div className="workspace-split">
        <div className="canvas-pane">
          <GraphCanvas
            frame={renderFrame}
            viewport={graphState.viewport}
            selectedNodeId={selectedNodeId}
            lastVisitedNodeId={lastVisitedNodeId}
            depthById={depthById}
            loopBridgeNodeById={loopBridgeNodeById}
            mainParentNodeById={mainParentNodeById}
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
                viewMode={viewMode}
                structureFilters={structureFilters}
                architectureFilters={architectureFilters}
                planFilters={planFilters}
                documentationFilters={documentationFilters}
                onToggleAutoRefresh={() =>
                  setAutoRefreshEnabled((value) => !value)
                }
                onDepthUp={increaseDepth}
                onDepthDown={decreaseDepth}
                onChangeMotion={setMotionSpeedFactor}
                onChangeViewMode={setViewMode}
                onToggleStructureFilter={(key) => {
                  setStructureFilters({ [key]: !structureFilters[key] });
                }}
                onToggleArchitectureViewType={() => {
                  setArchitectureFilters({
                    viewType:
                      architectureFilters.viewType === "layers"
                        ? "communities"
                        : "layers",
                  });
                }}
                onToggleArchitectureViolationsOnly={() => {
                  setArchitectureFilters({
                    showViolationsOnly: !architectureFilters.showViolationsOnly,
                  });
                }}
                onChangePlanStatusFilter={(status) => {
                  setPlanFilters({ statusFilter: status });
                }}
                onTogglePlanImplementingFiles={() => {
                  setPlanFilters({
                    showImplementingFiles: !planFilters.showImplementingFiles,
                  });
                }}
                onTogglePlanTestCoverage={() => {
                  setPlanFilters({
                    showTestCoverage: !planFilters.showTestCoverage,
                  });
                }}
                onChangeDocKindFilter={(kind) => {
                  setDocumentationFilters({ kindFilter: kind });
                }}
                onToggleDocLinkedCode={() => {
                  setDocumentationFilters({
                    showLinkedCode: !documentationFilters.showLinkedCode,
                  });
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
        </div>

        <NodeViewer selectedNode={selectedNode} viewMode={viewMode} />
      </div>

      <GraphFooter
        selectedNode={selectedNode}
        selectedNodeTotal={selectedNodeTotal}
        selectedPage={selectedPage}
        selectedPageCount={selectedPageCount}
        isSyncing={isSyncing}
        onChangeSiblingPage={changeSiblingPage}
        viewMode={viewMode}
        totalNodes={totalNodes}
        visibleNodes={visibleNodes}
      />
    </main>
  );
}

export default App;
