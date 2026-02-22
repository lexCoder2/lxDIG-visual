/**
 * lxRAG MCP Proxy Server
 *
 * This server provides an HTTP API for querying the lxRAG graph.
 * It wraps the MCP tools (mcp_lxrag_graph_query) in a simple REST interface
 * that the frontend can call directly.
 *
 * Usage:
 *   node server/lxrag-proxy.mjs
 *
 * Endpoints:
 *   POST /lxrag/query - Execute Cypher query against lxRAG graph
 *     Body: { query: string, language?: string, limit?: number }
 *     Returns: { data: { results: any[] } }
 */

import { createServer } from "http";

const PORT = 3456;
const LXRAG_ENDPOINT = process.env.LXRAG_ENDPOINT || "http://localhost:7687";

/**
 * Call the lxRAG MCP tool via subprocess
 * In a real implementation, this would use the MCP SDK or direct Memgraph connection
 */
async function callLxRAGQuery(query, options = {}) {
  // For now, we'll connect directly to Memgraph using the same approach
  // as the MCP tool would use internally

  const { language = "cypher", limit = 1000 } = options;

  // This is a simplified version - in production, you'd use the neo4j/memgraph driver
  try {
    const response = await fetch("http://localhost:7687/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit }),
    });

    if (!response.ok) {
      throw new Error(`Memgraph query failed: ${response.status}`);
    }

    const data = await response.json();
    return {
      ok: true,
      data: {
        results: data.results || data.rows || [],
      },
    };
  } catch (error) {
    console.error("lxRAG query error:", error);
    return {
      ok: false,
      error: error.message,
      data: { results: [] },
    };
  }
}

/**
 * Parse JSON body from request
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Send JSON response
 */
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

/**
 * Main request handler
 */
const server = createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    sendJSON(res, 204, {});
    return;
  }

  // POST /lxrag/query
  if (req.method === "POST" && req.url === "/lxrag/query") {
    try {
      const body = await parseBody(req);
      const { query, language, limit } = body;

      if (!query) {
        sendJSON(res, 400, {
          ok: false,
          error: "Missing 'query' parameter",
        });
        return;
      }

      const result = await callLxRAGQuery(query, { language, limit });
      sendJSON(res, 200, result);
    } catch (error) {
      console.error("Request error:", error);
      sendJSON(res, 500, {
        ok: false,
        error: error.message,
      });
    }
    return;
  }

  // 404 for unknown routes
  sendJSON(res, 404, {
    ok: false,
    error: "Not found",
  });
});

server.listen(PORT, () => {
  console.log(`lxRAG MCP Proxy listening on http://localhost:${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  POST /lxrag/query - Execute Cypher query`);
});
