# Code Visual Simplification Plan

## Executive Summary

Current state: The visualizer supports 9 node categories and multiple filter dimensions (group + semantic), which creates complexity for users.

**Goal**: Refactor the UI and controls around **4 core views** that map to primary user workflows:

1. **Structure View** — files, folders, imports, exports, class/function relationships ✅ **COMPLETE**
2. **Architecture View** — logical layers, communities, layer rules, violations 🔄 **NEXT**
3. **Plan View** — features, tasks, blocking issues, status tracking
4. **Documentation View** — documents, sections, semantic links to code
5. **Context Viewer** — split workspace with code/docs/architecture preview

## Implementation Status (Updated: Feb 22, 2026)

- ✅ **Phase 1**: View Mode Infrastructure (COMPLETE)
- ✅ **Phase 2**: Structure View Implementation (COMPLETE)
- ✅ **Integration**: lxRAG MCP Connection (COMPLETE - 503 nodes live)
- 🔄 **Phase 3**: Architecture View Implementation (IN PROGRESS)
- ⏳ **Phase 4**: Plan View Implementation (PENDING)
- ⏳ **Phase 5**: Documentation View Implementation (PENDING)
- ⏳ **Phase 6**: Polish and Documentation (PENDING)
- 🔄 **Phase 7**: Split Viewer Pane (IN PROGRESS)

---

## MCP Server Review (lexRAG-MCP)

### Overview

The MCP server at `/home/alex_rod/projects/lexRAG-MCP` provides 33 tools across multiple domains:

- **Graph/Querying** (4 tools): workspace setup, rebuild, health, query
- **Code Intelligence** (5 tools): code explanation, pattern detection, semantic slicing, context packing, diff analysis
- **Architecture** (2 tools): layer validation, layer suggestion
- **Semantic/Similarity** (4 tools): semantic search, similar code, clustering, semantic diff
- **Test Intelligence** (5 tools): test selection, categorization, impact analysis, test execution, test suggestions
- **Progress Tracking** (4 tools): progress query, task updates, feature status, blocking issues
- **Episode Memory** (4 tools): episode add/recall, decision query, reflection
- **Agent Coordination** (4 tools): claim/release/status/overview
- **Utility** (1 tool): contract validation

### Graph Schema

#### Core Code Labels

- `FILE`, `FOLDER`, `FUNCTION`, `CLASS`, `IMPORT`, `EXPORT`, `VARIABLE`, `TEST_SUITE`

#### Operational/Intelligence Labels

- `DOCUMENT`, `SECTION` — documentation nodes
- `FEATURE`, `TASK` — progress tracking nodes
- `EPISODE`, `LEARNING`, `CLAIM` — agent memory nodes
- `COMMUNITY`, `RULE`, `LAYER` — architecture nodes
- `GRAPH_TX` — system/temporal nodes

#### Relationships

- **Structural**: `CONTAINS`, `IMPORTS`, `EXPORTS`, `REFERENCES`, `EXTENDS`, `IMPLEMENTS`, `TESTS`
- **Docs/Context**: `SECTION_OF`, `NEXT_SECTION`, `DOC_DESCRIBES`
- **Agent/Progress**: `INVOLVES`, `NEXT_EPISODE`, `APPLIES_TO`, `TARGETS`, `BELONGS_TO`
- **Architecture**: `VIOLATES_RULE`, `BELONGS_TO_LAYER`

#### Node Properties

- **Identity**: `id`, `projectId`, `scipId` (SCIP-style IDs on code nodes)
- **Temporal**: `validFrom`, `validTo`, `createdAt`, `txId`
- **Code-specific**: `path`, `language`, `startLine`, `endLine`, `LOC`, `hash`, `summary`
- **Progress-specific**: `status`, `assignee`, `featureId`, `blockedBy`
- **Docs-specific**: `relativePath`, `heading`, `kind`, `content`

### Key Engines

#### 1. GraphOrchestrator (`src/graph/orchestrator.ts`)

- **Purpose**: Parse codebase, build graph, incremental updates
- **Capabilities**:
  - Multi-language parsing (TS/JS/TSX/JSX/Python/Go/Rust/Java)
  - Tree-sitter AST parsing (when enabled)
  - SCIP ID generation for stable symbol references
  - Incremental mode based on file hash changes
  - Doc indexing integration

#### 2. DocsEngine (`src/engines/docs-engine.ts`)

- **Purpose**: Index markdown documentation
- **Capabilities**:
  - Discovers all `.md` files in workspace
  - Parses markdown into `DOCUMENT` + `SECTION` nodes
  - Creates `SECTION_OF` and `DOC_DESCRIBES` relationships
  - Incremental updates (hash-based)
  - Optional vector embeddings for semantic search
  - Links sections to relevant code symbols

#### 3. ProgressEngine (`src/engines/progress-engine.ts`)

- **Purpose**: Track features, tasks, milestones
- **Capabilities**:
  - Creates `FEATURE` and `TASK` nodes
  - Tracks status: pending/in-progress/completed/blocked
  - Links tasks to features via `featureId`
  - Detects blocking issues
  - Calculates progress metrics (completion %, blocked count)
  - Links features to implementing files and tests

#### 4. ArchitectureEngine (`src/engines/architecture-engine.ts`)

- **Purpose**: Validate layer constraints
- **Capabilities**:
  - Defines layer rules via config (paths, allowed imports)
  - Detects layer violations (forbidden imports)
  - Circular dependency detection
  - Layer suggestion for new code
  - Creates `LAYER`, `RULE` nodes
  - Creates `VIOLATED_RULE`, `BELONGS_TO_LAYER` relationships

#### 5. EpisodeEngine (`src/engines/episode-engine.ts`)

- **Purpose**: Agent memory and coordination
- **Capabilities**:
  - Records agent observations, decisions, edits, test results
  - Creates `EPISODE` nodes with timestamps
  - Links episodes via `NEXT_EPISODE` relationships
  - Episode recall by query, agent, task, entity
  - Reflection synthesis (insights from episode history)
  - Creates `LEARNING` nodes from patterns

### Hybrid Retrieval System

The MCP server uses **Reciprocal Rank Fusion (RRF)** combining:

- **Vector similarity** (Qdrant embeddings, MiniLM-L6, 384-dim)
- **BM25 lexical search** (Memgraph MAGE text_search)
- **Graph expansion** (PageRank PPR for relevance)

This enables semantic code search beyond keyword matching.

---

## User Workflow → MCP Mapping

### 1. Structure View (Files/Folders/Symbols)

**User Wants**: Explore project structure, see import/export relationships between classes and functions

**MCP Data**:

- Labels: `FILE`, `FOLDER`, `FUNCTION`, `CLASS`, `IMPORT`, `EXPORT`, `VARIABLE`, `TEST_SUITE`
- Relationships: `CONTAINS`, `IMPORTS`, `EXPORTS`, `REFERENCES`, `EXTENDS`, `IMPLEMENTS`, `TESTS`
- Properties: `path`, `scipId`, `name`, `startLine`, `endLine`

**Queries Needed**:

- Start from `PROJECT` or root `FOLDER`
- Traverse `CONTAINS` to get file tree
- From `FILE`, traverse `CONTAINS` to get symbols (`FUNCTION`, `CLASS`)
- From symbol, traverse `IMPORTS`/`EXPORTS`/`REFERENCES` to see dependencies
- From symbol, traverse `EXTENDS`/`IMPLEMENTS` to see inheritance

**UI Controls**:

- **Filter**: Show/hide imports, exports, tests
- **Depth**: Control how many levels of imports to expand
- **Grouping**: By folder vs flat list

### 2. Architecture View (Layers/Communities/Rules)

**User Wants**: Understand logical architecture, see layer violations, detect architectural drift

**MCP Data**:

- Labels: `LAYER`, `RULE`, `COMMUNITY`
- Relationships: `BELONGS_TO_LAYER`, `VIOLATES_RULE`
- Properties: `layerId`, `layerName`, `severity`, `violationType`

**MCP Tools**:

- `arch_validate`: Run layer validation, return violations
- `arch_suggest`: Suggest correct layer for a file
- `community_detection.get()`: MAGE algorithm for community detection

**Queries Needed**:

- List all layers (from architecture config)
- For each layer, find nodes via `BELONGS_TO_LAYER`
- Find violations via `VIOLATES_RULE` relationships
- Community detection for implicit groupings

**UI Controls**:

- **Mode toggle**: Layer view vs Community view
- **Filter**: Show only violations vs all relationships
- **Layer selector**: Focus on specific layer

### 3. Plan View (Features/Tasks/Status)

**User Wants**: Track project progress, see task status, identify blockers

**MCP Data**:

- Labels: `FEATURE`, `TASK`
- Relationships: `TARGETS` (feature → file), `APPLIES_TO` (task → feature), `INVOLVES` (episode → feature)
- Properties: `status` (pending/in-progress/completed/blocked), `assignee`, `featureId`, `blockedBy`, `startedAt`, `completedAt`, `dueDate`

**MCP Tools**:

- `progress_query`: Query features/tasks with filters
- `task_update`: Update task status
- `feature_status`: Get feature with tasks, implementing code, test coverage, blocking issues
- `blocking_issues`: Find all blocked tasks

**Queries Needed**:

- List all features/tasks
- For each feature, find tasks via `featureId` property
- For each task, find blocking tasks via `blockedBy` property
- For each feature, find implementing files via `TARGETS`
- For each feature, find test coverage via `TESTS` relationships

**UI Controls**:

- **Status filter**: All / In Progress / Blocked / Completed
- **Feature focus**: Show only tasks for selected feature
- **Timeline**: Sort by due date or completion date

### 4. Documentation View (Docs/Sections/Links)

**User Wants**: Browse documentation, see which code docs refer to, find relevant docs for a symbol

**MCP Data**:

- Labels: `DOCUMENT`, `SECTION`
- Relationships: `SECTION_OF` (section → document), `NEXT_SECTION` (section → section), `DOC_DESCRIBES` (section → code symbol)
- Properties: `relativePath`, `heading`, `kind` (guide/reference/changelog/readme), `content`, `startLine`

**MCP Tools**:

- `index_docs`: Rebuild doc index
- `search_docs`: Semantic search across documentation

**Queries Needed**:

- List all documents
- For each document, traverse `SECTION_OF` (inbound) to get sections
- For each section, traverse `DOC_DESCRIBES` to see linked code
- For a code symbol, traverse `DOC_DESCRIBES` (inbound) to see referencing docs

**UI Controls**:

- **Doc tree**: Hierarchical document/section browser
- **Filter by kind**: README / ADR / Guide / Reference
- **Highlight linked symbols**: Show which code is documented

---

## Proposed UI/Control Simplification

### Current State Problems

1. **Too many filter dimensions**: 9 group filters + 5 semantic filters = 14 toggles
2. **No clear "mode"**: Users don't know what view they're in
3. **Controls don't map to workflows**: Filters are implementation details, not user goals
4. **Mixed concerns**: Structure + progress + docs all visible simultaneously

### Proposed Solution: View Modes

Replace the current filter-heavy controls with **4 view modes** that correspond to user workflows.

#### New Control Layout

```
┌─────────────────────────────────────────────────────────────┐
│ [Sync]  [View: Structure ▼] [Depth: 2 ▼] [Motion: 1.6x ▼]   │
└─────────────────────────────────────────────────────────────┘
```

#### View Mode Dropdown

```
View: [Structure ▼]
  ├─ Structure  (files/folders/imports/exports/symbols)
  ├─ Architecture  (layers/communities/violations)
  ├─ Plan  (features/tasks/status)
  └─ Documentation  (docs/sections/links)
```

Each view mode:

- **Changes queries**: Different starting nodes and relationship types
- **Changes visual semantics**: Different icons, colors, labels
- **Changes available filters**: Mode-specific controls appear below

### Mode-Specific Controls

#### Structure Mode

- **Show**: Imports | Exports | Tests (3 toggles)
- **Group by**: Folder | File | Symbol Type (dropdown)
- Queries: Start from `PROJECT`/`FOLDER`, traverse `CONTAINS`, `IMPORTS`, `EXPORTS`

#### Architecture Mode

- **View**: Layers | Communities (toggle)
- **Show violations only** (checkbox)
- **Layer focus**: [All Layers ▼] (dropdown with layer list)
- Queries: Start from `LAYER` nodes or use community detection, traverse `BELONGS_TO_LAYER`, `VIOLATES_RULE`

#### Plan Mode

- **Status**: All | In Progress | Blocked | Completed (dropdown)
- **Feature focus**: [All Features ▼] (dropdown with feature list)
- **Show**: Implementing Files | Test Coverage (2 toggles)
- Queries: Start from `FEATURE`/`TASK`, traverse `TARGETS`, `TESTS`, `APPLIES_TO`

#### Documentation Mode

- **Filter by**: All | README | ADR | Guide | Reference (dropdown)
- **Show linked code** (checkbox)
- Queries: Start from `DOCUMENT`, traverse `SECTION_OF`, `DOC_DESCRIBES`

---

## Implementation Phases

### ✅ Phase 1: View Mode Infrastructure (COMPLETE)

**Files Modified**:

- `src/types/graph.ts` — added `ViewMode` type and filter types
- `src/state/graphStore.ts` — added `viewMode` state with localStorage
- `src/components/controls/ViewModeControl.tsx` — NEW view switcher component
- `src/components/controls/StructureControls.tsx` — NEW mode controls
- `src/components/controls/ArchitectureControls.tsx` — NEW mode controls
- `src/components/controls/PlanControls.tsx` — NEW mode controls
- `src/components/controls/DocumentationControls.tsx` — NEW mode controls
- `src/components/controls/CanvasControls.tsx` — integrated mode-based controls
- `src/App.tsx` — integrated view mode state, removed old filters
- `src/App.css` — added view-mode styling

**Completed Tasks**:

- ✅ Defined `type ViewMode = "structure" | "architecture" | "plan" | "documentation"`
- ✅ Added `viewMode` to graphStore with localStorage persistence
- ✅ Created ViewModeControl dropdown component with icons
- ✅ Updated CanvasControls to show ViewModeControl + mode-specific controls
- ✅ Removed old 14-toggle filter system

**Validation**:

- ✅ Lint: PASS
- ✅ Build: PASS (123 modules, 287kB bundle)
- ✅ Dev server: RUNNING (http://localhost:5173)

### ✅ Phase 2: Structure View Implementation (COMPLETE)

**Files Modified**:

- `src/App.tsx` — enhanced structure filtering logic
- `src/components/GraphFooter.tsx` — added visual feedback

**Completed Tasks**:

- ✅ Multi-heuristic test detection (labels, IDs, file patterns)
- ✅ Import/Export filtering by semanticType
- ✅ Subtree exclusion for graph consistency
- ✅ Visual feedback showing filtered node count
- ✅ Filter persistence via localStorage

**Features**:

- **Import Filtering**: Hides nodes where `semanticType === "import"`
- **Export Filtering**: Hides nodes where `semanticType === "export"`
- **Test Detection**: Identifies tests via:
  - Labels containing "test", "spec", "TEST"
  - Node IDs containing "test" or "spec"
  - File names with ".test." or ".spec." patterns
- **Visual Feedback**: Footer shows "(X nodes filtered in structure view)"

**Documentation**: See `docs/phase2-structure-view.md`

### ✅ lxRAG Integration (COMPLETE)

**New Infrastructure**:

- ✅ lxRAG graph initialized (503 nodes indexed)
- ✅ Memgraph proxy running (http://localhost:4001)
- ✅ Fixed Memgraph syntax compatibility
- ✅ Root node selection working
- ✅ Dev server in LIVE mode (querying real data)

**Files Modified**:

- `.env` — configured proxy port 4001
- `src/lib/memgraphClient.ts` — fixed `size((n)--())` query compatibility
- `src/lib/lxragClient.ts` — NEW lxRAG adapter (future direct integration)
- `server/lxrag-proxy.mjs` — NEW standalone proxy (not currently used)

**Graph Status**:

- **Project**: code-visual
- **Total Nodes**: 503
- **Node Types**: FILE, FOLDER, FUNCTION, CLASS, IMPORT, EXPORT, etc.
- **Memgraph**: Connected (bolt://localhost:7687)
- **Qdrant**: Connected (vector embeddings ready)

**Documentation**: See `docs/lxrag-integration.md`

### 🔄 Phase 3: Architecture View Implementation (IN PROGRESS)

**Files to Modify**:

- `src/lib/memgraphClient.ts` — add architecture-specific queries
- `src/App.tsx` — add architecture state (layer focus, violation filter)
- `src/components/controls/ArchitectureControls.tsx` — wire up controls

**Tasks**:

- [ ] Query `LAYER` nodes and traverse `BELONGS_TO_LAYER`
- [ ] Query `RULE` nodes and traverse `VIOLATES_RULE`
- [ ] Implement community detection (if MAGE available)
- [ ] Add violation-only filter
- [ ] Add layer focus dropdown
- [ ] Visual distinction for violated relationships (red edges)
- [ ] Test with lxRAG architecture data

**Done when**:

- Users can see layer structure
- Violations are highlighted
- Community detection works (if available)

### ⏳ Phase 4: Plan View Implementation (PENDING)

**Files to Modify**:

- `src/lib/memgraphClient.ts` — add progress-specific queries
- `src/App.tsx` — add plan filters (status, feature focus)
- `src/components/controls/PlanControls.tsx` — wire up controls

**Tasks**:

- [ ] Query `FEATURE` and `TASK` nodes
- [ ] Traverse `TARGETS` (feature → file), `APPLIES_TO` (task → feature)
- [ ] Filter by status (pending/in-progress/completed/blocked)
- [ ] Add feature focus dropdown
- [ ] Show implementing files and test coverage
- [ ] Visual status indicators (color-coded nodes)

**Done when**:

- Users can see feature/task tree
- Status is visible (color + label)
- Blocking relationships are clear

### ⏳ Phase 5: Documentation View Implementation (PENDING)

**Files to Modify**:

- `src/lib/memgraphClient.ts` — add docs-specific queries
- `src/App.tsx` — add doc filters (kind filter, show linked code)
- `src/components/controls/DocumentationControls.tsx` — wire up controls

**Tasks**:

- [ ] Query `DOCUMENT` and `SECTION` nodes
- [ ] Traverse `SECTION_OF` (section → document), `DOC_DESCRIBES` (section → code)
- [ ] Filter by doc kind (readme/adr/guide/reference)
- [ ] Toggle linked code visibility
- [ ] Visual distinction for doc nodes vs code nodes

**Done when**:

- Users can browse documentation tree
- Doc-to-code links are visible
- Doc kind filtering works

### ⏳ Phase 6: Polish and Documentation (PENDING)

**Files to Update**:

- `README.md` — update usage instructions
- `docs/architecture.md` — update architecture to reflect view modes
- `docs/simplification-plan.md` — mark as implemented

**Tasks**:

- [ ] Remove dead code (old filter logic)
- [ ] Update README with view mode examples
- [ ] Add tooltips/help text to controls
- [ ] Performance validation (view switching < 100ms)
- [ ] Create demo screenshots for each view
- [ ] User testing validation

**Done when**:

- Documentation is complete
- No unused code remains
- User testing validates that views are intuitive

---

## Current State Summary

### What Works ✅

- **View Mode Selection**: Switch between 4 views with dropdown
- **Structure View**: Full filtering (imports/exports/tests) with visual feedback
- **Live Data**: Connected to lxRAG graph (503 nodes)
- **Interactive Canvas**: Click/double-click, depth control, auto-refresh
- **Persistence**: View mode and filters persist across page reloads

### What's Next 🔄

- **Architecture View**: Layer visualization and violation detection
- **Plan View**: Feature/task tracking with status
- **Documentation View**: Doc hierarchy with code links
- **Polish**: Screenshots, tooltips, performance tuning

---

## Next Steps (Immediate Action Items)

### Step 1: Check lxRAG Graph for Architecture Data

Before implementing Architecture View, verify what data is available:

```bash
# Check for LAYER nodes
curl -X POST http://localhost:4001/query -H "Content-Type: application/json" \
  -d '{"query":"MATCH (n:LAYER) RETURN count(n) as count","params":{}}'

# Check for RULE nodes
curl -X POST http://localhost:4001/query -H "Content-Type: application/json" \
  -d '{"query":"MATCH (n:RULE) RETURN count(n) as count","params":{}}'

# Check for VIOLATES_RULE relationships
curl -X POST http://localhost:4001/query -H "Content-Type: application/json" \
  -d '{"query":"MATCH ()-[r:VIOLATES_RULE]->() RETURN count(r) as count","params":{}}'

# Check for BELONGS_TO_LAYER relationships
curl -X POST http://localhost:4001/query -H "Content-Type: application/json" \
  -d '{"query":"MATCH ()-[r:BELONGS_TO_LAYER]->() RETURN count(r) as count","params":{}}'
```

### Step 2: Architecture View Implementation Strategy

**If architecture data exists**:

- Implement full Architecture View with layers and violations
- Follow Phase 3 tasks sequentially

**If no architecture data**:

- Use community detection fallback (directory-based grouping)
- Create placeholder architecture UI
- Add "Configure Layers" call-to-action
- Skip to Phase 4 (Plan View) or Phase 5 (Documentation View)

### Step 3: Alternative Path - Plan View First

If architecture data is sparse, consider implementing **Plan View (Phase 4)** next:

- Check for `FEATURE` and `TASK` nodes
- Likely more data available from development workflow
- More immediately useful for tracking progress
- Less complex than architecture visualization

### Step 4: Check for Documentation Data

```bash
# Check for DOCUMENT nodes
curl -X POST http://localhost:4001/query -H "Content-Type: application/json" \
  -d '{"query":"MATCH (n:DOCUMENT) RETURN count(n) as count, collect(n.relativePath)[0..5] as samples","params":{}}'

# Check for SECTION nodes
curl -X POST http://localhost:4001/query -H "Content-Type: application/json" \
  -d '{"query":"MATCH (n:SECTION) RETURN count(n) as count","params":{}}'
```

### Recommended Next Action

**Run data discovery queries above**, then choose path:

1. **Path A**: Architecture data exists → Implement Phase 3 (Architecture View)
2. **Path B**: Plan data exists → Implement Phase 4 (Plan View)
3. **Path C**: Documentation data exists → Implement Phase 5 (Documentation View)
4. **Path D**: No specialized data → Use current Structure View for MVP, add architecture config

---

## Migration Strategy

### Backward Compatibility

**Environment Variable**: `VITE_SIMPLE_UI=true`

- When `false` (default): Keep current UI with all filters
- When `true`: Enable new view mode UI

**Gradual Rollout**:

1. Implement view modes behind feature flag
2. Deploy both UIs in parallel
3. Gather user feedback
4. Deprecate old UI after validation period

### Storage Migration

Old storage keys:

- `code-visual:nodeTypeFilters`
- `code-visual:nodeGroupFilters`

New storage keys:

- `code-visual:viewMode` (default: "structure")
- `code-visual:structure:showImports`
- `code-visual:structure:showExports`
- `code-visual:structure:showTests`
- `code-visual:architecture:layerFocusId`
- `code-visual:architecture:showViolationsOnly`
- `code-visual:plan:statusFilter`
- `code-visual:plan:featureFocusId`
- `code-visual:documentation:kindFilter`

On first load with `VITE_SIMPLE_UI=true`, infer initial mode from old filters:

- If `docs` or `progress` were enabled → start in `documentation` or `plan` mode
- Otherwise → start in `structure` mode

---

## Query Examples per View

### Structure View Queries

**Initial load (root nodes)**:

```cypher
MATCH (p:PROJECT {projectId: $projectId})
OPTIONAL MATCH (p)-[:CONTAINS]->(root:FOLDER)
WHERE NOT EXISTS((root)<-[:CONTAINS]-(:FOLDER))
RETURN p, collect(root) AS roots
```

**Expand folder**:

```cypher
MATCH (parent {id: $parentId, projectId: $projectId})
MATCH (parent)-[:CONTAINS]->(child)
WHERE child:FOLDER OR child:FILE
RETURN child
```

**Expand file (get symbols)**:

```cypher
MATCH (file:FILE {id: $fileId, projectId: $projectId})
MATCH (file)-[:CONTAINS]->(symbol)
WHERE symbol:FUNCTION OR symbol:CLASS OR symbol:IMPORT OR symbol:EXPORT
RETURN symbol
```

**Expand symbol (get references)**:

```cypher
MATCH (symbol {id: $symbolId, projectId: $projectId})
MATCH (symbol)-[r:IMPORTS|EXPORTS|REFERENCES|EXTENDS|IMPLEMENTS]-(related)
RETURN related, type(r) AS relation
```

### Architecture View Queries

**Load layers**:

```cypher
MATCH (layer:LAYER {projectId: $projectId})
RETURN layer
ORDER BY layer.name
```

**Load nodes for layer**:

```cypher
MATCH (layer:LAYER {id: $layerId, projectId: $projectId})
MATCH (node)-[:BELONGS_TO_LAYER]->(layer)
RETURN node
```

**Load violations**:

```cypher
MATCH (node {projectId: $projectId})-[v:VIOLATES_RULE]->(rule:RULE)
RETURN node, v, rule
```

**Community detection** (via MAGE):

```cypher
CALL community_detection.get() YIELD node, community_id
WHERE node.projectId = $projectId
RETURN node, community_id
```

### Plan View Queries

**Load features**:

```cypher
MATCH (f:FEATURE {projectId: $projectId})
OPTIONAL MATCH (f)-[:TARGETS]->(file:FILE)
OPTIONAL MATCH (t:TASK)-[:APPLIES_TO]->(f)
RETURN f, collect(file) AS files, collect(t) AS tasks
ORDER BY f.status, f.startedAt DESC
```

**Load tasks for feature**:

```cypher
MATCH (f:FEATURE {id: $featureId, projectId: $projectId})
MATCH (t:TASK)-[:APPLIES_TO]->(f)
OPTIONAL MATCH (t)-[:BLOCKED_BY]->(blocker:TASK)
RETURN t, collect(blocker) AS blockers
ORDER BY t.status, t.dueDate
```

**Load implementing files for feature**:

```cypher
MATCH (f:FEATURE {id: $featureId, projectId: $projectId})
MATCH (f)-[:TARGETS]->(file:FILE)
OPTIONAL MATCH (file)-[:CONTAINS]->(symbol)
WHERE symbol:FUNCTION OR symbol:CLASS
RETURN file, collect(symbol) AS symbols
```

### Documentation View Queries

**Load documents**:

```cypher
MATCH (doc:DOCUMENT {projectId: $projectId})
OPTIONAL MATCH (doc)<-[:SECTION_OF]-(section:SECTION)
RETURN doc, collect(section) AS sections
ORDER BY doc.relativePath
```

**Load sections for document**:

```cypher
MATCH (doc:DOCUMENT {id: $docId, projectId: $projectId})
MATCH (doc)<-[:SECTION_OF]-(section:SECTION)
OPTIONAL MATCH (section)-[:DOC_DESCRIBES]->(code)
RETURN section, collect(code) AS linkedCode
ORDER BY section.startLine
```

**Load docs describing symbol**:

```cypher
MATCH (symbol {id: $symbolId, projectId: $projectId})
MATCH (symbol)<-[:DOC_DESCRIBES]-(section:SECTION)
MATCH (section)-[:SECTION_OF]->(doc:DOCUMENT)
RETURN section, doc
```

---

## Visual Design per View

### Structure View

- **FILE nodes**: neumorphic rectangles, file icon, extension badge
- **FOLDER nodes**: neumorphic rounded, folder icon
- **FUNCTION nodes**: service-sized pills, fn icon
- **CLASS nodes**: service-sized pills, class icon
- **IMPORT/EXPORT edges**: thin dashed lines, directional arrows

### Architecture View

- **LAYER nodes**: large rounded rectangles, layer icon, layer name
- **Violation edges**: thick red dashed lines, warning icon
- **Normal edges**: thin gray lines
- **Community grouping**: background color blocks per community

### Plan View

- **FEATURE nodes**: large rounded rectangle, feature icon, status color border
- **TASK nodes**: smaller pills, checkbox icon, status color fill
  - `pending`: gray
  - `in-progress`: blue
  - `completed`: green
  - `blocked`: red
- **BLOCKED_BY edges**: thick red lines with block icon
- **TARGETS edges**: thin blue lines to files

### Documentation View

- **DOCUMENT nodes**: large rectangles, doc icon, file extension
- **SECTION nodes**: medium pills, section icon, heading text
- **DOC_DESCRIBES edges**: dashed blue lines with link icon

---

## Documentation Plan

### 1. User Guide (`docs/user-guide.md`)

**Sections**:

- **Getting Started**: Setup, proxy, env vars
- **View Modes Overview**: What each mode is for
- **Structure View Tutorial**: Example workflow exploring imports
- **Architecture View Tutorial**: Example detecting violations
- **Plan View Tutorial**: Example tracking feature progress
- **Documentation View Tutorial**: Example finding docs for a symbol
- **Keyboard Shortcuts**: Navigation, view switching
- **Troubleshooting**: Common issues

### 2. API Reference (`docs/api-reference.md`)

**Sections**:

- **MCP Tools Summary**: All 33 tools with brief descriptions
- **Graph Schema**: All node labels, relationships, properties
- **Query Examples**: Cypher queries for each view mode
- **Custom Queries**: How to write custom Cypher via `graph_query`

### 3. Architecture Doc Update (`docs/architecture.md`)

**New Sections**:

- **View Modes**: Design principles, mode switching logic
- **Query Adapters**: How queries change per mode
- **State Management**: ViewMode state, mode-specific filters
- **Visual Semantics per Mode**: Icon/color/shape mappings

### 4. MCP Integration Guide (`docs/mcp-integration.md`)

**Sections**:

- **MCP Server Setup**: Docker compose, health checks
- **Tool Usage**: How visualizer uses each tool
- **Schema Contract**: Expected node/edge structure
- **Hybrid Retrieval**: How semantic search works
- **Temporal Model**: validFrom/validTo usage
- **SCIP IDs**: How stable symbol IDs work

### 5. Development Guide (`docs/development.md`)

**Sections**:

- **Adding a New View Mode**: Step-by-step
- **Custom Queries**: Writing mode-specific queries
- **Visual Customization**: Theming per mode
- **Testing**: Unit tests for query adapters

---

## Success Metrics

### User Experience

- **Time to first insight**: < 10 seconds (vs current ~30s with filter exploration)
- **Cognitive load**: 1 mode selector + 2-3 mode-specific controls (vs 14 toggles)
- **Task completion rate**: 90%+ for "show me layer violations" workflow

### Technical

- **Query performance**: < 500ms for initial view load
- **View switching**: < 100ms (instant, no re-query unless depth changed)
- **Memory usage**: No regression vs current implementation

### Code Quality

- **Cyclomatic complexity**: < 10 per function
- **Test coverage**: > 80% for query adapters
- **Bundle size**: No increase (remove dead code offsets new controls)

---

## Open Questions

1. **Default view mode**: Start in Structure or Architecture?
   - **Recommendation**: Structure (most universal workflow)

2. **View mode persistence**: Per-project or global?
   - **Recommendation**: Global with per-project override (localStorage key includes projectId)

3. **Mixed views**: Allow showing Plan + Structure simultaneously?
   - **Recommendation**: Phase 7+ (composite views), keep simple for MVP

4. **MCP server version detection**: How to handle schema differences?
   - **Recommendation**: Health check returns schema version, adapt queries accordingly

5. **Community detection fallback**: What if MAGE not available?
   - **Recommendation**: Fall back to directory-based communities (already implemented in MCP)

---

## Timeline Estimate

- **Phase 1** (View Mode Infrastructure): 3 days
- **Phase 2** (Structure View): 4 days
- **Phase 3** (Architecture View): 5 days (includes community detection)
- **Phase 4** (Plan View): 4 days
- **Phase 5** (Documentation View): 3 days
- **Phase 6** (Polish + Docs): 3 days

**Total**: ~22 days (4.5 weeks) for full implementation

**MVP** (Phases 1-2 only): 7 days (Structure view + infrastructure)

---

## Next Steps

1. Review this plan with stakeholders
2. Validate query examples against live Memgraph instance
3. Create wireframes for each view mode
4. Implement Phase 1 (view mode infrastructure)
5. Validate with user testing
6. Proceed with remaining phases
