import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";
import { InfraiError, infrai } from "./infrai.js";
import { cronFor, decideFollowupDueAt } from "./followup_policy.js";

const scheduleBody = z.object({
  appointmentId: z.string().uuid(),
  clinicCode: z.string().regex(/^[A-Z0-9_-]{2,20}$/),
  delayHours: z.number().int().min(1).max(72),
});

const runBody = z.object({ followupId: z.string().uuid() });

export type FollowupRequest = z.infer<typeof scheduleBody>;

type Followup = FollowupRequest & {
  followupId: string;
  jobId: string;
  dueAt: string;
  state: "scheduled" | "sent";
};

const followups = new Map<string, Followup>();

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function scheduleFollowup(input: FollowupRequest): Promise<Followup> {
  const followupId = crypto.randomUUID();
  const dueAt = decideFollowupDueAt(new Date(), input.delayHours);
  const publicUrl = process.env.PUBLIC_BASE_URL;
  if (!publicUrl) throw new Error("PUBLIC_BASE_URL is required");

  const task = new URL("/internal/followups/run", publicUrl);
  task.searchParams.set("followupId", followupId);
  const created = await infrai.cron.create(
    { cron_expr: cronFor(dueAt), task: task.toString() },
    `followup-create-${followupId}`,
  );
  const followup: Followup = {
    ...input,
    followupId,
    jobId: created.job_id,
    dueAt: dueAt.toISOString(),
    state: "scheduled",
  };
  followups.set(followupId, followup);
  return followup;
}

async function runFollowup(followupId: string): Promise<Followup> {
  const followup = followups.get(followupId);
  if (!followup) throw new Error("Follow-up record not found");
  try {
    // The operational event uses opaque identifiers; patient contact data stays in the clinical system.
    console.log(JSON.stringify({ event: "followup.ready", followupId, clinicCode: followup.clinicCode }));
    followup.state = "sent";
    await infrai.cron.delete(followup.jobId, `followup-delete-${followupId}`);
    return followup;
  } catch (error) {
    const exception = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack, followupId }
      : { message: String(error), followupId };
    await infrai.errors.capture(exception, `followup-error-${followupId}`);
    throw error;
  }
}

export const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "POST" && url.pathname === "/follow-ups") {
      const input = scheduleBody.parse(await readJson(request));
      const followup = await scheduleFollowup(input);
      return json(response, 202, followup);
    }
    if (request.method === "POST" && url.pathname === "/internal/followups/run") {
      const input = runBody.parse({ followupId: url.searchParams.get("followupId") });
      return json(response, 200, await runFollowup(input.followupId));
    }
    return json(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof z.ZodError) return json(response, 400, { error: error.flatten() });
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return json(response, status, { error: error.code });
    }
    console.error(error);
    return json(response, 500, { error: "Request could not be completed" });
  }
});

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`Follow-up service listening on ${port}`));
}
