"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { get, post } from "@/lib/client";

export function SettingsPanels(props: {
  username: string | null;
  displayName: string | null;
  publicProfile: boolean;
  showXHandle: boolean;
  notifyOnPayment: boolean;
  xHandle: string | null;
}) {
  const router = useRouter();
  const [username, setUsername] = useState(props.username ?? "");
  const [displayName, setDisplayName] = useState(props.displayName ?? "");
  const [availability, setAvailability] = useState<{ ok: boolean; reason: string | null } | null>(null);
  const [flags, setFlags] = useState({
    publicProfile: props.publicProfile,
    showXHandle: props.showXHandle,
    notifyOnPayment: props.notifyOnPayment,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check(next: string) {
    setUsername(next);
    setAvailability(null);
    if (!/^[a-z0-9_]{3,20}$/.test(next.toLowerCase())) return;
    const result = await get<{ available: boolean; reason: string | null }>(`/api/username?u=${encodeURIComponent(next.toLowerCase())}`);
    if (result.ok) setAvailability({ ok: result.data.available, reason: result.data.reason });
  }

  async function save(payload: Record<string, unknown>, tag: string) {
    setBusy(tag);
    setError(null);
    setMessage(null);
    const result = await post<{ ok: boolean; error?: string }>("/api/profile", payload);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.data.ok === false) {
      setError(result.data.error ?? "That change did not save.");
      return;
    }
    setMessage("Saved.");
    router.refresh();
  }

  async function toggle(key: keyof typeof flags) {
    const next = { ...flags, [key]: !flags[key] };
    setFlags(next);
    await save({ [key]: next[key] }, "flags");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="panel stack gap-5">
        <span className="label">Username</span>
        <label className="stack gap-2">
          <span className="label">blind username</span>
          <div className="flex items-center gap-2">
            <span className="figure muted">@</span>
            <input className="field" value={username} onChange={(event) => check(event.target.value)} maxLength={20} spellCheck={false} />
          </div>
        </label>
        {availability ? (
          <p className={availability.ok ? "text-develop text-[14px]" : "error-text"}>
            {availability.ok ? "Available." : availability.reason}
          </p>
        ) : (
          <p className="faint text-[13px]">A username can only be changed once a day, and never to impersonate Blind.</p>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => save({ username }, "username")}
          disabled={busy !== null || !/^[a-z0-9_]{3,20}$/.test(username.toLowerCase()) || availability?.ok === false}
        >
          {busy === "username" ? "Saving…" : "Save username"}
        </button>

        <label className="stack gap-2">
          <span className="label">display name</span>
          <input className="field" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={60} />
        </label>
        <button type="button" className="btn btn-ghost" onClick={() => save({ displayName }, "display")} disabled={busy !== null}>
          {busy === "display" ? "Saving…" : "Save display name"}
        </button>
      </section>

      <section className="panel stack gap-5">
        <span className="label">Privacy</span>
        <Toggle
          label="Public profile"
          hint="Lets people find your username and ask you for money. Your addresses are never part of it."
          value={flags.publicProfile}
          onToggle={() => toggle("publicProfile")}
        />
        <Toggle
          label={props.xHandle ? `Show ${props.xHandle} on your profile` : "Show X handle (none linked)"}
          hint="Off by default. An X handle is a public identity; attaching it to payments is your call."
          value={flags.showXHandle}
          onToggle={() => toggle("showXHandle")}
        />
        <Toggle
          label="Notify me about payment events"
          hint="In-app notifications when a deposit confirms, a claim is made, or a payout settles."
          value={flags.notifyOnPayment}
          onToggle={() => toggle("notifyOnPayment")}
        />
        <p className="faint text-[13px]">
          Blind stores the minimum it needs to operate: an internal id, your username, linked provider ids, wallet
          addresses you added, and the payment records themselves. There are no analytics or third-party scripts on
          these pages.
        </p>
        {message ? <p className="text-develop text-[14px]">{message}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  onToggle,
}: {
  label: string;
  hint: string;
  value: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="stack gap-1">
      <button type="button" className="flex items-center justify-between gap-4 text-left" onClick={onToggle} aria-pressed={value}>
        <span className="text-[15px]">{label}</span>
        <span className={value ? "pill pill-develop" : "pill"}>{value ? "on" : "off"}</span>
      </button>
      <span className="faint text-[13px]">{hint}</span>
    </div>
  );
}
