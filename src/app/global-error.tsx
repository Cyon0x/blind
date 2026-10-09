"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0b0c0d",
          color: "#f2f1ed",
          fontFamily: "system-ui, sans-serif",
          padding: "32px",
        }}
      >
        <div style={{ maxWidth: "520px" }}>
          <p style={{ letterSpacing: "0.14em", textTransform: "uppercase", fontSize: "11px", color: "#767876" }}>
            Blind could not load
          </p>
          <h1 style={{ fontSize: "32px", lineHeight: 1.1, margin: "12px 0" }}>Something went wrong on this page.</h1>
          <p style={{ color: "#a6a7a4", fontSize: "15px" }}>
            No money moved. Reload the page, and if it keeps happening the deployment needs a look.
          </p>
          {error.digest ? (
            <p style={{ color: "#767876", fontSize: "13px" }}>reference {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "20px",
              padding: "14px 24px",
              background: "#12d07a",
              color: "#04130b",
              border: 0,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
