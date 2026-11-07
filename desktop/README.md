# Saturday desktop: direct-link visualizer + controller

**For your existing Chrome tabs and logins, use the Chrome extension described in [the current setup guide](../README.md).** This earlier desktop prototype uses its own browser profile and is not the current solution. You can close it while using the Chrome controller.

Start **`bin/Saturday.exe`**. This is the direct-playback version: each game page opens in its own real WebView2 browser view. No screen capture, mirrored tabs, or sharing banners are used.

The app is built and its controller/layout checks pass. **Disney+ and DAZN playback and sign-in have not been tested in this embedded browser.** Test one game first; a successful build does not prove provider compatibility. The app does not change DRM, spoof the browser identity, disable browser protections, or bypass subscription limits.

## Use

1. Start `bin/Saturday.exe`. The **control center** and **visualizer** open separately.
2. In the controller, paste a game’s HTTPS page URL beside Game 1 and choose **Load link**.
3. Sign in and start playback inside that visualizer box. These login sessions are separate from your Chrome profile. All boxes share the app’s own browser profile, so a provider login can be reused across its boxes.
4. Load additional game links. The default is seven boxes; choose 1–9 as needed.
5. Use **Make main** in the controller to promote a game. Use **Listen**, **Mute all**, or the volume slider to control sound. Main game and selected audio are independent.
6. Choose **Main game + supporting games** or **Equal grid**. The seven-game featured layout places the large main game above two rows of three.
7. Choose your viewing monitor and click **Move to monitor**. **Fullscreen visualizer** toggles fullscreen from the controller. There is also a fullscreen button in the visualizer.

With **Audio follows player focus** enabled, focusing an original player inside the visualizer selects its sound. Clicking the title strip also selects sound; double-clicking it makes that game main. Provider play/pause controls remain interactive, so use the controller’s Listen buttons when you want to change audio without clicking a player.

**Reload page** reloads only that game. **Clear** closes a slot’s player but keeps its entered link. **Clear all players** releases the browsers. **Save lineup** stores names, links, layout, and main-game selection. **Load saved links** opens the remembered pages; they are not opened automatically on startup.

Closing the visualizer hides it while the games continue playing; **Show visualizer** brings it back. Closing the controller closes the visualizer and its browser views.

## Browser and playback details

- Every box loads the actual provider page directly as a top-level browser document. The controller changes those existing views’ positions and mute state; changing the main game does not reload the game pages.
- Sign in manually in the visualizer. The app does not import Chrome cookies or credentials, and does not automate authentication.
- Provider pages may need theater mode or their own fullscreen button to make the video fill the box. Fullscreen behavior and playback depend on the provider. Page UI is not stripped or bypassed.
- Per-view audio muting uses WebView2’s native `IsMuted` property. The master volume adjusts ordinary HTML media in each view and child frame; provider code may override media volume. A player’s own mute button must be enabled for audible playback.
- Microsoft Edge WebView2 Runtime and .NET Framework 4.8 are required. WebView2 Runtime was detected on this machine. Provider support, video quality, DRM availability, and seven simultaneous streams remain dependent on the provider and computer.

App data stays under `%LOCALAPPDATA%\SaturdayMultibox`: `lineup.json` contains your entered links and names; `BrowserProfile` contains this app’s browser sessions. Provider pages make their normal network requests. Saturday adds no stream relay, video upload, analytics, or recording.

## Build and test

The bundled binary targets Windows x64 and .NET Framework 4.8. Keep the four `.exe`/`.dll` files and `Saturday.exe.config` in `bin` together, along with the WebView2 license and notice.

SDK dependency: Microsoft’s `Microsoft.Web.WebView2` **1.0.4314.35**, from [NuGet](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4314.35). Extract the `.nupkg` into `desktop/vendor/webview2`, then run from the project root:

```powershell
powershell -NoProfile -File desktop/build.ps1 -Test
```

The build uses Windows’ installed .NET Framework C# compiler; a full .NET SDK installation is not needed. The eight native checks cover layout geometry, seven games, independent main/audio selection, mute ordering, clearing games, protected capacity reduction, and link validation. The GUI, authentication, and actual provider playback have not been automated or verified.
