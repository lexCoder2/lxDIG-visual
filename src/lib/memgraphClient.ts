import { MAX_VISIBLE_SIBLINGS } from "../config/constants";
import type {
  ExpansionNode,
  ExpansionPage,
  NodeKind,
  ProjectSummary,
  SemanticNodeType,
} from "../types/graph";

type QueryRow = Record<string, unknown>;

type QueryPayload =
  | QueryRow[]
  | { results?: QueryRow[]; data?: QueryRow[]; rows?: QueryRow[] };

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
  { id: "code-visual", name: "code-visual", rootNodeId: "project:code-visual" },
  {
    id: "platform-core",
    name: "platform-core",
    rootNodeId: "project:platform-core",
  },
  {
    id: "search-service",
    name: "search-service",
    rootNodeId: "project:search-service",
  },
];

const MOCK_CHILDREN: Record<string, ExpansionNode[]> = {
  "project:code-visual": [
    { id: "src", label: "src", kind: "module", relation: "contains" },
    { id: "styles", label: "styles", kind: "module", relation: "contains" },
    { id: "entry", label: "entrypoints", kind: "module", relation: "contains" },
    { id: "docs", label: "docs", kind: "module", relation: "contains" },
    ...Array.from({ length: 29 }, (_, index) => ({
      id: `pkg:${index + 1}`,
      label: `package-${index + 1}`,
      kind: "service" as NodeKind,
      relation: "depends_on",
    })),
  ],
  src: [
    { id: "src:app", label: "App.tsx", kind: "file", relation: "contains" },
    { id: "src:main", label: "main.tsx", kind: "file", relation: "contains" },
    { id: "src:hooks", label: "hooks", kind: "module", relation: "contains" },
    { id: "src:state", label: "state", kind: "module", relation: "contains" },
    { id: "src:lib", label: "lib", kind: "module", relation: "contains" },
  ],
  styles: [
    {
      id: "styles:index",
      label: "index.css",
      kind: "file",
      relation: "styles",
    },
    { id: "styles:app", label: "App.css", kind: "file", relation: "styles" },
  ],
  entry: [
    { id: "entry:main", label: "main.tsx", kind: "file", relation: "boots" },
    {
      id: "entry:root",
      label: "index.html#root",
      kind: "file",
      relation: "mounts",
    },
  ],
};

function parseRows(payload: QueryPayload): QueryRow[] {
  if (Array.isArray(payload)) return payload;
  return payload.results ?? payload.data ?? payload.rows ?? [];
}

function mapKind(raw: unknown): NodeKind {
  if (
    raw === "layer" ||
    raw === "module" ||
    raw === "service" ||
    raw === "file"
  ) {
    return raw;
  }
  return "module";
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
  if (labels.includes("class")) {
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
          const rootByPropertyQuery = `MATCH (n)
WHERE toString(n.projectId) = $projectId AND n.id IS NOT NULL
RETURN toString(n.id) AS rootNodeId
LIMIT 1`;

          const rootRows = await postQuery(endpoint, rootByPropertyQuery, {
            projectId: project.id,
          });

          const rootByInternalIdQuery = `MATCH (n)
WHERE toString(n.projectId) = $projectId
RETURN id(n) AS rootNodeId
LIMIT 1`;

          const fallbackRows =
            rootRows.length > 0
              ? rootRows
              : await postQuery(endpoint, rootByInternalIdQuery, {
                  projectId: project.id,
                });
          const rootNodeId = String(fallbackRows[0]?.rootNodeId ?? project.id);

          return {
            id: project.id,
            name: project.name,
            rootNodeId,
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
        ? "\n  AND (toString(parent.projectId) = $projectId OR toString(child.projectId) = $projectId)"
        : "";

      const query = `MATCH (root)
WHERE (toString(root.id) = $startNodeId OR toString(id(root)) = $startNodeId)${rootProjectFilter}
OPTIONAL MATCH p = (root)-[*1..${safeDepth}]-(target)
WITH p
WHERE p IS NOT NULL
UNWIND range(0, size(relationships(p)) - 1) AS step
WITH nodes(p)[step] AS parent, nodes(p)[step + 1] AS child, relationships(p)[step] AS rel
WHERE parent IS NOT NULL AND child IS NOT NULL${relationProjectFilter}
WITH DISTINCT parent, child, rel
RETURN toString(id(parent)) AS parentInternalId,
       parent.id AS parentExplicitId,
       parent.name AS parentName,
       parent.path AS parentPath,
       labels(parent) AS parentLabels,
       toString(id(child)) AS childInternalId,
       child.id AS childExplicitId,
       child.name AS childName,
       child.path AS childPath,
       labels(child) AS childLabels,
       type(rel) AS relation
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

        dedupeByParent[parentId] =
          dedupeByParent[parentId] ?? new Set<string>();
        if (dedupeByParent[parentId].has(childId)) return;
        dedupeByParent[parentId].add(childId);

        const labels = Array.isArray(row.childLabels) ? row.childLabels : [];
        childrenByParent[parentId] = childrenByParent[parentId] ?? [];
        childrenByParent[parentId].push({
          id: childId,
          label: String(
            row.childName ??
              row.childPath ??
              row.childExplicitId ??
              row.childInternalId ??
              "unknown",
          ),
          kind: mapKind(
            labels.length > 0
              ? String(labels[0]).toLowerCase() === "file"
                ? "file"
                : String(labels[0]).toLowerCase() === "function"
                  ? "service"
                  : String(labels[0]).toLowerCase() === "folder"
                    ? "module"
                    : "module"
              : "module",
          ),
          semanticType: inferSemanticType({
            labels,
            relation: row.relation,
            name: row.childName,
            id: row.childExplicitId ?? row.childInternalId,
          }),
          relation: row.relation ? String(row.relation) : undefined,
        });
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
        ? "\n  AND c.projectId = $projectId"
        : "";

      const countQueryByProperty = `MATCH (p)-[r]-(c)
WHERE toString(p.id) = $parentId${projectFilter}
RETURN count(c) AS total`;

      const dataQueryByProperty = `MATCH (p)-[r]-(c)
WHERE toString(p.id) = $parentId${projectFilter}
RETURN toString(id(c)) AS internalId,
       c.id AS explicitId,
       c.name AS name,
       c.path AS path,
       labels(c) AS labels,
       type(r) AS relation
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
WHERE id(p) = toInteger($parentId)${projectFilter}
RETURN count(c) AS total`;

        const dataQueryByInternal = `MATCH (p)-[r]-(c)
WHERE id(p) = toInteger($parentId)${projectFilter}
RETURN toString(id(c)) AS internalId,
       c.id AS explicitId,
       c.name AS name,
       c.path AS path,
       labels(c) AS labels,
       type(r) AS relation
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
          .map((row) => ({
            id: String(row.explicitId ?? row.internalId ?? ""),
            label: String(
              row.name ??
                row.path ??
                row.explicitId ??
                row.internalId ??
                "unknown",
            ),
            kind: mapKind(
              Array.isArray(row.labels) && row.labels.length > 0
                ? String(row.labels[0]).toLowerCase() === "file"
                  ? "file"
                  : String(row.labels[0]).toLowerCase() === "function"
                    ? "service"
                    : String(row.labels[0]).toLowerCase() === "folder"
                      ? "module"
                      : "module"
                : "module",
            ),
            semanticType: inferSemanticType({
              labels: Array.isArray(row.labels) ? row.labels : [],
              relation: row.relation,
              name: row.name,
              id: row.explicitId ?? row.internalId,
            }),
            relation: row.relation ? String(row.relation) : undefined,
          }))
          .filter((item) => item.id.length > 0),
      };
    },
  };
}
