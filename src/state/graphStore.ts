import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import {
  CANVAS,
  DEFAULT_CONNECTION_DEPTH,
  MAX_CONNECTION_DEPTH,
  MIN_CONNECTION_DEPTH,
  MAX_VISIBLE_SIBLINGS,
} from "../config/constants";
import { computeLayoutTopology } from "../lib/layoutEngine";
import type {
  ExpansionNode,
  GraphEdgeEntity,
  GraphNodeEntity,
  NodeKind,
  VisualNodeKind,
  ViewMode,
  ViewportState,
  StructureFilters,
  ArchitectureFilters,
  PlanFilters,
  DocumentationFilters,
} from "../types/graph";

type GraphStore = {
  projectId: string | null;
  rootNodeId: string | null;
  focusedNodeId: string | null;
  selectedNodeId: string | null;
  lastVisitedNodeId: string | null;
  connectionDepth: number;
  viewMode: ViewMode;
  structureFilters: StructureFilters;
  architectureFilters: ArchitectureFilters;
  planFilters: PlanFilters;
  documentationFilters: DocumentationFilters;
  nodesById: Record<string, GraphNodeEntity>;
  edgesById: Record<string, GraphEdgeEntity>;
  childIdsByParent: Record<string, string[]>;
  childTotalByParent: Record<string, number>;
  siblingPageByParent: Record<string, number>;
  manualPositions: Record<string, { x: number; y: number }>;
  adjacencyByNode: Record<string, string[]>;
  viewport: ViewportState;
  syncStatus: "idle" | "syncing" | "error";
  syncError?: string;
  setProject: (
    projectId: string,
    rootNode: {
      id: string;
      label: string;
      kind?: NodeKind;
      visualKind?: VisualNodeKind;
      status?: string;
    },
  ) => void;
  setSyncStatus: (status: GraphStore["syncStatus"], error?: string) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setFocusedNode: (nodeId: string | null) => void;
  setConnectionDepth: (depth: number) => void;
  setViewMode: (mode: ViewMode) => void;
  setStructureFilters: (filters: Partial<StructureFilters>) => void;
  setArchitectureFilters: (filters: Partial<ArchitectureFilters>) => void;
  setPlanFilters: (filters: Partial<PlanFilters>) => void;
  setDocumentationFilters: (filters: Partial<DocumentationFilters>) => void;
  setNodeLoading: (nodeId: string, loading: boolean, error?: string) => void;
  setNodeExpanded: (nodeId: string, expanded: boolean) => void;
  mergeExpansionPage: (params: {
    parentId: string;
    total: number;
    page: number;
    children: ExpansionNode[];
  }) => void;
  mergeExpansionBatch: (params: {
    parents: Array<{
      parentId: string;
      total: number;
      children: ExpansionNode[];
    }>;
  }) => void;
  setSiblingPage: (parentId: string, page: number) => void;
  setManualPosition: (
    nodeId: string,
    position: { x: number; y: number },
  ) => void;
  setManualPositionsBatch: (
    positionsById: Record<string, { x: number; y: number }>,
  ) => void;
  setViewport: (viewport: ViewportState) => void;
  pan: (deltaX: number, deltaY: number) => void;
  zoom: (direction: number, pointerX: number, pointerY: number) => void;
};

function buildDirectedEdgeId(params: {
  source: string;
  target: string;
  relation?: string;
}): string {
  const relation = params.relation?.trim() || "RELATED_TO";
  return `${params.source}::${relation}::${params.target}`;
}

function readViewModeFromStorage(): ViewMode {
  if (typeof window === "undefined") return "structure";
  try {
    const stored = window.localStorage.getItem("code-visual:viewMode");
    if (
      stored === "structure" ||
      stored === "architecture" ||
      stored === "plan" ||
      stored === "documentation"
    ) {
      return stored;
    }
    return "structure";
  } catch {
    return "structure";
  }
}

function writeViewModeToStorage(mode: ViewMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("code-visual:viewMode", mode);
  } catch {
    // Ignore storage errors
  }
}

function readConnectionDepthFromStorage(): number {
  if (typeof window === "undefined") return DEFAULT_CONNECTION_DEPTH;
  try {
    const stored = window.localStorage.getItem("code-visual:connectionDepth");
    if (!stored) return DEFAULT_CONNECTION_DEPTH;
    const parsed = Math.round(Number(stored));
    if (!Number.isFinite(parsed)) return DEFAULT_CONNECTION_DEPTH;
    return Math.max(
      MIN_CONNECTION_DEPTH,
      Math.min(MAX_CONNECTION_DEPTH, parsed),
    );
  } catch {
    return DEFAULT_CONNECTION_DEPTH;
  }
}

export const useGraphStore = create<GraphStore>()(
  immer((set, get) => ({
    projectId: null,
    rootNodeId: null,
    focusedNodeId: null,
    selectedNodeId: null,
    lastVisitedNodeId: null,
    connectionDepth: readConnectionDepthFromStorage(),
    viewMode: readViewModeFromStorage(),
    structureFilters: {
      showImports: true,
      showExports: true,
      showTests: true,
      showFiles: false,
    },
    architectureFilters: {
      viewType: "layers",
      showViolationsOnly: false,
      layerFocusId: null,
    },
    planFilters: {
      statusFilter: "all",
      featureFocusId: null,
      showImplementingFiles: true,
      showTestCoverage: true,
    },
    documentationFilters: {
      kindFilter: "all",
      showLinkedCode: true,
    },
    nodesById: {},
    edgesById: {},
    childIdsByParent: {},
    childTotalByParent: {},
    siblingPageByParent: {},
    manualPositions: {},
    adjacencyByNode: {},
    viewport: { x: CANVAS.width * 0.12, y: 30, scale: 0.7 },
    syncStatus: "idle",
    syncError: undefined,

    setProject(projectId, rootNode) {
      const rootId = rootNode.id;
      set((draft) => {
        draft.projectId = projectId;
        draft.rootNodeId = rootId;
        draft.focusedNodeId = rootId;
        draft.selectedNodeId = rootId;
        draft.lastVisitedNodeId = rootId;
        draft.nodesById = {
          [rootId]: {
            id: rootId,
            label: rootNode.label,
            kind: rootNode.kind ?? "project",
            visualKind: rootNode.visualKind ?? "layer",
            status: rootNode.status,
            depth: 0,
            expanded: true,
            loading: false,
          },
        };
        draft.edgesById = {};
        draft.childIdsByParent = {};
        draft.childTotalByParent = {};
        draft.siblingPageByParent = {};
        draft.manualPositions = {};
        draft.adjacencyByNode = {};
        draft.syncStatus = "idle";
        draft.syncError = undefined;
      });
    },

    setSyncStatus(status, error) {
      set((draft) => {
        draft.syncStatus = status;
        draft.syncError = error;
      });
    },

    setSelectedNode(nodeId) {
      set((draft) => {
        draft.selectedNodeId = nodeId;
        draft.lastVisitedNodeId = nodeId;
      });
    },

    setFocusedNode(nodeId) {
      const snapshot = get();
      const nextRootId = nodeId ?? snapshot.rootNodeId;

      const topology = computeLayoutTopology({
        rootNodeId: nextRootId,
        connectionDepth: snapshot.connectionDepth,
        nodesById: snapshot.nodesById,
        edgesById: snapshot.edgesById,
        childIdsByParent: snapshot.childIdsByParent,
        siblingPageByParent: snapshot.siblingPageByParent,
        manualPositions: snapshot.manualPositions,
      });

      if (!topology) {
        set((draft) => {
          draft.focusedNodeId = nodeId;
        });
        return;
      }

      const visibleNodeIds = new Set(topology.visibleNodeIds);

      set((draft) => {
        topology.visibleNodeIds.forEach((id) => {
          const nextDepth = topology.depthByNodeId[id];
          if (draft.nodesById[id] && draft.nodesById[id].depth !== nextDepth) {
            draft.nodesById[id].depth = nextDepth ?? 0;
          }
        });

        const nextManualPositions: Record<string, { x: number; y: number }> =
          {};
        Object.entries(draft.manualPositions).forEach(([id, pos]) => {
          if (visibleNodeIds.has(id)) {
            nextManualPositions[id] = pos;
          }
        });

        draft.focusedNodeId = nodeId;
        draft.manualPositions = nextManualPositions;
      });
    },

    setConnectionDepth(depth) {
      const safeDepth = Math.max(
        MIN_CONNECTION_DEPTH,
        Math.min(MAX_CONNECTION_DEPTH, depth),
      );
      set((draft) => {
        draft.connectionDepth = safeDepth;
      });
    },

    setViewMode(mode) {
      set((draft) => {
        draft.viewMode = mode;
      });
      writeViewModeToStorage(mode);
    },

    setStructureFilters(filters) {
      set((draft) => {
        Object.assign(draft.structureFilters, filters);
      });
    },

    setArchitectureFilters(filters) {
      set((draft) => {
        Object.assign(draft.architectureFilters, filters);
      });
    },

    setPlanFilters(filters) {
      set((draft) => {
        Object.assign(draft.planFilters, filters);
      });
    },

    setDocumentationFilters(filters) {
      set((draft) => {
        Object.assign(draft.documentationFilters, filters);
      });
    },

    setNodeLoading(nodeId, loading, error) {
      set((draft) => {
        const current = draft.nodesById[nodeId];
        if (!current) return;
        current.loading = loading;
        current.error = error;
      });
    },

    setNodeExpanded(nodeId, expanded) {
      set((draft) => {
        const current = draft.nodesById[nodeId];
        if (!current) return;
        current.expanded = expanded;
        current.error = undefined;
      });
    },

    mergeExpansionPage({ parentId, total, page, children }) {
      set((draft) => {
        const parent = draft.nodesById[parentId];
        if (!parent) return;

        const existingChildIds = new Set(
          draft.childIdsByParent[parentId] ?? [],
        );

        children.forEach((child) => {
          if (!draft.nodesById[child.id]) {
            draft.nodesById[child.id] = {
              id: child.id,
              label: child.label,
              kind: child.kind,
              visualKind: child.visualKind,
              semanticType: child.semanticType,
              labels: child.labels,
              status: child.status,
              depth: parent.depth + 1,
              parentId,
              expanded: false,
              loading: false,
            };
          }

          existingChildIds.add(child.id);

          const relation = child.relation;
          const edgeId = buildDirectedEdgeId({
            source: parentId,
            target: child.id,
            relation,
          });
          if (!draft.edgesById[edgeId]) {
            draft.edgesById[edgeId] = {
              id: edgeId,
              source: parentId,
              target: child.id,
              label: relation,
              relation,
              direction: child.relationDirection ?? "undirected",
            };
          }

          // F: maintain adjacency index incrementally
          draft.adjacencyByNode[parentId] ??= [];
          if (!draft.adjacencyByNode[parentId].includes(child.id)) {
            draft.adjacencyByNode[parentId].push(child.id);
          }
          draft.adjacencyByNode[child.id] ??= [];
          if (!draft.adjacencyByNode[child.id].includes(parentId)) {
            draft.adjacencyByNode[child.id].push(parentId);
          }
        });

        draft.nodesById[parentId] = {
          ...parent,
          expanded: true,
          loading: false,
          error:
            children.length === 0 && total === 0
              ? "No connections found"
              : undefined,
        };

        draft.childIdsByParent[parentId] = Array.from(existingChildIds);
        draft.childTotalByParent[parentId] = total;
        draft.siblingPageByParent[parentId] = page;
      });
    },

    mergeExpansionBatch({ parents }) {
      if (parents.length === 0) return;

      set((draft) => {
        parents.forEach((entry) => {
          const parent = draft.nodesById[entry.parentId];
          if (!parent) return;

          const childIds: string[] = [];

          entry.children.forEach((child) => {
            if (!draft.nodesById[child.id]) {
              draft.nodesById[child.id] = {
                id: child.id,
                label: child.label,
                kind: child.kind,
                visualKind: child.visualKind,
                semanticType: child.semanticType,
                labels: child.labels,
                status: child.status,
                depth: parent.depth + 1,
                parentId: entry.parentId,
                expanded: false,
                loading: false,
              };
            }

            childIds.push(child.id);

            const relation = child.relation;
            const edgeId = buildDirectedEdgeId({
              source: entry.parentId,
              target: child.id,
              relation,
            });
            if (!draft.edgesById[edgeId]) {
              draft.edgesById[edgeId] = {
                id: edgeId,
                source: entry.parentId,
                target: child.id,
                label: relation,
                relation,
                direction: child.relationDirection ?? "undirected",
              };
            }

            // F: maintain adjacency index incrementally
            draft.adjacencyByNode[entry.parentId] ??= [];
            if (!draft.adjacencyByNode[entry.parentId].includes(child.id)) {
              draft.adjacencyByNode[entry.parentId].push(child.id);
            }
            draft.adjacencyByNode[child.id] ??= [];
            if (!draft.adjacencyByNode[child.id].includes(entry.parentId)) {
              draft.adjacencyByNode[child.id].push(entry.parentId);
            }
          });

          draft.nodesById[entry.parentId] = {
            ...parent,
            expanded: true,
            loading: false,
            error:
              entry.children.length === 0 && entry.total === 0
                ? "No connections found"
                : undefined,
          };

          draft.childIdsByParent[entry.parentId] = childIds;
          draft.childTotalByParent[entry.parentId] = entry.total;
          if (!(entry.parentId in draft.siblingPageByParent)) {
            draft.siblingPageByParent[entry.parentId] = 0;
          }
        });
      });
    },

    setSiblingPage(parentId, page) {
      set((draft) => {
        draft.siblingPageByParent[parentId] = Math.max(0, page);
      });
    },

    setManualPosition(nodeId, position) {
      set((draft) => {
        draft.manualPositions[nodeId] = position;
      });
    },

    setManualPositionsBatch(positionsById) {
      const entries = Object.entries(positionsById);
      if (entries.length === 0) return;

      set((draft) => {
        entries.forEach(([id, pos]) => {
          draft.manualPositions[id] = pos;
        });
      });
    },

    setViewport(viewport) {
      set((draft) => {
        draft.viewport = viewport;
      });
    },

    pan(deltaX, deltaY) {
      set((draft) => {
        draft.viewport.x += deltaX;
        draft.viewport.y += deltaY;
      });
    },

    zoom(direction, pointerX, pointerY) {
      set((draft) => {
        const scaleStep = direction > 0 ? 1.08 : 0.92;
        const nextScale = Math.min(
          1.8,
          Math.max(0.45, draft.viewport.scale * scaleStep),
        );
        const ratio = nextScale / draft.viewport.scale;
        draft.viewport.scale = nextScale;
        draft.viewport.x = pointerX - (pointerX - draft.viewport.x) * ratio;
        draft.viewport.y = pointerY - (pointerY - draft.viewport.y) * ratio;
      });
    },
  })),
);

export function getSiblingPageInfo(
  state: GraphStore,
  parentId: string,
): { page: number; pageCount: number; pageSize: number } {
  const total = state.childTotalByParent[parentId] ?? 0;
  const page = state.siblingPageByParent[parentId] ?? 0;
  return {
    page,
    pageCount: Math.max(1, Math.ceil(total / MAX_VISIBLE_SIBLINGS)),
    pageSize: MAX_VISIBLE_SIBLINGS,
  };
}
