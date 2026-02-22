import { RefreshToggleControl } from "./RefreshToggleControl";
import type { StructureFilters } from "../../types/graph";

type StructureControlsProps = {
  filters: StructureFilters;
  onToggleFilter: (key: keyof StructureFilters) => void;
};

export function StructureControls(props: StructureControlsProps) {
  const { filters, onToggleFilter } = props;

  return (
    <div
      className="mode-specific-controls"
      role="group"
      aria-label="Structure view filters"
    >
      <span className="mode-controls-label">Show:</span>
      <RefreshToggleControl
        label="Imports"
        checked={filters.showImports}
        onToggle={() => onToggleFilter("showImports")}
        wrapperClassName="mode-filter-wrap"
        switchClassName="mode-filter-switch"
        labelClassName="mode-filter-label"
      />
      <RefreshToggleControl
        label="Exports"
        checked={filters.showExports}
        onToggle={() => onToggleFilter("showExports")}
        wrapperClassName="mode-filter-wrap"
        switchClassName="mode-filter-switch"
        labelClassName="mode-filter-label"
      />
      <RefreshToggleControl
        label="Tests"
        checked={filters.showTests}
        onToggle={() => onToggleFilter("showTests")}
        wrapperClassName="mode-filter-wrap"
        switchClassName="mode-filter-switch"
        labelClassName="mode-filter-label"
      />
      <RefreshToggleControl
        label="Files"
        checked={filters.showFiles}
        onToggle={() => onToggleFilter("showFiles")}
        wrapperClassName="mode-filter-wrap"
        switchClassName="mode-filter-switch"
        labelClassName="mode-filter-label"
      />
    </div>
  );
}
