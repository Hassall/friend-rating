import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const files = {
  "/index.html": "text/html; charset=utf-8",
  "/style.css": "text/css; charset=utf-8",
  "/app.js": "text/javascript; charset=utf-8",
  "/traits.js": "text/javascript; charset=utf-8",
  "/favicon.svg": "image/svg+xml",
};

const assets = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, type]) => [
  name, { type, body: await readFile(new URL("web" + name, root), "utf8") },
])));
const source = await readFile(new URL("server/worker.js", root), "utf8");
await mkdir(new URL("dist/server/", root), { recursive: true });
await mkdir(new URL("dist/.openai/", root), { recursive: true });
await writeFile(
  new URL("dist/server/index.js", root),
  "const APP_ASSETS = " + JSON.stringify(assets) + ";\n" + assets["/traits.js"].body + "\n" + source,
);
await copyFile(new URL(".openai/hosting.json", root), new URL("dist/.openai/hosting.json", root));
