# deskpin

Desktop sticky note for today's Google Tasks and Calendar events.

## One-time Google setup

1. Go to https://console.cloud.google.com/ and create a project (e.g. "deskpin").
2. APIs & Services → Library: enable **Google Tasks API** and **Google Calendar API**.
3. APIs & Services → OAuth consent screen: User type **External**. Fill in app name and your email.
   Add scopes `.../auth/tasks` and `.../auth/calendar.readonly`.
4. On the consent screen page, click **Publish app** so the status is **In production**.
   (In "Testing", Google forces a new sign-in every 7 days.) Verification is not needed for
   personal use; you will click through an "unverified app" warning once.
5. APIs & Services → Credentials → Create credentials → OAuth client ID → **Desktop app**.
6. Copy `src-tauri/google_client.example.json` to `src-tauri/google_client.json` and paste the
   client ID and secret. This file is git-ignored.

## Run

```
npm install
npm run tauri dev     # development
npm test              # unit tests
npm run tauri build   # installer in src-tauri/target/release/bundle/nsis/
```

## Use

- `Ctrl+Alt+Space` show/hide, `Ctrl+Alt+P` toggle on-top / desktop mode.
- Closing the window hides it to the tray. Quit from the tray menu.
- Priority: click the chip, or write `[P1]`/`P1`/`priority: high` in a task (e.g. via Gemini).
