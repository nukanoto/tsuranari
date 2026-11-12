import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  ApiError,
  addResponse,
  createEvent,
  deleteResponse,
  getEvent,
  parseEvent,
  updateEvent,
  updateResponse,
} from "./events";
import { type EventView, type ResponseView, rank, slotKey, UNITS, type Unit } from "./shared";

const BEST_LIMIT = 10;

const INSTRUCTIONS = `tsuranari is a scheduling tool. An event has candidate dates and time slots;
participants answer which slots they can attend.

A slot is written as "YYYY-MM-DD#i", where i is the index into the event's "slots" labels
(for example "2026-11-16#0" is the first slot on 2026-11-16).

Every tool returns the event after the change, so there is no need to call get_event again.
The result includes "url" (share it with humans), "responses", and "best": the slots most of
the selected participants can attend, best first. Pass "with" to get_event to rank slots for
only some participants.`;

const unitKeys = Object.keys(UNITS) as [Unit, ...Unit[]];

const eventRef = z
  .string()
  .describe("Event ID, or the event URL such as https://tsuranari.nukanoto.net/e/<id>");
const responseRef = z.string().describe("Response ID or the participant's exact name");
const slotList = z.array(z.string()).describe('Slots like "2026-11-16#0"');

const eventFields = {
  title: z.string().describe("Event title, up to 100 characters"),
  creator: z.string().describe("Organizer name, up to 50 characters"),
  memo: z.string().describe("Note for participants, up to 1000 characters"),
  start: z.string().describe("First candidate date, YYYY-MM-DD"),
  end: z.string().describe("Last candidate date, YYYY-MM-DD; at most 100 days including start"),
  unit: z.enum(unitKeys).describe(
    Object.entries(UNITS)
      .map(([k, u]) => `${k}: ${u.label}`)
      .join("; "),
  ),
  mode: z
    .enum(["ng", "ok"])
    .describe(
      "How the web form asks: ng = participants mark slots they cannot attend, ok = slots they can attend",
    ),
  excludeWeekends: z.boolean().describe("Skip Saturdays and Sundays"),
};

const answerFields = {
  comment: z.string().optional().describe("Comment, up to 200 characters"),
  available: slotList.optional().describe("Slots the participant CAN attend; all others are not"),
  unavailable: slotList
    .optional()
    .describe("Slots the participant CANNOT attend; all others are fine"),
};

const parseRef = (ref: string) => ref.match(/\/e\/([A-Za-z0-9]+)/)?.[1] ?? ref.trim();

function findResponse(ev: EventView, ref: string): ResponseView {
  const r = ev.responses.find((x) => x.id === ref || x.name === ref);
  if (!r) throw new ApiError(404, `no response matches ${JSON.stringify(ref)}`);
  return r;
}

// Turns "available" or "unavailable" into the stored marks, whose meaning depends on the mode.
function toMarks(
  ev: EventView,
  args: { available?: string[]; unavailable?: string[] },
): string[] | undefined {
  if (args.available && args.unavailable) {
    throw new ApiError(400, "pass either available or unavailable, not both");
  }
  const given = args.available ?? args.unavailable;
  if (!given) return undefined;
  const marksAreAvailable = ev.mode === "ok";
  if ((args.available !== undefined) === marksAreAvailable) return given;
  const all = ev.dates.flatMap((d) => ev.slots.map((_, i) => slotKey(d, i)));
  const unknown = given.find((s) => !all.includes(s));
  if (unknown !== undefined) throw new ApiError(400, `unknown slot: ${JSON.stringify(unknown)}`);
  const excluded = new Set(given);
  return all.filter((s) => !excluded.has(s));
}

async function describe(db: D1Database, origin: string, id: string, only?: string[]) {
  const ev = await getEvent(db, id);
  const chosen = only ? only.map((ref) => findResponse(ev, ref)) : ev.responses;
  return {
    ...ev,
    url: `${origin}/e/${ev.id}`,
    marksMean: ev.mode === "ng" ? "slots the participant cannot attend" : "slots they can attend",
    selected: chosen.map((r) => r.name),
    best: rank(ev, new Set(chosen.map((r) => r.id)), BEST_LIMIT),
  };
}

async function run(fn: () => Promise<unknown>) {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(await fn()) }] };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return { isError: true, content: [{ type: "text" as const, text: err.message }] };
  }
}

function buildServer(db: D1Database, origin: string): McpServer {
  const server = new McpServer(
    { name: "tsuranari", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "create_event",
    {
      description: "Create a scheduling event and return it with its share URL.",
      inputSchema: {
        ...eventFields,
        memo: eventFields.memo.optional(),
        mode: eventFields.mode.default("ng"),
        excludeWeekends: eventFields.excludeWeekends.default(true),
      },
    },
    (args) =>
      run(async () => {
        const id = await createEvent(db, parseEvent(args));
        return describe(db, origin, id);
      }),
  );

  server.registerTool(
    "get_event",
    {
      description:
        "Get an event, all responses, and the best slots. Pass `with` to rank slots for only those participants.",
      inputSchema: {
        event: eventRef,
        with: z.array(responseRef).optional().describe("Participants to include in `best`"),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => run(() => describe(db, origin, parseRef(args.event), args.with)),
  );

  server.registerTool(
    "update_event",
    {
      description:
        "Change an event. Omitted fields stay as they are. Unit and mode cannot change once someone has answered; marks outside a new date range are dropped.",
      inputSchema: {
        event: eventRef,
        title: eventFields.title.optional(),
        creator: eventFields.creator.optional(),
        memo: eventFields.memo.optional(),
        start: eventFields.start.optional(),
        end: eventFields.end.optional(),
        unit: eventFields.unit.optional(),
        mode: eventFields.mode.optional(),
        excludeWeekends: eventFields.excludeWeekends.optional(),
      },
    },
    ({ event, ...patch }) =>
      run(async () => {
        const id = parseRef(event);
        const defined = Object.fromEntries(
          Object.entries(patch).filter(([, v]) => v !== undefined),
        );
        await updateEvent(db, id, defined);
        return describe(db, origin, id);
      }),
  );

  server.registerTool(
    "add_response",
    {
      description:
        "Add a participant's answer. Give either `available` or `unavailable`; omitting both means available at every slot.",
      inputSchema: {
        event: eventRef,
        name: z.string().describe("Unique within the event"),
        ...answerFields,
      },
    },
    (args) =>
      run(async () => {
        const id = parseRef(args.event);
        const ev = await getEvent(db, id);
        const marks = toMarks(ev, args) ?? toMarks(ev, { unavailable: [] });
        await addResponse(db, id, { name: args.name, comment: args.comment, marks });
        return describe(db, origin, id);
      }),
  );

  server.registerTool(
    "update_response",
    {
      description:
        "Change a participant's answer. Omitted fields stay as they are; `available` or `unavailable` replaces all slots.",
      inputSchema: {
        event: eventRef,
        response: responseRef,
        name: z.string().optional().describe("New name"),
        ...answerFields,
      },
    },
    (args) =>
      run(async () => {
        const id = parseRef(args.event);
        const ev = await getEvent(db, id);
        const r = findResponse(ev, args.response);
        await updateResponse(db, id, r.id, {
          name: args.name ?? r.name,
          comment: args.comment ?? r.comment,
          marks: toMarks(ev, args) ?? r.marks,
        });
        return describe(db, origin, id);
      }),
  );

  server.registerTool(
    "delete_response",
    {
      description: "Delete a participant's answer.",
      inputSchema: { event: eventRef, response: responseRef },
      annotations: { destructiveHint: true },
    },
    (args) =>
      run(async () => {
        const id = parseRef(args.event);
        const r = findResponse(await getEvent(db, id), args.response);
        await deleteResponse(db, id, r.id);
        return describe(db, origin, id);
      }),
  );

  return server;
}

// Stateless: every request builds its own server, so no session storage is needed.
export async function handleMcp(req: Request, db: D1Database): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await buildServer(db, new URL(req.url).origin).connect(transport);
  return transport.handleRequest(req);
}
