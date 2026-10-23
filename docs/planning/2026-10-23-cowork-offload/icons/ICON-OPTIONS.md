# CRC Torah app icon: four options

Written 2026-10-23 for handoff §5.1. Each option is shapes only (no letters, no fonts), so it can be drawn at build time with `ImageResponse` (plan §3.8). The SVG files beside this note are the exact source; the numbers below match them.

## Common rules

- Canvas: 512 x 512. Scale every number by size/512 for 192, 180 and 48.
- Background: full-bleed lake `#1d5ba6` (DESIGN.md `lake`, also the manifest `theme_color`). No rounded corners in the file: the platform masks it.
- Figure colours: white `#ffffff`; marigold `#f7b500` as one accent fill only, never as an outline or line art (DESIGN.md "Marigold is never text").
- Safe zone: everything sits inside the circle centred at (256, 256) with radius 204.8 (40% of 512). The same file serves as `icon-512`, `maskable-512` and `apple-180`.
- Flat: no shadows, gradients or blur.
- All four were rendered at 512, 96 and 48 px, square and circle-masked, and checked for legibility at 48 px.

## Option 1: trope contour

- One white line, 48 wide, round caps and joins, no fill. Path: start (100, 320); cubic to (208, 172) with controls (144, 320) and (150, 172); cubic to (314, 304) with controls (264, 172) and (262, 304); cubic to (396, 224) with controls (354, 304) and (362, 224).
- So: a low start, a high peak, a dip, and a rise to the end point.
- Marigold disc, radius 46, centred on the line's end at (396, 224).
- Evokes: the rise and fall of a chanted phrase, with the marigold dot as the note you are singing now. It is the most distinct of the four and the least like a generic book app.

## Option 2: yad pointing to a word

- Draw the yad upright, then rotate it 35 degrees clockwise about (256, 256). Then scale the whole figure, yad and bar, to 0.9 about (256, 256).
- The yad's parts, before rotating, all white:
  - top knob: circle at (256, 84), radius 30;
  - shaft: rect x 238, y 84, 36 x 170, corner radius 18;
  - cuff: rect x 216, y 238, 80 x 24, corner radius 12;
  - fist: rect x 206, y 270, 100 x 70, corner radius 30;
  - pointing finger: rect x 206, y 300, 38 x 96, corner radius 19. It sits on the fist's left edge, which makes the hand read as a hand.
- The word: marigold pill, not rotated, rect x 124, y 388, 120 x 34, corner radius 17, just below the fingertip.
- Evokes: keeping your place in the scroll with the yad. Of the four, it is the thinnest at 48 px. It reads, but it is busier than the others.

## Option 3: open scroll

- Sheet: white rect x 148, y 156, 216 x 200, square corners.
- Rollers: two white rects, 64 x 280, corner radius 32: left at x 100, y 116, right at x 348, y 116. They stand 40 above and below the sheet.
- Three text lines on the sheet: rects x 192, 128 x 26, corner radius 13, at y 198 (lake `#1d5ba6`), y 243 (marigold `#f7b500`) and y 288 (lake `#1d5ba6`).
- Evokes: the Torah scroll open at the reading, with the marigold line as this week's place. It is the most literal of the four and very clear at 48 px.

## Option 4: open book with ribbon

- Left page, white: move to (242, 176); quadratic to (92, 154) with control (172, 140); line to (92, 344); quadratic to (242, 368) with control (172, 330); close.
- Right page, white: the mirror image: (270, 176), quadratic to (420, 154) with control (340, 140); line to (420, 344); quadratic to (270, 368) with control (340, 330); close.
- Gutter: the 28-wide gap between the pages shows lake through.
- Ribbon, marigold, on the right page: (304, 162), (352, 150), (352, 280), (328, 260) and (304, 280), closed. Its bottom is a notch.
- Evokes: study and commentary, a book open with a marker in it. Clear at 48 px, but it is the most generic shape: many reading apps use an open book.

## Previews

The PNG previews and a contact sheet were rendered in the Cowork sandbox, not on this machine. The write tool here takes text only. Each SVG above opens in any browser and shows the same image.
