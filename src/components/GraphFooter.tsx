import { MAX_VISIBLE_SIBLINGS } from "../config/constants";
import type { GraphNodeEntity, ViewMode } from "../types/graph";

type GraphFooterProps = {
  selectedNode?: GraphNodeEntity;
  selectedNodeTotal: number;
  selectedPage: number;
  selectedPageCount: number;
  isSyncing: boolean;
  onChangeSiblingPage: (parentId: string, nextPage: number) => void;
  viewMode?: ViewMode;
  totalNodes?: number;
  visibleNodes?: number;
};

export function GraphFooter(props: GraphFooterProps) {
  const {
    selectedNode,
    selectedNodeTotal,
    selectedPage,
    selectedPageCount,
    isSyncing,
    onChangeSiblingPage,
    viewMode,
    totalNodes,
    visibleNodes,
  } = props;

  if (!selectedNode) {
    // Show filter stats when available
    const hasFilterStats =
      typeof totalNodes === "number" && typeof visibleNodes === "number";
    const filteredCount = hasFilterStats ? totalNodes - visibleNodes : 0;

    return (
      <footer className="hint">
        Select and expand a node to navigate the graph.
        {hasFilterStats && filteredCount > 0 && (
          <span style={{ marginLeft: "1rem", opacity: 0.7, fontSize: "0.9em" }}>
            ({filteredCount} nodes filtered in {viewMode} view)
          </span>
        )}
      </footer>
    );
  }

  return (
    <footer className="controls-panel">
      <strong>{selectedNode.label}</strong>
      <span>
        Connections: {selectedNodeTotal} · showing{" "}
        {(selectedPage + 1 - 1) * MAX_VISIBLE_SIBLINGS + 1}–
        {Math.min(
          (selectedPage + 1) * MAX_VISIBLE_SIBLINGS,
          selectedNodeTotal || MAX_VISIBLE_SIBLINGS,
        )}
      </span>

      {selectedNodeTotal > MAX_VISIBLE_SIBLINGS ? (
        <div className="pager-controls">
          <button
            type="button"
            onClick={() =>
              onChangeSiblingPage(selectedNode.id, selectedPage - 1)
            }
            disabled={selectedPage <= 0 || isSyncing}
          >
            Prev
          </button>
          <span>
            Page {selectedPage + 1} / {selectedPageCount}
          </span>
          <button
            type="button"
            onClick={() =>
              onChangeSiblingPage(selectedNode.id, selectedPage + 1)
            }
            disabled={selectedPage + 1 >= selectedPageCount || isSyncing}
          >
            Next
          </button>
        </div>
      ) : null}
    </footer>
  );
}
