/**
 * Proxies all HTTP + WebSocket traffic to one long-lived BOTC container.
 *
 * Caveats (see Project docs):
 * - Container filesystem is not durable across replacement; session.json can be lost.
 * - Hue / WLED on the home LAN are unreachable from Cloudflare Containers.
 * - For table play with lights, prefer Docker Compose + Cloudflare Tunnel on the LAN host.
 */

import { DurableObject } from "cloudflare:workers";

const PORT = 3847;
/** Keep a mid-game instance warm; idle games still sleep eventually. */
const INACTIVITY_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const INSTANCE_NAME = "table";

export class BotcContainer extends DurableObject<Env> {
  private starting: Promise<void> | undefined;
  private monitoring: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    if (container?.running) {
      void ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS));
      this.observeExit();
    }
  }

  async fetch(request: Request): Promise<Response> {
    this.starting ??= this.startAndWaitForPort().finally(() => {
      this.starting = undefined;
    });
    await this.starting;

    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    forwarded.headers.delete("host");
    return this.ctx.container!.getTcpPort(PORT).fetch(forwarded);
  }

  private async startAndWaitForPort(): Promise<void> {
    const container = this.ctx.container!;
    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: "standard-1",
        // Outbound not required for core play; Hue/WLED still won't reach home LAN.
        enableInternet: false,
        env: {
          BOTC_HOST: "0.0.0.0",
          BOTC_PORT: String(PORT),
          BOTC_HTTPS: "0",
          BOTC_PUBLIC_URL: "https://botc.danazonprime.co.uk",
        },
      });
    }
    this.observeExit();
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);

    const port = container.getTcpPort(PORT);
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        const response = await port.fetch(`http://container/api/health`, {
          signal: AbortSignal.timeout(2000),
        });
        await response.body?.cancel();
        if (response.ok) return;
      } catch {
        /* not listening yet */
      }
      await scheduler.wait(400);
    }
    throw new Error(`BOTC container did not become ready on port ${PORT}`);
  }

  private observeExit(): void {
    if (this.monitoring) return;
    this.monitoring = this.ctx
      .container!.monitor()
      .then(() => console.log("BOTC container exited"))
      .catch((error: unknown) => console.error("BOTC container failed:", error))
      .finally(() => {
        this.monitoring = undefined;
      });
    this.ctx.waitUntil(this.monitoring);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await env.BOTC.getByName(INSTANCE_NAME).fetch(request);
    } catch (error) {
      console.error("BOTC proxy failed:", error);
      return new Response(
        "BOTC container is not ready. If this is a fresh deploy, wait a few minutes for provisioning, then retry.",
        { status: 502 },
      );
    }
  },
} satisfies ExportedHandler<Env>;
