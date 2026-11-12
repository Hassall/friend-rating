import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { LIVE_ORIGIN } from "../web/origins.js";

const source = new URL("../web/", import.meta.url);
const output = new URL("../dist/pages/", import.meta.url);
const files = ["index.html", "style.css", "app.js", "origins.js", "traits.js", "favicon.svg"];
await mkdir(output, { recursive: true });
await Promise.all([
  ...files.map((name) => copyFile(new URL(name, source), new URL(name, output))),
  writeFile(new URL("_redirects", output), "/admin " + LIVE_ORIGIN + "/admin 302\n/admin/ " + LIVE_ORIGIN + "/admin 302\n"),
  writeFile(new URL("_headers", output), "/*\n  Cache-Control: no-cache\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n/r/*\n  X-Robots-Tag: noindex, nofollow\n/room/*\n  X-Robots-Tag: noindex, nofollow\n"),
]);
