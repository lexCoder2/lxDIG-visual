import type { ViewMode } from "../../types/graph";
import type { IconType } from "react-icons";
import {
  FaBookOpen,
  FaClipboardList,
  FaProjectDiagram,
  FaSitemap,
} from "react-icons/fa";

type ViewModeControlProps = {
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
};

const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  structure: "Structure",
  architecture: "Architecture",
  plan: "Plan",
  documentation: "Documentation",
};

const VIEW_MODE_ICONS: Record<ViewMode, IconType> = {
  structure: FaProjectDiagram,
  architecture: FaSitemap,
  plan: FaClipboardList,
  documentation: FaBookOpen,
};

export function ViewModeControl(props: ViewModeControlProps) {
  const { viewMode, onChangeViewMode } = props;
  const ActiveIcon = VIEW_MODE_ICONS[viewMode];

  return (
    <div className="view-mode-control canvas-control-item">
      <span className="canvas-control-label-text">View</span>
      <span className="view-mode-icon" aria-hidden="true">
        <ActiveIcon size={11} />
      </span>
      <label className="canvas-control-label">
        <select
          className="view-mode-select"
          value={viewMode}
          onChange={(e) => onChangeViewMode(e.target.value as ViewMode)}
        >
          {(Object.entries(VIEW_MODE_LABELS) as Array<[ViewMode, string]>).map(
            ([mode, label]) => (
              <option key={mode} value={mode}>
                {label}
              </option>
            ),
          )}
        </select>
      </label>
    </div>
  );
}
