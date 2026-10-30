# <img src="icon128.png" width="36" height="36" style="vertical-align: middle; margin-right: 8px;"> Padlet Breakout Linker

A tiny **Manifest V3** browser extension for **Chrome and Edge** that puts a
one-click **open-in-new (external-link)** button right next to every Padlet section’s “⋯” menu — so you
can jump straight to that section’s breakout room without the
“copy link → open new tab → paste” dance.

## What it does

- Adds a small **open-in-new icon** (square with an arrow to the upper right) to
  the **left of each section’s “⋯” menu** on a
  Padlet board (detected precisely by its `aria-label`, so it never lands on a
  post, the toolbar, or settings).
- **One click** opens that section’s breakout room in a **new tab**; your current
  tab never changes.
- **Alt+click** clears the saved link for that section.
- A toolbar popup lists every captured link for the current board, with
  **Open / Copy / ✕** per section, a **Re-scan page** button, and **Open all**.

The on-page button uses the standard “open in new tab” glyph and shows its state by
background colour: **transparent** (not yet linked) → **green** (linked — a click
opens the room) → a brief **yellow flash** if it could not find the link.

## How it gets each link (no manual copy/paste)

Padlet keeps each section’s breakout room on that section’s own object. The
extension obtains the link in two ways:

1. **Automatic discovery.** A script injected into Padlet’s own page context
   hooks `fetch` and `XMLHttpRequest` and scans the board data for each
   section’s breakout link, matching it to the section title. When found, the
   button turns green on its own.
2. **One-click fallback.** If a link hasn’t been discovered yet, clicking the
   button opens that section’s menu, selects **“Copy breakout room link”**, captures
   the copied URL (the extension hooks Padlet’s clipboard write — covering
   `writeText`, `write([ClipboardItem])`, and `execCommand('copy')`), saves it,
   and opens the room — all in a single click. After the first click per section
   it is instant.

Either way, you never copy/paste by hand.

## Install (Chrome & Edge — load unpacked)

The extension is not on the Chrome/Edge store, so you load it directly from
this folder.

### Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `PadletBreakout` folder (the one that
   contains `manifest.json`).
4. Open a Padlet board that uses sections + breakout rooms. The buttons appear
   next to each section’s “⋯” and turn green as their links are found.

### Edge

1. Open `edge://extensions`.
2. Turn on **Developer mode** (toggle in the left sidebar).
3. Click **Load unpacked** and select this `PadletBreakout` folder.
4. From here it behaves exactly like Chrome.

> **After any file edit:** click the **↻ Reload** button on the extension card
> in `chrome://extensions` (or `edge://extensions`), then reload the Padlet tab.

## Usage

- **Click the button** → opens that section’s breakout room in a new tab.
- **Alt+click the button** → clears the saved link for that section.
- **Extension popup** (click the toolbar icon): lists saved links for the current
  board with Open / Copy / ✕ per section, plus **Re-scan page** and
  **Open all**.
- **Options** (right-click the icon → Options): informational only.

## Files

- `manifest.json` — MV3 manifest, scoped to `padlet.com`; permission: `storage`.
- `content.js` — injects the open-in-new buttons; orchestrates discovery + fallback.
- `inject.js` — MAIN-world hook that reads Padlet’s network traffic and captures
  clipboard writes (covers `writeText`, `write([ClipboardItem])`, and
  `execCommand('copy')`).
- `content.css` — styles for the injected icon.
- `popup.html` / `popup.js` / `popup.css` — toolbar popup (list / open / copy / delete).
- `options.html` / `options.js` — informational.
- `icon.svg` — icon source (vector); `icon16.png` / `icon48.png` / `icon128.png` —
  rasterised icons (green square-with-arrow on a rounded square).

## Notes & limitations

- Chromium browsers only (Chrome, Edge, Brave).
- If a section’s button stays transparent, just click it once — the fallback opens the
  menu and copies the link for you. (Open DevTools → Console and look for lines
  beginning `[PBB]` if you want to verify what happened.)
- Disabling breakout rooms on the Padlet side regenerates the links; reopen the
  board to re-discover them.
- No data leaves your browser — links are stored locally in `chrome.storage.local`.

## Privacy

The extension only runs on `padlet.com`. It does not collect, transmit, or store
any data outside your browser.
