# Saturday — control your existing Chrome game tabs

This version uses the game tabs you already have open and signed in to. It moves those exact tabs into compact Chrome windows on your viewing monitor. A separate controller manages audio, the main game, layout, and fullscreen.

**No video mirroring, screen-sharing picker, separate browser profile, or new provider login.** The game windows remain real, separate Chrome windows arranged together into a multibox.

## Switch to this version

1. Close the earlier **Saturday desktop app** and its visualizer. It is no longer needed for this setup. End any previous tiled extension session before reloading the extension.
2. In the Chrome profile where Disney+ and DAZN are already signed in, open `chrome://extensions` and click **Reload** on **Saturday — CFB Multiview**. This is version **1.3.0**.
3. Close any older Saturday controller tabs, then click Saturday’s extension icon while viewing one of your game tabs. The new controller says **CHROME MULTIBOX CONTROLLER**.
4. Choose **Add game tabs**, select your existing game tabs, choose your viewing monitor, and click **Arrange games**.

To install the legacy extension, enable **Developer mode** at `chrome://extensions`, choose **Load unpacked**, and select the **extension/** folder inside the project.

No server, native executable, npm install, or build is required to use the extension.

## Your seven-game setup

1. Start every game in its own Chrome tab. Enable sound inside each provider’s player.
2. Put the Saturday controller on your control monitor.
3. Use **Add game tabs** to select the seven already-open game tabs. Titles and provider names identify them. No URL is reopened and no cookie or login data is copied.
4. Choose the other monitor under **Viewing monitor**.
5. Choose **Main game above the others**, then **Arrange games**. With seven games, the main game spans the top; six smaller player windows form two rows of three beneath it.
6. Use **Listen** to change sound, **Make main** to enlarge a different game, and **Go to game** to raise a particular player and select its audio.

**Add active Chrome tab** attaches the most recently focused website tab. Clicking the extension icon on a game also remembers that game as the source. The controller shows its title above the lineup. You can also select any open game through the tab picker.

## Make the windows cleaner

After the games are playing and arranged, choose **Clean player view**. Chrome will ask for optional access to the selected Disney+/DAZN sites. If granted, Saturday brings the existing playing video to the front and sizes it to its current browser window. The video is not moved to another page, copied, captured, or reloaded.

- **Fit · whole picture** preserves the whole frame and scoreboard. A very wide main box will still have black bars because the video keeps its aspect ratio.
- **Fill · crops the picture** removes letterboxing by cropping the video. It can cut off scoreboards, captions, or action; choose Fit to keep the entire frame visible.
- **Restore page controls** reverses the styling. There is also a small restore button inside each cleaned page. Pausing, ending, errors, or replacing the playing video restores its page styling automatically; choose Clean player view again after restarting playback if needed.
- **Tight window spacing** removes the requested gaps. After Clean player view has page access, it also uses reported browser measurements to compensate for invisible popup resize borders. Turn this off if the edges overlap on your display.

Chrome’s native title bars remain. The optional styling is for visible, already-playing HTML video in Disney+/DAZN pages, their same-origin embedded documents, and accessible shadow roots. It does not access a different site’s embedded player or change authentication, ads, stream sources, or DRM. If a provider’s player cannot be adjusted, use its own theater view. The new styling has automated DOM tests; its appearance on live Disney+/DAZN pages is not yet verified.

## Controller actions

| Control | What it does |
| --- | --- |
| Arrange games | Move existing tabs into a multibox on the selected monitor |
| Make main | Resize/reposition the existing player windows around that main game |
| Equal grid | Give the game windows equal-sized boxes |
| Listen | Mute other selected tabs, then enable that game’s tab audio |
| Click a game window | Select its sound when follow-click is enabled |
| Bring games forward | Raise the arranged game windows, then return focus to the controller |
| Fullscreen main game | Show the main game alone across its viewing monitor |
| Return to multibox | Exit main-game fullscreen and restore every game window to the grid |
| × beside a game | Remove that game from control and restore its tab |
| End session & restore tabs | Return the tabs to regular Chrome windows and restore their previous mute/pin/discard settings |

Main game and audio are independent. Promoting a game does not change which game you hear. Fullscreening the main game temporarily covers the other games on that monitor; **Return to multibox** restores them. A multi-window layout fills the monitor’s available desktop area rather than making several windows fullscreen at once.

The controller’s **Layout overview** is a diagram of the arrangement, not a video preview. Click a diagram box for audio or double-click it to promote a game; the actual games remain in their Chrome windows.

The multibox reflows when you add, remove, or close games. Adjust volume in each player and use the controller to choose which tab you hear.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `1`–`9` in controller | Select the corresponding lineup game’s audio |
| `M` in controller | Mute selected games |
| `Alt+Shift+Right` in Chrome | Cycle game audio |
| `Alt+Shift+M` in Chrome | Mute selected games |

Change Chrome-wide shortcuts at `chrome://extensions/shortcuts`. They are not OS-wide shortcuts.

## End the session before reloading Chrome

Choose **End session & restore tabs** before restarting Chrome or reloading, disabling, or removing the extension. The tab IDs and restore map are kept for the current browser session. Closing just the controller keeps the current layout/audio session available through its extension icon.

If moving the last tab closed its original window, restoration creates a replacement regular Chrome window and regroups its tabs. A compact popup player first moves through a regular Chrome window so tab restoration respects Chrome’s window-type restrictions. Original tab groups and the full configuration of a closed browser window are not restored.

Games removed from the session return to their previous mute settings and are no longer controlled by Saturday. Unselected browser tabs and other apps can still produce sound. If the controller becomes unavailable, Chrome’s tab context menu can unmute a game and move it to a regular window manually.

## Practical limits

- Use the same regular Chrome profile as your active provider logins. Incognito tabs are excluded.
- Chrome and Windows may enforce minimum window sizes. The controller reports when Chrome changes the requested bounds. Use fewer games, Equal grid, or a larger display if players overlap.
- Provider page UI stays in the player windows unless the optional Clean player view can adjust its playing video. A provider may pause or adapt playback when a tab moves or resizes; interact with that original player if needed.
- Start each provider’s player and enable its in-player sound. Unmuting a Chrome tab cannot override a mute button inside the provider’s player.
- If the viewing display disconnects, choose another monitor and arrange again.
- Actual window placement and live provider behavior have not been automated on your desktop. Tests use Chrome API and DOM mocks; they do not establish live-playback performance.

## Privacy and development

Everything runs in the extension. There are no captures, recordings, video relays, stream uploads, analytics, or cookie imports. The extension uses `tabs`, `storage`, and `system.display` to read tab names/URLs, control selected tabs/windows, store the current session, and read monitor bounds. `scripting` plus optional, user-granted Disney+/DAZN site access enables Clean player view. That optional function styles the actual existing video and restores those styles when you exit the view. It does not read credentials or copy browser sessions. Baseline arranging and audio control work without granting site access.

Run the checks with Node.js 20+:

```powershell
node --test tests/*.test.js
```

The extension checks cover controller command wiring, existing-tab attachment, native-window layout, seven-game arrangements, main/audio independence, mute ordering, fullscreen/return, monitor changes, follow-click, popup-safe restoration, session recovery, player-view permission gating, reversible CSS changes, Fit/Fill selection, and the absence of capture/cookie-import code in the shipped extension.

`node scripts/preview.js` serves only the extension controller layout at `http://127.0.0.1:4173`; actual tab control needs the installed Chrome extension. Other work in this shared workspace has added Vite/Vitest scripts to the root package; the direct command above runs these extension-specific checks without depending on that separate app’s setup.

The previous standalone WebView2 prototype remains under `desktop/` for reference. It uses its own provider logins and is not needed for this Chrome-tab version.
