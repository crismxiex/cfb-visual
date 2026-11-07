# Optional GameDeck Windows helper

The normal extension works without this helper. Chrome's window API places framed popup windows; it cannot strip native styles. The helper attempts native caption/resize-frame reduction with Win32 `SetWindowLongPtr` and `SetWindowPos`. **Chrome can still draw its own title bar. This is experimental frame reduction, not a promise of fully borderless Chrome or uninterrupted provider playback.** It does not touch video, page DOM, credentials, audio, DRM, browser profiles, or the Windows taskbar.

## Build and install explicitly

Windows 11 x64 and the built-in .NET Framework 4.x compiler are required. No packages, administrator privileges, browser restart or remote debugging are needed.

```powershell
.\native\build.ps1 -Test
# Copy your GameDeck ID from chrome://extensions, then:
.\native\install.ps1 -ExtensionId YOUR_32_CHARACTER_EXTENSION_ID
```

The installer compiles `native/bin/GameDeckHost.exe`, writes a native messaging manifest allowing only that exact extension origin, and registers its absolute path under the current user's `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.gamedeck.windows`. It does not install a service or run at Windows startup. Keep this project directory in place. To use it, click **Preferences → Enable immersive mode** and approve the optional `nativeMessaging` permission. The permission is not needed for layout or audio features.

Exit immersive mode before reloading, disabling, or uninstalling GameDeck. For removal:

```powershell
.\native\uninstall.ps1
```

That removes only the host registry registration. It preserves source, the executable and recovery records.

## Window targeting and DPI

Chrome window IDs are not Win32 HWNDs. The helper never accepts an arbitrary HWND from the dashboard. Pairing requires:

1. The host was launched by a verified Google Chrome ancestor and an extension-origin argument.
2. A unique visible `Chrome_WidgetWin_1` window in that Chrome browser process matches the managed tab title and the expected monitor-relative rectangle.
3. The extension verifies that it is a single-tab popup containing the selected tab ID.
4. Chrome's exact window ID is moved horizontally by 19 logical pixels. The helper observes the corresponding native movement and validates its DPI transformation. The extension immediately restores the probe geometry, including on failure.
5. A process identity, process creation time, per-window mutex and unique Win32 property bind subsequent native operations to that exact window. The property prevents a recycled HWND from being mistaken for the old game.

An ambiguous title, unknown process, unsupported scaling, failed challenge, changed window identity or out-of-monitor target fails closed. No native style changes occur before successful pairing. Native geometry maps shared rectangle edges to the target monitor's physical coordinates rather than rounding widths independently. Coordinates can be negative. The helper runs its thread in per-monitor DPI awareness. Mixed-DPI behavior must pass the observed movement test; unsupported configurations are rejected instead of guessed.

Changing monitors exits immersive mode and restores the old native windows. Enable it again to validate the new monitor. Placement preserves Z-order and does not activate windows or mark them topmost. The helper removes only native caption and resize-frame bits, retains original styles, and requests nonclient recalculation. If Chrome keeps a custom title bar, use normal popup mode; no provider-page manipulation is attempted.

## Restoration

Original style and native geometry are recorded before the first mutation. Leaving immersive mode restores both; the dashboard does not immediately reapply its new geometry afterward. Closing the last dashboard causes restoration and disconnects the host. Normal native pipe disconnect and host exit also attempt restoration. Pairing or placement errors stop immersive mode and restore all pairs. Removing an individual game restores that pair first.

Forced process termination or a machine crash can prevent cleanup. A recovery journal is written under `%LOCALAPPDATA%\GameDeck\native-session-*.json` before style changes. If needed, after the disconnected helper has ended:

```powershell
.\native\bin\GameDeckHost.exe --restore
```

Recovery skips journals belonging to a still-running helper and revalidates HWND, Chrome class, process ID, process creation time and the unique native window property before restoring. Closed/recycled/unrelated windows are skipped. Recovery records contain native geometry, styles, handles and process identities; no URLs, titles, cookies, credentials or video are stored in them.

The helper is a locally built development executable, not a signed distributed installer. Compilation and pure protocol/geometry tests have passed. Live Chrome style changes and recovery need separate verification on your displays; the helper has not been registered or activated automatically.

References: [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos), [GetWindowRect and DPI virtualization](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowrect).
