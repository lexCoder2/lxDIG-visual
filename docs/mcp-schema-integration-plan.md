# MCP Schema Integration Plan (code-graph-server → code-visual)

## Active context

- Visualizer repo: `/home/alex_rod/projects/code-visual`
- MCP/schema source repo: `~/projects/lexRAG-MCP`
- Integration objective: make this visualizer align with the graph schema emitted by `lexRAG-MCP`, not an inferred subset.

## What changed in `code-graph-server` (enhancements + graph deltas)

### 1) Graph model expanded beyond code-only nodes

Core code labels still exist:

- `FILE`, `FOLDER`, `FUNCTION`, `CLASS`, `IMPORT`, `EXPORT`, `VARIABLE`, `TEST_SUITE`

Additional operational and intelligence labels now present:

- `DOCUMENT`, `SECTION`, `FEATURE`, `TASK`, `EPISODE`, `LEARNING`, `CLAIM`, `COMMUNITY`, `RULE`, `GRAPH_TX`

### 2) Relationship space expanded

Observed relationships across builders/engines:

- Structural: `CONTAINS`, `IMPORTS`, `EXPORTS`, `REFERENCES`, `EXTENDS`, `IMPLEMENTS`, `TESTS`
- Docs/context: `SECTION_OF`, `NEXT_SECTION`, `DOC_DESCRIBES`
- Agent/progress: `INVOLVES`, `NEXT_EPISODE`, `APPLIES_TO`, `TARGETS`, `BELONGS_TO`
- Architecture: `VIOLATES_RULE`, `BELONGS_TO_LAYER`

### 3) Temporal + identity semantics strengthened

- Many nodes now include temporal fields: `validFrom`, `validTo`, `createdAt`, `txId`.
- IDs are increasingly scoped and stable (project-scoped IDs and SCIP-style IDs on code nodes).
- Project scoping is done primarily through `projectId`, but some engine writes may not consistently set it.

### 4) Docs and agent-memory features are first-class graph citizens

- Docs indexing creates `DOCUMENT` / `SECTION` nodes and semantic links (`DOC_DESCRIBES`) to code symbols.
- Agent memory and coordination create `EPISODE`, `LEARNING`, `CLAIM`, and related edges.
- Progress tracking introduces `FEATURE` and `TASK` nodes.

## Current incompatibilities in `code-visual`

1. **Type system is too narrow**
   - `NodeKind` supports only `layer | module | service | file`.
   - `SemanticNodeType` supports only `function | class | import | export | variable`.
   - Result: most new labels collapse to generic visuals and lose meaning.

2. **Traversal is schema-agnostic in a risky way**
   - Undirected `MATCH (p)-[r]-(c)` and undirected edge IDs can collapse distinct directed edges and relation types.
   - Rich schemas with multiple relation semantics need direction + relation identity preserved.

3. **Temporal filtering is missing**
   - Queries do not filter expired facts (`validTo`), so historical nodes can leak into live views.

4. **Root/project bootstrap is weak**
   - Project list query finds `projectId` counts, then chooses an arbitrary root node by `LIMIT 1`.
   - With expanded schemas, this can start from non-structural nodes (`EPISODE`, `GRAPH_TX`, etc.).

5. **Project-only filters can exclude valid linked nodes**
   - Some newer node writes may omit `projectId` or use different scoping assumptions.
   - Strict project predicate can sever useful cross-label links.

## Integration strategy

Implement a **schema adapter layer** in the visualizer and make all query + rendering flow through it.

### Adapter principles

- One canonical mapping table from graph labels/relations → UI node categories.
- Preserve raw label/relation metadata for future UI and debugging.
- Render unknown labels gracefully (never drop nodes silently).
- Keep direction and relation identity in edges.
- Gate live graph to active temporal slice by default.

---

## Phased implementation plan

## Phase 0 — Contract baseline and fixtures

### Scope

- Add a `schema-contract` document and sample query fixtures in this repo.

### Tasks

- Create `docs/schema-contract.md` with:
  - supported labels,
  - supported relations,
  - required properties (`id`, `projectId`, temporal fields where available),
  - fallback behavior for missing properties.
- Save 2–3 real response fixtures from current Memgraph snapshots (small, medium, mixed labels).

### Done when

- Visualizer team has a versioned contract artifact independent of runtime assumptions.

---

## Phase 1 — Data model expansion (types + store)

### Files

- `src/types/graph.ts`
- `src/state/graphStore.ts`

### Tasks

- Replace narrow `NodeKind` with broader categories (example: `project`, `structure`, `code`, `docs`, `progress`, `memory`, `architecture`, `system`, `unknown`).
- Keep `semanticType` for code semantics, but add optional `label`/`labels` and `group` fields to node entities.
- Change edge identity from undirected pair to relation-aware, direction-aware ID:
  - `${source}::${relation}::${target}`.
- Store edge `relation`, `direction`, and optional metadata.

### Done when

- Store can represent all observed labels/relations without loss or collapsing.

---

## Phase 2 — Query layer hardening (Memgraph client)

### Files

- `src/lib/memgraphClient.ts`

### Tasks

- Add temporal-live predicate to all expansion queries (example concept):
  - include nodes where `validTo` is `NULL`, large sentinel, or greater than current time.
- Replace root-node bootstrap with deterministic root selection order:
  1. root `FOLDER` for project workspace,
  2. top-level `FILE` fallback,
  3. highest-degree code node fallback.
- Return `labels(parent)`, `labels(child)`, `type(rel)`, and relation direction explicitly.
- Normalize mapping through a dedicated adapter function (`mapGraphNode`, `mapGraphEdge`) instead of inline heuristics.
- Keep project filter but make it resilient:
  - allow controlled inclusion of linked nodes without `projectId` when traversing from in-project roots.

### Done when

- Queries return stable, deterministic roots and live-slice graph data.

---

## Phase 3 — Rendering + visual semantics update

### Files

- `src/components/GraphCanvas.tsx`
- `src/config/constants.ts`
- `src/lib/graphVisuals.ts`

### Tasks

- Add category-level icon/label mapping for newly represented groups (`docs`, `memory`, `progress`, `architecture`, `system`).
- Keep current node styling system, but ensure no category falls back to misleading visuals.
- Update label formatter to handle document/section/task/episode naming patterns cleanly.

### Done when

- Mixed-schema graphs remain readable and visually differentiated.

---

## Phase 4 — Interaction and filtering alignment

### Files

- `src/App.tsx`
- `src/components/controls/*`

### Tasks

- Extend filters from only semantic code types to include node groups.
- Preserve existing minimal control pattern (no new pages/modals).
- Ensure selection/expansion behavior works for non-code nodes (docs/memory/progress).

### Done when

- Users can isolate code-only, docs-only, memory-only, etc., within one canvas.

---

## Phase 5 — Compatibility mode and rollout safety

### Files

- `src/lib/memgraphClient.ts`
- `README.md`

### Tasks

- Add a feature flag (env) for schema mode:
  - `legacy` (current behavior),
  - `full` (new schema adapter).
- Document migration and fallback in `README.md`.
- Provide quick health query in UI startup path to detect unsupported schema and show clear error state.

### Done when

- You can switch between old and new behavior without breaking existing environments.

---

## Validation plan

1. **Static checks**
   - `npm run lint`
   - `npm run build`

2. **Schema validation queries (manual/dev)**
   - Verify node counts by label for selected project.
   - Verify no expired nodes appear when temporal filter is enabled.
   - Verify relation-direction counts are preserved (no collapsing).

3. **UX validation**
   - Load mixed project graph (code + docs + memory/progress nodes).
   - Confirm depth expansion, pagination, and filtering remain responsive.

## Execution order recommendation

1. Phase 1 (types/store)
2. Phase 2 (query adapter)
3. Phase 3 (render semantics)
4. Phase 4 (controls/filters)
5. Phase 5 (rollout/fallback)

This order minimizes risk: data correctness first, then UX, then rollout safety.

## Risks and mitigations

- **Risk:** explosive graph density from additional labels.
  - **Mitigation:** keep depth conservative by default; preserve pagination and filtering.
- **Risk:** inconsistent `projectId` assignment for non-code nodes.
  - **Mitigation:** root-scoped traversal + optional linked-node inclusion toggle in adapter.
- **Risk:** temporal model divergence (`NULL` vs sentinel `validTo`).
  - **Mitigation:** centralized predicate helper used by every live query.

## Immediate next step

Implement **Phase 1 + Phase 2 together** in one PR (types/store + query adapter), because they are tightly coupled and unlock the rest of the migration.
