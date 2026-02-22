import { RefreshToggleControl } from "./RefreshToggleControl";
import type { ArchitectureFilters } from "../../types/graph";

type ArchitectureControlsProps = {
  filters: ArchitectureFilters;
  onToggleViewType: () => void;
  onToggleViolationsOnly: () => void;
};

export function ArchitectureControls(props: ArchitectureControlsProps) {
  const { filters, onToggleViewType, onToggleViolationsOnly } = props;

  return (
    <div
      className="mode-specific-controls"
      role="group"
      aria-label="Architecture view filters"
    >
      <RefreshToggleControl
        label={filters.viewType === "layers" ? "Layers" : "Communities"}
        checked={filters.viewType === "communities"}
        onToggle={onToggleViewType}
        wrapperClassName="mode-filter-wrap"
        switchClassName="mode-filter-switch"
        labelClassName="mode-filter-label"
      />
      <RefreshToggleControl
        label="Violations Only"
        checked={filters.showViolationsOnly}
        onToggle={onToggleViolationsOnly}
        wrapperClassName="mode-filter-wrap"
        switchClassName="mode-filter-switch"
        labelClassName="mode-filter-label"
      />
    </div>
  );
}
