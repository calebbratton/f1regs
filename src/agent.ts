import { AIChatAgent } from "@cloudflare/ai-chat";
import { convertToModelMessages, isStepCount, streamText, tool } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { listEventDocuments, listRecentEvents, readDocument } from "./documents";
import { systemPrompt } from "./prompt";
import { searchDocuments } from "./search";

// Older turns are dropped from the prompt to keep each request inside the
// model's context window and the free Workers AI allowance.
const MAX_HISTORY = 12;

export class F1RegsAgent extends AIChatAgent<Env> {
  async onChatMessage() {
    const env = this.env;
    const workersai = createWorkersAI({ binding: env.AI });

    const tools = {
      searchDocuments: tool({
        description:
          "Hybrid keyword + semantic search over the FIA F1 regulations and per-event FIA documents (stewards' decisions, event notes). Returns the most relevant passages with their source.",
        inputSchema: z.object({
          query: z
            .string()
            .describe("What to look for, e.g. 'track limits lap time deleted' or 'Article 54.3'"),
          kind: z
            .enum(["regulation", "event", "any"])
            .default("any")
            .describe("'regulation' for the rulebooks, 'event' for race-weekend documents"),
          event: z
            .string()
            .optional()
            .describe("Exact event name from listRecentEvents, to search one race weekend only")
        }),
        execute: async ({ query, kind, event }) => {
          const hits = await searchDocuments(env, query, {
            kind: kind === "any" ? undefined : kind,
            event
          });
          return hits.map((h) => ({
            source: h.title,
            event: h.event,
            article: h.article,
            page: h.page,
            url: h.url,
            docId: h.docId,
            text: h.text
          }));
        }
      }),
      listRecentEvents: tool({
        description:
          "List the most recent race weekends that have FIA documents, newest first. Use it to resolve 'last race' or a Grand Prix name to an exact event name.",
        inputSchema: z.object({ limit: z.number().int().min(1).max(30).default(8) }),
        execute: async ({ limit }) => listRecentEvents(env, limit)
      }),
      listEventDocuments: tool({
        description:
          "List every FIA document published for one event (decisions, summonses, event notes), with ids for readDocument.",
        inputSchema: z.object({ event: z.string().describe("Exact event name") }),
        execute: async ({ event }) => listEventDocuments(env, event)
      }),
      readDocument: tool({
        description:
          "Read the full text of one document (e.g. a stewards' decision) by its docId.",
        inputSchema: z.object({ docId: z.string() }),
        execute: async ({ docId }) =>
          (await readDocument(env, docId)) ?? { error: `No document with id ${docId}` }
      })
    };

    const result = streamText({
      model: workersai(env.CHAT_MODEL),
      system: systemPrompt(new Date().toISOString().slice(0, 10)),
      messages: await convertToModelMessages(this.messages.slice(-MAX_HISTORY)),
      tools,
      stopWhen: isStepCount(8)
    });

    return result.toUIMessageStreamResponse({
      onError: (error) => {
        console.error(error);
        const message = error instanceof Error ? error.message : String(error);
        // Workers AI returns 429 / "capacity" errors once the free daily
        // allowance is spent.
        return /429|neuron|quota|capacity|rate limit/i.test(message)
          ? "The site has used up its free AI allowance for today. Please try again later."
          : "Sorry, something went wrong answering that. Please try again.";
      }
    });
  }
}
