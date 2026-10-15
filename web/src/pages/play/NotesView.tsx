import { useEffect, useRef, useState } from "react";
import type { PlayerState } from "../../types";
import {
  EMPTY_NOTE,
  exportNotes,
  factsFromLog,
  loadNotes,
  mergeFacts,
  parseNotesFile,
  saveNotes,
  type Align,
  type NotesDoc,
  type SeatNote,
} from "./notes";

const NEXT_ALIGN: Record<Align, Align> = { "": "good", good: "evil", evil: "" };
const ALIGN_LABEL: Record<Align, string> = { "": "?", good: "Good", evil: "Evil" };

/** Claims grid + free-text pad, kept only in this phone's storage for this game and seat. */
export function NotesView({ state }: { state: PlayerState }) {
  const { gameId } = state;
  const seat = state.me.seat;
  const [doc, setDoc] = useState<NotesDoc>(() => loadNotes(gameId, seat));
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDoc(loadNotes(gameId, seat)), [gameId, seat]);

  useEffect(() => {
    setDoc((d) => {
      const merged = mergeFacts(d, factsFromLog(state));
      if (merged !== d) saveNotes(merged);
      return merged;
    });
  }, [state.publicLog, state.players, state.dayNumber]);

  const update = (fn: (d: NotesDoc) => NotesDoc) =>
    setDoc((d) => {
      const next = fn(d);
      saveNotes(next);
      return next;
    });
  const setSeat = (playerId: string, patch: Partial<SeatNote>) =>
    update((d) => ({ ...d, seats: { ...d.seats, [playerId]: { ...(d.seats[playerId] ?? EMPTY_NOTE), ...patch } } }));

  const seated = state.players.filter((p) => !p.leftGame).sort((a, b) => a.seat - b.seat);
  const chars = [...state.sheet.characters, ...state.sheet.travellers.map((t) => ({ ...t, team: "traveller" as const }))];

  const doExport = () => {
    const blob = new Blob([exportNotes(doc)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `botc-notes-seat${seat}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setMsg("Saved a copy of your notes.");
  };

  const doImport = async (file: File) => {
    const parsed = parseNotesFile(await file.text(), gameId, seat);
    if (!parsed) return setMsg("That file isn't a notes file from this app.");
    if (!parsed.sameGame && !confirm("These notes are from a different game. Load them anyway?")) return;
    update(() => parsed.doc);
    setMsg("Notes loaded.");
  };

  return (
    <div className="play-stack">
      <p className="play-muted play-note-intro">Only on this phone. The Storyteller and the server never see your notes.</p>

      <ol className="play-notes">
        {seated.map((p) => {
          const n = doc.seats[p.id] ?? EMPTY_NOTE;
          const facts = doc.facts.filter((f) => f.playerId === p.id);
          const isMe = p.id === state.me.playerId;
          return (
            <li key={p.id} className={`play-card play-note ${p.alive ? "" : "dead"} ${n.align}`}>
              <div className="play-note-head">
                <span className="play-seat-n">{p.seat}</span>
                <span className="play-seat-name">
                  {p.name || `Seat ${p.seat}`}
                  {isMe && <em> (you)</em>}
                  {!p.alive && <small> · dead</small>}
                </span>
                <button
                  type="button"
                  className={`play-align ${n.align}`}
                  aria-label={`Alignment guess for ${p.name}: ${ALIGN_LABEL[n.align]}`}
                  onClick={() => setSeat(p.id, { align: NEXT_ALIGN[n.align] })}
                >
                  {ALIGN_LABEL[n.align]}
                </button>
              </div>
              <select aria-label={`${p.name} claims`} value={n.claim} onChange={(e) => setSeat(p.id, { claim: e.target.value })}>
                <option value="">{isMe ? "What I'm claiming…" : "Claims to be…"}</option>
                {chars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Notes on ${p.name}`}
                placeholder="Notes"
                value={n.text}
                maxLength={2000}
                onChange={(e) => setSeat(p.id, { text: e.target.value })}
              />
              {facts.length > 0 && (
                <ul className="play-facts">
                  {facts.map((f) => (
                    <li key={f.key}>{f.text}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      <label className="play-card play-pad">
        <span className="play-kicker">My notes</span>
        <textarea rows={6} value={doc.pad} maxLength={20000} onChange={(e) => update((d) => ({ ...d, pad: e.target.value }))} />
      </label>

      <div className="play-alt">
        <button type="button" className="ghost" onClick={doExport}>
          Save a copy
        </button>
        <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
          Load a copy
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            if (confirm("Clear all your notes for this game?")) update((d) => ({ ...d, seats: {}, pad: "" }));
          }}
        >
          Clear notes
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
            e.target.value = "";
          }}
        />
      </div>
      {msg && <p className="play-muted play-note-msg">{msg}</p>}
    </div>
  );
}
