export const MIN_CONNECTION_DEPTH = 1;
export const MAX_CONNECTION_DEPTH = 4;
export const DEFAULT_CONNECTION_DEPTH = 2;
export const MAX_VISIBLE_SIBLINGS = 20;
export const AUTO_REFRESH_MS = 5_000;

export const CANVAS = {
  width: 1800,
  height: 1200,
};

export const DEPTH_VISUAL = {
  maxDepth: 4,
  scaleStep: 0.085,
  opacityStep: 0.16,
  blurStartDepth: 2,
  blurStep: 1.4,
  minScale: 0.62,
  minOpacity: 0.2,
};

export const CAMERA_VISUAL = {
  focusDurationMs: 1250,
  minSpeedFactor: 0.8,
  maxSpeedFactor: 2.8,
};

export const EDGE_VISUAL = {
  minOpacity: 0.16,
  opacityStep: 0.14,
  baseWidth: 1.8,
  widthDepthDrop: 0.16,
};

export const NODE_WIDTH_BY_KIND = {
  layer: 172,
  module: 152,
  service: 152,
  file: 148,
} as const;

export const NODE_HEIGHT_BY_KIND = {
  layer: 62,
  module: 56,
  service: 56,
  file: 56,
} as const;
