import { networkInterfaces } from "node:os";
import qrcode from "qrcode-terminal";
import { DEFAULT_PIN } from "./pin-guard.js";

export type LanAddress = { iface: string; address: string };

const VIRTUAL_IFACE =
  /vEthernet|WSL|Hyper-V|VirtualBox|VMware|VMnet|Docker|Loopback|Tailscale|ZeroTier|Hamachi|VPN|TAP-|Npcap|Bluetooth/i;

function isPrivateLan(ip: string): boolean {
  return (
    ip.startsWith("192.168.") ||
    ip.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

/** IPv4, non-internal addresses: likely-real adapters first, virtual/link-local ones under `other`. */
export function lanAddresses(): { primary: LanAddress[]; other: LanAddress[] } {
  const primary: LanAddress[] = [];
  const other: LanAddress[] = [];
  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const entry = { iface, address: a.address };
      if (VIRTUAL_IFACE.test(iface) || a.address.startsWith("169.254.")) other.push(entry);
      else primary.push(entry);
    }
  }
  const rank = (e: LanAddress) => (e.address.startsWith("192.168.") ? 0 : isPrivateLan(e.address) ? 1 : 2);
  primary.sort((a, b) => rank(a) - rank(b));
  return { primary, other };
}

function isWildcard(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "";
}

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

/** Base URLs (no trailing slash) that other devices can use, best first. */
export type Scheme = "http" | "https";

export function joinBaseUrls(host: string, port: number, scheme: Scheme = "http"): { main: string[]; other: string[] } {
  if (isLoopback(host)) return { main: [], other: [] };
  if (!isWildcard(host)) return { main: [`${scheme}://${host}:${port}`], other: [] };
  const { primary, other } = lanAddresses();
  return {
    main: primary.map((a) => `${scheme}://${a.address}:${port}`),
    other: other.map((a) => `${scheme}://${a.address}:${port} (${a.iface})`),
  };
}

export function formatJoinInfo(opts: {
  host: string;
  port: number;
  pin: string;
  title?: string;
  scheme?: Scheme;
}): string {
  const { host, port, pin } = opts;
  const scheme = opts.scheme ?? "http";
  const lines: string[] = [];
  const bar = "=".repeat(64);
  lines.push("", bar, `  ${opts.title ?? `BOTC Companion is running on port ${port}`}`, bar);

  const urls = joinBaseUrls(host, port, scheme);
  if (isLoopback(host)) {
    lines.push(
      `  Host is ${host}: ONLY this PC can connect.`,
      "  To let the TV and phones join, set host to 0.0.0.0 (launcher > Settings).",
      `  This PC: ${scheme}://localhost:${port}/tv   ${scheme}://localhost:${port}/storyteller`,
    );
  } else if (urls.main.length === 0) {
    lines.push(
      "  No LAN network address found. Is this PC connected to Wi-Fi/Ethernet?",
      `  This PC: ${scheme}://localhost:${port}/tv`,
    );
  } else {
    const best = urls.main[0];
    lines.push(
      `  TV:          ${best}/tv`,
      `  Storyteller: ${best}/storyteller`,
      `  Storyteller PIN: ${pin}`,
    );
    if (urls.main.length > 1) {
      lines.push("  Also reachable at:");
      for (const u of urls.main.slice(1)) lines.push(`    ${u}`);
    }
  }
  if (pin === DEFAULT_PIN) {
    lines.push(
      `  WARNING: the Storyteller PIN is still the default (${DEFAULT_PIN}). Anyone on this network`,
      "  could open the grimoire. Change it: BOTC.bat > Settings > Storyteller PIN.",
    );
  }
  if (urls.other.length > 0) {
    lines.push("  Other (virtual adapters, usually not reachable from the TV/phone):");
    for (const u of urls.other) lines.push(`    ${u}`);
  }
  if (isWildcard(host) && urls.main.length > 0) lines.push(`  On this PC: ${scheme}://localhost:${port}`);
  if (scheme === "https") {
    lines.push(
      "  HTTPS is on (self-signed): each phone, tablet and the TV shows a certificate warning",
      "  the first time. Choose Advanced / Show details > continue to this site.",
    );
  }

  if (urls.main.length > 0) {
    let qr = "";
    qrcode.generate(`${urls.main[0]}/`, { small: true }, (q) => {
      qr = q;
    });
    lines.push("", `  Scan to open ${urls.main[0]}/ :`, qr);
  }
  lines.push(bar, "");
  return lines.join("\n");
}
