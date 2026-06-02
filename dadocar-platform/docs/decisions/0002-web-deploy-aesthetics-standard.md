# 0002 — Web-deploy aesthetics standard

- **Status**: Active
- **Date**: 2026-05-13
- **Owners**: Robert
- **Supersedes**: —

## Context

AI-generated frontends converge on a recognisable "slop" aesthetic — Inter/Roboto/Space Grotesk, purple-on-white gradients, identical card layouts. We've now shipped two surfaces with deliberately distinct designs (webclient: dark São Paulo auto-mecânica; docs: light 1960s engineering journal). Robert wants this to be the standing rule for every web deploy going forward, not a one-off.

## Decision

Every web deploy from this repo follows the distilled aesthetics prompt as a hard checklist:

### Typography
- Choose distinctive, beautiful fonts.
- **Never** use Inter, Roboto, Arial, system fonts, or Space Grotesk as the primary type.
- **Never** repeat a font already used on a sibling surface in this repo (currently locked: Big Shoulders, IBM Plex Sans, JetBrains Mono on the webclient; Newsreader, Hanken Grotesk, DM Mono on the docs site).

### Colour & theme
- Commit to **one** strong palette named after a real aesthetic (e.g. "tropical modernist", "engineering journal", "auto-mecânica modernist").
- Use CSS variables for every value.
- Dominant colour + sharp accent. Avoid timid evenly-distributed palettes.
- Vary light/dark across surfaces — siblings shouldn't both be dark or both be light.

### Motion
- CSS-only where possible; Motion library in React.
- One well-orchestrated page-load with staggered reveals (`animation-delay`) outperforms scattered micro-interactions.
- Respect `prefers-reduced-motion`.

### Backgrounds
- Layered gradients, geometric patterns, contextual texture.
- **Never** a flat solid colour.

### Negative space — what to avoid
- Overused fonts (Inter, Roboto, Arial, Space Grotesk, system sans).
- Purple gradients on white.
- Generic Tailwind cards on grey-50.
- "Modern SaaS dashboard" templates.
- Identical patterns to any sibling surface in this repo.

## Process

Before writing any CSS or HTML for a new web surface:

1. **Survey siblings.** Look at the other surfaces in this repo (`apps/webclient/`, `docs/site/`, `docs/commercial-site/`) and note their fonts + palettes so the new one is visibly distinct.
2. **Name the aesthetic.** Commit to a single named direction (e.g. "Brazilian tropical modernist", "Risograph zine") before picking the first hex code.
3. **Pick fonts.** From the not-yet-used-and-not-on-the-avoid-list pool. Distinct sans/serif/mono choices.
4. **Build the palette.** Dominant + one or two sharp accents. Set as CSS variables.
5. **Layer the background.** Two-or-more gradients OR a pattern OR a geometric element.
6. **Add one orchestrated motion.** Staggered page-load reveal is the default.

## Catalog of aesthetics used so far

| Surface | Aesthetic | Theme | Fonts | Dominant accent |
|---|---|---|---|---|
| `apps/webclient/` | São Paulo auto-mecânica modernist | Dark | Big Shoulders / IBM Plex Sans / JetBrains Mono | Signal orange `#f25c1c` |
| `docs/site/` (status) | 1960s engineering journal | Light | Newsreader / Hanken Grotesk / DM Mono | Cinnabar `#c8362b` |
| `docs/commercial-site/` | Brazilian modernist exhibition catalog | Light page + dark plates | Fraunces / Bricolage Grotesque / B612 Mono | Saffron mustard `#e9a93b` |

Update this row when each surface ships a new design.

## References

- The distilled aesthetics prompt itself: `docs/decisions/0002-aesthetics-prompt.txt` (preserved verbatim, not in this file).
