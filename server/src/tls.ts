import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { generate } from "selfsigned";
import { lanAddresses } from "./join-info.js";
import { ROOT } from "./persistence.js";

/** Gitignored. BOTC_TLS_DIR moves it (tests). */
export const TLS_DIR = process.env.BOTC_TLS_DIR || join(ROOT, "config", "tls");
const VALID_DAYS = 397;
const RENEW_WITHIN_DAYS = 30;

export type TlsMeta = { ips: string[]; dns: string[]; notAfter: string; fingerprint: string; createdAt: string };
export type TlsMaterial = { key: string; cert: string; meta: TlsMeta; created: boolean; reason: string | null };

function readMeta(dir: string): TlsMeta | null {
  try {
    const m = JSON.parse(readFileSync(join(dir, "botc-tls.json"), "utf8")) as TlsMeta;
    return Array.isArray(m.ips) && typeof m.notAfter === "string" ? m : null;
  } catch {
    return null;
  }
}

/** Addresses the certificate must cover: loopback, the real LAN adapters and an explicit bind IP. */
export function requiredIps(host: string): string[] {
  const ips = new Set(["127.0.0.1", ...lanAddresses().primary.map((a) => a.address)]);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && host !== "0.0.0.0") ips.add(host);
  return [...ips];
}

/**
 * Every IPv4 address a new certificate covers. Virtual adapters (Hyper-V, WSL, VPNs) are included
 * but never force a renewal on their own: Windows can give them a new address at every boot.
 */
export function wantedIps(host: string): string[] {
  return [...new Set([...requiredIps(host), ...lanAddresses().other.map((a) => a.address)])];
}

/** Why the saved certificate can't be used as it is (null = reuse it). */
export function renewReason(meta: TlsMeta | null, ips: string[], now = new Date()): string | null {
  if (!meta) return "no certificate yet";
  const missing = ips.filter((ip) => !meta.ips.includes(ip));
  if (missing.length) return `new network address ${missing.join(", ")}`;
  const left = (Date.parse(meta.notAfter) - now.getTime()) / 86_400_000;
  if (!(left > RENEW_WITHIN_DAYS)) return "it expires soon";
  return null;
}

/**
 * The self-signed certificate for HTTPS mode: reused while it covers every address of this PC and
 * has a month left; otherwise a new one is made (devices then accept the warning once more).
 */
export async function ensureCertificate(host: string, dir = TLS_DIR, now = new Date()): Promise<TlsMaterial> {
  const keyPath = join(dir, "botc.key");
  const certPath = join(dir, "botc.crt");
  const ips = wantedIps(host);
  const meta = existsSync(keyPath) && existsSync(certPath) ? readMeta(dir) : null;
  const reason = renewReason(meta, requiredIps(host), now);
  if (!reason && meta) {
    return { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8"), meta, created: false, reason: null };
  }
  const allIps = [...new Set([...ips, ...(meta?.ips ?? [])])];
  const dns = [...new Set(["localhost", hostname()].filter(Boolean))];
  const notAfter = new Date(now.getTime() + VALID_DAYS * 86_400_000);
  const pems = await generate([{ name: "commonName", value: "BOTC Companion (this PC)" }], {
    keySize: 2048,
    algorithm: "sha256",
    notBeforeDate: new Date(now.getTime() - 60_000),
    notAfterDate: notAfter,
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
      { name: "extKeyUsage", serverAuth: true },
      {
        name: "subjectAltName",
        altNames: [...dns.map((value) => ({ type: 2 as const, value })), ...allIps.map((ip) => ({ type: 7 as const, ip }))],
      },
    ],
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(keyPath, pems.private, { mode: 0o600 });
  writeFileSync(certPath, pems.cert);
  const next: TlsMeta = {
    ips: allIps,
    dns,
    notAfter: notAfter.toISOString(),
    fingerprint: pems.fingerprint,
    createdAt: now.toISOString(),
  };
  writeFileSync(join(dir, "botc-tls.json"), JSON.stringify(next, null, 2) + "\n");
  return { key: pems.private, cert: pems.cert, meta: next, created: true, reason };
}
