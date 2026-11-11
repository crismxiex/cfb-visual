# GameDeck dashboard — UX/UI audit

_Audit date: 2026-11-10 · Branch: `ux/audit-improvements` · Scope: the extension dashboard (`dashboard.html` → `src/main.tsx`, `src/sports/ui.tsx`, `src/audio.tsx`, `src/player-controls.tsx`) and its CSS. The native helper, desktop app and legacy `extension/` folder are out of scope._

## How this was evaluated

- **Rendered and measured, not just read.** The dashboard was run with Vite in the built-in browser against a temporary mock of the Chrome extension APIs (3 connected games, 2 monitors, 5 college basketball games, 1 alert). Measurements came from scripts run in the page: computed font sizes, WCAG contrast of each visible text node against its composited background, element positions and overflow at different widths, and real Tab key presses.
- **Widths tested:** 1440 px, 1264×860 (the dashboard popup's default 1280×900 window, minus its frame), 768 px, 520 px (dashboard docked beside games) and 375 px.
- **Screenshots** failed after the first one because the app window was minimized. Visual checks were done by measuring the DOM instead.
- **No user research or analytics exist.** Anything marked _hypothesis_ is a judgement, not an observation.

## Product map

- **Users:** one person on game day, on a desktop, driving several streaming windows across one or more monitors. The dashboard opens as a 1280×900 Chrome popup (`src/background.ts`) and stays open for hours. It is glanced at between plays and used in short bursts.
- **Navigation:** a fixed sidebar with Workspace, Sports Hub, Saved layouts and Preferences, plus a "How it works" page.
- **Workspace, top to bottom:** page heading → Streaming Services → compact score ticker → add-URL form → Player tools → [layout map | layout picker] → lineup (audio bar + game rows) → footnote.
- **Dialogs:** Add existing tab, Edit game details, Reopen game, Close tab (confirm), Link score to game, Choose streaming tab.
- **Stack:** React 19, Zustand, lucide icons, and hand-written CSS in two files with Tailwind imported but almost unused. There are no design tokens: **251 distinct hex colors**, 10 different border radii and one CSS variable.
- **Worth keeping:**
  - The layout map and its one-click "listen to this game" tiles.
  - Explicit confirmation before closing a browser tab.
  - Honest copy about what GameDeck does and doesn't do.
  - The live-score ticker linked to games.
  - The lineup's per-game audio controls.
  - Most icon buttons already have accessible names.

## Core workflows

| # | Goal | Steps today (default 1280×900 window) | Friction observed | Better sequence |
|---|---|---|---|---|
| 1 | Add a game that's already open in a tab | Scroll ~550 px → **Add existing tab** (or an empty slot) → optionally search → click the tab → **Done**. That's 3 clicks plus a scroll. | The picker can't be closed with Esc. Tab leaves the dialog and moves focus to the page behind it. The page above the lineup must be scrolled past every time. | Esc closes the dialog, focus stays inside it, and closing returns focus to the button that opened it. |
| 2 | Hear a different game / make it main | Scroll until the layout map is visible → click a tile (1 click) or its **Make main** button. | The map starts at y = 909 px in an 860 px viewport, so nothing is visible without scrolling. **Make main** is 51×13 px with 6–9 px text. | Larger targets and legible labels. Raising the map above the fold is a proposal (see below). |
| 3 | Change layout | Scroll → click a layout (1 click). Window gap and custom grid live on the Preferences page. | Layout settings are split across two pages (_hypothesis: people look for gap beside the layouts_). | Proposal: move gap and custom grid next to the layout picker. |
| 4 | Follow scores and jump to a game | The compact ticker sits at the top of Workspace; click a linked game (1 click). Sports Hub has the full board. | The ticker sits above the fold, which works. Its sub-labels are 8–10 px with low contrast. | Readable sizes and contrast. |
| 5 | Save, apply or delete a layout preset | Saved layouts → name → **Save preset**. The trash icon deletes immediately. | Delete has no confirmation or undo. | Proposal: an undo toast after deleting. |

## Findings

Severity weighs user impact, frequency, how central the workflow is, accessibility, and effort.

| Issue | Location | Type | Severity | User impact | Proposed fix |
|---|---|---|---|---|---|
| Most text is too small to read at a glance. **107 of 156** visible text items are ≤10 px and some are 5–7 px. Narrow-width rules shrink text further, down to 5 px on tile footers at ≤1150 px. | `src/style.css`, `src/sports/style.css` (observed) | Visual / Accessibility | **High** | The dashboard is glanced at from a distance during games. Tiny labels slow every task and are unreadable for low-vision users. | Set a minimum: 10 px only for uppercase letter-spaced labels, 11 px otherwise. Remove the rules that shrink text at narrow widths. |
| **46 text items fail WCAG AA contrast** (as low as 2.3:1). Examples: section kickers, the sidebar footer, version, slot numbers, layout descriptions, the footnote and the URL hint. | Both CSS files (observed) | Accessibility | **High** | Secondary information effectively disappears. This fails WCAG 1.4.3. | Lighten only the failing text colors to ≥4.5:1 against their actual backgrounds. |
| Dialogs don't support the keyboard. Esc doesn't close them, Tab moves focus behind the "modal" (confirmed with 8 Tab presses), and focus isn't returned on close. | All six dialogs in `main.tsx` and `sports/ui.tsx` (observed) | Functional / Accessibility | **High** | Keyboard and screen-reader users can't reliably finish workflow 1 or the confirmations. Everyone loses the expected Esc shortcut. | One shared dialog behavior: Esc closes, Tab and Shift+Tab stay inside, focus returns to the opener. |
| Text fields and dropdowns hide the focus outline (`outline:none`) and rely on a border change plus an 8 %-opacity glow. | `src/style.css` `input,select` rules (observed) | Accessibility | **High** | While tabbing through the URL field, monitor selector, volume and filters it's hard to tell which control is active (WCAG 2.4.7). | Use the same visible `:focus-visible` outline buttons already use. |
| **Make main** on tiles is a 51×13 px target inside a tile that is itself a button. | Layout map `slot-footer` (observed) | Interaction / Accessibility | **Medium** | Easy to miss-click and select the tile instead (WCAG 2.5.8 asks for 24×24). | Give the button a 24 px minimum height. Report the nested-control structure as a proposal. |
| The layout map overflows narrow windows. Its aspect ratio combined with a 240 px minimum height forces a 439 px width, so the page scrolls sideways at 520 px (547 px of content) and 375 px. | `.layout-canvas` (observed) | Visual | **Medium** | Docking the dashboard beside the games (_hypothesis: a common setup on one monitor_) produces sideways scrolling. | Cap the map at its container width. |
| The current page isn't announced in the sidebar (no `aria-current`). | Sidebar nav (observed) | Accessibility | **Low** | Screen-reader users don't hear which section is open. | Add `aria-current="page"`. |
| The loading spinner ignores `prefers-reduced-motion`. | `.spin` keyframes (observed) | Accessibility | **Low** | People who turn off motion still get continuous rotation (WCAG 2.3.3, AAA but cheap). | Stop the animation when reduced motion is requested. |
| The core view is below the fold. In the default window, Streaming Services, ticker, URL form and Player tools fill the first 730 px. The map starts at 909 px, Arrange at 1328 px and the lineup at 1413 px (viewport 860 px). | Workspace order in `main.tsx` (observed) | Architectural / IA | **High** | Every audio switch and layout change starts with a scroll. | **Proposal only** (restructures the main screen). Move map + lineup first. Fold Streaming Services and Player tools into a compact toolbar or collapsible section. |
| Clicking lineup rows selects the game, but the rows can't be reached by keyboard. Selection is only possible from the tile. | `article.game-row` (observed) | Accessibility | **Medium** | Keyboard users have one route instead of two. Not blocking. | Proposal: add a "Listen" button to each row rather than a focusable row (avoids nested controls). |
| Tiles are `div role=button` containing real buttons (nested interactive controls). | Layout map (observed) | Accessibility / Architectural | **Medium** | Screen readers announce confusing structure. | Proposal: make the tile body a real `<button>` and keep the footer actions as siblings. |
| Commands sent while another is running are silently ignored (`store.ts` drops them while busy). | `useDeck.send` (observed in code) | Interaction | **Medium** | A click during an arrange does nothing and gives no message. Most buttons are disabled while busy, which hides the problem. Keyboard shortcuts and a few buttons aren't disabled. | Proposal: queue or show a short "Busy — try again" status. Changes behavior, so not implemented. |
| Errors appear at the top of the page even when the action happened further down. | `role=alert` banner in `main.tsx` (observed in code) | Interaction | **Medium** | When scrolled to the lineup, a failed action shows nothing visible. Screen readers still announce it. | Proposal: show the error next to the control that caused it, or as a fixed toast. |
| Deleting a preset is a single click with no undo. | Saved layouts (observed) | Interaction | **Medium** | Saved arrangements can be lost by a mis-click. | Proposal: an undo toast. That's lighter than a confirmation and keeps it to one step. |
| Layout settings are split. Layouts are picked on Workspace, but gap, custom grid and display coverage are in Preferences. | IA (_hypothesis_) | Architectural | **Low** | People may not find gap or custom grid. | Proposal: a "Layout options" disclosure under the layout picker. |
| No design tokens: 251 hex colors, 10 radii, magic font sizes. | Both CSS files (observed) | Architectural | **Medium** | Inconsistencies creep in and contrast is hard to keep. | Proposal: move color, type and radius to CSS custom properties gradually, starting with the text scale introduced here. |
| Icon buttons in lineup rows are named only by `title` (Focus, Minimize, Swap). | Lineup rows (observed) | Accessibility | **Low** | `title` works as an accessible name, but the tooltip never appears for keyboard users. | Add `aria-label`s when the row is revisited. |

## Implemented in this branch

One commit per fix, in order:

1. **Dialogs work with the keyboard.** Esc closes, focus stays inside, and focus returns to the opener. Swap mode can also be cancelled with Esc.
2. **Readable minimum text size.** No visible text below 10 px, and the narrow-width shrink rules are removed.
3. **AA contrast for secondary text.** The failing text colors are lightened.
4. **Visible keyboard focus** on text fields, dropdowns and tile buttons.
5. **24 px "Make main" target** on tiles.
6. **No horizontal scroll** when the dashboard is docked narrow.
7. **`aria-current` on the active sidebar section.**
8. **Spinner respects reduced motion.**

## Proposals (not implemented — they change established layout or behavior)

Ranked by expected impact:

1. Put the layout map and lineup first on Workspace, and collapse Streaming Services and Player tools.
2. Show errors next to the action or as a fixed toast.
3. Busy feedback instead of silently dropped commands.
4. Make tiles real buttons, and add a Listen button to lineup rows.
5. An undo toast for preset deletion.
6. A "Layout options" disclosure under the layout picker.
7. Gradually move styling to design tokens.
