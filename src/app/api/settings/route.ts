import { activeModel, backendHealth, backendName, claudeConfigured } from "@/lib/llm";
import { listConnections } from "@/lib/connections";
import { databaseConfigured } from "@/lib/db";
import { homeAssistantConfigured } from "@/lib/cameras";
import { gmailEnabled, googleConfigured } from "@/lib/google";
import { handle, json } from "@/lib/http";
import { microsoftConfigured } from "@/lib/microsoft";
import { pocketsmithConfigured } from "@/lib/pocketsmith";
import { listProfiles } from "@/lib/profiles";
import { householdTimezone } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    // The CLI backend's health check spawns a process, and this endpoint is
    // hit on every phone open to read the profiles. So it is opt-in, and only
    // the settings screen asks.
    const wantsHealth = new URL(request.url).searchParams.get("health") === "1";

    const configured = {
      database: databaseConfigured(),
      claude: claudeConfigured(),
      google: googleConfigured(),
      gmail: gmailEnabled(),
      microsoft: microsoftConfigured(),
      pocketsmith: pocketsmithConfigured(),
      cameras: homeAssistantConfigured(),
      transcribe: Boolean(process.env.TRANSCRIBE_API_KEY),
      appSecret: Boolean(process.env.APP_SECRET),
    };

    if (!configured.database) {
      return json({
        configured,
        backend: backendName(),
        health: wantsHealth ? await backendHealth() : null,
        profiles: [],
        connections: [],
        model: activeModel(),
        timezone: householdTimezone(),
      });
    }

    const [profiles, connections] = await Promise.all([
      listProfiles(),
      listConnections(),
    ]);

    return json({
      configured,
      backend: backendName(),
      health: wantsHealth ? await backendHealth() : null,
      model: activeModel(),
      timezone: householdTimezone(),
      profiles,
      connections: connections.map((connection) => ({
        profileId: connection.profileId,
        provider: connection.provider,
        accountEmail: connection.accountEmail,
        lastScannedAt: connection.lastScannedAt,
        needsReauth: connection.needsReauth,
      })),
    });
  } catch (error) {
    return handle(error);
  }
}
