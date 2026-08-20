import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest } from "./server/bridge.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const dist = join(root, "dist");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  if (req.url?.startsWith("/api/")) {
    await handleApiRequest(req, res);
    return;
  }
  if (!existsSync(dist)) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("请先运行 npm run build");
    return;
  }
  const requestPath = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
  const safePath = normalize(join(dist, requestPath === "/" ? "index.html" : requestPath));
  const filePath = safePath.startsWith(dist) && existsSync(safePath) && statSync(safePath).isFile() ? safePath : join(dist, "index.html");
  res.writeHead(200, { "Content-Type": mime[extname(filePath)] || "application/octet-stream", "Cache-Control": "no-store" });
  createReadStream(filePath).pipe(res);
});

server.listen(8787, "0.0.0.0", () => {
  console.log("书页驿站已启动：http://127.0.0.1:8787（局域网设备可通过本机 IPv4 地址访问）");
  if (process.env.OPEN_BROWSER !== "0" && process.platform === "win32") {
    const browser = spawn("cmd.exe", ["/d", "/c", "start", "", "http://127.0.0.1:8787"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    browser.unref();
  }
});
