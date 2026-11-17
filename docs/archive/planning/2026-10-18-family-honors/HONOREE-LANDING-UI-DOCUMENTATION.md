# Honoree landing UI documentation

Recorded 2026-10-18 from the completed local implementation and existing built-browser evidence. This is a bounded Read-extension record, not a replacement design system or production-content approval. The assigned degraded documenter contract was applied as a documentation-only pass; no implementation, capture, browser, detector or initialization run was performed.

## Overview

The incumbent **Song session** world (Daniel's locked seed `8ac4194f`, code-first) remains authoritative. The earlier Annotated score world is historical. [DESIGN.md](../../../DESIGN.md), [PRODUCT.md](../../../PRODUCT.md), [.impeccable/design.json](../../../.impeccable/design.json), the [local surface contract](../../../.impeccable/surfaces/src-server-http-honoree-landing-ts.md) and the [landing specification](../../superpowers/specs/2026-10-18-honoree-landing-design.md) were compared with actual source.

The landing carries one invited person's own-aliyah preparation document: CRC masthead, one restrained heading, authorized first name and civil ceremony date, own verse span, Before the reading and After the reading, Hebrew with English immediately beneath, then About this text and informational availability. It inherits the reading world's type, cool canvas, lake accents and flat rules while following its standalone invitation brief. Practice-shell navigation, tools, progress and audio are absent by scope.

## Colors

All local palette values resolve to existing incumbent colors; no new palette is introduced.

| Role | Light | Dark | Observed use |
| --- | --- | --- | --- |
| Canvas | `#ebf2fa` | `#0b1626` | Entire document ground |
| Ink | `#13202f` | `#e9f0f8` | Heading, Hebrew and English |
| Muted | `#4b5a6b` | `#a8b8ca` | Ceremony context, credits, unavailable guidance |
| Lake action | `#1d5ba6` | `#8dbbf5` | Masthead and own verse reference |
| Rule | `#d2dfee` | `#24384f` | Masthead and section separation |
| Selection | `#dbe8f6` | `#10335e` | Text-selection fill |

The local selection choice and outlined masthead are recorded as surface facts, not amendments to global shell guidance. Marigold and forest have no functional role on this reading-only invitation.

## Typography

The local `Bricolage` alias loads `/fonts/bricolage-grotesque/BricolageGrotesque.ttf`; `Hebrew` loads `/fonts/noto-serif-hebrew/NotoSerifHebrew.ttf`. These are the approved first-party Bricolage Grotesque and Noto Serif Hebrew assets. Neither alias establishes a new font family for future surfaces.

| Role | Actual implementation |
| --- | --- |
| Main heading | 2.5rem desktop / 2rem at 600px and below; weight 750; line height 1.12; tracking -0.03em |
| Body / English | 1rem; body line height 1.6, English 1.65; English measure capped at 65ch |
| Ceremony context | 1.125rem desktop / 1rem phone, muted |
| Section heading | 1.25rem; weight 650; line height 1.3; tracking -0.02em |
| Hebrew | 2rem desktop / 1.625rem phone; line height 2; `mark` and `mkmk` enabled |
| Credits | 0.9375rem; credits heading 1rem |

Hebrew uses explicit Hebrew language and RTL direction, preserved whitespace and plaintext bidi. English has its own language/direction boundary. The name is isolated with automatic direction; the verse reference is isolated LTR. The incumbent Hebrew Stays Whole principle is preserved: context and credits remain UI text. These local hierarchy adaptations do not redefine the global type ramp.

## Layout

The masthead inner measure is at most 52rem; the main reading is at most 46rem, with 3rem total desktop gutters and a 3rem top margin. At 600px and below the gutters total 2.5rem and the top margin becomes 2rem. Safe-area-aware padding protects the masthead's left inset and document bottom. Sections use 1.5rem top padding and 2.5rem top separation, reducing separation to 2rem on phones. Credits have 3rem separation and 1.5rem top padding. Arbitrary long literal strings can wrap without widening the reading column.

All four existing full-page captures were personally viewed: [desktop light](../../../.impeccable/review/honoree-landing/desktop-light.png), [desktop dark](../../../.impeccable/review/honoree-landing/desktop-dark.png), [phone light](../../../.impeccable/review/honoree-landing/phone-light.png), [phone dark](../../../.impeccable/review/honoree-landing/phone-dark.png). They show the complete accepted synthetic document, readable hierarchy and section separation in both themes, and preserved phone reading order and wrapping. Literal hostile markup remains visible text, including the synthetic name, English block and credit; it is deliberate safety evidence, not production copy. These captures contain short invented material and do not establish full-length real-blessing layout acceptance. Unavailable, late-response and expiry behavior is supported by functional evidence, not claimed as separately pictured here.

## Elevation & Depth

The implementation is flat: no drop shadow, blur, gradient or simulated physical material. Fine solid border rules separate document sections. This preserves the incumbent Print, Don't Float principle while locally using document dividers rather than interactive-object inset hairlines. There is no authored motion on this static invitation.

## Shapes

The reading is an unboxed column with straight section rules. There are no cards, pills, toolbar docks or decorative shapes to document, and no new radius vocabulary.

## Components

The actual route is [src/app/honoree/route.ts](../../../src/app/honoree/route.ts), delegating to [src/server/http/honoree-landing.ts](../../../src/server/http/honoree-landing.ts). It returns static HTML without React hydration or portal navigation. Restrictive hashed inline script/style CSP and first-party font URLs accompany the private response.

The initial script captures the canonical fragment and removes it immediately. The anonymous POST places the capability only in its JSON body, omits credentials, rejects redirects and uses no-store/no-referrer. A closed, bounded DTO is rendered with text nodes after validation. It contains only first name/civil date, own verse span, before/after Hebrew and English, credits and expiry; no audio, visible transliteration or broader family data is introduced.

The status region gives generic loading feedback. Missing, malformed or unavailable invitations converge on one generic heading and explicit recovery: reopen the original invitation, then ask its sender for a new link if needed. Concealment, departure, persisted return, timeout and conservative monotonic expiry invalidate and clear content; late responses cannot restore it. The displayed availability line is informational only: remaining-life response metadata and elapsed monotonic time govern client clearing. This does not promise recall of text already delivered.

The fresh independent finish review at `.local-logs/honoree-b2-visual-finish-review.md` records **ship** for this synthetic local visual implementation after viewing all four captures. The single detector run exited **2**, with two font-alias warnings (`Bricolage`, `Hebrew`) and three type-size advisories (`1.125rem`, `1.25rem`, `1.625rem`). The reviewer accepted the existing font assets and local reading hierarchy; the phone Hebrew value is already an incumbent named Hebrew step. This is not a clean detector result, and the warnings were not suppressed by rewriting global guidance.

Integration evidence supplied by the parent, reused without reruns: actual native checks 10/10 with all 85 pins and cleanup; default production build passed; built-browser desktop/phone checks 10/10 in 4.1 seconds with zero retries, four captures, source pins and cleared port; author backend 41, seam 12, client VM 7 and independent peer 1 checks passed, with types passing. These establish the reported synthetic implementation checks, not production activation or real material permission.

Source SHA256 verified during this pass:

- Landing: `12162021a0797a8eefd15f207851c4fdcfe39601224923d65381518c046179a6`.
- Route: `732fc41ee6b92bf3ac6905df4196b313d777c98b41c3dacbf7dd01ad42a02536`.

## Do's and Don'ts

- Preserve the incumbent Song session world and this local own-aliyah document order; keep Hebrew prominent and English adjacent.
- Preserve literal safe rendering, generic recovery, bidi isolation and conservative content clearing.
- Keep capabilities, real prayer material and family records out of repository documentation and captures.
- Treat real material permission, exact credits, projector population and the separate `003` production operator/release as pending. Authenticated issue/reissue/revoke/receipt/status routes remain unexposed in this slice; no actual guest activation or mail is established.
- Do not canonize the detector findings as global tokens or repair unrelated global drift from this pass. No visual floor defect was identified in the reviewed captures; local hierarchy and alias differences remain explicitly recorded rather than promoted into system rules.

Preserved global files, SHA256 before this documentation write (rechecked unchanged afterward):

| File | SHA256 |
| --- | --- |
| `PRODUCT.md` | `6faf6eb518b17742be8eb6630f0d9c516413a56fa5c1e2242ffa7c56f611b8a5` |
| `DESIGN.md` | `c91b5b68052aa6a4c9edf7bdad0fc0a66937471e14a6d63e67b0d5801735ff27` |
| `.impeccable/design.json` | `c58f50884b05aa6e345dcd9cebe0ddf7b591a0b94d3f2841995af9e1db791ea4` |
| `.impeccable/config.json` | `f05fbce3fb293f8574c482044125ac45823714a2b1b56bb8232638223aebe8f0` |

Only this new documentation file is owned and written by this pass; other workers' checkout edits are preserved.
