export type NodeKind = "layer" | "module" | "service" | "file";

export type SemanticNodeType =
  | "function"
  | "class"
  | "import"
  | "export"
  | "variable";

export type ProjectSummary = {
  id: string;
  name: string;
  rootNodeId: string;
};

export type ExpansionNode = {
  id: string;
  label: string;
  kind: NodeKind;
  semanticType?: SemanticNodeType;
  relation?: string;
};

export type ExpansionPage = {
  parentId: string;
  page: number;
  total: number;
  children: ExpansionNode[];
};

export type GraphNodeEntity = {
  id: string;
  label: string;
  kind: NodeKind;
  semanticType?: SemanticNodeType;
  depth: number;
  parentId?: string;
  expanded: boolean;
  loading: boolean;
  error?: string;
};

export type GraphEdgeEntity = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

export type PositionedNode = {
  id: string;
  label: string;
  kind: NodeKind;
  depth: number;
  x: number;
  y: number;
  loading: boolean;
  error?: string;
};

export type PositionedEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

export type ViewportState = {
  x: number;
  y: number;
  scale: number;
};
