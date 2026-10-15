import { useState } from "react";
import type { Player, PhonePrivate, StorytellerState } from "../../types";

type EmitFn = (e: string, d?: unknown, ack?: (result: unknown) => void) => void;

function Thread({ player, priv, emit, showAll }: { player: Player; priv: PhonePrivate; emit: EmitFn; showAll: boolean }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const unread = priv.unreadByStoryteller;
  const shown = showAll ? priv.messages.slice(-12) : priv.messages.slice(-Math.max(unread, 1));
  const wantsWord = shown.some((m, i) => m.kind === "word" && i >= shown.length - unread);

  const reply = () =>
    emit("game:phoneReply", { playerId: player.id, text }, (r) => {
      const a = r as { ok?: boolean; message?: string };
      if (a.ok === false) return setErr(a.message ?? "Not sent.");
      setErr(null);
      setText("");
    });

  return (
    <li className={`inbox-thread ${unread ? "unread" : ""}`}>
      <div className="inbox-head">
        <b>
          {player.seat} · {player.name || `Seat ${player.seat}`}
        </b>
        {wantsWord && <span className="inbox-word">would like a word</span>}
        {unread > 0 && (
          <button type="button" className="chip" onClick={() => emit("game:phoneMarkRead", { playerId: player.id })}>
            Mark read
          </button>
        )}
      </div>
      <ul className="inbox-msgs">
        {shown.map((m) => (
          <li key={m.id} className={m.from === "storyteller" ? "from-st" : "from-pl"}>
            <span className="muted">{m.from === "storyteller" ? "You" : player.name || "Player"}:</span>{" "}
            {m.kind === "word" ? <i>asks for a word</i> : m.text}{" "}
            <time className="muted">{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
          </li>
        ))}
      </ul>
      <div className="row inbox-reply">
        <input
          aria-label={`Reply to ${player.name}`}
          placeholder="Reply (only this player sees it)"
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) reply();
          }}
        />
        <button type="button" disabled={!text.trim()} onClick={reply}>
          Reply
        </button>
      </div>
      {err && <p className="warn">{err}</p>}
    </li>
  );
}

/**
 * Player → Storyteller messages. `unreadOnly`: the banner above the tabs (only threads with
 * something new); otherwise every thread, for the Setup tab.
 */
export function PhoneInbox({ state, emit, unreadOnly }: { state: StorytellerState; emit: EmitFn; unreadOnly: boolean }) {
  const ph = state.phones;
  if (!ph?.enabled) return null;
  const threads = state.players
    .filter((p) => !p.leftGame)
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({ p, priv: ph.private[p.id] }))
    .filter(({ priv }) => priv && priv.messages.length > 0 && (!unreadOnly || priv.unreadByStoryteller > 0));
  if (!threads.length) return null;
  const total = threads.reduce((n, t) => n + (t.priv?.unreadByStoryteller ?? 0), 0);
  return (
    <div className={`panel inbox ${unreadOnly ? "inbox-banner" : ""}`} role={unreadOnly ? "status" : undefined}>
      <h2>
        {unreadOnly ? `Message${total === 1 ? "" : "s"} from players` : "Player messages"}
        {total > 0 && <span className="inbox-count">{total}</span>}
      </h2>
      <ul className="inbox-list">
        {threads.map(({ p, priv }) => (
          <Thread key={p.id} player={p} priv={priv!} emit={emit} showAll={!unreadOnly} />
        ))}
      </ul>
    </div>
  );
}
