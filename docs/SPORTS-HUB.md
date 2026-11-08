# Sports Hub — GameDeck 2.4

The existing React dashboard, Chrome window controller, clean player presentation, layout engine and exclusive audio manager remain in place. Sports Hub is an additional data and linking layer, not a new browser, backend, embedded streaming player or audio manager.

## Using the hub in Mexico

Reload GameDeck at `chrome://extensions` after rebuilding. Chrome 120+ is required for the 30-second alarm cadence. The default **Streaming Services** buttons are **Disney+ Mexico** and **DAZN Mexico**, opening the exact root URLs requested. ESPN is never a streaming shortcut; its scoreboard attribution link is informational.

A launcher first looks for an existing service homepage, then for existing playing tabs. It focuses a single suitable tab or offers a selection when multiple streams exist. It never navigates an existing stream to the homepage. If no tab exists, it opens a normal Chrome tab/window in the same profile. **Add launched tab to GameDeck** and the existing tab picker use the current tab ID and the existing automatic layout growth.

Additional HTTPS service shortcuts can be saved in Preferences. Credentials in URLs are rejected and recognized token fields are removed before persistence. ESPN/ESPN+/WatchESPN shortcuts are rejected.

Open **CFB Live**, select **Enable CFB scores**, and grant optional access to `site.api.espn.com`. The app fetches real data only; preview mode has no fabricated games or scores. The scoreboard includes All FBS, Live, Top 25, Big Ten, SEC, Big 12, ACC and Favorites shortcuts, plus conference/status/name/ranked filters, Mexico-local dates, game cards and a compact ticker. The Oregon star button favorites ESPN team ID 2483, verified from the live response. Favorites and filters persist locally.

## ESPN endpoint research

The following were tested against the public endpoint during implementation on November 7, 2026. This is an unofficial endpoint, so these observations are not a stable API contract.

| Probe | Observed result |
| --- | --- |
| Bare `scoreboard` | HTTP 200; 16 featured events in the sampled response |
| `scoreboard?groups=80&limit=100&dates=20261107` | HTTP 200; 51 FBS events, including unranked games |
| `limit=1000` with the same day | Returned only 25 events; the larger requested limit was not reliable |
| `offset=25` / `page=2` with limit 1000 | Did not establish reliable full-slate pagination |
| `groups=5` | Returned Big Ten games, including events absent from the 25-event response |
| `groups=4` / `groups=8` | Returned Big 12 / SEC games |
| `dates=20261107-20261108` | HTTP 400 in the tested endpoint |
| `event=<id>` on scoreboard | Did not narrow the response to that event |
| `teams?groups=80&limit=1000` | Returned 763 teams, so it was not trusted as an FBS membership filter |
| `rankings` | Named AP, Playoff Committee, Coaches and other polls with dated ranks |
| Scoreboard response headers | `Access-Control-Allow-Origin: *` observed |

The implemented `EspnScoreProvider` requests **groups=80, limit=100**, once for the selected calendar date and once for the next date, deduplicates by ESPN event ID, and filters kickoff timestamps to `America/Mexico_City`. If a daily response reaches its 100-event ceiling, it supplements known FBS conference queries and reports incomplete coverage if those fail or also reach the cap. Conference membership is read from the response's team `conferenceId`; the UI's conference IDs/names are metadata, not hardcoded team membership.

Actual normalized-provider verification returned 51 events for November 7, including Oregon at Ohio State. Reproduce it with:

```powershell
npm run verify:scores -- 2026-11-07
```

The endpoint is [ESPN's public college-football scoreboard](https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=100&dates=20261107). This verification does not scrape Google or streaming pages.

### Schema and missing fields

The normalizer validates external JSON at runtime. Event identity and date come from `events[].id/date`. Home/away teams and scores come from `competitions[].competitors[]`; conference IDs and logos come from the nested team. Quarter/clock/status come from `competitions[].status`; possession and down/distance come from `situation`; networks come from `broadcasts[].names`. Missing scores remain `null` and render as an em dash. Pregame zeroes are not presented as played scores. Missing ranks, clocks, possession or network information are not invented.

An AP label is attached only when the separate **named AP Top 25 poll** provides a matching team rank whose publication date is appropriate for the requested day. Poll data is cached for six hours. The scoreboard's `curatedRank` does not itself identify a poll: when used as a fallback it is explicitly labeled **ESPN curated · poll not supplied**, never silently called AP or CFP. Rank dates and source labels are visible in card details/tooltips. Provider-reported TV networks are not a guarantee of availability in Mexico.

### Access, usage and attribution

The score host is an **optional, narrowly scoped host permission**. Requests run in the service worker with credentials omitted, redirects rejected and a timeout. There is no cookie access, credential copying, provider login extraction or new authentication flow.

No API-specific license, redistribution permission, published rate quota or service guarantee was verified. Public HTTP accessibility and permissive CORS do not establish those rights. Disney/ESPN's general [English terms](https://disneytermsofuse.com/english/) and [LATAM Spanish terms](https://disneytermsofuse.com/spanish/) contain restrictions on automated access/extraction and reuse. The dashboard identifies ESPN as the data source and links to its scoreboard; attribution is not a substitute for permission. Confirm authorization for any distribution or production use, or replace the provider with a licensed source. No authentication/rate-limit bypass is implemented.

## Refreshing and resilience

`ScoreboardService` is separate from window orchestration, so a network failure does not block ordinary tile audio or window commands. Chrome alarms are recreated from persisted state after service-worker startup. The normal cadence is approximately 30 seconds when the requested day is today and any game is in progress, otherwise five minutes. Sleeping Chrome or the OS can delay alarms; the UI shows the last successful update.

Concurrent requests for the same date share a fetch. The last normalized valid response is retained on network errors or incompatible schemas. Failures use exponential backoff, capped at 30 minutes, and honor `Retry-After`. Manual refresh starts an immediate deduplicated retry. Named ranking data has its own six-hour cache persisted across worker suspension. There is no indefinitely running service-worker timer. The UI's small timer updates freshness text only; it does not simulate game-clock progression.

Score changes are compared with the preceding snapshot. Favorites can produce a score-changed indicator; linked/favorite games can produce lead-change, fourth-quarter and final indicators. They are subtle dashboard entries, deduplicated by event/update signature, with global and per-event mute controls. No touchdown is inferred from a six- or seven-point difference. Initial snapshots do not produce alerts. No desktop-notification permission is requested.

## Associating scores and streams

Every card has **Link to Window**. Choose an available managed GameDeck game and confirm that it shows the matchup. Suggested matches use normalized school names, abbreviations, known aliases, ranking removal, common matchup separators and date proximity. Multiple plausible suggestions stay unconfirmed. Only an explicitly namespaced ESPN event ID is used as an ID hint; unrelated Disney+/DAZN URL IDs are not assumed to be ESPN IDs.

Associations persist as a stable GameDeck game key plus `{provider: 'espn', eventId}`. They never persist Chrome tab or window IDs. Changing a link replaces its previous assignment; removing a link leaves the stream running. If a linked stream is unavailable, clicking the card opens the linking dialog instead of silently opening another stream.

- Click a linked score card/ticker entry: reuse the existing `SELECT`/exclusive-audio path. No layout, focus or navigation change.
- Make Main: reuse existing promotion with an explicit audio selection before geometry changes. No second audio manager is introduced.
- Linked arrangement tiles: show abbreviations, last reported score/status/clock and cached-data marking. Smaller tiles use compact typography and retain their titles and controls.

## Optional native score ticker

The ticker uses the existing optional Native Messaging companion, extended with a separate WinForms presentation module in `native/ScoreOverlay.cs`. It draws formatted score text in its own non-activating, topmost window. It does not embed a browser, inject a score overlay into Disney+/DAZN, access video, capture pixels, read credentials or make native network requests.

Rebuild/re-register the helper for v2.4 using [native setup](../native/README.md). **Show ticker** requests the existing optional `nativeMessaging` permission. At least one managed game is required to validate the selected monitor through the existing native window-pairing challenge. Old helpers are detected and an upgrade message is shown.

Choose top/bottom, height 40–160 logical pixels, opacity 20–100%, click-through mode and individual event checkboxes. With no explicit event selection, live games are shown. The native row pages across larger selections every eight seconds; game clocks remain the provider's last reported values.

**Floating** mode covers part of the viewing area intentionally. **Reserve space** removes the ticker height from the selected monitor's layout work area, and hiding it restores the full area. Slot calculations and the arrangement diagram use the same reservation. Other monitors and unmanaged browser windows are not repositioned. Disabling immersive styles can keep the ticker connected; closing the dashboard restores immersive styles while an enabled ticker can remain visible. Native pipe exit closes the ticker. Changing monitors hides it and requires a fresh placement check. An always-on-top native window still cannot guarantee visibility over exclusive fullscreen or OS-protected surfaces.

The helper source compiles in this environment. Windows returned **Access is denied** when launching the rebuilt executable, including its non-UI self-test, even after an escalated attempt. Live ticker display, click-through and native rendering were therefore not verified. Existing helper recovery safeguards and [recovery instructions](../native/README.md#restoration) remain available. No Windows security settings were changed to run it.

## Modules and persistence

| Module | Responsibility |
| --- | --- |
| `src/sports/types.ts` | Score/event/settings identities, Mexico dates, filters, freshness |
| `src/sports/espn.ts` | Replaceable `ScoreProvider`, ESPN requests and runtime normalization |
| `src/sports/service.ts` | Durable alarm scheduling, cache/backoff/deduplication, links and preferences |
| `src/sports/matcher.ts` | Confidence-scored suggestions requiring confirmation |
| `src/sports/alerts.ts` | Snapshot-difference alerts and suppression |
| `src/sports/services.ts` | Mexico launchers and custom shortcut validation |
| `src/sports/store.ts`, `ui.tsx`, `style.css` | Integrated score UI and state |
| `src/native.ts`, `native/ScoreOverlay.cs` | Optional native ticker transport/presentation |

`gamedeckSports` stores favorites, filters, confirmed associations, overlay preferences and custom services in `chrome.storage.local`. `gamedeckScores` stores normalized public scores, update/backoff timestamps and recent alert signatures. `gamedeckScoreRanks` stores a compact named-poll cache, without the source’s redundant team images/metadata. These are separate from the original `gamedeck` window-manager state and ephemeral session bindings. No streaming credentials, tokens or cookies are stored.

Tests cover schema drift/missing fields, named polls, complete-date queries, rate limits, cache retention, deduplication, favorite/filtered views, launchers without navigation, manual matching/linking, score-card audio/promotion, optional helper compatibility and ticker reservation/restoration. Live ESPN data was verified; live authenticated-provider playback and native rendering remain separate acceptance checks.
