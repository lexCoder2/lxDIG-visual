import { computeForcePositions } from "./layoutEngine";
import type { GraphNodeEntity, PositionedEdge } from "../types/graph";

type WorkerRequest = {
  type: "LAYOUT";
  requestId: number;
  visibleNodeIds: string[];
  depthByNodeId: Record<string, number>;
  nodesById: Record<string, GraphNodeEntity>;
  childIdsByParent: Record<string, string[]>;
  edges: PositionedEdge[];
  rootNodeId: string;
};

type WorkerResponse = {
  type: "POSITIONS";
  requestId: number;
  positionedById: Record<string, { x: number; y: number }>;
};

// Cast self to avoid DOM vs WebWorker type conflicts
const workerSelf = self as unknown as {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ): void;
  postMessage(data: WorkerResponse): void;
};

workerSelf.addEventListener("message", (event) => {
  const {
    type,
    requestId,
    visibleNodeIds,
    depthByNodeId,
    nodesById,
    childIdsByParent,
    edges,
    rootNodeId,
  } = event.data;

  if (type !== "LAYOUT") return;

  const positionedById = computeForcePositions({
    visibleNodeIds: new Set(visibleNodeIds),
    depthByNodeId,
    nodesById,
    childIdsByParent,
    edges,
    rootNodeId,
  });

  workerSelf.postMessage({ type: "POSITIONS", requestId, positionedById });
});
