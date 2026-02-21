import { create } from "zustand";
import {
  CANVAS,
  DEFAULT_CONNECTION_DEPTH,
  MAX_CONNECTION_DEPTH,
  MIN_CONNECTION_DEPTH,
  MAX_VISIBLE_SIBLINGS,
} from "../config/constants";
import { computeLayoutFrame, type LayoutFrame } from "../lib/layoutEngine";
import type {
  ExpansionNode,
  GraphEdgeEntity,
  GraphNodeEntity,
  NodeKind,
  ViewportState,
} from "../types/graph";

type GraphStore = {
  projectId: string | null;
  rootNodeId: string | null;
  focusedNodeId: string | null;
  selectedNodeId: string | null;
  lastVisitedNodeId: string | null;
  connectionDepth: number;
  nodesById: Record<string, GraphNodeEntity>;
  edgesById: Record<string, GraphEdgeEntity>;
  childIdsByParent: Record<string, string[]>;
  childTotalByParent: Record<string, number>;
  siblingPageByParent: Record<string, number>;
  manualPositions: Record<string, { x: number; y: number }>;
  frame: LayoutFrame;
  viewport: ViewportState;
  syncStatus: "idle" | "syncing" | "error";
  syncError?: string;
  setProject: (
    projectId: string,
    rootNode: { id: string; label: string; kind?: NodeKind },
  ) => void;
  setSyncStatus: (status: GraphStore["syncStatus"], error?: string) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setFocusedNode: (nodeId: string | null) => void;
  setConnectionDepth: (depth: number) => void;
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
  recalculateFrame: () => void;
};

let rafId: number | null = null;

function buildUndirectedEdgeId(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function scheduleFrame(
  get: () => GraphStore,
  set: (fn: (state: GraphStore) => Partial<GraphStore>) => void,
) {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
  }

  rafId = requestAnimationFrame(() => {
    rafId = null;
    const state = get();
    const frame = computeLayoutFrame({
      rootNodeId: state.focusedNodeId ?? state.rootNodeId,
      connectionDepth: state.connectionDepth,
      nodesById: state.nodesById,
      edgesById: state.edgesById,
      childIdsByParent: state.childIdsByParent,
      siblingPageByParent: state.siblingPageByParent,
      manualPositions: state.manualPositions,
    });

    set(() => ({ frame }));
  });
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  projectId: null,
  rootNodeId: null,
  focusedNodeId: null,
  selectedNodeId: null,
  lastVisitedNodeId: null,
  connectionDepth: DEFAULT_CONNECTION_DEPTH,
  nodesById: {},
  edgesById: {},
  childIdsByParent: {},
  childTotalByParent: {},
  siblingPageByParent: {},
  manualPositions: {},
  frame: { nodes: [], edges: [] },
  viewport: { x: CANVAS.width * 0.12, y: 30, scale: 0.7 },
  syncStatus: "idle",
  syncError: undefined,

  setProject(projectId, rootNode) {
    const rootId = rootNode.id;
    set(() => ({
      projectId,
      rootNodeId: rootId,
      focusedNodeId: rootId,
      selectedNodeId: rootId,
      lastVisitedNodeId: rootId,
      nodesById: {
        [rootId]: {
          id: rootId,
          label: rootNode.label,
          kind: rootNode.kind ?? "layer",
          depth: 0,
          expanded: true,
          loading: false,
        },
      },
      edgesById: {},
      childIdsByParent: {},
      childTotalByParent: {},
      siblingPageByParent: {},
      manualPositions: {},
      frame: { nodes: [], edges: [] },
      syncStatus: "idle",
      syncError: undefined,
    }));

    scheduleFrame(get, set);
  },

  setSyncStatus(status, error) {
    set(() => ({ syncStatus: status, syncError: error }));
  },

  setSelectedNode(nodeId) {
    set(() => ({ selectedNodeId: nodeId, lastVisitedNodeId: nodeId }));
  },

  setFocusedNode(nodeId) {
    const snapshot = get();
    const nextRootId = nodeId ?? snapshot.rootNodeId;

    const nextFrame = computeLayoutFrame({
      rootNodeId: nextRootId,
      connectionDepth: snapshot.connectionDepth,
      nodesById: snapshot.nodesById,
      edgesById: snapshot.edgesById,
      childIdsByParent: snapshot.childIdsByParent,
      siblingPageByParent: snapshot.siblingPageByParent,
      manualPositions: snapshot.manualPositions,
    });

    const visibleDepthById = nextFrame.nodes.reduce<Record<string, number>>(
      (acc, node) => {
        acc[node.id] = node.depth;
        return acc;
      },
      {},
    );
    const visibleNodeIds = new Set(nextFrame.nodes.map((node) => node.id));

    set((state) => {
      const nextNodesById: Record<string, GraphNodeEntity> = {
        ...state.nodesById,
      };

      Object.keys(visibleDepthById).forEach((id) => {
        const currentNode = nextNodesById[id];
        const nextDepth = visibleDepthById[id];
        if (!currentNode || currentNode.depth === nextDepth) return;

        nextNodesById[id] = {
          ...currentNode,
          depth: nextDepth,
        };
      });

      const nextManualPositions = Object.entries(state.manualPositions).reduce<
        Record<string, { x: number; y: number }>
      >((acc, [id, value]) => {
        if (visibleNodeIds.has(id)) {
          acc[id] = value;
        }
        return acc;
      }, {});

      return {
        focusedNodeId: nodeId,
        nodesById: nextNodesById,
        manualPositions: nextManualPositions,
        frame: nextFrame,
      };
    });
  },

  setConnectionDepth(depth) {
    const safeDepth = Math.max(
      MIN_CONNECTION_DEPTH,
      Math.min(MAX_CONNECTION_DEPTH, depth),
    );
    set(() => ({ connectionDepth: safeDepth }));
    scheduleFrame(get, set);
  },

  setNodeLoading(nodeId, loading, error) {
    set((state) => {
      const current = state.nodesById[nodeId];
      if (!current) return state;

      return {
        nodesById: {
          ...state.nodesById,
          [nodeId]: {
            ...current,
            loading,
            error,
          },
        },
      };
    });
  },

  setNodeExpanded(nodeId, expanded) {
    set((state) => {
      const current = state.nodesById[nodeId];
      if (!current) return state;

      return {
        nodesById: {
          ...state.nodesById,
          [nodeId]: {
            ...current,
            expanded,
            error: undefined,
          },
        },
      };
    });

    scheduleFrame(get, set);
  },

  mergeExpansionPage({ parentId, total, page, children }) {
    set((state) => {
      const parent = state.nodesById[parentId];
      if (!parent) return state;

      const nextNodesById = { ...state.nodesById };
      const nextEdgesById = { ...state.edgesById };
      const nextChildIds = new Set(state.childIdsByParent[parentId] ?? []);

      children.forEach((child) => {
        const existing = nextNodesById[child.id];
        if (!existing) {
          nextNodesById[child.id] = {
            id: child.id,
            label: child.label,
            kind: child.kind,
            semanticType: child.semanticType,
            depth: parent.depth + 1,
            parentId,
            expanded: false,
            loading: false,
          };
        }

        nextChildIds.add(child.id);

        const edgeId = buildUndirectedEdgeId(parentId, child.id);
        if (!nextEdgesById[edgeId]) {
          nextEdgesById[edgeId] = {
            id: edgeId,
            source: parentId,
            target: child.id,
            label: child.relation,
          };
        }
      });

      const nextSiblingPageByParent = {
        ...state.siblingPageByParent,
        [parentId]: page,
      };

      return {
        nodesById: {
          ...nextNodesById,
          [parentId]: {
            ...parent,
            expanded: true,
            loading: false,
            error:
              children.length === 0 && total === 0
                ? "No connections found"
                : undefined,
          },
        },
        edgesById: nextEdgesById,
        childIdsByParent: {
          ...state.childIdsByParent,
          [parentId]: Array.from(nextChildIds),
        },
        childTotalByParent: {
          ...state.childTotalByParent,
          [parentId]: total,
        },
        siblingPageByParent: nextSiblingPageByParent,
      };
    });

    scheduleFrame(get, set);
  },

  mergeExpansionBatch({ parents }) {
    set((state) => {
      if (parents.length === 0) return state;

      const nextNodesById = { ...state.nodesById };
      const nextEdgesById = { ...state.edgesById };
      const nextChildIdsByParent = { ...state.childIdsByParent };
      const nextChildTotalByParent = { ...state.childTotalByParent };
      const nextSiblingPageByParent = { ...state.siblingPageByParent };

      parents.forEach((entry) => {
        const parent = nextNodesById[entry.parentId];
        if (!parent) return;

        const childIds: string[] = [];

        entry.children.forEach((child) => {
          const existing = nextNodesById[child.id];
          if (!existing) {
            nextNodesById[child.id] = {
              id: child.id,
              label: child.label,
              kind: child.kind,
              semanticType: child.semanticType,
              depth: parent.depth + 1,
              parentId: entry.parentId,
              expanded: false,
              loading: false,
            };
          }

          childIds.push(child.id);

          const edgeId = buildUndirectedEdgeId(entry.parentId, child.id);
          if (!nextEdgesById[edgeId]) {
            nextEdgesById[edgeId] = {
              id: edgeId,
              source: entry.parentId,
              target: child.id,
              label: child.relation,
            };
          }
        });

        nextNodesById[entry.parentId] = {
          ...parent,
          expanded: true,
          loading: false,
          error:
            entry.children.length === 0 && entry.total === 0
              ? "No connections found"
              : undefined,
        };

        nextChildIdsByParent[entry.parentId] = childIds;
        nextChildTotalByParent[entry.parentId] = entry.total;
        if (!(entry.parentId in nextSiblingPageByParent)) {
          nextSiblingPageByParent[entry.parentId] = 0;
        }
      });

      return {
        nodesById: nextNodesById,
        edgesById: nextEdgesById,
        childIdsByParent: nextChildIdsByParent,
        childTotalByParent: nextChildTotalByParent,
        siblingPageByParent: nextSiblingPageByParent,
      };
    });

    scheduleFrame(get, set);
  },

  setSiblingPage(parentId, page) {
    set((state) => {
      const safePage = Math.max(0, page);
      return {
        siblingPageByParent: {
          ...state.siblingPageByParent,
          [parentId]: safePage,
        },
      };
    });

    scheduleFrame(get, set);
  },

  setManualPosition(nodeId, position) {
    set((state) => ({
      manualPositions: {
        ...state.manualPositions,
        [nodeId]: position,
      },
    }));

    scheduleFrame(get, set);
  },

  setManualPositionsBatch(positionsById) {
    const entries = Object.entries(positionsById);
    if (entries.length === 0) return;

    set((state) => ({
      manualPositions: {
        ...state.manualPositions,
        ...positionsById,
      },
    }));

    scheduleFrame(get, set);
  },

  setViewport(viewport) {
    set(() => ({ viewport }));
  },

  pan(deltaX, deltaY) {
    set((state) => ({
      viewport: {
        ...state.viewport,
        x: state.viewport.x + deltaX,
        y: state.viewport.y + deltaY,
      },
    }));
  },

  zoom(direction, pointerX, pointerY) {
    set((state) => {
      const scaleStep = direction > 0 ? 1.08 : 0.92;
      const nextScale = Math.min(
        1.8,
        Math.max(0.45, state.viewport.scale * scaleStep),
      );
      const ratio = nextScale / state.viewport.scale;

      return {
        viewport: {
          scale: nextScale,
          x: pointerX - (pointerX - state.viewport.x) * ratio,
          y: pointerY - (pointerY - state.viewport.y) * ratio,
        },
      };
    });
  },

  recalculateFrame() {
    scheduleFrame(get, set);
  },
}));

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
