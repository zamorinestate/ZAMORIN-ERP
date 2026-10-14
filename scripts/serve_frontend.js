import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, "../frontend");
const port = 3000;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff"
};

const compressibleExtensions = new Set([
  ".html",
  ".js",
  ".css",
  ".json",
  ".svg"
]);

// High-speed in-memory cache for static assets (path -> { mtimeMs, size, etag, raw, gzip, br, contentType, isCompressible })
const staticAssetCache = new Map();
const MAX_CACHE_ITEM_SIZE = 3 * 1024 * 1024; // 3MB per item limit

function getCachedOrReadFile(filePath, ext) {
  const stat = fs.statSync(filePath);
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const cached = staticAssetCache.get(filePath);

  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached;
  }

  const raw = fs.readFileSync(filePath);
  const contentType = mimeTypes[ext] || "application/octet-stream";
  const isCompressible = compressibleExtensions.has(ext) && raw.length > 512;

  let gzip = null;
  let br = null;

  if (isCompressible) {
    try {
      gzip = zlib.gzipSync(raw, { level: 6 });
    } catch {}
    try {
      br = zlib.brotliCompressSync(raw, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 5
        }
      });
    } catch {}
  }

  const entry = {
    mtimeMs: stat.mtimeMs,
    mtimeUtc: stat.mtime.toUTCString(),
    size: stat.size,
    etag,
    raw,
    gzip,
    br,
    contentType,
    isCompressible
  };

  if (stat.size <= MAX_CACHE_ITEM_SIZE) {
    staticAssetCache.set(filePath, entry);
  }

  return entry;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // Reverse proxy /api/*, /qr/*, /invoice/*, /c/* requests to local backend or Render
  if (
    parsedUrl.pathname.startsWith("/api/") ||
    parsedUrl.pathname.startsWith("/qr/") ||
    parsedUrl.pathname.startsWith("/invoice/") ||
    parsedUrl.pathname.startsWith("/c/")
  ) {
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

  try {
    const asset = getCachedOrReadFile(filePath, ext);

    // Conditional HTTP 304 Validation
    const reqEtag = req.headers["if-none-match"];
    const reqIfModifiedSince = req.headers["if-modified-since"];

    if (reqEtag === asset.etag || (reqIfModifiedSince && reqIfModifiedSince === asset.mtimeUtc)) {
      res.writeHead(304, {
        "ETag": asset.etag,
        "Last-Modified": asset.mtimeUtc,
        "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600, stale-while-revalidate=86400",
        "Access-Control-Allow-Origin": "*"
      });
      res.end();
      return;
    }

    // Encoding negotiation
    const acceptEncoding = req.headers["accept-encoding"] || "";
    let responseBody = asset.raw;
    const responseHeaders = {
      "Content-Type": asset.contentType,
      "ETag": asset.etag,
      "Last-Modified": asset.mtimeUtc,
      "Access-Control-Allow-Origin": "*",
      "Vary": "Accept-Encoding"
    };

    if (ext === ".html") {
      responseHeaders["Cache-Control"] = "no-cache";
    } else {
      responseHeaders["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400";
    }

    if (asset.isCompressible) {
      if (acceptEncoding.includes("br") && asset.br) {
        responseHeaders["Content-Encoding"] = "br";
        responseBody = asset.br;
      } else if (acceptEncoding.includes("gzip") && asset.gzip) {
        responseHeaders["Content-Encoding"] = "gzip";
        responseBody = asset.gzip;
      }
    }

    responseHeaders["Content-Length"] = responseBody.length;

    res.writeHead(200, responseHeaders);
    res.end(responseBody);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Server Error: " + err.message);
  }
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
