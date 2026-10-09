import QRCode from "qrcode";

/**
 * QR codes are rendered on the server as SVG so the encoded URL is exact and
 * there is no client-side dependency that could alter it.
 */
export async function QrPanel({
  value,
  caption,
  size = 200,
}: {
  value: string;
  caption?: string;
  size?: number;
}) {
  const svg = await QRCode.toString(value, {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
    color: { dark: "#0b0c0d", light: "#f2f1ed" },
  });

  return (
    <figure className="stack items-center gap-3">
      <div
        className="blade-soft p-4"
        style={{ background: "var(--ink)", width: size + 32, height: size + 32 }}
        // The QR payload is the claim/request URL exactly as generated above.
        dangerouslySetInnerHTML={{ __html: svg.replace("<svg", `<svg width="${size}" height="${size}"`) }}
      />
      {caption ? <figcaption className="faint text-center text-[13px] max-w-[240px]">{caption}</figcaption> : null}
    </figure>
  );
}
