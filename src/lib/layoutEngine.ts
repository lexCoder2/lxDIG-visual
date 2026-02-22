import {
  CANVAS,
  MAX_VISIBLE_SIBLINGS,
  NODE_HEIGHT_BY_KIND,
  NODE_WIDTH_BY_KIND,
} from "../config/constants";
import type {
  GraphEdgeEntity,
  GraphNodeEntity,
  PositionedEdge,
  PositionedNode,
} from "../types/graph";
import { getDepthVisual } from "./graphVisuals";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

type LayoutInput = {
  rootNodeId: string | null;
  connectionDepth: number;
  nodesById: Record<string, GraphNodeEntity>;
  edgesById: Record<string, GraphEdgeEntity>;
  childIdsByParent: Record<string, string[]>;
  siblingPageByParent: Record<string, number>;
  manualPositions: Record<string, { x: number; y: number }>;
};

export type LayoutFrame = {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
};

// G: topology result (BFS output, no force positions)
export type LayoutTopology = {
  visibleNodeIds: string[];
  depthByNodeId: Record<string, number>;
  childIdsByParent: Record<string, string[]>;
  visibleEdges: PositionedEdge[];
  rootNodeId: string;
};

type ForceNode = SimulationNodeDatum & {
  id: string;
  depth: number;
  radius: number;
  childCount: number;
  targetX: number;
  targetY: number;
};

type ForceLinkDatum = SimulationLinkDatum<ForceNode> & {
  source: string | ForceNode;
  target: string | ForceNode;
};

function createDeterministicRandom(seed = 137): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function computeInitialAngle(index: number, size: number): number {
  if (size <= 0) return -Math.PI / 2;
  return -Math.PI / 2 + (Math.PI * 2 * index) / size;
}

function computeSubtreeWeight(
  nodeId: string,
  childrenByParent: Record<string, string[]>,
  cache: Record<string, number>,
  visiting: Set<string> = new Set(),
): number {
  const cached = cache[nodeId];
  if (typeof cached === "number") return cached;

  if (visiting.has(nodeId)) {
    return 1;
  }

  visiting.add(nodeId);

  const children = childrenByParent[nodeId] ?? [];
  if (children.length === 0) {
    cache[nodeId] = 1;
    visiting.delete(nodeId);
    return 1;
  }

  const childrenWeight = children.reduce(
    (sum, childId) =>
      sum + computeSubtreeWeight(childId, childrenByParent, cache, visiting),
    0,
  );
  const weight = 1 + childrenWeight;
  cache[nodeId] = weight;
  visiting.delete(nodeId);
  return weight;
}

function buildTargetAngleById(params: {
  rootNodeId: string;
  childrenByParent: Record<string, string[]>;
}): Record<string, number> {
  const { rootNodeId, childrenByParent } = params;
  const angleById: Record<string, number> = { [rootNodeId]: -Math.PI / 2 };
  const subtreeCache: Record<string, number> = {};

  const assign = (
    nodeId: string,
    startAngle: number,
    endAngle: number,
    traversalPath: Set<string> = new Set(),
  ) => {
    if (traversalPath.has(nodeId)) return;

    traversalPath.add(nodeId);
    const children = childrenByParent[nodeId] ?? [];
    if (children.length === 0) {
      traversalPath.delete(nodeId);
      return;
    }

    const weightedChildren = children.map((childId) => ({
      id: childId,
      weight: computeSubtreeWeight(childId, childrenByParent, subtreeCache),
    }));
    const totalWeight =
      weightedChildren.reduce((sum, item) => sum + item.weight, 0) || 1;
    const span = endAngle - startAngle;
    let cursor = startAngle;

    weightedChildren.forEach((child) => {
      const slice = span * (child.weight / totalWeight);
      const childStart = cursor;
      const childEnd = cursor + slice;
      const childAngle = childStart + slice / 2;
      angleById[child.id] = childAngle;
      assign(child.id, childStart, childEnd, traversalPath);
      cursor = childEnd;
    });

    traversalPath.delete(nodeId);
  };

  assign(rootNodeId, -Math.PI, Math.PI);
  return angleById;
}

function buildDepthRingRadius(params: {
  visibleNodeIds: string[];
  depthByNodeId: Record<string, number>;
  nodesById: Record<string, GraphNodeEntity>;
}): Record<number, number> {
  const { visibleNodeIds, depthByNodeId, nodesById } = params;
  const maxRadiusByDepth: Record<number, number> = {};
  const countByDepth: Record<number, number> = {};

  visibleNodeIds.forEach((nodeId) => {
    const node = nodesById[nodeId];
    if (!node) return;

    const depth = depthByNodeId[nodeId] ?? 0;
    const scale = getDepthVisual(depth).scale;
    const radius = Math.max(
      (NODE_WIDTH_BY_KIND[node.visualKind] * scale) / 2,
      (NODE_HEIGHT_BY_KIND[node.visualKind] * scale) / 2,
    );
    maxRadiusByDepth[depth] = Math.max(maxRadiusByDepth[depth] ?? 0, radius);
    countByDepth[depth] = (countByDepth[depth] ?? 0) + 1;
  });

  const depthKeys = Object.keys(maxRadiusByDepth)
    .map((entry) => Number(entry))
    .sort((a, b) => a - b);

  const ringRadiusByDepth: Record<number, number> = { 0: 0 };
  depthKeys.forEach((depth) => {
    if (depth === 0) return;

    const prevDepth = depth - 1;
    const prevRadius = ringRadiusByDepth[prevDepth] ?? 0;
    const prevNodeRadius = maxRadiusByDepth[prevDepth] ?? 54;
    const currentNodeRadius = maxRadiusByDepth[depth] ?? 54;
    const densityBoost = Math.min(150, (countByDepth[depth] ?? 0) * 2.2);
    const gap = 54 + densityBoost;

    ringRadiusByDepth[depth] =
      prevRadius + prevNodeRadius + currentNodeRadius + gap;
  });

  return ringRadiusByDepth;
}

// E: uses childIdsByParent directly instead of rebuilding from parentByNodeId
export type ForcePositionInput = {
  visibleNodeIds: Set<string>;
  depthByNodeId: Record<string, number>;
  nodesById: Record<string, GraphNodeEntity>;
  childIdsByParent: Record<string, string[]>;
  edges: PositionedEdge[];
  rootNodeId: string;
};

export function computeForcePositions(
  params: ForcePositionInput,
): Record<string, { x: number; y: number }> {
  const {
    visibleNodeIds,
    depthByNodeId,
    nodesById,
    childIdsByParent,
    edges,
    rootNodeId,
  } = params;
  const centerX = CANVAS.width / 2;
  const centerY = CANVAS.height / 2;

  const orderedNodeIds = Array.from(visibleNodeIds).sort((a, b) => {
    const depthDiff = (depthByNodeId[a] ?? 0) - (depthByNodeId[b] ?? 0);
    if (depthDiff !== 0) return depthDiff;
    return (nodesById[a]?.label ?? a).localeCompare(nodesById[b]?.label ?? b);
  });

  // E: pass childIdsByParent directly to buildTargetAngleById
  const targetAngleById = buildTargetAngleById({
    rootNodeId,
    childrenByParent: childIdsByParent,
  });
  const ringRadiusByDepth = buildDepthRingRadius({
    visibleNodeIds: orderedNodeIds,
    depthByNodeId,
    nodesById,
  });

  const nodesAtDepth: Record<number, string[]> = {};
  orderedNodeIds.forEach((nodeId) => {
    const depth = depthByNodeId[nodeId] ?? 0;
    nodesAtDepth[depth] = nodesAtDepth[depth] ?? [];
    nodesAtDepth[depth].push(nodeId);
  });

  const forceNodes = orderedNodeIds
    .map((nodeId): ForceNode | null => {
      const node = nodesById[nodeId];
      if (!node) return null;

      const depth = depthByNodeId[nodeId] ?? 0;
      const depthVisual = getDepthVisual(depth);
      const sizeRadius = Math.max(
        (NODE_WIDTH_BY_KIND[node.visualKind] * depthVisual.scale) / 2,
        (NODE_HEIGHT_BY_KIND[node.visualKind] * depthVisual.scale) / 2,
      );
      const childCount = (childIdsByParent[nodeId] ?? []).length;
      const depthNodes = nodesAtDepth[depth] ?? [];
      const depthIndex = Math.max(0, depthNodes.indexOf(nodeId));
      const depthBandRadius = ringRadiusByDepth[depth] ?? 0;
      const angle =
        targetAngleById[nodeId] ??
        computeInitialAngle(depthIndex, depthNodes.length);
      const targetX = centerX + Math.cos(angle) * depthBandRadius;
      const targetY = centerY + Math.sin(angle) * depthBandRadius;

      return {
        id: nodeId,
        depth,
        radius: sizeRadius + 1,
        childCount,
        targetX,
        targetY,
        x: targetX,
        y: targetY,
      };
    })
    .filter((node): node is ForceNode => node !== null);

  const forceLinks: ForceLinkDatum[] = edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
  }));
  const nodeById = forceNodes.reduce<Record<string, ForceNode>>((acc, node) => {
    acc[node.id] = node;
    return acc;
  }, {});

  const rootNode = nodeById[rootNodeId];
  if (rootNode) {
    rootNode.fx = centerX;
    rootNode.fy = centerY;
    rootNode.x = centerX;
    rootNode.y = centerY;
  }

  const simulation = forceSimulation<ForceNode>(forceNodes)
    .randomSource(createDeterministicRandom())
    .alpha(1)
    .alphaMin(0.02)
    .alphaDecay(0.055)
    .velocityDecay(0.34)
    .force("center", forceCenter(centerX, centerY).strength(0.08))
    .force("charge", forceManyBody<ForceNode>().strength(-220).distanceMax(920))
    .force(
      "ring-x",
      forceX<ForceNode>((node) => node.targetX).strength((node) =>
        node.depth === 0 ? 1 : 0.3,
      ),
    )
    .force(
      "ring-y",
      forceY<ForceNode>((node) => node.targetY).strength((node) =>
        node.depth === 0 ? 1 : 0.3,
      ),
    )
    .force(
      "radial",
      forceRadial<ForceNode>(
        (node) => {
          if (node.depth <= 0) return 0;
          return ringRadiusByDepth[node.depth] ?? 0;
        },
        centerX,
        centerY,
      ).strength((node) => (node.depth === 0 ? 1 : 0.86)),
    )
    .force(
      "link",
      forceLink<ForceNode, ForceLinkDatum>(forceLinks)
        .id((node) => node.id)
        .distance((link) => {
          const sourceDepth =
            typeof link.source === "string"
              ? (depthByNodeId[link.source] ?? 0)
              : link.source.depth;
          const targetDepth =
            typeof link.target === "string"
              ? (depthByNodeId[link.target] ?? 0)
              : link.target.depth;
          const depthDelta = Math.abs(sourceDepth - targetDepth);
          return depthDelta > 0 ? 132 + (depthDelta - 1) * 32 : 112;
        })
        .strength((link) => {
          const sourceDepth =
            typeof link.source === "string"
              ? (depthByNodeId[link.source] ?? 0)
              : link.source.depth;
          const targetDepth =
            typeof link.target === "string"
              ? (depthByNodeId[link.target] ?? 0)
              : link.target.depth;
          return sourceDepth === targetDepth ? 0.28 : 0.68;
        }),
    )
    .force(
      "collide",
      forceCollide<ForceNode>()
        .radius((node) => node.radius + Math.min(34, node.childCount * 2.2))
        .strength(1)
        .iterations(3),
    );

  const ticks = Math.min(240, Math.max(120, forceNodes.length * 6));
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.tick();
  }
  simulation.stop();

  const positionedById: Record<string, { x: number; y: number }> = {};
  forceNodes.forEach((node) => {
    positionedById[node.id] = {
      x: node.x ?? centerX,
      y: node.y ?? centerY,
    };
  });

  return positionedById;
}

function depthSort(nodes: PositionedNode[]): PositionedNode[] {
  return [...nodes].sort(
    (a, b) => a.depth - b.depth || a.label.localeCompare(b.label),
  );
}

// G: synchronous BFS + edge collection, no force simulation
export function computeLayoutTopology(
  input: LayoutInput,
): LayoutTopology | null {
  const {
    rootNodeId,
    connectionDepth,
    nodesById,
    edgesById,
    childIdsByParent,
    siblingPageByParent,
  } = input;

  if (!rootNodeId || !nodesById[rootNodeId]) return null;

  const visibleNodeIds = new Set<string>();
  const depthByNodeId: Record<string, number> = {};
  const parentByNodeId: Record<string, string | null> = {};
  const queue: Array<{ id: string; depth: number }> = [
    { id: rootNodeId, depth: 0 },
  ];

  // build adjacency for BFS traversal
  const adjacencyByNode: Record<string, string[]> = {};
  Object.values(edgesById).forEach((edge) => {
    adjacencyByNode[edge.source] = adjacencyByNode[edge.source] ?? [];
    adjacencyByNode[edge.target] = adjacencyByNode[edge.target] ?? [];
    adjacencyByNode[edge.source].push(edge.target);
    adjacencyByNode[edge.target].push(edge.source);
  });

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    const node = nodesById[current.id];
    if (!node || visibleNodeIds.has(node.id)) continue;

    visibleNodeIds.add(node.id);
    depthByNodeId[node.id] = current.depth;
    if (!(node.id in parentByNodeId)) {
      parentByNodeId[node.id] = null;
    }

    if (!node.expanded || current.depth >= connectionDepth) continue;

    const adjacency = adjacencyByNode[node.id] ?? [];
    const fallbackChildren = childIdsByParent[node.id] ?? [];
    const allNeighbors = (adjacency.length > 0 ? adjacency : fallbackChildren)
      .filter((neighborId, index, array) => array.indexOf(neighborId) === index)
      .sort((a, b) => a.localeCompare(b));

    const page = siblingPageByParent[node.id] ?? 0;
    const start = page * MAX_VISIBLE_SIBLINGS;
    const neighbors = allNeighbors
      .sort((a, b) =>
        (nodesById[a]?.label ?? a).localeCompare(nodesById[b]?.label ?? b),
      )
      .slice(start, start + MAX_VISIBLE_SIBLINGS);

    neighbors.forEach((neighborId) => {
      if (!(neighborId in parentByNodeId)) {
        parentByNodeId[neighborId] = node.id;
      }
      queue.push({ id: neighborId, depth: current.depth + 1 });
    });
  }

  const visibleEdges: PositionedEdge[] = Object.values(edgesById)
    .filter(
      (edge) =>
        visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
    )
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      relation: edge.relation,
      direction: edge.direction,
    }));

  // build visible childIdsByParent, sorted for deterministic angles
  const visibleChildIdsByParent: Record<string, string[]> = {};
  Array.from(visibleNodeIds).forEach((nodeId) => {
    const children = (childIdsByParent[nodeId] ?? [])
      .filter((childId) => visibleNodeIds.has(childId))
      .sort((a, b) =>
        (nodesById[a]?.label ?? a).localeCompare(nodesById[b]?.label ?? b),
      );
    if (children.length > 0) {
      visibleChildIdsByParent[nodeId] = children;
    }
  });

  return {
    visibleNodeIds: Array.from(visibleNodeIds),
    depthByNodeId,
    childIdsByParent: visibleChildIdsByParent,
    visibleEdges,
    rootNodeId,
  };
}

export function computeLayoutFrame(input: LayoutInput): LayoutFrame {
  const topology = computeLayoutTopology(input);
  if (!topology) return { nodes: [], edges: [] };

  const positionedById = computeForcePositions({
    visibleNodeIds: new Set(topology.visibleNodeIds),
    depthByNodeId: topology.depthByNodeId,
    nodesById: input.nodesById,
    childIdsByParent: topology.childIdsByParent,
    edges: topology.visibleEdges,
    rootNodeId: topology.rootNodeId,
  });

  const centerX = CANVAS.width / 2;
  const centerY = CANVAS.height / 2;

  const positionedNodes: PositionedNode[] = topology.visibleNodeIds.reduce<
    PositionedNode[]
  >((acc, id) => {
    const node = input.nodesById[id];
    if (!node) return acc;

    const position = positionedById[id];

    acc.push({
      id: node.id,
      label: node.label,
      kind: node.kind,
      visualKind: node.visualKind,
      semanticType: node.semanticType,
      status: node.status,
      depth: topology.depthByNodeId[id] ?? 0,
      x: input.manualPositions[id]?.x ?? position?.x ?? centerX,
      y: input.manualPositions[id]?.y ?? position?.y ?? centerY,
      loading: node.loading,
      error: node.error,
    });

    return acc;
  }, []);

  return {
    nodes: depthSort(positionedNodes),
    edges: topology.visibleEdges,
  };
}
