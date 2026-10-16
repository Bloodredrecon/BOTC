import { useEffect, useRef, useState } from "react";
import { playerPhotoUrl, resizeToJpegDataUrl } from "./photo";

type Emit = (event: string, data?: unknown, ack?: (r: unknown) => void) => void;
type Ack = { ok?: boolean; error?: string; name?: string; photoRev?: number };

/** Name + face photo for a claimed phone (pending or approved). */
export function ProfileEditor({
  emit,
  playerId,
  name,
  photoRev,
  compact,
}: {
  emit: Emit;
  playerId: string;
  name: string;
  photoRev: number | null;
  /** Tighter layout for the “waiting for approval” card. */
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editing = useRef(false);
  const url = playerPhotoUrl(playerId, photoRev);

  useEffect(() => {
    if (!editing.current) setDraft(name);
  }, [name]);

  const saveName = () => {
    editing.current = false;
    const next = draft.trim();
    if (!next || next === name) return;
    setBusy(true);
    setError(null);
    setNote(null);
    emit("player:setName", { name: next }, (r) => {
      const a = r as Ack;
      setBusy(false);
      if (!a.ok) return setError(a.error ?? "Could not save your name.");
      setDraft(a.name ?? next);
      setNote("Name saved.");
    });
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const image = await resizeToJpegDataUrl(file);
      emit("player:setPhoto", { image }, (r) => {
        const a = r as Ack;
        setBusy(false);
        if (!a.ok) return setError(a.error ?? "Could not upload that photo.");
        setNote("Photo saved.");
      });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Could not use that photo.");
    }
  };

  const clearPhoto = () => {
    if (!photoRev) return;
    setBusy(true);
    setError(null);
    setNote(null);
    emit("player:clearPhoto", {}, (r) => {
      const a = r as Ack;
      setBusy(false);
      if (!a.ok) return setError(a.error ?? "Could not remove the photo.");
      setNote("Photo removed.");
    });
  };

  return (
    <div className={`play-profile ${compact ? "compact" : ""}`}>
      <div className="play-profile-face">
        {url ? (
          <img src={url} alt="" className="play-avatar" />
        ) : (
          <span className="play-avatar play-avatar-empty" aria-hidden>
            {(name || "?").slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="play-profile-photo-actions">
          <button type="button" className="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
            {photoRev ? "Change photo" : "Add photo"}
          </button>
          {photoRev ? (
            <button type="button" className="ghost" disabled={busy} onClick={clearPhoto}>
              Remove
            </button>
          ) : null}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="user"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = "";
            void onFile(f);
          }}
        />
      </div>
      <label className="play-profile-name">
        <span className="play-muted">Your name</span>
        <input
          value={draft}
          maxLength={32}
          autoComplete="nickname"
          disabled={busy}
          onFocus={() => {
            editing.current = true;
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      </label>
      {!compact && (
        <button type="button" className="primary play-wide" disabled={busy || !draft.trim() || draft.trim() === name} onClick={saveName}>
          Save name
        </button>
      )}
      {note && (
        <p className="play-muted" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="play-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
