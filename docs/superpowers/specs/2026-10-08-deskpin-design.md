# deskpin — Design Spec

Date: 2026-10-08
Status: Draft, awaiting review

## 1. Purpose

A personal Windows desktop widget that keeps today's tasks physically visible, so they can't be lost
to distraction. Google Tasks and Google Calendar are the single source of truth; the phone side is
covered by the existing Google apps and Gemini. deskpin is a desktop view and editor on top of Google,
with no backend of its own.

### Success criteria

- Today's tasks (due today + overdue) and today's events are visible on the desktop at a glance.
- A task added via Gemini/phone appears on the desktop within ~15 seconds while the widget is visible.
- Any change made on the desktop is written to Google immediately and is visible on the phone.
- The widget survives being hidden: it keeps syncing from the tray and returns with one hotkey.

### Out of scope (v1)

- Mobile app, own backend, multi-user.
- Progress notes, time tracking, end-of-day summary (possible later "log" extensions).
- Offline edit queue.
- Editing calendar events.
- Undated tasks ("Someday" view).
- Configurable hotkeys/intervals (hardcoded constants in v1).

## 2. Decisions

| Topic | Decision |
|---|---|
| Phone | No mobile app. Google Tasks/Calendar apps + Gemini cover phone use. |
| Extra data | Priority stored as a text label in Google Tasks notes. No local-only data. |
| "Log" | = checking a task off. Google Tasks records the `completed` timestamp natively. |
| Window | Toggle between always-on-top (default) and desktop layer. Hide to tray. |
| Events | Separate read-only "Schedule" strip. |
| Task scope | Due today + overdue (overdue flagged red). Undated tasks hidden. |
| Editing | Full task CRUD from the widget. |
| Stack | Tauri 2 (Rust) + Svelte + TypeScript. |

## 3. Architecture

```
┌──────────── Tauri app (one window + tray icon) ────────────┐
│  Rust side (small, rarely changes)                         │
│   • auth.rs    – Google OAuth (system browser + loopback), │
│                  refresh token in Windows Credential Mgr   │
│   • window.rs  – top/desktop-layer toggle, tray,           │
│                  global hotkeys, autostart                 │
│                                                            │
│  Web UI side (Svelte + TypeScript, where features live)    │
│   • google.ts   – thin fetch wrapper: Tasks + Calendar REST│
│   • labels.ts   – parse/write priority labels              │
│   • today.ts    – "today" filter + sort (pure functions)   │
│   • store.ts    – state, polling, cache                    │
│   • components  – TaskList, TaskEditor, ScheduleStrip      │
└────────────────────────────────────────────────────────────┘
          │ HTTPS, bearer token obtained from Rust
          ▼
   Google Tasks API (read/write) + Google Calendar API (read-only)
```

### Rust side

- **auth.rs**: OAuth 2.0 installed-app flow with PKCE. Opens the system browser, receives the code on a
  `127.0.0.1` loopback port, exchanges it for tokens. Stores the refresh token in Windows Credential
  Manager via the `keyring` crate. Exposes Tauri commands:
  - `get_access_token() -> string` — returns a valid access token, refreshing if expired.
  - `sign_in()` / `sign_out()`.
  - Scopes: `https://www.googleapis.com/auth/tasks`, `https://www.googleapis.com/auth/calendar.readonly`.
- **window.rs**:
  - Mode toggle: *top* (`set_always_on_top(true)`) vs *desktop* (not topmost, owner set to the
    desktop `Progman` window and sent to the bottom of the z-order, so it stays on the desktop and
    survives Win+D). Owner rather than child re-parenting, because a WebView2 window re-parented as
    a child loses reliable input.
  - Tray icon with Show/Hide, toggle mode, Quit. Closing the window hides it to tray.
  - Global hotkeys: `Ctrl+Alt+Space` show/hide, `Ctrl+Alt+P` toggle mode.
  - Autostart at login (Tauri autostart plugin).
  - Persist window position, size and mode (Tauri window-state plugin).

Rust handles only what the webview cannot. All feature logic lives in TypeScript.

### Web UI side

- **google.ts**: minimal wrappers over the REST endpoints used (below). Gets the token from
  `get_access_token`, retries once on 401 after forcing a refresh. HTTP via Tauri's http plugin to
  avoid CORS concerns.
- **labels.ts**: pure functions `parsePriority(title, notes) -> 1|2|3|null` and
  `writePriority(notes, p) -> notes`.
- **today.ts**: pure functions for filtering tasks into today/overdue/done-today and sorting.
- **store.ts**: holds current state, runs the poll loop, applies edits, reads/writes the cache file.
- **components**: `TaskList`, `TaskRow`, `TaskEditor`, `ScheduleStrip`, `QuickAdd`, `Header`.

## 4. Google setup (one-time, by the user)

1. Create a Google Cloud project; enable Google Tasks API and Google Calendar API.
2. Configure the OAuth consent screen (External) and set publishing status to **In production**.
   In *Testing* status, refresh tokens expire after 7 days. Unverified-app status is fine for
   personal use; the user clicks through the "unverified app" warning once.
3. Create an OAuth client of type **Desktop app**. Client ID (and secret, which is not
   confidential for desktop clients) go into a local, git-ignored config file read at build time.

## 5. UI

```
┌─ Thu, Oct 8 ──────────── ● synced  📌  ─ ┐  ← drag bar
│ SCHEDULE                                 │
│  All day  Team offsite                   │
│  09:00 Standup        (dimmed: past)     │
│ ▶10:30 Design review  ← now              │
│  14:00 1:1 w/ Mark    in 3h 30m          │
├──────────────────────────────────────────┤
│ TASKS                                    │
│ ☐ Send invoice        P1  OVERDUE 2d     │  ← red
│ ☐ Fix login bug       P1                 │
│ ☐ Draft spec          P2                 │
│ ☐ Book dentist                           │
│ ▸ Done today (3)                         │  ← collapsed
├──────────────────────────────────────────┤
│ + Add task for today…                    │
└──────────────────────────────────────────┘
```

- Frameless, resizable, default ~320×520, dragged by the header.
- Sync dot: green = synced, amber = syncing, grey = offline/showing cache. Hover shows last sync time.
- 📌 toggles top/desktop mode (same as `Ctrl+Alt+P`).

### Tasks

- Shown: incomplete tasks with due date ≤ today, from all task lists, merged.
- Sort order: overdue first (oldest first), then P1, P2, P3, then unlabeled; ties by title.
- Overdue rows are red and show "OVERDUE Nd".
- Checkbox: marks the task completed in Google (`status: completed`). It moves to **Done today**
  showing its completion time. Unchecking there sets `status: needsAction`.
- Priority chip click cycles P1 → P2 → P3 → none.
- Row click opens the inline `TaskEditor`: title, notes, due date, priority, delete (with confirm).
  Moving a task between lists is out of scope.
- `QuickAdd`: Enter creates a task with that title, due today, in the default list ("My Tasks",
  the `@default` list).

### Schedule strip

- Events from every calendar where `selected == true` in the user's calendar list.
- Today's events in local time; recurring events expanded. All-day events at the top as "All day".
- Past events dimmed, the current event highlighted, the next event shows a countdown.
- Read-only. Click opens the event's `htmlLink` in the default browser.
- Declined events are hidden.

### Priority labels

- **Write:** the widget always normalises to `[P1]`, `[P2]` or `[P3]` as the first line of the
  task's notes. Setting "none" removes that line. Other notes content is preserved.
- **Read (lenient, for Gemini-created tasks):** check the title and the first line of notes for,
  case-insensitively:
  - `[P1]` / `P1` as a whole word (same for 2, 3)
  - `priority: high|medium|low`
  - `high priority` / `medium priority` / `low priority`
- Bare words such as "urgent" or "high" are ignored to avoid false positives ("Call high school").
- If several match, the highest priority wins.

## 6. Sync

Google Tasks has no push notifications, and Calendar push requires a public HTTPS webhook, which
contradicts the no-backend decision. deskpin therefore polls.

- **Outgoing edits are instant:** every desktop change is applied optimistically in the UI where
  possible (check off, priority), sent to Google immediately, and followed by a full re-poll.
- **Incoming changes (from phone/Gemini):**
  - Every **15 s** while the widget is visible.
  - Every **60 s** while hidden in the tray.
  - Immediately when the widget is shown (hotkey/tray) or the window gains focus.
  - Polling pauses while the PC is asleep and resumes with an immediate poll on wake.
- **Per poll:**
  - Tasks: for each task list, one `tasks.list` call with `showCompleted=true`, `showHidden=true`,
    `maxResults=100` (paginated if larger); filtering happens locally in `today.ts`.
    The list of task lists (`tasklists.list`) is refreshed every 10 minutes, not every poll.
  - Calendar: `events.list` per selected calendar with `timeMin`/`timeMax` = local day bounds,
    `singleEvents=true`, `orderBy=startTime`. The calendar list is refreshed every 10 minutes.
- **Quota check:** with ~3 task lists, a 15 s interval is ~3 Tasks calls per poll ≈ 17k calls per
  8-hour visible day, well under the Tasks API default daily quota. Calendar quota is far larger.
- **Timezone rule:** a task's `due` is RFC 3339 at midnight UTC and only its date part is
  meaningful. Compare the `YYYY-MM-DD` portion against the local date; never convert `due` to local
  time.
- "Today" is recomputed on each poll so the view rolls over at midnight.
- **Writes use PATCH** with only changed fields. Priority changes read the latest notes, apply
  `writePriority`, then patch. Concurrent edits from elsewhere: last write wins.

Full-list fetching is chosen over incremental `updatedMin` fetching for simplicity. Switch only if a
list grows large enough to matter.

## 7. Errors

| Situation | Behaviour |
|---|---|
| Access token expired | `get_access_token` refreshes silently; one retry on 401. |
| Refresh fails (revoked/expired) | Banner "Sign in again" with a button; cached view stays visible. |
| No network | Sync dot grey; cached list shown. |
| Edit fails | Inline error on the row/editor; typed text stays in the editor, nothing discarded. |
| 429 / 5xx | Skip this poll, try at the next one. No extra retries. |
| First run, not signed in | Single "Sign in with Google" screen. |

- **Cache:** `cache.json` in the app data directory, holding the last successful tasks and events
  snapshot plus its timestamp. Rewritten after each successful sync, loaded at startup.

## 8. Testing

- **Vitest unit tests** for the pure logic:
  - `labels.ts`: every accepted read form, false-positive guards, write/replace/remove preserving
    other notes.
  - `today.ts`: due-date date-only comparison across timezones (e.g. UTC+8 at 00:30 and 23:30),
    overdue detection, done-today by `completed` timestamp, sort order.
- **No E2E framework.** Manual smoke checklist:
  1. Task added via Gemini appears within ~15 s while visible.
  2. Task checked off on desktop shows as done on the phone.
  3. Disconnect network: grey dot, cache shown, failed edit keeps text.
  4. Both hotkeys work; close hides to tray; tray menu works.
  5. Desktop mode stays visible after Win+D.
  6. Autostart works after reboot.

## 9. Constants (v1, hardcoded)

| Name | Value |
|---|---|
| Visible poll interval | 15 s |
| Hidden poll interval | 60 s |
| List/calendar-list refresh | 10 min |
| Show/hide hotkey | `Ctrl+Alt+Space` |
| Mode toggle hotkey | `Ctrl+Alt+P` |
| Default window size | 320×520 |
