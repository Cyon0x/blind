import { handle, json, limited } from "@/lib/api";
import { currentSession } from "@/lib/session";
import { RESERVED_USERNAMES, usernameAvailable } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    const throttle = await limited("username:check", 120, 60_000);
    if (throttle) return throttle;
    const raw = (new URL(request.url).searchParams.get("u") ?? "").trim().toLowerCase();
    const session = await currentSession();
    if (!/^[a-z0-9_]{3,20}$/.test(raw)) {
      return json({ username: raw, available: false, reason: "3–20 characters, letters, numbers and underscore only." });
    }
    if (RESERVED_USERNAMES.has(raw)) {
      return json({ username: raw, available: false, reason: "That name is reserved by Blind." });
    }
    const available = await usernameAvailable(raw, session?.user.id);
    return json({ username: raw, available, reason: available ? null : "That username is taken." });
  });
}
