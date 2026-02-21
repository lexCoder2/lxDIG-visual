# Code Visual — Architecture

## Overview

Code Visual is a single-page React application that queries a Memgraph graph database and renders the result as an interactive force-directed graph. The app is split into four clear layers: **data access → state store → layout engine → render**.

```
Memgraph (Bolt)
    │
    ▼
server/memgraph-proxy.mjs     Node.js HTTP proxy — translates POST /query to Bolt driver calls
    │
    ▼
src/lib/memgraphClient.ts     Fetch layer — sends Cypher queries, normalises responses, infers types
    │
    ▼
src/state/graphStore.ts       Zustand store — single source of truth for all graph + UI state
    │
    ▼
src/lib/layoutEngine.ts       d3-force layout — computes (x, y) for every visible node
    │
    ▼
src/App.tsx + GraphCanvas.tsx React render — animates transitions, handles input events
```

---

## Module Reference

### `server/memgraph-proxy.mjs`

A minimal Node.js HTTP server (no framework). Receives `POST /query` with `{ query, params }`, forwards via the `neo4j-driver` Bolt client, and streams back normalised JSON results. Keeps credentials server-side; the browser never sees them.

### `src/lib/memgraphClient.ts`

Thin fetch wrapper around the proxy. Two modes are detected at startup:

- **Live mode** — proxied HTTP POST to `VITE_MEMGRAPH_URL`
- **Mock mode** — deterministic in-memory tree, used when the proxy is unreachable

Key functions:
- `listProjects()` — returns root nodes as `ProjectSummary[]`
- `expandNodePage()` — paginated children for a single parent node
- `expandNeighborhoodDepth()` — batch-expands to a given depth for background hydration
- `inferSemanticType()` — classifies a node as `function | class | import | export | variable` from its labels/relation strings

### `src/types/graph.ts`

All TypeScript interfaces that flow through the system:

| Type | Description |
|---|---|
| `GraphNodeEntity` | Stored graph node (id, label, kind, semanticType, depth, expanded, loading) |
| `GraphEdgeEntity` | Stored edge (id, source, target, label) |
| `PositionedNode` | Node annotated with `(x, y)` after layout |
| `PositionedEdge` | Edge ready to render |
| `LayoutFrame` | `{ nodes: PositionedNode[], edges: PositionedEdge[] }` |
| `SemanticNodeType` | `function \| class \| import \| export \| variable` |
| `NodeKind` | `layer \| module \| service \| file` |
| `ViewportState` | Pan/zoom `{ x, y, scale }` |

### `src/state/graphStore.ts`

Zustand store that holds the entire application state. Mutations schedule a `requestAnimationFrame` debounced layout recompute (`scheduleFrame`) to avoid blocking the main thread on every synchronous state change.

Key state:
- `nodesById / edgesById / childIdsByParent` — normalised graph data
- `manualPositions` — positions overridden by drag
- `frame` — last computed `LayoutFrame`
- `viewport` — current pan/zoom
- `connectionDepth / siblingPageByParent` — traversal config

Key mutations:
- `mergeExpansionPage` — adds a paginated batch of children for one parent
- `mergeExpansionBatch` — multi-parent batch for background hydration
- `setFocusedNode` — changes the traversal root and recomputes visible depths
- `setManualPositionsBatch` — updates drag positions without layout rerun

### `src/lib/layoutEngine.ts`

Pure function `computeLayoutFrame(input)` — produces x/y positions for every visible node. Steps:

1. **BFS visibility pass** — starts at `rootNodeId`, respects `connectionDepth` and `siblingPageByParent` pagination, produces `visibleNodeIds`, `depthByNodeId`, `parentByNodeId`.
2. **Radial target angles** — weighted subtree angles via `buildTargetAngleById` (weighted by subtree size so large subtrees get more arc).
3. **Ring radii** — per-depth ring radius computed from node sizes + density (`buildDepthRingRadius`).
4. **d3-force simulation** — `forceSimulation` with `forceCenter`, `forceManyBody` (charge), `forceX/Y` (ring attraction), `forceRadial`, `forceLink`, `forceCollide`. Ticks run synchronously: `min(240, max(120, n × 6))`.
5. **Manual position override** — `manualPositions` from drag replace force-computed positions before output.

### `src/App.tsx`

Orchestration and interaction layer. Responsibilities:

- **Semantic type filtering** — `filteredLayoutFrame` useMemo runs `computeLayoutFrame` on a pruned graph (nodes/edges/children filtered, subtrees excluded via `excludeSubtree` DFS).
- **Layout animation** — 280 ms linear interpolation between `renderFrame` and `filteredLayoutFrame` using `requestAnimationFrame`.
- **Camera animation** — pans viewport to centre the focused node using a separate RAF loop.
- **Drag propagation** — square-falloff influence BFS that moves nearby nodes when one is dragged (`collectDragPropagationUpdates`).
- **Pointer event routing** — distinguishes canvas pan (right-drag), node drag (left-drag), click, double-click.

### `src/components/GraphCanvas.tsx`

Receives a `LayoutFrame` and renders:
- `<svg class="edges">` — one `<g>` per edge: a glow `<path>` + a stroke `<path>` + optional `<text>` label
- One `<button class="node ...">` per node positioned via CSS `transform: translate(x,y) scale(s)`, classified by kind and semantic type

Node labels are parsed by `getStructuredNodeLabel`:
- File nodes — extracts basename + extension chip + optional `#anchor`
- Colon-separated labels (imports, namespaced ids) — split into primary + secondary line

### `src/components/controls/`

All in-canvas controls rendered as a `controlsOverlay` prop overlay:

| Component | Purpose |
|---|---|
| `CanvasControls` | Container; hosts all sub-controls; node-type group is right-aligned |
| `DepthControl` | +/− connection depth buttons |
| `MotionControl` | Animation speed slider |
| `RefreshToggleControl` | Generic labelled toggle switch (reused for auto-refresh and each node-type filter) |
| `SyncBadgeControl` | Passive "Auto refresh On/Off" label + "Syncing…" badge when active |
| `ProjectControl` | Project selector dropdown |

---

## Data Flow — Node Expansion

```
user double-clicks node
    │
    ▼
App.tsx onNodeDoubleClick → expandNode(nodeId)
    │
    ├─ graphStore.setNodeExpanded(nodeId, true)
    ├─ graphStore.setFocusedNode(nodeId)
    └─ useGraphController.hydrateNeighborhoodToDepth(nodeId)
           │
           ▼
       memgraphClient.expandNeighborhoodDepth({ projectId, startNodeId, depth })
           │
           ▼
       graphStore.mergeExpansionBatch({ parents })
           │
           ▼
       scheduleFrame() → requestAnimationFrame → computeLayoutFrame → store.frame
           │
           ▼
       App.tsx filteredLayoutFrame useMemo invalidates
           │
           ▼
       layout animation effect → interpolates renderFrame over 280 ms
```

---

## Semantic Node Classification

`inferSemanticType` in `memgraphClient.ts` maps raw Memgraph node labels to UI types:

| Labels / relation / id prefix | SemanticNodeType |
|---|---|
| `Function`, `Method` | `function` |
| `Class`, `Interface`, `Type` | `class` |
| `Import`, relation `IMPORTS`, id `import:` | `import` |
| `Export`, relation `EXPORTS`, id `export:` | `export` |
| `Variable`, `Const`, `Property` | `variable` |

Nodes without a match have `semanticType: undefined` and are always visible regardless of filter state.

---

## Viewport & Coordinate System

World coordinates are fixed; the viewport is a CSS `transform` applied to `.graph-layer`:

```
transform: translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})
```

Node positions are in world space (centre of `CANVAS` = 900, 600). Manual positions are stored in world space. Hit detection for drag distance uses world-space division by `viewport.scale`.

---

## Environment Variables

| Variable | Consumed by | Default |
|---|---|---|
| `VITE_MEMGRAPH_URL` | Browser fetch (via Vite) | `http://localhost:4000/query` |
| `MEMGRAPH_BOLT_URL` | Node proxy (`dotenv`) | `bolt://localhost:7687` |
| `MEMGRAPH_BOLT_USER` | Node proxy | _(empty)_ |
| `MEMGRAPH_BOLT_PASSWORD` | Node proxy | _(empty)_ |
| `MEMGRAPH_PROXY_PORT` | Node proxy | `4000` |

---

## Local Storage Keys

| Key | Type | Purpose |
|---|---|---|
| `code-visual:motionSpeedFactor` | `number` | Animation speed multiplier |
| `code-visual:connectionDepth` | `number` | Traversal depth |
| `code-visual:nodeTypeFilters` | `JSON` | Per-type visibility flags |
| `code-visual:selectedProjectId` | `string` | Last selected project |
| `code-visual:autoRefreshEnabled` | `boolean` | Auto-refresh toggle |

---

## Performance Roadmap

See [performance-plan.md](performance-plan.md) for a full audit and prioritised optimisation plan. The highest-impact items are:

1. **Narrow `filteredLayoutFrame` deps** — exclude viewport from invalidation (Tier 1-C)
2. **Stabilise animation memos** — derive topology lookups from layout target, not interpolated frame (Tier 1-A)
3. **Remove store `frame`** — eliminate the second redundant force simulation per mutation (Tier 2-D)
4. **Web Worker layout** — move d3-force off the main thread (Tier 3-G)
5. **Canvas edge layer** — replace SVG edge DOM with a single `<canvas>` draw pass (Tier 3-H)
