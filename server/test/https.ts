/**
 * Optional HTTPS: the self-signed certificate (covers this PC's addresses, reused while valid,
 * renewed for a new address or near expiry), a real server over TLS (verified against that
 * certificate), Socket.io over wss, and plain HTTP staying the default with no certificate made.
 * Run: cd server && npx tsx test/https.ts
 */
import { createPrivateKey, X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BOTC_SESSION_PATH = join(mkdtempSync(join(tmpdir(), "botc-https-")), "session.json");

const { count, httpsGet, runAsyncCases, startServer, storyteller, until } = await import("./_server.js");
const { ensureCertificate, renewReason, requiredIps, wantedIps } = await import("../src/tls.js");
const { formatJoinInfo, joinBaseUrls, lanAddresses, publicBaseUrl } = await import("../src/join-info.js");
const { ROOT } = await import("../src/persistence.js");

const PIN = "52719384";
const stops: (() => void)[] = [];

const cases: import("./_server.js").AsyncCase[] = [
  {
    name: "Certificate: loopback, localhost and every LAN address of this PC; matches its key; reused while valid; renewed for a new address or near expiry",
    run: async () => {
      const dir = mkdtempSync(join(tmpdir(), "botc-tls-"));
      const first = await ensureCertificate("0.0.0.0", dir);
      if (!first.created) return "first call did not create a certificate";
      const x = new X509Certificate(first.cert);
      const san = x.subjectAltName ?? "";
      for (const ip of wantedIps("0.0.0.0")) if (!san.includes(`IP Address:${ip}`)) return `SAN misses ${ip}: ${san}`;
      if (!san.includes("DNS:localhost")) return `SAN misses localhost: ${san}`;
      if (x.ca) return "certificate is a CA";
      if (!x.checkPrivateKey(createPrivateKey(first.key))) return "key does not match the certificate";
      const days = (Date.parse(x.validTo) - Date.now()) / 86_400_000;
      if (days < 390 || days > 398) return `valid for ${days.toFixed(1)} days`;
      const again = await ensureCertificate("0.0.0.0", dir);
      if (again.created || again.meta.fingerprint !== first.meta.fingerprint) return "certificate not reused";
      const ips = wantedIps("0.0.0.0");
      if (!/new network address 10\.99\.99\.99/.test(renewReason(first.meta, [...ips, "10.99.99.99"]) ?? "")) return "new address not noticed";
      const virtual = lanAddresses().other.map((a) => a.address);
      if (requiredIps("0.0.0.0").some((ip) => virtual.includes(ip))) return "a virtual adapter address forces renewal";
      if (!requiredIps("10.1.2.3").includes("10.1.2.3")) return "an explicit bind address is not required";
      const metaPath = join(dir, "botc-tls.json");
      const trimmed = { ...first.meta, ips: first.meta.ips.filter((ip) => !virtual.includes(ip)) };
      writeFileSync(metaPath, JSON.stringify(trimmed));
      const afterVirtualChange = await ensureCertificate("0.0.0.0", dir);
      if (afterVirtualChange.created) return "renewed only because a virtual adapter address changed";
      writeFileSync(metaPath, JSON.stringify(first.meta));
      const later = new Date(Date.now() + 380 * 86_400_000);
      if (!/expires/.test(renewReason(first.meta, ips, later) ?? "")) return "near expiry not noticed";
      const renewed = await ensureCertificate("0.0.0.0", dir, later);
      if (!renewed.created || renewed.meta.fingerprint === first.meta.fingerprint) return "near-expiry certificate not renewed";
      for (const f of ["botc.key", "botc.crt", "botc-tls.json"]) if (!existsSync(join(dir, f))) return `missing ${f}`;
      return null;
    },
  },
  {
    name: "Join addresses follow the scheme (QR, TV join card base, launcher printout)",
    run: async () => {
      const prevPublic = process.env.BOTC_PUBLIC_URL;
      delete process.env.BOTC_PUBLIC_URL;
      try {
        const lan = lanAddresses().primary;
        const urls = joinBaseUrls("0.0.0.0", 3847, "https");
        if (lan.length && !urls.main.every((u) => u.startsWith("https://"))) return `main ${urls.main}`;
        if (joinBaseUrls("192.168.1.20", 3847, "https").main[0] !== "https://192.168.1.20:3847") return "specific host";
        if (joinBaseUrls("192.168.1.20", 3847).main[0] !== "http://192.168.1.20:3847") return "http stays the default";
        const text = formatJoinInfo({ host: "127.0.0.1", port: 3847, pin: "9999", scheme: "https" });
        if (!text.includes("https://localhost:3847/tv") || text.includes("http://localhost")) return "printout scheme";
        return null;
      } finally {
        if (prevPublic === undefined) delete process.env.BOTC_PUBLIC_URL;
        else process.env.BOTC_PUBLIC_URL = prevPublic;
      }
    },
  },
  {
    name: "BOTC_PUBLIC_URL wins for join/QR; path prefixes are rejected",
    run: async () => {
      const prevPublic = process.env.BOTC_PUBLIC_URL;
      try {
        process.env.BOTC_PUBLIC_URL = "https://botc.danazonprime.co.uk/";
        if (publicBaseUrl() !== "https://botc.danazonprime.co.uk") return "strip trailing slash";
        if (joinBaseUrls("192.168.1.20", 3847).main[0] !== "https://botc.danazonprime.co.uk") return "public overrides host";
        if (!joinBaseUrls("192.168.1.20", 3847).other.includes("http://192.168.1.20:3847")) return "LAN kept in other";
        process.env.BOTC_PUBLIC_URL = "https://danazonprime.co.uk/botc";
        if (publicBaseUrl() !== null) return "path prefix must be rejected";
        return null;
      } finally {
        if (prevPublic === undefined) delete process.env.BOTC_PUBLIC_URL;
        else process.env.BOTC_PUBLIC_URL = prevPublic;
      }
    },
  },
  {
    name: "HTTPS server: TLS checks out against the generated certificate for 127.0.0.1; plain HTTP is refused; Storyteller over wss; /play served",
    run: async () => {
      const tlsDir = mkdtempSync(join(tmpdir(), "botc-tls-srv-"));
      const srv = await startServer({ BOTC_HTTPS: "1", BOTC_TLS_DIR: tlsDir, BOTC_PIN: PIN });
      stops.push(srv.stop);
      const ca = readFileSync(join(tlsDir, "botc.crt"), "utf8");
      const health = await httpsGet(`https://127.0.0.1:${srv.port}/api/health`, { ca });
      if (health.status !== 200 || JSON.parse(health.body).scheme !== "https") return `health ${health.status} ${health.body}`;
      let untrusted: string | null = null;
      try {
        await httpsGet(`https://127.0.0.1:${srv.port}/api/health`, {});
      } catch (err) {
        untrusted = String((err as NodeJS.ErrnoException).code ?? err);
      }
      if (!untrusted || !/SELF_SIGNED|CERT/i.test(untrusted)) return `an unknown client trusted it: ${untrusted}`;
      let plain = "answered";
      try {
        const r = await fetch(`http://127.0.0.1:${srv.port}/api/health`);
        plain = `status ${r.status}`;
      } catch {
        plain = "refused";
      }
      if (plain !== "refused" && plain !== "status 400") return `plain HTTP ${plain}`;
      const play = await httpsGet(`https://127.0.0.1:${srv.port}/play`, { ca });
      if (play.status !== 200 || !/<html/i.test(play.body)) return `/play ${play.status}`;
      const st = await storyteller(srv.port, PIN, { ca });
      await until(() => count(st, "state:storyteller") > 0, "storyteller state over wss");
      st.socket.disconnect();
      if (!/self-signed certificate/.test(srv.output())) return "no certificate line in the server output";
      srv.stop();
      return null;
    },
  },
  {
    name: "Default stays HTTP: shipped config is off, no certificate is made, health says http",
    run: async () => {
      const shipped = JSON.parse(readFileSync(join(ROOT, "config", "default.json"), "utf8")) as { https?: unknown };
      if (shipped.https !== false) return `config/default.json https is ${String(shipped.https)}`;
      const tlsDir = join(mkdtempSync(join(tmpdir(), "botc-tls-off-")), "tls");
      const srv = await startServer({ BOTC_TLS_DIR: tlsDir });
      stops.push(srv.stop);
      const r = await fetch(`${srv.base}/api/health`);
      const body = (await r.json()) as { scheme?: string };
      srv.stop();
      if (body.scheme !== "http") return `scheme ${body.scheme}`;
      return existsSync(tlsDir) ? "a certificate folder was made with HTTPS off" : null;
    },
  },
];

await runAsyncCases(cases, () => {
  for (const s of stops) s();
});
