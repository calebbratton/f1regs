import { getToolInput, getToolOutput, getToolPartState, useAgentChat } from "@cloudflare/ai-chat/react";
import { isToolUIPart, type UIMessage } from "ai";
import { useAgent } from "agents/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";

const EXAMPLES = [
  "Should Antonelli have got a track limits penalty last race?",
  "How many track limits warnings before a driver is penalised?",
  "What penalties can the stewards give for causing a collision?",
  "What happens if a team breaks the cost cap?"
];

// Each browser keeps one conversation; "New chat" clears it.
function sessionId() {
  const fresh = crypto.randomUUID();
  try {
    const saved = localStorage.getItem("f1regs-session");
    if (saved) return saved;
    localStorage.setItem("f1regs-session", fresh);
  } catch {
    // Storage blocked (private mode): the chat just won't survive a reload.
  }
  return fresh;
}

const TOOL_LABELS: Record<string, (input: Record<string, unknown>) => string> = {
  searchDocuments: (i) => `Searched FIA documents for "${i.query ?? ""}"`,
  listRecentEvents: () => "Looked up recent race weekends",
  listEventDocuments: (i) => `Listed documents for ${i.event ?? "the event"}`,
  readDocument: () => "Read a stewards' document"
};

interface Source {
  source: string;
  url: string | null;
  page: number | null;
  article: string | null;
}

/** Documents the assistant actually pulled text from, for the source list. */
function sourcesOf(message: UIMessage): Source[] {
  const seen = new Map<string, Source>();
  for (const part of message.parts) {
    if (!isToolUIPart(part) || getToolPartState(part) !== "complete") continue;
    const output = getToolOutput(part);
    const items = Array.isArray(output) ? output : output ? [output] : [];
    for (const item of items as Record<string, unknown>[]) {
      const title = (item.source ?? item.title) as string | undefined;
      if (!title || !("text" in item)) continue;
      const key = (item.url as string | null) ?? title;
      if (!seen.has(key)) {
        seen.set(key, {
          source: title,
          url: (item.url as string | null) ?? null,
          page: (item.page as number | null) ?? null,
          article: (item.article as string | null) ?? null
        });
      }
    }
  }
  return [...seen.values()];
}

function toolName(part: UIMessage["parts"][number]) {
  return part.type === "dynamic-tool" ? part.toolName : part.type.replace(/^tool-/, "");
}

function MessageView({ message }: { message: UIMessage }) {
  if (message.role === "user") {
    const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return <div className="msg user">{text}</div>;
  }
  const sources = sourcesOf(message);
  return (
    <div className="msg assistant">
      {message.parts.map((part, i) => {
        if (part.type === "text") return <Markdown key={i}>{part.text}</Markdown>;
        if (isToolUIPart(part)) {
          const label = TOOL_LABELS[toolName(part)];
          const input = (getToolInput(part) ?? {}) as Record<string, unknown>;
          const state = getToolPartState(part);
          return (
            <div key={i} className={`tool ${state}`}>
              {state === "error" ? "⚠ " : state === "complete" ? "✓ " : "… "}
              {label ? label(input) : toolName(part)}
            </div>
          );
        }
        return null;
      })}
      {sources.length > 0 && (
        <details className="sources">
          <summary>Sources ({sources.length})</summary>
          <ul>
            {sources.map((s) => (
              <li key={s.url ?? s.source}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.source}
                  </a>
                ) : (
                  s.source
                )}
                {s.article ? `, Art. ${s.article}` : ""}
                {s.page ? `, p. ${s.page}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function App() {
  const [name] = useState(sessionId);
  const agent = useAgent({ agent: "F1RegsAgent", name });
  const { messages, sendMessage, status, stop, clearHistory, error } = useAgentChat({ agent });
  const [input, setInput] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const ask = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendMessage({ role: "user", parts: [{ type: "text", text: trimmed }] });
    setInput("");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  return (
    <div className="app">
      <header>
        <h1>
          Stewards' <span>Room</span>
        </h1>
        {messages.length > 0 && (
          <button type="button" className="ghost" onClick={clearHistory} disabled={busy}>
            New chat
          </button>
        )}
      </header>

      <main>
        {messages.length === 0 ? (
          <section className="intro">
            <h2>Ask the rulebook.</h2>
            <p>
              Questions about the FIA Formula 1 regulations and stewards' decisions, answered with
              citations to the official documents.
            </p>
            <div className="examples">
              {EXAMPLES.map((q) => (
                <button type="button" key={q} onClick={() => ask(q)}>
                  {q}
                </button>
              ))}
            </div>
          </section>
        ) : (
          messages.map((m) => <MessageView key={m.id} message={m} />)
        )}
        {status === "submitted" && <div className="msg assistant thinking">Checking the rules…</div>}
        {error && <div className="msg error">{error.message}</div>}
        <div ref={bottom} />
      </main>

      <form onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Was that a fair five-second penalty?"
          aria-label="Your question"
        />
        {busy ? (
          <button type="button" onClick={() => stop()}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()}>
            Ask
          </button>
        )}
      </form>
      <footer>
        Unofficial fan project, not affiliated with the FIA or Formula 1. Answers can be wrong; the
        linked FIA documents are authoritative.
      </footer>
    </div>
  );
}
