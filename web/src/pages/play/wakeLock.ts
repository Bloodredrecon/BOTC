import { useEffect, useState } from "react";

export type WakeState = "on" | "off" | "unsupported";

const supported = () => typeof navigator !== "undefined" && "wakeLock" in navigator && window.isSecureContext;

/**
 * Keeps the screen on while `wanted` (only over HTTPS: the Screen Wake Lock API needs a secure page).
 * The browser drops the lock when the page is hidden, so it is taken again when the page comes back.
 */
export function useWakeLock(wanted: boolean): WakeState {
  const [state, setState] = useState<WakeState>(() => (supported() ? "off" : "unsupported"));
  useEffect(() => {
    if (!supported()) {
      setState("unsupported");
      return;
    }
    if (!wanted) {
      setState("off");
      return;
    }
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    let pending = false;
    const acquire = async () => {
      if (cancelled || lock || pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const l = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void l.release();
          return;
        }
        lock = l;
        setState("on");
        l.addEventListener("release", () => {
          lock = null;
          if (!cancelled) setState("off");
        });
      } catch {
        setState("off");
      } finally {
        pending = false;
      }
    };
    void acquire();
    const onVisible = () => void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
      lock = null;
    };
  }, [wanted]);
  return state;
}
