import "dotenv/config";
import http from "node:http";
import neo4j from "neo4j-driver";

const port = Number(process.env.MEMGRAPH_PROXY_PORT ?? 4000);
const boltUrl = process.env.MEMGRAPH_BOLT_URL ?? "bolt://localhost:7687";
const username = process.env.MEMGRAPH_BOLT_USER ?? "";
const password = process.env.MEMGRAPH_BOLT_PASSWORD ?? "";

const auth = neo4j.auth.basic(username, password);
const driver = neo4j.driver(boltUrl, auth);

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  response.end(JSON.stringify(payload));
}

function normalizeValue(value) {
  if (neo4j.isInt(value)) {
    return value.inSafeRange() ? value.toNumber() : value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  if (value && typeof value === "object") {
    const normalized = {};
    Object.entries(value).forEach(([key, entry]) => {
      normalized[key] = normalizeValue(entry);
    });
    return normalized;
  }

  return value;
}

async function runQuery(query, params) {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(query, params);
    return result.records.map((record) => {
      const raw = record.toObject();
      const normalized = {};
      Object.entries(raw).forEach(([key, value]) => {
        normalized[key] = normalizeValue(value);
      });
      return normalized;
    });
  } finally {
    await session.close();
  }
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    writeJson(response, 404, { error: "Not found" });
    return;
  }

  if (request.method === "OPTIONS") {
    writeJson(response, 204, {});
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    writeJson(response, 200, { status: "ok", boltUrl });
    return;
  }

  if (request.method !== "POST" || request.url !== "/query") {
    writeJson(response, 404, { error: "Not found" });
    return;
  }

  const chunks = [];
  request.on("data", (chunk) => {
    chunks.push(chunk);
  });

  request.on("end", async () => {
    try {
      const bodyString = Buffer.concat(chunks).toString("utf8");
      const body = bodyString ? JSON.parse(bodyString) : {};
      const query = typeof body.query === "string" ? body.query : "";
      const params =
        body.params && typeof body.params === "object" ? body.params : {};

      if (!query) {
        writeJson(response, 400, { error: "Missing query" });
        return;
      }

      const rows = await runQuery(query, params);
      writeJson(response, 200, rows);
    } catch (error) {
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : "Proxy query failed",
      });
    }
  });
});

server.listen(port, () => {
  console.log(`[memgraph-proxy] listening on http://localhost:${port}`);
  console.log(`[memgraph-proxy] bolt target: ${boltUrl}`);
});

const shutdown = async () => {
  await driver.close();
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
