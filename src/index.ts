import { Hono } from "hono";
import {
  ApiError,
  addResponse,
  createEvent,
  deleteResponse,
  getEvent,
  parseEvent,
  updateResponse,
} from "./events";
import { handleMcp } from "./mcp";
import { eventPage } from "./og";

type Env = { DB: D1Database; ASSETS: Fetcher };

type Body = Record<string, unknown> | null;

const readJson = (req: Request): Promise<Body> => req.json<Body>().catch(() => null);

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.message }, err.status);
  throw err;
});

app.post("/api/events", async (c) => {
  const id = await createEvent(c.env.DB, parseEvent(await readJson(c.req.raw)));
  return c.json({ id }, 201);
});

app.get("/api/events/:id", async (c) => c.json(await getEvent(c.env.DB, c.req.param("id"))));

app.post("/api/events/:id/responses", async (c) => {
  const id = await addResponse(c.env.DB, c.req.param("id"), await readJson(c.req.raw));
  return c.json({ id }, 201);
});

app.put("/api/events/:id/responses/:rid", async (c) => {
  const rid = c.req.param("rid");
  await updateResponse(c.env.DB, c.req.param("id"), rid, await readJson(c.req.raw));
  return c.json({ id: rid });
});

app.delete("/api/events/:id/responses/:rid", async (c) => {
  await deleteResponse(c.env.DB, c.req.param("id"), c.req.param("rid"));
  return c.body(null, 204);
});

app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

app.all("/mcp", (c) => handleMcp(c.req.raw, c.env.DB));

app.get("/e/:id", (c) => eventPage(c.env.DB, c.env.ASSETS, new URL(c.req.url), c.req.param("id")));

export default app;
