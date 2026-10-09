import { handle, json, readJson } from "@/lib/api";
import { requireMutation } from "@/lib/session";
import { RESERVED_USERNAMES, audit, setUsername, updateUserSettings, usernameAvailable } from "@/lib/store";

export const dynamic = "force-dynamic";

type Body = {
  username?: string;
  displayName?: string;
  publicProfile?: boolean;
  showXHandle?: boolean;
  notifyOnPayment?: boolean;
  completeOnboarding?: boolean;
};

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireMutation();
    const body = await readJson<Body>(request);

    if (body.username !== undefined) {
      const wanted = body.username.trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(wanted)) {
        return json({ ok: false, error: "Usernames are 3–20 characters: letters, numbers, underscore." }, { status: 400 });
      }
      if (RESERVED_USERNAMES.has(wanted)) {
        return json({ ok: false, error: "That username is reserved by Blind." }, { status: 400 });
      }
      if (!(await usernameAvailable(wanted, session.user.id))) {
        return json({ ok: false, error: "That username is taken." }, { status: 409 });
      }
      const updated = await setUsername(session.user.id, wanted);
      if (!updated) {
        return json(
          { ok: false, error: "A username can only be changed once a day. Try again later." },
          { status: 429 }
        );
      }
      await audit({ actorUserId: session.user.id, action: "profile.username_set", subject: wanted });
    }

    const user = await updateUserSettings(session.user.id, {
      displayName: body.displayName ?? null,
      publicProfile: typeof body.publicProfile === "boolean" ? body.publicProfile : undefined,
      showXHandle: typeof body.showXHandle === "boolean" ? body.showXHandle : undefined,
      notifyOnPayment: typeof body.notifyOnPayment === "boolean" ? body.notifyOnPayment : undefined,
      onboarded: body.completeOnboarding === true,
    });
    return json({ ok: true, user: user ? { username: user.username, onboarded: Boolean(user.onboarded_at) } : null });
  });
}
