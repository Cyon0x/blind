"use client";

import { useState } from "react";

/**
 * Copy-to-clipboard for links and addresses, with a real failure state.
 *
 * The value wraps instead of scrolling sideways: a base58 address has no spaces
 * to break at, and a clipped claim URL is a URL someone will mistype.
 */
export function CopyField({
  value,
  label,
  mono = true,
  note,
}: {
  value: string;
  label: string;
  mono?: boolean;
  note?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      setTimeout(() => setState("idle"), 2200);
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="stack gap-2">
      <span className="label">{label}</span>
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <code
          className={`field flex-1 break-all ${mono ? "figure text-[13px]" : ""}`}
          style={{ clipPath: "var(--blade-soft)" }}
        >
          {value}
        </code>
        <button type="button" className="btn btn-ghost shrink-0" onClick={copy}>
          {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
        </button>
      </div>
      {state === "failed" ? (
        <p className="error-text">Your browser blocked clipboard access. Select the text and copy it manually.</p>
      ) : null}
      {note ? <p className="faint text-[13px]">{note}</p> : null}
    </div>
  );
}
