import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import "./build.mjs";

const { createHandler } = await import("../dist/server/index.js");
const stateDirectory = new URL("../.local/", import.meta.url);
await mkdir(stateDirectory, { recursive: true });
const sqlite = new DatabaseSync(new URL("rooms.sqlite", stateDirectory));
const table = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rooms'").get();
if (!table) sqlite.exec(await readFile(new URL("../drizzle/0000_rooms.sql", import.meta.url), "utf8"));
const limits = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'room_limits'").get();
if (!limits) sqlite.exec(await readFile(new URL("../drizzle/0001_room_limits.sql", import.meta.url), "utf8"));
const activity = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'site_activity'").get();
if (!activity) sqlite.exec(await readFile(new URL("../drizzle/0002_site_activity.sql", import.meta.url), "utf8"));
const groupedActivity = sqlite.prepare("SELECT 1 FROM pragma_table_info('site_activity') WHERE name = 'country'").get();
if (!groupedActivity) sqlite.exec(await readFile(new URL("../drizzle/0003_grouped_activity.sql", import.meta.url), "utf8"));

const db = {
  prepare(sql) {
    const query = sqlite.prepare(sql);
    return {
      bind(...values) {
        return {
          first: () => query.get(...values),
          all: () => ({ results: query.all(...values) }),
          run: () => ({ meta: query.run(...values) }),
        };
      },
    };
  },
};

const host = process.env.FRIEND_RATING_HOST ?? "127.0.0.1";
const port = Number(process.env.FRIEND_RATING_PORT ?? 4173);
const handle = createHandler(db, Date.now, process.env.FRIEND_RATING_OWNER_EMAIL);
createServer(async (request, response) => {
  try {
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const input = new Request(new URL(request.url, "http://" + request.headers.host), {
      method: request.method,
      headers: request.headers,
      ...(hasBody ? { body: Readable.toWeb(request), duplex: "half" } : {}),
    });
    const result = await handle(input);
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    console.error(error);
    response.writeHead(500).end("Server error");
  }
}).listen(port, host, () => console.log("Friend Rating at http://" + host + ":" + port));
