# Founder Brief — Brand & Design System

The single source of truth for how Founder Brief looks and sounds. Any human or AI agent
building a new page, email, deck, or document should read this file first and follow it
literally. Tokens are defined in `app/globals.css` and mapped in `tailwind.config.ts` —
this document explains them and adds the rules that live only in the existing components.

---

## 1. The idea

Founder Brief is a **wire dispatch**, not a dashboard. The visual language borrows from
printed financial press: a rule across the top of the page, a mono eyebrow, serif for
statements, and a ledger of numbers with dotted leaders. Every design decision should be
checked against one question — *does this look like something you finish reading, or
something you monitor?* We want the former.

Three inherited constraints, non-negotiable:

- **One column, ~640px, always.** No sidebars, no grids, no tabs.
- **No charts.** Numbers appear as ledger rows with tabular figures. If a chart feels
  necessary, the copy has failed.
- **Colour is reserved for direction.** Green and rust mean "up" and "down". They are
  never decorative, never a brand accent, never a button fill.

---

## 2. Colour

Colour is defined as space-separated RGB channels in `:root` so Tailwind can apply
opacity via `rgb(var(--token) / <alpha-value>)`. **Always reference the token
(`text-ink`, `bg-paper`, `border-line`), never a raw hex,** in any React or Tailwind
context. Raw hex is permitted only in HTML email, where CSS variables don't work.

| Token | Role | Light | Dark |
| --- | --- | --- | --- |
| `paper` | Page background | `#FAFAF8` | `#0F1113` |
| `ink` | Primary text, top rules, primary button fill | `#191C1F` | `#E9E7E2` |
| `muted` | Secondary text, eyebrows, footer links | `#6E7378` | `#8B9096` |
| `faint` | Placeholders, tertiary metadata | `#9BA0A6` | `#64696F` |
| `line` | Hairlines, borders, dotted leaders | `#E6E4DF` | `#26292D` |
| `ledger` | Positive delta only | `#1E6E50` | `#54B28A` |
| `oxide` | Negative delta only | `#A8432C` | `#D96F52` |

### Dark mode

Dark mode is `darkMode: "media"` — it follows the OS via
`@media (prefers-color-scheme: dark)` and there is **no manual toggle**. Do not add
`dark:` variant classes; the tokens already swap. If you hardcode a colour, you break
dark mode silently, which is the most common way this system gets damaged.

The dark palette is not an inversion. `paper` goes to a near-black with a slight cool
cast (`#0F1113`) rather than pure `#000`, and `ink` becomes a warm off-white
(`#E9E7E2`) rather than pure `#FFF` — this keeps the "newsprint under lamplight"
feeling and avoids halation on large serif headlines. `ledger` and `oxide` are
**lightened and desaturated** in dark mode so they stay legible against the dark ground;
never reuse the light-mode green or rust on a dark background.

### Semantic rules

Green (`ledger`) and rust (`oxide`) attach only to a delta on a ledger row, and only when
the underlying data justifies a direction. Neutral or unknown deltas use `muted`. Never
use these two colours for buttons, links, badges, backgrounds, or illustration. There is
no success/warning/error palette beyond this pair — an error message is `ink` text.

---

## 3. Typography

Three families, each with a job that never overlaps.

| Family | Font | Variable | Used for |
| --- | --- | --- | --- |
| Serif | Newsreader (normal + italic) | `--font-serif` | Headlines, greetings, the main insight |
| Sans | Inter | `--font-sans` | Body copy, UI, buttons, form fields |
| Mono | IBM Plex Mono (400/500/600) | `--font-mono` | Eyebrows, numbers, dates, metadata, footer |

`<body>` defaults to `font-sans`. Serif and mono are applied explicitly.

### Scale

Sizes are set in explicit pixels via arbitrary values (`text-[15px]`), not Tailwind's
named scale. Match these exactly rather than inventing intermediate steps.

| Use | Class |
| --- | --- |
| Landing headline | `font-serif text-[34px] sm:text-[42px] leading-[1.15]` |
| Page headline / greeting | `font-serif text-[32px] sm:text-[38px] leading-tight` |
| Closing statement | `font-serif text-[22px] leading-snug` |
| Main insight | `font-serif text-[19px] leading-relaxed` |
| Lead paragraph | `text-[16px] leading-relaxed text-muted` |
| Body / ledger label | `text-[15px]` |
| Secondary body, buttons, fields | `text-[14px]` |
| Fine print, gaps | `text-[13px]` |
| Footer, ordinals, metadata | `font-mono text-[12px] text-muted` |
| Eyebrow, delta | `text-[11px]` / `text-[12px]` |

Form inputs are `text-[16px] sm:text-[14px]` deliberately — anything under 16px makes
iOS Safari zoom the viewport on focus. Do not "fix" this to 14px.

### Emphasis

Bold is `font-medium`, not `font-semibold` or `font-bold`, except on `.ledger-value`
where `font-semibold` gives the number weight against the dotted leader. Emphasis inside
serif prose is done by promoting `text-muted` copy to `text-ink font-medium`, sometimes
with `<em class="not-italic">` — the colour shift carries the emphasis, not the weight.

---

## 4. Signature components

These five patterns are the brand. Reuse them verbatim; they are what makes a new page
recognisable as Founder Brief.

### The masthead rule

Every top-level page opens with a 2px `ink` rule, then an eyebrow row with a hairline
beneath it. Left slot is always the mark and the words "Founder Brief"; right slot is
context — issue number and date in the product, "Sign in" on the landing page.

Never hand-write the left slot. Use `<Wordmark/>` (`components/Wordmark.tsx`), which
carries the mark, the name, the spacing and the link:

```html
<header class="rise border-t-2 border-ink">
  <p class="eyebrow flex items-baseline justify-between border-b border-line py-[10px]">
    <Wordmark />
    <span>No. 42 · March 4, 2026</span>
  </p>
</header>
```

Pass `suffix` for a section — `<Wordmark suffix="Settings" />` renders
"Founder Brief · Settings". **The masthead is always a link home**, on every page
including the one you are on. The only exception is a specimen brief embedded in
another page, which takes `linked={false}`.

### The mark

Three left-aligned bars in descending width — a dispatch reduced to its shape. It is
the favicon's mark without its plate.

- **Inline SVG in `currentColor`, never an image file.** It takes the token it sits
  in, so it follows light/dark with no second asset and no swap. A PNG pair would
  break the hover transition and the theme inheritance both.
- **`faint` at rest, `ink` on hover**, matching the wordmark beside it.
- **11px wide** beside the 11px eyebrow, with a `7px` gap and a `3px` top nudge so it
  sits on the first line's cap height rather than floating between two wrapped lines.
- Never enlarge it as a page element or set it on a filled plate. At display sizes
  the mark stops reading as a logo and starts reading as a UI bar chart. The plated
  version exists only as the favicon, where it sits on browser chrome.

### The eyebrow

Section labels are mono, 11px, uppercase, `muted`, tracked at `0.14em`. Use the
`.eyebrow` class. Every section gets one — they are the table of contents. Headings
(`<h2>`, `<h3>`) are essentially unused below the page title; the eyebrow replaces them.

### The ledger row

Label on the left, dotted leader stretching across, tabular mono value flush right. The
delta is a small coloured tag immediately after the label. This is the only way numbers
are presented.

```html
<div class="ledger-row">
  <span class="text-[15px]">Signups <span class="ml-2 text-[12px] text-ledger">+18%</span></span>
  <span class="ledger-leader" aria-hidden></span>
  <span class="ledger-value">47</span>
</div>
```

`.ledger-value` carries `font-variant-numeric: tabular-nums` so columns of figures align.
Any number that appears in a column must inherit it.

### The stagger

Content rises 8px into place on load in a single orchestrated sequence: `.rise` on each
top-level block, then `.rise-1` through `.rise-5` in document order to delay them
(50ms, 140ms, 230ms, 320ms, 410ms). Never more than five steps on a page — beyond that
the page feels slow. The animation is disabled under `prefers-reduced-motion`. No other
entrance animation, hover lift, or transition exists in the system apart from
`transition-colors` on links and buttons.

---

## 5. Layout and spacing

The page container is fixed: `mx-auto max-w-[640px] px-6 py-14`. Do not widen it for
"content-heavy" pages — long content gets shorter, not wider.

Vertical rhythm runs on a coarse scale. Between major landing sections use `mt-20`;
between sections inside a brief use `mt-10`; from masthead to headline `mt-10`; eyebrow
to its content `mb-2` (or `mb-4`/`mb-5` when the block below is dense). Footers sit at
`mt-16` with `border-t border-line pt-5`.

Radii are minimal: `rounded-md` (6px) on buttons and fields, `rounded-lg` (8px) on the
one card in the system (the sample-brief frame on the landing page), 2px on focus rings.
**There are no shadows anywhere.** Depth is expressed with hairlines, never elevation.

Separation is done with rules: `border-t-2 border-ink` opens a page or a final CTA,
`border-t border-line` closes a section, `border border-line` frames the rare card.

---

## 6. Interactive elements

```
.btn-primary   solid ink fill, paper text, hover:opacity-90
.btn-ghost     transparent, border-line, ink text, hover:bg-line/40
.field         transparent bg, border-line, rounded-md, focus → border-muted
```

Both button variants are `rounded-md text-[14px] font-medium px-4 py-2` with
`transition-colors`, and dim to `opacity-50` when disabled. There is no tertiary,
destructive, or coloured button — a destructive action is a ghost button with plain
`ink` label text.

Inline links in footers and navigation are `font-mono text-[12px] text-muted` with
`hover:text-ink transition-colors`, no underline. Links inside prose take `text-ink`
with an underline.

Focus is a 2px solid `ink` outline at 2px offset with a 2px radius, applied globally via
`:focus-visible`. Never remove it. Text selection inverts: `ink` at 90% background,
`paper` text.

---

## 7. Voice

The writing is part of the brand and is held to the same standard as the visuals.

Write like a wire service. Short declarative sentences, past tense for what happened,
imperative for what to do. Address the founder as "you". Lead with the number, then the
consequence. Never use exclamation marks, emoji, hype adjectives ("incredible",
"game-changing", "supercharge"), or growth-marketing verbs ("unlock", "leverage",
"empower"). Never congratulate.

The product's honesty rules are also brand rules and should be visible in any copy
written about it: it never invents a number, never guesses a cause, never reads user
data, never becomes a dashboard. When data is missing, say "cause unknown" — an honest
gap in `text-[13px] text-muted` at the foot of the page is better copy than a plausible
story.

Typographic detail matters in prose: use true em dashes and curly quotes
(`&ldquo;` `&rdquo;` `&rsquo;`), a middot with spaces for metadata separators
(`Free while in beta · 2-minute setup`), and `No.` before an issue number.

---

## 8. Applying this outside the app

**HTML email.** CSS variables and web fonts don't survive email clients, so email uses
inline styles with literal light-mode hex values and system fallbacks:
Georgia for serif, `ui-monospace, Menlo, monospace` for mono. Keep the same structure —
top rule, eyebrow, greeting, ledger with dotted `border-bottom`, insight, numbered
priorities. Email is light-mode only; do not attempt a dark variant.
See `lib/email/send.ts` for the reference implementation.

**Documents and decks.** Substitute Newsreader → Georgia, Inter → Helvetica/Arial,
IBM Plex Mono → Menlo or Courier. Keep the single column, the top rule, the mono
uppercase section labels, and the ledger treatment for figures. A Founder Brief document
should be recognisable in monochrome — if it stops working when you remove `ledger` and
`oxide`, the hierarchy was carried by colour and needs rebuilding.

**New pages in the app.** Copy the masthead from `components/Landing.tsx` or
`components/BriefView.tsx`, use `.eyebrow` for every section label, keep the container
at 640px, and use no more than five `.rise` steps.

---

## 9. Checklist before shipping a page

- Uses only the seven colour tokens; no hex literals outside `lib/email/`
- Readable in both light and dark without a single `dark:` class
- Opens with `<Wordmark/>` in the masthead, not hand-written text
- One column, `max-w-[640px]`, no shadows
- Every section has a mono uppercase eyebrow
- All figures are mono, tabular, and right-aligned on a dotted leader
- `ledger` / `oxide` appear only on deltas
- At most five `.rise` steps, and the page is usable with animation disabled
- Focus outlines intact; inputs are 16px on mobile
- No exclamation marks, no emoji, no invented numbers
