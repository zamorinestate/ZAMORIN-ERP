import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, "../frontend");
const port = 3000;

const mimeTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // Reverse proxy /api/*, /qr/*, /invoice/*, /c/* requests to local backend or Render
  if (parsedUrl.pathname.startsWith("/api/") || parsedUrl.pathname.startsWith("/qr/") || parsedUrl.pathname.startsWith("/invoice/") || parsedUrl.pathname.startsWith("/c/")) {
    const backendHost = process.env.BACKEND_URL || "http://localhost:4000";
    async function tryProxy(host) {
      const targetUrl = `${host}${parsedUrl.pathname}${parsedUrl.search}`;
      const headers = { ...req.headers };
      delete headers.host;

      let bodyData = undefined;
      if (req.method !== "GET" && req.method !== "HEAD") {
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        bodyData = Buffer.concat(chunks);
      }

      return await fetch(targetUrl, {
        method: req.method,
        headers,
        body: bodyData,
        redirect: "manual"
      });
    }

    try {
      let proxyRes;
      try {
        proxyRes = await tryProxy(backendHost);
      } catch (primaryErr) {
        if (backendHost.includes("localhost") || backendHost.includes("127.0.0.1")) {
          console.warn("[proxy] Local backend unavailable, falling back to staging Render API...");
          proxyRes = await tryProxy("https://zamorin-cafe-erp-staging.onrender.com");
        } else {
          throw primaryErr;
        }
      }

      const resHeaders = {};
      proxyRes.headers.forEach((val, key) => {
        resHeaders[key] = val;
      });
      resHeaders["Access-Control-Allow-Origin"] = "*";
      resHeaders["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, PATCH, OPTIONS";
      resHeaders["Access-Control-Allow-Headers"] = "*";

      res.writeHead(proxyRes.status, resHeaders);
      const buffer = await proxyRes.arrayBuffer();
      res.end(Buffer.from(buffer));
      return;
    } catch (proxyErr) {
      console.error("API proxy error:", proxyErr);
      res.writeHead(502, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: "Backend proxy unreachable", message: proxyErr.message }));
      return;
    }
  }

  let filePath = path.join(frontendDir, decodeURIComponent(parsedUrl.pathname));

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (!fs.existsSync(filePath)) {
    filePath = path.join(frontendDir, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Server Error");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0"
    });
    res.end(content);
  });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use.`);
  } else {
    console.error("Server error:", err);
  }
});

server.listen(port, () => {
  console.log(`Frontend server running at http://localhost:${port}`);
});

process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
