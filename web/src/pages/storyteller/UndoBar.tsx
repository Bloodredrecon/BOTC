import { useState } from "react";
import type { UndoState } from "../../socket";

type EmitFn = (e: string, d?: unknown, ack?: (result: unknown) => void) => void;

/** "Undo: <last action>" — asks first, names what will be undone, shows what the server said. */
export function UndoBar({ undo, emit }: { undo: UndoState; emit: EmitFn }) {
  const [result, setResult] = useState<string | null>(null);
  if (!undo.last && !result) return null;

  function run() {
    if (!undo.last) return;
    if (!confirm(`Undo "${undo.last.label}"?\n\nThe game goes back to just before it. Sounds and lights are not replayed.`)) return;
    emit("game:undo", {}, (r) => {
      const res = r as { ok: boolean; message?: string; error?: string };
      setResult(res.ok ? null : (res.message ?? res.error ?? "Undo failed."));
    });
  }

  return (
    <div className="undo-bar">
      {undo.last && (
        <button type="button" onClick={run} title={undo.last.label}>
          ↶ Undo
        </button>
      )}
      <span className="undo-label">
        {result ?? (undo.last ? `${undo.last.label}${undo.count > 1 ? ` (${undo.count} steps)` : ""}` : "")}
      </span>
    </div>
  );
}
