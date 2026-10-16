---
name: CRC B'nei Mitzvah
description: A quiet, reading-first interface for congregation practice and access.
colors:
  surface: "#fff"
  canvas: "#f6f7f6"
  ink: "#222c35"
  muted: "#53616a"
  action: "#8a0a14"
  action-hover: "#680911"
  teal: "#0b6a62"
  rule: "#d5dcda"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 1.14
    letterSpacing: "-0.035em"
  title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    lineHeight: 1.6
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 600
rounded:
  control: "6px"
spacing:
  unit: "0.5rem"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "0.6875rem 1.125rem"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.6875rem 1.125rem"
    height: "48px"
  input-email:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.6875rem 0.875rem"
    height: "48px"
---

# Design System: CRC B'nei Mitzvah

## Overview

**Creative North Star: "Annotated Score"**

The implemented entry surface uses a white working field, legible ink, a restrained burgundy action, and precise rules. The page leads with the reading as its destination while its neighboring task area reports actual access and invitation state. This is the initial authentication and invitation slice; a Hebrew passage and its practice tools have not been implemented or visually specified by this file.

The current controls feel familiar and deliberate. Spacing creates the hierarchy, and text explains state without ornamental imagery.

**Key Characteristics:**
- A flat white field with fine rules and a compact congregation masthead.
- A reading-first introduction beside a live task area on wide screens.
- Clear, touch-sized controls and a single-column phone layout.
- Explicit role and invitation details before access changes.

## Colors

The palette uses one action accent, one confirmed-state accent, and quiet neutrals.

### Primary
- **Burgundy action** (`colors.action`): primary actions, links, and request errors; the deeper variant (`colors.action-hover`) marks hover.

### Secondary
- **Confirmed teal** (`colors.teal`): the available-role list and the keyboard focus outline. It is used for state identification, not as a substitute for words.

### Neutral
- **White surface** (`colors.surface`): page, task area, controls, and skip link.
- **Pale canvas** (`colors.canvas`): disabled input and scrollbar track.
- **Ink** (`colors.ink`): principal text, strong task rule, and brand.
- **Muted ink** (`colors.muted`): introduction, supporting notes, field help, and footer.
- **Quiet rule** (`colors.rule`): header, footer, notes, and form divider.

**The State Has Words Rule.** Color reinforces an explicit label or message; role and invitation state remain understandable without color.

## Typography

The initial entry slice deliberately uses the system UI stack in the frontmatter for headings, body, labels, and controls. This records the approved implementation choice for this slice, not a Hebrew display font decision.

- **Headline** (`typography.headline`): the short introductory task, capped at roughly twelve characters per line on desktop and reduced at phone widths.
- **Title** (`typography.title`): the adjacent live access or invitation state.
- **Body** (`typography.body`): explanations and recovery text; paragraphs remain within approximately 65 characters.
- **Label** (`typography.label`): field labels and action text.

**The Reading Type Rule.** Hebrew reading requires its own verified vowel and cantillation rendering when actual licensed content is implemented. The current `[lang="he"]` selector establishes right-to-left direction and mark features, but no Hebrew passage or compiled Hebrew font is present yet.

## Layout

The entry shell is centered and capped at 78rem, with a two-column introduction and task grid at desktop widths. The task begins with an ink rule; the introduction and page edges use quiet rules. The `--space-unit` rhythm is 0.5rem, while major composition uses larger multiples: the desktop grid gap is 6rem and top padding is 6rem.

At 900px the shell padding and grid gap contract and the headline reduces. At 640px the grid becomes one column, with the task following the introduction, shell padding at 1.5rem, and full-width task actions. The enlarged-text phone capture remains vertically scrollable without horizontal overflow.

**The Adjacent Task Rule.** Keep the current action or access state next to the introduction on wide screens, and immediately after it on narrow screens.

## Elevation & Depth

The entry surface is flat: it uses no box shadows or raised cards. Depth comes from white space, text hierarchy, pale disabled control fill, and one-pixel rules. Focus uses a visible three-pixel teal outline offset from the control.

**The Open Surface Rule.** Use line weight and spacing to separate content; this entry surface has no shadow vocabulary.

## Shapes

Buttons and inputs share a gently curved control corner (`rounded.control`). Rules and dividers remain straight. Controls are at least 48px high; the lower-emphasis text action keeps a 44px touch height. The task area is an open column rather than a boxed card.

## Components

### Buttons
- **Primary:** solid burgundy, white semibold text, 48px minimum height, with a deeper hover and active state.
- **Secondary:** white with an outlined border and ink text; the border strengthens on hover.
- **Text action:** underlined burgundy text for a secondary path such as switching accounts.
- **Focus and pending:** keyboard focus gets the teal outline; pending controls are disabled and visibly subdued. Background and border changes settle over 160ms, except when reduced motion is requested.

### Inputs / Fields
- **Email field:** white fill, gray-green one-pixel border, ink value, burgundy caret, and the shared control corner. A visible label and short help line accompany it. The disabled field uses the pale canvas.

### Navigation
- **Masthead:** the CRC name is a compact ink link, paired with a muted congregation name. A skip link appears on focus, and ordinary links use underlined burgundy text.

### Invitation details
- **Reviewed access:** a two-column definition list names the role and, when present, the student. The expiry stays visible above the explicit acceptance action. Mixed-direction names use a directional isolate.

## Do's and Don'ts

### Do:
- **Do** keep current access and invitation outcomes explicit in headings, labels, and recovery copy.
- **Do** preserve a readable one-column flow and touch-sized actions on phones.
- **Do** use the restrained burgundy for action and teal for focus or confirmed-role emphasis.

### Don't:
- **Don't** imply an unimplemented reading workspace or invent passage content in the entry surface.
- **Don't** use color alone to communicate role or acceptance state.
- **Don't** add decorative depth to this flat entry system without an implemented reason.
