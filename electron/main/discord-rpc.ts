/**
 * Discord Rich Presence integration.
 * Shows "Codebrain" in the user's Discord profile whenever the app is open.
 * Pattern reverse-engineered from Overclock (2026-05-30).
 *
 * Uses @xhayper/discord-rpc (not the deprecated discord-rpc).
 * Errors are handled silently — Discord may not be running.
 */
import { Client } from "@xhayper/discord-rpc";
import log from "electron-log/main.js";

const DEFAULT_APPLICATION_ID = "1510333918245683380";
const LARGE_IMAGE_KEY = "logo";

function isDiscordApplicationId(value: string): boolean {
  return /^\d{10,30}$/.test(value);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | void> {
  return Promise.race([
    promise.then((v) => v).catch(() => void 0),
    wait(ms).then(() => void 0),
  ]);
}

class DiscordRichPresence {
  private client: Client | null = null;
  private generation = 0;
  private currentApplicationId: string | null = null;

  async start(applicationId: string, details?: string): Promise<void> {
    await this.stop();

    if (!isDiscordApplicationId(applicationId)) {
      log.warn("[discord-rpc] Invalid application ID:", applicationId);
      return;
    }

    const generation = ++this.generation;
    const client = new Client({
      clientId: applicationId,
      transport: { type: "ipc" },
    });

    this.client = client;
    this.currentApplicationId = applicationId;

    client.on("disconnected", () => {
      if (this.client === client) {
        this.client = null;
        this.currentApplicationId = null;
      }
    });

    try {
      await client.login();

      if (this.generation !== generation || this.client !== client) return;

      const activity: Record<string, unknown> = {
        details: details ?? "Codebrain IDE",
        startTimestamp: new Date(),
        instance: false,
      };

      activity.largeImageKey = LARGE_IMAGE_KEY;
      activity.largeImageText = "Codebrain";

      await client.user?.setActivity(activity, process.pid);
      log.info("[discord-rpc] Connected — showing Codebrain in Discord");
    } catch (err: any) {
      if (this.client === client) {
        this.client = null;
        this.currentApplicationId = null;
      }
      log.info("[discord-rpc] Could not connect (Discord may not be running):", err.message);
      await withTimeout(client.destroy(), 500);
    }
  }

  async stop(): Promise<void> {
    const client = this.client;
    this.generation++;
    this.client = null;
    this.currentApplicationId = null;

    if (!client) return;

    await withTimeout(
      client.user?.clearActivity(process.pid) ?? Promise.resolve(),
      700,
    );
    await withTimeout(client.destroy(), 700);
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  getApplicationId(): string | null {
    return this.currentApplicationId;
  }
}

const discordRichPresence = new DiscordRichPresence();

/**
 * Start Discord Rich Presence.
 * @param clientId Discord Application ID (reads from config or uses default)
 */
export function setupDiscordRPC(clientId?: string): void {
  const id = clientId || DEFAULT_APPLICATION_ID;
  void discordRichPresence.start(id);
}

/**
 * Restart Discord RPC with a new Application ID.
 * Called when user changes the setting in Settings UI.
 */
export function restartDiscordRPC(clientId: string): void {
  log.info("[discord-rpc] Restarting with new Application ID:", clientId);
  void discordRichPresence.start(clientId);
}

export function teardownDiscordRPC(): void {
  void discordRichPresence.stop();
}

export function updatePresence(details: string, state?: string): void {
  const appId = discordRichPresence.getApplicationId() || DEFAULT_APPLICATION_ID;
  void discordRichPresence.start(appId, state ? `${details} — ${state}` : details);
}

export function isDiscordConnected(): boolean {
  return discordRichPresence.isConnected();
}

export function getDefaultApplicationId(): string {
  return DEFAULT_APPLICATION_ID;
}
