# Phase 2: Structure View Implementation

## Overview

Phase 2 implements the structure view mode with intelligent filtering for imports, exports, and test files. This mode provides a cleaner view of the codebase structure by allowing users to hide noise.

## Implementation Status: ✅ Complete

## Features Implemented

### 1. Enhanced Structure Filtering Logic

**Location**: `src/App.tsx` (lines 295-335)

The filtering system now detects and filters three types of nodes:

#### Import Filtering

- Filters nodes where `semanticType === "import"`
- Excludes entire subtrees to maintain graph consistency
- Controlled by `structureFilters.showImports` toggle

#### Export Filtering

- Filters nodes where `semanticType === "export"`
- Excludes entire subtrees to maintain graph consistency
- Controlled by `structureFilters.showExports` toggle

#### Test Detection & Filtering

Tests are identified through multiple heuristics:

1. **Label-based**: Labels containing "test", "spec", "TEST" (case-insensitive)
2. **ID-based**: Node IDs containing "test" or "spec" (case-insensitive)
3. **Filename-based**: File labels containing ".test." or ".spec." patterns

Example patterns detected:

- `UserService.test.ts`
- `api.spec.js`
- Files with TEST label
- Nodes with "test" in their ID

Controlled by `structureFilters.showTests` toggle

### 2. Visual Feedback System

**Location**: `src/components/GraphFooter.tsx`

Added filtering statistics display:

- Shows count of filtered nodes when no node is selected
- Displays view mode context
- Format: "({count} nodes filtered in {mode} view)"
- Only appears when filters are active (filteredCount > 0)

**Implementation**:

```typescript
const filteredCount = totalNodes - visibleNodes;
{hasFilterStats && filteredCount > 0 && (
  <span style={{ marginLeft: '1rem', opacity: 0.7, fontSize: '0.9em' }}>
    ({filteredCount} nodes filtered in {viewMode} view)
  </span>
)}
```

**Props Added**:

- `viewMode?: ViewMode` - current view mode
- `totalNodes?: number` - total nodes in graph
- `visibleNodes?: number` - nodes visible after filtering

### 3. Filter Stats Calculation

**Location**: `src/App.tsx` (lines 431-432)

```typescript
const totalNodes = Object.keys(graphState.nodesById).length;
const visibleNodes = pendingLayout
  ? Object.keys(pendingLayout.filteredNodesById).length
  : totalNodes;
```

Stats are passed to `GraphFooter` for display.

## Architecture Decisions

### Subtree Exclusion

When a node is filtered out, its entire subtree is excluded using the `excludeSubtree` helper:

```typescript
const excludeSubtree = (nodeId: string) => {
  if (excludedNodeIds.has(nodeId)) return;
  excludedNodeIds.add(nodeId);
  const childIds = graphState.childIdsByParent[nodeId] ?? [];
  childIds.forEach((childId) => excludeSubtree(childId));
};
```

**Rationale**: Prevents orphaned nodes and maintains graph topology integrity.

### Multi-Heuristic Test Detection

Uses three complementary detection methods to maximize accuracy:

1. Labels (from Memgraph node labels)
2. IDs (from Memgraph node identifiers)
3. Filenames (from file naming conventions)

**Rationale**: Different MCP tools may populate different fields, so redundancy ensures robust detection.

### Early Filtering in Layout Pipeline

Filtering happens in `pendingLayout` useMemo, before topology computation:

```
Raw Graph → Filter Nodes → Compute Topology → Layout Worker → Visual Frame
```

**Rationale**: Reduces computation cost by excluding filtered nodes from expensive layout calculations.

## Testing Instructions

### Manual Testing Checklist

1. **Start dev server**: `npm run dev` → http://localhost:5175
2. **Select Structure View**: Dropdown should show 📁 Structure
3. **Test Import Toggle**:
   - Disable "Imports" toggle
   - Verify import nodes disappear
   - Check footer shows filter count
4. **Test Export Toggle**:
   - Disable "Exports" toggle
   - Verify export nodes disappear
   - Check footer shows updated filter count
5. **Test Tests Toggle**:
   - Disable "Tests" toggle
   - Verify test files disappear (_.test._, _.spec._)
   - Check footer shows updated filter count
6. **Test Combined Filters**:
   - Disable multiple filters simultaneously
   - Verify all filters work together
   - Check footer shows total filtered count
7. **localStorage Persistence**:
   - Set specific filter state
   - Refresh page
   - Verify filters persist across reload

### Expected Behavior

**With All Filters Enabled** (default):

- All nodes visible
- No filter message in footer

**With Tests Disabled**:

- Test files hidden
- Footer shows: "(X nodes filtered in structure view)"

**With All Filters Disabled**:

- Only imports, exports, and tests hidden
- All structural nodes (folders, files, classes, functions) remain visible
- Footer shows: "(Y nodes filtered in structure view)"

## Performance Considerations

### Filter Impact

- Filtering happens synchronously in `useMemo`
- Early exclusion reduces layout worker payload
- Topology computation only processes visible nodes

### Optimization Points

- Subtree exclusion uses Set for O(1) lookups
- String operations (toLowerCase, includes) are lightweight
- localStorage reads/writes happen outside render path

## Future Enhancements (Phase 3+)

### Planned Additions

1. **Root Selection Intelligence** (deferred to Phase 3):
   - Prefer PROJECT → FOLDER → FILE in structure view
   - Skip filtered nodes when selecting initial root
   - Fallback to first visible node

2. **Architecture View Filtering** (Phase 3):
   - Layer-based grouping
   - Community detection
   - Architectural violation highlighting

3. **Plan View Filtering** (Phase 4):
   - Status-based filtering (in-progress, blocked, complete)
   - Feature/task hierarchy
   - Dependency visualization

4. **Documentation View Filtering** (Phase 5):
   - Document kind filtering (README, ADR, guides, reference)
   - Linked code visibility toggle
   - Section hierarchy

## Code Locations

| Feature             | File                                            | Lines     |
| ------------------- | ----------------------------------------------- | --------- |
| ViewMode types      | `src/types/graph.ts`                            | 10-30     |
| Filter state        | `src/state/graphStore.ts`                       | 50-150    |
| Structure filtering | `src/App.tsx`                                   | 295-335   |
| Filter stats        | `src/App.tsx`                                   | 431-432   |
| Footer feedback     | `src/components/GraphFooter.tsx`                | 20-28     |
| Structure controls  | `src/components/controls/StructureControls.tsx` | Full file |

## Dependencies

### Runtime

- React 19: Component state management
- Zustand 5: Global state with localStorage
- Immer: Immutable state updates

### Build

- TypeScript 5.9: Type safety
- Vite 8: Build tooling
- ESBuild: Fast transpilation

## Validation Results

### Lint: ✅ Pass

```bash
npm run lint
# No errors
```

### Build: ✅ Pass

```bash
npm run build
# ✓ 123 modules transformed
# dist/assets/index-CLwQbKMr.js  287.24 kB │ gzip: 89.50 kB
```

### Dev Server: ✅ Running

```
http://localhost:5175/
```

## Known Issues

None.

## Related Documentation

- [Simplification Plan](./simplification-plan.md)
- [Architecture Overview](./architecture.md)
- [Performance Plan](./performance-plan.md)
