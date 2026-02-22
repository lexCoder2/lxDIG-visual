import { DepthControl } from "./DepthControl";
import { MotionControl } from "./MotionControl";
import { RefreshToggleControl } from "./RefreshToggleControl";
import { SyncBadgeControl } from "./SyncBadgeControl";
import { ViewModeControl } from "./ViewModeControl";
import { StructureControls } from "./StructureControls";
import { ArchitectureControls } from "./ArchitectureControls";
import { PlanControls } from "./PlanControls";
import { DocumentationControls } from "./DocumentationControls";
import type {
  ViewMode,
  StructureFilters,
  ArchitectureFilters,
  PlanFilters,
  DocumentationFilters,
} from "../../types/graph";

type CanvasControlsProps = {
  syncStatus: "idle" | "syncing" | "error";
  isSyncing: boolean;
  autoRefreshEnabled: boolean;
  connectionDepth: number;
  motionSpeedFactor: number;
  viewMode: ViewMode;
  structureFilters: StructureFilters;
  architectureFilters: ArchitectureFilters;
  planFilters: PlanFilters;
  documentationFilters: DocumentationFilters;
  onToggleAutoRefresh: () => void;
  onDepthUp: () => void;
  onDepthDown: () => void;
  onChangeMotion: (value: number) => void;
  onChangeViewMode: (mode: ViewMode) => void;
  onToggleStructureFilter: (key: keyof StructureFilters) => void;
  onToggleArchitectureViewType: () => void;
  onToggleArchitectureViolationsOnly: () => void;
  onChangePlanStatusFilter: (status: PlanFilters["statusFilter"]) => void;
  onTogglePlanImplementingFiles: () => void;
  onTogglePlanTestCoverage: () => void;
  onChangeDocKindFilter: (kind: DocumentationFilters["kindFilter"]) => void;
  onToggleDocLinkedCode: () => void;
};

export function CanvasControls(props: CanvasControlsProps) {
  const {
    syncStatus,
    isSyncing,
    autoRefreshEnabled,
    connectionDepth,
    motionSpeedFactor,
    viewMode,
    structureFilters,
    architectureFilters,
    planFilters,
    documentationFilters,
    onToggleAutoRefresh,
    onDepthUp,
    onDepthDown,
    onChangeMotion,
    onChangeViewMode,
    onToggleStructureFilter,
    onToggleArchitectureViewType,
    onToggleArchitectureViolationsOnly,
    onChangePlanStatusFilter,
    onTogglePlanImplementingFiles,
    onTogglePlanTestCoverage,
    onChangeDocKindFilter,
    onToggleDocLinkedCode,
  } = props;

  return (
    <div
      className="canvas-controls"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <SyncBadgeControl
        syncStatus={syncStatus}
        isSyncing={isSyncing}
        autoRefreshEnabled={autoRefreshEnabled}
      />
      <RefreshToggleControl
        label="Refresh"
        checked={autoRefreshEnabled}
        onToggle={onToggleAutoRefresh}
      />
      <ViewModeControl
        viewMode={viewMode}
        onChangeViewMode={onChangeViewMode}
      />
      <DepthControl
        connectionDepth={connectionDepth}
        onDepthUp={onDepthUp}
        onDepthDown={onDepthDown}
      />
      <MotionControl
        motionSpeedFactor={motionSpeedFactor}
        onChangeMotion={onChangeMotion}
      />

      {viewMode === "structure" && (
        <StructureControls
          filters={structureFilters}
          onToggleFilter={onToggleStructureFilter}
        />
      )}

      {viewMode === "architecture" && (
        <ArchitectureControls
          filters={architectureFilters}
          onToggleViewType={onToggleArchitectureViewType}
          onToggleViolationsOnly={onToggleArchitectureViolationsOnly}
        />
      )}

      {viewMode === "plan" && (
        <PlanControls
          filters={planFilters}
          onChangeStatusFilter={onChangePlanStatusFilter}
          onToggleImplementingFiles={onTogglePlanImplementingFiles}
          onToggleTestCoverage={onTogglePlanTestCoverage}
        />
      )}

      {viewMode === "documentation" && (
        <DocumentationControls
          filters={documentationFilters}
          onChangeKindFilter={onChangeDocKindFilter}
          onToggleLinkedCode={onToggleDocLinkedCode}
        />
      )}
    </div>
  );
}
