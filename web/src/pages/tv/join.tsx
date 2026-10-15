import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { OakPlaque, TvLabel } from "./chrome";

const LOOPBACK = /^(localhost|127\.|\[?::1\]?$)/;

/** Where phones should open /play: this TV's own address unless it is on localhost, then the server's LAN address. */
function useJoinBase(): string {
  const [base, setBase] = useState(window.location.origin);
  useEffect(() => {
    if (!LOOPBACK.test(window.location.hostname)) return;
    let live = true;
    fetch("/api/config/public")
      .then((r) => r.json())
      .then((c: { joinBase?: string | null }) => {
        if (live && c.joinBase) setBase(c.joinBase);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return base;
}

function useQrSvg(text: string): string {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#1c110aff", light: "#00000000" } })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(""));
    return () => {
      live = false;
    };
  }, [text]);
  return svg;
}

/** Lobby: a parchment card in the right column with the QR, the address and the join code. */
export function PhoneJoinCard({ code }: { code: string }) {
  const base = useJoinBase();
  const url = `${base}/play?c=${encodeURIComponent(code)}`;
  const svg = useQrSvg(url);
  return (
    <section className="tv-gazette tv-join" aria-label="Join on your phone">
      <div className="tv-gazette-frame" aria-hidden />
      <div className="tv-gazette-sheet tv-join-sheet">
        <p className="tv-gazette-kicker">Join on</p>
        <h2 className="tv-gazette-title">Your phone</h2>
        <div className="tv-join-qr" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="tv-join-url">{base.replace(/^https?:\/\//, "")}/play</p>
        <p className="tv-join-code">
          <span>Code</span> {code}
        </p>
      </div>
    </section>
  );
}

/** Day / dusk: a small plaque so late arrivals can still join. */
export function PhoneJoinBadge({ code }: { code: string }) {
  return (
    <OakPlaque className="tv-join-badge">
      <TvLabel>Phones · /play</TvLabel>
      <span className="tv-join-badge-code">{code}</span>
    </OakPlaque>
  );
}
