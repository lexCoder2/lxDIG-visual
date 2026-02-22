import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import hljs from "highlight.js/lib/common";
import { FaFileAlt, FaFolder } from "react-icons/fa";
import type { GraphNodeEntity, ViewMode } from "../types/graph";

type NodeViewerProps = {
  selectedNode?: GraphNodeEntity;
  viewMode: ViewMode;
};

type NodeDetails = {
  id: string;
  labels: string[];
  name?: string;
  path?: string;
  relativePath?: string;
  heading?: string;
  content?: string;
  docKind?: string;
  status?: string;
  startLine?: number;
  endLine?: number;
  filePath?: string;
  fileRelativePath?: string;
};

type FileContent = {
  path: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  content: string;
};

type RelatedLink = {
  rel: string;
  name: string;
  labels: string[];
};

type ArchitectureLinks = {
  outbound: RelatedLink[];
  inbound: RelatedLink[];
};

type FolderTreeItem = {
  name: string;
  depth: number;
  isFolder: boolean;
};

function readMemgraphQueryEndpoint(): string | null {
  const endpoint =
    (import.meta.env.VITE_MEMGRAPH_URL as string | undefined)?.trim() ||
    (import.meta.env.VITE_MEMGRAPH_ENDPOINT as string | undefined)?.trim() ||
    (import.meta.env.VITE_MEMGRAPH_URI as string | undefined)?.trim() ||
    "http://localhost:4001/query";

  if (!/^https?:\/\//i.test(endpoint)) return null;
  return endpoint;
}

function deriveProxyBase(queryEndpoint: string): string {
  return queryEndpoint.replace(/\/query\/?$/, "");
}

function codeLanguageFromPath(pathValue?: string): string {
  if (!pathValue) return "text";
  if (pathValue.endsWith(".ts") || pathValue.endsWith(".tsx"))
    return "typescript";
  if (pathValue.endsWith(".js") || pathValue.endsWith(".jsx"))
    return "javascript";
  if (pathValue.endsWith(".py")) return "python";
  if (pathValue.endsWith(".md")) return "markdown";
  return "text";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getHighlightedCode(content: string, language: string): string {
  if (!content) return "";

  const safeLanguage = language.toLowerCase();
  try {
    if (safeLanguage !== "text" && hljs.getLanguage(safeLanguage)) {
      return hljs.highlight(content, { language: safeLanguage }).value;
    }
    return hljs.highlightAuto(content).value;
  } catch {
    return escapeHtml(content);
  }
}

export function NodeViewer({ selectedNode, viewMode }: NodeViewerProps) {
  const queryEndpoint = useMemo(() => readMemgraphQueryEndpoint(), []);
  const proxyBase = useMemo(
    () => (queryEndpoint ? deriveProxyBase(queryEndpoint) : null),
    [queryEndpoint],
  );

  const [details, setDetails] = useState<NodeDetails | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [architectureLinks, setArchitectureLinks] = useState<ArchitectureLinks>(
    {
      outbound: [],
      inbound: [],
    },
  );
  const [folderTreeItems, setFolderTreeItems] = useState<FolderTreeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labels = useMemo(
    () =>
      new Set(
        (details?.labels ?? selectedNode?.labels ?? []).map((entry) =>
          String(entry).toUpperCase(),
        ),
      ),
    [details?.labels, selectedNode?.labels],
  );

  const isFileNode =
    labels.has("FILE") ||
    details?.path?.endsWith(".ts") ||
    details?.path?.endsWith(".tsx") ||
    selectedNode?.visualKind === "file";
  const isFolderNode =
    labels.has("FOLDER") ||
    (selectedNode?.kind === "structure" &&
      selectedNode?.visualKind === "module");
  const isSymbolNode =
    labels.has("FUNCTION") ||
    labels.has("CLASS") ||
    labels.has("METHOD") ||
    labels.has("INTERFACE") ||
    labels.has("TYPE") ||
    !!selectedNode?.semanticType;
  const isDocumentationNode =
    labels.has("DOCUMENT") ||
    labels.has("SECTION") ||
    details?.path?.endsWith(".md") ||
    details?.relativePath?.endsWith(".md") ||
    viewMode === "documentation" ||
    selectedNode?.kind === "docs" ||
    selectedNode?.kind === "progress";
  const isArchitectureNode =
    labels.has("LAYER") ||
    labels.has("RULE") ||
    labels.has("COMMUNITY") ||
    selectedNode?.kind === "architecture";

  useEffect(() => {
    if (!selectedNode || !queryEndpoint) {
      setDetails(null);
      setFileContent(null);
      setArchitectureLinks({ outbound: [], inbound: [] });
      setFolderTreeItems([]);
      return;
    }

    const controller = new AbortController();

    const run = async () => {
      setLoading(true);
      setError(null);
      setFileContent(null);
      setArchitectureLinks({ outbound: [], inbound: [] });
      setFolderTreeItems([]);

      try {
        const detailsQuery = `MATCH (n)
WHERE toString(n.id) = $nodeId OR toString(id(n)) = $nodeId
OPTIONAL MATCH (f:FILE)-[:CONTAINS*1..8]->(n)
WITH n, f
ORDER BY length(f.path) ASC
WITH n, collect(f)[0] AS file
RETURN toString(n.id) AS id,
       labels(n) AS labels,
       n.name AS name,
       n.path AS path,
       n.relativePath AS relativePath,
       n.heading AS heading,
       n.content AS content,
       n.kind AS docKind,
       n.status AS status,
       n.startLine AS startLine,
       n.endLine AS endLine,
       file.path AS filePath,
       file.relativePath AS fileRelativePath
LIMIT 1`;

        const response = await fetch(queryEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: detailsQuery,
            params: { nodeId: selectedNode.id },
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to load node details (${response.status})`);
        }

        const rows = (await response.json()) as Array<Record<string, unknown>>;
        const row = rows[0] ?? {};

        const nodeDetails: NodeDetails = {
          id: String(row.id ?? selectedNode.id),
          labels: Array.isArray(row.labels)
            ? row.labels.map((entry) => String(entry))
            : (selectedNode.labels ?? []),
          name: row.name ? String(row.name) : selectedNode.label,
          path: row.path ? String(row.path) : undefined,
          relativePath: row.relativePath ? String(row.relativePath) : undefined,
          heading: row.heading ? String(row.heading) : undefined,
          content: row.content ? String(row.content) : undefined,
          docKind: row.docKind ? String(row.docKind) : undefined,
          status: row.status ? String(row.status) : undefined,
          startLine:
            typeof row.startLine === "number"
              ? row.startLine
              : row.startLine
                ? Number(row.startLine)
                : undefined,
          endLine:
            typeof row.endLine === "number"
              ? row.endLine
              : row.endLine
                ? Number(row.endLine)
                : undefined,
          filePath: row.filePath ? String(row.filePath) : undefined,
          fileRelativePath: row.fileRelativePath
            ? String(row.fileRelativePath)
            : undefined,
        };

        setDetails(nodeDetails);

        const nodeLabels = new Set(
          nodeDetails.labels.map((entry) => entry.toUpperCase()),
        );
        const shouldLoadArchitecture =
          nodeLabels.has("LAYER") ||
          nodeLabels.has("RULE") ||
          nodeLabels.has("COMMUNITY") ||
          selectedNode.kind === "architecture";
        const shouldLoadPlanSummary =
          nodeLabels.has("FEATURE") ||
          nodeLabels.has("TASK") ||
          selectedNode.kind === "progress";

        if (shouldLoadArchitecture) {
          const linksQuery = `MATCH (n)
WHERE toString(n.id) = $nodeId OR toString(id(n)) = $nodeId
OPTIONAL MATCH (n)-[r]->(out)
WITH n, collect({ rel: type(r), name: coalesce(out.name, out.heading, out.path, toString(out.id)), labels: labels(out) }) AS outbound
OPTIONAL MATCH (in)-[ri]->(n)
RETURN outbound,
       collect({ rel: type(ri), name: coalesce(in.name, in.heading, in.path, toString(in.id)), labels: labels(in) }) AS inbound`;

          const linksResponse = await fetch(queryEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: linksQuery,
              params: { nodeId: selectedNode.id },
            }),
            signal: controller.signal,
          });

          if (linksResponse.ok) {
            const linksRows = (await linksResponse.json()) as Array<
              Record<string, unknown>
            >;
            const linksRow = linksRows[0] ?? {};
            const mapLinks = (items: unknown): RelatedLink[] => {
              if (!Array.isArray(items)) return [];
              return items
                .filter(Boolean)
                .map((item) => {
                  const entry = (item ?? {}) as Record<string, unknown>;
                  return {
                    rel: String(entry.rel ?? "RELATED_TO"),
                    name: String(entry.name ?? "unknown"),
                    labels: Array.isArray(entry.labels)
                      ? entry.labels.map((label) => String(label))
                      : [],
                  };
                })
                .slice(0, 24);
            };

            setArchitectureLinks({
              outbound: mapLinks(linksRow.outbound),
              inbound: mapLinks(linksRow.inbound),
            });
          }
        }

        if (shouldLoadPlanSummary) {
          const planSummaryQuery = `MATCH (n)
WHERE toString(n.id) = $nodeId OR toString(id(n)) = $nodeId
OPTIONAL MATCH (task:TASK)-[:APPLIES_TO]->(n)
OPTIONAL MATCH (n)-[:TARGETS]->(target)
RETURN collect(DISTINCT { name: coalesce(task.name, toString(task.id)), status: coalesce(task.status, "pending") }) AS tasks,
       collect(DISTINCT { name: coalesce(target.name, target.path, toString(target.id)), labels: labels(target) }) AS targets`;

          const planResponse = await fetch(queryEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: planSummaryQuery,
              params: { nodeId: selectedNode.id },
            }),
            signal: controller.signal,
          });

          if (planResponse.ok) {
            const planRows = (await planResponse.json()) as Array<
              Record<string, unknown>
            >;
            const planRow = planRows[0] ?? {};
            const tasks = Array.isArray(planRow.tasks)
              ? planRow.tasks
                  .map((entry) => {
                    const task = (entry ?? {}) as Record<string, unknown>;
                    return `- [${String(task.status ?? "pending")}] ${String(task.name ?? "task")}`;
                  })
                  .filter(Boolean)
              : [];
            const targets = Array.isArray(planRow.targets)
              ? planRow.targets
                  .map((entry) => {
                    const target = (entry ?? {}) as Record<string, unknown>;
                    return `- ${String(target.name ?? "target")}`;
                  })
                  .filter(Boolean)
              : [];

            const summaryParts = [
              `## Plan Summary`,
              nodeDetails.status ? `**Status:** ${nodeDetails.status}` : "",
              tasks.length > 0 ? `### Tasks\n${tasks.join("\n")}` : "",
              targets.length > 0 ? `### Targets\n${targets.join("\n")}` : "",
            ].filter(Boolean);

            if (summaryParts.length > 0) {
              nodeDetails.content = summaryParts.join("\n\n");
              setDetails({ ...nodeDetails });
            }
          }
        }

        if (isFolderNode) {
          const folderTreeQuery = `MATCH (n)
WHERE toString(n.id) = $nodeId OR toString(id(n)) = $nodeId
OPTIONAL MATCH p = (n)-[:CONTAINS*1..2]->(child)
WITH child, length(p) AS depth
WHERE child IS NOT NULL
RETURN coalesce(child.name, child.path, toString(child.id)) AS name,
       labels(child) AS labels,
       depth
ORDER BY depth ASC, name ASC
LIMIT 300`;

          const folderTreeResponse = await fetch(queryEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: folderTreeQuery,
              params: { nodeId: selectedNode.id },
            }),
            signal: controller.signal,
          });

          if (folderTreeResponse.ok) {
            const treeRows = (await folderTreeResponse.json()) as Array<
              Record<string, unknown>
            >;
            const treeItems = treeRows.map((row) => {
              const depth = Math.max(1, Number(row.depth ?? 1));
              const labels = Array.isArray(row.labels)
                ? row.labels.map((entry) => String(entry).toUpperCase())
                : [];
              return {
                depth,
                isFolder: labels.includes("FOLDER"),
                name: String(row.name ?? "unknown"),
              };
            });

            if (treeItems.length > 0) {
              setFolderTreeItems(treeItems);
            }
          }
        }

        if (proxyBase) {
          const preferredFilePath = nodeDetails.path || nodeDetails.filePath;

          if (isFileNode && preferredFilePath) {
            const fileResponse = await fetch(
              `${proxyBase}/file?path=${encodeURIComponent(preferredFilePath)}`,
              { signal: controller.signal },
            );
            if (fileResponse.ok) {
              setFileContent((await fileResponse.json()) as FileContent);
            }
          } else if (isSymbolNode && preferredFilePath) {
            const lineStart = nodeDetails.startLine ?? 1;
            const lineEnd = nodeDetails.endLine ?? Math.max(lineStart + 40, 80);
            const snippetResponse = await fetch(
              `${proxyBase}/file?path=${encodeURIComponent(preferredFilePath)}&startLine=${lineStart}&endLine=${lineEnd}`,
              { signal: controller.signal },
            );
            if (snippetResponse.ok) {
              setFileContent((await snippetResponse.json()) as FileContent);
            }
          } else if (
            isDocumentationNode &&
            preferredFilePath &&
            preferredFilePath.endsWith(".md") &&
            !nodeDetails.content
          ) {
            const markdownResponse = await fetch(
              `${proxyBase}/file?path=${encodeURIComponent(preferredFilePath)}`,
              { signal: controller.signal },
            );
            if (markdownResponse.ok) {
              const markdownFile =
                (await markdownResponse.json()) as FileContent;
              setFileContent(markdownFile);
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load preview");
      } finally {
        setLoading(false);
      }
    };

    void run();

    return () => {
      controller.abort();
    };
  }, [
    selectedNode,
    queryEndpoint,
    proxyBase,
    isFileNode,
    isFolderNode,
    isSymbolNode,
    isDocumentationNode,
  ]);

  const title = details?.name ?? selectedNode?.label ?? "Viewer";
  const subtitle =
    details?.relativePath ||
    details?.path ||
    details?.heading ||
    selectedNode?.id;

  const markdownContent = details?.content || fileContent?.content || "";
  const codeContent = fileContent?.content || "";
  const language = codeLanguageFromPath(
    details?.path || details?.filePath || details?.relativePath,
  );
  const highlightedCode = useMemo(
    () => getHighlightedCode(codeContent, language),
    [codeContent, language],
  );

  return (
    <aside className="node-viewer" aria-label="Selected node viewer">
      <header className="node-viewer-header">
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>

      {!queryEndpoint ? (
        <div className="viewer-empty">
          Live preview unavailable in mock mode.
        </div>
      ) : null}

      {loading ? <div className="viewer-empty">Loading preview…</div> : null}
      {error ? <div className="viewer-error">{error}</div> : null}

      {!selectedNode && !loading ? (
        <div className="viewer-empty">
          Select a node to inspect code, docs, plan details, or architecture
          links.
        </div>
      ) : null}

      {selectedNode && !loading && !error ? (
        <section className="viewer-content">
          <div className="viewer-meta-row">
            <span className="viewer-badge">{selectedNode.kind}</span>
            {selectedNode.semanticType ? (
              <span className="viewer-badge">{selectedNode.semanticType}</span>
            ) : null}
            {details?.status ? (
              <span className="viewer-badge">{details.status}</span>
            ) : null}
            {details?.docKind ? (
              <span className="viewer-badge">{details.docKind}</span>
            ) : null}
          </div>

          {isArchitectureNode ? (
            <div className="viewer-architecture">
              <h3>Architecture Relations</h3>
              <div className="viewer-architecture-columns">
                <div>
                  <h4>Outbound</h4>
                  <ul>
                    {architectureLinks.outbound.length === 0 ? (
                      <li>None</li>
                    ) : (
                      architectureLinks.outbound.map((item, index) => (
                        <li key={`out-${index}`}>
                          <strong>{item.rel}</strong> → {item.name}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
                <div>
                  <h4>Inbound</h4>
                  <ul>
                    {architectureLinks.inbound.length === 0 ? (
                      <li>None</li>
                    ) : (
                      architectureLinks.inbound.map((item, index) => (
                        <li key={`in-${index}`}>
                          <strong>{item.rel}</strong> ← {item.name}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>
            </div>
          ) : null}

          {isFolderNode && folderTreeItems.length > 0 ? (
            <article className="viewer-markdown viewer-folder-tree">
              <h3>Folder Structure</h3>
              <ul>
                {folderTreeItems.map((item, index) => (
                  <li
                    key={`${item.name}-${index}`}
                    style={{ paddingLeft: `${(item.depth - 1) * 0.85}rem` }}
                  >
                    <span
                      className="viewer-folder-tree-icon"
                      aria-hidden="true"
                    >
                      {item.isFolder ? (
                        <FaFolder size={11} />
                      ) : (
                        <FaFileAlt size={10} />
                      )}
                    </span>
                    <span>{item.name}</span>
                  </li>
                ))}
              </ul>
            </article>
          ) : null}

          {isDocumentationNode && markdownContent ? (
            <article className="viewer-markdown">
              <ReactMarkdown>{markdownContent}</ReactMarkdown>
            </article>
          ) : null}

          {(isFileNode || isSymbolNode) && codeContent ? (
            <div className="viewer-code-wrap">
              <div className="viewer-code-meta">
                <span>{language}</span>
                <span>
                  {fileContent?.startLine ?? 1}-{fileContent?.endLine ?? 1}
                </span>
              </div>
              <pre className="viewer-code">
                <code
                  className={`hljs language-${language}`}
                  dangerouslySetInnerHTML={{ __html: highlightedCode }}
                />
              </pre>
            </div>
          ) : null}

          {!isArchitectureNode &&
          folderTreeItems.length === 0 &&
          !markdownContent &&
          !codeContent ? (
            <div className="viewer-empty">
              No preview content available for this node yet.
            </div>
          ) : null}
        </section>
      ) : null}
    </aside>
  );
}
