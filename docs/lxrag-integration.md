# lxRAG Integration Guide

## Overview

The Code-Visual canvas is now connected to lxRAG's knowledge graph, providing real-time visualization of your codebase structure.

## Setup Complete ✅

### 1. lxRAG Graph Initialized

- **Project ID**: `code-visual`
- **Workspace**: `/home/alex_rod/projects/code-visual`
- **Total Nodes**: 503
- **Graph Status**: Connected (Memgraph + Qdrant)

### 2. Infrastructure Running

- **Memgraph Proxy**: http://localhost:4001
  - Connects to: bolt://localhost:7687
  - Queries lxRAG's Memgraph instance
- **Dev Server**: http://localhost:5173
  - Mode: **LIVE** (querying real lxRAG data)
  - View modes: Structure / Architecture / Plan / Documentation

## How to Use

### 1. Open the Application

Navigate to: **http://localhost:5173**

### 2. View the Graph

The canvas now displays:

- **FOLDER** nodes: Directory structure
- **FILE** nodes: Source files (tsx, ts, css, etc.)
- **FUNCTION** nodes: Functions and methods
- **CLASS** nodes: Classes and interfaces
- **Relationships**: Contains, imports, exports, etc.

### 3. Interact with the Graph

- **Click** a node to select it
- **Double-click** a node to expand its children
- **Use controls** to:
  - Change connection depth (1-4)
  - Toggle structure filters (imports/exports/tests)
  - Switch view modes
  - Enable/disable auto-refresh

### 4. View Modes

#### Structure View (📁)

- Shows folders, files, and code symbols
- **Filters**:
  - Show/hide imports
  - Show/hide exports
  - Show/hide test files
- Ideal for navigating codebase structure

#### Architecture View (🏛️)

_Coming in Phase 3_

- Layer visualization
- Community detection
- Architectural violations

#### Plan View (📋)

_Coming in Phase 4_

- Features and tasks
- Status filtering
- Dependency tracking

#### Documentation View (📚)

_Coming in Phase 5_

- Documentation hierarchy
- Linked code visibility
- Document type filtering

## Technical Details

### Data Flow

```
lxRAG MCP Tools → Memgraph (bolt://localhost:7687)
                      ↓
              Memgraph Proxy (http://localhost:4001)
                      ↓
              Frontend Client (memgraphClient.ts)
                      ↓
              Canvas Visualization
```

### Root Node Selection

The app automatically selects the project root folder:

- **ID**: `code-visual:folder:/home/alex_rod/projects/code-visual`
- **Name**: `code-visual`
- **Type**: FOLDER

### Node Classification

Nodes are classified into kinds and visual styles:

| Label             | Kind      | Visual Kind |
| ----------------- | --------- | ----------- |
| FOLDER            | structure | module      |
| FILE              | structure | file        |
| FUNCTION, CLASS   | code      | service     |
| IMPORT, EXPORT    | code      | service     |
| DOCUMENT, SECTION | docs      | module      |
| FEATURE, TASK     | progress  | module      |

### Query Examples

#### List all files:

```cypher
MATCH (n:FILE)
WHERE n.projectId = "code-visual"
RETURN n.id, n.path
ORDER BY n.path
```

#### Get file contents:

```cypher
MATCH (file:FILE)-[:CONTAINS]->(symbol)
WHERE file.id = "code-visual:file:src/App.tsx"
RETURN symbol.id, labels(symbol), symbol.name
```

#### Find functions in a file:

```cypher
MATCH (file:FILE)-[:CONTAINS]->(fn:FUNCTION)
WHERE file.path CONTAINS "App.tsx"
RETURN fn.id, fn.name
```

## Troubleshooting

### Canvas shows "Mock Data"

- Check `.env` file has: `VITE_MEMGRAPH_URL=http://localhost:4001/query`
- Restart dev server: `pkill -f vite && npm run dev`

### Proxy connection error

- Verify Memgraph is running: `curl http://localhost:4001/health`
- Check proxy logs in terminal
- Restart proxy: `MEMGRAPH_PROXY_PORT=4001 node server/memgraph-proxy.mjs`

### No nodes visible

- Verify lxRAG graph has data: Call `mcp_lxrag_graph_health` tool
- Check total nodes > 0
- Try rebuilding: Call `mcp_lxrag_graph_rebuild` tool with mode "incremental"

### Query errors

- Check for Memgraph syntax compatibility
- lxRAG uses Memgraph, not Neo4j (some syntax differs)
- See [Memgraph docs](https://memgraph.com/docs/cypher-manual)

## Files Modified

| File                        | Purpose                                       |
| --------------------------- | --------------------------------------------- |
| `.env`                      | Environment configuration (proxy port)        |
| `src/lib/memgraphClient.ts` | Fixed Memgraph syntax compatibility           |
| `src/lib/lxragClient.ts`    | lxRAG adapter (for future direct integration) |
| `server/lxrag-proxy.mjs`    | Standalone lxRAG proxy (not currently used)   |

## Next Steps

### Immediate

- ✅ Explore the canvas at http://localhost:5173
- ✅ Try different view modes
- ✅ Toggle structure filters
- ✅ Expand nodes to see relationships

### Future Enhancements

1. **Phase 3**: Architecture view with layers and communities
2. **Phase 4**: Plan view with features and tasks
3. **Phase 5**: Documentation view with docs hierarchy
4. **Live Updates**: Watch mode for file changes
5. **Search**: Semantic search integration
6. **Metrics**: Code complexity and coverage overlays

## Resources

- **lxRAG Documentation**: See MCP tools via `mcp_lxrag_*` commands
- **Memgraph Query Guide**: https://memgraph.com/docs/cypher-manual
- **Project Docs**:
  - [Architecture](./architecture.md)
  - [Performance Plan](./performance-plan.md)
  - [lxRAG Tool Issues](./lxrag-tool-issues.md)
  - [Phase 2: Structure View](./phase2-structure-view.md)

## Support

If you encounter issues:

1. Check terminal outputs for error messages
2. Verify all services are running (proxy + dev server)
3. Test queries directly via: `curl -X POST http://localhost:4001/query ...`
4. Review lxRAG graph health: `mcp_lxrag_graph_health`
