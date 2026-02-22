export type ViewMode = "structure" | "architecture" | "plan" | "documentation";

export type NodeKind =
  | "project"
  | "structure"
  | "code"
  | "docs"
  | "progress"
  | "memory"
  | "architecture"
  | "system"
  | "unknown";

export type VisualNodeKind = "layer" | "module" | "service" | "file";

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
  rootKind?: NodeKind;
  rootVisualKind?: VisualNodeKind;
};

export type ExpansionNode = {
  id: string;
  label: string;
  kind: NodeKind;
  visualKind: VisualNodeKind;
  semanticType?: SemanticNodeType;
  labels?: string[];
  relation?: string;
  relationDirection?: "outbound" | "inbound" | "undirected";
  status?: string; // For progress nodes (pending/in-progress/completed/blocked)
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
  visualKind: VisualNodeKind;
  semanticType?: SemanticNodeType;
  labels?: string[];
  status?: string; // For progress nodes
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
  relation?: string;
  direction?: "outbound" | "inbound" | "undirected";
};

export type PositionedNode = {
  id: string;
  label: string;
  kind: NodeKind;
  visualKind: VisualNodeKind;
  semanticType?: SemanticNodeType;
  status?: string;
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
  relation?: string;
  direction?: "outbound" | "inbound" | "undirected";
};

export type ViewportState = {
  x: number;
  y: number;
  scale: number;
};

export type StructureFilters = {
  showImports: boolean;
  showExports: boolean;
  showTests: boolean;
  showFiles: boolean;
};

export type ArchitectureFilters = {
  viewType: "layers" | "communities";
  showViolationsOnly: boolean;
  layerFocusId: string | null;
};

export type PlanFilters = {
  statusFilter: "all" | "in-progress" | "blocked" | "completed";
  featureFocusId: string | null;
  showImplementingFiles: boolean;
  showTestCoverage: boolean;
};

export type DocumentationFilters = {
  kindFilter: "all" | "readme" | "adr" | "guide" | "reference";
  showLinkedCode: boolean;
};
