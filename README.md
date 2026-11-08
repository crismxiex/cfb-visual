# GameDeck — local sports window manager

GameDeck arranges your existing, signed-in Chrome sports tabs as real independent popup windows. The React dashboard is a layout map and control panel. Your original streaming pages continue running in the same Chrome profile; no video is captured, embedded, mirrored, proxied, or retransmitted.

**New in v2.4.2 — Reliability fixes:** cross-monitor saved layouts restore native pairing safely; replacement tabs retain their audio selection; volume sliders stay responsive during updates; tickers exclude scores from a different date. **CFB Live → Desktop score ticker → Open browser ticker** opens a separate Chrome score window without a helper. Native ticker startup now enables score access, reports setup errors and offers **Retry ticker**. Its Windows helper still needs to be installed and permitted to execute.

**New in v2.4.1 — Player volume:** per-game volume sliders and player unmuting from the Command Center. Reload the extension, then click **Enable volume controls** once to grant access for your managed providers. Listen and audio switching recover muted players without opening their windows.

**New in v2.4 — Sports Hub:** Disney+ and DAZN Mexico launchers; real FBS score cards/ticker, favorites, confirmed event-to-window linking, score-card audio/main controls, in-tile scores and an optional native desktop ticker. See [Sports Hub setup, provider research, architecture and verification](docs/SPORTS-HUB.md). The completed provider was checked against the live feed; the optional native overlay was compiled but Windows denied executing its rebuilt helper. Open **CFB Live → Enable CFB scores** after reloading the extension. Chrome 120+ is required.

## Windows 11 setup

The production extension is already built in **dist/**. Normal layout and audio features require no server or native executable. The optional immersive helper is separate.

1. If Saturday is currently managing your tabs, use its **End session & restore tabs** first. Do not let two controllers manage the same tabs.
2. Keep Chrome open normally in the profile where your streaming services are signed in. No restart or debugging flag is required.
3. Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose:

   ```text
   dist/
   ```

4. Pin **GameDeck — Sports Window Manager** from Chrome's extensions menu and click its icon. The dashboard opens in its own window.
5. Choose **Add existing tab**, find the playing game, and click its row. GameDeck adopts that exact tab without reopening its URL.
6. Paste another game's HTTPS URL. A matching open tab is reused; otherwise Chrome opens it using the current profile. Start its player manually if needed.
7. Choose your viewing monitor and **Main + two** for three games. The main game occupies approximately 65% of the width, with two games stacked on the right.
8. Drag tiles between positions or choose **Make main**. The actual Chrome windows move without deliberate navigation or reload.

Only install **dist/** for GameDeck. The previous Saturday implementation remains in **extension/**, with its guide at [extension/README-legacy.md](extension/README-legacy.md). The older WebView2 prototype in **desktop/** is not used by GameDeck.

## Development

Use a current Node.js version supported by Vite (Node 22.12+ recommended).

```powershell
npm ci
npm run build
npm test
```

After edits, build again and reload GameDeck at `chrome://extensions`. Reloading does not close your game tabs. Runtime IDs are reconciled again; restoration to original windows may require replacement normal windows if the restore map was lost.

```powershell
npm run dev
# http://127.0.0.1:5173/dashboard.html
npm run preview
# http://127.0.0.1:4173/dashboard.html
```

HTTP previews explicitly display **Extension preview** and cannot manage tabs. They contain no fabricated games or video. Actual controls require installation in Chrome. All scripts and styles are bundled locally; there is no CDN or hosted backend.

## Features

- Paste HTTPS URLs with validation, normalization, existing-tab reuse, duplicate prevention, first-free-slot assignment, and immediate layout application.
- Search existing normal/popup website tabs, including Disney+, ESPN, DAZN, and other HTTPS sites.
- Drag to swap occupied positions or move into an empty slot. The swap button also lets you click a destination in the layout map.
- Promote any game to slot 1, explicitly focus its window, minimize, or restore it.
- Edit your own game titles, teams, and scores. Nothing is scraped from protected content. **Connected** means the tab exists, not that playback was verified.
- **Remove, keep window open** stops management while keeping the page running. **Return to regular tab** moves the same tab to its original normal window or a replacement. **Close browser tab…** requires a separate confirmation.
- Save named arrangements, restore the previous arrangement, configure spacing, and choose custom grids with 1–3 rows and columns (up to nine games).
- Select a monitor using its actual work area, including taskbar exclusions and negative monitor coordinates.

Built-in layouts: Single Game; Two Side by Side; Two Main + Secondary (70/30); Three Main + Two (65/35); Three Horizontal (one above two); Four Grid; Four Main + Three; Six Grid (3×2 landscape or 2×3 portrait). Adding a game automatically selects a layout with enough usable slots, preserving existing tabs, game positions, main game and audio. Main + Two grows to Main + Three for the fourth game, then to Six Grid and a nine-slot custom grid as needed. A custom grid expands automatically. A larger current layout stays selected. Only impossible monitor sizes or more than nine games block addition; GameDeck checks this before opening a new URL. Explicitly selecting or restoring an undersized layout is still rejected before geometry changes. Unused slots remain available.

## Clean player view (v2.3)

Start each provider's player, then click **Clean player view** above the layout map. GameDeck asks for optional scripting access and only the specific managed Disney+, DAZN and ESPN origins selected for this action. Normal URL insertion, window layouts and audio work without this access. Other HTTPS sites can still be managed as windows but are not styled by this feature.

The feature ports Saturday's player-only presentation: the original playing video stays in its original document and is positioned over the website interface to fill the window's content area. Its source, playback state, audio and authentication are untouched. It does not create a player, iframe or video copy, capture pixels, use exclusive fullscreen, or remove Chrome title bars. Open shadow roots and existing same-origin player frames are supported; inaccessible cross-origin players may require the provider's own theater view.

- **Fit · whole picture** uses proportional contain framing, keeping the whole image and scoreboard visible; black bars can remain.
- **Fill · crop edges** uses proportional cover framing. It crops the edges rather than stretching, and may crop scoreboards or captions.
- **Restore page controls**, the button inside each cleaned page, or Escape restores presentation and the previous native-video-controls setting.

Pausing, ending, an error or replacing the video automatically restores page controls. There is no forced reapplication. Changing Fit/Fill updates currently active clean views without restarting views you restored. The report says **Last applied** because provider behavior can restore a page later. Removing/returning a game restores its clean view first where permission is available. Restore page controls before reloading, disabling or removing the extension. If you previously used Saturday's clean view, restore it there before enabling GameDeck's version to avoid competing page styles.

## Audio control (v2.2)

Single-click a game tile, or press Enter/Space while it is focused, to hear only that game. This does not move, focus, activate, navigate or reload any game window. Dragging suppresses the synthetic click after drop. Each tile shows Chrome's actual mute flag; the designated audio tile also has a blue border. Main position and audio selection are separate indicators.

**Follow main game** is enabled by default. Promoting a game or dragging it into slot 1 switches audio before window movement begins. Swapping two secondary games preserves audio. Clicking a secondary tile temporarily overrides audio; ordinary arrangement and layout changes do not revert it unless the main identity changes. Disable Follow main to keep audio independent even when promoting games. **Mute all** explicitly enters silence. Per-game unmute selects that game exclusively rather than enabling overlapping audio.

All audio requests run through a serialized controller. It validates the target, waits for other managed tabs to mute, then unmutes the target and publishes the new source. Initial management selects the available main game and mutes others. New games respect the current source or mute-all state. Replaced tabs retain stable game identity. A missing active game falls back to an available main, otherwise an explicit no-audio state.

Manual Chrome mute events are observed. Muting the active game enters silence without repeatedly unmuting it. Manually unmuting another managed tab designates it and mutes the others. Events from this extension are recognized and ignored, preventing feedback loops. Turning **Manage audio** off, removing a game or returning its tab restores the earlier tab mute setting only when the current state is still owned by GameDeck; newer manual choices and other extensions' choices are preserved. Unmanaged tabs are never muted.

Click **Enable volume controls** in the Command Center to allow optional page access for your managed Disney+, DAZN and ESPN origins. Each game then has a 0–100% player volume slider. **Listen**, tile selection and follow-main switching also unmute the original player, including recovering from zero volume at the last audible level (50% if none is known). Sliders remember each game's chosen level and do not select or reposition another window. Other managed games stay muted through Chrome's tab controls. **Mute all** keeps every managed tab silent until you choose one again.

Player audio status refreshes every five seconds while the dashboard is visible; **Refresh audio** updates it immediately. Start playback first. Same-origin frames and open shadow roots are supported; inaccessible player frames show an unavailable status while ordinary Chrome mute controls keep working. No audio capture, playback restart or native helper is required. These controls change the original player's volume, not the Windows master or Chrome application mixer volume.

## Edge-to-edge arrangement

The default gap is zero; Preferences supports 0, 2, 4 and 8 pixels. The first upgrade to v2.2 migrates older geometry preferences to zero gap. Saved positions and game identities are preserved. Shared slot edges use integer rounding of boundaries, preventing internal rounding gaps or overlap. At 1920×1032, Main + Three is exactly a 1248×1032 main rectangle beside three 672×344 rectangles.

**Respect taskbar** uses the selected monitor's work area. **Fill entire display** uses its full reported bounds. This does not hide the taskbar or force topmost placement; Windows may keep an always-visible taskbar above a normal window. Chrome/Windows can enforce minimum dimensions and frame bounds; actual returned Chrome geometry is checked and discrepancies are reported. Mathematical slot coverage does not guarantee removal of invisible resize borders, title bars or provider controls.

Video letterboxing is separate from window geometry. Window layout never changes video presentation. The optional Clean player view changes CSS only; Fit retains letterboxing, while an explicitly selected Fill crops proportionally. Neither mode distorts the aspect ratio.

**Immersive mode** optionally uses the locally built Windows native-messaging helper to reduce native frames. It validates each target using Chrome process identity, tab title and an observed movement challenge, then stores and restores the original style and geometry. Chrome may retain custom-drawn decorations; fully borderless playback is not guaranteed. Closing the last dashboard or exiting immersive mode restores pairs. A recovery command is provided for forced termination. See [native setup, targeting and restoration](native/README.md). The helper is not registered or enabled automatically.

## Keyboard shortcuts

Click a tile or lineup row to select a game. Configure all commands at `chrome://extensions/shortcuts`.

| Command | Default |
| --- | --- |
| Promote selected game | Alt+Shift+M |
| Focus next game | Alt+Shift+Right |
| Next compatible layout | Alt+Shift+L |
| Previous arrangement | Alt+Shift+P |
| Minimize secondary games | Assign in Chrome |
| Restore all managed games | Assign in Chrome |

Chrome allows at most four suggested shortcuts, so two start unbound. Other extensions may reserve the defaults. These are Chrome shortcuts, not guaranteed OS-wide shortcuts. The dashboard also accepts Alt+M, Alt+Right, Alt+L, and Alt+P outside text inputs.

## Architecture

| Source | Responsibility |
| --- | --- |
| public/manifest.json | Manifest V3, module worker, minimal permissions, six commands |
| src/background.ts | Dashboard launch, trusted message routing, tab/display lifecycle and commands |
| src/controller.ts | Serialized tab/window orchestration, adoption, restoration, preferences and recovery |
| src/clean-player.ts, src/player-view-controller.ts, src/player-controls.tsx | Optional reversible provider-page presentation and controls |
| src/audio-controller.ts | Exclusive audio, follow-main, manual mute ownership and safe restoration |
| src/native.ts, native/ | Optional validated native-messaging bridge and Windows geometry/style helper |
| src/layout.ts | Pure rectangle calculations and layout definitions |
| src/model.ts | Types, HTTPS validation, provider metadata, one-to-one reconciliation |
| src/store.ts | Zustand state and asynchronous Chrome command responses |
| src/main.tsx, src/style.css | React dashboard, tab picker, drag-and-drop and Tailwind-backed styling |
| src/diagnostics.ts | Explicit real-Chrome integration check with isolated test state |

`chrome.storage.local` stores stable game keys, titles, HTTPS URLs with recognized credential parameters removed, slots, monitor preference, layout, spacing, custom grid, presets, and the previous arrangement. Tab/window IDs and original-window restoration data live only in `chrome.storage.session`. Cookies, credentials, player contents, and session tokens are never accessed.

Initialization inventories current windows with `chrome.windows.getAll({populate:true})`. It reserves surviving exact tab IDs, then matches saved games to remaining tabs one to one by URL. Runtime IDs are not trusted across browser restarts. Duplicate URLs do not attach multiple games to one tab. Startup attempts to restore matched games; missing games stay **Unavailable** until **Reopen…** is explicitly confirmed. Reopening checks existing tabs again before creating a window. Use **Arrange windows** if Chrome restores a matching tab later.

Commands run sequentially to prevent competing geometry updates. Each successful adoption is saved immediately so a subsequent API failure does not lose that identity. GET requests do not write storage, avoiding refresh loops. Tab and display events reconcile current state. Rearrangement does not deliberately focus windows; explicit focus commands do.

## API and platform limitations

- Required permissions are `tabs`, `storage`, `system.display`, and `alarms`. The `windows` namespace needs no separate permission. There are no required host permissions, persistent content scripts, capture APIs, cookie access, video processing or iframe players. Optional scripting and limited provider-origin access are requested only for Clean player view. The optional nativeMessaging permission is requested only for immersive mode.
- `windows.create({tabId,type:'popup'})` adopts an existing tab. `tabs.move` works only between normal windows, so returning a popup uses a temporary normal-window bridge when needed. If the original normal window closed, restoration creates a replacement and regroups restoration targets. Original tab groups and full window/tab-strip configuration are not reconstructed.
- Display work areas exclude OS-reserved space. Coordinates are passed through in Chrome's units without multiplying by devicePixelRatio. Mixed display scaling, window borders, OS rounding and Chrome minimum dimensions may alter requested bounds. Returned bounds are checked and visible warnings explain adjustments.
- Every slot includes the browser frame and the provider's own page UI. An extension cannot remove Windows chrome, embed arbitrary native windows, or make multiple windows exclusive fullscreen simultaneously.
- Incognito tabs, Chrome internal pages, installed PWA/app windows, native applications, and other Chrome profiles are outside the supported scope.
- Moving the same tab avoids deliberate reloads but cannot guarantee uninterrupted playback. Providers may pause/throttle background players, require gestures, or impose stream limits. GameDeck does not bypass DRM, HDCP, subscription limits, or autoplay restrictions.
- Saved URLs are ordinary provider watch-page links. Recognized token/auth/signature parameters are stripped before disk storage; signed links may not reopen. Do not paste credential-bearing URLs. Saved titles and URLs remain local browsing metadata.
- The optional native helper manages only validated Chrome window styles and geometry. It is separate from the extension build and requires explicit local registration. See native/README.md for limitations, tests and crash recovery.

Official references checked: [windows](https://developer.chrome.com/docs/extensions/reference/api/windows), [tabs.move restrictions](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-move), [display workArea](https://developer.chrome.com/docs/extensions/reference/api/system/display), [commands](https://developer.chrome.com/docs/extensions/reference/api/commands), and [local/session storage](https://developer.chrome.com/docs/extensions/reference/api/storage).

## Verification and real Chrome test

`npm test` runs the preserved Saturday Node tests and GameDeck's Vitest tests. GameDeck covers all layouts, portrait/negative-origin monitors, overlap and containment, odd-pixel rounding, URL validation, identity reconciliation, URL reuse, duplicate prevention, serialized commands, swaps without navigation, sparse positions, restart recovery, missing games, display disconnection, safe popup restoration, removal versus closing, minimize/restore, OS bounds warnings, custom presets and minimal permission/capture checks.

**The build, automated GameDeck/legacy tests, React interaction tests, native-bridge tests, and helper protocol/geometry self-test pass.** Real provider playback and optional native style changes require separate verification. Automated API and DOM tests do not establish uninterrupted DRM playback.

After installing, copy GameDeck's extension ID from `chrome://extensions`, open `chrome-extension://<extension-id>/diagnostics.html`, and click **Run window test**. It opens three harmless example.com pages, adopts their actual tab IDs, promotes/swaps real windows, minimizes/restores them, checks controller recovery, restores a popup tab through a normal window, and reports page loading events during orchestration. It closes only its test tabs and uses isolated in-memory storage, excluding existing tabs from discovery. This validates window management, not DRM playback.

Then run the provider acceptance flow: start BYU vs. Utah in your normal profile, adopt it, add Texas vs. Missouri and another game, choose **Main + two**, promote another game, and confirm the original players keep running without a screen-sharing indicator.

Live check status for v2.2: the existing Chrome dashboard was observed running v2.1.0 with four connected games. Computer Use was stopped with Escape before reloading it. The v2.2 live-stream checks and native registration/activation were not performed.

Version 2.3 validation: production build and automated layout-growth, clean-player DOM, permission, and UI interaction tests passed. Provider playback and page presentation have not been verified against live authenticated streams in this update.
