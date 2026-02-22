import { RefreshToggleControl } from "./RefreshToggleControl";
import type { DocumentationFilters } from "../../types/graph";

type DocumentationControlsProps = {
  filters: DocumentationFilters;
  onChangeKindFilter: (kind: DocumentationFilters["kindFilter"]) => void;
  onToggleLinkedCode: () => void;
};

export function DocumentationControls(props: DocumentationControlsProps) {
  const { filters, onChangeKindFilter, onToggleLinkedCode } = props;

  return (
    <div
      className="mode-specific-controls"
      role="group"
      aria-label="Documentation view filters"
    >
      <label className="mode-filter-label">
        <span>Kind:</span>
        <select
          className="mode-filter-select"
          value={filters.kindFilter}
          onChange={(e) =>
            onChangeKindFilter(
              e.target.value as DocumentationFilters["kindFilter"],
            )
          }
        >
          <option value="all">All</option>
          <option value="readme">README</option>
          <option value="adr">ADR</option>
          <option value="guide">Guide</option>
          <option value="reference">Reference</option>
        </select>
      </label>
      <RefreshToggleControl
        label="Linked Code"
        checked={filters.showLinkedCode}
        onToggle={onToggleLinkedCode}
        wrapperClassName="mode-filter-wrap"
        switchClassName="mode-filter-switch"
        labelClassName="mode-filter-label"
      />
    </div>
  );
}
