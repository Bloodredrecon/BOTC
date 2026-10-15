import { useEffect, useState } from "react";
import type { PlayerState } from "../../types";

type Emit = (event: string, data?: unknown, ack?: (r: unknown) => void) => void;

const MAX = 280;

export function seenKey(state: PlayerState): string {
  return `botc.msgseen.${state.gameId}.${state.me.playerId}`;
}

/** Storyteller replies this phone hasn't shown yet (for the tab badge). */
export function unreadReplies(state: PlayerState): number {
  const seen = Number(localStorage.getItem(seenKey(state)) ?? 0);
  return state.me.messages.filter((m) => m.from === "storyteller" && m.at > seen).length;
}

/** Questions and "request a word" to the Storyteller only, and their replies. */
export function MessagesView({ state, emit }: { state: PlayerState; emit: Emit }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const messages = state.me.messages;
  const lastAt = messages.at(-1)?.at ?? 0;

  useEffect(() => {
    if (lastAt) localStorage.setItem(seenKey(state), String(lastAt));
  }, [lastAt, state]);

  const send = (kind: "question" | "word") => {
    setBusy(true);
    setNote(null);
    emit("player:message", { kind, text: kind === "question" ? text : "" }, (r) => {
      const a = r as { ok: boolean; error?: string };
      setBusy(false);
      if (!a.ok) return setNote(a.error ?? "Not sent.");
      if (kind === "question") setText("");
      setNote(kind === "word" ? "The Storyteller knows you'd like a word." : "Sent to the Storyteller.");
    });
  };

  return (
    <div className="play-stack">
      <p className="play-muted">Only the Storyteller sees these. Other players never do.</p>
      <button type="button" className="play-word" disabled={busy} onClick={() => send("word")}>
        Request a word with the Storyteller
      </button>

      {messages.length > 0 && (
        <ol className="play-thread" aria-label="Messages">
          {messages.map((m) => (
            <li key={m.id} className={m.from === "storyteller" ? "from-st" : "from-me"}>
              <span className="play-thread-who">{m.from === "storyteller" ? "Storyteller" : m.kind === "word" ? "You asked for a word" : "You"}</span>
              {m.kind !== "word" && <span className="play-thread-text">{m.text}</span>}
              <time>{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
            </li>
          ))}
        </ol>
      )}

      <label className="play-card play-pad">
        <span className="play-kicker">Ask a question</span>
        <textarea rows={3} maxLength={MAX} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Does the Monk protect from the Slayer?" />
        <span className="play-count">
          {text.length}/{MAX}
        </span>
        <button type="button" className="primary play-wide" disabled={busy || !text.trim()} onClick={() => send("question")}>
          Send
        </button>
      </label>
      {note && (
        <p className="play-muted" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
