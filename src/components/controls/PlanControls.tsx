import { RefreshToggleControl } from "./RefreshToggleControl";
import type { PlanFilters } from "../../types/graph";

type PlanControlsProps = {
  filters: PlanFilters;
  onChangeStatusFilter: (status: PlanFilters["statusFilter"]) => void;
  onToggleImplementingFiles: () => void;
  onToggleTestCoverage: () => void;
};

export function PlanControls(props: PlanControlsProps) {
  const {
    filters,
    onChangeStatusFilter,
    onToggleImplementingFiles,
    onToggleTestCoverage,
  } = props;

  return (
    <div
      className="mode-specific-controls"
      role="group"
      aria-label="Plan view filters"
    >
      <label className="mode-filter-label">
        <span>Status:</span>
        <select
          className="mode-filter-select"
          value={filters.statusFilter}
          onChange={(e) =>
            onChangeStatusFilter(e.target.value as PlanFilters["statusFilter"])
          }
        >
          <option value="all">All</option>
          <option value="in-progress">In Progress</option>
          <option value="blocked">Blocked</option>
          <option value="completed">Completed</option>
        </select>
      </label>
      <RefreshToggleControl
        label="Files"
        checked={filters.showImplementingFiles}
        onToggle={onToggleImplementingFiles}
        wrapperClassName="mode-filter-wrap"
        switchClassName="mode-filter-switch"
        labelClassName="mode-filter-label"
      />
      <RefreshToggleControl
        label="Tests"
        checked={filters.showTestCoverage}
        onToggle={onToggleTestCoverage}
        wrapperClassName="mode-filter-wrap"
        switchClassName="mode-filter-switch"
        labelClassName="mode-filter-label"
      />
    </div>
  );
}
