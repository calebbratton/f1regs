import { routeAgentRequest } from "agents";
import { ingest, ingestPayload } from "./documents";

export { F1RegsAgent } from "./agent";

function authorized(request: Request, env: Env) {
  const expected = env.INGEST_TOKEN;
  const given = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
  if (!expected || given.length !== expected.length) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  return crypto.subtle.timingSafeEqual(a, b);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/ingest" && request.method === "POST") {
      if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });
      const parsed = ingestPayload.safeParse(await request.json());
      if (!parsed.success) {
        return Response.json({ error: parsed.error.issues }, { status: 400 });
      }
      return Response.json(await ingest(env, parsed.data));
    }

    return (
      (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
