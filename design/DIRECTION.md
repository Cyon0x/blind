# Blind — direction

## Concept

**Blind is a darkroom.** A payment goes in as a latent image and comes out only
for the two people standing in the room: the payer and the recipient. Nobody
else — not the chain, not a bystander with a block explorer, not Blind itself —
gets the developed print. The safelight is amber; a payment that has settled
turns develop-green. Source family: *places* (a photographic darkroom: safelight,
developing trays, tongs, the enlarger's aperture).

The signature object is the **iris**: an eight-blade aperture. It is the
opposite of a rectangle, it is closed when a payment is private, and it opens
only when someone is looking at something that is theirs.

**Refused category defaults (named, per slop.md §8):**
- the **dark crypto dashboard** (near-black + neon violet + glass cards + Inter
  + a KPI row) that every wallet product reaches for first;
- the **paper receipt** look (off-white ground, mono labels, a perforated ticket
  edge) — the known rut for payments, and doubly wrong for a privacy product:
  a receipt is exactly what Blind refuses to hand a stranger;
- the **fintech blue** trust look (navy, shield icon, "bank-grade security");
- the **claim-ticket/pawn-stub** metaphor (direction #1 for every model told to
  build a claim link — discarded on sight).

## Tokens

| Role | Dark (default) | Light (print) |
|---|---|---|
| `ground` | `#0B0C0D` darkroom black | `#EDEAE4` print stock |
| `raised` | `#141618` | `#FBF9F5` |
| `raised-2` | `#1C1F22` | `#DFDBD2` |
| `ink` | `#F2F1ED` silver print | `#14161A` |
| `ink-2` | `#A6A7A4` | `#5A5C5F` |
| `ink-3` | `#767876` | `#8A8C8F` |
| `rule` | `rgba(242,241,237,.13)` | `rgba(20,22,26,.14)` |
| `safelight` | `#FF5A2B` latent / pending / expiring | `#C63A10` |
| `develop` | `#12D07A` settled / confirmed / claimable | `#0B8F53` |
| `on-develop` | `#04130B` | `#04130B` |
| `bdx` | `#00C853` Beldex brand mark only | `#00A344` |

- **Accent role:** `develop` is the only colour allowed on a primary action, and
  one action per screen. `safelight` never fills a button — it is light, not
  paint: it appears as a glow, a rim, a state dot, or a label.
- `bdx` green is reserved for the Beldex network mark. It never becomes a
  button, because Blind is not Beldex.
- Raw hex lives in `src/app/globals.css`, never in components.
- **Dark is the default design.** Light is the *print*: same ink, same green,
  inverted — not an inversion of the dark theme.

## Type

- **Rubik Mono One** — the wordmark, and only the numbers that are the subject of
  a screen (amount, balance, serial). Heavy, engraved, unmistakably not Inter.
- **Anybody** (variable, `wdth` axis) — headings at `wdth 118`, `wght 800`,
  tracking −1.5%; UI text at default width 400/600/800. Its width axis is the
  web stand-in for the stencil on a darkroom door.
- **Martian Mono** — figures, serials, claim references, block heights, labels.
- **Hanken Grotesk** — body copy and every form control. Legibility where money
  is typed.
- Scale (7 steps): 84 / 56 / 34 / 22 / 17 / 14 / 12. Weight contrast always ≥ 2 steps.

## Shape language

Two shapes, no exceptions:

- **the blade** — an eight-sided aperture polygon:
  `clip-path: polygon(24% 0, 76% 0, 100% 24%, 100% 76%, 76% 100%, 24% 100%, 0 76%, 0 24%)`
  Panels, cards, the amount field, the primary button.
- **the pill** — 999px. Tags, filters, chips, secondary actions.

Rects-with-4px-radius appear nowhere. Edges that are not blades carry **sprocket
notches** (a repeating mask), read as film perforations, used to mark sections
that scroll sideways. A circle is allowed exactly once per screen: the aperture
state dial. Depth is a **cut line** (`inset 0 0 0 1px rule`), never a soft
shadow; the only glow is the safelight.

## Motion

One idea: **latent → developed.** Elements arrive desaturated and blurred and
resolve into place (`filter: blur(9px) saturate(0) → none`, 520ms
`cubic-bezier(.16,.84,.3,1)`). The aperture dial rotates its blades open on
confirm. Claim pages "develop" the receipt from a grey latent state when
settlement is verified. Nothing loops except the contact-sheet ticker.
`prefers-reduced-motion` collapses everything to a 0ms opacity swap.

## Richness source

- A **self-drawing iris**: an SVG eight-blade aperture that draws itself with
  `stroke-dashoffset` and then opens — the landing hero object, and the loader
  everywhere else.
- A **contact sheet** of real payment frames on the marketing page: 35mm
  sprocket edges, frame numbers in Martian Mono, greyscale until hovered.
- **Engraved guilloche** rules (SVG rosettes generated from a deterministic
  seed derived from the payment reference) used on receipts — so two receipts
  never look alike, and a receipt that has been edited no longer matches its own
  engraving.

## Its own slop (watch for)

Amber. The safelight is ambient, never a surface. If a screen has an amber
button, an amber card and an amber heading, the room is on fire.
