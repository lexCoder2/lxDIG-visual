import { MAX_VISIBLE_SIBLINGS } from "../config/constants";
import type {
  ExpansionNode,
  ExpansionPage,
  NodeKind,
  ProjectSummary,
  SemanticNodeType,
  VisualNodeKind,
} from "../types/graph";

type LxRAGNode = {
  id: string;
  labels: string[];
  name?: string;
  path?: string;
  kind?: string;
};

// Unused for now
// type LxRAGRelationship = {
//   type: string;
//   source: string;
//   target: string;
// };

/**
 * Client for querying lxRAG graph data via MCP tools
 * This adapter transforms lxRAG graph data into the format expected by the canvas
 */
export type LxRAGClient = {
  mode: "lxrag";
  listProjects: () => Promise<ProjectSummary[]>;
  expandNeighborhoodDepth: (params: {
    projectId: string;
    startNodeId: string;
    depth: number;
  }) => Promise<
    Array<{ parentId: string; total: number; children: ExpansionNode[] }>
  >;
  expandNodePage: (params: {
    projectId: string;
    parentId: string;
    page: number;
    pageSize?: number;
  }) => Promise<ExpansionPage>;
};

/**
 * Normalize labels to uppercase strings
 */
function normalizeLabels(labels: unknown[]): string[] {
  return labels.map((entry) => String(entry).toUpperCase()).filter(Boolean);
}

/**
 * Classify node based on labels to determine kind and visualKind
 */
function classifyNode(params: {
  labels: unknown[];
  relation?: unknown;
  id?: unknown;
}): { kind: NodeKind; visualKind: VisualNodeKind } {
  const labels = normalizeLabels(params.labels);
  const relation = String(params.relation ?? "").toUpperCase();
  const id = String(params.id ?? "").toLowerCase();
  const has = (...names: string[]) =>
    names.some((name) => labels.includes(name));

  if (has("PROJECT") || id.startsWith("project:")) {
    return { kind: "project", visualKind: "layer" };
  }
  if (has("FILE")) {
    return { kind: "structure", visualKind: "file" };
  }
  if (has("FOLDER")) {
    return { kind: "structure", visualKind: "module" };
  }
  if (has("FUNCTION", "CLASS", "IMPORT", "EXPORT", "VARIABLE", "TEST_SUITE")) {
    return { kind: "code", visualKind: "service" };
  }
  if (has("DOCUMENT", "SECTION")) {
    return { kind: "docs", visualKind: "module" };
  }
  if (has("FEATURE", "TASK")) {
    return { kind: "progress", visualKind: "module" };
  }
  if (has("EPISODE", "LEARNING", "CLAIM")) {
    return { kind: "memory", visualKind: "service" };
  }
  if (has("RULE", "LAYER", "COMMUNITY")) {
    return { kind: "architecture", visualKind: "layer" };
  }
  if (has("GRAPH_TX")) {
    return { kind: "system", visualKind: "module" };
  }
  if (relation.includes("IMPORT") || relation.includes("EXPORT")) {
    return { kind: "code", visualKind: "service" };
  }

  return { kind: "unknown", visualKind: "module" };
}

/**
 * Infer semantic type from labels and properties
 */
function inferSemanticType(params: {
  labels: unknown[];
  relation: unknown;
  name: unknown;
  id: unknown;
}): SemanticNodeType | undefined {
  const labels = params.labels
    .map((entry) => String(entry).toLowerCase())
    .filter(Boolean);
  const relation = String(params.relation ?? "").toLowerCase();
  const name = String(params.name ?? "").toLowerCase();
  const id = String(params.id ?? "").toLowerCase();

  if (labels.includes("function") || labels.includes("method")) {
    return "function";
  }
  if (
    labels.includes("class") ||
    labels.includes("interface") ||
    labels.includes("type")
  ) {
    return "class";
  }
  if (
    labels.includes("import") ||
    relation.includes("import") ||
    name.startsWith("import:") ||
    id.startsWith("import:")
  ) {
    return "import";
  }
  if (
    labels.includes("export") ||
    relation.includes("export") ||
    name.startsWith("export:") ||
    id.startsWith("export:")
  ) {
    return "export";
  }
  if (
    labels.includes("variable") ||
    labels.includes("var") ||
    labels.includes("constant") ||
    labels.includes("const")
  ) {
    return "variable";
  }
  if (
    labels.includes("test") ||
    labels.includes("test_suite") ||
    labels.includes("spec") ||
    name.includes("test") ||
    name.includes("spec")
  ) {
    // Tests are not a SemanticNodeType, return undefined
    return undefined;
  }

  return undefined;
}

/**
 * Build an ExpansionNode from raw lxRAG data
 */
function buildExpansionNode(params: {
  id: unknown;
  name: unknown;
  path: unknown;
  labels: unknown[];
  relation: unknown;
  relationDirection?: unknown;
}): ExpansionNode {
  const nodeId = String(params.id ?? "");
  const label = String(params.name ?? params.path ?? params.id ?? "unknown");
  const labels = Array.isArray(params.labels) ? params.labels : [];
  const classification = classifyNode({
    labels,
    relation: params.relation,
    id: params.id,
  });

  const relationDirectionRaw = String(
    params.relationDirection ?? "",
  ).toLowerCase();
  const relationDirection =
    relationDirectionRaw === "outbound" ||
    relationDirectionRaw === "inbound" ||
    relationDirectionRaw === "undirected"
      ? relationDirectionRaw
      : "undirected";

  return {
    id: nodeId,
    label,
    kind: classification.kind,
    visualKind: classification.visualKind,
    semanticType: inferSemanticType({
      labels,
      relation: params.relation,
      name: params.name,
      id: params.id,
    }),
    labels: normalizeLabels(labels),
    relation: params.relation ? String(params.relation) : undefined,
    relationDirection,
  };
}

/**
 * Query lxRAG graph via MCP tool proxy
 * This uses a simple fetch to a local proxy that wraps the MCP tool
 */
async function queryLxRAG(cypherQuery: string): Promise<any[]> {
  try {
    // Use the MCP tool directly via HTTP proxy (we'll set this up)
    const response = await fetch("http://localhost:3456/lxrag/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: cypherQuery,
        language: "cypher",
        limit: 1000,
      }),
    });

    if (!response.ok) {
      console.error("lxRAG query failed:", response.status);
      return [];
    }

    const result = await response.json();
    return result.data?.results || [];
  } catch (error) {
    console.error("lxRAG query error:", error);
    return [];
  }
}

/**
 * Extract a clean label from node ID or path
 */
function extractLabel(node: LxRAGNode): string {
  // Try name property first
  if (node.name) return node.name;

  // Try path property
  if (node.path) {
    const parts = node.path.split("/");
    return parts[parts.length - 1] || node.path;
  }

  // Extract from ID
  const id = node.id || "";

  // Handle file IDs: "code-visual:file:src/App.tsx" → "App.tsx"
  if (id.includes(":file:")) {
    const filePath = id.split(":file:")[1];
    const parts = filePath.split("/");
    return parts[parts.length - 1];
  }

  // Handle folder IDs: "code-visual:folder:/path/to/folder" → "folder"
  if (id.includes(":folder:")) {
    const folderPath = id.split(":folder:")[1];
    const parts = folderPath.split("/").filter(Boolean);
    return parts[parts.length - 1] || folderPath;
  }

  // Handle function/class IDs: "code-visual:App.tsx:functionName:42" → "functionName"
  const parts = id.split(":");
  if (parts.length >= 3) {
    return parts[2]; // Usually the symbol name
  }

  return id;
}

/**
 * Create lxRAG client
 */
export function createLxRAGClient(): LxRAGClient {
  return {
    mode: "lxrag",

    async listProjects() {
      // Query for PROJECT nodes or use current project
      const rows = await queryLxRAG(`
        MATCH (p)
        WHERE p:PROJECT OR p:FOLDER AND NOT (p)<-[:CONTAINS]-()
        RETURN p.id as id, labels(p) as labels, p.name as name, p.path as path
        LIMIT 10
      `);

      if (rows.length === 0) {
        // Fallback: return the current project
        return [
          {
            id: "code-visual",
            name: "code-visual",
            rootNodeId:
              "code-visual:folder:/home/alex_rod/projects/code-visual",
            rootKind: "project",
            rootVisualKind: "layer",
          },
        ];
      }

      return rows.map((row: any) => {
        const id = String(row.id || row.name || "unknown");
        const name = extractLabel(row);

        return {
          id,
          name,
          rootNodeId: row.id,
          rootKind: "project" as const,
          rootVisualKind: "layer" as const,
        };
      });
    },

    async expandNeighborhoodDepth(params) {
      const { startNodeId, depth } = params;

      // Query for neighbors up to specified depth using BFS
      const query = `
        MATCH path = (start)-[*1..${depth}]-(neighbor)
        WHERE start.id = $startId OR id(start) = $startId
        WITH start, neighbor, relationships(path) as rels, length(path) as dist
        WHERE dist <= ${depth}
        RETURN 
          start.id as startId,
          neighbor.id as neighborId,
          labels(neighbor) as neighborLabels,
          neighbor.name as neighborName,
          neighbor.path as neighborPath,
          type(rels[0]) as relationType,
          dist
        LIMIT 500
      `;

      const rows = await queryLxRAG(query);

      // Group by parent
      const childrenByParent: Record<string, ExpansionNode[]> = {};

      rows.forEach((row: any) => {
        const parentId = String(row.startId || startNodeId);
        if (!childrenByParent[parentId]) {
          childrenByParent[parentId] = [];
        }

        const child = buildExpansionNode({
          id: row.neighborId,
          name: row.neighborName,
          path: row.neighborPath,
          labels: row.neighborLabels || [],
          relation: row.relationType,
          relationDirection: "outbound",
        });

        childrenByParent[parentId].push(child);
      });

      return Object.entries(childrenByParent).map(([parentId, children]) => ({
        parentId,
        total: children.length,
        children,
      }));
    },

    async expandNodePage(params) {
      const { parentId, page, pageSize = MAX_VISIBLE_SIBLINGS } = params;

      // Query for direct children of the parent node
      const query = `
        MATCH (parent)-[rel]->(child)
        WHERE parent.id = $parentId OR id(parent) = $parentId
        RETURN 
          child.id as id,
          labels(child) as labels,
          child.name as name,
          child.path as path,
          type(rel) as relationType
        ORDER BY child.name
        SKIP ${page * pageSize}
        LIMIT ${pageSize}
      `;

      const rows = await queryLxRAG(query);

      const children = rows.map((row: any) =>
        buildExpansionNode({
          id: row.id,
          name: row.name,
          path: row.path,
          labels: row.labels || [],
          relation: row.relationType,
          relationDirection: "outbound",
        }),
      );

      // Get total count
      const countQuery = `
        MATCH (parent)-[]->(child)
        WHERE parent.id = $parentId OR id(parent) = $parentId
        RETURN count(child) as total
      `;

      const countRows = await queryLxRAG(countQuery);
      const total = countRows[0]?.total || children.length;

      return {
        parentId,
        page,
        total,
        children,
      };
    },
  };
}
