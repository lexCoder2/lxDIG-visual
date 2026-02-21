# Code Visual

> Navigate your codebase as a live graph. Powered by Memgraph.
<div align="center">
<img src="docs/screenshot.png" alt="Code Visual screenshot" width="640" />
</div>  
> **Works with [code-graph-server](https://github.com/lexCoder2/code-graph-server)** — an MCP tool for VS Code and Claude that analyses your codebase and populates Memgraph with nodes and relationships. Code Visual is the visual front-end for that graph.

Code Visual connects to a Memgraph database and renders the relationships between projects, modules, files, and code entities as an interactive force-directed graph. Expand nodes, change depth, filter by semantic type, and drag the canvas to explore your architecture at a glance.

## Features

- **Live graph** — auto-refreshes from Memgraph every 5 s
- **Depth navigation** — configurable traversal depth (1–4 levels)
- **Semantic filters** — show/hide functions, classes, imports, exports, variables
- **Hierarchical subtree pruning** — hiding a type removes its entire descendant tree and reflows the layout
- **Drag & drop** — nodes propagate movement to nearby connected nodes
- **Mock mode** — works offline with built-in synthetic data
- **Neumorphic UI** — glass-morphic header, soft-shadow nodes, pastel accents

## Quick start

```bash
# 1. Install
npm install

# 2. Copy and fill env
cp .env.example .env   # set MEMGRAPH_BOLT_URL, MEMGRAPH_PROXY_PORT

# 3. Run proxy + dev server together
npm run dev:all
```

Open [http://localhost:5173](http://localhost:5173).  
If Memgraph is unreachable the app falls back to mock data automatically.

## Environment

| Variable                 | Default                       | Purpose                   |
| ------------------------ | ----------------------------- | ------------------------- |
| `VITE_MEMGRAPH_URL`      | `http://localhost:4000/query` | Frontend → proxy endpoint |
| `MEMGRAPH_BOLT_URL`      | `bolt://localhost:7687`       | Proxy → Memgraph Bolt     |
| `MEMGRAPH_BOLT_USER`     | _(empty)_                     | Bolt auth username        |
| `MEMGRAPH_BOLT_PASSWORD` | _(empty)_                     | Bolt auth password        |
| `MEMGRAPH_PROXY_PORT`    | `4000`                        | Local proxy port          |

See [docs/architecture.md](docs/architecture.md) for a full technical breakdown.

- `{ "rows": [...] }`

If no endpoint is configured, the app runs in mock mode.

## Scripts

- `npm run dev`: start development server
- `npm run build`: type-check + build
- `npm run lint`: lint project
- `npm run preview`: preview production build
