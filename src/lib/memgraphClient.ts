import { MAX_VISIBLE_SIBLINGS } from "../config/constants";
import type {
  ExpansionNode,
  ExpansionPage,
  NodeKind,
  ProjectSummary,
  SemanticNodeType,
  VisualNodeKind,
} from "../types/graph";

type QueryRow = Record<string, unknown>;

type QueryPayload =
  | QueryRow[]
  | { results?: QueryRow[]; data?: QueryRow[]; rows?: QueryRow[] };

type SchemaMode = "legacy" | "full";

export type MemgraphClient = {
  mode: "live" | "mock";
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

const MOCK_PROJECTS: ProjectSummary[] = [
  {
    id: "code-visual",
    name: "code-visual",
    rootNodeId: "project:code-visual",
    rootKind: "project",
    rootVisualKind: "layer",
  },
  {
    id: "platform-core",
    name: "platform-core",
    rootNodeId: "project:platform-core",
    rootKind: "project",
    rootVisualKind: "layer",
  },
  {
    id: "search-service",
    name: "search-service",
    rootNodeId: "project:search-service",
    rootKind: "project",
    rootVisualKind: "layer",
  },
];

const MOCK_CHILDREN: Record<string, ExpansionNode[]> = {
  "project:code-visual": [
    {
      id: "src",
      label: "src",
      kind: "structure",
      visualKind: "module",
      relation: "CONTAINS",
      relationDirection: "outbound",
    },
    {
      id: "styles",
      label: "styles",
      kind: "structure",
      visualKind: "module",
      relation: "CONTAINS",
      relationDirection: "outbound",
    },
    {
      id: "entry",
      label: "entrypoints",
      kind: "structure",
      visualKind: "module",
      relation: "CONTAINS",
      relationDirection: "outbound",
    },
    {
      id: "docs",
      label: "docs",
      kind: "docs",
      visualKind: "module",
      relation: "CONTAINS",
      relationDirection: "outbound",
    },
    ...Array.from({ length: 29 }, (_, index) => ({
      id: `pkg:${index + 1}`,
      label: `package-${index + 1}`,
      kind: "code" as NodeKind,
      visualKind: "service" as VisualNodeKind,
      relation: "DEPENDS_ON",
      relationDirection: "outbound" as const,
    })),
  ],
  src: [
    {
      id: "src:app",
      label: "App.tsx",
      kind: "structure",
      visualKind: "file",
      relation: "CONTAINS",
      relationDirection: "outbound",
    },
    {
      id: "src:main",
      label: "main.tsx",
      kind: "structure",
      visualKind: "file",
      relation: "CONTAINS",
      relationDirection: "outbound",
    },
    {
      id: "src:hooks",
      label: "hooks",
      kind: "structure",
      visualKind: "module",
      relation: "CONTAINS",
      relationDirection: "outbound",
    },
    {
      id: "src:state",
      label: "state",
      kind: "structure",
      visualKind: "module",
      relation: "CONTAINS",
      relationDirection: "outbound",
    },
    {
      id: "src:lib",
      label: "lib",
      kind: "structure",
      visualKind: "module",
      relation: "CONTAINS",
      relationDirection: "outbound",
    },
  ],
  styles: [
    {
      id: "styles:index",
      label: "index.css",
      kind: "structure",
      visualKind: "file",
      relation: "STYLES",
      relationDirection: "outbound",
    },
    {
      id: "styles:app",
      label: "App.css",
      kind: "structure",
      visualKind: "file",
      relation: "STYLES",
      relationDirection: "outbound",
    },
  ],
  entry: [
    {
      id: "entry:main",
      label: "main.tsx",
      kind: "structure",
      visualKind: "file",
      relation: "BOOTS",
      relationDirection: "outbound",
    },
    {
      id: "entry:root",
      label: "index.html#root",
      kind: "structure",
      visualKind: "file",
      relation: "MOUNTS",
      relationDirection: "outbound",
    },
  ],
};

function parseRows(payload: QueryPayload): QueryRow[] {
  if (Array.isArray(payload)) return payload;
  return payload.results ?? payload.data ?? payload.rows ?? [];
}

function normalizeLabels(labels: unknown[]): string[] {
  return labels
    .map((entry) => String(entry).trim().toUpperCase())
    .filter(Boolean);
}

function isLiveNode(alias: string): string {
  return `(${alias}.validTo IS NULL OR toInteger(${alias}.validTo) = 0 OR toInteger(${alias}.validTo) > timestamp() OR toInteger(${alias}.validTo) >= 999999999999)`;
}

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

  return undefined;
}

function buildExpansionNode(params: {
  id: unknown;
  name: unknown;
  path: unknown;
  labels: unknown[];
  relation: unknown;
  relationDirection?: unknown;
  status?: unknown;
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
    status: params.status ? String(params.status) : undefined,
  };
}

function ensurePage(params: {
  children: ExpansionNode[];
  page: number;
  pageSize: number;
  parentId: string;
}): ExpansionPage {
  const { children, page, pageSize, parentId } = params;
  const start = page * pageSize;
  return {
    parentId,
    page,
    total: children.length,
    children: children.slice(start, start + pageSize),
  };
}

function ensureNeighborhood(params: {
  childrenByParent: Record<string, ExpansionNode[]>;
  startNodeId: string;
}): Array<{ parentId: string; total: number; children: ExpansionNode[] }> {
  const { childrenByParent, startNodeId } = params;
  const parentIds = Object.keys(childrenByParent);
  if (parentIds.length === 0) {
    return [{ parentId: startNodeId, total: 0, children: [] }];
  }

  return parentIds.map((parentId) => {
    const children = childrenByParent[parentId] ?? [];
    return {
      parentId,
      total: children.length,
      children,
    };
  });
}

async function postQuery(
  endpoint: string,
  query: string,
  params: Record<string, unknown>,
): Promise<QueryRow[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, params }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Memgraph request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as QueryPayload;
    return parseRows(payload);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createMemgraphClient(): MemgraphClient {
  const configuredEndpoint =
    (import.meta.env.VITE_MEMGRAPH_URL as string | undefined)?.trim() ||
    (import.meta.env.VITE_MEMGRAPH_ENDPOINT as string | undefined)?.trim() ||
    (import.meta.env.VITE_MEMGRAPH_URI as string | undefined)?.trim();

  const endpoint =
    configuredEndpoint && /^https?:\/\//i.test(configuredEndpoint)
      ? configuredEndpoint
      : undefined;

  const configuredSchemaMode =
    (import.meta.env.VITE_MEMGRAPH_SCHEMA_MODE as string | undefined)
      ?.trim()
      .toLowerCase() ?? "full";
  const schemaMode: SchemaMode =
    configuredSchemaMode === "legacy" ? "legacy" : "full";
  const isLegacySchemaMode = schemaMode === "legacy";

  if (!endpoint) {
    return {
      mode: "mock",
      async listProjects() {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return MOCK_PROJECTS;
      },
      async expandNodePage({
        parentId,
        page,
        pageSize = MAX_VISIBLE_SIBLINGS,
      }) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return ensurePage({
          children: MOCK_CHILDREN[parentId] ?? [],
          page,
          pageSize,
          parentId,
        });
      },
      async expandNeighborhoodDepth({ startNodeId, depth }) {
        await new Promise((resolve) => setTimeout(resolve, 120));

        const safeDepth = Math.max(1, Math.min(4, Math.trunc(depth)));
        const queue: Array<{ id: string; depth: number }> = [
          { id: startNodeId, depth: 0 },
        ];
        const visited = new Set<string>();
        const childrenByParent: Record<string, ExpansionNode[]> = {};

        while (queue.length > 0) {
          const current = queue.shift();
          if (!current || visited.has(current.id)) continue;
          visited.add(current.id);

          if (current.depth >= safeDepth) continue;

          const children = MOCK_CHILDREN[current.id] ?? [];
          childrenByParent[current.id] = children;
          children.forEach((child) => {
            if (!visited.has(child.id)) {
              queue.push({ id: child.id, depth: current.depth + 1 });
            }
          });
        }

        return ensureNeighborhood({ childrenByParent, startNodeId });
      },
    };
  }

  return {
    mode: "live",
    async listProjects() {
      if (!isLegacySchemaMode) {
        const healthQuery = `MATCH (n)
WHERE n.projectId IS NOT NULL
RETURN count(n) AS totalNodes,
       sum(CASE
             WHEN n:FILE OR n:FOLDER OR n:FUNCTION OR n:CLASS OR n:IMPORT OR n:EXPORT OR n:VARIABLE
               OR n:TEST_SUITE OR n:DOCUMENT OR n:SECTION OR n:FEATURE OR n:TASK OR n:EPISODE
               OR n:LEARNING OR n:CLAIM OR n:RULE OR n:COMMUNITY OR n:GRAPH_TX
             THEN 1 ELSE 0
           END) AS supportedNodes`;

        const healthRows = await postQuery(endpoint, healthQuery, {});
        const totalNodes = Number(healthRows[0]?.totalNodes ?? 0);
        const supportedNodes = Number(healthRows[0]?.supportedNodes ?? 0);

        if (totalNodes > 0 && supportedNodes === 0) {
          throw new Error(
            "Unsupported graph schema detected. Set VITE_MEMGRAPH_SCHEMA_MODE=legacy for backward compatibility.",
          );
        }
      }

      const query = `MATCH (n)
WHERE n.projectId IS NOT NULL
RETURN toString(n.projectId) AS projectId, count(n) AS nodeCount
ORDER BY nodeCount DESC`;

      const rows = await postQuery(endpoint, query, {});

      const projects = rows
        .map((row) => {
          const projectId = String(row.projectId ?? "");
          const nodeCount = Number(row.nodeCount ?? 0);

          if (!projectId) return null;

          return {
            id: projectId,
            name: `${projectId} (${nodeCount})`,
          };
        })
        .filter((item): item is { id: string; name: string } => item !== null);

      const rootLookups = await Promise.all(
        projects.map(async (project) => {
          const rootQuery = isLegacySchemaMode
            ? `MATCH (n)
WHERE toString(n.projectId) = $projectId
RETURN toString(id(n)) AS internalId,
       n.id AS explicitId,
       n.name AS name,
       n.path AS path,
       labels(n) AS labels
ORDER BY name ASC, path ASC
LIMIT 1`
            : `MATCH (n)
WHERE toString(n.projectId) = $projectId
  AND ${isLiveNode("n")}
  AND (n.name = $projectId OR n.path CONTAINS $projectId)
WITH n,
     CASE
       WHEN n:PROJECT THEN 0
       WHEN n:FOLDER THEN 1
       WHEN n:FILE THEN 2
       WHEN n:CLASS OR n:FUNCTION THEN 3
       ELSE 9
     END AS rootRank
RETURN toString(id(n)) AS internalId,
       n.id AS explicitId,
       n.name AS name,
       n.path AS path,
       labels(n) AS labels
ORDER BY rootRank ASC, length(n.path) ASC, name ASC
LIMIT 1`;

          const rootRows = await postQuery(endpoint, rootQuery, {
            projectId: project.id,
          });

          const rootRow = rootRows[0] ?? {};
          const rootNodeId = String(
            rootRow.explicitId ?? rootRow.internalId ?? project.id,
          );
          const classification = classifyNode({
            labels: Array.isArray(rootRow.labels) ? rootRow.labels : [],
            id: rootRow.explicitId ?? rootRow.internalId,
          });

          return {
            id: project.id,
            name: project.name,
            rootNodeId,
            rootKind: classification.kind,
            rootVisualKind: classification.visualKind,
          } satisfies ProjectSummary;
        }),
      );

      return rootLookups;
    },
    async expandNeighborhoodDepth({ projectId, startNodeId, depth }) {
      const safeDepth = Math.max(1, Math.min(4, Math.trunc(depth)));
      const hasProjectFilter = projectId.length > 0;
      const rootProjectFilter = hasProjectFilter
        ? "\n  AND toString(root.projectId) = $projectId"
        : "";
      const relationProjectFilter = hasProjectFilter
        ? isLegacySchemaMode
          ? "\n  AND (toString(parent.projectId) = $projectId OR toString(child.projectId) = $projectId)"
          : "\n  AND (toString(parent.projectId) = $projectId OR toString(child.projectId) = $projectId OR parent.projectId IS NULL OR child.projectId IS NULL)"
        : "";
      const rootLiveFilter = isLegacySchemaMode
        ? ""
        : `\n  AND ${isLiveNode("root")}`;
      const parentChildLiveFilter = isLegacySchemaMode
        ? ""
        : `\n  AND ${isLiveNode("parent")}\n  AND ${isLiveNode("child")}`;

      const query = `MATCH (root)
WHERE (toString(root.id) = $startNodeId OR toString(id(root)) = $startNodeId)${rootProjectFilter}${rootLiveFilter}
OPTIONAL MATCH p = (root)-[*1..${safeDepth}]-(target)
WITH p
WHERE p IS NOT NULL
UNWIND range(0, size(relationships(p)) - 1) AS step
WITH nodes(p)[step] AS parent, nodes(p)[step + 1] AS child, relationships(p)[step] AS rel
WHERE parent IS NOT NULL AND child IS NOT NULL${parentChildLiveFilter}${relationProjectFilter}
WITH DISTINCT parent, child, rel
RETURN toString(id(parent)) AS parentInternalId,
       parent.id AS parentExplicitId,
       parent.name AS parentName,
       parent.path AS parentPath,
       labels(parent) AS parentLabels,
       parent.status AS parentStatus,
       toString(id(child)) AS childInternalId,
       child.id AS childExplicitId,
       child.name AS childName,
       child.path AS childPath,
       labels(child) AS childLabels,
       child.status AS childStatus,
       type(rel) AS relation,
       CASE
         WHEN startNode(rel) = parent THEN 'outbound'
         WHEN endNode(rel) = parent THEN 'inbound'
         ELSE 'undirected'
       END AS relationDirection
ORDER BY parentName, parentPath, parentExplicitId, parentInternalId,
         childName, childPath, childExplicitId, childInternalId`;

      const queryParams = hasProjectFilter
        ? { startNodeId, projectId }
        : { startNodeId };
      const rows = await postQuery(endpoint, query, queryParams);

      const dedupeByParent: Record<string, Set<string>> = {};
      const childrenByParent: Record<string, ExpansionNode[]> = {};

      rows.forEach((row) => {
        const parentId = String(
          row.parentExplicitId ?? row.parentInternalId ?? "",
        );
        const childId = String(
          row.childExplicitId ?? row.childInternalId ?? "",
        );
        if (!parentId || !childId) return;

        const relation = row.relation ? String(row.relation) : "RELATED_TO";
        const direction =
          row.relationDirection && typeof row.relationDirection === "string"
            ? row.relationDirection
            : "undirected";
        const dedupeKey = isLegacySchemaMode
          ? childId
          : `${childId}::${relation}::${direction}`;

        dedupeByParent[parentId] =
          dedupeByParent[parentId] ?? new Set<string>();
        if (dedupeByParent[parentId].has(dedupeKey)) return;
        dedupeByParent[parentId].add(dedupeKey);

        const labels = Array.isArray(row.childLabels) ? row.childLabels : [];
        childrenByParent[parentId] = childrenByParent[parentId] ?? [];
        childrenByParent[parentId].push(
          buildExpansionNode({
            id: row.childExplicitId ?? row.childInternalId,
            name: row.childName,
            path: row.childPath,
            labels,
            relation: row.relation,
            relationDirection: row.relationDirection,
            status: row.childStatus,
          }),
        );
      });

      return ensureNeighborhood({ childrenByParent, startNodeId });
    },
    async expandNodePage({
      projectId,
      parentId,
      page,
      pageSize = MAX_VISIBLE_SIBLINGS,
    }) {
      const offset = page * pageSize;
      const safeOffset = Math.max(0, Math.trunc(offset));
      const safeLimit = Math.max(1, Math.trunc(pageSize));
      const hasProjectFilter = projectId.length > 0;
      const projectFilter = hasProjectFilter
        ? isLegacySchemaMode
          ? "\n  AND toString(c.projectId) = $projectId"
          : "\n  AND (toString(c.projectId) = $projectId OR c.projectId IS NULL)"
        : "";
      const liveNodeFilter = isLegacySchemaMode
        ? ""
        : `\n  AND ${isLiveNode("p")}\n  AND ${isLiveNode("c")}`;

      const countQueryByProperty = `MATCH (p)-[r]-(c)
WHERE toString(p.id) = $parentId${liveNodeFilter}${projectFilter}
RETURN count(DISTINCT c) AS total`;

      const dataQueryByProperty = `MATCH (p)-[r]-(c)
WHERE toString(p.id) = $parentId${liveNodeFilter}${projectFilter}
RETURN toString(id(c)) AS internalId,
       c.id AS explicitId,
       c.name AS name,
       c.path AS path,       c.status AS status,       labels(c) AS labels,
       type(r) AS relation,
       CASE
         WHEN startNode(r) = p THEN 'outbound'
         WHEN endNode(r) = p THEN 'inbound'
         ELSE 'undirected'
       END AS relationDirection
ORDER BY name, path, explicitId, internalId
SKIP ${safeOffset}
LIMIT ${safeLimit}`;

      const queryParams = hasProjectFilter
        ? { parentId, projectId }
        : { parentId };
      const countRows = await postQuery(
        endpoint,
        countQueryByProperty,
        queryParams,
      );

      let dataRows = await postQuery(endpoint, dataQueryByProperty, {
        ...queryParams,
      });

      let total = Number(countRows[0]?.total ?? 0);

      if (total === 0 && /^\d+$/.test(parentId)) {
        const countQueryByInternal = `MATCH (p)-[r]-(c)
WHERE id(p) = toInteger($parentId)${liveNodeFilter}${projectFilter}
RETURN count(DISTINCT c) AS total`;

        const dataQueryByInternal = `MATCH (p)-[r]-(c)
WHERE id(p) = toInteger($parentId)${liveNodeFilter}${projectFilter}
RETURN toString(id(c)) AS internalId,
       c.id AS explicitId,
       c.name AS name,
       c.path AS path,
       c.status AS status,
       labels(c) AS labels,
       type(r) AS relation,
       CASE
         WHEN startNode(r) = p THEN 'outbound'
         WHEN endNode(r) = p THEN 'inbound'
         ELSE 'undirected'
       END AS relationDirection
ORDER BY name, path, explicitId, internalId
SKIP ${safeOffset}
LIMIT ${safeLimit}`;

        const fallbackCountRows = await postQuery(
          endpoint,
          countQueryByInternal,
          queryParams,
        );
        total = Number(fallbackCountRows[0]?.total ?? 0);

        dataRows = await postQuery(endpoint, dataQueryByInternal, {
          ...queryParams,
        });
      }
      return {
        parentId,
        page,
        total,
        children: dataRows
          .map((row) =>
            buildExpansionNode({
              id: row.explicitId ?? row.internalId,
              name: row.name,
              path: row.path,
              labels: Array.isArray(row.labels) ? row.labels : [],
              relation: row.relation,
              relationDirection: row.relationDirection,
              status: row.status,
            }),
          )
          .filter((item) => item.id.length > 0),
      };
    },
  };
}
